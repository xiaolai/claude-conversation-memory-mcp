/**
 * MCP Tool Handlers - Implementation of all 13 tools for the conversation-memory MCP server.
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
import type * as Types from "../types/ToolTypes.js";
import { DocumentationGenerator } from "../documentation/DocumentationGenerator.js";
import { ProjectMigration } from "../utils/ProjectMigration.js";
import { pathToProjectFolderName } from "../utils/sanitization.js";
import { DeletionService } from "../storage/DeletionService.js";
import { readdirSync } from "fs";
import { join } from "path";

/**
 * Default similarity score used when semantic search is not available.
 * This applies to SQL-based searches where semantic embeddings are not used.
 */
const DEFAULT_SIMILARITY_SCORE = 1.0;

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
 * Tool handlers for the conversation-memory MCP server.
 *
 * Provides methods for indexing, searching, and managing conversation history.
 */
export class ToolHandlers {
  private migration: ProjectMigration;

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
   * console.log(result.message); // "Indexed 5 conversation(s) with 245 messages..."
   * ```
   */
  async indexConversations(args: Record<string, unknown>): Promise<Types.IndexConversationsResponse> {
    const typedArgs = args as Types.IndexConversationsArgs;
    const projectPath = typedArgs.project_path || process.cwd();
    const sessionId = typedArgs.session_id;
    const includeThinking = typedArgs.include_thinking ?? false;
    const enableGit = typedArgs.enable_git ?? true;
    const excludeMcpConversations = typedArgs.exclude_mcp_conversations ?? 'self-only';
    const excludeMcpServers = typedArgs.exclude_mcp_servers;

    // Check if we need to use a project-specific database
    // This is needed when indexing a different project than where the MCP server is running
    const currentDbPath = this.db.getDbPath();
    const targetProjectFolderName = pathToProjectFolderName(projectPath);
    const isCurrentProject = currentDbPath.includes(targetProjectFolderName);

    let indexResult;
    let stats;

    if (!isCurrentProject) {
      // Create a project-specific database for the target project
      const { SQLiteManager } = await import("../storage/SQLiteManager.js");
      const { ConversationStorage } = await import("../storage/ConversationStorage.js");
      const { ConversationParser } = await import("../parsers/ConversationParser.js");
      const { DecisionExtractor } = await import("../parsers/DecisionExtractor.js");
      const { MistakeExtractor } = await import("../parsers/MistakeExtractor.js");
      const { SemanticSearch } = await import("../search/SemanticSearch.js");
      const { homedir } = await import("os");

      // Create dedicated database in the target project's .claude folder
      const projectDbPath = join(
        homedir(),
        ".claude",
        "projects",
        targetProjectFolderName,
        ".claude-conversations-memory.db"
      );

      console.log(`\n📂 Using project-specific database for: ${projectPath}`);
      console.log(`   Database path: ${projectDbPath}`);

      const projectDb = new SQLiteManager({ dbPath: projectDbPath });

      try {
        const projectStorage = new ConversationStorage(projectDb);

        // Parse conversations from the target project
        const parser = new ConversationParser();
        let parseResult = parser.parseProject(projectPath, sessionId);

        // Filter MCP conversations if requested
        if (excludeMcpConversations || excludeMcpServers) {
          parseResult = this.filterMcpConversationsHelper(parseResult, {
            excludeMcpConversations,
            excludeMcpServers,
          });
        }

        // Store basic entities
        await projectStorage.storeConversations(parseResult.conversations);
        await projectStorage.storeMessages(parseResult.messages);
        await projectStorage.storeToolUses(parseResult.tool_uses);
        await projectStorage.storeToolResults(parseResult.tool_results);
        await projectStorage.storeFileEdits(parseResult.file_edits);

        if (includeThinking !== false) {
          await projectStorage.storeThinkingBlocks(parseResult.thinking_blocks);
        }

        // Extract and store decisions
        const decisionExtractor = new DecisionExtractor();
        const decisions = decisionExtractor.extractDecisions(
          parseResult.messages,
          parseResult.thinking_blocks
        );
        await projectStorage.storeDecisions(decisions);

        // Extract and store mistakes
        const mistakeExtractor = new MistakeExtractor();
        const mistakes = mistakeExtractor.extractMistakes(
          parseResult.messages,
          parseResult.tool_results
        );
        await projectStorage.storeMistakes(mistakes);

        // Generate embeddings for semantic search
        let embeddingError: string | undefined;
        try {
          const semanticSearch = new SemanticSearch(projectDb);
          await semanticSearch.indexMessages(parseResult.messages);
          await semanticSearch.indexDecisions(decisions);
          console.log(`✓ Generated embeddings for project: ${projectPath}`);
        } catch (embedError) {
          embeddingError = (embedError as Error).message;
          console.warn(`⚠️ Embedding generation failed:`, embeddingError);
          console.warn("   FTS fallback will be used for search");
        }

        // Get stats
        stats = projectStorage.getStats();

        indexResult = {
          embeddings_generated: !embeddingError,
          embedding_error: embeddingError,
          indexed_folders: parseResult.indexed_folders,
          database_path: projectDbPath,
        };
      } finally {
        // Close the project database
        projectDb.close();
      }
    } else {
      // Use the existing memory instance for the current project
      indexResult = await this.memory.indexConversations({
        projectPath,
        sessionId,
        includeThinking,
        enableGitIntegration: enableGit,
        excludeMcpConversations,
        excludeMcpServers,
      });

      stats = this.memory.getStats();
    }

    const sessionInfo = sessionId ? ` (session: ${sessionId})` : ' (all sessions)';
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
  }

  /**
   * Helper method to filter MCP conversations from parse results.
   * Extracted to be usable in both the main indexConversations and project-specific indexing.
   */
  private filterMcpConversationsHelper<T extends {
    conversations: unknown[];
    messages: Array<{ id: string }>;
    tool_uses: Array<{ id: string; tool_name: string; message_id: string }>;
    tool_results: Array<{ tool_use_id: string; message_id: string }>;
    file_edits: Array<{ message_id: string }>;
    thinking_blocks: Array<{ message_id: string }>;
    indexed_folders?: string[];
  }>(
    result: T,
    options: { excludeMcpConversations?: boolean | 'self-only' | 'all-mcp'; excludeMcpServers?: string[] }
  ): T {
    // Determine which MCP servers to exclude
    const serversToExclude = new Set<string>();

    if (options.excludeMcpServers && options.excludeMcpServers.length > 0) {
      options.excludeMcpServers.forEach(s => serversToExclude.add(s));
    } else if (options.excludeMcpConversations === 'self-only') {
      serversToExclude.add('conversation-memory');
    } else if (options.excludeMcpConversations === 'all-mcp' || options.excludeMcpConversations === true) {
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
      return result;
    }

    // Build set of excluded tool_use IDs
    const excludedToolUseIds = new Set<string>();
    for (const toolUse of result.tool_uses) {
      if (toolUse.tool_name.startsWith('mcp__')) {
        const parts = toolUse.tool_name.split('__');
        if (parts.length >= 2 && serversToExclude.has(parts[1])) {
          excludedToolUseIds.add(toolUse.id);
        }
      }
    }

    // Build set of excluded message IDs
    const excludedMessageIds = new Set<string>();
    for (const toolUse of result.tool_uses) {
      if (excludedToolUseIds.has(toolUse.id)) {
        excludedMessageIds.add(toolUse.message_id);
      }
    }
    for (const toolResult of result.tool_results) {
      if (excludedToolUseIds.has(toolResult.tool_use_id)) {
        excludedMessageIds.add(toolResult.message_id);
      }
    }

    if (excludedMessageIds.size > 0) {
      console.log(`\n⚠️ Excluding ${excludedMessageIds.size} message(s) containing MCP tool calls from: ${Array.from(serversToExclude).join(', ')}`);
    }

    const remainingMessageIds = new Set(
      result.messages
        .filter(m => !excludedMessageIds.has(m.id))
        .map(m => m.id)
    );

    return {
      ...result,
      messages: result.messages.filter(m => !excludedMessageIds.has(m.id)),
      tool_uses: result.tool_uses.filter(t => !excludedToolUseIds.has(t.id)),
      tool_results: result.tool_results.filter(tr => !excludedToolUseIds.has(tr.tool_use_id)),
      file_edits: result.file_edits.filter(fe => remainingMessageIds.has(fe.message_id)),
      thinking_blocks: result.thinking_blocks.filter(tb => remainingMessageIds.has(tb.message_id)),
    };
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
   *   console.log(`${r.similarity.toFixed(2)}: ${r.snippet}`);
   * });
   * ```
   */
  async searchConversations(args: Record<string, unknown>): Promise<Types.SearchConversationsResponse> {
    const typedArgs = args as unknown as Types.SearchConversationsArgs;
    const { query, limit = 10, offset = 0, date_range, scope = 'all', conversation_id } = typedArgs;

    // Handle global scope by delegating to searchAllConversations
    if (scope === 'global') {
      const { GlobalIndex } = await import("../storage/GlobalIndex.js");
      const { SQLiteManager } = await import("../storage/SQLiteManager.js");
      const { SemanticSearch } = await import("../search/SemanticSearch.js");

      const globalIndex = new GlobalIndex();
      const projects = globalIndex.getAllProjects();
      const allResults: Types.SearchResult[] = [];

      for (const project of projects) {
        let projectDb: SQLiteManager | null = null;
        try {
          projectDb = new SQLiteManager({ dbPath: project.db_path, readOnly: true });
          const semanticSearch = new SemanticSearch(projectDb);
          const localResults = await semanticSearch.searchConversations(query, limit + offset);

          const filteredResults = date_range
            ? localResults.filter((r: { message: { timestamp: number } }) => {
                const timestamp = r.message.timestamp;
                return timestamp >= date_range[0] && timestamp <= date_range[1];
              })
            : localResults;

          for (const result of filteredResults) {
            allResults.push({
              conversation_id: result.conversation.id,
              message_id: result.message.id,
              timestamp: new Date(result.message.timestamp).toISOString(),
              similarity: result.similarity,
              snippet: result.snippet,
              git_branch: result.conversation.git_branch,
              message_type: result.message.message_type,
              role: result.message.role,
            });
          }
        } catch (_error) {
          // Skip projects that fail to search (embedding errors, etc.)
          // Continue to next project
          continue;
        } finally {
          if (projectDb) {
            projectDb.close();
          }
        }
      }

      allResults.sort((a, b) => b.similarity - a.similarity);
      const paginatedResults = allResults.slice(offset, offset + limit);

      return {
        query,
        results: paginatedResults,
        total_found: paginatedResults.length,
        has_more: offset + limit < allResults.length,
        offset,
        scope: 'global',
      };
    }

    // Handle current session scope
    if (scope === 'current') {
      if (!conversation_id) {
        throw new Error("conversation_id is required when scope='current'");
      }

      const results = await this.memory.search(query, limit + offset);
      const filteredResults = results.filter(r => r.conversation.id === conversation_id);

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
   *   console.log(`Decision: ${d.decision_text}`);
   *   console.log(`Rationale: ${d.rationale}`);
   * });
   * ```
   */
  async getDecisions(args: Record<string, unknown>): Promise<Types.GetDecisionsResponse> {
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

    const results = await this.memory.searchDecisions(query, limit + offset);

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
      filteredResults = filteredResults.filter((r) => r.decision.conversation_id === conversation_id);
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
   * console.log(context.warning);
   * console.log(`${context.related_decisions.length} decisions affect this file`);
   * console.log(`${context.mistakes_to_avoid.length} mistakes to avoid`);
   * ```
   */
  async checkBeforeModify(args: Record<string, unknown>): Promise<Types.CheckBeforeModifyResponse> {
    const typedArgs = args as unknown as Types.CheckBeforeModifyArgs;
    const { file_path } = typedArgs;

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
   * console.log(`${evolution.total_edits} edits across ${evolution.timeline.length} events`);
   * evolution.timeline.forEach(event => {
   *   console.log(`${event.timestamp}: ${event.type}`);
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
   *   console.log(`${c.hash}: ${c.message}`);
   *   console.log(`  Conversation: ${c.conversation_id}`);
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

    let sql = "SELECT * FROM git_commits WHERE 1=1";
    const params: (string | number)[] = [];

    if (conversation_id || scope === 'current') {
      const targetId = conversation_id || typedArgs.conversation_id;
      if (!targetId) {
        throw new Error("conversation_id is required when scope='current'");
      }
      sql += " AND conversation_id = ?";
      params.push(targetId);
    }

    if (query) {
      sql += " AND message LIKE ?";
      params.push(`%${query}%`);
    }

    sql += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit + 1); // Fetch one extra to determine has_more
    params.push(offset);

    const commits = this.db.prepare(sql).all(...params) as Types.GitCommitRow[];
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
        files_changed: JSON.parse(c.files_changed || "[]"),
        conversation_id: c.conversation_id,
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
   *   console.log(`${m.mistake_type}: ${m.what_went_wrong}`);
   *   console.log(`Fix: ${m.correction}`);
   * });
   * ```
   */
  async searchMistakes(args: Record<string, unknown>): Promise<Types.SearchMistakesResponse> {
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

    const sanitized = sanitizeForLike(query);
    let sql = "SELECT * FROM mistakes WHERE what_went_wrong LIKE ? ESCAPE '\\'";
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
      sql += " AND conversation_id = ?";
      params.push(conversation_id);
    }

    sql += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit + 1); // Fetch one extra to determine has_more
    params.push(offset);

    const mistakes = this.db.prepare(sql).all(...params) as Types.MistakeRow[];
    const hasMore = mistakes.length > limit;
    const results = hasMore ? mistakes.slice(0, limit) : mistakes;

    return {
      query,
      mistake_type,
      mistakes: results.map((m) => ({
        mistake_id: m.id,
        mistake_type: m.mistake_type,
        what_went_wrong: m.what_went_wrong,
        correction: m.correction,
        user_correction_message: m.user_correction_message,
        files_affected: JSON.parse(m.files_affected || "[]"),
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
   *   console.log(`${r.type}: ${r.description}`);
   *   console.log(`Rationale: ${r.rationale}`);
   * });
   * ```
   */
  async getRequirements(args: Record<string, unknown>): Promise<Types.GetRequirementsResponse> {
    const typedArgs = args as unknown as Types.GetRequirementsArgs;
    const { component, type } = typedArgs;

    const sanitized = sanitizeForLike(component);
    let sql = "SELECT * FROM requirements WHERE description LIKE ? ESCAPE '\\' OR affects_components LIKE ? ESCAPE '\\'";
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
        affects_components: JSON.parse(r.affects_components || "[]"),
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
   * - `include_content`: Include tool content in response (default: true, false for metadata only)
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
      include_content = true,
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
        const toolInput = JSON.parse(t.tool_input || "{}");

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
   *   console.log(`Session ${s.conversation_id} (${s.message_count} messages)`);
   *   console.log(`Relevance: ${s.relevance_score.toFixed(2)}`);
   *   console.log(`Messages: ${s.relevant_messages.length} relevant`);
   * });
   * ```
   */
  async findSimilarSessions(args: Record<string, unknown>): Promise<Types.FindSimilarSessionsResponse> {
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
   * console.log(context.context_summary);
   * context.application_suggestions.forEach(s => console.log(`- ${s}`));
   * ```
   */
  async recallAndApply(args: Record<string, unknown>): Promise<Types.RecallAndApplyResponse> {
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
        rejected_approaches: Object.values(d.rejected_reasons),
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
      const fileChanges = this.db.getDatabase()
        .prepare(`
          SELECT
            file_path,
            COUNT(DISTINCT conversation_id) as change_count,
            MAX(timestamp) as last_modified,
            GROUP_CONCAT(DISTINCT conversation_id) as conversation_ids
          FROM messages
          WHERE file_path LIKE ?
          ${date_range ? 'AND timestamp BETWEEN ? AND ?' : ''}
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
        related_conversations: fc.conversation_ids.split(','),
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
          WHERE message LIKE ? ${file_path ? 'AND files_changed LIKE ?' : ''}
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
        files_affected: JSON.parse(c.files_changed || "[]"),
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
   * Creates documentation that shows WHAT exists in the code (via CODE-GRAPH-RAG-MCP)
   * and WHY it was built that way (via conversation history). Requires CODE-GRAPH-RAG-MCP
   * to be indexed first.
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
   * console.log(doc.documentation); // Markdown documentation
   * console.log(`Documented ${doc.statistics.modules} modules`);
   * ```
   */
  async generateDocumentation(args: Record<string, unknown>): Promise<Types.GenerateDocumentationResponse> {
    const typedArgs = args as unknown as Types.GenerateDocumentationArgs;
    const projectPath = typedArgs.project_path || process.cwd();
    const sessionId = typedArgs.session_id;
    const scope = typedArgs.scope || 'full';
    const moduleFilter = typedArgs.module_filter;

    console.log('\n📚 Starting documentation generation...');
    console.log(`Note: This tool requires CODE-GRAPH-RAG-MCP to be indexed first.`);
    console.log(`Please ensure you have run code-graph-rag index on this project.`);

    // Note: In a real implementation, we would call CODE-GRAPH-RAG-MCP tools here
    // For now, we'll create a placeholder that shows the structure
    const codeGraphData = {
      entities: [],
      hotspots: [],
      clones: [],
      graph: {}
    };

    const generator = new DocumentationGenerator(this.db);
    const documentation = await generator.generate(
      {
        projectPath,
        sessionId,
        scope,
        moduleFilter
      },
      codeGraphData
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
   * console.log(discovery.message);
   * discovery.candidates.forEach(c => {
   *   console.log(`Score ${c.score}: ${c.folder_name}`);
   *   console.log(`  Original path: ${c.stored_project_path}`);
   *   console.log(`  Stats: ${c.stats.conversations} conversations, ${c.stats.files} files`);
   * });
   * ```
   */
  async discoverOldConversations(args: Record<string, unknown>): Promise<Types.DiscoverOldConversationsResponse> {
    const typedArgs = args as Types.DiscoverOldConversationsArgs;
    const currentProjectPath = typedArgs.current_project_path || process.cwd();

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
   * console.log(preview.message); // "Dry run: Would migrate X files..."
   *
   * // Then, execute the migration
   * const result = await handlers.migrateProject({
   *   source_folder: '/path/to/old/conversations',
   *   old_project_path: '/old/path/to/project',
   *   new_project_path: '/new/path/to/project',
   *   dry_run: false,
   *   mode: 'migrate'
   * });
   * console.log(`Migrated ${result.files_copied} files`);
   * ```
   */
  async migrateProject(args: Record<string, unknown>): Promise<Types.MigrateProjectResponse> {
    const typedArgs = args as unknown as Types.MigrateProjectArgs;
    const sourceFolder = typedArgs.source_folder;
    const oldProjectPath = typedArgs.old_project_path;
    const newProjectPath = typedArgs.new_project_path;
    const dryRun = typedArgs.dry_run ?? false;
    const mode = typedArgs.mode ?? "migrate";

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
    const keywords = typedArgs.keywords || [];
    const projectPath = typedArgs.project_path || process.cwd();
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

    const globalIndex = new GlobalIndex();

    try {
      const projects: Array<{
        project_path: string;
        source_type: "claude-code" | "codex";
        message_count: number;
        conversation_count: number;
      }> = [];
      const errors: Array<{ project_path: string; error: string }> = [];

      let totalMessages = 0;
      let totalConversations = 0;
      let totalDecisions = 0;
      let totalMistakes = 0;

      // Index Codex if requested
      if (include_codex && existsSync(codex_path)) {
        try {
          const { CodexConversationParser } = await import("../parsers/CodexConversationParser.js");
          const { SQLiteManager } = await import("../storage/SQLiteManager.js");
          const { ConversationStorage } = await import("../storage/ConversationStorage.js");
          const { SemanticSearch } = await import("../search/SemanticSearch.js");
          const { DecisionExtractor } = await import("../parsers/DecisionExtractor.js");
          const { MistakeExtractor } = await import("../parsers/MistakeExtractor.js");

          // Create dedicated database for Codex
          const codexDbPath = join(codex_path, ".codex-conversations-memory.db");
          const codexDb = new SQLiteManager({ dbPath: codexDbPath });
          const codexStorage = new ConversationStorage(codexDb);

          // Get last indexed time for incremental mode
          let codexLastIndexedMs: number | undefined;
          if (incremental) {
            const existingProject = globalIndex.getProject(codex_path);
            if (existingProject) {
              codexLastIndexedMs = existingProject.last_indexed;
            }
          }

          // Parse Codex sessions
          const parser = new CodexConversationParser();
          const parseResult = parser.parseSession(codex_path, undefined, codexLastIndexedMs);

          // Store all parsed data
          await codexStorage.storeConversations(parseResult.conversations);
          await codexStorage.storeMessages(parseResult.messages);
          await codexStorage.storeToolUses(parseResult.tool_uses);
          await codexStorage.storeToolResults(parseResult.tool_results);
          await codexStorage.storeFileEdits(parseResult.file_edits);
          await codexStorage.storeThinkingBlocks(parseResult.thinking_blocks);

          // Extract and store decisions
          const decisionExtractor = new DecisionExtractor();
          const decisions = decisionExtractor.extractDecisions(
            parseResult.messages,
            parseResult.thinking_blocks
          );
          await codexStorage.storeDecisions(decisions);

          // Extract and store mistakes
          const mistakeExtractor = new MistakeExtractor();
          const mistakes = mistakeExtractor.extractMistakes(
            parseResult.messages,
            parseResult.tool_results
          );
          await codexStorage.storeMistakes(mistakes);

          // Generate embeddings for semantic search
          try {
            const semanticSearch = new SemanticSearch(codexDb);
            await semanticSearch.indexMessages(parseResult.messages, incremental);
            await semanticSearch.indexDecisions(decisions, incremental);
            console.log(`✓ Generated embeddings for Codex project`);
          } catch (embedError) {
            console.warn("⚠️ Embedding generation failed for Codex:", (embedError as Error).message);
            console.warn("   FTS fallback will be used for search");
          }

          // Get stats from the database
          const stats = codexDb.getDatabase()
            .prepare("SELECT COUNT(*) as count FROM conversations")
            .get() as { count: number };

          const messageStats = codexDb.getDatabase()
            .prepare("SELECT COUNT(*) as count FROM messages")
            .get() as { count: number };

          const decisionStats = codexDb.getDatabase()
            .prepare("SELECT COUNT(*) as count FROM decisions")
            .get() as { count: number };

          const mistakeStats = codexDb.getDatabase()
            .prepare("SELECT COUNT(*) as count FROM mistakes")
            .get() as { count: number };

          // Register in global index
          globalIndex.registerProject({
            project_path: codex_path,
            source_type: "codex",
            db_path: codexDbPath,
            message_count: messageStats.count,
            conversation_count: stats.count,
            decision_count: decisionStats.count,
            mistake_count: mistakeStats.count,
            metadata: {
              indexed_folders: parseResult.indexed_folders || [],
            },
          });

          projects.push({
            project_path: codex_path,
            source_type: "codex",
            message_count: messageStats.count,
            conversation_count: stats.count,
          });

          totalMessages += messageStats.count;
          totalConversations += stats.count;
          totalDecisions += decisionStats.count;
          totalMistakes += mistakeStats.count;

          // Close the Codex database
          codexDb.close();
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
          const { SQLiteManager } = await import("../storage/SQLiteManager.js");
          const { ConversationStorage } = await import("../storage/ConversationStorage.js");
          const { ConversationParser } = await import("../parsers/ConversationParser.js");
          const { DecisionExtractor } = await import("../parsers/DecisionExtractor.js");
          const { MistakeExtractor } = await import("../parsers/MistakeExtractor.js");
          const { statSync } = await import("fs");

          const projectFolders = readdirSync(claude_projects_path);

          for (const folder of projectFolders) {
            const folderPath = join(claude_projects_path, folder);

            try {
              // Skip if not a directory
              if (!statSync(folderPath).isDirectory()) {
                continue;
              }

              // Create dedicated database for this Claude Code project
              const projectDbPath = join(folderPath, ".claude-conversations-memory.db");
              const projectDb = new SQLiteManager({ dbPath: projectDbPath });
              const projectStorage = new ConversationStorage(projectDb);

              // Get last indexed time for incremental mode
              let lastIndexedMs: number | undefined;
              if (incremental) {
                const existingProject = globalIndex.getProject(folderPath);
                if (existingProject) {
                  lastIndexedMs = existingProject.last_indexed;
                }
              }

              // Parse Claude Code conversations directly from this folder
              const parser = new ConversationParser();
              const parseResult = parser.parseFromFolder(folderPath, undefined, lastIndexedMs);

              // Skip empty projects
              if (parseResult.messages.length === 0) {
                projectDb.close();
                continue;
              }

              // Store all parsed data
              await projectStorage.storeConversations(parseResult.conversations);
              await projectStorage.storeMessages(parseResult.messages);
              await projectStorage.storeToolUses(parseResult.tool_uses);
              await projectStorage.storeToolResults(parseResult.tool_results);
              await projectStorage.storeFileEdits(parseResult.file_edits);
              await projectStorage.storeThinkingBlocks(parseResult.thinking_blocks);

              // Extract and store decisions
              const decisionExtractor = new DecisionExtractor();
              const decisions = decisionExtractor.extractDecisions(
                parseResult.messages,
                parseResult.thinking_blocks
              );
              await projectStorage.storeDecisions(decisions);

              // Extract and store mistakes
              const mistakeExtractor = new MistakeExtractor();
              const mistakes = mistakeExtractor.extractMistakes(
                parseResult.messages,
                parseResult.tool_results
              );
              await projectStorage.storeMistakes(mistakes);

              // Generate embeddings for semantic search
              try {
                const { SemanticSearch } = await import("../search/SemanticSearch.js");
                const semanticSearch = new SemanticSearch(projectDb);
                await semanticSearch.indexMessages(parseResult.messages, incremental);
                await semanticSearch.indexDecisions(decisions, incremental);
                console.log(`✓ Generated embeddings for project: ${folder}`);
              } catch (embedError) {
                console.warn(`⚠️ Embedding generation failed for ${folder}:`, (embedError as Error).message);
                console.warn("   FTS fallback will be used for search");
              }

              // Get stats from the database
              const stats = projectDb.getDatabase()
                .prepare("SELECT COUNT(*) as count FROM conversations")
                .get() as { count: number };

              const messageStats = projectDb.getDatabase()
                .prepare("SELECT COUNT(*) as count FROM messages")
                .get() as { count: number };

              const decisionStats = projectDb.getDatabase()
                .prepare("SELECT COUNT(*) as count FROM decisions")
                .get() as { count: number };

              const mistakeStats = projectDb.getDatabase()
                .prepare("SELECT COUNT(*) as count FROM mistakes")
                .get() as { count: number };

              // Register in global index with the project-specific database path
              globalIndex.registerProject({
                project_path: folderPath,
                source_type: "claude-code",
                db_path: projectDbPath,
                message_count: messageStats.count,
                conversation_count: stats.count,
                decision_count: decisionStats.count,
                mistake_count: mistakeStats.count,
              });

              projects.push({
                project_path: folderPath,
                source_type: "claude-code",
                message_count: messageStats.count,
                conversation_count: stats.count,
              });

              totalMessages += messageStats.count;
              totalConversations += stats.count;
              totalDecisions += decisionStats.count;
              totalMistakes += mistakeStats.count;

              // Close the project database
              projectDb.close();
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
    const { GlobalIndex } = await import("../storage/GlobalIndex.js");
    const { SQLiteManager } = await import("../storage/SQLiteManager.js");
    const { SemanticSearch } = await import("../search/SemanticSearch.js");
    const typedArgs = args as unknown as Types.SearchAllConversationsArgs;
    const { query, limit = 20, offset = 0, date_range, source_type = "all" } = typedArgs;

    const globalIndex = new GlobalIndex();

    try {
      const projects = globalIndex.getAllProjects(
        source_type === "all" ? undefined : source_type
      );

      const allResults: Types.GlobalSearchResult[] = [];
      let claudeCodeResults = 0;
      let codexResults = 0;

      for (const project of projects) {
        let projectDb: SQLiteManager | null = null;
        try {
          // Open this project's database
          projectDb = new SQLiteManager({ dbPath: project.db_path, readOnly: true });
          const semanticSearch = new SemanticSearch(projectDb);

          // Search this specific project's database
          const localResults = await semanticSearch.searchConversations(query, limit);

          // Filter by date range if specified
          const filteredResults = date_range
            ? localResults.filter((r: { message: { timestamp: number } }) => {
                const timestamp = r.message.timestamp;
                return timestamp >= date_range[0] && timestamp <= date_range[1];
              })
            : localResults;

          // Enrich results with project info
          for (const result of filteredResults) {
            allResults.push({
              conversation_id: result.conversation.id,
              message_id: result.message.id,
              timestamp: new Date(result.message.timestamp).toISOString(),
              similarity: result.similarity,
              snippet: result.snippet,
              git_branch: result.conversation.git_branch,
              message_type: result.message.message_type,
              role: result.message.role,
              project_path: project.project_path,
              source_type: project.source_type,
            });

            if (project.source_type === "claude-code") {
              claudeCodeResults++;
            } else {
              codexResults++;
            }
          }
        } catch (_error) {
          // Skip projects that fail to search
          continue;
        } finally {
          // Close project database
          if (projectDb) {
            projectDb.close();
          }
        }
      }

      // Sort by similarity and paginate
      const sortedResults = allResults.sort((a, b) => b.similarity - a.similarity);
      const paginatedResults = sortedResults.slice(offset, offset + limit);

      return {
        query,
        results: paginatedResults,
        total_found: paginatedResults.length,
        has_more: offset + limit < sortedResults.length,
        offset,
        projects_searched: projects.length,
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
    const { GlobalIndex } = await import("../storage/GlobalIndex.js");
    const { SQLiteManager } = await import("../storage/SQLiteManager.js");
    const typedArgs = args as unknown as Types.GetAllDecisionsArgs;
    const { query, file_path, limit = 20, offset = 0, source_type = 'all' } = typedArgs;

    const globalIndex = new GlobalIndex();

    try {
      const projects = globalIndex.getAllProjects(
        source_type === "all" ? undefined : source_type
      );

      const allDecisions: Types.GlobalDecision[] = [];

      for (const project of projects) {
        let projectDb: SQLiteManager | null = null;
        try {
          projectDb = new SQLiteManager({ dbPath: project.db_path, readOnly: true });

          const sanitized = sanitizeForLike(query);
          let sql = "SELECT * FROM decisions WHERE decision_text LIKE ? ESCAPE '\\\\'";
          const params: (string | number)[] = [`%${sanitized}%`];

          if (file_path) {
            sql += " AND related_files LIKE ?";
            params.push(`%${file_path}%`);
          }

          sql += " ORDER BY timestamp DESC LIMIT ?";
          params.push(limit + offset + 1);

          const decisions = projectDb.prepare(sql).all(...params) as Types.DecisionRow[];

          for (const d of decisions) {
            allDecisions.push({
              decision_id: d.id,
              decision_text: d.decision_text,
              rationale: d.rationale,
              alternatives_considered: JSON.parse(d.alternatives_considered || "[]"),
              rejected_reasons: JSON.parse(d.rejected_reasons || "{}"),
              context: d.context,
              related_files: JSON.parse(d.related_files || "[]"),
              related_commits: JSON.parse(d.related_commits || "[]"),
              timestamp: new Date(d.timestamp).toISOString(),
              similarity: DEFAULT_SIMILARITY_SCORE,
              project_path: project.project_path,
              source_type: project.source_type,
            });
          }
        } catch (_error) {
          continue;
        } finally {
          if (projectDb) {
            projectDb.close();
          }
        }
      }

      // Sort by timestamp and paginate
      const sortedDecisions = allDecisions.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
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
    const { GlobalIndex } = await import("../storage/GlobalIndex.js");
    const { SQLiteManager } = await import("../storage/SQLiteManager.js");
    const typedArgs = args as unknown as Types.SearchAllMistakesArgs;
    const { query, mistake_type, limit = 20, offset = 0, source_type = 'all' } = typedArgs;

    const globalIndex = new GlobalIndex();

    try {
      const projects = globalIndex.getAllProjects(
        source_type === "all" ? undefined : source_type
      );

      const allMistakes: Types.GlobalMistake[] = [];

      for (const project of projects) {
        let projectDb: SQLiteManager | null = null;
        try {
          projectDb = new SQLiteManager({ dbPath: project.db_path, readOnly: true });

          const sanitized = sanitizeForLike(query);
          let sql = "SELECT * FROM mistakes WHERE what_went_wrong LIKE ? ESCAPE '\\\\'";
          const params: (string | number)[] = [`%${sanitized}%`];

          if (mistake_type) {
            sql += " AND mistake_type = ?";
            params.push(mistake_type);
          }

          sql += " ORDER BY timestamp DESC LIMIT ?";
          params.push(limit + offset + 1);

          const mistakes = projectDb.prepare(sql).all(...params) as Types.MistakeRow[];

          for (const m of mistakes) {
            allMistakes.push({
              mistake_id: m.id,
              mistake_type: m.mistake_type,
              what_went_wrong: m.what_went_wrong,
              correction: m.correction,
              user_correction_message: m.user_correction_message,
              files_affected: JSON.parse(m.files_affected || "[]"),
              timestamp: new Date(m.timestamp).toISOString(),
              project_path: project.project_path,
              source_type: project.source_type,
            });
          }
        } catch (_error) {
          continue;
        } finally {
          if (projectDb) {
            projectDb.close();
          }
        }
      }

      // Sort by timestamp and paginate
      const sortedMistakes = allMistakes.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      const paginatedMistakes = sortedMistakes.slice(offset, offset + limit);

      return {
        query,
        mistakes: paginatedMistakes,
        total_found: paginatedMistakes.length,
        has_more: offset + limit < sortedMistakes.length,
        offset,
        projects_searched: projects.length,
        message: `Found ${paginatedMistakes.length} mistake(s) across ${projects.length} project(s)`,
      };
    } finally {
      globalIndex.close();
    }
  }
}
