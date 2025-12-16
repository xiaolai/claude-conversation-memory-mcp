/**
 * Main Orchestrator - Coordinates all components for conversation memory indexing and retrieval.
 *
 * ConversationMemory is the primary interface for the conversation-memory-mcp system.
 * It orchestrates parsing, storage, extraction, and search of Claude Code conversation history.
 *
 * @example
 * ```typescript
 * const memory = new ConversationMemory();
 * await memory.indexConversations({
 *   projectPath: '/path/to/project',
 *   enableGitIntegration: true
 * });
 * ```
 */

import { getSQLiteManager, SQLiteManager } from "./storage/SQLiteManager.js";
import { ConversationStorage } from "./storage/ConversationStorage.js";
import { ConversationParser, type ParseResult } from "./parsers/ConversationParser.js";
import { DecisionExtractor } from "./parsers/DecisionExtractor.js";
import { MistakeExtractor } from "./parsers/MistakeExtractor.js";
import { GitIntegrator } from "./parsers/GitIntegrator.js";
import { RequirementsExtractor } from "./parsers/RequirementsExtractor.js";
import { SemanticSearch } from "./search/SemanticSearch.js";

/**
 * Configuration options for indexing conversations.
 */
export interface IndexOptions {
  /** Absolute path to the project directory to index */
  projectPath: string;

  /** Optional: Index only a specific session ID instead of all sessions */
  sessionId?: string;

  /**
   * Whether to include thinking blocks in the index.
   * Thinking blocks can be large and are excluded by default.
   * @default false
   */
  includeThinking?: boolean;

  /**
   * Enable git integration to link commits to conversations.
   * Requires the project to be a git repository.
   * @default true
   */
  enableGitIntegration?: boolean;

  /**
   * Exclude MCP tool conversations from indexing.
   * - `false`: Index all conversations (default)
   * - `'self-only'`: Exclude only conversation-memory MCP conversations (prevents self-referential loops)
   * - `'all-mcp'` or `true`: Exclude all MCP tool conversations
   * @default false
   */
  excludeMcpConversations?: boolean | 'self-only' | 'all-mcp';

  /**
   * List of specific MCP server names to exclude.
   * More granular than `excludeMcpConversations`.
   * @example ['conversation-memory', 'code-graph-rag']
   */
  excludeMcpServers?: string[];
}

/**
 * Main orchestrator for conversation memory operations.
 *
 * Coordinates parsing, storage, extraction, and search across:
 * - Conversation parsing from JSONL files
 * - Decision, mistake, and requirement extraction
 * - Git commit integration
 * - Semantic search with embeddings
 */
export class ConversationMemory {
  private sqliteManager: SQLiteManager;
  private storage: ConversationStorage;
  private parser: ConversationParser;
  private decisionExtractor: DecisionExtractor;
  private mistakeExtractor: MistakeExtractor;
  private requirementsExtractor: RequirementsExtractor;
  private semanticSearch: SemanticSearch;

  constructor() {
    this.sqliteManager = getSQLiteManager();
    this.storage = new ConversationStorage(this.sqliteManager);

    // Enable caching by default for better performance
    // Cache up to 100 query results for 5 minutes
    this.storage.enableCache({ maxSize: 100, ttlMs: 300000 });

    this.parser = new ConversationParser();
    this.decisionExtractor = new DecisionExtractor();
    this.mistakeExtractor = new MistakeExtractor();
    this.requirementsExtractor = new RequirementsExtractor();
    this.semanticSearch = new SemanticSearch(this.sqliteManager);
  }

