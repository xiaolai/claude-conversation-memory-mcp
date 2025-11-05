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
  async indexConversations(options: IndexOptions): Promise<{ embeddings_generated: boolean; embedding_error?: string }> {
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

    // Return embedding status
    return {
      embeddings_generated: !embeddingError,
      embedding_error: embeddingError
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
   */
  private filterMcpConversations(result: ParseResult, options: IndexOptions): ParseResult {
    const shouldExcludeConversation = (conv: typeof result.conversations[0]): boolean => {
      const metadata = conv.metadata as { mcp_usage?: { detected: boolean; servers: string[] } };

      if (!metadata.mcp_usage?.detected) {
        return false; // No MCP usage, don't exclude
      }

      // Check exclude_mcp_servers first (most specific)
      if (options.excludeMcpServers && options.excludeMcpServers.length > 0) {
        return metadata.mcp_usage.servers.some(
          server => options.excludeMcpServers?.includes(server)
        );
      }

      // Check exclude_mcp_conversations setting
      if (options.excludeMcpConversations === 'self-only') {
        return metadata.mcp_usage.servers.includes('conversation-memory');
      }

      if (options.excludeMcpConversations === 'all-mcp' || options.excludeMcpConversations === true) {
        return true; // Exclude all MCP conversations
      }

      return false;
    };

    // Build set of excluded conversation IDs
    const excludedConvIds = new Set(
      result.conversations
        .filter(shouldExcludeConversation)
        .map(c => c.id)
    );

    if (excludedConvIds.size > 0) {
      console.log(`\n⚠️ Excluding ${excludedConvIds.size} MCP conversation(s) from indexing`);
    }

    // Filter all related entities
    return {
      conversations: result.conversations.filter(c => !excludedConvIds.has(c.id)),
      messages: result.messages.filter(m => !excludedConvIds.has(m.conversation_id)),
      tool_uses: result.tool_uses.filter(t => {
        const msg = result.messages.find(m => m.id === t.message_id);
        return msg && !excludedConvIds.has(msg.conversation_id);
      }),
      tool_results: result.tool_results.filter(tr => {
        const toolUse = result.tool_uses.find(tu => tu.id === tr.tool_use_id);
        if (!toolUse) {return false;}
        const msg = result.messages.find(m => m.id === toolUse.message_id);
        return msg && !excludedConvIds.has(msg.conversation_id);
      }),
      file_edits: result.file_edits.filter(fe => !excludedConvIds.has(fe.conversation_id)),
      thinking_blocks: result.thinking_blocks.filter(tb => {
        const msg = result.messages.find(m => m.id === tb.message_id);
        return msg && !excludedConvIds.has(msg.conversation_id);
      }),
    };
  }
}
