/**
 * MCP Tool Handlers - Implementation of all 11 tools
 */

import { ConversationMemory } from "../ConversationMemory.js";
import type { SQLiteManager } from "../storage/SQLiteManager.js";
import { sanitizeForLike } from "../utils/sanitization.js";
import type * as Types from "../types/ToolTypes.js";
import { DocumentationGenerator } from "../documentation/DocumentationGenerator.js";

export class ToolHandlers {
  constructor(private memory: ConversationMemory, private db: SQLiteManager) {}

  /**
   * Tool 1: index_conversations
   */
  async indexConversations(args: Record<string, unknown>): Promise<Types.IndexConversationsResponse> {
    const typedArgs = args as Types.IndexConversationsArgs;
    const projectPath = typedArgs.project_path || process.cwd();
    const sessionId = typedArgs.session_id;
    const includeThinking = typedArgs.include_thinking ?? false;
    const enableGit = typedArgs.enable_git ?? true;
    const excludeMcpConversations = typedArgs.exclude_mcp_conversations ?? 'self-only';
    const excludeMcpServers = typedArgs.exclude_mcp_servers;

    const indexResult = await this.memory.indexConversations({
      projectPath,
      sessionId,
      includeThinking,
      enableGitIntegration: enableGit,
      excludeMcpConversations,
      excludeMcpServers,
    });

    const stats = this.memory.getStats();

    const sessionInfo = sessionId ? ` (session: ${sessionId})` : ' (all sessions)';
    let message = `Indexed ${stats.conversations.count} conversation(s) with ${stats.messages.count} messages${sessionInfo}`;

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
      stats,
      embeddings_generated: indexResult.embeddings_generated,
      embedding_error: indexResult.embedding_error,
      message,
    };
  }

  /**
   * Tool 2: search_conversations
   */
  async searchConversations(args: Record<string, unknown>): Promise<Types.SearchConversationsResponse> {
    const typedArgs = args as unknown as Types.SearchConversationsArgs;
    const { query, limit = 10, date_range } = typedArgs;

    const filter: Record<string, unknown> = {};
    if (date_range) {
      filter.date_range = date_range;
    }

    const results = await this.memory.search(query, limit);

    return {
      query,
      results: results.map((r) => ({
        conversation_id: r.conversation.id,
        message_id: r.message.id,
        timestamp: new Date(r.message.timestamp).toISOString(),
        similarity: r.similarity,
        snippet: r.snippet,
        git_branch: r.conversation.git_branch,
        message_type: r.message.message_type,
        role: r.message.role,
      })),
      total_found: results.length,
    };
  }

  /**
   * Tool 3: get_decisions
   */
  async getDecisions(args: Record<string, unknown>): Promise<Types.GetDecisionsResponse> {
    const typedArgs = args as unknown as Types.GetDecisionsArgs;
    const { query, file_path, limit = 10 } = typedArgs;

    const results = await this.memory.searchDecisions(query, limit);

    // Filter by file if specified
    let filteredResults = results;
    if (file_path) {
      filteredResults = results.filter((r) =>
        r.decision.related_files.includes(file_path)
      );
    }

    return {
      query,
      file_path,
      decisions: filteredResults.map((r) => ({
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
      total_found: filteredResults.length,
    };
  }

  /**
   * Tool 4: check_before_modify
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
   * Tool 5: get_file_evolution
   */
  async getFileEvolution(args: Record<string, unknown>): Promise<Types.GetFileEvolutionResponse> {
    const typedArgs = args as unknown as Types.GetFileEvolutionArgs;
    const { file_path, include_decisions = true, include_commits = true } = typedArgs;

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

    return {
      file_path,
      total_edits: timeline.edits.length,
      timeline: events,
    };
  }

  /**
   * Tool 6: link_commits_to_conversations
   */
  async linkCommitsToConversations(args: Record<string, unknown>): Promise<Types.LinkCommitsToConversationsResponse> {
    const typedArgs = args as Types.LinkCommitsToConversationsArgs;
    const { query, conversation_id, limit = 20 } = typedArgs;

    let sql = "SELECT * FROM git_commits WHERE 1=1";
    const params: (string | number)[] = [];

    if (conversation_id) {
      sql += " AND conversation_id = ?";
      params.push(conversation_id);
    }

    if (query) {
      sql += " AND message LIKE ?";
      params.push(`%${query}%`);
    }

    sql += " ORDER BY timestamp DESC LIMIT ?";
    params.push(limit);

    const commits = this.db.prepare(sql).all(...params) as Types.GitCommitRow[];

    return {
      query,
      conversation_id,
      commits: commits.map((c) => ({
        hash: c.hash.substring(0, 7),
        full_hash: c.hash,
        message: c.message,
        author: c.author,
        timestamp: new Date(c.timestamp).toISOString(),
        branch: c.branch,
        files_changed: JSON.parse(c.files_changed || "[]"),
        conversation_id: c.conversation_id,
      })),
      total_found: commits.length,
    };
  }

  /**
   * Tool 7: search_mistakes
   */
  async searchMistakes(args: Record<string, unknown>): Promise<Types.SearchMistakesResponse> {
    const typedArgs = args as unknown as Types.SearchMistakesArgs;
    const { query, mistake_type, limit = 10 } = typedArgs;

    const sanitized = sanitizeForLike(query);
    let sql = "SELECT * FROM mistakes WHERE what_went_wrong LIKE ? ESCAPE '\\'";
    const params: (string | number)[] = [`%${sanitized}%`];

    if (mistake_type) {
      sql += " AND mistake_type = ?";
      params.push(mistake_type);
    }

    sql += " ORDER BY timestamp DESC LIMIT ?";
    params.push(limit);

    const mistakes = this.db.prepare(sql).all(...params) as Types.MistakeRow[];

    return {
      query,
      mistake_type,
      mistakes: mistakes.map((m) => ({
        mistake_id: m.id,
        mistake_type: m.mistake_type,
        what_went_wrong: m.what_went_wrong,
        correction: m.correction,
        user_correction_message: m.user_correction_message,
        files_affected: JSON.parse(m.files_affected || "[]"),
        timestamp: new Date(m.timestamp).toISOString(),
      })),
      total_found: mistakes.length,
    };
  }

  /**
   * Tool 8: get_requirements
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
   * Tool 9: get_tool_history
   */
  async getToolHistory(args: Record<string, unknown>): Promise<Types.GetToolHistoryResponse> {
    const typedArgs = args as Types.GetToolHistoryArgs;
    const { tool_name, file_path, limit = 20 } = typedArgs;

    let sql = `
      SELECT tu.*, tr.content as result_content, tr.is_error, tr.stdout, tr.stderr
      FROM tool_uses tu
      LEFT JOIN tool_results tr ON tu.id = tr.tool_use_id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (tool_name) {
      sql += " AND tu.tool_name = ?";
      params.push(tool_name);
    }

    if (file_path) {
      const sanitized = sanitizeForLike(file_path);
      sql += " AND tu.tool_input LIKE ? ESCAPE '\\'";
      params.push(`%${sanitized}%`);
    }

    sql += " ORDER BY tu.timestamp DESC LIMIT ?";
    params.push(limit);

    const toolUses = this.db.prepare(sql).all(...params) as Types.ToolUseRow[];

    return {
      tool_name,
      file_path,
      tool_uses: toolUses.map((t) => ({
        tool_use_id: t.id,
        tool_name: t.tool_name,
        tool_input: JSON.parse(t.tool_input || "{}"),
        result: {
          content: t.result_content,
          is_error: Boolean(t.is_error),
          stdout: t.stdout,
          stderr: t.stderr,
        },
        timestamp: new Date(t.timestamp).toISOString(),
      })),
      total_found: toolUses.length,
    };
  }

  /**
   * Tool 10: find_similar_sessions
   */
  async findSimilarSessions(args: Record<string, unknown>): Promise<Types.FindSimilarSessionsResponse> {
    const typedArgs = args as unknown as Types.FindSimilarSessionsArgs;
    const { query, limit = 5 } = typedArgs;

    const results = await this.memory.search(query, limit * 3); // Get more to group by conversation

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

    const sessions = Array.from(conversationMap.values())
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, limit);

    return {
      query,
      sessions,
      total_found: sessions.length,
    };
  }

  /**
   * Tool 11: generate_documentation
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
}
