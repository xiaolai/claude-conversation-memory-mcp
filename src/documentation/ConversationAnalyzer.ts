/**
 * ConversationAnalyzer - Queries conversation memory database
 */

import type { SQLiteManager } from '../storage/SQLiteManager.js';
import type { ConversationData, Decision, Mistake, Requirement, FileEdit, GitCommit } from './types.js';
import type { DecisionRow, MistakeRow, RequirementRow, GitCommitRow } from '../types/ToolTypes.js';

export class ConversationAnalyzer {
  constructor(private db: SQLiteManager) {}

  /**
   * Analyze conversations for a project
   */
  async analyze(projectPath: string, sessionId?: string): Promise<ConversationData> {
    console.error('📊 Analyzing conversation history...');

    const decisions = this.getDecisions(projectPath, sessionId);
    const mistakes = this.getMistakes(projectPath, sessionId);
    const requirements = this.getRequirements(projectPath, sessionId);
    const fileEdits = this.getFileEdits(projectPath, sessionId);
    const commits = this.getGitCommits(projectPath, sessionId);

    console.error(`  Found ${decisions.length} decisions, ${mistakes.length} mistakes`);

    return {
      decisions,
      mistakes,
      requirements,
      fileEdits,
      commits
    };
  }

  private getDecisions(projectPath: string, sessionId?: string): Decision[] {
    let sql = `
      SELECT d.*
      FROM decisions d
      JOIN conversations c ON d.conversation_id = c.id
      WHERE c.project_path = ?
    `;

    if (sessionId) {
      sql += ' AND c.id = ?';
    }

    sql += ' ORDER BY d.timestamp DESC';

    const stmt = this.db.getDatabase().prepare(sql);
    const rows = sessionId
      ? stmt.all(projectPath, sessionId) as DecisionRow[]
      : stmt.all(projectPath) as DecisionRow[];

    return rows.map((row) => ({
      id: row.id,
      conversation_id: row.conversation_id,
      message_id: row.message_id,
      decision_text: row.decision_text,
      rationale: row.rationale || '',
      alternatives_considered: JSON.parse(row.alternatives_considered || '[]'),
      rejected_reasons: JSON.parse(row.rejected_reasons || '{}'),
      context: row.context,
      related_files: JSON.parse(row.related_files || '[]'),
      related_commits: JSON.parse(row.related_commits || '[]'),
      timestamp: row.timestamp
    }));
  }

  private getMistakes(projectPath: string, sessionId?: string): Mistake[] {
    let sql = `
      SELECT m.*
      FROM mistakes m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.project_path = ?
    `;

    if (sessionId) {
      sql += ' AND c.id = ?';
    }

    sql += ' ORDER BY m.timestamp DESC';

    const stmt = this.db.getDatabase().prepare(sql);
    const rows = sessionId
      ? stmt.all(projectPath, sessionId) as MistakeRow[]
      : stmt.all(projectPath) as MistakeRow[];

    return rows.map((row) => ({
      id: row.id,
      conversation_id: row.conversation_id,
      what_went_wrong: row.what_went_wrong,
      why_it_happened: '',
      how_it_was_fixed: row.correction || '',
      lesson_learned: row.user_correction_message || '',
      related_files: JSON.parse(row.files_affected || '[]'),
      severity: row.mistake_type || 'general',
      timestamp: row.timestamp
    }));
  }

  private getRequirements(projectPath: string, sessionId?: string): Requirement[] {
    let sql = `
      SELECT r.*
      FROM requirements r
      JOIN conversations c ON r.conversation_id = c.id
      WHERE c.project_path = ?
    `;

    if (sessionId) {
      sql += ' AND c.id = ?';
    }

    sql += ' ORDER BY r.timestamp DESC';

    const stmt = this.db.getDatabase().prepare(sql);
    const rows = sessionId
      ? stmt.all(projectPath, sessionId) as RequirementRow[]
      : stmt.all(projectPath) as RequirementRow[];

    return rows.map((row) => ({
      id: row.id,
      requirement_type: row.type,
      description: row.description,
      rationale: row.rationale || '',
      related_files: JSON.parse(row.affects_components || '[]'),
      timestamp: row.timestamp
    }));
  }

  private getFileEdits(projectPath: string, sessionId?: string): FileEdit[] {
    let sql = `
      SELECT fe.*
      FROM file_edits fe
      JOIN conversations c ON fe.conversation_id = c.id
      WHERE c.project_path = ?
    `;

    if (sessionId) {
      sql += ' AND c.id = ?';
    }

    sql += ' ORDER BY fe.snapshot_timestamp DESC LIMIT 1000';

    const stmt = this.db.getDatabase().prepare(sql);
    const rows = sessionId
      ? stmt.all(projectPath, sessionId) as Array<Record<string, unknown>>
      : stmt.all(projectPath) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as string,
      conversation_id: row.conversation_id as string,
      file_path: row.file_path as string,
      edit_type: 'backup', // All file_edits are backups based on schema
      timestamp: row.snapshot_timestamp as number
    }));
  }

  private getGitCommits(projectPath: string, sessionId?: string): GitCommit[] {
    let sql = `
      SELECT gc.*
      FROM git_commits gc
      JOIN conversations c ON gc.conversation_id = c.id
      WHERE c.project_path = ?
    `;

    if (sessionId) {
      sql += ' AND c.id = ?';
    }

    sql += ' ORDER BY gc.timestamp DESC LIMIT 500';

    const stmt = this.db.getDatabase().prepare(sql);
    const rows = sessionId
      ? stmt.all(projectPath, sessionId) as GitCommitRow[]
      : stmt.all(projectPath) as GitCommitRow[];

    return rows.map((row) => ({
      hash: row.hash,
      conversation_id: row.conversation_id || '',
      message: row.message,
      author: row.author || 'Unknown',
      timestamp: row.timestamp,
      files_changed: JSON.parse(row.files_changed || '[]')
    }));
  }
}
