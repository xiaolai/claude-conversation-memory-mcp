/**
 * Conversation Storage Layer
 * CRUD operations for all conversation-related data
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

export class ConversationStorage {
  constructor(private db: SQLiteManager) {}

  // ==================== Conversations ====================

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
      }
    });

    console.log(`✓ Stored ${conversations.length} conversations`);
  }

  getConversation(id: string): Conversation | null {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as ConversationRow | undefined;

    if (!row) {
      return null;
    }

    return {
      ...row,
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }

  // ==================== Messages ====================

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
      }
    });

    console.log(`✓ Stored ${fileEdits.length} file edits`);
  }

  getFileEdits(filePath: string): FileEdit[] {
    return this.db
      .prepare(
        "SELECT * FROM file_edits WHERE file_path = ? ORDER BY snapshot_timestamp DESC"
      )
      .all(filePath) as FileEdit[];
  }

  // ==================== Thinking Blocks ====================

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

  getDecisionsForFile(filePath: string): Decision[] {
    const sanitized = sanitizeForLike(filePath);
    const rows = this.db
      .prepare("SELECT * FROM decisions WHERE related_files LIKE ? ESCAPE '\\' ORDER BY timestamp DESC")
      .all(`%"${sanitized}"%`) as DecisionRow[];

    return rows.map((row) => ({
      ...row,
      alternatives_considered: JSON.parse(row.alternatives_considered || "[]"),
      rejected_reasons: JSON.parse(row.rejected_reasons || "{}"),
      related_files: JSON.parse(row.related_files || "[]"),
      related_commits: JSON.parse(row.related_commits || "[]"),
    }));
  }

  // ==================== Git Commits ====================

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
    const sanitized = sanitizeForLike(filePath);
    const rows = this.db
      .prepare("SELECT * FROM git_commits WHERE files_changed LIKE ? ESCAPE '\\' ORDER BY timestamp DESC")
      .all(`%"${sanitized}"%`) as GitCommitRow[];

    return rows.map((row) => ({
      ...row,
      files_changed: JSON.parse(row.files_changed || "[]"),
      metadata: JSON.parse(row.metadata || "{}"),
    }));
  }

  // ==================== Mistakes ====================

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

  getFileTimeline(filePath: string): {
    file_path: string;
    edits: FileEdit[];
    commits: GitCommit[];
    decisions: Decision[];
  } {
    // Combine file edits, commits, and decisions
    const edits = this.getFileEdits(filePath);
    const commits = this.getCommitsForFile(filePath);
    const decisions = this.getDecisionsForFile(filePath);

    return {
      file_path: filePath,
      edits,
      commits,
      decisions,
    };
  }

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
