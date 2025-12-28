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
      // Execute the migration SQL
      if (migration.up && migration.up.trim()) {
        const statements = migration.up
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.startsWith("--"));

        for (const statement of statements) {
          this.db.exec(statement);
        }
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
