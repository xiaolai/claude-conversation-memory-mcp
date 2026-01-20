/**
 * Conversation Storage Layer - CRUD operations for all conversation-related data.
 *
 * This class provides the data access layer for the cccmemory system.
 * It handles storing and retrieving conversations, messages, tool uses, decisions,
 * mistakes, requirements, and git commits.
 *
 * All store operations use transactions for atomicity and performance.
 * All JSON fields are automatically serialized/deserialized.
 *
 * @example
 * ```typescript
 * const storage = new ConversationStorage(sqliteManager);
 * await storage.storeConversations(conversations);
 * const conv = storage.getConversation('conv-123');
 * const timeline = storage.getFileTimeline('src/index.ts');
 * ```
 */

import type { SQLiteManager } from "./SQLiteManager.js";
import type {
  Conversation,
  Message,
  ToolUse,
  ToolResult,
  FileEdit,
  ThinkingBlock,
} from "../parsers/ConversationParser.js";
import type { Decision } from "../parsers/DecisionExtractor.js";
import type { Mistake } from "../parsers/MistakeExtractor.js";
import type { GitCommit } from "../parsers/GitIntegrator.js";
import type { Requirement, Validation } from "../parsers/RequirementsExtractor.js";
import { sanitizeForLike } from "../utils/sanitization.js";
import type { GitCommitRow, ConversationRow } from "../types/ToolTypes.js";
import { QueryCache, type QueryCacheConfig, type CacheStats } from "../cache/QueryCache.js";
import { safeJsonParse } from "../utils/safeJson.js";
import { getCanonicalProjectPath } from "../utils/worktree.js";

/**
 * Data access layer for conversation memory storage.
 *
 * Provides CRUD operations for all conversation-related entities using SQLite.
 * Supports optional caching for frequently accessed queries.
 */
export class ConversationStorage {
  private cache: QueryCache | null = null;
  private projectIdCache = new Map<string, number>();

  /**
   * Create a new ConversationStorage instance.
   *
   * @param db - SQLiteManager instance for database access
   */
  constructor(private db: SQLiteManager) {}

  // ==================== Cache Management ====================

  /**
   * Enable query result caching.
   *
   * Caching improves performance for frequently accessed queries by storing
   * results in memory. Cache is automatically invalidated when data changes.
   *
   * @param config - Cache configuration (maxSize and ttlMs)
   *
   * @example
   * ```typescript
   * storage.enableCache({ maxSize: 100, ttlMs: 300000 });
   * ```
   */
  enableCache(config: QueryCacheConfig): void {
    this.cache = new QueryCache(config);
  }

  /**
   * Disable query result caching.
   *
   * Clears all cached data and stops caching new queries.
   */
  disableCache(): void {
    this.cache = null;
  }

  /**
   * Check if caching is enabled.
   *
   * @returns True if caching is enabled
   */
  isCacheEnabled(): boolean {
    return this.cache !== null;
  }

  /**
   * Clear all cached query results.
   *
   * Clears the cache but keeps caching enabled.
   */
  clearCache(): void {
    if (this.cache) {
      this.cache.clear();
      this.cache.resetStats();
    }
  }

  /**
   * Get cache statistics.
   *
   * Returns performance metrics including hits, misses, hit rate, and evictions.
   *
   * @returns Cache statistics or null if caching is disabled
   *
   * @example
   * ```typescript
   * const stats = storage.getCacheStats();
   * if (stats) {
   *   console.error(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
   * }
   * ```
   */
  getCacheStats(): CacheStats | null {
    return this.cache ? this.cache.getStats() : null;
  }

  getProjectId(projectPath: string): number {
    return this.ensureProjectId(projectPath);
  }

