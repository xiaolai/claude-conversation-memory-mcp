/**
 * Conversation Storage Layer - CRUD operations for all conversation-related data.
 *
 * This class provides the data access layer for the conversation-memory system.
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
import type { DecisionRow, GitCommitRow, ConversationRow } from "../types/ToolTypes.js";
import { QueryCache, type QueryCacheConfig, type CacheStats } from "../cache/QueryCache.js";

/**
 * Data access layer for conversation memory storage.
 *
 * Provides CRUD operations for all conversation-related entities using SQLite.
 * Supports optional caching for frequently accessed queries.
 */
export class ConversationStorage {
  private cache: QueryCache | null = null;

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
   *   console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
   * }
   * ```
   */
  getCacheStats(): CacheStats | null {
    return this.cache ? this.cache.getStats() : null;
  }

  // ==================== Conversations ====================

  /**
   * Store conversations in the database.
   *
   * Uses INSERT OR REPLACE to handle both new and updated conversations.
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
  async storeConversations(conversations: Conversation[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO conversations
      (id, project_path, first_message_at, last_message_at, message_count,
       git_branch, claude_version, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const conv of conversations) {
        stmt.run(
          conv.id,
          conv.project_path,
          conv.first_message_at,
          conv.last_message_at,
          conv.message_count,
          conv.git_branch,
          conv.claude_version,
          JSON.stringify(conv.metadata),
          conv.created_at,
          conv.updated_at
        );
        // Invalidate cache for this conversation
        if (this.cache) {
          this.cache.delete(`conversation:${conv.id}`);
        }
      }
    });

    console.log(`✓ Stored ${conversations.length} conversations`);
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
   *   console.log(`${conv.message_count} messages on ${conv.git_branch}`);
   * }
   * ```
   */
  getConversation(id: string): Conversation | null {
    const cacheKey = `conversation:${id}`;

    // Check cache first
    if (this.cache) {
      const cached = this.cache.get<Conversation | null>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as ConversationRow | undefined;

    if (!row) {
      // Cache null result to avoid repeated queries
      this.cache?.set(cacheKey, null);
      return null;
    }

    const result = {
      ...row,
      metadata: JSON.parse(row.metadata || "{}"),
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
   * Uses INSERT OR REPLACE for idempotent storage.
   *
   * @param messages - Array of message objects to store
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
  async storeMessages(messages: Message[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO messages
      (id, conversation_id, parent_id, message_type, role, content,
       timestamp, is_sidechain, agent_id, request_id, git_branch, cwd, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const msg of messages) {
        stmt.run(
          msg.id,
          msg.conversation_id,
          msg.parent_id || null,
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
      }
    });

    console.log(`✓ Stored ${messages.length} messages`);
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
  async storeToolUses(toolUses: ToolUse[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tool_uses
      (id, message_id, tool_name, tool_input, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const tool of toolUses) {
        stmt.run(
          tool.id,
          tool.message_id,
          tool.tool_name,
          JSON.stringify(tool.tool_input),
          tool.timestamp
        );
      }
    });

    console.log(`✓ Stored ${toolUses.length} tool uses`);
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
  async storeToolResults(toolResults: ToolResult[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tool_results
      (id, tool_use_id, message_id, content, is_error, stdout, stderr, is_image, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const result of toolResults) {
        stmt.run(
          result.id,
          result.tool_use_id,
          result.message_id,
          result.content || null,
          result.is_error ? 1 : 0,
          result.stdout || null,
          result.stderr || null,
          result.is_image ? 1 : 0,
          result.timestamp
        );
      }
    });

    console.log(`✓ Stored ${toolResults.length} tool results`);
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
  async storeFileEdits(fileEdits: FileEdit[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO file_edits
      (id, conversation_id, file_path, message_id, backup_version,
       backup_time, snapshot_timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const edit of fileEdits) {
        stmt.run(
          edit.id,
          edit.conversation_id,
          edit.file_path,
          edit.message_id,
          edit.backup_version || null,
          edit.backup_time || null,
          edit.snapshot_timestamp,
          JSON.stringify(edit.metadata)
        );
        // Invalidate all caches for this file
        if (this.cache) {
          this.cache.delete(`edits:${edit.file_path}`);
          this.cache.delete(`timeline:${edit.file_path}`);
        }
      }
    });

    console.log(`✓ Stored ${fileEdits.length} file edits`);
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

    const result = this.db
      .prepare(
        "SELECT * FROM file_edits WHERE file_path = ? ORDER BY snapshot_timestamp DESC"
      )
      .all(filePath) as FileEdit[];

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
  async storeThinkingBlocks(blocks: ThinkingBlock[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO thinking_blocks
      (id, message_id, thinking_content, signature, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const block of blocks) {
        stmt.run(
          block.id,
          block.message_id,
          block.thinking_content,
          block.signature || null,
          block.timestamp
        );
      }
    });

    console.log(`✓ Stored ${blocks.length} thinking blocks`);
  }

  // ==================== Decisions ====================

  /**
   * Store extracted decisions in the database.
   *
   * Decisions include architectural choices, technical decisions, and their rationale.
   *
   * @param decisions - Array of decision objects
   * @returns Promise that resolves when stored
   */
  async storeDecisions(decisions: Decision[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO decisions
      (id, conversation_id, message_id, decision_text, rationale,
       alternatives_considered, rejected_reasons, context, related_files,
       related_commits, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const decision of decisions) {
        stmt.run(
          decision.id,
          decision.conversation_id,
          decision.message_id,
          decision.decision_text,
          decision.rationale || null,
          JSON.stringify(decision.alternatives_considered),
          JSON.stringify(decision.rejected_reasons),
          decision.context || null,
          JSON.stringify(decision.related_files),
          JSON.stringify(decision.related_commits),
          decision.timestamp
        );
      }
    });

    console.log(`✓ Stored ${decisions.length} decisions`);
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
      .prepare("SELECT * FROM decisions WHERE related_files LIKE ? ESCAPE '\\' ORDER BY timestamp DESC")
      .all(`%"${sanitized}"%`) as DecisionRow[];

    const result = rows.map((row) => ({
      ...row,
      alternatives_considered: JSON.parse(row.alternatives_considered || "[]"),
      rejected_reasons: JSON.parse(row.rejected_reasons || "{}"),
      related_files: JSON.parse(row.related_files || "[]"),
      related_commits: JSON.parse(row.related_commits || "[]"),
    }));

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
  async storeGitCommits(commits: GitCommit[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO git_commits
      (hash, message, author, timestamp, branch, files_changed,
       conversation_id, related_message_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const commit of commits) {
        stmt.run(
          commit.hash,
          commit.message,
          commit.author || null,
          commit.timestamp,
          commit.branch || null,
          JSON.stringify(commit.files_changed),
          commit.conversation_id || null,
          commit.related_message_id || null,
          JSON.stringify(commit.metadata)
        );
      }
    });

    console.log(`✓ Stored ${commits.length} git commits`);
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
      .prepare("SELECT * FROM git_commits WHERE files_changed LIKE ? ESCAPE '\\' ORDER BY timestamp DESC")
      .all(`%"${sanitized}"%`) as GitCommitRow[];

    const result = rows.map((row) => ({
      ...row,
      files_changed: JSON.parse(row.files_changed || "[]"),
      metadata: JSON.parse(row.metadata || "{}"),
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
  async storeMistakes(mistakes: Mistake[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO mistakes
      (id, conversation_id, message_id, mistake_type, what_went_wrong,
       correction, user_correction_message, files_affected, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const mistake of mistakes) {
        stmt.run(
          mistake.id,
          mistake.conversation_id,
          mistake.message_id,
          mistake.mistake_type,
          mistake.what_went_wrong,
          mistake.correction || null,
          mistake.user_correction_message || null,
          JSON.stringify(mistake.files_affected),
          mistake.timestamp
        );
      }
    });

    console.log(`✓ Stored ${mistakes.length} mistakes`);
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
  async storeRequirements(requirements: Requirement[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO requirements
      (id, type, description, rationale, affects_components,
       conversation_id, message_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const req of requirements) {
        stmt.run(
          req.id,
          req.type,
          req.description,
          req.rationale || null,
          JSON.stringify(req.affects_components),
          req.conversation_id,
          req.message_id,
          req.timestamp
        );
      }
    });

    console.log(`✓ Stored ${requirements.length} requirements`);
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
  async storeValidations(validations: Validation[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO validations
      (id, conversation_id, what_was_tested, test_command, result,
       performance_data, files_tested, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const val of validations) {
        stmt.run(
          val.id,
          val.conversation_id,
          val.what_was_tested,
          val.test_command || null,
          val.result,
          val.performance_data ? JSON.stringify(val.performance_data) : null,
          JSON.stringify(val.files_tested),
          val.timestamp
        );
      }
    });

    console.log(`✓ Stored ${validations.length} validations`);
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
   * console.log(`${timeline.edits.length} edits`);
   * console.log(`${timeline.commits.length} commits`);
   * console.log(`${timeline.decisions.length} decisions`);
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
   * console.log(`Indexed ${stats.conversations.count} conversations`);
   * console.log(`Extracted ${stats.decisions.count} decisions`);
   * console.log(`Linked ${stats.git_commits.count} commits`);
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
}