  /**
   * Index conversations for a project.
   *
   * This is the main entry point for processing conversation history.
   * It performs the following operations:
   * 1. Parse conversation JSONL files from the project
   * 2. Store conversations, messages, and tool interactions
   * 3. Extract decisions, mistakes, and requirements
   * 4. Link git commits (if enabled)
   * 5. Generate semantic embeddings for search
   *
   * @param options - Configuration options for indexing
   * @returns Result object containing:
   * - `embeddings_generated`: Whether embeddings were successfully generated
   * - `embedding_error`: Error message if embedding generation failed
   * - `indexed_folders`: List of folders that were indexed
   * - `database_path`: Path to the SQLite database
   *
   * @throws {Error} If project path doesn't exist or conversation files can't be parsed
   *
   * @example
   * ```typescript
   * const result = await memory.indexConversations({
   *   projectPath: '/Users/me/my-project',
   *   enableGitIntegration: true,
   *   excludeMcpConversations: 'self-only'
   * });
   *
   * if (result.embeddings_generated) {
   *   console.log('Indexed folders:', result.indexed_folders);
   * } else {
   *   console.warn('Embeddings failed:', result.embedding_error);
   * }
   * ```
   */
  async indexConversations(options: IndexOptions): Promise<{
    embeddings_generated: boolean;
    embedding_error?: string;
    indexed_folders?: string[];
    database_path?: string;
  }> {
    console.log("\n=== Indexing Conversations ===");
    console.log(`Project: ${options.projectPath}`);
    if (options.sessionId) {
      console.log(`Session: ${options.sessionId} (single session mode)`);
    } else {
      console.log(`Mode: All sessions`);
    }

    // Parse conversations
    let parseResult = this.parser.parseProject(options.projectPath, options.sessionId);

    // Filter MCP conversations if requested
    if (options.excludeMcpConversations || options.excludeMcpServers) {
      parseResult = this.filterMcpConversations(parseResult, options);
    }

    // Store basic entities
    await this.storage.storeConversations(parseResult.conversations);
    await this.storage.storeMessages(parseResult.messages);
    await this.storage.storeToolUses(parseResult.tool_uses);
    await this.storage.storeToolResults(parseResult.tool_results);
    await this.storage.storeFileEdits(parseResult.file_edits);

    if (options.includeThinking !== false) {
      await this.storage.storeThinkingBlocks(parseResult.thinking_blocks);
    }

    // Extract decisions
    console.log("\n=== Extracting Decisions ===");
    const decisions = this.decisionExtractor.extractDecisions(
      parseResult.messages,
      parseResult.thinking_blocks
    );
    await this.storage.storeDecisions(decisions);

    // Extract mistakes
    console.log("\n=== Extracting Mistakes ===");
    const mistakes = this.mistakeExtractor.extractMistakes(
      parseResult.messages,
      parseResult.tool_results
    );
    await this.storage.storeMistakes(mistakes);

    // Extract requirements and validations
    console.log("\n=== Extracting Requirements ===");
    const requirements = this.requirementsExtractor.extractRequirements(
      parseResult.messages
    );
    await this.storage.storeRequirements(requirements);

    const validations = this.requirementsExtractor.extractValidations(
      parseResult.tool_uses,
      parseResult.tool_results,
      parseResult.messages
    );
    await this.storage.storeValidations(validations);

    // Git integration
    if (options.enableGitIntegration !== false) {
      try {
        console.log("\n=== Integrating Git History ===");
        const gitIntegrator = new GitIntegrator(options.projectPath);
        const commits = await gitIntegrator.linkCommitsToConversations(
          parseResult.conversations,
          parseResult.file_edits,
          decisions
        );
        await this.storage.storeGitCommits(commits);
        console.log(`✓ Linked ${commits.length} git commits`);
      } catch (error) {
        console.error("⚠️ Git integration failed:", error);
        console.error("  Conversations will be indexed without git commit links");
        console.error("  This is normal if the project is not a git repository");
      }
    }

    // Index for semantic search
    console.log("\n=== Indexing for Semantic Search ===");
    let embeddingError: string | undefined;
    try {
      await this.semanticSearch.indexMessages(parseResult.messages);
      await this.semanticSearch.indexDecisions(decisions);
      console.log("✓ Semantic indexing complete");
    } catch (error) {
      embeddingError = (error as Error).message;
      console.error("⚠️ Semantic indexing failed:", error);
      console.error("  Embeddings may not be available - falling back to full-text search");
      console.error("  Install @xenova/transformers for semantic search: npm install @xenova/transformers");
      // Don't throw - allow indexing to complete with FTS fallback
    }

    // Print stats
    console.log("\n=== Indexing Complete ===");
    const stats = this.storage.getStats();
    console.log(`Conversations: ${stats.conversations.count}`);
    console.log(`Messages: ${stats.messages.count}`);
    console.log(`Decisions: ${stats.decisions.count}`);
    console.log(`Mistakes: ${stats.mistakes.count}`);
    console.log(`Git Commits: ${stats.git_commits.count}`);

    // Return embedding status and indexing metadata
    return {
      embeddings_generated: !embeddingError,
      embedding_error: embeddingError,
      indexed_folders: parseResult.indexed_folders,
      database_path: this.sqliteManager.getDbPath(),
    };
  }

  /**
   * Search conversations using natural language query.
   *
   * Uses semantic search with embeddings if available, otherwise falls back to full-text search.
   *
   * @param query - Natural language search query
   * @param limit - Maximum number of results to return (default: 10)
   * @returns Array of search results with messages, conversations, and similarity scores
   *
   * @example
   * ```typescript
   * const results = await memory.search('authentication bug fix', 5);
   * results.forEach(r => {
   *   console.log(`${r.similarity}: ${r.snippet}`);
   * });
   * ```
   */
  async search(query: string, limit: number = 10) {
    return this.semanticSearch.searchConversations(query, limit);
  }

  /**
   * Search for decisions using natural language query.
   *
   * Searches through extracted decisions to find relevant architectural choices and technical decisions.
   *
   * @param query - Natural language search query
   * @param limit - Maximum number of results to return (default: 10)
   * @returns Array of decision search results with similarity scores
   *
   * @example
   * ```typescript
   * const decisions = await memory.searchDecisions('database choice', 3);
   * decisions.forEach(d => {
   *   console.log(`Decision: ${d.decision.decision_text}`);
   *   console.log(`Rationale: ${d.decision.rationale}`);
   * });
   * ```
   */
  async searchDecisions(query: string, limit: number = 10) {
    return this.semanticSearch.searchDecisions(query, limit);
  }

