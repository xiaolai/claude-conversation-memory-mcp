/**
 * MCP Tool Handlers - Implementation of all 22 tools for the cccmemory MCP server.
 *
 * This class provides the implementation for all MCP (Model Context Protocol) tools
 * that allow Claude to interact with conversation history and memory.
 *
 * Tools are organized into categories:
 * - Indexing: index_conversations
 * - Search: search_conversations, searchDecisions, search_mistakes
 * - File Context: check_before_modify, get_file_evolution
 * - History: get_tool_history, link_commits_to_conversations
 * - Discovery: find_similar_sessions, get_requirements
 * - Recall: recall_and_apply
 * - Documentation: generate_documentation
 * - Migration: discover_old_conversations, migrate_project
 *
 * @example
 * ```typescript
 * const handlers = new ToolHandlers(memory, db, '/path/to/projects');
 * const result = await handlers.indexConversations({
 *   project_path: '/Users/me/my-project'
 * });
 * ```
 */

import { ConversationMemory } from "../ConversationMemory.js";
import type { SQLiteManager } from "../storage/SQLiteManager.js";
import { sanitizeForLike } from "../utils/sanitization.js";
import { getCanonicalProjectPath, getWorktreeInfo } from "../utils/worktree.js";
import type * as Types from "../types/ToolTypes.js";
import { DocumentationGenerator } from "../documentation/DocumentationGenerator.js";
import { ProjectMigration } from "../utils/ProjectMigration.js";
import { pathToProjectFolderName } from "../utils/sanitization.js";
import { DeletionService } from "../storage/DeletionService.js";
import { readdirSync } from "fs";
import { join, resolve } from "path";
import { safeJsonParse } from "../utils/safeJson.js";


/**
 * Pagination Patterns:
 *
 * This codebase uses two different pagination patterns based on data source:
 *
 * 1. SQL-based pagination (fetch+1):
 *    - Fetch limit+1 records from database
 *    - hasMore = results.length > limit
 *    - Slice to limit if hasMore is true
 *    - Use case: Single-database SQL queries (searchMistakes, linkCommitsToConversations)
 *    - Advantage: Efficient, minimal data transfer
 *
 * 2. In-memory pagination (slice):
 *    - Fetch all needed results (or limit+offset)
 *    - Slice to get paginated subset: results.slice(offset, offset + limit)
 *    - has_more = offset + limit < results.length
 *    - Use case: Semantic search, cross-project aggregation
 *    - Advantage: Allows sorting/filtering before pagination
 *
 * Both patterns are correct and optimized for their respective use cases.
 */

/**
 * Helper interface for embedding indexing parameters.
 */
interface EmbeddingIndexParams {
  messages: Array<{ id: string; content?: string }>;
  decisions: Array<{
    id: string;
    decision_text: string;
    rationale?: string;
    context?: string | null;
  }>;
  mistakes: Array<{
    id: string;
    what_went_wrong: string;
    correction?: string | null;
    mistake_type: string;
  }>;
  messageIdMap: Map<string, number>;
  decisionIdMap: Map<string, number>;
  mistakeIdMap: Map<string, number>;
  semanticSearch: {
    indexMessages: (msgs: Array<{ id: number; content: string }>, incremental: boolean) => Promise<void>;
    indexDecisions: (decs: Array<{ id: number; decision_text: string; rationale?: string; context?: string | null }>, incremental: boolean) => Promise<void>;
    indexMistakes: (msts: Array<{ id: number; what_went_wrong: string; correction?: string | null; mistake_type: string }>, incremental: boolean) => Promise<void>;
    indexMissingDecisionEmbeddings: () => Promise<number>;
    indexMissingMistakeEmbeddings: () => Promise<number>;
  };
  incremental: boolean;
  logLabel: string;
}

/**
 * Generate embeddings for messages, decisions, and mistakes.
 * Shared helper to avoid code duplication in indexAllProjects.
 */
async function generateEmbeddingsForIndexing(params: EmbeddingIndexParams): Promise<void> {
  const {
    messages,
    decisions,
    mistakes,
    messageIdMap,
    decisionIdMap,
    mistakeIdMap,
    semanticSearch,
    incremental,
    logLabel,
  } = params;

  try {
    // Map messages to internal IDs
    const messagesForEmbedding = messages
      .map((message) => {
        const internalId = messageIdMap.get(message.id);
        if (!internalId || !message.content) {
          return null;
        }
        return { id: internalId, content: message.content };
      })
      .filter((message): message is { id: number; content: string } => Boolean(message));

    // Map decisions to internal IDs
    const decisionsForEmbedding: Array<{
      id: number;
      decision_text: string;
      rationale?: string;
      context?: string | null;
    }> = [];
    for (const decision of decisions) {
      const internalId = decisionIdMap.get(decision.id);
      if (!internalId) {
        continue;
      }
      decisionsForEmbedding.push({
        id: internalId,
        decision_text: decision.decision_text,
        rationale: decision.rationale,
        context: decision.context ?? null,
      });
    }

    // Map mistakes to internal IDs
    const mistakesForEmbedding: Array<{
      id: number;
      what_went_wrong: string;
      correction?: string | null;
      mistake_type: string;
    }> = [];
    for (const mistake of mistakes) {
      const internalId = mistakeIdMap.get(mistake.id);
      if (!internalId) {
        continue;
      }
      mistakesForEmbedding.push({
        id: internalId,
        what_went_wrong: mistake.what_went_wrong,
        correction: mistake.correction ?? null,
        mistake_type: mistake.mistake_type,
      });
    }

    // Index all items
    await semanticSearch.indexMessages(messagesForEmbedding, incremental);
    await semanticSearch.indexDecisions(decisionsForEmbedding, incremental);
    await semanticSearch.indexMistakes(mistakesForEmbedding, incremental);
    await semanticSearch.indexMissingDecisionEmbeddings();
    await semanticSearch.indexMissingMistakeEmbeddings();
    console.error(`✓ Generated embeddings for ${logLabel}`);
  } catch (embedError) {
    console.error(`⚠️ Embedding generation failed for ${logLabel}:`, (embedError as Error).message);
    console.error("   FTS fallback will be used for search");
  }
}

/**
 * Tool handlers for the cccmemory MCP server.
 *
 * Provides methods for indexing, searching, and managing conversation history.
 */
export class ToolHandlers {
  private migration: ProjectMigration;
  private lastAutoIndex: number = 0;
  private autoIndexPromise: Promise<void> | null = null;
  private readonly AUTO_INDEX_COOLDOWN = 60000; // 1 minute

  /**
   * Create a new ToolHandlers instance.
   *
   * @param memory - ConversationMemory instance for core operations
   * @param db - SQLiteManager for database access
   * @param projectsDir - Optional directory for storing project data
   */
  constructor(private memory: ConversationMemory, private db: SQLiteManager, projectsDir?: string) {
    this.migration = new ProjectMigration(db, projectsDir);
  }

  private resolveProjectPath(input?: string): string {
    const rawPath = input || process.cwd();
    return getCanonicalProjectPath(rawPath).canonicalPath;
  }

  private resolveOptionalProjectPath(input?: string): string | undefined {
    if (!input) {
      return undefined;
    }
    return this.resolveProjectPath(input);
  }

  private inferProjectPathFromMessages(messages: Array<{ cwd?: string }>): string | null {
    const counts = new Map<string, number>();

    for (const message of messages) {
      const cwd = message.cwd;
      if (!cwd || typeof cwd !== "string") {
        continue;
      }
      const trimmed = cwd.trim();
      if (!trimmed) {
        continue;
      }
      counts.set(trimmed, (counts.get(trimmed) || 0) + 1);
    }

    let bestPath: string | null = null;
    let bestCount = 0;
    for (const [path, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestPath = path;
      }
    }

    return bestPath;
  }

  /**
   * Automatically run incremental indexing if cooldown has expired.
   * Uses a mutex (autoIndexPromise) to coalesce concurrent calls and prevent stampede.
   * This ensures search results include recent conversations without
   * requiring manual indexing.
   */
  private async maybeAutoIndex(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || process.env.CCCMEMORY_DISABLE_AUTO_INDEX === '1') {
      return;
    }

    const now = Date.now();

    // If indexing is already in progress, wait for it
    if (this.autoIndexPromise) {
      await this.autoIndexPromise;
      return;
    }

    // Check cooldown
    if (now - this.lastAutoIndex <= this.AUTO_INDEX_COOLDOWN) {
      return;
    }

    // Update timestamp immediately to prevent concurrent triggers
    this.lastAutoIndex = now;

