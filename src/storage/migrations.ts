/**
 * Database migration system
 * Versioned schema updates for a single database
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
    description: "Single-DB schema (projects + sources + scoped entities)",
    up: `
      -- Schema is created by schema.sql during initialization
    `,
  },
  {
    version: 2,
    description: "Phase 1: Tag Management, Memory Confidence, Cleanup/Maintenance",
    up: `
      -- ==================================================
      -- TAG MANAGEMENT TABLES
      -- ==================================================

      -- Centralized tag registry
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        project_path TEXT,  -- NULL for global tags
        description TEXT,   -- Optional tag description
        color TEXT,         -- Optional UI color hint
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        UNIQUE(name, project_path)
      );

      CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
      CREATE INDEX IF NOT EXISTS idx_tags_project ON tags(project_path);

      -- Polymorphic tag associations
      CREATE TABLE IF NOT EXISTS item_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id INTEGER NOT NULL,
        item_type TEXT NOT NULL,  -- 'memory', 'decision', 'pattern', 'session', 'mistake'
        item_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
        UNIQUE(tag_id, item_type, item_id)
      );

      CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_item_tags_item ON item_tags(item_type, item_id);

      -- View: Tag usage statistics
      CREATE VIEW IF NOT EXISTS tag_stats AS
      SELECT
        t.id,
        t.name,
        t.project_path,
        t.description,
        t.color,
        t.created_at,
        t.updated_at,
        COUNT(it.id) as usage_count,
        MAX(it.created_at) as last_used_at,
        GROUP_CONCAT(DISTINCT it.item_type) as used_in_types
      FROM tags t
      LEFT JOIN item_tags it ON t.id = it.tag_id
      GROUP BY t.id;

      -- ==================================================
      -- MEMORY CONFIDENCE/QUALITY COLUMNS
      -- ==================================================

      -- Add confidence level to working_memory
      ALTER TABLE working_memory ADD COLUMN confidence TEXT DEFAULT 'likely';
      -- Values: uncertain, likely, confirmed, verified

      -- Add importance level to working_memory
      ALTER TABLE working_memory ADD COLUMN importance TEXT DEFAULT 'normal';
      -- Values: low, normal, high, critical

      -- Add pinned flag to working_memory
      ALTER TABLE working_memory ADD COLUMN pinned INTEGER DEFAULT 0;

      -- Add archived flag to working_memory
      ALTER TABLE working_memory ADD COLUMN archived INTEGER DEFAULT 0;

      -- Add archive reason to working_memory
      ALTER TABLE working_memory ADD COLUMN archive_reason TEXT;

      -- Add source attribution to working_memory
      ALTER TABLE working_memory ADD COLUMN source TEXT;
      -- Free text: "user stated", "extracted from session X", "confirmed in production"

      -- Add source session link to working_memory
      ALTER TABLE working_memory ADD COLUMN source_session_id TEXT;

      -- Add verification timestamp to working_memory
      ALTER TABLE working_memory ADD COLUMN verified_at INTEGER;

      -- Add verifier info to working_memory
      ALTER TABLE working_memory ADD COLUMN verified_by TEXT;

      -- Indexes for new working_memory fields
      CREATE INDEX IF NOT EXISTS idx_working_memory_confidence ON working_memory(confidence);
      CREATE INDEX IF NOT EXISTS idx_working_memory_importance ON working_memory(importance);
      CREATE INDEX IF NOT EXISTS idx_working_memory_pinned ON working_memory(pinned);
      CREATE INDEX IF NOT EXISTS idx_working_memory_archived ON working_memory(archived);

      -- ==================================================
      -- CLEANUP/MAINTENANCE TABLES
      -- ==================================================

      -- Maintenance operation log
      CREATE TABLE IF NOT EXISTS maintenance_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_type TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        status TEXT NOT NULL DEFAULT 'running',  -- running, completed, failed
        items_processed INTEGER DEFAULT 0,
        items_affected INTEGER DEFAULT 0,
        details TEXT,  -- JSON with task-specific details
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_maintenance_log_type ON maintenance_log(task_type);
      CREATE INDEX IF NOT EXISTS idx_maintenance_log_time ON maintenance_log(started_at);
      CREATE INDEX IF NOT EXISTS idx_maintenance_log_status ON maintenance_log(status);

      -- Scheduled maintenance tasks
      CREATE TABLE IF NOT EXISTS scheduled_maintenance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_type TEXT NOT NULL,
        schedule TEXT NOT NULL,  -- cron expression or 'daily', 'weekly', 'monthly'
        options TEXT,  -- JSON task options
        enabled INTEGER DEFAULT 1,
        last_run_at INTEGER,
        next_run_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_maintenance_type ON scheduled_maintenance(task_type);
      CREATE INDEX IF NOT EXISTS idx_scheduled_maintenance_enabled ON scheduled_maintenance(enabled);
      CREATE INDEX IF NOT EXISTS idx_scheduled_maintenance_next_run ON scheduled_maintenance(next_run_at);
    `,
    down: `
      -- Rollback Phase 1 changes

      -- Drop tag management tables
      DROP VIEW IF EXISTS tag_stats;
      DROP TABLE IF EXISTS item_tags;
      DROP TABLE IF EXISTS tags;

      -- Drop maintenance tables
      DROP TABLE IF EXISTS scheduled_maintenance;
      DROP TABLE IF EXISTS maintenance_log;

      -- Note: SQLite doesn't support DROP COLUMN, so working_memory columns
      -- will remain but be unused after rollback. A full schema rebuild
      -- would be required to remove them completely.
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
   * Get all pending migrations sorted by version ascending
   */
  getPendingMigrations(): Migration[] {
    const currentVersion = this.getCurrentVersion();
    return migrations
      .filter((m) => m.version > currentVersion)
      .sort((a, b) => a.version - b.version);
  }

  /**
   * Apply a single migration with locking to prevent concurrent execution.
   * Uses BEGIN IMMEDIATE to acquire a write lock before checking/applying.
   */
  applyMigration(migration: Migration): void {
    console.error(
      `Applying migration v${migration.version}: ${migration.description}`
    );

    // Calculate checksum
    const checksum = this.calculateChecksum(migration);

    // Use BEGIN IMMEDIATE to acquire exclusive lock and prevent concurrent migrations
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Re-check if migration was already applied (by concurrent process)
      const alreadyApplied = this.db
        .prepare("SELECT 1 FROM schema_version WHERE version = ?")
        .get(migration.version);

      if (alreadyApplied) {
        this.db.exec("ROLLBACK");
        console.error(`Migration v${migration.version} already applied (concurrent execution)`);
        return;
      }

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

      this.db.exec("COMMIT");
      console.error(`Migration v${migration.version} applied successfully`);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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
      const downSql = migration.down;
      if (!downSql) {
        throw new Error(
          `Migration v${migration.version} does not support rollback`
        );
      }

      console.error(`Rolling back migration v${migration.version}`);

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

      if (record.checksum === null) {
        // NULL checksum indicates migration was applied before checksums were added
        // Backfill the checksum for future verification
        console.error(`Migration v${record.version} has no checksum - backfilling`);
        this.db
          .prepare("UPDATE schema_version SET checksum = ? WHERE version = ?")
          .run(expectedChecksum, record.version);
      } else if (record.checksum !== expectedChecksum) {
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