  /**
   * Get the timeline of changes for a specific file.
   *
   * Returns all edits, commits, and related conversations for a file across its history.
   *
   * @param filePath - Path to the file (relative to project root)
   * @returns Timeline of file changes with conversations and commits
   *
   * @example
   * ```typescript
   * const timeline = memory.getFileTimeline('src/index.ts');
   * console.log(`${timeline.length} changes to this file`);
   * ```
   */
  getFileTimeline(filePath: string) {
    return this.storage.getFileTimeline(filePath);
  }

  /**
   * Get statistics about the indexed conversation data.
   *
   * @returns Object containing counts for conversations, messages, decisions, mistakes, and commits
   *
   * @example
   * ```typescript
   * const stats = memory.getStats();
   * console.log(`Indexed ${stats.conversations.count} conversations`);
   * console.log(`Extracted ${stats.decisions.count} decisions`);
   * ```
   */
  getStats() {
    return this.storage.getStats();
  }

  /**
   * Get the underlying storage instance for direct database access.
   *
   * Use with caution - prefer using the high-level methods when possible.
   *
   * @returns ConversationStorage instance
   * @internal
   */
  getStorage() {
    return this.storage;
  }

  /**
   * Get the semantic search instance for advanced search operations.
   *
   * @returns SemanticSearch instance
   * @internal
   */
  getSemanticSearch() {
    return this.semanticSearch;
  }

  /**
   * Filter MCP conversations from parse results.
   *
   * Implements the exclusion logic for MCP tool conversations to prevent
   * self-referential loops and reduce noise in the index.
   *
   * Strategy: Filter at MESSAGE level, not conversation level.
   * - Keep all conversations
   * - Exclude only messages that invoke specified MCP tools and their responses
   */
  private filterMcpConversations(result: ParseResult, options: IndexOptions): ParseResult {
    // Determine which MCP servers to exclude
    const serversToExclude = new Set<string>();

    if (options.excludeMcpServers && options.excludeMcpServers.length > 0) {
      // Explicit list of servers to exclude
      options.excludeMcpServers.forEach(s => serversToExclude.add(s));
    } else if (options.excludeMcpConversations === 'self-only') {
      // Exclude only conversation-memory server
      serversToExclude.add('conversation-memory');
    } else if (options.excludeMcpConversations === 'all-mcp' || options.excludeMcpConversations === true) {
      // Exclude all MCP tool uses - collect all server names from tool uses
      for (const toolUse of result.tool_uses) {
        if (toolUse.tool_name.startsWith('mcp__')) {
          const parts = toolUse.tool_name.split('__');
          if (parts.length >= 2) {
            serversToExclude.add(parts[1]);
          }
        }
      }
    }

    if (serversToExclude.size === 0) {
      return result; // Nothing to filter
    }

    // Build set of excluded tool_use IDs (tools from excluded servers)
    const excludedToolUseIds = new Set<string>();
    for (const toolUse of result.tool_uses) {
      if (toolUse.tool_name.startsWith('mcp__')) {
        const parts = toolUse.tool_name.split('__');
        if (parts.length >= 2 && serversToExclude.has(parts[1])) {
          excludedToolUseIds.add(toolUse.id);
        }
      }
    }

    // Build set of excluded message IDs (messages containing excluded tool uses or their results)
    const excludedMessageIds = new Set<string>();

    // Exclude assistant messages that contain excluded tool uses
    for (const toolUse of result.tool_uses) {
      if (excludedToolUseIds.has(toolUse.id)) {
        excludedMessageIds.add(toolUse.message_id);
      }
    }

    // Exclude user messages that contain tool results for excluded tool uses
    for (const toolResult of result.tool_results) {
      if (excludedToolUseIds.has(toolResult.tool_use_id)) {
        excludedMessageIds.add(toolResult.message_id);
      }
    }

    if (excludedMessageIds.size > 0) {
      console.log(`\n⚠️ Excluding ${excludedMessageIds.size} message(s) containing MCP tool calls from: ${Array.from(serversToExclude).join(', ')}`);
    }

    // Build set of remaining message IDs after filtering
    const remainingMessageIds = new Set(
      result.messages
        .filter(m => !excludedMessageIds.has(m.id))
        .map(m => m.id)
    );

    // Filter messages and related entities
    // IMPORTANT: file_edits must also be filtered to avoid FK constraint violations
    return {
      conversations: result.conversations, // Keep ALL conversations
      messages: result.messages.filter(m => !excludedMessageIds.has(m.id)),
      tool_uses: result.tool_uses.filter(t => !excludedToolUseIds.has(t.id)),
      tool_results: result.tool_results.filter(tr => !excludedToolUseIds.has(tr.tool_use_id)),
      file_edits: result.file_edits.filter(fe => remainingMessageIds.has(fe.message_id)),
      thinking_blocks: result.thinking_blocks.filter(tb => remainingMessageIds.has(tb.message_id)),
      indexed_folders: result.indexed_folders, // Preserve folder metadata
    };
  }
}
