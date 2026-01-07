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
import { existsSync, mkdirSync, openSync, closeSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { nanoid } from "nanoid";
import { safeJsonParse } from "../utils/safeJson.js";
import { getCanonicalProjectPath } from "../utils/worktree.js";

function resolveGlobalIndexPath(): string {
  const defaultPath = join(homedir(), ".claude", ".cccmemory-global.db");

  const canCreateDbFile = (dbPath: string): boolean => {
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
      const fd = openSync(dbPath, "a");
      closeSync(fd);
      return true;
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === "EACCES" || err.code === "EPERM" || err.code === "EROFS") {
        return false;
      }
      throw error;
    }
  };

  const canWriteExistingDbFile = (dbPath: string): boolean => {
    try {
      const fd = openSync(dbPath, "r+");
      closeSync(fd);
      return true;
    } catch (error) {
      const err = error as { code?: string };
      if (
        err.code === "EACCES" ||
        err.code === "EPERM" ||
        err.code === "EROFS" ||
        err.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  };

  const requestedPath = process.env.CCCMEMORY_GLOBAL_INDEX_PATH;
  if (requestedPath) {
    if (canCreateDbFile(requestedPath)) {
      return requestedPath;
    }
    throw new Error(
      `Global index path is not writable: ${requestedPath}\n` +
        "Fix permissions or set CCCMEMORY_GLOBAL_INDEX_PATH to a writable file path.\n" +
        "If you're running under Codex or Claude with a locked home dir (~/.claude or ~/.codex), " +
        "you must set CCCMEMORY_GLOBAL_INDEX_PATH explicitly."
    );
  }

  if (canCreateDbFile(defaultPath)) {
    return defaultPath;
  }

  const canonicalPath = getCanonicalProjectPath(process.cwd()).canonicalPath;
  const fallbackPath = join(canonicalPath, ".cccmemory", "global-index.db");
  if (existsSync(fallbackPath) && canWriteExistingDbFile(fallbackPath)) {
    console.error(
      `⚠️ Using existing project-local global index at ${fallbackPath}. ` +
        "No new files are created there automatically. " +
        "Set CCCMEMORY_GLOBAL_INDEX_PATH to make this explicit."
    );
    return fallbackPath;
  }

  throw new Error(
    `Unable to create global index at ${defaultPath}.\n` +
      `Fix permissions for ${dirname(defaultPath)} or set CCCMEMORY_GLOBAL_INDEX_PATH.\n` +
      "If you're running under Codex or Claude with a locked home dir (~/.claude or ~/.codex), " +
      "you must set CCCMEMORY_GLOBAL_INDEX_PATH explicitly."
  );
}

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
  private db: Database.Database | null = null;
  private globalDbPath: string;
  private initialized = false;

  constructor(customPath?: string) {
    // Use custom path or default to ~/.claude/.cccmemory-global.db
    // Note: Database is NOT opened here - lazy initialization in ensureInitialized()
    if (customPath) {
      this.globalDbPath = customPath;
    } else {
      this.globalDbPath = resolveGlobalIndexPath();
    }
  }

  /**
   * Ensure database is initialized (lazy initialization).
   * Called automatically by methods that need the database.
   */
  private ensureInitialized(): Database.Database {
    if (!this.initialized || !this.db) {
      // Create parent directory if needed
      const parentDir = dirname(this.globalDbPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      // Open/create database
      this.db = new Database(this.globalDbPath);

      // Initialize schema
      this.initializeSchema();
      this.initialized = true;
    }
    return this.db;
  }

  /**
   * Initialize the global index database schema.
   * Note: this.db is guaranteed to be set when this is called from ensureInitialized()
   */
  private initializeSchema(): void {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
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
   * Uses atomic UPSERT to avoid race conditions.
   *
   * @param options - Project registration options
   * @returns The registered/updated project metadata
   */
  registerProject(options: RegisterProjectOptions): ProjectMetadata {
    const db = this.ensureInitialized();
    const now = Date.now();
    const id = nanoid();

    // Atomic UPSERT - avoids race conditions between concurrent registrations
    const stmt = db.prepare(`
      INSERT INTO project_metadata (
        id, project_path, source_type, db_path, last_indexed,
        message_count, conversation_count, decision_count, mistake_count,
        metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_path) DO UPDATE SET
        source_type = excluded.source_type,
        db_path = excluded.db_path,
        last_indexed = excluded.last_indexed,
        message_count = excluded.message_count,
        conversation_count = excluded.conversation_count,
        decision_count = excluded.decision_count,
        mistake_count = excluded.mistake_count,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      id,
      options.project_path,
      options.source_type,
      options.db_path,
      now,
      options.message_count ?? 0,
      options.conversation_count ?? 0,
      options.decision_count ?? 0,
      options.mistake_count ?? 0,
      JSON.stringify(options.metadata ?? {}),
      now,
      now
    );

    // Fetch the actual record (may have existing id/created_at if it was an update)
    interface ProjectRow {
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
    }
    const row = db
      .prepare("SELECT * FROM project_metadata WHERE project_path = ?")
      .get(options.project_path) as ProjectRow;

    return {
      id: row.id,
      project_path: row.project_path,
      source_type: row.source_type,
      db_path: row.db_path,
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

    const db = this.ensureInitialized();
    const rows = db.prepare(sql).all(...params) as Array<{
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
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
    }));
  }

  /**
   * Get a specific project by path.
   *
   * @param projectPath - Absolute path to the project
   * @returns Project metadata or null if not found
   */
  getProject(projectPath: string): ProjectMetadata | null {
    const db = this.ensureInitialized();
    const row = db
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
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
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
    const db = this.ensureInitialized();
    const stmt = db.prepare("DELETE FROM project_metadata WHERE project_path = ?");
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
    const db = this.ensureInitialized();
    const stats = db
      .prepare(
        `
      SELECT
        COUNT(*) as total_projects,
        COALESCE(SUM(CASE WHEN source_type = 'claude-code' THEN 1 ELSE 0 END), 0) as claude_code_projects,
        COALESCE(SUM(CASE WHEN source_type = 'codex' THEN 1 ELSE 0 END), 0) as codex_projects,
        COALESCE(SUM(message_count), 0) as total_messages,
        COALESCE(SUM(conversation_count), 0) as total_conversations,
        COALESCE(SUM(decision_count), 0) as total_decisions,
        COALESCE(SUM(mistake_count), 0) as total_mistakes
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
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  /**
   * Get the path to the global index database.
   */
  getDbPath(): string {
    return this.globalDbPath;
  }
}
