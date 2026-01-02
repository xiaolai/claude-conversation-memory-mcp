/**
 * Database migration system
 * Follows patterns from code-graph-rag-mcp for versioned schema updates
 */

import { SQLiteManager } from "./SQLiteManager.js";
import { createHash } from "crypto";

export interface Migration {
  version: number;
  description: string;
  up: string; // SQL to apply migration
  down?: string; // SQL to rollback migration (optional)
  checksum?: string; // Verify migration integrity
}

export const migrations: Migration[] = [
  {
    version: 1,
    description: "Initial schema with 17 tables for conversation memory",
    up: `
      -- Schema is already created by schema.sql during initialization
      -- This migration just records the version
    `,
  },
  {
    version: 2,
    description: "Add source_type column and global index support",
    up: `
      ALTER TABLE conversations ADD COLUMN source_type TEXT DEFAULT 'claude-code';
      CREATE INDEX IF NOT EXISTS idx_conv_source ON conversations(source_type)
    `,
    down: `
      -- SQLite doesn't support DROP COLUMN, would need table recreation
    `,
  },
  {
    version: 3,
    description:
      "Fix messages_fts schema - remove non-existent context column",
    up: `
      -- FTS5 virtual tables can't be altered, must drop and recreate
      -- The old schema had 'context' column which doesn't exist in messages table
      DROP TABLE IF EXISTS messages_fts;
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        id UNINDEXED,
        content,
        metadata,
        content=messages,
        content_rowid=rowid
      );
      -- Rebuild FTS index from messages table
      INSERT INTO messages_fts(messages_fts) VALUES('rebuild')
    `,
    down: `
      -- Rollback: recreate old (broken) schema
      DROP TABLE IF EXISTS messages_fts;
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        id UNINDEXED,
        content,
        context,
        metadata,
        content=messages,
        content_rowid=rowid
      )
    `,
  },
  {
    version: 4,
    description: "Add mistake_embeddings table and mistakes_fts for semantic search",
    up: `
      -- Create mistake_embeddings table for semantic search
      CREATE TABLE IF NOT EXISTS mistake_embeddings (
        id TEXT PRIMARY KEY,
        mistake_id TEXT NOT NULL,
        embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_mistake_embeddings_mistake_id ON mistake_embeddings(mistake_id);

      -- Create mistakes_fts FTS5 table (standalone, not content-synced)
      CREATE VIRTUAL TABLE IF NOT EXISTS mistakes_fts USING fts5(
        id,
        what_went_wrong,
        correction,
        mistake_type
      );
      -- Populate FTS from existing mistakes
      INSERT INTO mistakes_fts(id, what_went_wrong, correction, mistake_type)
        SELECT id, what_went_wrong, COALESCE(correction, ''), mistake_type FROM mistakes
    `,
    down: `
      DROP TABLE IF EXISTS mistakes_fts;
      DROP TABLE IF EXISTS mistake_embeddings
    `,
  },
  {
    version: 5,
    description:
      "Add live context layer tables: working_memory, session_handoffs, session_checkpoints",
    up: `
      -- Working Memory table for key-value context storage
      CREATE TABLE IF NOT EXISTS working_memory (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        context TEXT,
        tags TEXT,
        session_id TEXT,
        project_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        embedding BLOB,
        UNIQUE(project_path, key)
      );
      CREATE INDEX IF NOT EXISTS idx_wm_session ON working_memory(session_id);
      CREATE INDEX IF NOT EXISTS idx_wm_project ON working_memory(project_path);
      CREATE INDEX IF NOT EXISTS idx_wm_expires ON working_memory(expires_at);
      CREATE INDEX IF NOT EXISTS idx_wm_key ON working_memory(key);
      CREATE INDEX IF NOT EXISTS idx_wm_project_key ON working_memory(project_path, key);

      -- Session Handoffs table for context transfer
      CREATE TABLE IF NOT EXISTS session_handoffs (
        id TEXT PRIMARY KEY,
        from_session_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        handoff_data TEXT NOT NULL,
        resumed_by_session_id TEXT,
        resumed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_handoff_session ON session_handoffs(from_session_id);
      CREATE INDEX IF NOT EXISTS idx_handoff_project ON session_handoffs(project_path);
      CREATE INDEX IF NOT EXISTS idx_handoff_created ON session_handoffs(created_at);
      CREATE INDEX IF NOT EXISTS idx_handoff_resumed ON session_handoffs(resumed_by_session_id);

      -- Session Checkpoints table for real-time tracking
      CREATE TABLE IF NOT EXISTS session_checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        checkpoint_number INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        decisions TEXT,
        active_files TEXT,
        task_state TEXT,
        context_summary TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoint_session ON session_checkpoints(session_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoint_project ON session_checkpoints(project_path);
      CREATE INDEX IF NOT EXISTS idx_checkpoint_created ON session_checkpoints(created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_checkpoint_session_num ON session_checkpoints(session_id, checkpoint_number);

      -- FTS for working memory
      CREATE VIRTUAL TABLE IF NOT EXISTS working_memory_fts USING fts5(
        id UNINDEXED,
        key,
        value,
        context,
        content=working_memory,
        content_rowid=rowid
      )
    `,
    down: `
      DROP TABLE IF EXISTS working_memory_fts;
      DROP TABLE IF EXISTS session_checkpoints;
      DROP TABLE IF EXISTS session_handoffs;
      DROP TABLE IF EXISTS working_memory
    `,
  },
];

