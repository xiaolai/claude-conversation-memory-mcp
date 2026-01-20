/**
 * Global Index for Cross-Project Search (Single DB)
 *
 * Stores project registry inside the main database.
 */

import { getSQLiteManager, SQLiteManager } from "./SQLiteManager.js";
import { getCanonicalProjectPath } from "../utils/worktree.js";
import { safeJsonParse } from "../utils/safeJson.js";

export interface ProjectMetadata {
  id: number; // project_sources.id
  project_id: number;
  project_path: string;
  source_type: "claude-code" | "codex";
  source_root: string | null;
  last_indexed: number;
  message_count: number;
  conversation_count: number;
  decision_count: number;
  mistake_count: number;
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

export interface RegisterProjectOptions {
  project_path: string;
  source_type: "claude-code" | "codex";
  source_root?: string;
  message_count?: number;
  conversation_count?: number;
  decision_count?: number;
  mistake_count?: number;
  metadata?: Record<string, unknown>;
}

export class GlobalIndex {
  private sqliteManager: SQLiteManager;
  private db: ReturnType<SQLiteManager["getDatabase"]>;
  private ownsManager: boolean;

  constructor(sqliteManager?: SQLiteManager) {
    this.sqliteManager = sqliteManager ?? getSQLiteManager();
    this.db = this.sqliteManager.getDatabase();
    this.ownsManager = false;
  }

  private resolveProjectId(projectPath: string): number | null {
    const canonical = getCanonicalProjectPath(projectPath).canonicalPath;
    const projectRow = this.db
      .prepare("SELECT id FROM projects WHERE canonical_path = ?")
      .get(canonical) as { id: number } | undefined;
    if (projectRow) {
      return projectRow.id;
    }

    const aliasRow = this.db
      .prepare("SELECT project_id FROM project_aliases WHERE alias_path = ?")
      .get(canonical) as { project_id: number } | undefined;
    return aliasRow?.project_id ?? null;
  }

