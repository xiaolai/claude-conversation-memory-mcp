/**
 * ConversationAnalyzer - Queries conversation memory database
 */

import type { SQLiteManager } from '../storage/SQLiteManager.js';
import type { ConversationData, Decision, Mistake, Requirement, FileEdit, GitCommit } from './types.js';
import type { DecisionRow, MistakeRow, RequirementRow, GitCommitRow } from '../types/ToolTypes.js';
import { safeJsonParse } from '../utils/safeJson.js';

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
      SELECT
        d.external_id as decision_external_id,
        d.decision_text,
        d.rationale,
        d.alternatives_considered,
        d.rejected_reasons,
        d.context,
        d.related_files,
        d.related_commits,
        d.timestamp,
        c.external_id as conversation_external_id,
        m.external_id as message_external_id
      FROM decisions d
      JOIN conversations c ON d.conversation_id = c.id
      LEFT JOIN messages m ON d.message_id = m.id
      WHERE c.project_path = ?
    `;

    if (sessionId) {
      sql += ' AND c.id = ?';
    }

    sql += ' ORDER BY d.timestamp DESC';

    const stmt = this.db.getDatabase().prepare(sql);
    const rows = sessionId
      ? stmt.all(projectPath, sessionId) as Array<DecisionRow & { conversation_external_id: string; message_external_id: string | null; decision_external_id: string }>
      : stmt.all(projectPath) as Array<DecisionRow & { conversation_external_id: string; message_external_id: string | null; decision_external_id: string }>;

    const results: Decision[] = [];
    for (const row of rows) {
      if (!row.message_external_id) {
        continue;
      }
      results.push({
        id: row.decision_external_id,
        conversation_id: row.conversation_external_id,
        message_id: row.message_external_id,
        decision_text: row.decision_text,
        rationale: row.rationale || '',
        alternatives_considered: safeJsonParse<string[]>(row.alternatives_considered, []),
        rejected_reasons: safeJsonParse<Record<string, string>>(row.rejected_reasons, {}),
        context: row.context,
        related_files: safeJsonParse<string[]>(row.related_files, []),
        related_commits: safeJsonParse<string[]>(row.related_commits, []),
        timestamp: row.timestamp
      });
    }

    return results;
  }

  private getMistakes(projectPath: string, sessionId?: string): Mistake[] {
    let sql = `
      SELECT
        m.external_id as mistake_external_id,
        m.mistake_type,
        m.what_went_wrong,
        m.correction,
        m.user_correction_message,
        m.files_affected,
        m.timestamp,
        c.external_id as conversation_external_id
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
      ? stmt.all(projectPath, sessionId) as Array<MistakeRow & { conversation_external_id: string; mistake_external_id: string }>
      : stmt.all(projectPath) as Array<MistakeRow & { conversation_external_id: string; mistake_external_id: string }>;

    return rows.map((row) => ({
      id: row.mistake_external_id,
      conversation_id: row.conversation_external_id,
      what_went_wrong: row.what_went_wrong,
      why_it_happened: '',
      how_it_was_fixed: row.correction || '',
      lesson_learned: row.user_correction_message || '',
      related_files: safeJsonParse<string[]>(row.files_affected, []),
      severity: row.mistake_type || 'general',
      timestamp: row.timestamp
    }));
  }

  private getRequirements(projectPath: string, sessionId?: string): Requirement[] {
    let sql = `
      SELECT
        r.external_id as requirement_external_id,
        r.type,
        r.description,
        r.rationale,
        r.affects_components,
        r.timestamp
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
      ? stmt.all(projectPath, sessionId) as Array<RequirementRow & { requirement_external_id: string }>
      : stmt.all(projectPath) as Array<RequirementRow & { requirement_external_id: string }>;

    return rows.map((row) => ({
      id: row.requirement_external_id,
      requirement_type: row.type,
      description: row.description,
      rationale: row.rationale || '',
      related_files: safeJsonParse<string[]>(row.affects_components, []),
      timestamp: row.timestamp
    }));
  }

  private getFileEdits(projectPath: string, sessionId?: string): FileEdit[] {
    let sql = `
      SELECT
        fe.external_id as edit_external_id,
        fe.file_path,
        fe.snapshot_timestamp,
        c.external_id as conversation_external_id
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
      id: row.edit_external_id as string,
      conversation_id: row.conversation_external_id as string,
      file_path: row.file_path as string,
      edit_type: 'backup', // All file_edits are backups based on schema
      timestamp: row.snapshot_timestamp as number
    }));
  }

  private getGitCommits(projectPath: string, sessionId?: string): GitCommit[] {
    let sql = `
      SELECT
        gc.hash,
        gc.message,
        gc.author,
        gc.timestamp,
        gc.files_changed,
        c.external_id as conversation_external_id
      FROM git_commits gc
      LEFT JOIN conversations c ON gc.conversation_id = c.id
      WHERE c.project_path = ?
    `;

    if (sessionId) {
      sql += ' AND c.id = ?';
    }

    sql += ' ORDER BY gc.timestamp DESC LIMIT 500';

    const stmt = this.db.getDatabase().prepare(sql);
    const rows = sessionId
      ? stmt.all(projectPath, sessionId) as Array<GitCommitRow & { conversation_external_id: string | null }>
      : stmt.all(projectPath) as Array<GitCommitRow & { conversation_external_id: string | null }>;

    return rows.map((row) => ({
      hash: row.hash,
      conversation_id: row.conversation_external_id || '',
      message: row.message,
      author: row.author || 'Unknown',
      timestamp: row.timestamp,
      files_changed: safeJsonParse<string[]>(row.files_changed, [])
    }));
  }
}