export class MigrationManager {
  private db: SQLiteManager;

  constructor(db: SQLiteManager) {
    this.db = db;
  }

  /**
   * Get current schema version
   */
  getCurrentVersion(): number {
    return this.db.getSchemaVersion();
  }

  /**
   * Get all pending migrations
   */
  getPendingMigrations(): Migration[] {
    const currentVersion = this.getCurrentVersion();
    return migrations.filter((m) => m.version > currentVersion);
  }

  /**
   * Apply a single migration
   */
  applyMigration(migration: Migration): void {
    console.error(
      `Applying migration v${migration.version}: ${migration.description}`
    );

    // Calculate checksum
    const checksum = this.calculateChecksum(migration);

    // Execute migration in a transaction
    this.db.transaction(() => {
      // Execute the migration SQL using db.exec() directly
      // SQLite handles multiple statements and comments correctly
      if (migration.up && migration.up.trim()) {
        this.db.exec(migration.up);
      }

      // Record migration
      this.db
        .prepare(
          "INSERT INTO schema_version (version, applied_at, description, checksum) VALUES (?, ?, ?, ?)"
        )
        .run(migration.version, Date.now(), migration.description, checksum);
    });

    console.error(`Migration v${migration.version} applied successfully`);
  }

  /**
   * Apply all pending migrations
   */
  applyPendingMigrations(): void {
    const pending = this.getPendingMigrations();

    if (pending.length === 0) {
      console.error("No pending migrations");
      return;
    }

    console.error(`Found ${pending.length} pending migrations`);

    for (const migration of pending) {
      this.applyMigration(migration);
    }

    console.error("All migrations applied successfully");
  }

  /**
   * Rollback to a specific version
   */
  rollbackTo(targetVersion: number): void {
    const currentVersion = this.getCurrentVersion();

    if (targetVersion >= currentVersion) {
      console.error("Nothing to rollback");
      return;
    }

    // Get migrations to rollback (in reverse order)
    const toRollback = migrations
      .filter((m) => m.version > targetVersion && m.version <= currentVersion)
      .sort((a, b) => b.version - a.version);

    for (const migration of toRollback) {
      if (!migration.down) {
        throw new Error(
          `Migration v${migration.version} does not support rollback`
        );
      }

      console.error(`Rolling back migration v${migration.version}`);

      const downSql = migration.down;
      if (!downSql) {
        throw new Error(`Migration v${migration.version} has no rollback SQL`);
      }

      this.db.transaction(() => {
        // Execute rollback SQL
        this.db.exec(downSql);

        // Remove migration record
        this.db
          .prepare("DELETE FROM schema_version WHERE version = ?")
          .run(migration.version);
      });

      console.error(`Migration v${migration.version} rolled back`);
    }
  }

  /**
   * Calculate migration checksum for verification
   */
  private calculateChecksum(migration: Migration): string {
    const content = `${migration.version}:${migration.description}:${migration.up}`;
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * Verify migration integrity
   */
  verifyMigrations(): boolean {
    const applied = this.db
      .prepare(
        "SELECT version, checksum FROM schema_version WHERE version > 0 ORDER BY version"
      )
      .all() as Array<{ version: number; checksum: string | null }>;

    for (const record of applied) {
      const migration = migrations.find((m) => m.version === record.version);

      if (!migration) {
        console.error(`Migration v${record.version} not found in code`);
        return false;
      }

      const expectedChecksum = this.calculateChecksum(migration);
      if (record.checksum && record.checksum !== expectedChecksum) {
        console.error(
          `Migration v${record.version} checksum mismatch - database may be corrupted`
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Get migration history
   */
  getHistory(): Array<{
    version: number;
    description: string;
    applied_at: number;
  }> {
    return this.db
      .prepare(
        "SELECT version, description, applied_at FROM schema_version ORDER BY version"
      )
      .all() as Array<{
      version: number;
      description: string;
      applied_at: number;
    }>;
  }
}