    try {
      // Create the indexing promise and store it for coalescing
      this.autoIndexPromise = this.indexAllProjects({ incremental: true }).then(() => {});
      await this.autoIndexPromise;
    } catch (error) {
      // Log but don't fail - search should still work with existing index
      console.error('Auto-indexing failed:', error);
    } finally {
      this.autoIndexPromise = null;
    }
  }

  /**
   * Index conversation history for a project.
   *
   * Parses conversation files from Claude Code's conversation history, extracts
   * decisions, mistakes, and requirements, links git commits, and generates
   * semantic embeddings for search.
   *
   * @param args - Indexing arguments:
   * - `project_path`: Path to the project (defaults to cwd)
   * - `session_id`: Optional specific session to index
   * - `include_thinking`: Include thinking blocks (default: false)
   * - `enable_git`: Enable git integration (default: true)
   * - `exclude_mcp_conversations`: Exclude MCP tool conversations (default: 'self-only')
   * - `exclude_mcp_servers`: List of specific MCP servers to exclude
   *
   * @returns Result containing:
   * - `success`: Whether indexing succeeded
   * - `stats`: Counts of conversations, messages, decisions, etc.
   * - `indexed_folders`: List of folders that were indexed
   * - `database_path`: Path to the SQLite database
   * - `embeddings_generated`: Whether embeddings were created
   * - `embedding_error`: Error message if embeddings failed
   * - `message`: Human-readable status message
   *
   * @example
   * ```typescript
   * const result = await handlers.indexConversations({
   *   project_path: '/Users/me/my-project',
   *   enable_git: true,
   *   exclude_mcp_conversations: 'self-only'
   * });
   * console.error(result.message); // "Indexed 5 conversation(s) with 245 messages..."
   * ```
   */
  async indexConversations(args: Record<string, unknown>): Promise<Types.IndexConversationsResponse> {
    const typedArgs = args as Types.IndexConversationsArgs;
    const rawProjectPath = typedArgs.project_path || process.cwd();
    const { canonicalPath } = getWorktreeInfo(rawProjectPath);
    const projectPath = canonicalPath;
    const sessionId = typedArgs.session_id;
    const includeThinking = typedArgs.include_thinking ?? false;
    const enableGit = typedArgs.enable_git ?? true;
    const excludeMcpConversations = typedArgs.exclude_mcp_conversations ?? 'self-only';
    const excludeMcpServers = typedArgs.exclude_mcp_servers;

    const { GlobalIndex } = await import("../storage/GlobalIndex.js");
    const globalIndex = new GlobalIndex(this.db);

    try {
      let resolvedSessionId = sessionId;
      if (sessionId) {
        const numericId = Number(sessionId);
        const row = this.db.prepare(`
          SELECT external_id
          FROM conversations
          WHERE project_path = ?
            AND source_type = 'claude-code'
            AND (external_id = ? OR id = ?)
          LIMIT 1
        `).get(projectPath, sessionId, Number.isFinite(numericId) ? numericId : -1) as
          | { external_id: string }
          | undefined;
        if (row?.external_id) {
          resolvedSessionId = row.external_id;
        }
      }

      let lastIndexedMs: number | undefined;
      if (!resolvedSessionId) {
        const existingProject = globalIndex.getProject(projectPath, "claude-code");
        if (existingProject) {
          lastIndexedMs = existingProject.last_indexed;
        }
      }

      const indexResult = await this.memory.indexConversations({
        projectPath,
        sessionId: resolvedSessionId,
        includeThinking,
        enableGitIntegration: enableGit,
        excludeMcpConversations,
        excludeMcpServers,
        lastIndexedMs,
      });

      const { ConversationStorage } = await import("../storage/ConversationStorage.js");
      const storage = new ConversationStorage(this.db);
      const stats = storage.getStatsForProject(projectPath, "claude-code");

      globalIndex.registerProject({
        project_path: projectPath,
        source_type: "claude-code",
        message_count: stats.messages.count,
        conversation_count: stats.conversations.count,
        decision_count: stats.decisions.count,
        mistake_count: stats.mistakes.count,
        metadata: {
          indexed_folders: indexResult.indexed_folders || [],
        },
      });

      const sessionLabel =
        sessionId && resolvedSessionId && sessionId !== resolvedSessionId
          ? `${sessionId} -> ${resolvedSessionId}`
          : sessionId;
      const sessionInfo = sessionLabel ? ` (session: ${sessionLabel})` : ' (all sessions)';
      let message = `Indexed ${stats.conversations.count} conversation(s) with ${stats.messages.count} messages${sessionInfo}`;

      // Add indexed folders info
      if (indexResult.indexed_folders && indexResult.indexed_folders.length > 0) {
        message += `\n📁 Indexed from: ${indexResult.indexed_folders.join(', ')}`;
      }

      // Add database location info
      if (indexResult.database_path) {
        message += `\n💾 Database: ${indexResult.database_path}`;
      }

      // Add embedding status to message
      if (indexResult.embeddings_generated) {
        message += '\n✅ Semantic search enabled (embeddings generated)';
      } else if (indexResult.embedding_error) {
        message += `\n⚠️ Semantic search unavailable: ${indexResult.embedding_error}`;
        message += '\n   Falling back to full-text search';
      }

      return {
        success: true,
        project_path: projectPath,
        indexed_folders: indexResult.indexed_folders,
        database_path: indexResult.database_path,
        stats,
        embeddings_generated: indexResult.embeddings_generated,
        embedding_error: indexResult.embedding_error,
        message,
      };
    } finally {
      globalIndex.close();
    }
  }

  /**
   * Search conversation history using natural language queries.
   *
   * Uses semantic search with embeddings if available, otherwise falls back
   * to full-text search. Returns relevant messages with context and similarity scores.
   *
   * @param args - Search arguments:
   * - `query`: Natural language search query (required)
   * - `limit`: Maximum number of results (default: 10)
   * - `date_range`: Optional [start_timestamp, end_timestamp] filter
   *
   * @returns Search results containing:
   * - `query`: The search query used
   * - `results`: Array of matching messages with:
   *   - `conversation_id`: Conversation containing the message
   *   - `message_id`: Message identifier
   *   - `timestamp`: When the message was created
   *   - `similarity`: Relevance score (0-1)
   *   - `snippet`: Text excerpt from the message
   *   - `git_branch`: Git branch at the time
   *   - `message_type`: Type of message
   *   - `role`: Message role (user/assistant)
   * - `total_found`: Number of results returned
   *
   * @example
   * ```typescript
   * const result = await handlers.searchConversations({
   *   query: 'authentication bug fix',
   *   limit: 5
   * });
   * result.results.forEach(r => {
   *   console.error(`${r.similarity.toFixed(2)}: ${r.snippet}`);
   * });
   * ```
   */
  async searchConversations(args: Record<string, unknown>): Promise<Types.SearchConversationsResponse> {
    await this.maybeAutoIndex();
    const typedArgs = args as unknown as Types.SearchConversationsArgs;
    const { query, limit = 10, offset = 0, date_range, scope = 'all', conversation_id } = typedArgs;

    // Handle global scope by delegating to searchAllConversations
    if (scope === 'global') {
      const globalResponse = await this.searchAllConversations({
        query,
        limit,
        offset,
        date_range,
        source_type: "all",
      });

      const results: Types.SearchResult[] = globalResponse.results.map((result) => ({
        conversation_id: result.conversation_id,
        message_id: result.message_id,
        timestamp: result.timestamp,
        similarity: result.similarity,
        snippet: result.snippet,
        git_branch: result.git_branch,
        message_type: result.message_type,
        role: result.role,
      }));

      return {
        query,
        results,
        total_found: globalResponse.total_found,
        has_more: globalResponse.has_more,
        offset: globalResponse.offset,
        scope: 'global',
      };
    }

    // Handle current session scope
    if (scope === 'current') {
      if (!conversation_id) {
        throw new Error("conversation_id is required when scope='current'");
      }

      // Look up external_id from internal conversation_id for consistent filtering
      // conversation_id is documented as "internal conversation id from list_recent_sessions.id"
      const convRow = this.db.prepare(
        "SELECT external_id FROM conversations WHERE id = ?"
      ).get(conversation_id) as { external_id: string } | undefined;

      if (!convRow) {
        throw new Error(`Conversation with id '${conversation_id}' not found`);
      }
      const targetExternalId = convRow.external_id;

      // Overfetch to account for post-query filtering (conversation_id, date_range)
      // Use 4x multiplier to ensure we have enough results after filtering
      const overfetchMultiplier = 4;
      const fetchLimit = (limit + offset) * overfetchMultiplier;
      const results = await this.memory.search(query, fetchLimit);
      const filteredResults = results.filter(r => r.conversation.id === targetExternalId);

      const dateFilteredResults = date_range
        ? filteredResults.filter(r => {
            const timestamp = r.message.timestamp;
            return timestamp >= date_range[0] && timestamp <= date_range[1];
          })
        : filteredResults;

      const paginatedResults = dateFilteredResults.slice(offset, offset + limit);

      return {
        query,
        results: paginatedResults.map((r) => ({
          conversation_id: r.conversation.id,
          message_id: r.message.id,
          timestamp: new Date(r.message.timestamp).toISOString(),
          similarity: r.similarity,
          snippet: r.snippet,
          git_branch: r.conversation.git_branch,
          message_type: r.message.message_type,
          role: r.message.role,
        })),
        total_found: paginatedResults.length,
        has_more: offset + limit < dateFilteredResults.length,
        offset,
        scope: 'current',
      };
    }

    // Handle 'all' scope (default) - all sessions in current project
    const results = await this.memory.search(query, limit + offset);

    const filteredResults = date_range
      ? results.filter(r => {
          const timestamp = r.message.timestamp;
          return timestamp >= date_range[0] && timestamp <= date_range[1];
        })
      : results;

    const paginatedResults = filteredResults.slice(offset, offset + limit);

    return {
      query,
      results: paginatedResults.map((r) => ({
        conversation_id: r.conversation.id,
        message_id: r.message.id,
        timestamp: new Date(r.message.timestamp).toISOString(),
        similarity: r.similarity,
        snippet: r.snippet,
        git_branch: r.conversation.git_branch,
        message_type: r.message.message_type,
        role: r.message.role,
      })),
      total_found: paginatedResults.length,
      has_more: offset + limit < filteredResults.length,
      offset,
      scope: 'all',
    };
  }

  /**
   * Search conversations scoped to a project, optionally including Codex sessions.
   */
  async searchProjectConversations(
    args: Record<string, unknown>
  ): Promise<Types.SearchProjectConversationsResponse> {
    await this.maybeAutoIndex();
    const { SemanticSearch } = await import("../search/SemanticSearch.js");
    const { getEmbeddingGenerator } = await import("../embeddings/EmbeddingGenerator.js");
    const typedArgs = args as unknown as Types.SearchProjectConversationsArgs;
    const {
      query,
      project_path,
      limit = 10,
      offset = 0,
      date_range,
      include_claude_code = true,
      include_codex = true,
    } = typedArgs;

    const rawProjectPath = project_path || process.cwd();
    const { canonicalPath, worktreePaths } = getWorktreeInfo(rawProjectPath);
    const allowedPaths = new Set<string>([canonicalPath, ...worktreePaths]);

    const canonicalCache = new Map<string, string>();
    const matchesProjectPath = (path?: string): boolean => {
      if (!path) {
        return false;
      }
      if (allowedPaths.has(path)) {
        return true;
      }
      const cached = canonicalCache.get(path);
      if (cached) {
        return allowedPaths.has(cached);
      }
      const { canonicalPath: resolved } = getCanonicalProjectPath(path);
      canonicalCache.set(path, resolved);
      return allowedPaths.has(resolved);
    };

    // Pre-compute embedding once
    let queryEmbedding: Float32Array | undefined;
    try {
      const embedder = await getEmbeddingGenerator();
      if (embedder.isAvailable()) {
        queryEmbedding = await embedder.embed(query);
      }
    } catch (_embeddingError) {
      // Fall back to FTS
    }

    const allowedSources = new Set<string>();
    if (include_claude_code) {
      allowedSources.add("claude-code");
    }
    if (include_codex) {
      allowedSources.add("codex");
    }

    const semanticSearch = new SemanticSearch(this.db);
    const localResults = await semanticSearch.searchConversations(
      query,
      limit + offset + 50,
      undefined,
      queryEmbedding
    );

    const filteredResults = localResults.filter((r) => {
      if (date_range) {
        const timestamp = r.message.timestamp;
        if (timestamp < date_range[0] || timestamp > date_range[1]) {
          return false;
        }
      }
      const sourceType = r.conversation.source_type || "claude-code";
      if (!allowedSources.has(sourceType)) {
        return false;
      }
      return matchesProjectPath(r.conversation.project_path);
    });

    const results: Types.SearchProjectResult[] = filteredResults.map((result) => ({
      conversation_id: result.conversation.id,
      message_id: result.message.id,
      timestamp: new Date(result.message.timestamp).toISOString(),
      similarity: result.similarity,
      snippet: result.snippet,
      git_branch: result.conversation.git_branch,
      message_type: result.message.message_type,
      role: result.message.role,
      project_path: result.conversation.project_path,
      source_type: (result.conversation.source_type || "claude-code") as "claude-code" | "codex",
    }));

    results.sort((a, b) => b.similarity - a.similarity);
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      query,
      project_path: canonicalPath,
      results: paginatedResults,
      total_found: paginatedResults.length,
      has_more: offset + limit < results.length,
      offset,
      include_claude_code,
      include_codex,
    };
  }

  /**
   * Find decisions made about a specific topic, file, or component.
   *
   * Searches through extracted decisions to find relevant architectural choices,
   * technical decisions, and their rationale. Shows alternatives considered and
   * rejected approaches.
   *
   * @param args - Decision search arguments:
   * - `query`: Topic or keyword to search for (required)
   * - `file_path`: Optional filter for decisions related to a specific file
   * - `limit`: Maximum number of results (default: 10)
   *
   * @returns Decision search results containing:
   * - `query`: The search query used
   * - `file_path`: File filter if applied
   * - `decisions`: Array of matching decisions with:
   *   - `decision_id`: Decision identifier
   *   - `decision_text`: The decision that was made
   *   - `rationale`: Why this decision was made
   *   - `alternatives_considered`: Other options that were considered
   *   - `rejected_reasons`: Why alternatives were rejected
   *   - `context`: Context in which the decision was made
   *   - `related_files`: Files affected by this decision
   *   - `related_commits`: Git commits implementing this decision
   *   - `timestamp`: When the decision was made
   *   - `similarity`: Relevance score
   * - `total_found`: Number of decisions returned
   *
   * @example
   * ```typescript
   * const result = await handlers.getDecisions({
   *   query: 'database',
   *   file_path: 'src/storage/SQLiteManager.ts',
   *   limit: 5
   * });
   * result.decisions.forEach(d => {
   *   console.error(`Decision: ${d.decision_text}`);
   *   console.error(`Rationale: ${d.rationale}`);
   * });
   * ```
   */
  async getDecisions(args: Record<string, unknown>): Promise<Types.GetDecisionsResponse> {
    await this.maybeAutoIndex();
    const typedArgs = args as unknown as Types.GetDecisionsArgs;
    const { query, file_path, limit = 10, offset = 0, scope = 'all', conversation_id } = typedArgs;

    // Handle global scope
    if (scope === 'global') {
      const globalResponse = await this.getAllDecisions({ query, file_path, limit, offset, source_type: 'all' });
      return {
        query,
        file_path,
        decisions: globalResponse.decisions.map(d => ({
          decision_id: d.decision_id,
          decision_text: d.decision_text,
          rationale: d.rationale,
          alternatives_considered: d.alternatives_considered,
          rejected_reasons: d.rejected_reasons,
          context: d.context,
          related_files: d.related_files,
          related_commits: d.related_commits,
          timestamp: d.timestamp,
          similarity: d.similarity,
        })),
        total_found: globalResponse.total_found,
        has_more: globalResponse.has_more,
        offset: globalResponse.offset,
        scope: 'global',
      };
    }

    // Overfetch to account for post-query filtering (file_path, conversation_id)
    // Use 4x multiplier to ensure we have enough results after filtering
    const overfetchMultiplier = (file_path || scope === 'current') ? 4 : 1;
    const fetchLimit = (limit + offset) * overfetchMultiplier;
    const results = await this.memory.searchDecisions(query, fetchLimit);

    // Filter by file if specified
    let filteredResults = results;
    if (file_path) {
      filteredResults = results.filter((r) =>
        r.decision.related_files.includes(file_path)
      );
    }

    // Filter by conversation_id if scope is 'current'
    if (scope === 'current') {
      if (!conversation_id) {
        throw new Error("conversation_id is required when scope='current'");
      }
      // Look up external_id from internal conversation_id for consistent filtering
      const convRow = this.db.prepare(
        "SELECT external_id FROM conversations WHERE id = ?"
      ).get(conversation_id) as { external_id: string } | undefined;

      if (!convRow) {
        throw new Error(`Conversation with id '${conversation_id}' not found`);
      }
      const targetExternalId = convRow.external_id;
      filteredResults = filteredResults.filter((r) => r.decision.conversation_id === targetExternalId);
    }

    const paginatedResults = filteredResults.slice(offset, offset + limit);

    return {
      query,
      file_path,
      decisions: paginatedResults.map((r) => ({
        decision_id: r.decision.id,
        decision_text: r.decision.decision_text,
        rationale: r.decision.rationale,
        alternatives_considered: r.decision.alternatives_considered,
        rejected_reasons: r.decision.rejected_reasons,
        context: r.decision.context,
        related_files: r.decision.related_files,
        related_commits: r.decision.related_commits,
        timestamp: new Date(r.decision.timestamp).toISOString(),
        similarity: r.similarity,
      })),
      total_found: paginatedResults.length,
      has_more: offset + limit < filteredResults.length,
      offset,
      scope,
    };
  }

  /**
   * Check important context before modifying a file.
   *
   * Shows recent changes, related decisions, commits, and past mistakes to avoid
   * when working on a file. Use this before making significant changes to understand
   * the file's history and context.
   *
   * @param args - Check arguments:
   * - `file_path`: Path to the file you want to modify (required)
   *
   * @returns Context information containing:
   * - `file_path`: The file being checked
   * - `warning`: Warning message if important context found
   * - `recent_changes`: Recent edits and commits to this file
   *   - `edits`: Recent file edits with timestamps and conversation IDs
   *   - `commits`: Recent git commits affecting this file
   * - `related_decisions`: Decisions that affect this file
   * - `mistakes_to_avoid`: Past mistakes related to this file
   *
   * @example
   * ```typescript
   * const context = await handlers.checkBeforeModify({
   *   file_path: 'src/storage/SQLiteManager.ts'
   * });
   * console.error(context.warning);
   * console.error(`${context.related_decisions.length} decisions affect this file`);
   * console.error(`${context.mistakes_to_avoid.length} mistakes to avoid`);
   * ```
   */
  async checkBeforeModify(args: Record<string, unknown>): Promise<Types.CheckBeforeModifyResponse> {
    const typedArgs = args as unknown as Types.CheckBeforeModifyArgs;
    const { file_path } = typedArgs;

    // Validate required parameter
    if (!file_path || typeof file_path !== 'string' || file_path.trim() === '') {
      throw new Error("file_path is required and must be a non-empty string");
    }

    const timeline = this.memory.getFileTimeline(file_path);

    // Get recent mistakes affecting this file
    const sanitized = sanitizeForLike(file_path);
    const mistakes = this.db
      .prepare(
        "SELECT * FROM mistakes WHERE files_affected LIKE ? ESCAPE '\\' ORDER BY timestamp DESC LIMIT 5"
      )
      .all(`%"${sanitized}"%`) as Types.MistakeRow[];

    return {
      file_path,
      warning: timeline.edits.length > 0 || timeline.decisions.length > 0
        ? "⚠️ Important context found for this file"
        : "No significant history found",
      recent_changes: {
        edits: timeline.edits.slice(0, 5).map((e: { snapshot_timestamp: number; conversation_id: string }) => ({
          timestamp: new Date(e.snapshot_timestamp).toISOString(),
          conversation_id: e.conversation_id,
        })),
        commits: timeline.commits.slice(0, 5).map((c: { hash: string; message: string; timestamp: number }) => ({
          hash: c.hash.substring(0, 7),
          message: c.message,
          timestamp: new Date(c.timestamp).toISOString(),
        })),
      },
      related_decisions: timeline.decisions.slice(0, 3).map((d: { decision_text: string; rationale?: string; timestamp: number }) => ({
        decision_text: d.decision_text,
        rationale: d.rationale,
        timestamp: new Date(d.timestamp).toISOString(),
      })),
      mistakes_to_avoid: mistakes.map((m) => ({
        what_went_wrong: m.what_went_wrong,
        correction: m.correction,
        mistake_type: m.mistake_type,
      })),
    };
  }

  /**
   * Show complete timeline of changes to a file.
   *
   * Returns a chronological timeline of all edits, commits, and related decisions
   * for a specific file across all conversations and git history.
   *
   * @param args - Evolution arguments:
   * - `file_path`: Path to the file (required)
   * - `include_decisions`: Include related decisions (default: true)
   * - `include_commits`: Include git commits (default: true)
   *
   * @returns File evolution timeline containing:
   * - `file_path`: The file being analyzed
   * - `total_edits`: Total number of edits to this file
   * - `timeline`: Chronological array of events (most recent first):
   *   - `type`: Event type ('edit', 'commit', or 'decision')
   *   - `timestamp`: When the event occurred
   *   - `data`: Event-specific data (conversation_id, commit hash, decision text, etc.)
   *
   * @example
   * ```typescript
   * const evolution = await handlers.getFileEvolution({
   *   file_path: 'src/index.ts',
   *   include_decisions: true,
   *   include_commits: true
   * });
   * console.error(`${evolution.total_edits} edits across ${evolution.timeline.length} events`);
   * evolution.timeline.forEach(event => {
   *   console.error(`${event.timestamp}: ${event.type}`);
   * });
   * ```
   */
  async getFileEvolution(args: Record<string, unknown>): Promise<Types.GetFileEvolutionResponse> {
    const typedArgs = args as unknown as Types.GetFileEvolutionArgs;
    const { file_path, include_decisions = true, include_commits = true, limit = 50, offset = 0 } = typedArgs;

    const timeline = this.memory.getFileTimeline(file_path);

    const events: Types.TimelineEvent[] = [];

    timeline.edits.forEach((edit: { snapshot_timestamp: number; conversation_id: string; backup_version?: number }) => {
      events.push({
        type: "edit",
        timestamp: new Date(edit.snapshot_timestamp).toISOString(),
        data: {
          conversation_id: edit.conversation_id,
          backup_version: edit.backup_version,
        },
      });
    });

    if (include_commits) {
      timeline.commits.forEach((commit: { timestamp: number; hash: string; message: string; author?: string }) => {
        events.push({
          type: "commit",
          timestamp: new Date(commit.timestamp).toISOString(),
          data: {
            hash: commit.hash.substring(0, 7),
            message: commit.message,
            author: commit.author,
          },
        });
      });
    }

    if (include_decisions) {
      timeline.decisions.forEach((decision: { timestamp: number; decision_text: string; rationale?: string }) => {
        events.push({
          type: "decision",
          timestamp: new Date(decision.timestamp).toISOString(),
          data: {
            decision_text: decision.decision_text,
            rationale: decision.rationale,
          },
        });
      });
    }

    // Sort by timestamp (descending - most recent first)
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply pagination
    const paginatedEvents = events.slice(offset, offset + limit);

    return {
      file_path,
      total_edits: timeline.edits.length,
      timeline: paginatedEvents,
      has_more: offset + limit < events.length,
    };
  }

  /**
   * Link git commits to the conversations where they were made or discussed.
   *
   * Finds git commits that are associated with specific conversations, showing
   * which code changes were made during which conversations. Helps answer "WHY
   * was this code changed?"
   *
   * @param args - Link arguments:
   * - `query`: Optional search query for commit messages
   * - `conversation_id`: Optional filter for specific conversation
   * - `limit`: Maximum number of commits (default: 20)
   *
   * @returns Commit links containing:
   * - `query`: Search query if provided
   * - `conversation_id`: Conversation filter if provided
   * - `commits`: Array of linked commits with:
   *   - `hash`: Short commit hash (7 chars)
   *   - `full_hash`: Full commit hash
   *   - `message`: Commit message
   *   - `author`: Commit author
   *   - `timestamp`: When commit was made
   *   - `branch`: Git branch
   *   - `files_changed`: List of files changed
   *   - `conversation_id`: Conversation where this was discussed/made
   * - `total_found`: Number of commits returned
   *
   * @example
   * ```typescript
   * const links = await handlers.linkCommitsToConversations({
   *   query: 'fix authentication',
   *   limit: 10
   * });
   * links.commits.forEach(c => {
   *   console.error(`${c.hash}: ${c.message}`);
   *   console.error(`  Conversation: ${c.conversation_id}`);
   * });
   * ```
   */
  async linkCommitsToConversations(args: Record<string, unknown>): Promise<Types.LinkCommitsToConversationsResponse> {
    const typedArgs = args as Types.LinkCommitsToConversationsArgs;
    const { query, conversation_id, limit = 20, offset = 0, scope = 'all' } = typedArgs;

    // Global scope not supported for git commits (project-specific)
    if (scope === 'global') {
      throw new Error("Global scope is not supported for linkCommitsToConversations (git commits are project-specific)");
    }

    let sql = `
      SELECT gc.*, c.external_id as conversation_external_id
      FROM git_commits gc
      LEFT JOIN conversations c ON gc.conversation_id = c.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (conversation_id || scope === 'current') {
      const targetId = conversation_id || typedArgs.conversation_id;
      if (!targetId) {
        throw new Error("conversation_id is required when scope='current'");
      }
      // Look up external_id from internal conversation_id for consistent filtering
      const convRow = this.db.prepare(
        "SELECT external_id FROM conversations WHERE id = ?"
      ).get(targetId) as { external_id: string } | undefined;

      if (!convRow) {
        throw new Error(`Conversation with id '${targetId}' not found`);
      }
      sql += " AND c.external_id = ?";
      params.push(convRow.external_id);
    }

    if (query) {
      sql += " AND message LIKE ? ESCAPE '\\'";
      params.push(`%${sanitizeForLike(query)}%`);
    }

    sql += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit + 1); // Fetch one extra to determine has_more
    params.push(offset);

    const commits = this.db
      .prepare(sql)
      .all(...params) as Array<Types.GitCommitRow & { conversation_external_id?: string | null }>;
    const hasMore = commits.length > limit;
    const results = hasMore ? commits.slice(0, limit) : commits;

    return {
      query,
      conversation_id,
      commits: results.map((c) => ({
        hash: c.hash.substring(0, 7),
        full_hash: c.hash,
        message: c.message,
        author: c.author,
        timestamp: new Date(c.timestamp).toISOString(),
        branch: c.branch,
        files_changed: safeJsonParse<string[]>(c.files_changed, []),
        conversation_id: c.conversation_external_id ?? undefined,
      })),
      total_found: results.length,
      has_more: hasMore,
      offset,
      scope,
    };
  }

  /**
   * Find past mistakes to avoid repeating them.
   *
   * Searches through extracted mistakes to find documented errors, bugs, and
   * wrong approaches. Shows what went wrong and how it was corrected.
   *
   * @param args - Mistake search arguments:
   * - `query`: Search query for mistakes (required)
   * - `mistake_type`: Optional filter by type (logic_error, wrong_approach, misunderstanding, tool_error, syntax_error)
   * - `limit`: Maximum number of results (default: 10)
   *
   * @returns Mistake search results containing:
   * - `query`: Search query used
   * - `mistake_type`: Type filter if applied
   * - `mistakes`: Array of matching mistakes with:
   *   - `mistake_id`: Mistake identifier
   *   - `mistake_type`: Type of mistake
   *   - `what_went_wrong`: Description of the mistake
   *   - `correction`: How it was fixed
   *   - `user_correction_message`: User's correction message if available
   *   - `files_affected`: List of files involved
   *   - `timestamp`: When the mistake occurred
   * - `total_found`: Number of mistakes returned
   *
   * @example
   * ```typescript
   * const mistakes = await handlers.searchMistakes({
   *   query: 'database transaction',
   *   mistake_type: 'logic_error',
   *   limit: 5
   * });
   * mistakes.mistakes.forEach(m => {
   *   console.error(`${m.mistake_type}: ${m.what_went_wrong}`);
   *   console.error(`Fix: ${m.correction}`);
   * });
   * ```
   */
  async searchMistakes(args: Record<string, unknown>): Promise<Types.SearchMistakesResponse> {
    await this.maybeAutoIndex();
    const typedArgs = args as unknown as Types.SearchMistakesArgs;
    const { query, mistake_type, limit = 10, offset = 0, scope = 'all', conversation_id } = typedArgs;

    // Handle global scope
    if (scope === 'global') {
      const globalResponse = await this.searchAllMistakes({ query, mistake_type, limit, offset, source_type: 'all' });
      return {
        query,
        mistake_type,
        mistakes: globalResponse.mistakes.map(m => ({
          mistake_id: m.mistake_id,
          mistake_type: m.mistake_type,
          what_went_wrong: m.what_went_wrong,
          correction: m.correction,
          user_correction_message: m.user_correction_message,
          files_affected: m.files_affected,
          timestamp: m.timestamp,
        })),
        total_found: globalResponse.total_found,
        has_more: globalResponse.has_more,
        offset: globalResponse.offset,
        scope: 'global',
      };
    }

    // Try semantic search first for better results
    try {
      const { SemanticSearch } = await import("../search/SemanticSearch.js");
      const semanticSearch = new SemanticSearch(this.db);
      // Fetch more than needed to allow for filtering and pagination
      const semanticResults = await semanticSearch.searchMistakes(query, limit + offset + 10);

      // Apply additional filters
      let filtered = semanticResults;

      if (mistake_type) {
        filtered = filtered.filter(r => r.mistake.mistake_type === mistake_type);
      }

      if (scope === 'current') {
        if (!conversation_id) {
          throw new Error("conversation_id is required when scope='current'");
        }
        // Look up external_id from internal conversation_id for consistent filtering
        const convRow = this.db.prepare(
          "SELECT external_id FROM conversations WHERE id = ?"
        ).get(conversation_id) as { external_id: string } | undefined;

        if (!convRow) {
          throw new Error(`Conversation with id '${conversation_id}' not found`);
        }
        const targetExternalId = convRow.external_id;
        filtered = filtered.filter(r => r.mistake.conversation_id === targetExternalId);
      }

      // Apply pagination
      const paginated = filtered.slice(offset, offset + limit + 1);
      const hasMore = paginated.length > limit;
      const results = hasMore ? paginated.slice(0, limit) : paginated;

      if (results.length > 0) {
        return {
          query,
          mistake_type,
          mistakes: results.map(r => ({
            mistake_id: r.mistake.id,
            mistake_type: r.mistake.mistake_type,
            what_went_wrong: r.mistake.what_went_wrong,
            correction: r.mistake.correction,
            user_correction_message: r.mistake.user_correction_message,
            files_affected: r.mistake.files_affected,
            timestamp: new Date(r.mistake.timestamp).toISOString(),
          })),
          total_found: results.length,
          has_more: hasMore,
          offset,
          scope,
        };
      }
      // Fall through to LIKE search if semantic returned no results
    } catch (_e) {
      // Semantic search failed, fall back to LIKE search
      console.error("Semantic mistake search failed, using LIKE fallback");
    }

    // Fallback to LIKE search
    const sanitized = sanitizeForLike(query);
    let sql = `
      SELECT m.*, m.external_id as mistake_external_id, c.external_id as conversation_external_id
      FROM mistakes m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.what_went_wrong LIKE ? ESCAPE '\\'
    `;
    const params: (string | number)[] = [`%${sanitized}%`];

    if (mistake_type) {
      sql += " AND mistake_type = ?";
      params.push(mistake_type);
    }

    // Filter by conversation_id if scope is 'current'
    if (scope === 'current') {
      if (!conversation_id) {
        throw new Error("conversation_id is required when scope='current'");
      }
      // Look up external_id from internal conversation_id for consistent filtering
      const convRow = this.db.prepare(
        "SELECT external_id FROM conversations WHERE id = ?"
      ).get(conversation_id) as { external_id: string } | undefined;

      if (!convRow) {
        throw new Error(`Conversation with id '${conversation_id}' not found`);
      }
      sql += " AND c.external_id = ?";
      params.push(convRow.external_id);
    }

    sql += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit + 1); // Fetch one extra to determine has_more
    params.push(offset);

    const mistakes = this.db
      .prepare(sql)
      .all(...params) as Array<Types.MistakeRow & { mistake_external_id: string }>;
    const hasMore = mistakes.length > limit;
    const results = hasMore ? mistakes.slice(0, limit) : mistakes;

    return {
      query,
      mistake_type,
      mistakes: results.map((m) => ({
        mistake_id: m.mistake_external_id,
        mistake_type: m.mistake_type,
        what_went_wrong: m.what_went_wrong,
        correction: m.correction,
        user_correction_message: m.user_correction_message,
        files_affected: safeJsonParse<string[]>(m.files_affected, []),
        timestamp: new Date(m.timestamp).toISOString(),
      })),
      total_found: results.length,
      has_more: hasMore,
      offset,
      scope,
    };
  }

  /**
   * Look up requirements and constraints for a component or feature.
   *
   * Finds documented requirements, dependencies, performance constraints, and
   * compatibility requirements that affect a component or feature.
   *
   * @param args - Requirements search arguments:
   * - `component`: Component or feature name (required)
   * - `type`: Optional filter by requirement type (dependency, performance, compatibility, business)
   *
   * @returns Requirements results containing:
   * - `component`: Component searched
   * - `type`: Type filter if applied
   * - `requirements`: Array of matching requirements with:
   *   - `requirement_id`: Requirement identifier
   *   - `type`: Requirement type
   *   - `description`: Requirement description
   *   - `rationale`: Why this requirement exists
   *   - `affects_components`: List of affected components
   *   - `timestamp`: When requirement was documented
   * - `total_found`: Number of requirements returned
   *
   * @example
   * ```typescript
   * const reqs = await handlers.getRequirements({
   *   component: 'authentication',
   *   type: 'security'
   * });
   * reqs.requirements.forEach(r => {
   *   console.error(`${r.type}: ${r.description}`);
   *   console.error(`Rationale: ${r.rationale}`);
   * });
   * ```
   */
  async getRequirements(args: Record<string, unknown>): Promise<Types.GetRequirementsResponse> {
    const typedArgs = args as unknown as Types.GetRequirementsArgs;
    const { component, type } = typedArgs;

    const sanitized = sanitizeForLike(component);
    // Wrap OR group in parentheses to ensure AND type=? applies to both conditions
    let sql = "SELECT * FROM requirements WHERE (description LIKE ? ESCAPE '\\' OR affects_components LIKE ? ESCAPE '\\')";
    const params: (string | number)[] = [`%${sanitized}%`, `%${sanitized}%`];

    if (type) {
      sql += " AND type = ?";
      params.push(type);
    }

    sql += " ORDER BY timestamp DESC";

    const requirements = this.db.prepare(sql).all(...params) as Types.RequirementRow[];

    return {
      component,
      type,
      requirements: requirements.map((r) => ({
        requirement_id: r.id,
        type: r.type,
        description: r.description,
        rationale: r.rationale,
        affects_components: safeJsonParse<string[]>(r.affects_components, []),
        timestamp: new Date(r.timestamp).toISOString(),
      })),
      total_found: requirements.length,
    };
  }

  /**
   * Query history of tool uses (bash commands, file edits, reads, etc.) with pagination and filtering.
   *
   * Shows what tools were used during conversations and their results. Useful
   * for understanding what commands were run, what files were edited, and
   * whether operations succeeded or failed.
   *
   * @param args - Tool history arguments:
   * - `tool_name`: Optional filter by tool name (Bash, Edit, Write, Read)
   * - `file_path`: Optional filter by file path
   * - `limit`: Maximum number of results (default: 20)
   * - `offset`: Skip N results for pagination (default: 0)
   * - `include_content`: Include tool content in response (default: false for security, set true to include)
   * - `max_content_length`: Maximum characters per content field (default: 500)
   * - `date_range`: Filter by timestamp range [start, end]
   * - `conversation_id`: Filter by specific conversation
   * - `errors_only`: Show only failed tool uses (default: false)
   *
   * @returns Tool history containing:
   * - `tool_name`: Tool filter if applied
   * - `file_path`: File filter if applied
   * - `tool_uses`: Array of tool uses (may have truncated content)
   * - `total_found`: Number of results returned in this page
   * - `total_in_database`: Total matching records in database
   * - `has_more`: Whether more results exist beyond current page
   * - `offset`: Current offset position
   *
   * @example
   * ```typescript
   * // Get first page of Bash commands
   * const page1 = await handlers.getToolHistory({
   *   tool_name: 'Bash',
   *   limit: 20,
   *   offset: 0
   * });
   *
   * // Get metadata only (no content)
   * const metadata = await handlers.getToolHistory({
   *   include_content: false,
   *   limit: 50
   * });
   *
   * // Get errors from last 24 hours
   * const errors = await handlers.getToolHistory({
   *   errors_only: true,
   *   date_range: [Date.now() - 86400000, Date.now()]
   * });
   * ```
   */
  async getToolHistory(args: Record<string, unknown>): Promise<Types.GetToolHistoryResponse> {
    const typedArgs = args as Types.GetToolHistoryArgs;
    const {
      tool_name,
      file_path,
      limit = 20,
      offset = 0,
      include_content = false,
      max_content_length = 500,
      date_range,
      conversation_id,
      errors_only = false,
    } = typedArgs;

    // Helper function to truncate text with indicator
    const truncateText = (text: string | null | undefined, maxLength: number): { value?: string; truncated: boolean } => {
      if (!text) {
        return { value: undefined, truncated: false };
      }
      if (text.length <= maxLength) {
        return { value: text, truncated: false };
      }
      return {
        value: text.substring(0, maxLength) + '... (truncated)',
        truncated: true,
      };
    };

    // Build WHERE clause for filters
    let whereClause = "WHERE 1=1";
    const params: (string | number)[] = [];

    if (tool_name) {
      whereClause += " AND tu.tool_name = ?";
      params.push(tool_name);
    }

    if (file_path) {
      const sanitized = sanitizeForLike(file_path);
      whereClause += " AND tu.tool_input LIKE ? ESCAPE '\\'";
      params.push(`%${sanitized}%`);
    }

    if (date_range && date_range.length === 2) {
      whereClause += " AND tu.timestamp BETWEEN ? AND ?";
      params.push(date_range[0], date_range[1]);
    }

    if (conversation_id) {
      whereClause += " AND tu.message_id IN (SELECT id FROM messages WHERE conversation_id = ?)";
      params.push(conversation_id);
    }

    if (errors_only) {
      whereClause += " AND tr.is_error = 1";
    }

    // Get total count of matching records
    const countSql = `
      SELECT COUNT(*) as total
      FROM tool_uses tu
      LEFT JOIN tool_results tr ON tu.id = tr.tool_use_id
      ${whereClause}
    `;
    const countResult = this.db.prepare(countSql).get(...params) as { total: number };
    const totalInDatabase = countResult.total;

    // Get paginated results
    const sql = `
      SELECT tu.*, tr.content as result_content, tr.is_error, tr.stdout, tr.stderr
      FROM tool_uses tu
      LEFT JOIN tool_results tr ON tu.id = tr.tool_use_id
      ${whereClause}
      ORDER BY tu.timestamp DESC
      LIMIT ? OFFSET ?
    `;
    const queryParams = [...params, limit, offset];
    const toolUses = this.db.prepare(sql).all(...queryParams) as Types.ToolUseRow[];

    // Calculate pagination metadata
    const hasMore = offset + toolUses.length < totalInDatabase;

    return {
      tool_name,
      file_path,
      tool_uses: toolUses.map((t) => {
        // Parse tool input
        const toolInput = safeJsonParse<Record<string, unknown>>(t.tool_input, {});

        // Build result object based on include_content setting
        const result: Types.ToolUseResult['result'] = {
          is_error: Boolean(t.is_error),
        };

        if (include_content) {
          // Truncate content fields if they exist
          const contentTrunc = truncateText(t.result_content, max_content_length);
          const stdoutTrunc = truncateText(t.stdout, max_content_length);
          const stderrTrunc = truncateText(t.stderr, max_content_length);

          if (contentTrunc.value !== undefined) {
            result.content = contentTrunc.value;
            if (contentTrunc.truncated) {
              result.content_truncated = true;
            }
          }

          if (stdoutTrunc.value !== undefined) {
            result.stdout = stdoutTrunc.value;
            if (stdoutTrunc.truncated) {
              result.stdout_truncated = true;
            }
          }

          if (stderrTrunc.value !== undefined) {
            result.stderr = stderrTrunc.value;
            if (stderrTrunc.truncated) {
              result.stderr_truncated = true;
            }
          }
        }
        // If include_content=false, only return is_error (no content, stdout, stderr)

        return {
          tool_use_id: t.id,
          tool_name: t.tool_name,
          tool_input: toolInput,
          result,
          timestamp: new Date(t.timestamp).toISOString(),
        };
      }),
      total_found: toolUses.length,
      total_in_database: totalInDatabase,
      has_more: hasMore,
      offset,
    };
  }

  /**
   * Find conversations that dealt with similar topics or problems.
   *
   * Searches across all conversations to find ones that discussed similar topics,
   * allowing you to learn from past work on similar problems.
   *
   * @param args - Similarity search arguments:
   * - `query`: Description of the topic or problem (required)
   * - `limit`: Maximum number of sessions (default: 5)
   *
   * @returns Similar sessions containing:
   * - `query`: Search query used
   * - `sessions`: Array of similar conversation sessions with:
   *   - `conversation_id`: Session identifier
   *   - `project_path`: Project path for this session
   *   - `first_message_at`: When the conversation started
   *   - `message_count`: Number of messages in the conversation
   *   - `git_branch`: Git branch at the time
   *   - `relevance_score`: Similarity score to the query
   *   - `relevant_messages`: Sample of relevant messages from this session
   * - `total_found`: Number of sessions returned
   *
   * @example
   * ```typescript
   * const similar = await handlers.findSimilarSessions({
   *   query: 'implementing user authentication with JWT',
   *   limit: 3
   * });
   * similar.sessions.forEach(s => {
   *   console.error(`Session ${s.conversation_id} (${s.message_count} messages)`);
   *   console.error(`Relevance: ${s.relevance_score.toFixed(2)}`);
   *   console.error(`Messages: ${s.relevant_messages.length} relevant`);
   * });
   * ```
   */
  async findSimilarSessions(args: Record<string, unknown>): Promise<Types.FindSimilarSessionsResponse> {
    await this.maybeAutoIndex();
    const typedArgs = args as unknown as Types.FindSimilarSessionsArgs;
    const { query, limit = 5, offset = 0, scope = 'all', conversation_id: _conversation_id } = typedArgs;

    // Note: scope='global' and scope='current' have limited usefulness for finding similar SESSIONS
    // but we implement them for API consistency
    if (scope === 'current') {
      throw new Error("scope='current' is not supported for findSimilarSessions (it finds sessions, not messages within a session)");
    }

    const results = await this.memory.search(query, (limit + offset) * 3); // Get more to group by conversation

    // Group by conversation
    const conversationMap = new Map<string, Types.SessionResult>();

    for (const result of results) {
      const convId = result.conversation.id;

      if (convId && !conversationMap.has(convId)) {
        conversationMap.set(convId, {
          conversation_id: convId,
          project_path: result.conversation.project_path,
          first_message_at: new Date(result.conversation.first_message_at).toISOString(),
          message_count: result.conversation.message_count,
          git_branch: result.conversation.git_branch,
          relevance_score: result.similarity,
          relevant_messages: [],
        });
      }

      const conversation = conversationMap.get(convId);
      if (conversation) {
        conversation.relevant_messages.push({
          message_id: result.message.id,
          snippet: result.snippet,
          similarity: result.similarity,
        });
      }
    }

    const allSessions = Array.from(conversationMap.values())
      .sort((a, b) => b.relevance_score - a.relevance_score);

    const sessions = allSessions.slice(offset, offset + limit);

    return {
      query,
      sessions,
      total_found: sessions.length,
      has_more: offset + limit < allSessions.length,
      offset,
      scope,
    };
  }

  /**
   * Recall relevant context and format for application to current work.
   *
   * This is a comprehensive context retrieval tool that searches across multiple
   * data sources (conversations, decisions, mistakes, file changes, commits) and
   * returns actionable suggestions for applying historical context to current work.
   *
   * @param args - Recall arguments:
   * - `query`: What you're working on or need context for (required)
   * - `context_types`: Types to recall (default: all types)
   *   - Options: "conversations", "decisions", "mistakes", "file_changes", "commits"
   * - `file_path`: Optional filter for file-specific context
   * - `date_range`: Optional [start_timestamp, end_timestamp] filter
   * - `limit`: Maximum items per context type (default: 5)
   *
   * @returns Recalled context containing:
   * - `query`: Search query used
   * - `context_summary`: High-level summary of what was found
   * - `recalled_context`: Structured context data:
   *   - `conversations`: Relevant past conversations
   *   - `decisions`: Related decisions with rationale
   *   - `mistakes`: Past mistakes to avoid
   *   - `file_changes`: File modification history
   *   - `commits`: Related git commits
   * - `application_suggestions`: Actionable suggestions for applying this context
   * - `total_items_found`: Total number of context items found
   *
   * @example
   * ```typescript
   * const context = await handlers.recallAndApply({
   *   query: 'refactoring database connection pooling',
   *   context_types: ['decisions', 'mistakes', 'commits'],
   *   file_path: 'src/database/pool.ts',
   *   limit: 5
   * });
   * console.error(context.context_summary);
   * context.application_suggestions.forEach(s => console.error(`- ${s}`));
   * ```
   */
  async recallAndApply(args: Record<string, unknown>): Promise<Types.RecallAndApplyResponse> {
    await this.maybeAutoIndex();
    const typedArgs = args as unknown as Types.RecallAndApplyArgs;
    const { query, context_types = ["conversations", "decisions", "mistakes", "file_changes", "commits"], file_path, date_range, limit = 5, offset = 0, scope = 'all', conversation_id } = typedArgs;

    const recalled: Types.RecalledContext = {};
    let totalItems = 0;
    const suggestions: string[] = [];

    // 1. Recall conversations if requested
    if (context_types.includes("conversations")) {
      // Use searchConversations with scope support
      const convResponse = await this.searchConversations({
        query,
        limit,
        offset,
        date_range,
        scope,
        conversation_id,
      });

      recalled.conversations = convResponse.results.map(result => ({
        session_id: result.conversation_id,
        timestamp: result.timestamp,
        snippet: result.snippet,
        relevance_score: result.similarity,
      }));
      totalItems += recalled.conversations.length;

      if (recalled.conversations.length > 0) {
        suggestions.push(`Review ${recalled.conversations.length} past conversation(s) about similar topics`);
      }
    }

    // 2. Recall decisions if requested
    if (context_types.includes("decisions")) {
      // Use getDecisions with scope support
      const decisionsResponse = await this.getDecisions({
        query,
        file_path,
        limit,
        offset,
        scope,
        conversation_id,
      });

      recalled.decisions = decisionsResponse.decisions.map(d => ({
        decision_id: d.decision_id,
        type: d.context || 'unknown',
        description: d.decision_text,
        rationale: d.rationale || undefined,
        alternatives: d.alternatives_considered,
        rejected_approaches: Object.values(d.rejected_reasons ?? {}),
        affects_components: d.related_files,
        timestamp: d.timestamp,
      }));
      totalItems += recalled.decisions.length;

      if (recalled.decisions.length > 0) {
        suggestions.push(`Apply learnings from ${recalled.decisions.length} past decision(s) with documented rationale`);
      }
    }

    // 3. Recall mistakes if requested
    if (context_types.includes("mistakes")) {
      // Use searchMistakes with scope support
      const mistakesResponse = await this.searchMistakes({
        query,
        limit,
        offset,
        scope,
        conversation_id,
      });

      recalled.mistakes = mistakesResponse.mistakes.map(m => ({
        mistake_id: m.mistake_id,
        type: m.mistake_type,
        description: m.what_went_wrong,
        what_happened: m.what_went_wrong,
        how_fixed: m.correction || undefined,
        lesson_learned: m.user_correction_message || undefined,
        files_affected: m.files_affected,
        timestamp: m.timestamp,
      }));
      totalItems += recalled.mistakes.length;

      if (recalled.mistakes.length > 0) {
        suggestions.push(`Avoid repeating ${recalled.mistakes.length} documented mistake(s) from the past`);
      }
    }

    // 4. Recall file changes if requested
    if (context_types.includes("file_changes") && file_path) {
      // Query file_edits table (not messages) - file_path is stored in file_edits
      const fileChanges = this.db.getDatabase()
        .prepare(`
          SELECT
            file_path,
            COUNT(DISTINCT conversation_id) as change_count,
            MAX(snapshot_timestamp) as last_modified,
            GROUP_CONCAT(DISTINCT conversation_id) as conversation_ids
          FROM file_edits
          WHERE file_path LIKE ? ESCAPE '\\'
          ${date_range ? 'AND snapshot_timestamp BETWEEN ? AND ?' : ''}
          GROUP BY file_path
          ORDER BY last_modified DESC
          LIMIT ?
        `)
        .all(
          `%${sanitizeForLike(file_path)}%`,
          ...(date_range ? [date_range[0], date_range[1]] : []),
          limit
        ) as Array<{
          file_path: string;
          change_count: number;
          last_modified: number;
          conversation_ids: string;
        }>;

      recalled.file_changes = fileChanges.map(fc => ({
        file_path: fc.file_path,
        change_count: fc.change_count,
        last_modified: new Date(fc.last_modified).toISOString(),
        related_conversations: fc.conversation_ids ? fc.conversation_ids.split(',') : [],
      }));
      totalItems += recalled.file_changes.length;

      if (recalled.file_changes.length > 0) {
        suggestions.push(`Consider ${recalled.file_changes.length} file(s) with relevant history before making changes`);
      }
    }

    // 5. Recall commits if requested
    if (context_types.includes("commits")) {
      const commits = this.db.getDatabase()
        .prepare(`
          SELECT hash, message, timestamp, files_changed
          FROM git_commits
          WHERE message LIKE ? ESCAPE '\\' ${file_path ? "AND files_changed LIKE ? ESCAPE '\\'" : ''}
          ${date_range ? 'AND timestamp BETWEEN ? AND ?' : ''}
          ORDER BY timestamp DESC
          LIMIT ?
        `)
        .all(
          `%${sanitizeForLike(query)}%`,
          ...(file_path ? [`%${sanitizeForLike(file_path)}%`] : []),
          ...(date_range ? [date_range[0], date_range[1]] : []),
          limit
        ) as Array<{
          hash: string;
          message: string;
          timestamp: number;
          files_changed: string;
        }>;

      recalled.commits = commits.map(c => ({
        commit_hash: c.hash,
        message: c.message,
        timestamp: new Date(c.timestamp).toISOString(),
        files_affected: safeJsonParse<string[]>(c.files_changed, []),
      }));
      totalItems += recalled.commits.length;

      if (recalled.commits.length > 0) {
        suggestions.push(`Reference ${recalled.commits.length} related git commit(s) for implementation patterns`);
      }
    }

    // Generate context summary
    const summaryParts: string[] = [];
    if (recalled.conversations && recalled.conversations.length > 0) {
      summaryParts.push(`${recalled.conversations.length} relevant conversation(s)`);
    }
    if (recalled.decisions && recalled.decisions.length > 0) {
      summaryParts.push(`${recalled.decisions.length} decision(s)`);
    }
    if (recalled.mistakes && recalled.mistakes.length > 0) {
      summaryParts.push(`${recalled.mistakes.length} past mistake(s)`);
    }
    if (recalled.file_changes && recalled.file_changes.length > 0) {
      summaryParts.push(`${recalled.file_changes.length} file change(s)`);
    }
    if (recalled.commits && recalled.commits.length > 0) {
      summaryParts.push(`${recalled.commits.length} commit(s)`);
    }

    const contextSummary = summaryParts.length > 0
      ? `Recalled: ${summaryParts.join(', ')}`
      : 'No relevant context found';

    // Add general suggestion if we found context
    if (totalItems > 0) {
      suggestions.push(`Use this historical context to inform your current implementation`);
    } else {
      suggestions.push(`No historical context found - you may be working on something new`);
    }

    return {
      query,
      context_summary: contextSummary,
      recalled_context: recalled,
      application_suggestions: suggestions,
      total_items_found: totalItems,
    };
  }

  /**
   * Generate comprehensive project documentation by combining codebase analysis
   * with conversation history.
   *
   * Creates documentation that shows WHAT exists in the code (via local code scanning)
   * and WHY it was built that way (via conversation history).
   *
   * @param args - Documentation generation arguments:
   * - `project_path`: Path to the project (defaults to cwd)
   * - `session_id`: Optional specific session to include
   * - `scope`: Documentation scope (default: 'full')
   *   - 'full': Everything (architecture, decisions, quality)
   *   - 'architecture': Module structure and dependencies
   *   - 'decisions': Decision log with rationale
   *   - 'quality': Code quality insights
   * - `module_filter`: Optional filter for specific module path (e.g., 'src/auth')
   *
   * @returns Documentation result containing:
   * - `success`: Whether generation succeeded
   * - `project_path`: Project that was documented
   * - `scope`: Scope of documentation generated
   * - `documentation`: Generated markdown documentation
   * - `statistics`: Summary statistics:
   *   - `modules`: Number of modules documented
   *   - `decisions`: Number of decisions included
   *   - `mistakes`: Number of mistakes documented
   *   - `commits`: Number of commits referenced
   *
   * @example
   * ```typescript
   * const doc = await handlers.generateDocumentation({
   *   project_path: '/Users/me/my-project',
   *   scope: 'full',
   *   module_filter: 'src/auth'
   * });
   * console.error(doc.documentation); // Markdown documentation
   * console.error(`Documented ${doc.statistics.modules} modules`);
   * ```
   */
  async generateDocumentation(args: Record<string, unknown>): Promise<Types.GenerateDocumentationResponse> {
    const typedArgs = args as unknown as Types.GenerateDocumentationArgs;
    const projectPath = this.resolveProjectPath(typedArgs.project_path);
    const sessionId = typedArgs.session_id;
    const scope = typedArgs.scope || 'full';
    const moduleFilter = typedArgs.module_filter;

    console.error('\n📚 Starting documentation generation...');

    const generator = new DocumentationGenerator(this.db);
    const documentation = await generator.generate(
      {
        projectPath,
        sessionId,
        scope,
        moduleFilter
      }
    );

    // Extract statistics from the generated documentation
    const lines = documentation.split('\n');
    const modulesLine = lines.find(l => l.includes('**Modules**:'));
    const decisionsLine = lines.find(l => l.includes('| Decisions |'));
    const mistakesLine = lines.find(l => l.includes('| Mistakes |'));
    const commitsLine = lines.find(l => l.includes('| Git Commits |'));

    const extractNumber = (line: string | undefined): number => {
      if (!line) {return 0;}
      const match = line.match(/\d+/);
      return match ? parseInt(match[0], 10) : 0;
    };

    return {
      success: true,
      project_path: projectPath,
      scope,
      documentation,
      statistics: {
        modules: extractNumber(modulesLine),
        decisions: extractNumber(decisionsLine),
        mistakes: extractNumber(mistakesLine),
        commits: extractNumber(commitsLine)
      }
    };
  }

  /**
   * Discover old conversation folders that might contain conversation history
   * for the current project.
   *
   * Searches through stored conversation folders to find potential matches for
   * the current project path. Useful when project paths have changed (e.g., after
   * moving or renaming a project directory).
   *
   * @param args - Discovery arguments:
   * - `current_project_path`: Current project path (defaults to cwd)
   *
   * @returns Discovery results containing:
   * - `success`: Whether discovery succeeded
   * - `current_project_path`: Current project path searched for
   * - `candidates`: Array of potential matches sorted by score:
   *   - `folder_name`: Name of the conversation folder
   *   - `folder_path`: Full path to the folder
   *   - `stored_project_path`: Original project path stored in conversations
   *   - `score`: Match score (higher is better match)
   *   - `stats`: Folder statistics:
   *     - `conversations`: Number of conversations in folder
   *     - `messages`: Number of messages in folder
   *     - `files`: Number of .jsonl files
   *     - `last_activity`: Timestamp of last activity
   * - `message`: Human-readable status message
   *
   * @example
   * ```typescript
   * const discovery = await handlers.discoverOldConversations({
   *   current_project_path: '/Users/me/projects/my-app'
   * });
   * console.error(discovery.message);
   * discovery.candidates.forEach(c => {
   *   console.error(`Score ${c.score}: ${c.folder_name}`);
   *   console.error(`  Original path: ${c.stored_project_path}`);
   *   console.error(`  Stats: ${c.stats.conversations} conversations, ${c.stats.files} files`);
   * });
   * ```
   */
  async discoverOldConversations(args: Record<string, unknown>): Promise<Types.DiscoverOldConversationsResponse> {
    const typedArgs = args as Types.DiscoverOldConversationsArgs;
    const currentProjectPath = this.resolveProjectPath(typedArgs.current_project_path);

    const candidates = await this.migration.discoverOldFolders(currentProjectPath);

    // Convert to response format with additional stats
    const formattedCandidates = candidates.map(c => ({
      folder_name: c.folderName,
      folder_path: c.folderPath,
      stored_project_path: c.storedProjectPath,
      score: Math.round(c.score * 10) / 10, // Round to 1 decimal
      stats: {
        conversations: c.stats.conversations,
        messages: c.stats.messages,
        files: 0, // Will be calculated below
        last_activity: c.stats.lastActivity
      }
    }));

    // Count JSONL files for each candidate
    for (const candidate of formattedCandidates) {
      try {
        const files = readdirSync(candidate.folder_path);
        candidate.stats.files = files.filter((f: string) => f.endsWith('.jsonl')).length;
      } catch (_error) {
        candidate.stats.files = 0;
      }
    }

    const message = candidates.length > 0
      ? `Found ${candidates.length} potential old conversation folder(s). Top match has ${formattedCandidates[0].stats.conversations} conversations and ${formattedCandidates[0].stats.files} files (score: ${formattedCandidates[0].score}).`
      : `No old conversation folders found for project path: ${currentProjectPath}`;

    return {
      success: true,
      current_project_path: currentProjectPath,
      candidates: formattedCandidates,
      message
    };
  }

  /**
   * Migrate or merge conversation history from an old project path to a new one.
   *
   * Use this when a project has been moved or renamed to bring the conversation
   * history along. Supports two modes: 'migrate' (move all files) or 'merge'
   * (combine with existing files).
   *
   * @param args - Migration arguments:
   * - `source_folder`: Source folder containing old conversations (required)
   * - `old_project_path`: Original project path in the conversations (required)
   * - `new_project_path`: New project path to update to (required)
   * - `dry_run`: Preview changes without applying them (default: false)
   * - `mode`: Migration mode (default: 'migrate')
   *   - 'migrate': Move all files from source to target
   *   - 'merge': Combine source files with existing target files
   *
   * @returns Migration result containing:
   * - `success`: Whether migration succeeded
   * - `source_folder`: Source folder path
   * - `target_folder`: Target folder path (where files were copied)
   * - `files_copied`: Number of files copied/migrated
   * - `database_updated`: Whether database was updated with new paths
   * - `backup_created`: Whether backup was created (always true for non-dry-run)
   * - `message`: Human-readable status message
   *
   * @example
   * ```typescript
   * // First, preview with dry run
   * const preview = await handlers.migrateProject({
   *   source_folder: '/path/to/old/conversations',
   *   old_project_path: '/old/path/to/project',
   *   new_project_path: '/new/path/to/project',
   *   dry_run: true
   * });
   * console.error(preview.message); // "Dry run: Would migrate X files..."
   *
   * // Then, execute the migration
   * const result = await handlers.migrateProject({
   *   source_folder: '/path/to/old/conversations',
   *   old_project_path: '/old/path/to/project',
   *   new_project_path: '/new/path/to/project',
   *   dry_run: false,
   *   mode: 'migrate'
   * });
   * console.error(`Migrated ${result.files_copied} files`);
   * ```
   */
  async migrateProject(args: Record<string, unknown>): Promise<Types.MigrateProjectResponse> {
    const typedArgs = args as unknown as Types.MigrateProjectArgs;
    const sourceFolder = typedArgs.source_folder;

    // Validate all required parameters
    if (!sourceFolder || typeof sourceFolder !== 'string' || sourceFolder.trim() === '') {
      throw new Error("source_folder is required and must be a non-empty string");
    }
    if (!typedArgs.old_project_path || !typedArgs.new_project_path) {
      throw new Error("old_project_path and new_project_path are required");
    }
    const oldProjectPath = getCanonicalProjectPath(typedArgs.old_project_path).canonicalPath;
    const newProjectPath = getCanonicalProjectPath(typedArgs.new_project_path).canonicalPath;
    const dryRun = typedArgs.dry_run ?? false;
    const mode = typedArgs.mode ?? "migrate";

    // Validate paths are under expected directories using resolved paths
    // to prevent path traversal attacks (e.g., /projects/../../../etc/passwd)
    const projectsDir = resolve(this.migration.getProjectsDir());
    const resolvedSource = resolve(sourceFolder);
    if (!resolvedSource.startsWith(projectsDir + "/") && resolvedSource !== projectsDir) {
      throw new Error(`Source folder must be under ${projectsDir}`);
    }

    // Calculate target folder path
    const targetFolderName = pathToProjectFolderName(newProjectPath);
    const targetFolder = join(this.migration.getProjectsDir(), targetFolderName);

    // Execute migration or merge
    const result = await this.migration.executeMigration(
      sourceFolder,
      targetFolder,
      oldProjectPath,
      newProjectPath,
      dryRun,
      mode
    );

    let message: string;
    if (dryRun) {
      message =
        mode === "merge"
          ? `Dry run: Would merge ${result.filesCopied} new conversation files into ${targetFolder}`
          : `Dry run: Would migrate ${result.filesCopied} conversation files from ${sourceFolder} to ${targetFolder}`;
    } else {
      message =
        mode === "merge"
          ? `Successfully merged ${result.filesCopied} new conversation files into ${targetFolder}. Original files preserved in ${sourceFolder}.`
          : `Successfully migrated ${result.filesCopied} conversation files to ${targetFolder}. Original files preserved in ${sourceFolder}.`;
    }

    return {
      success: result.success,
      source_folder: sourceFolder,
      target_folder: targetFolder,
      files_copied: result.filesCopied,
      database_updated: result.databaseUpdated,
      backup_created: !dryRun && result.databaseUpdated,
      message
    };
  }

  /**
   * Forget conversations by topic/keywords.
   *
   * Searches for conversations matching the provided keywords and optionally deletes them.
   * Creates automatic backup before deletion.
   *
   * @param args - Arguments:
   * - `keywords`: Array of keywords/topics to search for
   * - `project_path`: Path to the project (defaults to cwd)
   * - `confirm`: Must be true to actually delete (default: false for preview)
   *
   * @returns Result containing:
   * - `success`: Whether operation succeeded
   * - `preview_mode`: Whether this was a preview (confirm=false)
   * - `conversations_found`: Number of conversations matching keywords
   * - `conversations_deleted`: Number of conversations actually deleted
   * - `messages_deleted`: Number of messages deleted
   * - `decisions_deleted`: Number of decisions deleted
   * - `mistakes_deleted`: Number of mistakes deleted
   * - `backup_path`: Path to backup file (if deletion occurred)
   * - `conversation_summaries`: List of conversations with basic info
   * - `message`: Human-readable status message
   *
   * @example
   * ```typescript
   * // Preview what would be deleted
   * const preview = await handlers.forgetByTopic({
   *   keywords: ['authentication', 'redesign'],
   *   confirm: false
   * });
   *
   * // Actually delete after reviewing preview
   * const result = await handlers.forgetByTopic({
   *   keywords: ['authentication', 'redesign'],
   *   confirm: true
   * });
   * ```
   */
  async forgetByTopic(args: unknown): Promise<Types.ForgetByTopicResponse> {
    const typedArgs = args as Types.ForgetByTopicArgs;
    // Filter out empty strings and trim whitespace
    const keywords = (typedArgs.keywords || [])
      .map(k => k.trim())
      .filter(k => k.length > 0);
    const projectPath = this.resolveProjectPath(typedArgs.project_path);
    // SECURITY: Require strict boolean true to prevent truthy string coercion
    const confirm = typedArgs.confirm === true;

    if (keywords.length === 0) {
      return {
        success: false,
        preview_mode: true,
        conversations_found: 0,
        conversations_deleted: 0,
        messages_deleted: 0,
        decisions_deleted: 0,
        mistakes_deleted: 0,
        backup_path: null,
        conversation_summaries: [],
        message: "No keywords provided. Please specify keywords/topics to search for."
      };
    }

    try {
      // Create deletion service
      const storage = this.memory.getStorage();
      const semanticSearch = this.memory.getSemanticSearch();
      const deletionService = new DeletionService(
        this.db.getDatabase(),
        storage,
        semanticSearch
      );

      // Preview what would be deleted
      const preview = await deletionService.previewDeletionByTopic(keywords, projectPath);

      if (preview.conversationIds.length === 0) {
        return {
          success: true,
          preview_mode: true,
          conversations_found: 0,
          conversations_deleted: 0,
          messages_deleted: 0,
          decisions_deleted: 0,
          mistakes_deleted: 0,
          backup_path: null,
          conversation_summaries: [],
          message: preview.summary
        };
      }

      // Format conversation summaries for response
      const conversationSummaries = preview.conversations.map(conv => ({
        id: conv.id,
        session_id: conv.session_id,
        created_at: new Date(conv.created_at).toISOString(),
        message_count: conv.message_count
      }));

      // If not confirmed, return preview
      if (!confirm) {
        return {
          success: true,
          preview_mode: true,
          conversations_found: preview.conversationIds.length,
          conversations_deleted: 0,
          messages_deleted: 0,
          decisions_deleted: 0,
          mistakes_deleted: 0,
          backup_path: null,
          conversation_summaries: conversationSummaries,
          message: `${preview.summary}\n\nSet confirm=true to delete these conversations.`
        };
      }

      // Actually delete with backup
      const result = await deletionService.forgetByTopic(keywords, projectPath);

      return {
        success: true,
        preview_mode: false,
        conversations_found: result.deleted.conversations,
        conversations_deleted: result.deleted.conversations,
        messages_deleted: result.deleted.messages,
        decisions_deleted: result.deleted.decisions,
        mistakes_deleted: result.deleted.mistakes,
        backup_path: result.backup.backupPath,
        conversation_summaries: conversationSummaries,
        message: result.summary
      };

    } catch (error) {
      return {
        success: false,
        preview_mode: !confirm,
        conversations_found: 0,
        conversations_deleted: 0,
        messages_deleted: 0,
        decisions_deleted: 0,
        mistakes_deleted: 0,
        backup_path: null,
        conversation_summaries: [],
        message: `Error: ${(error as Error).message}`
      };
    }
  }

  // ==================== High-Value Utility Tools ====================

  /**
   * Search for all context related to a specific file.
   *
   * Combines discussions, decisions, and mistakes related to a file
   * in one convenient query.
   *
   * @param args - Search arguments with file_path
   * @returns Combined file context from all sources
   */
  async searchByFile(args: Record<string, unknown>): Promise<Types.SearchByFileResponse> {
    const typedArgs = args as unknown as Types.SearchByFileArgs;
    const filePath = typedArgs.file_path;
    const limit = typedArgs.limit || 5;

    if (!filePath) {
      return {
        file_path: "",
        discussions: [],
        decisions: [],
        mistakes: [],
        total_mentions: 0,
        message: "Error: file_path is required",
      };
    }

    // Normalize the file path for searching (handle both relative and absolute)
    const normalizedPath = filePath.replace(/^\.\//, "");
    const escapedPath = sanitizeForLike(normalizedPath);

    try {
      // Search messages mentioning this file
      interface MessageRow {
        id: string;
        conversation_id: string;
        content: string;
        timestamp: number;
        role: string;
      }
      const messagesQuery = `
        SELECT id, conversation_id, content, timestamp, role
        FROM messages
        WHERE content LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'
        ORDER BY timestamp DESC
        LIMIT ?
      `;
      const discussions = this.db
        .prepare(messagesQuery)
        .all(`%${escapedPath}%`, `%/${escapedPath}%`, limit) as MessageRow[];

      // Search decisions related to this file
      interface DecisionRow {
        id: string;
        decision_text: string;
        rationale: string | null;
        context: string | null;
        timestamp: number;
      }
      const decisionsQuery = `
        SELECT d.id, d.decision_text, d.rationale, d.context, d.timestamp
        FROM decisions d
        WHERE d.related_files LIKE ? ESCAPE '\\'
           OR d.related_files LIKE ? ESCAPE '\\'
           OR d.decision_text LIKE ? ESCAPE '\\'
        ORDER BY d.timestamp DESC
        LIMIT ?
      `;
      const decisions = this.db
        .prepare(decisionsQuery)
        .all(`%${escapedPath}%`, `%/${escapedPath}%`, `%${escapedPath}%`, limit) as DecisionRow[];

      // Search mistakes related to this file
      interface MistakeRow {
        id: string;
        mistake_type: string;
        what_went_wrong: string;
        correction: string | null;
        timestamp: number;
      }
      const mistakesQuery = `
        SELECT m.id, m.mistake_type, m.what_went_wrong, m.correction, m.timestamp
        FROM mistakes m
        WHERE m.files_affected LIKE ? ESCAPE '\\'
           OR m.files_affected LIKE ? ESCAPE '\\'
           OR m.what_went_wrong LIKE ? ESCAPE '\\'
        ORDER BY m.timestamp DESC
        LIMIT ?
      `;
      const mistakes = this.db
        .prepare(mistakesQuery)
        .all(`%${escapedPath}%`, `%/${escapedPath}%`, `%${escapedPath}%`, limit) as MistakeRow[];

      const totalMentions = discussions.length + decisions.length + mistakes.length;

      return {
        file_path: filePath,
        discussions: discussions.map((d) => ({
          id: d.id,
          conversation_id: d.conversation_id,
          content: d.content.substring(0, 500),
          timestamp: d.timestamp,
          role: d.role,
        })),
        decisions: decisions.map((d) => ({
          id: d.id,
          decision_text: d.decision_text,
          rationale: d.rationale || undefined,
          context: d.context || undefined,
          timestamp: d.timestamp,
        })),
        mistakes: mistakes.map((m) => ({
          id: m.id,
          mistake_type: m.mistake_type,
          what_went_wrong: m.what_went_wrong,
          correction: m.correction || undefined,
          timestamp: m.timestamp,
        })),
        total_mentions: totalMentions,
        message:
          totalMentions > 0
            ? `Found ${totalMentions} mentions: ${discussions.length} discussions, ${decisions.length} decisions, ${mistakes.length} mistakes`
            : `No mentions found for file: ${filePath}`,
      };
    } catch (error) {
      return {
        file_path: filePath,
        discussions: [],
        decisions: [],
        mistakes: [],
        total_mentions: 0,
        message: `Error searching for file: ${(error as Error).message}`,
      };
    }
  }

  /**
   * List recent conversation sessions.
   *
   * Provides an overview of recent sessions with basic stats.
   *
   * @param args - Query arguments with limit/offset
   * @returns List of recent sessions with summaries
   */
  async listRecentSessions(args: Record<string, unknown>): Promise<Types.ListRecentSessionsResponse> {
    const typedArgs = args as unknown as Types.ListRecentSessionsArgs;
    const limit = typedArgs.limit || 10;
    const offset = typedArgs.offset || 0;
    const projectPath = this.resolveOptionalProjectPath(typedArgs.project_path);

    try {
      interface SessionRow {
        id: string;
        external_id: string;
        project_path: string;
        created_at: number;
        message_count: number;
        first_message_preview: string | null;
      }

      let query: string;
      let params: (string | number)[];

      if (projectPath) {
        query = `
          SELECT
            c.id,
            c.external_id,
            c.project_path,
            c.created_at,
            (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
            (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY timestamp ASC LIMIT 1) as first_message_preview
          FROM conversations c
          WHERE c.project_path = ?
          ORDER BY c.created_at DESC
          LIMIT ? OFFSET ?
        `;
        params = [projectPath, limit + 1, offset];
      } else {
        query = `
          SELECT
            c.id,
            c.external_id,
            c.project_path,
            c.created_at,
            (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
            (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY timestamp ASC LIMIT 1) as first_message_preview
          FROM conversations c
          ORDER BY c.created_at DESC
          LIMIT ? OFFSET ?
        `;
        params = [limit + 1, offset];
      }

      const rows = this.db.prepare(query).all(...params) as SessionRow[];
      const hasMore = rows.length > limit;
      const sessions = hasMore ? rows.slice(0, limit) : rows;

      // Count total sessions
      interface CountRow {
        total: number;
      }
      const countQuery = projectPath
        ? "SELECT COUNT(*) as total FROM conversations WHERE project_path = ?"
        : "SELECT COUNT(*) as total FROM conversations";
      const countParams = projectPath ? [projectPath] : [];
      const countRow = this.db.prepare(countQuery).get(...countParams) as CountRow;
      const totalSessions = countRow?.total || 0;

        return {
          sessions: sessions.map((s) => ({
          id: s.id,
          session_id: s.external_id,
          project_path: s.project_path,
          created_at: s.created_at,
          message_count: s.message_count,
          first_message_preview: s.first_message_preview
            ? s.first_message_preview.substring(0, 200)
            : undefined,
        })),
        total_sessions: totalSessions,
        has_more: hasMore,
        message: `Found ${totalSessions} sessions${projectPath ? ` for ${projectPath}` : ""}`,
      };
    } catch (error) {
      return {
        sessions: [],
        total_sessions: 0,
        has_more: false,
        message: `Error listing sessions: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Summarize the latest session for a project.
   *
   * Returns the most recent conversation and a lightweight summary of
   * what is being worked on, recent actions, and errors.
   */
  async getLatestSessionSummary(args: Record<string, unknown>): Promise<Types.GetLatestSessionSummaryResponse> {
    const typedArgs = args as unknown as Types.GetLatestSessionSummaryArgs;
    const projectPath = this.resolveOptionalProjectPath(typedArgs.project_path);
    const sourceType = typedArgs.source_type ?? "all";
    const limitMessages = Math.max(1, Math.min(typedArgs.limit_messages ?? 20, 200));
    const includeTools = typedArgs.include_tools !== false;
    const includeErrors = typedArgs.include_errors !== false;

    const truncate = (input: string, maxLength: number): string => {
      const trimmed = input.trim().replace(/\s+/g, " ");
      if (trimmed.length <= maxLength) {
        return trimmed;
      }
      return `${trimmed.slice(0, maxLength - 1)}…`;
    };

    try {
      let query = `
        SELECT
          c.id,
          c.external_id,
          c.project_path,
          c.source_type,
          c.created_at,
          c.last_message_at,
          c.message_count
        FROM conversations c
      `;
      const params: Array<string | number> = [];
      const clauses: string[] = [];

      if (projectPath) {
        clauses.push("c.project_path = ?");
        params.push(projectPath);
      }

      if (sourceType !== "all") {
        clauses.push("c.source_type = ?");
        params.push(sourceType);
      }

      if (clauses.length > 0) {
        query += ` WHERE ${clauses.join(" AND ")}`;
      }

      query += " ORDER BY c.last_message_at DESC LIMIT 1";

      const sessionRow = this.db.prepare(query).get(...params) as
        | {
            id: number;
            external_id: string;
            project_path: string;
            source_type: "claude-code" | "codex";
            created_at: number;
            last_message_at: number;
            message_count: number;
          }
        | undefined;

      if (!sessionRow) {
        return {
          success: true,
          found: false,
          message: "No sessions found",
        };
      }

      const messageRows = this.db.prepare(`
        SELECT
          m.id,
          m.message_type,
          m.role,
          m.content,
          m.timestamp
        FROM messages m
        WHERE m.conversation_id = ?
        ORDER BY m.timestamp DESC
        LIMIT ?
      `).all(sessionRow.id, limitMessages) as Array<{
        id: number;
        message_type: string;
        role: string | null;
        content: string | null;
        timestamp: number;
      }>;

      const recentUserMessages: Array<{ timestamp: number; content: string }> = [];
      const recentAssistantMessages: Array<{ timestamp: number; content: string }> = [];

      for (const row of messageRows) {
        if (!row.content) {
          continue;
        }
        const snippet = truncate(row.content, 280);
        if (row.role === "user" || row.message_type === "user") {
          if (recentUserMessages.length < 3) {
            recentUserMessages.push({ timestamp: row.timestamp, content: snippet });
          }
        } else if (row.role === "assistant" || row.message_type === "assistant") {
          if (recentAssistantMessages.length < 3) {
            recentAssistantMessages.push({ timestamp: row.timestamp, content: snippet });
          }
        }
      }

      const problemStatementSource = recentUserMessages[0] ?? recentAssistantMessages[0];
      const problemStatement = problemStatementSource?.content;

      const recentActions: Array<{
        tool_name: string;
        timestamp: number;
        tool_input: Record<string, unknown>;
      }> = [];

      if (includeTools) {
        const toolRows = this.db.prepare(`
          SELECT
            tu.tool_name,
            tu.tool_input,
            tu.timestamp
          FROM tool_uses tu
          JOIN messages m ON m.id = tu.message_id
          WHERE m.conversation_id = ?
          ORDER BY tu.timestamp DESC
          LIMIT 5
        `).all(sessionRow.id) as Array<{ tool_name: string; tool_input: string; timestamp: number }>;

        for (const row of toolRows) {
          recentActions.push({
            tool_name: row.tool_name,
            timestamp: row.timestamp,
            tool_input: safeJsonParse(row.tool_input, {}),
          });
        }
      }

      const errors: Array<{ tool_name: string; timestamp: number; message: string }> = [];
      if (includeErrors) {
        const errorRows = this.db.prepare(`
          SELECT
            tu.tool_name,
            tr.timestamp,
            tr.content,
            tr.stderr
          FROM tool_results tr
          JOIN tool_uses tu ON tu.id = tr.tool_use_id
          JOIN messages m ON m.id = tr.message_id
          WHERE m.conversation_id = ? AND tr.is_error = 1
          ORDER BY tr.timestamp DESC
          LIMIT 5
        `).all(sessionRow.id) as Array<{
          tool_name: string;
          timestamp: number;
          content: string | null;
          stderr: string | null;
        }>;

        for (const row of errorRows) {
          const message = row.stderr || row.content || "Unknown error";
          errors.push({
            tool_name: row.tool_name,
            timestamp: row.timestamp,
            message: truncate(message, 280),
          });
        }
      }

      return {
        success: true,
        found: true,
        session: {
          id: String(sessionRow.id),
          session_id: sessionRow.external_id,
          project_path: sessionRow.project_path,
          source_type: sessionRow.source_type,
          created_at: sessionRow.created_at,
          last_message_at: sessionRow.last_message_at,
          message_count: sessionRow.message_count,
        },
        summary: {
          problem_statement: problemStatement,
          recent_user_messages: recentUserMessages,
          recent_assistant_messages: recentAssistantMessages,
          recent_actions: includeTools ? recentActions : undefined,
          errors: includeErrors ? errors : undefined,
        },
        message: "Latest session summary generated",
      };
    } catch (error) {
      return {
        success: false,
        found: false,
        message: `Error generating latest session summary: ${(error as Error).message}`,
      };
    }
  }

  // ==================== Global Cross-Project Tools ====================

  /**
   * Index all projects (Claude Code + Codex).
   *
   * Discovers and indexes all projects from both Claude Code and Codex,
   * registering them in a global index for cross-project search.
   *
   * @param args - Indexing arguments
   * @returns Summary of all indexed projects
   */
  async indexAllProjects(args: Record<string, unknown>): Promise<Types.IndexAllProjectsResponse> {
    const { GlobalIndex } = await import("../storage/GlobalIndex.js");
    const { homedir } = await import("os");
    const { join } = await import("path");
    const { existsSync, readdirSync } = await import("fs");

    const typedArgs = args as Types.IndexAllProjectsArgs;
    const {
      include_codex = true,
      include_claude_code = true,
      codex_path = join(homedir(), ".codex"),
      claude_projects_path = join(homedir(), ".claude", "projects"),
      incremental = true,
    } = typedArgs;

    const globalIndex = new GlobalIndex(this.db);

    try {
      const projects: Array<{
        project_path: string;
        source_type: "claude-code" | "codex";
        message_count: number;
        conversation_count: number;
      }> = [];
      const errors: Array<{ project_path: string; error: string }> = [];
      const claudeProjectsByPath = new Map<string, {
        project_path: string;
        source_type: "claude-code";
        message_count: number;
        conversation_count: number;
        decision_count: number;
        mistake_count: number;
        indexed_folders: Set<string>;
      }>();

      let totalMessages = 0;
      let totalConversations = 0;
      let totalDecisions = 0;
      let totalMistakes = 0;
      let shouldRebuildFts = false;

      const { ConversationStorage } = await import("../storage/ConversationStorage.js");
      const { SemanticSearch } = await import("../search/SemanticSearch.js");
      const { DecisionExtractor } = await import("../parsers/DecisionExtractor.js");
      const { MistakeExtractor } = await import("../parsers/MistakeExtractor.js");
      const { RequirementsExtractor } = await import("../parsers/RequirementsExtractor.js");

      const storage = new ConversationStorage(this.db);
      const semanticSearch = new SemanticSearch(this.db);
      const decisionExtractor = new DecisionExtractor();
      const mistakeExtractor = new MistakeExtractor();
      const requirementsExtractor = new RequirementsExtractor();

      // Index Codex if requested
      if (include_codex && existsSync(codex_path)) {
        try {
          const { CodexConversationParser } = await import("../parsers/CodexConversationParser.js");

          // Get last indexed time for incremental mode (across all codex projects)
          let codexLastIndexedMs: number | undefined;
          if (incremental) {
            const existingCodexProjects = globalIndex.getAllProjects("codex");
            const maxIndexed = existingCodexProjects.reduce(
              (max, project) => Math.max(max, project.last_indexed),
              0
            );
            if (maxIndexed > 0) {
              codexLastIndexedMs = maxIndexed;
            }
          }

          // Parse Codex sessions
          const parser = new CodexConversationParser();
          const parseResult = parser.parseSession(codex_path, undefined, codexLastIndexedMs);

          if (parseResult.messages.length > 0) {
            shouldRebuildFts = true;

            const conversationIdMap = await storage.storeConversations(parseResult.conversations);
            const messageIdMap = await storage.storeMessages(parseResult.messages, {
              skipFtsRebuild: true,
              conversationIdMap,
            });
            const toolUseIdMap = await storage.storeToolUses(parseResult.tool_uses, messageIdMap);
            await storage.storeToolResults(parseResult.tool_results, messageIdMap, toolUseIdMap);
            await storage.storeFileEdits(parseResult.file_edits, conversationIdMap, messageIdMap);
            await storage.storeThinkingBlocks(parseResult.thinking_blocks, messageIdMap);

            const decisions = decisionExtractor.extractDecisions(
              parseResult.messages,
              parseResult.thinking_blocks
            );
            const decisionIdMap = await storage.storeDecisions(decisions, {
              skipFtsRebuild: true,
              conversationIdMap,
              messageIdMap,
            });

            const mistakes = mistakeExtractor.extractMistakes(
              parseResult.messages,
              parseResult.tool_results
            );
            const mistakeIdMap = await storage.storeMistakes(mistakes, conversationIdMap, messageIdMap);

            const requirements = requirementsExtractor.extractRequirements(parseResult.messages);
            await storage.storeRequirements(requirements, conversationIdMap, messageIdMap);

            const validations = requirementsExtractor.extractValidations(
              parseResult.tool_uses,
              parseResult.tool_results,
              parseResult.messages
            );
            await storage.storeValidations(validations, conversationIdMap);

            // Generate embeddings for semantic search
            await generateEmbeddingsForIndexing({
              messages: parseResult.messages,
              decisions,
              mistakes,
              messageIdMap,
              decisionIdMap,
              mistakeIdMap,
              semanticSearch,
              incremental,
              logLabel: "Codex sessions",
            });
          }

          const codexProjectPaths = new Set(parseResult.conversations.map((conv) => conv.project_path));
          for (const projectPath of codexProjectPaths) {
            const stats = storage.getStatsForProject(projectPath, "codex");
            globalIndex.registerProject({
              project_path: projectPath,
              source_type: "codex",
              source_root: codex_path,
              message_count: stats.messages.count,
              conversation_count: stats.conversations.count,
              decision_count: stats.decisions.count,
              mistake_count: stats.mistakes.count,
              metadata: {
                indexed_folders: parseResult.indexed_folders || [],
              },
            });

            projects.push({
              project_path: projectPath,
              source_type: "codex",
              message_count: stats.messages.count,
              conversation_count: stats.conversations.count,
            });

            totalMessages += stats.messages.count;
            totalConversations += stats.conversations.count;
            totalDecisions += stats.decisions.count;
            totalMistakes += stats.mistakes.count;
          }
        } catch (error) {
          errors.push({
            project_path: codex_path,
            error: (error as Error).message,
          });
        }
      }

      // Index Claude Code projects if requested
      if (include_claude_code && existsSync(claude_projects_path)) {
        try {
          const { ConversationParser } = await import("../parsers/ConversationParser.js");
          const { statSync } = await import("fs");

          const projectFolders = readdirSync(claude_projects_path);
          const indexedFolderLastIndexed = new Map<string, number>();

          if (incremental) {
            const existingProjects = globalIndex.getAllProjects("claude-code");
            for (const project of existingProjects) {
              const folders = project.metadata?.indexed_folders;
              if (!Array.isArray(folders)) {
                continue;
              }
              for (const folder of folders) {
                if (typeof folder === "string") {
                  indexedFolderLastIndexed.set(folder, project.last_indexed);
                }
              }
            }
          }

          for (const folder of projectFolders) {
            const folderPath = join(claude_projects_path, folder);

            try {
              // Skip if not a directory
              if (!statSync(folderPath).isDirectory()) {
                continue;
              }

              // Get last indexed time for incremental mode
              let lastIndexedMs: number | undefined;
              if (incremental) {
                const metadataIndexed = indexedFolderLastIndexed.get(folderPath);
                if (metadataIndexed) {
                  lastIndexedMs = metadataIndexed;
                } else {
                  const existingProject = globalIndex.getProject(folderPath, "claude-code");
                  if (existingProject) {
                    lastIndexedMs = existingProject.last_indexed;
                  }
                }
              }

              // Parse Claude Code conversations directly from this folder
              const parser = new ConversationParser();
              const parseResult = parser.parseFromFolder(folderPath, undefined, lastIndexedMs);

              // Skip empty projects
              if (parseResult.messages.length === 0) {
                continue;
              }

              const inferredPath = this.inferProjectPathFromMessages(parseResult.messages);
              const canonicalProjectPath = inferredPath
                ? getCanonicalProjectPath(inferredPath).canonicalPath
                : folderPath;

              if (canonicalProjectPath !== folderPath) {
                for (const conversation of parseResult.conversations) {
                  conversation.project_path = canonicalProjectPath;
                }
              }

              shouldRebuildFts = true;

              const conversationIdMap = await storage.storeConversations(parseResult.conversations);
              const messageIdMap = await storage.storeMessages(parseResult.messages, {
                skipFtsRebuild: true,
                conversationIdMap,
              });
              const toolUseIdMap = await storage.storeToolUses(parseResult.tool_uses, messageIdMap);
              await storage.storeToolResults(parseResult.tool_results, messageIdMap, toolUseIdMap);
              await storage.storeFileEdits(parseResult.file_edits, conversationIdMap, messageIdMap);
              await storage.storeThinkingBlocks(parseResult.thinking_blocks, messageIdMap);

              const decisions = decisionExtractor.extractDecisions(
                parseResult.messages,
                parseResult.thinking_blocks
              );
              const decisionIdMap = await storage.storeDecisions(decisions, {
                skipFtsRebuild: true,
                conversationIdMap,
                messageIdMap,
              });

              const mistakes = mistakeExtractor.extractMistakes(
                parseResult.messages,
                parseResult.tool_results
              );
              const mistakeIdMap = await storage.storeMistakes(mistakes, conversationIdMap, messageIdMap);

              const requirements = requirementsExtractor.extractRequirements(parseResult.messages);
              await storage.storeRequirements(requirements, conversationIdMap, messageIdMap);

              const validations = requirementsExtractor.extractValidations(
                parseResult.tool_uses,
                parseResult.tool_results,
                parseResult.messages
              );
              await storage.storeValidations(validations, conversationIdMap);

              // Generate embeddings for semantic search
              await generateEmbeddingsForIndexing({
                messages: parseResult.messages,
                decisions,
                mistakes,
                messageIdMap,
                decisionIdMap,
                mistakeIdMap,
                semanticSearch,
                incremental,
                logLabel: `project: ${canonicalProjectPath}`,
              });

              const existingAggregate = claudeProjectsByPath.get(canonicalProjectPath);
              const indexedFolders = existingAggregate
                ? existingAggregate.indexed_folders
                : new Set<string>();
              indexedFolders.add(folderPath);

              const stats = storage.getStatsForProject(canonicalProjectPath, "claude-code");

              // Register in global index with the canonical project path
              globalIndex.registerProject({
                project_path: canonicalProjectPath,
                source_type: "claude-code",
                source_root: claude_projects_path,
                message_count: stats.messages.count,
                conversation_count: stats.conversations.count,
                decision_count: stats.decisions.count,
                mistake_count: stats.mistakes.count,
                metadata: {
                  indexed_folders: Array.from(indexedFolders),
                },
              });

              claudeProjectsByPath.set(canonicalProjectPath, {
                project_path: canonicalProjectPath,
                source_type: "claude-code",
                message_count: stats.messages.count,
                conversation_count: stats.conversations.count,
                decision_count: stats.decisions.count,
                mistake_count: stats.mistakes.count,
                indexed_folders: indexedFolders,
              });
            } catch (error) {
              errors.push({
                project_path: folder,
                error: (error as Error).message,
              });
            }
          }
        } catch (error) {
          errors.push({
            project_path: claude_projects_path,
            error: (error as Error).message,
          });
        }
      }

      for (const project of claudeProjectsByPath.values()) {
        projects.push({
          project_path: project.project_path,
          source_type: "claude-code",
          message_count: project.message_count,
          conversation_count: project.conversation_count,
        });
        totalMessages += project.message_count;
        totalConversations += project.conversation_count;
        totalDecisions += project.decision_count;
        totalMistakes += project.mistake_count;
      }

      if (shouldRebuildFts) {
        storage.rebuildAllFts();
      }

      const stats = globalIndex.getGlobalStats();

      return {
        success: true,
        global_index_path: globalIndex.getDbPath(),
        projects_indexed: projects.length,
        claude_code_projects: stats.claude_code_projects,
        codex_projects: stats.codex_projects,
        total_messages: totalMessages,
        total_conversations: totalConversations,
        total_decisions: totalDecisions,
        total_mistakes: totalMistakes,
        projects,
        errors,
        message: `Indexed ${projects.length} project(s): ${stats.claude_code_projects} Claude Code + ${stats.codex_projects} Codex`,
      };
    } finally {
      // Ensure GlobalIndex is always closed
      globalIndex.close();
    }
  }

  /**
   * Search across all indexed projects.
   *
   * @param args - Search arguments
   * @returns Search results from all projects
   */
  async searchAllConversations(
    args: Record<string, unknown>
  ): Promise<Types.SearchAllConversationsResponse> {
    await this.maybeAutoIndex();
    const { GlobalIndex } = await import("../storage/GlobalIndex.js");
    const { SemanticSearch } = await import("../search/SemanticSearch.js");
    const { getEmbeddingGenerator } = await import("../embeddings/EmbeddingGenerator.js");
    const typedArgs = args as unknown as Types.SearchAllConversationsArgs;
    const { query, limit = 20, offset = 0, date_range, source_type = "all" } = typedArgs;

    const globalIndex = new GlobalIndex(this.db);

    try {
      const projects = globalIndex.getAllProjects(
        source_type === "all" ? undefined : source_type
      );

      let queryEmbedding: Float32Array | undefined;
      try {
        const embedder = await getEmbeddingGenerator();
        if (embedder.isAvailable()) {
          queryEmbedding = await embedder.embed(query);
        }
      } catch (_embeddingError) {
        // Fall back to FTS
      }

      const semanticSearch = new SemanticSearch(this.db);
      const localResults = await semanticSearch.searchConversations(
        query,
        limit + offset + 50,
        undefined,
        queryEmbedding
      );

      const filteredResults = localResults.filter((r) => {
        if (date_range) {
          const timestamp = r.message.timestamp;
          if (timestamp < date_range[0] || timestamp > date_range[1]) {
            return false;
          }
        }
        if (source_type !== "all") {
          const resultSource = r.conversation.source_type || "claude-code";
          return resultSource === source_type;
        }
        return true;
      });

      const allResults: Types.GlobalSearchResult[] = [];
      let claudeCodeResults = 0;
      let codexResults = 0;

      for (const result of filteredResults) {
        const source = (result.conversation.source_type || "claude-code") as "claude-code" | "codex";
        allResults.push({
          conversation_id: result.conversation.id,
          message_id: result.message.id,
          timestamp: new Date(result.message.timestamp).toISOString(),
          similarity: result.similarity,
          snippet: result.snippet,
          git_branch: result.conversation.git_branch,
          message_type: result.message.message_type,
          role: result.message.role,
          project_path: result.conversation.project_path,
          source_type: source,
        });

        if (source === "claude-code") {
          claudeCodeResults++;
        } else {
          codexResults++;
        }
      }

      const sortedResults = allResults.sort((a, b) => b.similarity - a.similarity);
      const paginatedResults = sortedResults.slice(offset, offset + limit);

      const successfulProjects = projects.length;
      return {
        query,
        results: paginatedResults,
        total_found: paginatedResults.length,
        has_more: offset + limit < sortedResults.length,
        offset,
        projects_searched: projects.length,
        projects_succeeded: successfulProjects,
        failed_projects: undefined,
        search_stats: {
          claude_code_results: claudeCodeResults,
          codex_results: codexResults,
        },
        message: `Found ${paginatedResults.length} result(s) across ${projects.length} project(s)`,
      };
    } finally {
      // Ensure GlobalIndex is always closed
      globalIndex.close();
    }
  }

  /**
   * Get decisions from all indexed projects.
   *
   * @param args - Query arguments
   * @returns Decisions from all projects
   */
  async getAllDecisions(args: Record<string, unknown>): Promise<Types.GetAllDecisionsResponse> {
    await this.maybeAutoIndex();
    const { GlobalIndex } = await import("../storage/GlobalIndex.js");
    const { SemanticSearch } = await import("../search/SemanticSearch.js");
    const typedArgs = args as unknown as Types.GetAllDecisionsArgs;
    const { query, file_path, limit = 20, offset = 0, source_type = 'all' } = typedArgs;

    const globalIndex = new GlobalIndex(this.db);

    try {
      const projects = globalIndex.getAllProjects(
        source_type === "all" ? undefined : source_type
      );

      const semanticSearch = new SemanticSearch(this.db);
      const searchResults = await semanticSearch.searchDecisions(query, limit + offset + 50);

      const filteredResults = searchResults.filter((r) => {
        if (file_path && !r.decision.related_files.includes(file_path)) {
          return false;
        }
        if (source_type !== "all") {
          const convSource = r.conversation.source_type || "claude-code";
          return convSource === source_type;
        }
        return true;
      });

      const allDecisions: Types.GlobalDecision[] = filteredResults.map((r) => ({
        decision_id: r.decision.id,
        decision_text: r.decision.decision_text,
        rationale: r.decision.rationale,
        alternatives_considered: r.decision.alternatives_considered,
        rejected_reasons: r.decision.rejected_reasons,
        context: r.decision.context,
        related_files: r.decision.related_files,
        related_commits: r.decision.related_commits,
        timestamp: new Date(r.decision.timestamp).toISOString(),
        similarity: r.similarity,
        project_path: r.conversation.project_path,
        source_type: (r.conversation.source_type || "claude-code") as "claude-code" | "codex",
      }));

      const sortedDecisions = allDecisions.sort((a, b) => b.similarity - a.similarity);
      const paginatedDecisions = sortedDecisions.slice(offset, offset + limit);

      return {
        query,
        decisions: paginatedDecisions,
        total_found: paginatedDecisions.length,
        has_more: offset + limit < sortedDecisions.length,
        offset,
        projects_searched: projects.length,
        message: `Found ${paginatedDecisions.length} decision(s) across ${projects.length} project(s)`,
      };
    } finally {
      globalIndex.close();
    }
  }

  /**
   * Search mistakes across all indexed projects.
   *
   * @param args - Search arguments
   * @returns Mistakes from all projects
   */
  async searchAllMistakes(
    args: Record<string, unknown>
  ): Promise<Types.SearchAllMistakesResponse> {
    await this.maybeAutoIndex();
    const { GlobalIndex } = await import("../storage/GlobalIndex.js");
    const { SemanticSearch } = await import("../search/SemanticSearch.js");
    const typedArgs = args as unknown as Types.SearchAllMistakesArgs;
    const { query, mistake_type, limit = 20, offset = 0, source_type = 'all' } = typedArgs;

    const globalIndex = new GlobalIndex(this.db);

    try {
      const projects = globalIndex.getAllProjects(
        source_type === "all" ? undefined : source_type
      );

      interface GlobalMistakeWithSimilarity extends Types.GlobalMistake {
        similarity: number;
      }

      const semanticSearch = new SemanticSearch(this.db);
      const searchResults = await semanticSearch.searchMistakes(query, limit + offset + 50);

      const filteredResults = searchResults.filter((r) => {
        if (mistake_type && r.mistake.mistake_type !== mistake_type) {
          return false;
        }
        if (source_type !== "all") {
          const convSource = r.conversation.source_type || "claude-code";
          return convSource === source_type;
        }
        return true;
      });

      const allMistakes: GlobalMistakeWithSimilarity[] = filteredResults.map((r) => ({
        mistake_id: r.mistake.id,
        mistake_type: r.mistake.mistake_type,
        what_went_wrong: r.mistake.what_went_wrong,
        correction: r.mistake.correction,
        user_correction_message: r.mistake.user_correction_message,
        files_affected: r.mistake.files_affected,
        timestamp: new Date(r.mistake.timestamp).toISOString(),
        project_path: r.conversation.project_path,
        source_type: (r.conversation.source_type || "claude-code") as "claude-code" | "codex",
        similarity: r.similarity,
      }));

      // Sort by similarity (semantic relevance) and paginate
      const sortedMistakes = allMistakes.sort((a, b) => b.similarity - a.similarity);
      const paginatedMistakes = sortedMistakes.slice(offset, offset + limit);

      // Remove similarity from results (not in GlobalMistake type)
      const results: Types.GlobalMistake[] = paginatedMistakes.map(({ similarity: _similarity, ...rest }) => rest);

      return {
        query,
        mistakes: results,
        total_found: results.length,
        has_more: offset + limit < sortedMistakes.length,
        offset,
        projects_searched: projects.length,
        message: `Found ${results.length} mistake(s) across ${projects.length} project(s)`,
      };
    } finally {
      globalIndex.close();
    }
  }

  // ==================== Live Context Layer Tools ====================

  /**
   * Store a fact, decision, or context in working memory.
   *
   * @param args - Remember arguments with key, value, context, tags, ttl
   * @returns The stored memory item
   */
  async remember(args: Record<string, unknown>): Promise<Types.RememberResponse> {
    const { WorkingMemoryStore } = await import("../memory/WorkingMemoryStore.js");
    const typedArgs = args as unknown as Types.RememberArgs;
    const {
      key,
      value,
      context,
      tags,
      ttl,
      project_path,
    } = typedArgs;
    const projectPath = this.resolveProjectPath(project_path);

    if (!key || !value) {
      return {
        success: false,
        message: "key and value are required",
      };
    }

    try {
      const store = new WorkingMemoryStore(this.db.getDatabase());
      const item = store.remember({
        key,
        value,
        context,
        tags,
        ttl,
        projectPath,
      });

      return {
        success: true,
        item: {
          id: item.id,
          key: item.key,
          value: item.value,
          context: item.context,
          tags: item.tags,
          created_at: new Date(item.createdAt).toISOString(),
          updated_at: new Date(item.updatedAt).toISOString(),
          expires_at: item.expiresAt ? new Date(item.expiresAt).toISOString() : undefined,
        },
        message: `Remembered "${key}" successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error storing memory: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Recall a specific memory item by key.
   *
   * @param args - Recall arguments with key
   * @returns The recalled memory item or null
   */
  async recall(args: Record<string, unknown>): Promise<Types.RecallResponse> {
    const { WorkingMemoryStore } = await import("../memory/WorkingMemoryStore.js");
    const typedArgs = args as unknown as Types.RecallArgs;
    const { key, project_path } = typedArgs;
    const projectPath = this.resolveProjectPath(project_path);

    if (!key) {
      return {
        success: false,
        found: false,
        message: "key is required",
      };
    }

    try {
      const store = new WorkingMemoryStore(this.db.getDatabase());
      const item = store.recall(key, projectPath);

      if (!item) {
        return {
          success: true,
          found: false,
          message: `No memory found for key "${key}"`,
        };
      }

      return {
        success: true,
        found: true,
        item: {
          id: item.id,
          key: item.key,
          value: item.value,
          context: item.context,
          tags: item.tags,
          created_at: new Date(item.createdAt).toISOString(),
          updated_at: new Date(item.updatedAt).toISOString(),
          expires_at: item.expiresAt ? new Date(item.expiresAt).toISOString() : undefined,
        },
        message: `Found memory for "${key}"`,
      };
    } catch (error) {
      return {
        success: false,
        found: false,
        message: `Error recalling memory: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Search working memory semantically.
   *
   * @param args - Search arguments with query
   * @returns Relevant memory items
   */
  async recallRelevant(args: Record<string, unknown>): Promise<Types.RecallRelevantResponse> {
    const { WorkingMemoryStore } = await import("../memory/WorkingMemoryStore.js");
    const typedArgs = args as unknown as Types.RecallRelevantArgs;
    const { query, limit = 10, project_path } = typedArgs;
    const projectPath = this.resolveProjectPath(project_path);

    if (!query) {
      return {
        success: false,
        items: [],
        message: "query is required",
      };
    }

    try {
      const store = new WorkingMemoryStore(this.db.getDatabase());
      const results = store.recallRelevant({
        query,
        projectPath,
        limit,
      });

      return {
        success: true,
        items: results.map(item => ({
          id: item.id,
          key: item.key,
          value: item.value,
          context: item.context,
          tags: item.tags,
          similarity: item.similarity,
          created_at: new Date(item.createdAt).toISOString(),
          updated_at: new Date(item.updatedAt).toISOString(),
        })),
        total_found: results.length,
        message: results.length > 0
          ? `Found ${results.length} relevant memory item(s)`
          : "No relevant memories found",
      };
    } catch (error) {
      return {
        success: false,
        items: [],
        message: `Error searching memory: ${(error as Error).message}`,
      };
    }
  }

  /**
   * List all items in working memory.
   *
   * @param args - List arguments with optional tags filter
   * @returns All memory items
   */
  async listMemory(args: Record<string, unknown>): Promise<Types.ListMemoryResponse> {
    const { WorkingMemoryStore } = await import("../memory/WorkingMemoryStore.js");
    const typedArgs = args as Types.ListMemoryArgs;
    const {
      tags,
      limit = 100,
      offset = 0,
      project_path,
    } = typedArgs;
    const projectPath = this.resolveProjectPath(project_path);

    try {
      const store = new WorkingMemoryStore(this.db.getDatabase());
      const items = store.list(projectPath, { tags, limit: limit + 1, offset });
      const hasMore = items.length > limit;
      const results = hasMore ? items.slice(0, limit) : items;
      const totalCount = store.count(projectPath);

      return {
        success: true,
        items: results.map(item => ({
          id: item.id,
          key: item.key,
          value: item.value,
          context: item.context,
          tags: item.tags,
          created_at: new Date(item.createdAt).toISOString(),
          updated_at: new Date(item.updatedAt).toISOString(),
          expires_at: item.expiresAt ? new Date(item.expiresAt).toISOString() : undefined,
        })),
        total_count: totalCount,
        has_more: hasMore,
        offset,
        message: `Listed ${results.length} of ${totalCount} memory item(s)`,
      };
    } catch (error) {
      return {
        success: false,
        items: [],
        total_count: 0,
        has_more: false,
        offset: 0,
        message: `Error listing memory: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Remove a memory item by key.
   *
   * @param args - Forget arguments with key
   * @returns Success status
   */
  async forget(args: Record<string, unknown>): Promise<Types.ForgetResponse> {
    const { WorkingMemoryStore } = await import("../memory/WorkingMemoryStore.js");
    const typedArgs = args as unknown as Types.ForgetArgs;
    const { key, project_path } = typedArgs;
    const projectPath = this.resolveProjectPath(project_path);

    if (!key) {
      return {
        success: false,
        message: "key is required",
      };
    }

    try {
      const store = new WorkingMemoryStore(this.db.getDatabase());
      const deleted = store.forget(key, projectPath);

      return {
        success: deleted,
        message: deleted
          ? `Forgot memory for "${key}"`
          : `No memory found for key "${key}"`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error forgetting memory: ${(error as Error).message}`,
      };
    }
  }

  // ============================================================
  // SESSION HANDOFF TOOLS
  // ============================================================

  /**
   * Prepare a handoff document from the current session.
   * Captures decisions, active files, pending tasks, and working memory.
   *
   * @param args - Handoff preparation arguments
   * @returns The prepared handoff document
   */
  async prepareHandoff(args: Record<string, unknown>): Promise<Types.PrepareHandoffResponse> {
    const { SessionHandoffStore } = await import("../handoff/SessionHandoffStore.js");
    const typedArgs = args as unknown as Types.PrepareHandoffArgs;
    const {
      session_id,
      include = ["decisions", "files", "tasks", "memory"],
      project_path,
    } = typedArgs;
    const projectPath = this.resolveProjectPath(project_path);

    try {
      const store = new SessionHandoffStore(this.db.getDatabase());
      const handoff = store.prepareHandoff({
        sessionId: session_id,
        projectPath,
        include: include as Array<"decisions" | "files" | "tasks" | "memory">,
      });

      return {
        success: true,
        handoff: {
          id: handoff.id,
          from_session_id: handoff.fromSessionId,
          project_path: handoff.projectPath,
          created_at: new Date(handoff.createdAt).toISOString(),
          summary: handoff.contextSummary,
          decisions_count: handoff.decisions.length,
          files_count: handoff.activeFiles.length,
          tasks_count: handoff.pendingTasks.length,
          memory_count: handoff.workingMemory.length,
        },
        message: `Handoff prepared with ${handoff.decisions.length} decisions, ${handoff.activeFiles.length} files, ${handoff.pendingTasks.length} tasks, ${handoff.workingMemory.length} memory items.`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error preparing handoff: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Resume from a handoff in a new session.
   * Loads context from a previous session for continuity.
   *
   * @param args - Resume arguments
   * @returns The resumed handoff context
   */
  async resumeFromHandoff(args: Record<string, unknown>): Promise<Types.ResumeFromHandoffResponse> {
    const { SessionHandoffStore } = await import("../handoff/SessionHandoffStore.js");
    const typedArgs = args as unknown as Types.ResumeFromHandoffArgs;
    const {
      handoff_id,
      new_session_id,
      inject_context = true,
      project_path,
    } = typedArgs;
    const projectPath = this.resolveProjectPath(project_path);

    try {
      const store = new SessionHandoffStore(this.db.getDatabase());
      const handoff = store.resumeFromHandoff({
        handoffId: handoff_id,
        projectPath,
        newSessionId: new_session_id,
        injectContext: inject_context,
      });

      if (!handoff) {
        return {
          success: true,
          found: false,
          message: "No unresumed handoff found for this project.",
        };
      }

      return {
        success: true,
        found: true,
        handoff: {
          id: handoff.id,
          from_session_id: handoff.fromSessionId,
          project_path: handoff.projectPath,
          created_at: new Date(handoff.createdAt).toISOString(),
          summary: handoff.contextSummary,
          decisions: handoff.decisions.map((d) => ({
            text: d.text,
            rationale: d.rationale,
            timestamp: new Date(d.timestamp).toISOString(),
          })),
          active_files: handoff.activeFiles.map((f) => ({
            path: f.path,
            last_action: f.lastAction,
          })),
          pending_tasks: handoff.pendingTasks.map((t) => ({
            description: t.description,
            status: t.status,
          })),
          memory_items: handoff.workingMemory.map((m) => ({
            key: m.key,
            value: m.value,
          })),
        },
        message: `Resumed from handoff: ${handoff.contextSummary}`,
      };
    } catch (error) {
      return {
        success: false,
        found: false,
        message: `Error resuming from handoff: ${(error as Error).message}`,
      };
    }
  }

  /**
   * List available handoffs for a project.
   *
   * @param args - List arguments
   * @returns List of available handoffs
   */
  async listHandoffs(args: Record<string, unknown>): Promise<Types.ListHandoffsResponse> {
    const { SessionHandoffStore } = await import("../handoff/SessionHandoffStore.js");
    const typedArgs = args as unknown as Types.ListHandoffsArgs;
    const {
      limit = 10,
      include_resumed = false,
      project_path,
    } = typedArgs;
    const projectPath = this.resolveProjectPath(project_path);

    try {
      const store = new SessionHandoffStore(this.db.getDatabase());
      const handoffs = store.listHandoffs(projectPath, {
        limit,
        includeResumed: include_resumed,
      });

      return {
        success: true,
        handoffs: handoffs.map((h) => ({
          id: h.id,
          from_session_id: h.fromSessionId,
          created_at: new Date(h.createdAt).toISOString(),
          resumed_by: h.resumedBy,
          resumed_at: h.resumedAt ? new Date(h.resumedAt).toISOString() : undefined,
          summary: h.summary,
        })),
        total_count: handoffs.length,
        message: `Found ${handoffs.length} handoff(s)`,
      };
    } catch (error) {
      return {
        success: false,
        handoffs: [],
        total_count: 0,
        message: `Error listing handoffs: ${(error as Error).message}`,
      };
    }
  }

  // ============================================================
  // CONTEXT INJECTION TOOLS
  // ============================================================

  /**
   * Get context to inject at the start of a new conversation.
   * Combines handoffs, decisions, working memory, and file history.
   *
   * @param args - Context injection arguments
   * @returns Structured context for injection
   */
  async getStartupContext(args: Record<string, unknown>): Promise<Types.GetStartupContextResponse> {
    const { ContextInjector } = await import("../context/ContextInjector.js");
    const typedArgs = args as unknown as Types.GetStartupContextArgs;
    const {
      query,
      max_tokens = 2000,
      sources = ["history", "decisions", "memory", "handoffs"],
      project_path,
    } = typedArgs;
    const projectPath = this.resolveProjectPath(project_path);

    try {
      const injector = new ContextInjector(this.db.getDatabase());
      const context = await injector.getRelevantContext({
        query,
        projectPath,
        maxTokens: max_tokens,
        sources: sources as Array<"history" | "decisions" | "memory" | "handoffs">,
      });

      return {
        success: true,
        context: {
          handoff: context.handoff ? {
            id: context.handoff.id,
            from_session_id: context.handoff.fromSessionId,
            project_path: context.handoff.projectPath,
            created_at: new Date(context.handoff.createdAt).toISOString(),
            summary: context.handoff.contextSummary,
            decisions: context.handoff.decisions.map(d => ({
              text: d.text,
              rationale: d.rationale,
              timestamp: new Date(d.timestamp).toISOString(),
            })),
            active_files: context.handoff.activeFiles.map(f => ({
              path: f.path,
              last_action: f.lastAction,
            })),
            pending_tasks: context.handoff.pendingTasks.map(t => ({
              description: t.description,
              status: t.status,
            })),
            memory_items: context.handoff.workingMemory.map(m => ({
              key: m.key,
              value: m.value,
            })),
          } : undefined,
          decisions: context.decisions.map(d => ({
            id: d.id,
            text: d.text,
            rationale: d.rationale,
            timestamp: new Date(d.timestamp).toISOString(),
          })),
          memory: context.memory.map(m => ({
            id: m.id,
            key: m.key,
            value: m.value,
            context: m.context,
            tags: m.tags,
            created_at: new Date(m.createdAt).toISOString(),
            updated_at: new Date(m.updatedAt).toISOString(),
          })),
          recent_files: context.recentFiles.map(f => ({
            path: f.path,
            last_action: f.lastAction,
            timestamp: new Date(f.timestamp).toISOString(),
          })),
          summary: context.summary,
        },
        token_estimate: context.tokenEstimate,
        message: `Retrieved context: ${context.summary}`,
      };
    } catch (error) {
      return {
        success: false,
        context: {
          decisions: [],
          memory: [],
          recent_files: [],
          summary: "",
        },
        token_estimate: 0,
        message: `Error getting startup context: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Inject relevant context based on the first message in a new conversation.
   * Returns formatted markdown context for direct use.
   *
   * @param args - Injection arguments
   * @returns Formatted context string
   */
  async injectRelevantContext(args: Record<string, unknown>): Promise<Types.InjectRelevantContextResponse> {
    const { ContextInjector } = await import("../context/ContextInjector.js");
    const typedArgs = args as unknown as Types.InjectRelevantContextArgs;
    const {
      message,
      max_tokens = 2000,
      sources = ["history", "decisions", "memory", "handoffs"],
      project_path,
    } = typedArgs;
    const projectPath = this.resolveProjectPath(project_path);

    if (!message) {
      return {
        success: false,
        injected_context: "",
        sources_used: [],
        token_count: 0,
        message: "message is required",
      };
    }

    try {
      const injector = new ContextInjector(this.db.getDatabase());
      const context = await injector.getRelevantContext({
        query: message,
        projectPath,
        maxTokens: max_tokens,
        sources: sources as Array<"history" | "decisions" | "memory" | "handoffs">,
      });

      // Format for injection
      const formattedContext = injector.formatForInjection(context);

      // Track which sources were used
      const sourcesUsed: string[] = [];
      if (context.handoff) {
        sourcesUsed.push("handoffs");
      }
      if (context.decisions.length > 0) {
        sourcesUsed.push("decisions");
      }
      if (context.memory.length > 0) {
        sourcesUsed.push("memory");
      }
      if (context.recentFiles.length > 0) {
        sourcesUsed.push("history");
      }

      return {
        success: true,
        injected_context: formattedContext,
        sources_used: sourcesUsed,
        token_count: context.tokenEstimate,
        message: `Injected context from ${sourcesUsed.length} source(s)`,
      };
    } catch (error) {
      return {
        success: false,
        injected_context: "",
        sources_used: [],
        token_count: 0,
        message: `Error injecting context: ${(error as Error).message}`,
      };
    }
  }

  // ==================== Phase 1: Tag Management Handlers ====================

  /**
   * List all tags with usage statistics
   */
  async listTags(args: Record<string, unknown>): Promise<Types.ListTagsResponse> {
    const typedArgs = args as Types.ListTagsArgs;
    const {
      scope = "all",
      sort_by = "usage_count",
      include_unused = false,
      limit = 50,
      offset = 0,
    } = typedArgs;
    const projectPath = this.resolveOptionalProjectPath(typedArgs.project_path);

    try {
      let query = `
        SELECT
          id, name, project_path, description, color,
          created_at, updated_at, usage_count, last_used_at, used_in_types
        FROM tag_stats
        WHERE 1=1
      `;
      const params: unknown[] = [];

      // Scope filtering
      if (scope === "project" && projectPath) {
        query += " AND project_path = ?";
        params.push(projectPath);
      } else if (scope === "global") {
        query += " AND project_path IS NULL";
      } else if (scope === "all" && projectPath) {
        query += " AND (project_path = ? OR project_path IS NULL)";
        params.push(projectPath);
      }

      // Include unused filter
      if (!include_unused) {
        query += " AND usage_count > 0";
      }

      // Sorting
      const sortMap: Record<string, string> = {
        name: "name ASC",
        usage_count: "usage_count DESC",
        last_used: "last_used_at DESC NULLS LAST",
        created: "created_at DESC",
      };
      query += ` ORDER BY ${sortMap[sort_by] || "usage_count DESC"}`;

      // Pagination with fetch+1 pattern
      query += " LIMIT ? OFFSET ?";
      params.push(limit + 1, offset);

      const rows = this.db.prepare(query).all(...params) as Array<{
        id: number;
        name: string;
        project_path: string | null;
        description: string | null;
        color: string | null;
        created_at: number;
        updated_at: number;
        usage_count: number;
        last_used_at: number | null;
        used_in_types: string | null;
      }>;

      const hasMore = rows.length > limit;
      const tags = rows.slice(0, limit).map((row) => ({
        id: row.id,
        name: row.name,
        project_path: row.project_path,
        description: row.description,
        color: row.color,
        usage_count: row.usage_count,
        last_used_at: row.last_used_at,
        used_in_types: row.used_in_types ? row.used_in_types.split(",") : [],
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));

      // Get total count
      let countQuery = "SELECT COUNT(*) as total FROM tag_stats WHERE 1=1";
      const countParams: unknown[] = [];
      if (scope === "project" && projectPath) {
        countQuery += " AND project_path = ?";
        countParams.push(projectPath);
      } else if (scope === "global") {
        countQuery += " AND project_path IS NULL";
      } else if (scope === "all" && projectPath) {
        countQuery += " AND (project_path = ? OR project_path IS NULL)";
        countParams.push(projectPath);
      }
      if (!include_unused) {
        countQuery += " AND usage_count > 0";
      }
      const countResult = this.db.prepare(countQuery).get(...countParams) as { total: number };

      return {
        success: true,
        tags,
        total: countResult.total,
        hasMore,
        message: `Found ${tags.length} tag(s)`,
      };
    } catch (error) {
      return {
        success: false,
        tags: [],
        total: 0,
        hasMore: false,
        message: `Error listing tags: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Search items by tags
   */
  async searchByTags(args: Record<string, unknown>): Promise<Types.SearchByTagsResponse> {
    const typedArgs = args as unknown as Types.SearchByTagsArgs;
    const {
      tags,
      match_mode = "any",
      item_types,
      scope = "all",
      limit = 20,
      offset = 0,
    } = typedArgs;
    const projectPath = this.resolveOptionalProjectPath(typedArgs.project_path);

    if (!tags || tags.length === 0) {
      return {
        success: false,
        items: [],
        total: 0,
        hasMore: false,
        tag_breakdown: {},
        message: "At least one tag is required",
      };
    }

    try {
      // Find tag IDs
      const tagPlaceholders = tags.map(() => "?").join(",");
      let tagQuery = `SELECT id, name FROM tags WHERE name IN (${tagPlaceholders})`;
      const tagParams: unknown[] = [...tags];

      if (scope === "project" && projectPath) {
        tagQuery += " AND project_path = ?";
        tagParams.push(projectPath);
      } else if (scope === "global") {
        tagQuery += " AND project_path IS NULL";
      } else if (scope === "all" && projectPath) {
        tagQuery += " AND (project_path = ? OR project_path IS NULL)";
        tagParams.push(projectPath);
      }

      const tagRows = this.db.prepare(tagQuery).all(...tagParams) as Array<{ id: number; name: string }>;
      const tagIds = tagRows.map((r) => r.id);
      const tagIdToName = new Map(tagRows.map((r) => [r.id, r.name]));

      if (tagIds.length === 0) {
        return {
          success: true,
          items: [],
          total: 0,
          hasMore: false,
          tag_breakdown: {},
          message: "No matching tags found",
        };
      }

      // Find items with those tags
      const tagIdPlaceholders = tagIds.map(() => "?").join(",");
      let itemQuery = `
        SELECT it.item_type, it.item_id, it.tag_id, it.created_at
        FROM item_tags it
        WHERE it.tag_id IN (${tagIdPlaceholders})
      `;
      const itemParams: unknown[] = [...tagIds];

      if (item_types && item_types.length > 0) {
        const typePlaceholders = item_types.map(() => "?").join(",");
        itemQuery += ` AND it.item_type IN (${typePlaceholders})`;
        itemParams.push(...item_types);
      }

      const itemRows = this.db.prepare(itemQuery).all(...itemParams) as Array<{
        item_type: string;
        item_id: number;
        tag_id: number;
        created_at: number;
      }>;

      // Group by item
      const itemMap = new Map<string, {
        item_type: string;
        item_id: number;
        matched_tags: Set<string>;
        created_at: number;
      }>();

      for (const row of itemRows) {
        const key = `${row.item_type}:${row.item_id}`;
        if (!itemMap.has(key)) {
          itemMap.set(key, {
            item_type: row.item_type,
            item_id: row.item_id,
            matched_tags: new Set(),
            created_at: row.created_at,
          });
        }
        const tagName = tagIdToName.get(row.tag_id);
        const item = itemMap.get(key);
        if (tagName && item) {
          item.matched_tags.add(tagName);
        }
      }

      // Filter by match_mode
      let filteredItems = Array.from(itemMap.values());
      if (match_mode === "all") {
        filteredItems = filteredItems.filter((item) => item.matched_tags.size === tags.length);
      }

      // Calculate tag breakdown
      const tagBreakdown: Record<string, number> = {};
      for (const item of filteredItems) {
        for (const tag of item.matched_tags) {
          tagBreakdown[tag] = (tagBreakdown[tag] || 0) + 1;
        }
      }

      const total = filteredItems.length;
      const hasMore = offset + limit < total;
      const paginatedItems = filteredItems.slice(offset, offset + limit);

      // Get summaries for items (simplified - just use item_id for now)
      const items: Types.TaggedItem[] = paginatedItems.map((item) => ({
        item_type: item.item_type as Types.TagItemType,
        item_id: item.item_id,
        item_summary: `${item.item_type} #${item.item_id}`,
        matched_tags: Array.from(item.matched_tags),
        all_tags: Array.from(item.matched_tags),
        created_at: item.created_at,
      }));

      return {
        success: true,
        items,
        total,
        hasMore,
        tag_breakdown: tagBreakdown,
        message: `Found ${total} item(s) with matching tags`,
      };
    } catch (error) {
      return {
        success: false,
        items: [],
        total: 0,
        hasMore: false,
        tag_breakdown: {},
        message: `Error searching by tags: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Rename a tag
   */
  async renameTag(args: Record<string, unknown>): Promise<Types.RenameTagResponse> {
    const typedArgs = args as unknown as Types.RenameTagArgs;
    const { old_name, new_name, scope = "project" } = typedArgs;
    const projectPath = this.resolveOptionalProjectPath(typedArgs.project_path);

    if (!old_name || !new_name) {
      return {
        success: false,
        old_name: old_name || "",
        new_name: new_name || "",
        items_affected: 0,
        merged: false,
        message: "Both old_name and new_name are required",
      };
    }

    try {
      return this.db.transaction(() => {
        // Find the old tag
        let findQuery = "SELECT id FROM tags WHERE name = ?";
        const findParams: unknown[] = [old_name];
        if (scope === "project" && projectPath) {
          findQuery += " AND project_path = ?";
          findParams.push(projectPath);
        } else if (scope === "global") {
          findQuery += " AND project_path IS NULL";
        }

        const oldTag = this.db.prepare(findQuery).get(...findParams) as { id: number } | undefined;
        if (!oldTag) {
          return {
            success: false,
            old_name,
            new_name,
            items_affected: 0,
            merged: false,
            message: `Tag '${old_name}' not found`,
          };
        }

        // Check if new name already exists
        let existsQuery = "SELECT id FROM tags WHERE name = ?";
        const existsParams: unknown[] = [new_name];
        if (scope === "project" && projectPath) {
          existsQuery += " AND project_path = ?";
          existsParams.push(projectPath);
        } else if (scope === "global") {
          existsQuery += " AND project_path IS NULL";
        }

        const existingTag = this.db.prepare(existsQuery).get(...existsParams) as { id: number } | undefined;

        if (existingTag) {
          // Merge: move items from old tag to existing tag
          const countResult = this.db.prepare(
            "SELECT COUNT(*) as count FROM item_tags WHERE tag_id = ?"
          ).get(oldTag.id) as { count: number };

          // Update item_tags, ignoring duplicates
          this.db.prepare(`
            UPDATE OR IGNORE item_tags SET tag_id = ? WHERE tag_id = ?
          `).run(existingTag.id, oldTag.id);

          // Delete items that couldn't be moved (duplicates)
          this.db.prepare("DELETE FROM item_tags WHERE tag_id = ?").run(oldTag.id);

          // Delete old tag
          this.db.prepare("DELETE FROM tags WHERE id = ?").run(oldTag.id);

          return {
            success: true,
            old_name,
            new_name,
            items_affected: countResult.count,
            merged: true,
            message: `Merged '${old_name}' into existing tag '${new_name}'`,
          };
        } else {
          // Simple rename
          const countResult = this.db.prepare(
            "SELECT COUNT(*) as count FROM item_tags WHERE tag_id = ?"
          ).get(oldTag.id) as { count: number };

          this.db.prepare("UPDATE tags SET name = ?, updated_at = ? WHERE id = ?")
            .run(new_name, Date.now(), oldTag.id);

          return {
            success: true,
            old_name,
            new_name,
            items_affected: countResult.count,
            merged: false,
            message: `Renamed tag '${old_name}' to '${new_name}'`,
          };
        }
      });
    } catch (error) {
      return {
        success: false,
        old_name,
        new_name,
        items_affected: 0,
        merged: false,
        message: `Error renaming tag: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Merge multiple tags into one
   */
  async mergeTags(args: Record<string, unknown>): Promise<Types.MergeTagsResponse> {
    const typedArgs = args as unknown as Types.MergeTagsArgs;
    const { source_tags, target_tag, scope = "project" } = typedArgs;
    const projectPath = this.resolveOptionalProjectPath(typedArgs.project_path);

    if (!source_tags || source_tags.length === 0 || !target_tag) {
      return {
        success: false,
        merged_tags: [],
        target_tag: target_tag || "",
        items_retagged: 0,
        duplicates_removed: 0,
        message: "source_tags and target_tag are required",
      };
    }

    try {
      return this.db.transaction(() => {
        const projectCondition = scope === "project" && projectPath
          ? "AND project_path = ?"
          : scope === "global"
            ? "AND project_path IS NULL"
            : "";
        const baseParams = scope === "project" && projectPath ? [projectPath] : [];

        // Find or create target tag
        let targetTagId: number;
        const existingTarget = this.db.prepare(
          `SELECT id FROM tags WHERE name = ? ${projectCondition}`
        ).get(target_tag, ...baseParams) as { id: number } | undefined;

        if (existingTarget) {
          targetTagId = existingTarget.id;
        } else {
          // Create target tag
          const result = this.db.prepare(
            "INSERT INTO tags (name, project_path, created_at, updated_at) VALUES (?, ?, ?, ?)"
          ).run(target_tag, scope === "global" ? null : projectPath, Date.now(), Date.now());
          targetTagId = Number(result.lastInsertRowid);
        }

        // Find source tags
        const sourcePlaceholders = source_tags.map(() => "?").join(",");
        const sourceTagRows = this.db.prepare(
          `SELECT id, name FROM tags WHERE name IN (${sourcePlaceholders}) ${projectCondition}`
        ).all(...source_tags, ...baseParams) as Array<{ id: number; name: string }>;

        const mergedTags: string[] = [];
        let itemsRetagged = 0;
        let duplicatesRemoved = 0;

        for (const sourceTag of sourceTagRows) {
          if (sourceTag.id === targetTagId) {continue;}

          // Count items before
          const countBefore = this.db.prepare(
            "SELECT COUNT(*) as count FROM item_tags WHERE tag_id = ?"
          ).get(sourceTag.id) as { count: number };

          // Move items to target (ignore duplicates)
          this.db.prepare(
            "UPDATE OR IGNORE item_tags SET tag_id = ? WHERE tag_id = ?"
          ).run(targetTagId, sourceTag.id);

          // Count remaining (duplicates)
          const remaining = this.db.prepare(
            "SELECT COUNT(*) as count FROM item_tags WHERE tag_id = ?"
          ).get(sourceTag.id) as { count: number };

          // Delete remaining duplicates
          this.db.prepare("DELETE FROM item_tags WHERE tag_id = ?").run(sourceTag.id);

          // Delete source tag
          this.db.prepare("DELETE FROM tags WHERE id = ?").run(sourceTag.id);

          mergedTags.push(sourceTag.name);
          itemsRetagged += countBefore.count - remaining.count;
          duplicatesRemoved += remaining.count;
        }

        return {
          success: true,
          merged_tags: mergedTags,
          target_tag,
          items_retagged: itemsRetagged,
          duplicates_removed: duplicatesRemoved,
          message: `Merged ${mergedTags.length} tag(s) into '${target_tag}'`,
        };
      });
    } catch (error) {
      return {
        success: false,
        merged_tags: [],
        target_tag,
        items_retagged: 0,
        duplicates_removed: 0,
        message: `Error merging tags: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Delete a tag
   */
  async deleteTag(args: Record<string, unknown>): Promise<Types.DeleteTagResponse> {
    const typedArgs = args as unknown as Types.DeleteTagArgs;
    const { name, scope = "project", force = false } = typedArgs;
    const projectPath = this.resolveOptionalProjectPath(typedArgs.project_path);

    if (!name) {
      return {
        success: false,
        deleted: false,
        items_untagged: 0,
        message: "Tag name is required",
      };
    }

    try {
      return this.db.transaction(() => {
        const projectCondition = scope === "project" && projectPath
          ? "AND project_path = ?"
          : scope === "global"
            ? "AND project_path IS NULL"
            : "";
        const baseParams = scope === "project" && projectPath ? [projectPath] : [];

        // Find tag
        const tag = this.db.prepare(
          `SELECT id FROM tags WHERE name = ? ${projectCondition}`
        ).get(name, ...baseParams) as { id: number } | undefined;

        if (!tag) {
          return {
            success: false,
            deleted: false,
            items_untagged: 0,
            message: `Tag '${name}' not found`,
          };
        }

        // Check usage
        const usageResult = this.db.prepare(
          "SELECT COUNT(*) as count FROM item_tags WHERE tag_id = ?"
        ).get(tag.id) as { count: number };

        if (usageResult.count > 0 && !force) {
          return {
            success: false,
            deleted: false,
            items_untagged: 0,
            message: `Tag '${name}' has ${usageResult.count} usage(s). Use force=true to delete anyway.`,
          };
        }

        // Delete item_tags (cascades from tags table, but explicit is safer)
        this.db.prepare("DELETE FROM item_tags WHERE tag_id = ?").run(tag.id);

        // Delete tag
        this.db.prepare("DELETE FROM tags WHERE id = ?").run(tag.id);

        return {
          success: true,
          deleted: true,
          items_untagged: usageResult.count,
          message: `Deleted tag '${name}'${usageResult.count > 0 ? ` (${usageResult.count} item(s) untagged)` : ""}`,
        };
      });
    } catch (error) {
      return {
        success: false,
        deleted: false,
        items_untagged: 0,
        message: `Error deleting tag: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Add tags to an item
   */
  async tagItem(args: Record<string, unknown>): Promise<Types.TagItemResponse> {
    const typedArgs = args as unknown as Types.TagItemArgs;
    const { item_type, item_id, tags } = typedArgs;
    const projectPath = this.resolveProjectPath(typedArgs.project_path);

    if (!item_type || item_id === undefined || !tags || tags.length === 0) {
      return {
        success: false,
        item_type: item_type || ("memory" as Types.TagItemType),
        item_id: item_id || 0,
        tags_added: [],
        tags_existed: [],
        message: "item_type, item_id, and tags are required",
      };
    }

    try {
      return this.db.transaction(() => {
        const tagsAdded: string[] = [];
        const tagsExisted: string[] = [];

        for (const tagName of tags) {
          // Find or create tag
          let tag = this.db.prepare(
            "SELECT id FROM tags WHERE name = ? AND (project_path = ? OR project_path IS NULL)"
          ).get(tagName, projectPath) as { id: number } | undefined;

          if (!tag) {
            const result = this.db.prepare(
              "INSERT INTO tags (name, project_path, created_at, updated_at) VALUES (?, ?, ?, ?)"
            ).run(tagName, projectPath, Date.now(), Date.now());
            tag = { id: Number(result.lastInsertRowid) };
          }

          // Try to add item_tag
          const itemIdNum = typeof item_id === "string" ? 0 : item_id; // For memory, we need to resolve key to id
          try {
            this.db.prepare(
              "INSERT INTO item_tags (tag_id, item_type, item_id, created_at) VALUES (?, ?, ?, ?)"
            ).run(tag.id, item_type, itemIdNum, Date.now());
            tagsAdded.push(tagName);
          } catch (_e) {
            // Duplicate - tag already exists on item
            tagsExisted.push(tagName);
          }
        }

        return {
          success: true,
          item_type,
          item_id,
          tags_added: tagsAdded,
          tags_existed: tagsExisted,
          message: `Added ${tagsAdded.length} tag(s), ${tagsExisted.length} already existed`,
        };
      });
    } catch (error) {
      return {
        success: false,
        item_type,
        item_id,
        tags_added: [],
        tags_existed: [],
        message: `Error tagging item: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Remove tags from an item
   */
  async untagItem(args: Record<string, unknown>): Promise<Types.UntagItemResponse> {
    const typedArgs = args as unknown as Types.UntagItemArgs;
    const { item_type, item_id, tags } = typedArgs;
    const projectPath = this.resolveProjectPath(typedArgs.project_path);

    if (!item_type || item_id === undefined) {
      return {
        success: false,
        item_type: item_type || ("memory" as Types.TagItemType),
        item_id: item_id || 0,
        tags_removed: [],
        message: "item_type and item_id are required",
      };
    }

    try {
      return this.db.transaction(() => {
        const itemIdNum = typeof item_id === "string" ? 0 : item_id;
        const tagsRemoved: string[] = [];

        if (tags && tags.length > 0) {
          // Remove specific tags
          for (const tagName of tags) {
            const tag = this.db.prepare(
              "SELECT id FROM tags WHERE name = ? AND (project_path = ? OR project_path IS NULL)"
            ).get(tagName, projectPath) as { id: number } | undefined;

            if (tag) {
              const result = this.db.prepare(
                "DELETE FROM item_tags WHERE tag_id = ? AND item_type = ? AND item_id = ?"
              ).run(tag.id, item_type, itemIdNum);
              if (result.changes > 0) {
                tagsRemoved.push(tagName);
              }
            }
          }
        } else {
          // Remove all tags from item
          const currentTags = this.db.prepare(`
            SELECT t.name FROM tags t
            JOIN item_tags it ON t.id = it.tag_id
            WHERE it.item_type = ? AND it.item_id = ?
          `).all(item_type, itemIdNum) as Array<{ name: string }>;

          this.db.prepare(
            "DELETE FROM item_tags WHERE item_type = ? AND item_id = ?"
          ).run(item_type, itemIdNum);

          tagsRemoved.push(...currentTags.map((t) => t.name));
        }

        return {
          success: true,
          item_type,
          item_id,
          tags_removed: tagsRemoved,
          message: `Removed ${tagsRemoved.length} tag(s)`,
        };
      });
    } catch (error) {
      return {
        success: false,
        item_type,
        item_id,
        tags_removed: [],
        message: `Error untagging item: ${(error as Error).message}`,
      };
    }
  }

  // ==================== Phase 1: Memory Confidence Handlers ====================

  /**
   * Set memory confidence level
   */
  async setMemoryConfidence(args: Record<string, unknown>): Promise<Types.SetMemoryConfidenceResponse> {
    const typedArgs = args as unknown as Types.SetMemoryConfidenceArgs;
    const { key, confidence, evidence, verified_by } = typedArgs;
    const projectPath = this.resolveProjectPath(typedArgs.project_path);

    if (!key || !confidence) {
      return {
        success: false,
        key: key || "",
        previous_confidence: null,
        new_confidence: confidence || "",
        verified_at: null,
        message: "key and confidence are required",
      };
    }

    try {
      // Get current memory
      const memory = this.db.prepare(
        "SELECT id, confidence FROM working_memory WHERE key = ? AND project_path = ?"
      ).get(key, projectPath) as { id: number; confidence: string | null } | undefined;

      if (!memory) {
        return {
          success: false,
          key,
          previous_confidence: null,
          new_confidence: confidence,
          verified_at: null,
          message: `Memory '${key}' not found`,
        };
      }

      const now = Date.now();
      const verifiedAt = (confidence === "confirmed" || confidence === "verified") ? now : null;

      // Update memory
      let updateQuery = "UPDATE working_memory SET confidence = ?, updated_at = ?";
      const updateParams: unknown[] = [confidence, now];

      if (verifiedAt) {
        updateQuery += ", verified_at = ?";
        updateParams.push(verifiedAt);
      }
      if (verified_by) {
        updateQuery += ", verified_by = ?";
        updateParams.push(verified_by);
      }
      if (evidence) {
        updateQuery += ", context = COALESCE(context, '') || ' | Evidence: ' || ?";
        updateParams.push(evidence);
      }

      updateQuery += " WHERE id = ?";
      updateParams.push(memory.id);

      this.db.prepare(updateQuery).run(...updateParams);

      return {
        success: true,
        key,
        previous_confidence: memory.confidence,
        new_confidence: confidence,
        verified_at: verifiedAt,
        message: `Updated confidence to '${confidence}'${verifiedAt ? " (verified)" : ""}`,
      };
    } catch (error) {
      return {
        success: false,
        key,
        previous_confidence: null,
        new_confidence: confidence,
        verified_at: null,
        message: `Error setting confidence: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Set memory importance level
   */
  async setMemoryImportance(args: Record<string, unknown>): Promise<Types.SetMemoryImportanceResponse> {
    const typedArgs = args as unknown as Types.SetMemoryImportanceArgs;
    const { key, importance } = typedArgs;
    const projectPath = this.resolveProjectPath(typedArgs.project_path);

    if (!key || !importance) {
      return {
        success: false,
        key: key || "",
        previous_importance: null,
        new_importance: importance || "",
        message: "key and importance are required",
      };
    }

    try {
      const memory = this.db.prepare(
        "SELECT id, importance FROM working_memory WHERE key = ? AND project_path = ?"
      ).get(key, projectPath) as { id: number; importance: string | null } | undefined;

      if (!memory) {
        return {
          success: false,
          key,
          previous_importance: null,
          new_importance: importance,
          message: `Memory '${key}' not found`,
        };
      }

      this.db.prepare(
        "UPDATE working_memory SET importance = ?, updated_at = ? WHERE id = ?"
      ).run(importance, Date.now(), memory.id);

      return {
        success: true,
        key,
        previous_importance: memory.importance,
        new_importance: importance,
        message: `Updated importance to '${importance}'`,
      };
    } catch (error) {
      return {
        success: false,
        key,
        previous_importance: null,
        new_importance: importance,
        message: `Error setting importance: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Pin/unpin a memory
   */
  async pinMemory(args: Record<string, unknown>): Promise<Types.PinMemoryResponse> {
    const typedArgs = args as unknown as Types.PinMemoryArgs;
    const { key, pinned = true } = typedArgs;
    const projectPath = this.resolveProjectPath(typedArgs.project_path);

    if (!key) {
      return {
        success: false,
        key: "",
        pinned: false,
        message: "key is required",
      };
    }

    try {
      const result = this.db.prepare(
        "UPDATE working_memory SET pinned = ?, updated_at = ? WHERE key = ? AND project_path = ?"
      ).run(pinned ? 1 : 0, Date.now(), key, projectPath);

      if (result.changes === 0) {
        return {
          success: false,
          key,
          pinned: false,
          message: `Memory '${key}' not found`,
        };
      }

      return {
        success: true,
        key,
        pinned,
        message: pinned ? `Pinned memory '${key}'` : `Unpinned memory '${key}'`,
      };
    } catch (error) {
      return {
        success: false,
        key,
        pinned: false,
        message: `Error pinning memory: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Archive a memory
   */
  async archiveMemory(args: Record<string, unknown>): Promise<Types.ArchiveMemoryResponse> {
    const typedArgs = args as unknown as Types.ArchiveMemoryArgs;
    const { key, reason } = typedArgs;
    const projectPath = this.resolveProjectPath(typedArgs.project_path);

    if (!key) {
      return {
        success: false,
        key: "",
        archived: false,
        reason: null,
        message: "key is required",
      };
    }

    try {
      const result = this.db.prepare(
        "UPDATE working_memory SET archived = 1, archive_reason = ?, updated_at = ? WHERE key = ? AND project_path = ?"
      ).run(reason || null, Date.now(), key, projectPath);

      if (result.changes === 0) {
        return {
          success: false,
          key,
          archived: false,
          reason: null,
          message: `Memory '${key}' not found`,
        };
      }

      return {
        success: true,
        key,
        archived: true,
        reason: reason || null,
        message: `Archived memory '${key}'${reason ? `: ${reason}` : ""}`,
      };
    } catch (error) {
      return {
        success: false,
        key,
        archived: false,
        reason: null,
        message: `Error archiving memory: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Unarchive a memory
   */
  async unarchiveMemory(args: Record<string, unknown>): Promise<Types.UnarchiveMemoryResponse> {
    const typedArgs = args as unknown as Types.UnarchiveMemoryArgs;
    const { key } = typedArgs;
    const projectPath = this.resolveProjectPath(typedArgs.project_path);

    if (!key) {
      return {
        success: false,
        key: "",
        message: "key is required",
      };
    }

    try {
      const result = this.db.prepare(
        "UPDATE working_memory SET archived = 0, archive_reason = NULL, updated_at = ? WHERE key = ? AND project_path = ?"
      ).run(Date.now(), key, projectPath);

      if (result.changes === 0) {
        return {
          success: false,
          key,
          message: `Memory '${key}' not found`,
        };
      }

      return {
        success: true,
        key,
        message: `Unarchived memory '${key}'`,
      };
    } catch (error) {
      return {
        success: false,
        key,
        message: `Error unarchiving memory: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Search memories by quality filters
   */
  async searchMemoryByQuality(args: Record<string, unknown>): Promise<Types.SearchMemoryByQualityResponse> {
    const typedArgs = args as Types.SearchMemoryByQualityArgs;
    const {
      query,
      confidence,
      importance,
      pinned_only = false,
      include_archived = false,
      scope = "project",
      sort_by = "importance",
      limit = 20,
      offset = 0,
    } = typedArgs;
    const projectPath = this.resolveProjectPath(typedArgs.project_path);

    try {
      let sqlQuery = "SELECT * FROM working_memory WHERE 1=1";
      const params: unknown[] = [];

      // Project/scope filter
      if (scope === "project") {
        sqlQuery += " AND project_path = ?";
        params.push(projectPath);
      }

      // Archived filter
      if (!include_archived) {
        sqlQuery += " AND (archived = 0 OR archived IS NULL)";
      }

      // Pinned filter
      if (pinned_only) {
        sqlQuery += " AND pinned = 1";
      }

      // Confidence filter
      if (confidence && confidence.length > 0) {
        const placeholders = confidence.map(() => "?").join(",");
        sqlQuery += ` AND confidence IN (${placeholders})`;
        params.push(...confidence);
      }

      // Importance filter
      if (importance && importance.length > 0) {
        const placeholders = importance.map(() => "?").join(",");
        sqlQuery += ` AND importance IN (${placeholders})`;
        params.push(...importance);
      }

      // Text search
      if (query) {
        sqlQuery += " AND (key LIKE ? OR value LIKE ? OR context LIKE ?)";
        const searchTerm = `%${query}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      // Sorting
      const sortMap: Record<string, string> = {
        relevance: "updated_at DESC",
        importance: "CASE importance WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, updated_at DESC",
        confidence: "CASE confidence WHEN 'verified' THEN 1 WHEN 'confirmed' THEN 2 WHEN 'likely' THEN 3 WHEN 'uncertain' THEN 4 ELSE 5 END, updated_at DESC",
        recent: "updated_at DESC",
      };
      sqlQuery += ` ORDER BY ${sortMap[sort_by] || "updated_at DESC"}`;

      // Pagination
      sqlQuery += " LIMIT ? OFFSET ?";
      params.push(limit + 1, offset);

      const rows = this.db.prepare(sqlQuery).all(...params) as Array<{
        id: string;
        key: string;
        value: string;
        context: string | null;
        tags: string | null;
        created_at: number;
        updated_at: number;
        expires_at: number | null;
        confidence: string | null;
        importance: string | null;
        pinned: number | null;
        archived: number | null;
        archive_reason: string | null;
        source: string | null;
        source_session_id: string | null;
        verified_at: number | null;
        verified_by: string | null;
      }>;

      const hasMore = rows.length > limit;
      const items: Types.MemoryItem[] = rows.slice(0, limit).map((row) => ({
        id: row.id,
        key: row.key,
        value: row.value,
        context: row.context || undefined,
        tags: row.tags ? safeJsonParse(row.tags, []) : [],
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
        expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
        confidence: row.confidence || undefined,
        importance: row.importance || undefined,
        pinned: row.pinned === 1,
        archived: row.archived === 1,
        archive_reason: row.archive_reason || undefined,
        source: row.source || undefined,
        source_session_id: row.source_session_id || undefined,
        verified_at: row.verified_at ? new Date(row.verified_at).toISOString() : undefined,
        verified_by: row.verified_by || undefined,
      }));

      return {
        success: true,
        items,
        total: items.length,
        hasMore,
        message: `Found ${items.length} memor${items.length === 1 ? "y" : "ies"}`,
      };
    } catch (error) {
      return {
        success: false,
        items: [],
        total: 0,
        hasMore: false,
        message: `Error searching memories: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Get memory statistics
   */
  async getMemoryStats(args: Record<string, unknown>): Promise<Types.GetMemoryStatsResponse> {
    const typedArgs = args as Types.GetMemoryStatsArgs;
    const { scope = "project" } = typedArgs;
    const projectPath = this.resolveProjectPath(typedArgs.project_path);

    try {
      const projectCondition = scope === "project" ? "WHERE project_path = ?" : "";
      const params = scope === "project" ? [projectPath] : [];

      // Total count
      const totalResult = this.db.prepare(
        `SELECT COUNT(*) as count FROM working_memory ${projectCondition}`
      ).get(...params) as { count: number };

      // Active (non-archived)
      const activeResult = this.db.prepare(
        `SELECT COUNT(*) as count FROM working_memory ${projectCondition ? projectCondition + " AND" : "WHERE"} (archived = 0 OR archived IS NULL)`
      ).get(...params) as { count: number };

      // Archived
      const archivedResult = this.db.prepare(
        `SELECT COUNT(*) as count FROM working_memory ${projectCondition ? projectCondition + " AND" : "WHERE"} archived = 1`
      ).get(...params) as { count: number };

      // Pinned
      const pinnedResult = this.db.prepare(
        `SELECT COUNT(*) as count FROM working_memory ${projectCondition ? projectCondition + " AND" : "WHERE"} pinned = 1`
      ).get(...params) as { count: number };

      // By confidence
      const confidenceRows = this.db.prepare(`
        SELECT COALESCE(confidence, 'likely') as level, COUNT(*) as count
        FROM working_memory ${projectCondition}
        GROUP BY COALESCE(confidence, 'likely')
      `).all(...params) as Array<{ level: string; count: number }>;
      const byConfidence = { uncertain: 0, likely: 0, confirmed: 0, verified: 0 };
      for (const row of confidenceRows) {
        if (row.level in byConfidence) {
          byConfidence[row.level as keyof typeof byConfidence] = row.count;
        }
      }

      // By importance
      const importanceRows = this.db.prepare(`
        SELECT COALESCE(importance, 'normal') as level, COUNT(*) as count
        FROM working_memory ${projectCondition}
        GROUP BY COALESCE(importance, 'normal')
      `).all(...params) as Array<{ level: string; count: number }>;
      const byImportance = { low: 0, normal: 0, high: 0, critical: 0 };
      for (const row of importanceRows) {
        if (row.level in byImportance) {
          byImportance[row.level as keyof typeof byImportance] = row.count;
        }
      }

      // Expired
      const now = Date.now();
      const expiredResult = this.db.prepare(
        `SELECT COUNT(*) as count FROM working_memory ${projectCondition ? projectCondition + " AND" : "WHERE"} expires_at IS NOT NULL AND expires_at < ?`
      ).get(...params, now) as { count: number };

      // Expiring soon (within 7 days)
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const expiringSoonResult = this.db.prepare(
        `SELECT COUNT(*) as count FROM working_memory ${projectCondition ? projectCondition + " AND" : "WHERE"} expires_at IS NOT NULL AND expires_at >= ? AND expires_at < ?`
      ).get(...params, now, now + sevenDays) as { count: number };

      // Top tags
      const topTags: Array<{ tag: string; count: number }> = [];

      return {
        success: true,
        total: totalResult.count,
        active: activeResult.count,
        archived: archivedResult.count,
        pinned: pinnedResult.count,
        by_confidence: byConfidence,
        by_importance: byImportance,
        expired: expiredResult.count,
        expiring_soon: expiringSoonResult.count,
        top_tags: topTags,
        message: `Memory stats for ${scope === "project" ? "project" : "global"}`,
      };
    } catch (error) {
      return {
        success: false,
        total: 0,
        active: 0,
        archived: 0,
        pinned: 0,
        by_confidence: { uncertain: 0, likely: 0, confirmed: 0, verified: 0 },
        by_importance: { low: 0, normal: 0, high: 0, critical: 0 },
        expired: 0,
        expiring_soon: 0,
        top_tags: [],
        message: `Error getting stats: ${(error as Error).message}`,
      };
    }
  }

  // ==================== Phase 1: Cleanup/Maintenance Handlers ====================

  /**
   * Get storage statistics
   */
  async getStorageStats(args: Record<string, unknown>): Promise<Types.GetStorageStatsResponse> {
    const typedArgs = args as Types.GetStorageStatsArgs;
    // Reserved for future project-specific filtering
    void typedArgs.detailed;
    void typedArgs.project_path;

    try {
      const dbStats = this.db.getStats();

      // Get table counts
      const tables = [
        { name: "conversations", type: "conversations" },
        { name: "messages", type: "messages" },
        { name: "decisions", type: "decisions" },
        { name: "mistakes", type: "mistakes" },
        { name: "working_memory", type: "memories" },
        { name: "message_embeddings", type: "embeddings" },
      ];

      const byType: Record<string, Types.StorageTypeStats> = {};
      for (const table of tables) {
        try {
          const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as { count: number };
          byType[table.type] = { count: result.count, size_bytes: 0 };
        } catch {
          byType[table.type] = { count: 0, size_bytes: 0 };
        }
      }

      // Fill in missing types
      const allTypes = ["conversations", "messages", "decisions", "mistakes", "patterns", "memories", "learnings", "embeddings", "history"];
      for (const type of allTypes) {
        if (!byType[type]) {
          byType[type] = { count: 0, size_bytes: 0 };
        }
      }

      // Get oldest and newest
      let oldest = 0;
      let newest = 0;
      try {
        const oldestResult = this.db.prepare("SELECT MIN(created_at) as ts FROM conversations").get() as { ts: number | null };
        const newestResult = this.db.prepare("SELECT MAX(updated_at) as ts FROM conversations").get() as { ts: number | null };
        oldest = oldestResult.ts || 0;
        newest = newestResult.ts || 0;
      } catch {
        // Ignore
      }

      // Format size
      const formatSize = (bytes: number): string => {
        if (bytes < 1024) {return `${bytes} B`;}
        if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`;}
        if (bytes < 1024 * 1024 * 1024) {return `${(bytes / 1024 / 1024).toFixed(1)} MB`;}
        return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
      };

      const recommendations: string[] = [];
      const sizeInMB = dbStats.fileSize / (1024 * 1024);
      if (sizeInMB > 100) {
        recommendations.push("Database is large. Consider running cleanup_stale to remove old items.");
      }
      if (byType.embeddings.count > 10000) {
        recommendations.push("Many embeddings stored. Consider pruning unused embeddings.");
      }

      return {
        success: true,
        database_path: dbStats.dbPath,
        total_size_bytes: dbStats.fileSize,
        total_size_human: formatSize(dbStats.fileSize),
        by_type: byType as Types.GetStorageStatsResponse["by_type"],
        oldest_item: oldest,
        newest_item: newest,
        fragmentation_percent: 0,
        recommendations,
        message: `Database size: ${formatSize(dbStats.fileSize)}`,
      };
    } catch (error) {
      return {
        success: false,
        database_path: "",
        total_size_bytes: 0,
        total_size_human: "0 B",
        by_type: {
          conversations: { count: 0, size_bytes: 0 },
          messages: { count: 0, size_bytes: 0 },
          decisions: { count: 0, size_bytes: 0 },
          mistakes: { count: 0, size_bytes: 0 },
          patterns: { count: 0, size_bytes: 0 },
          memories: { count: 0, size_bytes: 0 },
          learnings: { count: 0, size_bytes: 0 },
          embeddings: { count: 0, size_bytes: 0 },
          history: { count: 0, size_bytes: 0 },
        },
        oldest_item: 0,
        newest_item: 0,
        fragmentation_percent: 0,
        recommendations: [],
        message: `Error getting storage stats: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Find stale items
   */
  async findStaleItems(args: Record<string, unknown>): Promise<Types.FindStaleItemsResponse> {
    const typedArgs = args as Types.FindStaleItemsArgs;
    const {
      item_types = ["memory", "decision", "pattern"],
      stale_threshold_days = 90,
      exclude_pinned = true,
      exclude_important = true,
      limit = 50,
    } = typedArgs;
    const projectPath = this.resolveOptionalProjectPath(typedArgs.project_path);

    try {
      const staleItems: Types.StaleItem[] = [];
      const byType: Record<string, number> = {};
      const now = Date.now();
      const threshold = now - stale_threshold_days * 24 * 60 * 60 * 1000;

      // Check memories
      if (item_types.includes("memory")) {
        let query = "SELECT id, key, updated_at, importance FROM working_memory WHERE updated_at < ?";
        const params: unknown[] = [threshold];

        if (projectPath) {
          query += " AND project_path = ?";
          params.push(projectPath);
        }
        if (exclude_pinned) {
          query += " AND (pinned = 0 OR pinned IS NULL)";
        }
        if (exclude_important) {
          query += " AND importance NOT IN ('high', 'critical')";
        }
        query += " ORDER BY updated_at ASC LIMIT ?";
        params.push(limit);

        const rows = this.db.prepare(query).all(...params) as Array<{
          id: number;
          key: string;
          updated_at: number;
          importance: string | null;
        }>;

        for (const row of rows) {
          const daysStale = Math.floor((now - row.updated_at) / (24 * 60 * 60 * 1000));
          staleItems.push({
            item_type: "memory",
            item_id: row.id,
            identifier: row.key,
            last_accessed: row.updated_at,
            days_stale: daysStale,
            importance: row.importance || "normal",
            size_estimate: 100,
          });
        }
        byType.memory = rows.length;
      }

      // Similar logic for decisions
      if (item_types.includes("decision")) {
        let query = "SELECT id, decision_text, timestamp FROM decisions WHERE timestamp < ?";
        const params: unknown[] = [threshold];
        query += " ORDER BY timestamp ASC LIMIT ?";
        params.push(limit);

        const rows = this.db.prepare(query).all(...params) as Array<{
          id: number;
          decision_text: string;
          timestamp: number;
        }>;

        for (const row of rows) {
          const daysStale = Math.floor((now - row.timestamp) / (24 * 60 * 60 * 1000));
          staleItems.push({
            item_type: "decision",
            item_id: row.id,
            identifier: row.decision_text.slice(0, 50),
            last_accessed: row.timestamp,
            days_stale: daysStale,
            importance: "normal",
            size_estimate: 200,
          });
        }
        byType.decision = rows.length;
      }

      const totalSize = staleItems.reduce((sum, item) => sum + item.size_estimate, 0);

      return {
        success: true,
        stale_items: staleItems.slice(0, limit),
        total_stale: staleItems.length,
        total_size_bytes: totalSize,
        by_type: byType,
        message: `Found ${staleItems.length} stale item(s)`,
      };
    } catch (error) {
      return {
        success: false,
        stale_items: [],
        total_stale: 0,
        total_size_bytes: 0,
        by_type: {},
        message: `Error finding stale items: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Find duplicates (simplified - uses text similarity)
   */
  async findDuplicates(args: Record<string, unknown>): Promise<Types.FindDuplicatesResponse> {
    const typedArgs = args as Types.FindDuplicatesArgs;
    const {
      item_types = ["memory", "decision"],
      similarity_threshold: _similarity_threshold = 0.85,
      limit = 20,
    } = typedArgs;
    const projectPath = this.resolveOptionalProjectPath(typedArgs.project_path);

    try {
      // Simplified duplicate detection - exact matches only for now
      const duplicateGroups: Types.DuplicateGroup[] = [];

      if (item_types.includes("memory")) {
        let query = "SELECT id, key, value, created_at, importance FROM working_memory";
        const params: unknown[] = [];
        if (projectPath) {
          query += " WHERE project_path = ?";
          params.push(projectPath);
        }

        const rows = this.db.prepare(query).all(...params) as Array<{
          id: number;
          key: string;
          value: string;
          created_at: number;
          importance: string | null;
        }>;

        // Group by value hash (exact duplicates)
        const valueMap = new Map<string, typeof rows>();
        for (const row of rows) {
          const key = row.value.toLowerCase().trim();
          if (!valueMap.has(key)) {
            valueMap.set(key, []);
          }
          const group = valueMap.get(key);
          if (group) {
            group.push(row);
          }
        }

        let groupId = 1;
        for (const [_value, group] of valueMap) {
          if (group.length > 1) {
            // Sort by importance and created_at to determine which to keep
            const sorted = [...group].sort((a, b) => {
              const impOrder: Record<string, number> = { critical: 1, high: 2, normal: 3, low: 4 };
              const impDiff = (impOrder[a.importance || "normal"] || 3) - (impOrder[b.importance || "normal"] || 3);
              if (impDiff !== 0) {return impDiff;}
              return b.created_at - a.created_at;
            });

            duplicateGroups.push({
              group_id: groupId++,
              item_type: "memory",
              items: sorted.map((r) => ({
                id: r.id,
                identifier: r.key,
                content_preview: r.value.slice(0, 100),
                created_at: r.created_at,
                importance: r.importance || "normal",
              })),
              similarity_score: 1.0,
              recommended_keep: sorted[0].id,
              recommendation_reason: "Highest importance and most recent",
            });
          }
        }
      }

      const potentialSavings = duplicateGroups.reduce(
        (sum, g) => sum + g.items.length - 1, 0
      );

      return {
        success: true,
        duplicate_groups: duplicateGroups.slice(0, limit),
        total_groups: duplicateGroups.length,
        potential_savings: potentialSavings,
        message: `Found ${duplicateGroups.length} duplicate group(s)`,
      };
    } catch (error) {
      return {
        success: false,
        duplicate_groups: [],
        total_groups: 0,
        potential_savings: 0,
        message: `Error finding duplicates: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Merge duplicates
   */
  async mergeDuplicates(args: Record<string, unknown>): Promise<Types.MergeDuplicatesResponse> {
    const typedArgs = args as unknown as Types.MergeDuplicatesArgs;
    const { item_type, keep_id, merge_ids, merge_tags = true } = typedArgs;

    if (!item_type || !keep_id || !merge_ids || merge_ids.length === 0) {
      return {
        success: false,
        kept_id: keep_id || 0,
        merged_count: 0,
        tags_merged: [],
        references_updated: 0,
        message: "item_type, keep_id, and merge_ids are required",
      };
    }

    try {
      return this.db.transaction(() => {
        const tagsMerged: string[] = [];

        if (item_type === "memory") {
          // Merge tags if requested
          if (merge_tags) {
            for (const mergeId of merge_ids) {
              const tags = this.db.prepare(
                "SELECT t.name FROM tags t JOIN item_tags it ON t.id = it.tag_id WHERE it.item_type = 'memory' AND it.item_id = ?"
              ).all(mergeId) as Array<{ name: string }>;

              for (const tag of tags) {
                if (!tagsMerged.includes(tag.name)) {
                  tagsMerged.push(tag.name);
                }
              }
            }
          }

          // Delete merged items
          const placeholders = merge_ids.map(() => "?").join(",");
          this.db.prepare(`DELETE FROM working_memory WHERE id IN (${placeholders})`).run(...merge_ids);
        }

        return {
          success: true,
          kept_id: keep_id,
          merged_count: merge_ids.length,
          tags_merged: tagsMerged,
          references_updated: 0,
          message: `Merged ${merge_ids.length} item(s) into #${keep_id}`,
        };
      });
    } catch (error) {
      return {
        success: false,
        kept_id: keep_id,
        merged_count: 0,
        tags_merged: [],
        references_updated: 0,
        message: `Error merging duplicates: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Cleanup stale items
   */
  async cleanupStale(args: Record<string, unknown>): Promise<Types.CleanupStaleResponse> {
    const typedArgs = args as Types.CleanupStaleArgs;
    const {
      item_types,
      stale_threshold_days = 90,
      action = "preview",
      exclude_pinned = true,
      exclude_important = true,
      max_items = 100,
    } = typedArgs;
    const projectPath = this.resolveOptionalProjectPath(typedArgs.project_path);

    try {
      // Find stale items first
      const staleResult = await this.findStaleItems({
        item_types: item_types as Array<"memory" | "decision" | "pattern" | "session">,
        stale_threshold_days,
        exclude_pinned,
        exclude_important,
        project_path: projectPath,
        limit: max_items,
      });

      if (!staleResult.success || staleResult.stale_items.length === 0) {
        return {
          success: true,
          action,
          preview_only: action === "preview",
          items_affected: 0,
          by_type: {},
          space_freed_bytes: 0,
          items: [],
          message: "No stale items found",
        };
      }

      const items = staleResult.stale_items.map((item) => ({
        type: item.item_type,
        id: item.item_id,
        identifier: item.identifier,
      }));

      if (action === "preview") {
        return {
          success: true,
          action: "preview",
          preview_only: true,
          items_affected: items.length,
          by_type: staleResult.by_type,
          space_freed_bytes: staleResult.total_size_bytes,
          items,
          message: `Would affect ${items.length} item(s). Use action='delete' or action='archive' to proceed.`,
        };
      }

      // Execute cleanup
      return this.db.transaction(() => {
        for (const item of items) {
          if (item.type === "memory") {
            if (action === "archive") {
              this.db.prepare(
                "UPDATE working_memory SET archived = 1, archive_reason = 'Stale cleanup', updated_at = ? WHERE id = ?"
              ).run(Date.now(), item.id);
            } else if (action === "delete") {
              this.db.prepare("DELETE FROM working_memory WHERE id = ?").run(item.id);
            }
          }
          // Similar for other types
        }

        // Log maintenance
        this.db.prepare(`
          INSERT INTO maintenance_log (task_type, started_at, completed_at, status, items_processed, items_affected, details)
          VALUES (?, ?, ?, 'completed', ?, ?, ?)
        `).run(
          "cleanup_stale",
          Date.now(),
          Date.now(),
          items.length,
          items.length,
          JSON.stringify({ action, threshold_days: stale_threshold_days })
        );

        return {
          success: true,
          action,
          preview_only: false,
          items_affected: items.length,
          by_type: staleResult.by_type,
          space_freed_bytes: staleResult.total_size_bytes,
          items,
          message: `${action === "archive" ? "Archived" : "Deleted"} ${items.length} stale item(s)`,
        };
      });
    } catch (error) {
      return {
        success: false,
        action,
        preview_only: action === "preview",
        items_affected: 0,
        by_type: {},
        space_freed_bytes: 0,
        items: [],
        message: `Error cleaning up stale items: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Vacuum database
   */
  async vacuumDatabase(args: Record<string, unknown>): Promise<Types.VacuumDatabaseResponse> {
    const typedArgs = args as Types.VacuumDatabaseArgs;
    const { analyze = true, reindex = false } = typedArgs;

    try {
      const startTime = Date.now();
      const statsBefore = this.db.getStats();

      // VACUUM must run outside of a transaction
      this.db.exec("VACUUM");

      if (analyze) {
        this.db.exec("ANALYZE");
      }

      if (reindex) {
        this.db.exec("REINDEX");
      }

      const statsAfter = this.db.getStats();
      const duration = Date.now() - startTime;

      const sizeBefore = statsBefore.fileSize;
      const sizeAfter = statsAfter.fileSize;

      // Log maintenance
      this.db.prepare(`
        INSERT INTO maintenance_log (task_type, started_at, completed_at, status, details)
        VALUES (?, ?, ?, 'completed', ?)
      `).run(
        "vacuum",
        startTime,
        Date.now(),
        JSON.stringify({ analyze, reindex, size_before: sizeBefore, size_after: sizeAfter })
      );

      return {
        success: true,
        size_before: sizeBefore,
        size_after: sizeAfter,
        space_freed: sizeBefore - sizeAfter,
        duration_ms: duration,
        message: `Vacuum completed in ${duration}ms. Freed ${Math.max(0, sizeBefore - sizeAfter)} bytes.`,
      };
    } catch (error) {
      return {
        success: false,
        size_before: 0,
        size_after: 0,
        space_freed: 0,
        duration_ms: 0,
        message: `Error vacuuming database: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Cleanup orphaned records
   */
  async cleanupOrphans(args: Record<string, unknown>): Promise<Types.CleanupOrphansResponse> {
    const typedArgs = args as Types.CleanupOrphansArgs;
    const { preview = true } = typedArgs;

    try {
      const orphansFound = {
        tags_without_items: 0,
        embeddings_without_items: 0,
        history_without_items: 0,
        links_without_targets: 0,
      };

      // Find orphaned tags
      const orphanedTags = this.db.prepare(`
        SELECT COUNT(*) as count FROM tags t
        WHERE NOT EXISTS (SELECT 1 FROM item_tags it WHERE it.tag_id = t.id)
      `).get() as { count: number };
      orphansFound.tags_without_items = orphanedTags.count;

      // Find orphaned embeddings
      const orphanedEmbeddings = this.db.prepare(`
        SELECT COUNT(*) as count FROM message_embeddings e
        WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = e.message_id)
      `).get() as { count: number };
      orphansFound.embeddings_without_items = orphanedEmbeddings.count;

      const totalOrphans = Object.values(orphansFound).reduce((a, b) => a + b, 0);

      if (preview) {
        return {
          success: true,
          preview_only: true,
          orphans_found: orphansFound,
          total_orphans: totalOrphans,
          cleaned: 0,
          message: `Found ${totalOrphans} orphan(s). Use preview=false to clean.`,
        };
      }

      // Execute cleanup
      return this.db.transaction(() => {
        let cleaned = 0;

        // Delete orphaned tags
        const tagResult = this.db.prepare(`
          DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM item_tags it WHERE it.tag_id = tags.id)
        `).run();
        cleaned += tagResult.changes;

        // Delete orphaned embeddings
        const embedResult = this.db.prepare(`
          DELETE FROM message_embeddings WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = message_embeddings.message_id)
        `).run();
        cleaned += embedResult.changes;

        // Log maintenance
        this.db.prepare(`
          INSERT INTO maintenance_log (task_type, started_at, completed_at, status, items_affected, details)
          VALUES (?, ?, ?, 'completed', ?, ?)
        `).run("cleanup_orphans", Date.now(), Date.now(), cleaned, JSON.stringify(orphansFound));

        return {
          success: true,
          preview_only: false,
          orphans_found: orphansFound,
          total_orphans: totalOrphans,
          cleaned,
          message: `Cleaned ${cleaned} orphan(s)`,
        };
      });
    } catch (error) {
      return {
        success: false,
        preview_only: preview,
        orphans_found: {
          tags_without_items: 0,
          embeddings_without_items: 0,
          history_without_items: 0,
          links_without_targets: 0,
        },
        total_orphans: 0,
        cleaned: 0,
        message: `Error cleaning orphans: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Get health report
   */
  async getHealthReport(args: Record<string, unknown>): Promise<Types.GetHealthReportResponse> {
    const typedArgs = args as Types.GetHealthReportArgs;
    const projectPath = this.resolveOptionalProjectPath(typedArgs.project_path);

    try {
      const checks: Types.HealthCheck[] = [];
      let passed = 0;
      let warnings = 0;
      let failures = 0;

      // Database size check
      const stats = await this.getStorageStats({ detailed: false });
      const sizeMB = stats.total_size_bytes / 1024 / 1024;
      if (sizeMB > 500) {
        checks.push({
          name: "database_size",
          status: "fail",
          message: `Database size: ${stats.total_size_human}`,
          details: "Database exceeds 500MB",
          recommendation: "Run cleanup_stale and vacuum_database",
        });
        failures++;
      } else if (sizeMB > 100) {
        checks.push({
          name: "database_size",
          status: "warn",
          message: `Database size: ${stats.total_size_human}`,
          details: "Database exceeds 100MB",
          recommendation: "Consider running cleanup_stale",
        });
        warnings++;
      } else {
        checks.push({
          name: "database_size",
          status: "pass",
          message: `Database size: ${stats.total_size_human}`,
          details: "Size is healthy",
          recommendation: null,
        });
        passed++;
      }

      // Stale items check
      const stale = await this.findStaleItems({ limit: 100, project_path: projectPath });
      if (stale.total_stale > 50) {
        checks.push({
          name: "stale_items",
          status: "warn",
          message: `${stale.total_stale} stale items`,
          details: "Many items haven't been accessed recently",
          recommendation: "Review and cleanup stale items",
        });
        warnings++;
      } else {
        checks.push({
          name: "stale_items",
          status: "pass",
          message: `${stale.total_stale} stale items`,
          details: "Stale item count is acceptable",
          recommendation: null,
        });
        passed++;
      }

      // Orphan check
      const orphans = await this.cleanupOrphans({ preview: true });
      if (orphans.total_orphans > 100) {
        checks.push({
          name: "orphans",
          status: "warn",
          message: `${orphans.total_orphans} orphaned records`,
          details: "Many orphaned records found",
          recommendation: "Run cleanup_orphans",
        });
        warnings++;
      } else {
        checks.push({
          name: "orphans",
          status: "pass",
          message: `${orphans.total_orphans} orphaned records`,
          details: "Orphan count is acceptable",
          recommendation: null,
        });
        passed++;
      }

      // Calculate overall health
      let overallHealth: "good" | "needs_attention" | "critical";
      let score: number;
      if (failures > 0) {
        overallHealth = "critical";
        score = Math.max(0, 50 - failures * 25);
      } else if (warnings > 1) {
        overallHealth = "needs_attention";
        score = Math.max(50, 100 - warnings * 15);
      } else {
        overallHealth = "good";
        score = 100 - warnings * 10;
      }

      const recommendations = checks
        .filter((c) => c.recommendation)
        .map((c) => c.recommendation as string);

      // Get last maintenance
      const lastMaint = this.db.prepare(
        "SELECT MAX(completed_at) as ts FROM maintenance_log WHERE status = 'completed'"
      ).get() as { ts: number | null };

      return {
        success: true,
        overall_health: overallHealth,
        score,
        checks,
        summary: { passed, warnings, failures },
        recommendations,
        last_maintenance: lastMaint.ts,
        message: `Health: ${overallHealth} (score: ${score})`,
      };
    } catch (error) {
      return {
        success: false,
        overall_health: "critical",
        score: 0,
        checks: [],
        summary: { passed: 0, warnings: 0, failures: 1 },
        recommendations: [],
        last_maintenance: null,
        message: `Error getting health report: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Run maintenance tasks
   */
  async runMaintenance(args: Record<string, unknown>): Promise<Types.RunMaintenanceResponse> {
    const typedArgs = args as unknown as Types.RunMaintenanceArgs;
    const { tasks, options = {}, preview = true } = typedArgs;

    if (!tasks || tasks.length === 0) {
      return {
        success: false,
        tasks_run: [],
        total_duration_ms: 0,
        overall_status: "failed",
        log_id: 0,
        message: "tasks array is required",
      };
    }

    try {
      const startTime = Date.now();
      const tasksRun: Types.MaintenanceTaskResult[] = [];

      for (const task of tasks) {
        const taskStart = Date.now();
        try {
          let resultSummary = "";

          switch (task) {
            case "cleanup_stale": {
              const result = await this.cleanupStale({
                ...options,
                action: preview ? "preview" : "archive",
              });
              resultSummary = result.message;
              break;
            }
            case "cleanup_orphans": {
              const result = await this.cleanupOrphans({ preview });
              resultSummary = result.message;
              break;
            }
            case "vacuum": {
              if (!preview) {
                const result = await this.vacuumDatabase(options);
                resultSummary = result.message;
              } else {
                resultSummary = "Vacuum (preview mode - skipped)";
              }
              break;
            }
            case "find_duplicates": {
              const result = await this.findDuplicates(options);
              resultSummary = result.message;
              break;
            }
            case "health_report": {
              const result = await this.getHealthReport(options);
              resultSummary = result.message;
              break;
            }
            default:
              resultSummary = "Unknown task";
          }

          tasksRun.push({
            task,
            status: "success",
            duration_ms: Date.now() - taskStart,
            result_summary: resultSummary,
          });
        } catch (taskError) {
          tasksRun.push({
            task,
            status: "failed",
            duration_ms: Date.now() - taskStart,
            result_summary: (taskError as Error).message,
          });
        }
      }

      const totalDuration = Date.now() - startTime;
      const failedCount = tasksRun.filter((t) => t.status === "failed").length;
      const overallStatus = failedCount === 0 ? "success" : failedCount < tasks.length ? "partial" : "failed";

      // Log to maintenance_log
      const logResult = this.db.prepare(`
        INSERT INTO maintenance_log (task_type, started_at, completed_at, status, items_processed, details)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        "run_maintenance",
        startTime,
        Date.now(),
        overallStatus,
        tasks.length,
        JSON.stringify({ tasks, preview, results: tasksRun })
      );

      return {
        success: true,
        tasks_run: tasksRun,
        total_duration_ms: totalDuration,
        overall_status: overallStatus,
        log_id: Number(logResult.lastInsertRowid),
        message: `Completed ${tasksRun.length} task(s) in ${totalDuration}ms`,
      };
    } catch (error) {
      return {
        success: false,
        tasks_run: [],
        total_duration_ms: 0,
        overall_status: "failed",
        log_id: 0,
        message: `Error running maintenance: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Get maintenance history
   */
  async getMaintenanceHistory(args: Record<string, unknown>): Promise<Types.GetMaintenanceHistoryResponse> {
    const typedArgs = args as Types.GetMaintenanceHistoryArgs;
    const { since, task_type, limit = 20 } = typedArgs;

    try {
      let query = "SELECT * FROM maintenance_log WHERE 1=1";
      const params: unknown[] = [];

      if (since) {
        query += " AND started_at >= ?";
        params.push(since);
      }

      if (task_type) {
        query += " AND task_type = ?";
        params.push(task_type);
      }

      query += " ORDER BY started_at DESC LIMIT ?";
      params.push(limit);

      const rows = this.db.prepare(query).all(...params) as Types.MaintenanceLogEntry[];

      return {
        success: true,
        entries: rows,
        total: rows.length,
        message: `Found ${rows.length} maintenance log entr${rows.length === 1 ? "y" : "ies"}`,
      };
    } catch (error) {
      return {
        success: false,
        entries: [],
        total: 0,
        message: `Error getting maintenance history: ${(error as Error).message}`,
      };
    }
  }

  // ==================== Phase 9: Methodology & Research Tracking ====================

  /**
   * Search for problem-solving methodologies.
   *
   * @param args.query - Search query for problem statements or approaches
   * @param args.approach - Filter by approach type
   * @param args.outcome - Filter by outcome
   * @param args.limit - Maximum results (default: 10)
   * @returns Matching methodologies with problem statements, steps, and outcomes
   */
  async getMethodologies(args: Record<string, unknown>): Promise<{
    query: string;
    methodologies: Array<{
      id: string;
      problem_statement: string;
      approach: string;
      steps_taken: Array<{ order: number; action: string; tool?: string; succeeded: boolean }>;
      tools_used: string[];
      files_involved: string[];
      outcome: string;
      what_worked?: string;
      what_didnt_work?: string;
      started_at: number;
      ended_at: number;
    }>;
    total_found: number;
  }> {
    await this.maybeAutoIndex();

    const query = args.query as string;
    const approach = args.approach as string | undefined;
    const outcome = args.outcome as string | undefined;
    const limit = (args.limit as number) || 10;

    let sql = `
      SELECT m.*
      FROM methodologies m
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    // FTS search
    const ftsResults = this.db.prepare(`
      SELECT id, rank
      FROM methodologies_fts
      WHERE methodologies_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(`"${query}"*`, limit * 2) as Array<{ id: string; rank: number }>;

    if (ftsResults.length > 0) {
      const ids = ftsResults.map(r => `'${r.id}'`).join(",");
      sql += ` AND m.id IN (${ids})`;
    }

    if (approach) {
      sql += " AND m.approach = ?";
      params.push(approach);
    }

    if (outcome) {
      sql += " AND m.outcome = ?";
      params.push(outcome);
    }

    sql += " ORDER BY m.started_at DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      problem_statement: string;
      approach: string;
      steps_taken: string;
      tools_used: string;
      files_involved: string;
      outcome: string;
      what_worked: string | null;
      what_didnt_work: string | null;
      started_at: number;
      ended_at: number;
    }>;

    const methodologies = rows.map(row => ({
      id: row.id,
      problem_statement: row.problem_statement,
      approach: row.approach,
      steps_taken: safeJsonParse(row.steps_taken, []),
      tools_used: safeJsonParse(row.tools_used, []),
      files_involved: safeJsonParse(row.files_involved, []),
      outcome: row.outcome,
      what_worked: row.what_worked || undefined,
      what_didnt_work: row.what_didnt_work || undefined,
      started_at: row.started_at,
      ended_at: row.ended_at,
    }));

    return {
      query,
      methodologies,
      total_found: methodologies.length,
    };
  }

  /**
   * Search for research findings and discoveries.
   *
   * @param args.query - Search query for topics or discoveries
   * @param args.source_type - Filter by source type
   * @param args.relevance - Filter by relevance level
   * @param args.confidence - Filter by confidence level
   * @param args.limit - Maximum results (default: 10)
   * @returns Matching findings with topics, discoveries, and sources
   */
  async getResearchFindings(args: Record<string, unknown>): Promise<{
    query: string;
    findings: Array<{
      id: string;
      topic: string;
      discovery: string;
      source_type: string;
      source_reference?: string;
      relevance: string;
      confidence: string;
      related_to: string[];
      timestamp: number;
    }>;
    total_found: number;
  }> {
    await this.maybeAutoIndex();

    const query = args.query as string;
    const source_type = args.source_type as string | undefined;
    const relevance = args.relevance as string | undefined;
    const confidence = args.confidence as string | undefined;
    const limit = (args.limit as number) || 10;

    let sql = `
      SELECT r.*
      FROM research_findings r
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    // FTS search
    const ftsResults = this.db.prepare(`
      SELECT id, rank
      FROM research_fts
      WHERE research_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(`"${query}"*`, limit * 2) as Array<{ id: string; rank: number }>;

    if (ftsResults.length > 0) {
      const ids = ftsResults.map(r => `'${r.id}'`).join(",");
      sql += ` AND r.id IN (${ids})`;
    }

    if (source_type) {
      sql += " AND r.source_type = ?";
      params.push(source_type);
    }

    if (relevance) {
      sql += " AND r.relevance = ?";
      params.push(relevance);
    }

    if (confidence) {
      sql += " AND r.confidence = ?";
      params.push(confidence);
    }

    sql += " ORDER BY r.timestamp DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      topic: string;
      discovery: string;
      source_type: string;
      source_reference: string | null;
      relevance: string;
      confidence: string;
      related_to: string;
      timestamp: number;
    }>;

    const findings = rows.map(row => ({
      id: row.id,
      topic: row.topic,
      discovery: row.discovery,
      source_type: row.source_type,
      source_reference: row.source_reference || undefined,
      relevance: row.relevance,
      confidence: row.confidence,
      related_to: safeJsonParse(row.related_to, []),
      timestamp: row.timestamp,
    }));

    return {
      query,
      findings,
      total_found: findings.length,
    };
  }

  /**
   * Search for solution patterns.
   *
   * @param args.query - Search query for problems or solutions
   * @param args.problem_category - Filter by problem category
   * @param args.effectiveness - Filter by effectiveness level
   * @param args.technology - Filter by technology
   * @param args.limit - Maximum results (default: 10)
   * @returns Matching patterns with problems, solutions, and applicability
   */
  async getSolutionPatterns(args: Record<string, unknown>): Promise<{
    query: string;
    patterns: Array<{
      id: string;
      problem_category: string;
      problem_description: string;
      solution_summary: string;
      solution_steps: string[];
      code_pattern?: string;
      technology: string[];
      prerequisites: string[];
      applies_when: string;
      avoid_when?: string;
      applied_to_files: string[];
      effectiveness: string;
      timestamp: number;
    }>;
    total_found: number;
  }> {
    await this.maybeAutoIndex();

    const query = args.query as string;
    const problem_category = args.problem_category as string | undefined;
    const effectiveness = args.effectiveness as string | undefined;
    const technology = args.technology as string | undefined;
    const limit = (args.limit as number) || 10;

    let sql = `
      SELECT p.*
      FROM solution_patterns p
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    // FTS search
    const ftsResults = this.db.prepare(`
      SELECT id, rank
      FROM patterns_fts
      WHERE patterns_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(`"${query}"*`, limit * 2) as Array<{ id: string; rank: number }>;

    if (ftsResults.length > 0) {
      const ids = ftsResults.map(r => `'${r.id}'`).join(",");
      sql += ` AND p.id IN (${ids})`;
    }

    if (problem_category) {
      sql += " AND p.problem_category = ?";
      params.push(problem_category);
    }

    if (effectiveness) {
      sql += " AND p.effectiveness = ?";
      params.push(effectiveness);
    }

    if (technology) {
      sql += " AND p.technology LIKE ?";
      params.push(`%${technology}%`);
    }

    sql += " ORDER BY p.timestamp DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      problem_category: string;
      problem_description: string;
      solution_summary: string;
      solution_steps: string;
      code_pattern: string | null;
      technology: string;
      prerequisites: string;
      applies_when: string;
      avoid_when: string | null;
      applied_to_files: string;
      effectiveness: string;
      timestamp: number;
    }>;

    const patterns = rows.map(row => ({
      id: row.id,
      problem_category: row.problem_category,
      problem_description: row.problem_description,
      solution_summary: row.solution_summary,
      solution_steps: safeJsonParse(row.solution_steps, []),
      code_pattern: row.code_pattern || undefined,
      technology: safeJsonParse(row.technology, []),
      prerequisites: safeJsonParse(row.prerequisites, []),
      applies_when: row.applies_when,
      avoid_when: row.avoid_when || undefined,
      applied_to_files: safeJsonParse(row.applied_to_files, []),
      effectiveness: row.effectiveness,
      timestamp: row.timestamp,
    }));

    return {
      query,
      patterns,
      total_found: patterns.length,
    };
  }
}
