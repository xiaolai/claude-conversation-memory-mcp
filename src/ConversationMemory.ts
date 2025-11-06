/**
 * Main Orchestrator - Coordinates all components
 */

import { getSQLiteManager, SQLiteManager } from "./storage/SQLiteManager.js";
import { ConversationStorage } from "./storage/ConversationStorage.js";
import { ConversationParser, type ParseResult } from "./parsers/ConversationParser.js";
import { DecisionExtractor } from "./parsers/DecisionExtractor.js";
import { MistakeExtractor } from "./parsers/MistakeExtractor.js";
import { GitIntegrator } from "./parsers/GitIntegrator.js";
import { RequirementsExtractor } from "./parsers/RequirementsExtractor.js";
import { SemanticSearch } from "./search/SemanticSearch.js";

export interface IndexOptions {
  projectPath: string;
  sessionId?: string;
  includeThinking?: boolean;
  enableGitIntegration?: boolean;
  excludeMcpConversations?: boolean | 'self-only' | 'all-mcp';
  excludeMcpServers?: string[];
}

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
    this.parser = new ConversationParser();
    this.decisionExtractor = new DecisionExtractor();
    this.mistakeExtractor = new MistakeExtractor();
    this.requirementsExtractor = new RequirementsExtractor();
    this.semanticSearch = new SemanticSearch(this.sqliteManager);
  }

  /**
   * Index conversations for a project
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
   * Search conversations
   */
  async search(query: string, limit: number = 10) {
    return this.semanticSearch.searchConversations(query, limit);
  }

  /**
   * Search decisions
   */
  async searchDecisions(query: string, limit: number = 10) {
    return this.semanticSearch.searchDecisions(query, limit);
  }

  /**
   * Get file timeline
   */
  getFileTimeline(filePath: string) {
    return this.storage.getFileTimeline(filePath);
  }

  /**
   * Get statistics
   */
  getStats() {
    return this.storage.getStats();
  }

  /**
   * Get storage instance
   */
  getStorage() {
    return this.storage;
  }

  /**
   * Get semantic search instance
   */
  getSemanticSearch() {
    return this.semanticSearch;
  }

  /**
   * Filter MCP conversations from parse results
   * Strategy: Filter at MESSAGE level, not conversation level
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

    // Filter messages and related entities
    return {
      conversations: result.conversations, // Keep ALL conversations
      messages: result.messages.filter(m => !excludedMessageIds.has(m.id)),
      tool_uses: result.tool_uses.filter(t => !excludedToolUseIds.has(t.id)),
      tool_results: result.tool_results.filter(tr => !excludedToolUseIds.has(tr.tool_use_id)),
      file_edits: result.file_edits, // Keep all file edits
      thinking_blocks: result.thinking_blocks.filter(tb => !excludedMessageIds.has(tb.message_id)),
      indexed_folders: result.indexed_folders, // Preserve folder metadata
    };
  }
}