  registerProject(options: RegisterProjectOptions): ProjectMetadata {
    const now = Date.now();
    const canonical = getCanonicalProjectPath(options.project_path).canonicalPath;

    const existingProject = this.db
      .prepare("SELECT id, created_at FROM projects WHERE canonical_path = ?")
      .get(canonical) as { id: number; created_at: number } | undefined;

    let projectId: number;
    if (existingProject) {
      projectId = existingProject.id;
      this.db
        .prepare("UPDATE projects SET updated_at = ?, display_path = ? WHERE id = ?")
        .run(now, canonical, projectId);
    } else {
      const result = this.db
        .prepare(
          "INSERT INTO projects (canonical_path, display_path, created_at, updated_at) VALUES (?, ?, ?, ?)"
        )
        .run(canonical, canonical, now, now);
      projectId = Number(result.lastInsertRowid);
    }

    this.db
      .prepare(
        `
        INSERT INTO project_sources (
          project_id, source_type, source_root, last_indexed,
          message_count, conversation_count, decision_count, mistake_count,
          metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, source_type) DO UPDATE SET
          source_root = excluded.source_root,
          last_indexed = excluded.last_indexed,
          message_count = excluded.message_count,
          conversation_count = excluded.conversation_count,
          decision_count = excluded.decision_count,
          mistake_count = excluded.mistake_count,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at
        `
      )
      .run(
        projectId,
        options.source_type,
        options.source_root ?? null,
        now,
        options.message_count ?? 0,
        options.conversation_count ?? 0,
        options.decision_count ?? 0,
        options.mistake_count ?? 0,
        JSON.stringify(options.metadata ?? {}),
        now,
        now
      );

    const row = this.db
      .prepare(
        `
        SELECT
          ps.id,
          ps.project_id,
          p.canonical_path as project_path,
          ps.source_type,
          ps.source_root,
          ps.last_indexed,
          ps.message_count,
          ps.conversation_count,
          ps.decision_count,
          ps.mistake_count,
          ps.metadata,
          ps.created_at,
          ps.updated_at
        FROM project_sources ps
        JOIN projects p ON p.id = ps.project_id
        WHERE ps.project_id = ? AND ps.source_type = ?
        `
      )
      .get(projectId, options.source_type) as {
        id: number;
        project_id: number;
        project_path: string;
        source_type: "claude-code" | "codex";
        source_root: string | null;
        last_indexed: number;
        message_count: number;
        conversation_count: number;
        decision_count: number;
        mistake_count: number;
        metadata: string;
        created_at: number;
        updated_at: number;
      };

    return {
      id: row.id,
      project_id: row.project_id,
      project_path: row.project_path,
      source_type: row.source_type,
      source_root: row.source_root,
      last_indexed: row.last_indexed,
      message_count: row.message_count,
      conversation_count: row.conversation_count,
      decision_count: row.decision_count,
      mistake_count: row.mistake_count,
      metadata: safeJsonParse(row.metadata, {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  getAllProjects(sourceType?: "claude-code" | "codex"): ProjectMetadata[] {
    let sql = `
      SELECT
        ps.id,
        ps.project_id,
        p.canonical_path as project_path,
        ps.source_type,
        ps.source_root,
        ps.last_indexed,
        ps.message_count,
        ps.conversation_count,
        ps.decision_count,
        ps.mistake_count,
        ps.metadata,
        ps.created_at,
        ps.updated_at
      FROM project_sources ps
      JOIN projects p ON p.id = ps.project_id
    `;
    const params: string[] = [];

    if (sourceType) {
      sql += " WHERE ps.source_type = ?";
      params.push(sourceType);
    }

    sql += " ORDER BY ps.last_indexed DESC";

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: number;
      project_id: number;
      project_path: string;
      source_type: "claude-code" | "codex";
      source_root: string | null;
      last_indexed: number;
      message_count: number;
      conversation_count: number;
      decision_count: number;
      mistake_count: number;
      metadata: string;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map((row) => ({
      ...row,
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
    }));
  }

  getProject(projectPath: string, sourceType?: "claude-code" | "codex"): ProjectMetadata | null {
    const projectId = this.resolveProjectId(projectPath);
    if (!projectId) {
      return null;
    }

    let sql = `
      SELECT
        ps.id,
        ps.project_id,
        p.canonical_path as project_path,
        ps.source_type,
        ps.source_root,
        ps.last_indexed,
        ps.message_count,
        ps.conversation_count,
        ps.decision_count,
        ps.mistake_count,
        ps.metadata,
        ps.created_at,
        ps.updated_at
      FROM project_sources ps
      JOIN projects p ON p.id = ps.project_id
      WHERE ps.project_id = ?
    `;
    const params: (number | string)[] = [projectId];

    if (sourceType) {
      sql += " AND ps.source_type = ?";
      params.push(sourceType);
    } else {
      sql += " ORDER BY ps.last_indexed DESC LIMIT 1";
    }

    const row = this.db.prepare(sql).get(...params) as {
      id: number;
      project_id: number;
      project_path: string;
      source_type: "claude-code" | "codex";
      source_root: string | null;
      last_indexed: number;
      message_count: number;
      conversation_count: number;
      decision_count: number;
      mistake_count: number;
      metadata: string;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      ...row,
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
    };
  }

  removeProject(projectPath: string, sourceType?: "claude-code" | "codex"): boolean {
    const projectId = this.resolveProjectId(projectPath);
    if (!projectId) {
      return false;
    }

    if (sourceType) {
      const result = this.db
        .prepare("DELETE FROM project_sources WHERE project_id = ? AND source_type = ?")
        .run(projectId, sourceType);
      const remaining = this.db
        .prepare("SELECT COUNT(*) as count FROM project_sources WHERE project_id = ?")
        .get(projectId) as { count: number };
      if (remaining.count === 0) {
        this.db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
        this.db.prepare("DELETE FROM project_aliases WHERE project_id = ?").run(projectId);
      }
      return result.changes > 0;
    }

    const result = this.db
      .prepare("DELETE FROM project_sources WHERE project_id = ?")
      .run(projectId);
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    this.db.prepare("DELETE FROM project_aliases WHERE project_id = ?").run(projectId);
    return result.changes > 0;
  }

  getGlobalStats(): {
    total_projects: number;
    claude_code_projects: number;
    codex_projects: number;
    total_messages: number;
    total_conversations: number;
    total_decisions: number;
    total_mistakes: number;
  } {
    const stats = this.db
      .prepare(
        `
        SELECT
          COUNT(DISTINCT project_id) as total_projects,
          COALESCE(SUM(CASE WHEN source_type = 'claude-code' THEN 1 ELSE 0 END), 0) as claude_code_projects,
          COALESCE(SUM(CASE WHEN source_type = 'codex' THEN 1 ELSE 0 END), 0) as codex_projects,
          COALESCE(SUM(message_count), 0) as total_messages,
          COALESCE(SUM(conversation_count), 0) as total_conversations,
          COALESCE(SUM(decision_count), 0) as total_decisions,
          COALESCE(SUM(mistake_count), 0) as total_mistakes
        FROM project_sources
        `
      )
      .get() as {
      total_projects: number;
      claude_code_projects: number;
      codex_projects: number;
      total_messages: number;
      total_conversations: number;
      total_decisions: number;
      total_mistakes: number;
    };

    return stats;
  }

  close(): void {
    if (this.ownsManager) {
      this.sqliteManager.close();
    }
  }

  getDbPath(): string {
    return this.sqliteManager.getDbPath();
  }
}