  private ensureProjectId(projectPath: string): number {
    const canonicalPath = getCanonicalProjectPath(projectPath).canonicalPath;
    const cached = this.projectIdCache.get(canonicalPath);
    if (cached) {
      return cached;
    }

    const existing = this.db
      .prepare("SELECT id FROM projects WHERE canonical_path = ?")
      .get(canonicalPath) as { id: number } | undefined;

    if (existing) {
      this.projectIdCache.set(canonicalPath, existing.id);
      return existing.id;
    }

    const alias = this.db
      .prepare("SELECT project_id FROM project_aliases WHERE alias_path = ?")
      .get(canonicalPath) as { project_id: number } | undefined;
    if (alias) {
      this.projectIdCache.set(canonicalPath, alias.project_id);
      return alias.project_id;
    }

    const now = Date.now();
    const result = this.db
      .prepare(
        "INSERT INTO projects (canonical_path, display_path, created_at, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run(canonicalPath, canonicalPath, now, now);

    const id = Number(result.lastInsertRowid);
    this.projectIdCache.set(canonicalPath, id);
    return id;
  }

  // ==================== Conversations ====================

  /**
   * Store conversations in the database.
   *
   * Uses UPSERT (INSERT ON CONFLICT UPDATE) to handle both new and updated conversations.
   * All operations are performed in a single transaction for atomicity.
   *
   * @param conversations - Array of conversation objects to store
   * @returns Promise that resolves when all conversations are stored
   *
   * @example
   * ```typescript
   * await storage.storeConversations([
   *   {
   *     id: 'conv-123',
   *     project_path: '/path/to/project',
   *     first_message_at: Date.now(),
   *     last_message_at: Date.now(),
   *     message_count: 42,
   *     git_branch: 'main',
   *     claude_version: '3.5',
   *     metadata: {},
   *     created_at: Date.now(),
   *     updated_at: Date.now()
   *   }
   * ]);
   * ```
   */
  async storeConversations(conversations: Conversation[]): Promise<Map<string, number>> {
    const stmt = this.db.prepare(`
      INSERT INTO conversations
      (project_id, project_path, source_type, external_id, first_message_at, last_message_at, message_count,
       git_branch, claude_version, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, source_type, external_id) DO UPDATE SET
        project_path = excluded.project_path,
        first_message_at = excluded.first_message_at,
        last_message_at = excluded.last_message_at,
        message_count = excluded.message_count,
        git_branch = excluded.git_branch,
        claude_version = excluded.claude_version,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `);

    const selectStmt = this.db.prepare(
      "SELECT id FROM conversations WHERE project_id = ? AND source_type = ? AND external_id = ?"
    );

    const conversationIdMap = new Map<string, number>();

    this.db.transaction(() => {
      for (const conv of conversations) {
        const canonicalProjectPath = getCanonicalProjectPath(conv.project_path).canonicalPath;
        const projectId = this.ensureProjectId(canonicalProjectPath);
        const sourceType = conv.source_type || "claude-code";
        stmt.run(
          projectId,
          canonicalProjectPath,
          sourceType,
          conv.id,
          conv.first_message_at,
          conv.last_message_at,
          conv.message_count,
          conv.git_branch,
          conv.claude_version,
          JSON.stringify(conv.metadata),
          conv.created_at,
          conv.updated_at
        );

        const row = selectStmt.get(projectId, sourceType, conv.id) as { id: number };
        conversationIdMap.set(conv.id, row.id);
      }
    });

    // Invalidate cache once after batch (not per-item)
    if (this.cache) {
      this.cache.clear();
    }

    console.error(`✓ Stored ${conversations.length} conversations`);
    return conversationIdMap;
  }

  /**
   * Retrieve a single conversation by ID.
   *
   * @param id - Conversation ID to retrieve
   * @returns Conversation object if found, null otherwise
   *
   * @example
   * ```typescript
   * const conv = storage.getConversation('conv-123');
   * if (conv) {
   *   console.error(`${conv.message_count} messages on ${conv.git_branch}`);
   * }
   * ```
   */
  getConversation(id: string, projectPath?: string): Conversation | null {
    const cacheKey = `conversation:${id}:${projectPath ?? "any"}`;

    // Check cache first
    if (this.cache) {
      const cached = this.cache.get<Conversation | null>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    let sql = "SELECT * FROM conversations WHERE external_id = ?";
    const params: (string | number)[] = [id];

    if (projectPath) {
      sql += " AND project_path = ?";
      params.push(projectPath);
    }

    sql += " ORDER BY last_message_at DESC LIMIT 1";

    const row = this.db.prepare(sql).get(...params) as ConversationRow | undefined;

    if (!row) {
      // Cache null result to avoid repeated queries
      this.cache?.set(cacheKey, null);
      return null;
    }

    const result = {
      id: row.external_id,
      project_path: row.project_path,
      source_type: row.source_type as 'claude-code' | 'codex',
      first_message_at: row.first_message_at,
      last_message_at: row.last_message_at,
      message_count: row.message_count,
      git_branch: row.git_branch,
      claude_version: row.claude_version,
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    // Cache the result
    this.cache?.set(cacheKey, result);
    return result;
  }

  // ==================== Messages ====================

  /**
   * Store messages in the database.
   *
   * Stores all messages from conversations including content, metadata, and relationships.
   * Uses UPSERT (INSERT ON CONFLICT UPDATE) for idempotent storage.
   *
   * @param messages - Array of message objects to store
   * @param skipFtsRebuild - Skip FTS rebuild (for batch operations, call rebuildAllFts() at end)
   * @returns Promise that resolves when all messages are stored
   *
   * @example
   * ```typescript
   * await storage.storeMessages([
   *   {
   *     id: 'msg-123',
   *     conversation_id: 'conv-123',
   *     message_type: 'text',
   *     role: 'user',
   *     content: 'Hello',
   *     timestamp: Date.now(),
   *     is_sidechain: false,
   *     metadata: {}
   *   }
   * ]);
   * ```
   */
  async storeMessages(
    messages: Message[],
    options: { skipFtsRebuild?: boolean; conversationIdMap: Map<string, number> }
  ): Promise<Map<string, number>> {
    if (messages.length === 0) {
      return new Map();
    }

    const { skipFtsRebuild = false, conversationIdMap } = options;

    const stmt = this.db.prepare(`
      INSERT INTO messages
      (conversation_id, external_id, parent_external_id, message_type, role, content,
       timestamp, is_sidechain, agent_id, request_id, git_branch, cwd, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, external_id) DO UPDATE SET
        parent_external_id = excluded.parent_external_id,
        message_type = excluded.message_type,
        role = excluded.role,
        content = excluded.content,
        timestamp = excluded.timestamp,
        is_sidechain = excluded.is_sidechain,
        agent_id = excluded.agent_id,
        request_id = excluded.request_id,
        git_branch = excluded.git_branch,
        cwd = excluded.cwd,
        metadata = excluded.metadata
    `);

    const selectStmt = this.db.prepare(
      "SELECT id FROM messages WHERE conversation_id = ? AND external_id = ?"
    );

    const messageIdMap = new Map<string, number>();
    let skipped = 0;

    this.db.transaction(() => {
      for (const msg of messages) {
        const convId = conversationIdMap.get(msg.conversation_id);
        if (!convId) {
          skipped += 1;
          continue;
        }

        stmt.run(
          convId,
          msg.id,
          msg.parent_id ?? null,
          msg.message_type,
          msg.role || null,
          msg.content || null,
          msg.timestamp,
          msg.is_sidechain ? 1 : 0,
          msg.agent_id || null,
          msg.request_id || null,
          msg.git_branch || null,
          msg.cwd || null,
          JSON.stringify(msg.metadata)
        );

        const row = selectStmt.get(convId, msg.id) as { id: number };
        messageIdMap.set(msg.id, row.id);
      }
    });

    if (skipped > 0) {
      console.error(`⚠️ Skipping ${skipped} message(s) with missing conversations`);
    }

    // Resolve parent_message_id after inserts
    this.db.exec(`
      UPDATE messages
      SET parent_message_id = (
        SELECT m2.id FROM messages m2
        WHERE m2.conversation_id = messages.conversation_id
          AND m2.external_id = messages.parent_external_id
      )
      WHERE parent_external_id IS NOT NULL AND parent_message_id IS NULL
    `);

    if (!skipFtsRebuild) {
      this.rebuildMessagesFts();
    }

    console.error(`✓ Stored ${messages.length - skipped} messages`);
    return messageIdMap;
  }

  /**
   * Rebuild the messages FTS index.
   * Required for FTS5 external content tables after inserting data.
   * Call this after batch operations that used skipFtsRebuild=true.
   */
  rebuildMessagesFts(): void {
    try {
      this.db.getDatabase().exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
    } catch (error) {
      // FTS rebuild may fail if table doesn't exist or schema mismatch
      // Log but don't throw - FTS is optional fallback
      console.error("FTS rebuild warning:", (error as Error).message);
    }
  }

  // ==================== Tool Uses ====================

  /**
   * Store tool use records in the database.
   *
   * Records all tool invocations from assistant messages.
   *
   * @param toolUses - Array of tool use objects
   * @returns Promise that resolves when stored
   */
  async storeToolUses(
    toolUses: ToolUse[],
    messageIdMap: Map<string, number>
  ): Promise<Map<string, number>> {
    if (toolUses.length === 0) {
      return new Map();
    }

    const stmt = this.db.prepare(`
      INSERT INTO tool_uses
      (message_id, external_id, tool_name, tool_input, timestamp)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(message_id, external_id) DO UPDATE SET
        tool_name = excluded.tool_name,
        tool_input = excluded.tool_input,
        timestamp = excluded.timestamp
    `);

    const selectStmt = this.db.prepare(
      "SELECT id FROM tool_uses WHERE message_id = ? AND external_id = ?"
    );

    const toolUseIdMap = new Map<string, number>();
    let skipped = 0;

    this.db.transaction(() => {
      for (const tool of toolUses) {
        const messageId = messageIdMap.get(tool.message_id);
        if (!messageId) {
          skipped += 1;
          continue;
        }
        stmt.run(
          messageId,
          tool.id,
          tool.tool_name,
          JSON.stringify(tool.tool_input),
          tool.timestamp
        );

        const row = selectStmt.get(messageId, tool.id) as { id: number };
        toolUseIdMap.set(tool.id, row.id);
      }
    });

    if (skipped > 0) {
      console.error(`⚠️ Skipping ${skipped} tool use(s) with missing messages`);
    }

    console.error(`✓ Stored ${toolUses.length - skipped} tool uses`);
    return toolUseIdMap;
  }

  // ==================== Tool Results ====================

  /**
   * Store tool execution results in the database.
   *
   * Records the output/results from tool invocations.
   *
   * @param toolResults - Array of tool result objects
   * @returns Promise that resolves when stored
   */
  async storeToolResults(
    toolResults: ToolResult[],
    messageIdMap: Map<string, number>,
    toolUseIdMap: Map<string, number>
  ): Promise<void> {
    if (toolResults.length === 0) {
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO tool_results
      (tool_use_id, message_id, external_id, content, is_error, stdout, stderr, is_image, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tool_use_id, external_id) DO UPDATE SET
        message_id = excluded.message_id,
        content = excluded.content,
        is_error = excluded.is_error,
        stdout = excluded.stdout,
        stderr = excluded.stderr,
        is_image = excluded.is_image,
        timestamp = excluded.timestamp
    `);

    let skipped = 0;
    this.db.transaction(() => {
      for (const result of toolResults) {
        const toolUseId = toolUseIdMap.get(result.tool_use_id);
        const messageId = messageIdMap.get(result.message_id);
        if (!toolUseId || !messageId) {
          skipped += 1;
          continue;
        }

        stmt.run(
          toolUseId,
          messageId,
          result.id,
          result.content || null,
          result.is_error ? 1 : 0,
          result.stdout || null,
          result.stderr || null,
          result.is_image ? 1 : 0,
          result.timestamp
        );
      }
    });

    if (skipped > 0) {
      console.error(`⚠️ Skipping ${skipped} tool result(s) with missing refs`);
    }

    console.error(`✓ Stored ${toolResults.length - skipped} tool results`);
  }

  // ==================== File Edits ====================

  /**
   * Store file edit records in the database.
   *
   * Records all file modifications made during conversations.
   *
   * @param fileEdits - Array of file edit objects
   * @returns Promise that resolves when stored
   */
  async storeFileEdits(
    fileEdits: FileEdit[],
    conversationIdMap: Map<string, number>,
    messageIdMap: Map<string, number>
  ): Promise<void> {
    if (fileEdits.length === 0) {
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO file_edits
      (external_id, conversation_id, file_path, message_id, backup_version,
       backup_time, snapshot_timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, external_id) DO UPDATE SET
        file_path = excluded.file_path,
        message_id = excluded.message_id,
        backup_version = excluded.backup_version,
        backup_time = excluded.backup_time,
        snapshot_timestamp = excluded.snapshot_timestamp,
        metadata = excluded.metadata
    `);

    let skipped = 0;
    this.db.transaction(() => {
      for (const edit of fileEdits) {
        const conversationId = conversationIdMap.get(edit.conversation_id);
        const messageId = messageIdMap.get(edit.message_id);
        if (!conversationId || !messageId) {
          skipped += 1;
          continue;
        }

        stmt.run(
          edit.id,
          conversationId,
          edit.file_path,
          messageId,
          edit.backup_version || null,
          edit.backup_time || null,
          edit.snapshot_timestamp,
          JSON.stringify(edit.metadata)
        );
        if (this.cache) {
          this.cache.delete(`edits:${edit.file_path}`);
          this.cache.delete(`timeline:${edit.file_path}`);
        }
      }
    });

    if (skipped > 0) {
      console.error(`⚠️ Skipping ${skipped} file edit(s) with missing refs`);
    }

    console.error(`✓ Stored ${fileEdits.length - skipped} file edits`);
  }

  /**
   * Retrieve all edits for a specific file.
   *
   * @param filePath - Path to the file
   * @returns Array of file edits, ordered by timestamp (most recent first)
   */
  getFileEdits(filePath: string): FileEdit[] {
    const cacheKey = `edits:${filePath}`;

    // Check cache first
    if (this.cache) {
      const cached = this.cache.get<FileEdit[]>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    interface FileEditRow {
      id: string;
      conversation_id: string;
      file_path: string;
      message_id: string;
      backup_version?: number;
      backup_time?: number;
      snapshot_timestamp: number;
      metadata: string; // JSON string from database
    }

    const rows = this.db
      .prepare(
        `SELECT
           fe.external_id as id,
           c.external_id as conversation_id,
           fe.file_path,
           m.external_id as message_id,
           fe.backup_version,
           fe.backup_time,
           fe.snapshot_timestamp,
           fe.metadata
         FROM file_edits fe
         JOIN conversations c ON fe.conversation_id = c.id
         JOIN messages m ON fe.message_id = m.id
         WHERE fe.file_path = ?
         ORDER BY fe.snapshot_timestamp DESC`
      )
      .all(filePath) as FileEditRow[];

    // Parse metadata JSON for each row
    const result: FileEdit[] = rows.map(row => ({
      ...row,
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
    }));

    // Cache the result
    this.cache?.set(cacheKey, result);
    return result;
  }

  // ==================== Thinking Blocks ====================

  /**
   * Store thinking blocks in the database.
   *
   * Thinking blocks contain Claude's internal reasoning. They can be large and
   * are optionally indexed based on the includeThinking flag.
   *
   * @param blocks - Array of thinking block objects
   * @returns Promise that resolves when stored
   */
  async storeThinkingBlocks(
    blocks: ThinkingBlock[],
    messageIdMap: Map<string, number>
  ): Promise<void> {
    if (blocks.length === 0) {
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO thinking_blocks
      (external_id, message_id, thinking_content, signature, timestamp)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(message_id, external_id) DO UPDATE SET
        thinking_content = excluded.thinking_content,
        signature = excluded.signature,
        timestamp = excluded.timestamp
    `);

    let skipped = 0;
    this.db.transaction(() => {
      for (const block of blocks) {
        const messageId = messageIdMap.get(block.message_id);
        if (!messageId) {
          skipped += 1;
          continue;
        }
        stmt.run(
          block.id,
          messageId,
          block.thinking_content,
          block.signature || null,
          block.timestamp
        );
      }
    });

    if (skipped > 0) {
      console.error(`⚠️ Skipping ${skipped} thinking block(s) with missing messages`);
    }

    console.error(`✓ Stored ${blocks.length - skipped} thinking blocks`);
  }

  // ==================== Decisions ====================

  /**
   * Store extracted decisions in the database.
   *
   * Decisions include architectural choices, technical decisions, and their rationale.
   *
   * @param decisions - Array of decision objects
   * @param skipFtsRebuild - Skip FTS rebuild (for batch operations, call rebuildAllFts() at end)
   * @returns Promise that resolves when stored
   */
  async storeDecisions(
    decisions: Decision[],
    options: {
      skipFtsRebuild?: boolean;
      conversationIdMap: Map<string, number>;
      messageIdMap: Map<string, number>;
    }
  ): Promise<Map<string, number>> {
    if (decisions.length === 0) {
      return new Map();
    }

    const { skipFtsRebuild = false, conversationIdMap, messageIdMap } = options;

    const stmt = this.db.prepare(`
      INSERT INTO decisions
      (external_id, conversation_id, message_id, decision_text, rationale,
       alternatives_considered, rejected_reasons, context, related_files,
       related_commits, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, external_id) DO UPDATE SET
        message_id = excluded.message_id,
        decision_text = excluded.decision_text,
        rationale = excluded.rationale,
        alternatives_considered = excluded.alternatives_considered,
        rejected_reasons = excluded.rejected_reasons,
        context = excluded.context,
        related_files = excluded.related_files,
        related_commits = excluded.related_commits,
        timestamp = excluded.timestamp
    `);

    const selectStmt = this.db.prepare(
      "SELECT id FROM decisions WHERE conversation_id = ? AND external_id = ?"
    );

    const decisionIdMap = new Map<string, number>();
    let skipped = 0;

    this.db.transaction(() => {
      for (const decision of decisions) {
        const conversationId = conversationIdMap.get(decision.conversation_id);
        const messageId = messageIdMap.get(decision.message_id);
        if (!conversationId || !messageId) {
          skipped += 1;
          continue;
        }

        stmt.run(
          decision.id,
          conversationId,
          messageId,
          decision.decision_text,
          decision.rationale || null,
          JSON.stringify(decision.alternatives_considered || []),
          JSON.stringify(decision.rejected_reasons || {}),
          decision.context || null,
          JSON.stringify(decision.related_files || []),
          JSON.stringify(decision.related_commits || []),
          decision.timestamp
        );

        const row = selectStmt.get(conversationId, decision.id) as { id: number };
        decisionIdMap.set(decision.id, row.id);

        if (this.cache && decision.related_files) {
          for (const filePath of decision.related_files) {
            this.cache.delete(`decisions:${filePath}`);
            this.cache.delete(`timeline:${filePath}`);
          }
        }
      }
    });

    if (!skipFtsRebuild) {
      this.rebuildDecisionsFts();
    }

    if (skipped > 0) {
      console.error(`⚠️ Skipping ${skipped} decision(s) with missing refs`);
    }

    console.error(`✓ Stored ${decisions.length - skipped} decisions`);
    return decisionIdMap;
  }

  /**
   * Rebuild the decisions FTS index.
   * Required for FTS5 external content tables after inserting data.
   * Call this after batch operations that used skipFtsRebuild=true.
   */
  rebuildDecisionsFts(): void {
    try {
      this.db.getDatabase().exec("INSERT INTO decisions_fts(decisions_fts) VALUES('rebuild')");
    } catch (error) {
      // FTS rebuild may fail if table doesn't exist or schema mismatch
      // Log but don't throw - FTS is optional fallback
      console.error("FTS decisions rebuild warning:", (error as Error).message);
    }
  }

  /**
   * Rebuild all FTS indexes.
   * Call this once after batch operations that used skipFtsRebuild=true.
   */
  rebuildAllFts(): void {
    this.rebuildMessagesFts();
    this.rebuildDecisionsFts();
  }

  /**
   * Retrieve all decisions related to a specific file.
   *
   * @param filePath - Path to the file
   * @returns Array of decisions that reference this file
   * @internal
   */
  getDecisionsForFile(filePath: string): Decision[] {
    const cacheKey = `decisions:${filePath}`;

    // Check cache first
    if (this.cache) {
      const cached = this.cache.get<Decision[]>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    const sanitized = sanitizeForLike(filePath);
    const rows = this.db
      .prepare(
        `SELECT
          d.external_id as decision_external_id,
          d.decision_text,
          d.rationale,
          d.alternatives_considered,
          d.rejected_reasons,
          d.context,
          d.related_files,
          d.related_commits,
          d.timestamp,
          c.external_id as conv_external_id,
          m.external_id as message_external_id
        FROM decisions d
        JOIN conversations c ON d.conversation_id = c.id
        LEFT JOIN messages m ON d.message_id = m.id
        WHERE d.related_files LIKE ? ESCAPE '\\'
        ORDER BY d.timestamp DESC`
      )
      .all(`%"${sanitized}"%`) as Array<{
      decision_external_id: string;
      decision_text: string;
      rationale?: string | null;
      alternatives_considered: string;
      rejected_reasons: string;
      context?: string | null;
      related_files: string;
      related_commits: string;
      timestamp: number;
      conv_external_id: string;
      message_external_id: string | null;
    }>;

    const result: Decision[] = [];
    for (const row of rows) {
      if (!row.message_external_id) {
        continue;
      }
      result.push({
        id: row.decision_external_id,
        conversation_id: row.conv_external_id,
        message_id: row.message_external_id,
        decision_text: row.decision_text,
        rationale: row.rationale || undefined,
        alternatives_considered: safeJsonParse<string[]>(row.alternatives_considered, []),
        rejected_reasons: safeJsonParse<Record<string, string>>(row.rejected_reasons, {}),
        context: row.context || undefined,
        related_files: safeJsonParse<string[]>(row.related_files, []),
        related_commits: safeJsonParse<string[]>(row.related_commits, []),
        timestamp: row.timestamp,
      });
    }

    // Cache the result
    this.cache?.set(cacheKey, result);
    return result;
  }

  // ==================== Git Commits ====================

  /**
   * Store git commit records linked to conversations.
   *
   * Links git commits to the conversations where they were made or discussed.
   *
   * @param commits - Array of git commit objects
   * @returns Promise that resolves when stored
   */
  async storeGitCommits(
    commits: GitCommit[],
    projectId: number,
    conversationIdMap: Map<string, number>,
    messageIdMap: Map<string, number>
  ): Promise<void> {
    if (commits.length === 0) {
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO git_commits
      (project_id, hash, message, author, timestamp, branch, files_changed,
       conversation_id, related_message_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, hash) DO UPDATE SET
        message = excluded.message,
        author = excluded.author,
        timestamp = excluded.timestamp,
        branch = excluded.branch,
        files_changed = excluded.files_changed,
        conversation_id = excluded.conversation_id,
        related_message_id = excluded.related_message_id,
        metadata = excluded.metadata
    `);

    this.db.transaction(() => {
      for (const commit of commits) {
        const conversationId = commit.conversation_id
          ? conversationIdMap.get(commit.conversation_id) ?? null
          : null;
        const messageId = commit.related_message_id
          ? messageIdMap.get(commit.related_message_id) ?? null
          : null;

        stmt.run(
          projectId,
          commit.hash,
          commit.message,
          commit.author || null,
          commit.timestamp,
          commit.branch || null,
          JSON.stringify(commit.files_changed),
          conversationId,
          messageId,
          JSON.stringify(commit.metadata)
        );
        if (this.cache && commit.files_changed) {
          for (const filePath of commit.files_changed) {
            this.cache.delete(`commits:${filePath}`);
            this.cache.delete(`timeline:${filePath}`);
          }
        }
      }
    });

    console.error(`✓ Stored ${commits.length} git commits`);
  }

  getCommitsForFile(filePath: string): GitCommit[] {
    const cacheKey = `commits:${filePath}`;

    // Check cache first
    if (this.cache) {
      const cached = this.cache.get<GitCommit[]>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    const sanitized = sanitizeForLike(filePath);
    const rows = this.db
      .prepare(
        `SELECT
          gc.id,
          gc.project_id,
          gc.hash,
          gc.message,
          gc.author,
          gc.timestamp,
          gc.branch,
          gc.files_changed,
          gc.metadata,
          c.external_id as conversation_external_id,
          m.external_id as message_external_id
        FROM git_commits gc
        LEFT JOIN conversations c ON gc.conversation_id = c.id
        LEFT JOIN messages m ON gc.related_message_id = m.id
        WHERE gc.files_changed LIKE ? ESCAPE '\\'
        ORDER BY gc.timestamp DESC`
      )
      .all(`%"${sanitized}"%`) as Array<GitCommitRow & { conversation_external_id?: string | null; message_external_id?: string | null }>;

    const result = rows.map((row) => ({
      hash: row.hash,
      message: row.message,
      author: row.author,
      timestamp: row.timestamp,
      branch: row.branch,
      files_changed: safeJsonParse<string[]>(row.files_changed, []),
      conversation_id: row.conversation_external_id || undefined,
      related_message_id: row.message_external_id || undefined,
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
    }));

    // Cache the result
    this.cache?.set(cacheKey, result);
    return result;
  }

  // ==================== Mistakes ====================

  /**
   * Store extracted mistakes in the database.
   *
   * Mistakes include errors, bugs, and wrong approaches that were later corrected.
   *
   * @param mistakes - Array of mistake objects
   * @returns Promise that resolves when stored
   */
  async storeMistakes(
    mistakes: Mistake[],
    conversationIdMap: Map<string, number>,
    messageIdMap: Map<string, number>
  ): Promise<Map<string, number>> {
    if (mistakes.length === 0) {
      return new Map();
    }

    const stmt = this.db.prepare(`
      INSERT INTO mistakes
      (external_id, conversation_id, message_id, mistake_type, what_went_wrong,
       correction, user_correction_message, files_affected, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, external_id) DO UPDATE SET
        message_id = excluded.message_id,
        mistake_type = excluded.mistake_type,
        what_went_wrong = excluded.what_went_wrong,
        correction = excluded.correction,
        user_correction_message = excluded.user_correction_message,
        files_affected = excluded.files_affected,
        timestamp = excluded.timestamp
    `);

    const selectStmt = this.db.prepare(
      "SELECT id FROM mistakes WHERE conversation_id = ? AND external_id = ?"
    );

    const mistakeIdMap = new Map<string, number>();
    let skipped = 0;

    this.db.transaction(() => {
      for (const mistake of mistakes) {
        const conversationId = conversationIdMap.get(mistake.conversation_id);
        const messageId = messageIdMap.get(mistake.message_id);
        if (!conversationId || !messageId) {
          skipped += 1;
          continue;
        }
        stmt.run(
          mistake.id,
          conversationId,
          messageId,
          mistake.mistake_type,
          mistake.what_went_wrong,
          mistake.correction || null,
          mistake.user_correction_message || null,
          JSON.stringify(mistake.files_affected),
          mistake.timestamp
        );

        const row = selectStmt.get(conversationId, mistake.id) as { id: number };
        mistakeIdMap.set(mistake.id, row.id);
      }
    });

    if (skipped > 0) {
      console.error(`⚠️ Skipping ${skipped} mistake(s) with missing refs`);
    }

    console.error(`✓ Stored ${mistakes.length - skipped} mistakes`);
    return mistakeIdMap;
  }

  // ==================== Requirements ====================

  /**
   * Store extracted requirements in the database.
   *
   * Requirements include dependencies, constraints, and specifications for components.
   *
   * @param requirements - Array of requirement objects
   * @returns Promise that resolves when stored
   */
  async storeRequirements(
    requirements: Requirement[],
    conversationIdMap: Map<string, number>,
    messageIdMap: Map<string, number>
  ): Promise<void> {
    if (requirements.length === 0) {
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO requirements
      (external_id, type, description, rationale, affects_components,
       conversation_id, message_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, external_id) DO UPDATE SET
        type = excluded.type,
        description = excluded.description,
        rationale = excluded.rationale,
        affects_components = excluded.affects_components,
        message_id = excluded.message_id,
        timestamp = excluded.timestamp
    `);

    let skipped = 0;
    this.db.transaction(() => {
      for (const req of requirements) {
        const conversationId = conversationIdMap.get(req.conversation_id);
        const messageId = messageIdMap.get(req.message_id);
        if (!conversationId || !messageId) {
          skipped += 1;
          continue;
        }
        stmt.run(
          req.id,
          req.type,
          req.description,
          req.rationale || null,
          JSON.stringify(req.affects_components),
          conversationId,
          messageId,
          req.timestamp
        );
      }
    });

    if (skipped > 0) {
      console.error(`⚠️ Skipping ${skipped} requirement(s) with missing refs`);
    }

    console.error(`✓ Stored ${requirements.length - skipped} requirements`);
  }

  // ==================== Validations ====================

  /**
   * Store validation records in the database.
   *
   * Validations capture test results and performance data from conversations.
   *
   * @param validations - Array of validation objects
   * @returns Promise that resolves when stored
   */
  async storeValidations(
    validations: Validation[],
    conversationIdMap: Map<string, number>
  ): Promise<void> {
    if (validations.length === 0) {
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO validations
      (external_id, conversation_id, what_was_tested, test_command, result,
       performance_data, files_tested, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, external_id) DO UPDATE SET
        what_was_tested = excluded.what_was_tested,
        test_command = excluded.test_command,
        result = excluded.result,
        performance_data = excluded.performance_data,
        files_tested = excluded.files_tested,
        timestamp = excluded.timestamp
    `);

    let skipped = 0;
    this.db.transaction(() => {
      for (const val of validations) {
        const conversationId = conversationIdMap.get(val.conversation_id);
        if (!conversationId) {
          skipped += 1;
          continue;
        }
        stmt.run(
          val.id,
          conversationId,
          val.what_was_tested,
          val.test_command || null,
          val.result,
          val.performance_data ? JSON.stringify(val.performance_data) : null,
          JSON.stringify(val.files_tested),
          val.timestamp
        );
      }
    });

    if (skipped > 0) {
      console.error(`⚠️ Skipping ${skipped} validation(s) with missing conversations`);
    }

    console.error(`✓ Stored ${validations.length - skipped} validations`);
  }

  // ==================== Queries ====================

  /**
   * Get the complete timeline of changes to a file.
   *
   * Combines file edits, git commits, and related decisions into a single timeline.
   * This is a key method used by tools like checkBeforeModify and getFileEvolution.
   *
   * @param filePath - Path to the file
   * @returns Object containing:
   * - `file_path`: The file path queried
   * - `edits`: All file edit records
   * - `commits`: All git commits affecting this file
   * - `decisions`: All decisions related to this file
   *
   * @example
   * ```typescript
   * const timeline = storage.getFileTimeline('src/index.ts');
   * console.error(`${timeline.edits.length} edits`);
   * console.error(`${timeline.commits.length} commits`);
   * console.error(`${timeline.decisions.length} decisions`);
   * ```
   */
  getFileTimeline(filePath: string): {
    file_path: string;
    edits: FileEdit[];
    commits: GitCommit[];
    decisions: Decision[];
  } {
    const cacheKey = `timeline:${filePath}`;

    // Check cache first
    if (this.cache) {
      const cached = this.cache.get<{
        file_path: string;
        edits: FileEdit[];
        commits: GitCommit[];
        decisions: Decision[];
      }>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    // Combine file edits, commits, and decisions
    const edits = this.getFileEdits(filePath);
    const commits = this.getCommitsForFile(filePath);
    const decisions = this.getDecisionsForFile(filePath);

    const result = {
      file_path: filePath,
      edits,
      commits,
      decisions,
    };

    // Cache the result
    this.cache?.set(cacheKey, result);
    return result;
  }

  /**
   * Get statistics about the indexed conversation data.
   *
   * Returns counts of all major entity types stored in the database.
   * Used for displaying indexing results and system health checks.
   *
   * @returns Object containing counts for:
   * - `conversations`: Total conversations indexed
   * - `messages`: Total messages stored
   * - `decisions`: Total decisions extracted
   * - `mistakes`: Total mistakes documented
   * - `git_commits`: Total git commits linked
   *
   * @example
   * ```typescript
   * const stats = storage.getStats();
   * console.error(`Indexed ${stats.conversations.count} conversations`);
   * console.error(`Extracted ${stats.decisions.count} decisions`);
   * console.error(`Linked ${stats.git_commits.count} commits`);
   * ```
   */
  getStats(): {
    conversations: { count: number };
    messages: { count: number };
    decisions: { count: number };
    mistakes: { count: number };
    git_commits: { count: number };
  } {
    const stats = {
      conversations: this.db
        .prepare("SELECT COUNT(*) as count FROM conversations")
        .get() as { count: number },
      messages: this.db
        .prepare("SELECT COUNT(*) as count FROM messages")
        .get() as { count: number },
      decisions: this.db
        .prepare("SELECT COUNT(*) as count FROM decisions")
        .get() as { count: number },
      mistakes: this.db
        .prepare("SELECT COUNT(*) as count FROM mistakes")
        .get() as { count: number },
      git_commits: this.db
        .prepare("SELECT COUNT(*) as count FROM git_commits")
        .get() as { count: number },
    };

    return stats;
  }

  getStatsForProject(
    projectPath: string,
    sourceType: "claude-code" | "codex"
  ): {
    conversations: { count: number };
    messages: { count: number };
    decisions: { count: number };
    mistakes: { count: number };
    git_commits: { count: number };
  } {
    const canonicalPath = getCanonicalProjectPath(projectPath).canonicalPath;
    const projectRow = this.db
      .prepare("SELECT id FROM projects WHERE canonical_path = ?")
      .get(canonicalPath) as { id: number } | undefined;

    if (!projectRow) {
      return {
        conversations: { count: 0 },
        messages: { count: 0 },
        decisions: { count: 0 },
        mistakes: { count: 0 },
        git_commits: { count: 0 },
      };
    }

    const stats = {
      conversations: this.db
        .prepare("SELECT COUNT(*) as count FROM conversations WHERE project_path = ? AND source_type = ?")
        .get(canonicalPath, sourceType) as { count: number },
      messages: this.db
        .prepare(
          `
          SELECT COUNT(*) as count
          FROM messages m
          JOIN conversations c ON m.conversation_id = c.id
          WHERE c.project_path = ? AND c.source_type = ?
          `
        )
        .get(canonicalPath, sourceType) as { count: number },
      decisions: this.db
        .prepare(
          `
          SELECT COUNT(*) as count
          FROM decisions d
          JOIN conversations c ON d.conversation_id = c.id
          WHERE c.project_path = ? AND c.source_type = ?
          `
        )
        .get(canonicalPath, sourceType) as { count: number },
      mistakes: this.db
        .prepare(
          `
          SELECT COUNT(*) as count
          FROM mistakes m
          JOIN conversations c ON m.conversation_id = c.id
          WHERE c.project_path = ? AND c.source_type = ?
          `
        )
        .get(canonicalPath, sourceType) as { count: number },
      git_commits: this.db
        .prepare("SELECT COUNT(*) as count FROM git_commits WHERE project_id = ?")
        .get(projectRow.id) as { count: number },
    };

    return stats;
  }
}
