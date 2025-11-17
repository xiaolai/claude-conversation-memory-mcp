/**
 * Global Index for Cross-Project Search
 *
 * This module manages a lightweight global registry of all indexed projects
 * (both Claude Code and Codex). It maintains a central database that tracks:
 * - Which projects have been indexed
 * - Where their databases are located
 * - When they were last indexed
 * - Basic statistics about each project
 *
 * The global index enables:
 * - Discovery of all indexed projects
 * - Cross-project search routing
 * - Batch indexing operations
 * - Global statistics
 *
 * Architecture:
 * - Each project keeps its own database (per-project isolation)
 * - The global index is a registry that links to project databases
 * - Cross-project searches query multiple databases and merge results
 *
 * @example
 * ```typescript
 * const globalIndex = new GlobalIndex();
 * await globalIndex.registerProject({
 *   project_path: '/Users/user/project',
 *   source_type: 'claude-code',
 *   db_path: '/Users/user/.claude/projects/-project/.db',
 * });
 *
 * const projects = await globalIndex.getAllProjects();
 * console.log(`Tracking ${projects.length} projects`);
 * ```
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { nanoid } from "nanoid";

export interface ProjectMetadata {
  id: string;
  project_path: string;
  source_type: "claude-code" | "codex";
  db_path: string;
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
  db_path: string;
  message_count?: number;
  conversation_count?: number;
  decision_count?: number;
  mistake_count?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Global Index Manager
 *
 * Maintains a central registry of all indexed projects in a global database.
 */
export class GlobalIndex {
  private db: Database.Database;
  private globalDbPath: string;

  constructor(customPath?: string) {
    // Use custom path or default to ~/.claude/.claude-global-index.db
    if (customPath) {
      this.globalDbPath = customPath;
    } else {
      const claudeHome = join(homedir(), ".claude");
      if (!existsSync(claudeHome)) {
        mkdirSync(claudeHome, { recursive: true });
      }
      this.globalDbPath = join(claudeHome, ".claude-global-index.db");
    }

    // Open/create database
    this.db = new Database(this.globalDbPath);

    // Initialize schema
    this.initializeSchema();
  }

  /**
   * Initialize the global index database schema.
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_metadata (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL,
        db_path TEXT NOT NULL,
        last_indexed INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0,
        conversation_count INTEGER DEFAULT 0,
        decision_count INTEGER DEFAULT 0,
        mistake_count INTEGER DEFAULT 0,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_proj_source ON project_metadata(source_type);
      CREATE INDEX IF NOT EXISTS idx_proj_last_indexed ON project_metadata(last_indexed);
      CREATE INDEX IF NOT EXISTS idx_proj_path ON project_metadata(project_path);
    `);
  }

  /**
   * Register or update a project in the global index.
   *
   * @param options - Project registration options
   * @returns The registered/updated project metadata
   */
  registerProject(options: RegisterProjectOptions): ProjectMetadata {
    const now = Date.now();

    // Check if project already exists
    const existing = this.db
      .prepare("SELECT * FROM project_metadata WHERE project_path = ?")
      .get(options.project_path) as ProjectMetadata | undefined;

    if (existing) {
      // Update existing project
      const stmt = this.db.prepare(`
        UPDATE project_metadata
        SET source_type = ?,
            db_path = ?,
            last_indexed = ?,
            message_count = ?,
            conversation_count = ?,
            decision_count = ?,
            mistake_count = ?,
            metadata = ?,
            updated_at = ?
        WHERE project_path = ?
      `);

      stmt.run(
        options.source_type,
        options.db_path,
        now,
        options.message_count || 0,
        options.conversation_count || 0,
        options.decision_count || 0,
        options.mistake_count || 0,
        JSON.stringify(options.metadata || {}),
        now,
        options.project_path
      );

      return {
        ...existing,
        source_type: options.source_type,
        db_path: options.db_path,
        last_indexed: now,
        message_count: options.message_count || 0,
        conversation_count: options.conversation_count || 0,
        decision_count: options.decision_count || 0,
        mistake_count: options.mistake_count || 0,
        metadata: options.metadata || {},
        updated_at: now,
      };
    } else {
      // Insert new project
      const id = nanoid();
      const stmt = this.db.prepare(`
        INSERT INTO project_metadata (
          id, project_path, source_type, db_path, last_indexed,
          message_count, conversation_count, decision_count, mistake_count,
          metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        options.project_path,
        options.source_type,
        options.db_path,
        now,
        options.message_count || 0,
        options.conversation_count || 0,
        options.decision_count || 0,
        options.mistake_count || 0,
        JSON.stringify(options.metadata || {}),
        now,
        now
      );

      return {
        id,
        project_path: options.project_path,
        source_type: options.source_type,
        db_path: options.db_path,
        last_indexed: now,
        message_count: options.message_count || 0,
        conversation_count: options.conversation_count || 0,
        decision_count: options.decision_count || 0,
        mistake_count: options.mistake_count || 0,
        metadata: options.metadata || {},
        created_at: now,
        updated_at: now,
      };
    }
  }

  /**
   * Get all registered projects.
   *
   * @param sourceType - Optional filter by source type
   * @returns Array of project metadata
   */
  getAllProjects(sourceType?: "claude-code" | "codex"): ProjectMetadata[] {
    let sql = "SELECT * FROM project_metadata";
    const params: string[] = [];

    if (sourceType) {
      sql += " WHERE source_type = ?";
      params.push(sourceType);
    }

    sql += " ORDER BY last_indexed DESC";

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      project_path: string;
      source_type: "claude-code" | "codex";
      db_path: string;
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
      metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
    }));
  }

  /**
   * Get a specific project by path.
   *
   * @param projectPath - Absolute path to the project
   * @returns Project metadata or null if not found
   */
  getProject(projectPath: string): ProjectMetadata | null {
    const row = this.db
      .prepare("SELECT * FROM project_metadata WHERE project_path = ?")
      .get(projectPath) as {
      id: string;
      project_path: string;
      source_type: "claude-code" | "codex";
      db_path: string;
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
      metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
    };
  }

  /**
   * Remove a project from the global index.
   *
   * Note: This does NOT delete the project's database, only removes it from the registry.
   *
   * @param projectPath - Absolute path to the project
   * @returns True if project was removed, false if not found
   */
  removeProject(projectPath: string): boolean {
    const stmt = this.db.prepare("DELETE FROM project_metadata WHERE project_path = ?");
    const result = stmt.run(projectPath);
    return result.changes > 0;
  }

  /**
   * Get global statistics across all projects.
   *
   * @returns Aggregate statistics
   */
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
        COUNT(*) as total_projects,
        SUM(CASE WHEN source_type = 'claude-code' THEN 1 ELSE 0 END) as claude_code_projects,
        SUM(CASE WHEN source_type = 'codex' THEN 1 ELSE 0 END) as codex_projects,
        SUM(message_count) as total_messages,
        SUM(conversation_count) as total_conversations,
        SUM(decision_count) as total_decisions,
        SUM(mistake_count) as total_mistakes
      FROM project_metadata
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

  /**
   * Close the global index database.
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get the path to the global index database.
   */
  getDbPath(): string {
    return this.globalDbPath;
  }
}
