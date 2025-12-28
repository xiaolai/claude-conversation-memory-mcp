/**
 * DocumentationGenerator - Main orchestrator for comprehensive documentation
 */

import { CodeAnalyzer, type CodeGraphRagData } from './CodeAnalyzer.js';
import { ConversationAnalyzer } from './ConversationAnalyzer.js';
import { CrossReferencer } from './CrossReferencer.js';
import { MarkdownFormatter } from './MarkdownFormatter.js';
import type { SQLiteManager } from '../storage/SQLiteManager.js';
import type { DocumentationOptions } from './types.js';

export class DocumentationGenerator {
  private codeAnalyzer: CodeAnalyzer;
  private conversationAnalyzer: ConversationAnalyzer;
  private crossReferencer: CrossReferencer;
  private formatter: MarkdownFormatter;

  constructor(db: SQLiteManager) {
    this.codeAnalyzer = new CodeAnalyzer();
    this.conversationAnalyzer = new ConversationAnalyzer(db);
    this.crossReferencer = new CrossReferencer();
    this.formatter = new MarkdownFormatter();
  }

  /**
   * Generate comprehensive documentation
   *
   * @param options - Documentation options
   * @param codeGraphData - Data from CODE-GRAPH-RAG-MCP (must be fetched externally)
   * @returns Markdown documentation
   */
  async generate(options: DocumentationOptions, codeGraphData: CodeGraphRagData): Promise<string> {
    console.error('\n📚 Generating Comprehensive Documentation');
    console.error(`Project: ${options.projectPath}`);
    console.error(`Scope: ${options.scope}`);
    if (options.sessionId) {
      console.error(`Session: ${options.sessionId}`);
    }
    if (options.moduleFilter) {
      console.error(`Filter: ${options.moduleFilter}`);
    }

    try {
      // Step 1: Analyze code structure
      const codeData = await this.codeAnalyzer.analyze(codeGraphData);

      // Step 2: Analyze conversation history
      const conversationData = await this.conversationAnalyzer.analyze(
        options.projectPath,
        options.sessionId
      );

      // Step 3: Cross-reference code and conversations
      const linkedData = await this.crossReferencer.link(codeData, conversationData);

      // Step 4: Format as markdown
      const documentation = this.formatter.format(linkedData, options);

      console.error('✅ Documentation generated successfully');
      console.error(`   Modules: ${linkedData.modules.length}`);
      console.error(`   Decisions: ${linkedData.statistics.totalDecisions}`);
      console.error(`   Mistakes: ${linkedData.statistics.totalMistakes}`);

      return documentation;

    } catch (error) {
      console.error('❌ Error generating documentation:', error);
      throw error;
    }
  }
}
