/**
 * SQLite Manager with optimized settings
 * Based on patterns from code-graph-rag-mcp for maximum performance
 */

import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { pathToProjectFolderName, escapeTableName } from "../utils/sanitization.js";
import * as sqliteVec from "sqlite-vec";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Performance constants (from code-graph-rag-mcp)
const DEFAULT_CACHE_SIZE_KB = 64000; // 64MB cache
const DEFAULT_MMAP_SIZE = 1000000000; // 1GB memory-mapped I/O (safe default)
const PAGE_SIZE = 4096; // 4KB page size
const WAL_AUTOCHECKPOINT = 1000; // Checkpoint WAL after 1000 pages

export interface SQLiteConfig {
  dbPath?: string;
  projectPath?: string;
  readOnly?: boolean;
  verbose?: boolean;
  /** Memory-mapped I/O size in bytes (default: 1GB). Set to 0 to disable. */
  mmapSize?: number;
  /** Cache size in KB (default: 64MB) */
  cacheSizeKb?: number;
}

export class SQLiteManager {
  private db: Database.Database;
  private dbPath: string;
  private isReadOnly: boolean;
  private mmapSize: number;
  private cacheSizeKb: number;

  constructor(config: SQLiteConfig = {}) {
    this.mmapSize = config.mmapSize ?? DEFAULT_MMAP_SIZE;
    this.cacheSizeKb = config.cacheSizeKb ?? DEFAULT_CACHE_SIZE_KB;
    // Determine database location
    if (config.dbPath) {
      // Explicit path provided
      this.dbPath = config.dbPath;
    } else {
      // Per-project database in ~/.claude/projects/{project-folder}/
      const projectPath = config.projectPath || process.cwd();
      const projectFolderName = pathToProjectFolderName(projectPath);
      this.dbPath = join(
        homedir(),
        ".claude",
        "projects",
        projectFolderName,
        ".claude-conversations-memory.db"
      );
    }

    this.isReadOnly = config.readOnly || false;

    // Ensure directory exists (only in write mode)
    if (!this.isReadOnly) {
      this.ensureDirectoryExists();
    } else {
      // In read-only mode, verify the database file exists
      if (!existsSync(this.dbPath)) {
        throw new Error(`Database file not found: ${this.dbPath}`);
      }
    }

    // Initialize database
    this.db = new Database(this.dbPath, {
      readonly: this.isReadOnly,
      verbose: config.verbose ? console.log : undefined,
    });

    // Load sqlite-vec extension
    this.loadVectorExtension();

    // Apply optimized PRAGMAs
    this.optimizeDatabase();

    // Initialize schema if needed
    if (!this.isReadOnly) {
      this.initializeSchema();
    }
  }

  private ensureDirectoryExists(): void {
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Load sqlite-vec extension for vector search
   */
  private loadVectorExtension(): void {
    try {
      sqliteVec.load(this.db);
      console.error("✓ sqlite-vec extension loaded");
      // Note: Vec tables will be created when embedding dimensions are known
    } catch (error) {
      console.error("⚠️ Failed to load sqlite-vec extension:", (error as Error).message);
      console.error("   Vector search will use BLOB fallback");
    }
  }

  /**
   * Create sqlite-vec virtual tables for vector search with specified dimensions
   * Public method called when embedding provider dimensions are known
   */
  createVecTablesWithDimensions(dimensions: number): void {
    // SECURITY: Validate dimensions to prevent SQL injection
    if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 10000) {
      throw new Error(`Invalid dimensions: must be a positive integer <= 10000, got ${typeof dimensions === 'number' ? dimensions : 'non-number'}`);
    }

    try {
      // Check if tables already exist with correct dimensions
      // If they exist with different dimensions, we need to drop and recreate
      try {
        const result = this.db.prepare("SELECT 1 FROM vec_message_embeddings LIMIT 1").get();
        if (result) {
          // Tables exist, assume they have correct dimensions
          // (Recreating would lose data)
          console.error(`✓ sqlite-vec virtual tables already exist`);
          return;
        }
      } catch {
        // Tables don't exist, create them
      }

      // Create message embeddings virtual table
      // dimensions is validated above to be a safe integer
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_message_embeddings
        USING vec0(
          id TEXT PRIMARY KEY,
          embedding float[${dimensions}]
        )
      `);

      // Create decision embeddings virtual table
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_decision_embeddings
        USING vec0(
          id TEXT PRIMARY KEY,
          embedding float[${dimensions}]
        )
      `);

      // Create mistake embeddings virtual table
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_mistake_embeddings
        USING vec0(
          id TEXT PRIMARY KEY,
          embedding float[${dimensions}]
        )
      `);

      console.error(`✓ sqlite-vec virtual tables created (${dimensions} dimensions)`);
    } catch (error) {
      console.error("⚠️ Failed to create vec virtual tables:", (error as Error).message);
      console.error("   Will fall back to BLOB storage");
    }
  }

  /**
   * Apply performance optimizations
   * Based on code-graph-rag-mcp sqlite-manager.ts
   */
  private optimizeDatabase(): void {
    // Skip write-related PRAGMAs in read-only mode
    if (!this.isReadOnly) {
      // WAL mode for concurrent reads during writes
      this.db.pragma("journal_mode = WAL");

      // NORMAL synchronous for balance between safety and speed
      this.db.pragma("synchronous = NORMAL");

      // 4KB page size (optimal for most systems)
      this.db.pragma(`page_size = ${PAGE_SIZE}`);

      // Auto-checkpoint WAL after 1000 pages
      this.db.pragma(`wal_autocheckpoint = ${WAL_AUTOCHECKPOINT}`);

      // Analysis for query optimization
      this.db.pragma("optimize");
    }

    // These PRAGMAs are safe in read-only mode
    // Configurable cache for better performance (default 64MB)
    this.db.pragma(`cache_size = -${this.cacheSizeKb}`);

    // Store temp tables in memory
    this.db.pragma("temp_store = MEMORY");

    // Configurable memory-mapped I/O (default 1GB, safe for most systems)
    if (this.mmapSize > 0) {
      this.db.pragma(`mmap_size = ${this.mmapSize}`);
    }

    // Enable foreign key constraints
    this.db.pragma("foreign_keys = ON");
  }

  /**
   * Initialize database schema from schema.sql
   */
  private initializeSchema(): void {
    try {
      // Check if schema is already initialized
      const schemaVersionExists = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
        )
        .all();

      if (schemaVersionExists.length === 0) {
        // Check if this is a legacy database with incompatible schema
        const conversationsExists = this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
          )
          .all();

        if (conversationsExists.length > 0) {
          // Check if conversations table has expected columns
          const columns = this.db
            .prepare("PRAGMA table_info(conversations)")
            .all() as Array<{ name: string }>;

          const hasSourceType = columns.some(
            (col) => col.name === "source_type"
          );
          const hasMessageCount = columns.some(
            (col) => col.name === "message_count"
          );

          if (!hasSourceType || !hasMessageCount) {
            // Legacy database with incompatible schema - drop and recreate
            console.error(
              "⚠️ Legacy database detected with incompatible schema. Recreating..."
            );

            // Get all table names
            const allTables = this.db
              .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
              )
              .all() as Array<{ name: string }>;

            // Drop all tables (escape table names to prevent SQL injection)
            for (const table of allTables) {
              try {
                const safeName = escapeTableName(table.name);
                this.db.exec(`DROP TABLE IF EXISTS "${safeName}"`);
              } catch (_e) {
                // Ignore errors when dropping (virtual tables may have dependencies)
              }
            }

            console.error("Legacy tables dropped");
          }
        }

        console.error("Initializing database schema...");

        // Read and execute schema.sql
        const schemaPath = join(__dirname, "schema.sql");
        const schema = readFileSync(schemaPath, "utf-8");

        // Execute the entire schema at once
        // SQLite can handle multiple statements in a single exec() call
        this.db.exec(schema);

        // Record schema version (current version is 3)
        this.db
          .prepare(
            "INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)"
          )
          .run(3, Date.now(), "Initial schema with fixed FTS tables");

        console.error("Database schema initialized successfully");
      } else {
        // Apply migrations if needed
        this.applyMigrations();
      }
    } catch (error) {
      console.error("Error initializing schema:", error);
      throw error;
    }
  }

  /**
   * Apply database migrations for existing databases
   */
  private applyMigrations(): void {
    const currentVersion = this.getSchemaVersion();

    // Migration 1 -> 2: Add source_type column to conversations table
    if (currentVersion < 2) {
      try {
        console.error("Applying migration: Adding source_type column...");

        // Check if column already exists (in case of partial migration)
        const columns = this.db
          .prepare("PRAGMA table_info(conversations)")
          .all() as Array<{ name: string }>;

        const hasSourceType = columns.some((col) => col.name === "source_type");

        if (!hasSourceType) {
          this.db.exec(
            "ALTER TABLE conversations ADD COLUMN source_type TEXT DEFAULT 'claude-code'"
          );
          this.db.exec(
            "CREATE INDEX IF NOT EXISTS idx_conv_source ON conversations(source_type)"
          );
        }

        // Record migration
        this.db
          .prepare(
            "INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)"
          )
          .run(2, Date.now(), "Add source_type column and global index support");

        console.error("Migration v2 applied successfully");
      } catch (error) {
        console.error("Error applying migration v2:", error);
        throw error;
      }
    }

    // Migration 2 -> 3: Fix messages_fts schema (remove non-existent context column)
    if (currentVersion < 3) {
      try {
        console.error(
          "Applying migration v3: Fixing messages_fts schema..."
        );

        // FTS5 virtual tables can't be altered, must drop and recreate
        // The old schema had 'context' column which doesn't exist in messages table
        this.db.exec("DROP TABLE IF EXISTS messages_fts");
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            id UNINDEXED,
            content,
            metadata,
            content=messages,
            content_rowid=rowid
          )
        `);

        // Rebuild FTS index from messages table
        try {
          this.db.exec(
            "INSERT INTO messages_fts(messages_fts) VALUES('rebuild')"
          );
          console.error("FTS index rebuilt successfully");
        } catch (ftsError) {
          console.error(
            "FTS rebuild warning:",
            (ftsError as Error).message
          );
        }

        // Record migration
        this.db
          .prepare(
            "INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)"
          )
          .run(
            3,
            Date.now(),
            "Fix messages_fts schema - remove context column"
          );

        console.error("Migration v3 applied successfully");
      } catch (error) {
        console.error("Error applying migration v3:", error);
        throw error;
      }
    }
  }

  /**
   * Get the underlying database instance
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * Execute a transaction
   */
  transaction<T>(fn: () => T): T {
    const tx = this.db.transaction(fn);
    return tx();
  }

  /**
   * Prepare a statement
   */
  prepare<T extends unknown[] = unknown[]>(sql: string): Database.Statement<T> {
    return this.db.prepare<T>(sql);
  }

  /**
   * Execute SQL directly
   */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  /**
   * Get database statistics
   */
  getStats(): {
    dbPath: string;
    fileSize: number;
    pageCount: number;
    pageSize: number;
    wal: { enabled: boolean; size: number | null };
  } {
    const pageCount = this.db.pragma("page_count", { simple: true }) as number;
    const pageSize = this.db.pragma("page_size", { simple: true }) as number;
    const journalMode = this.db.pragma("journal_mode", {
      simple: true,
    }) as string;

    let walSize: number | null = null;
    if (journalMode === "wal") {
      try {
        const walStat = this.db
          .prepare("SELECT * FROM pragma_wal_checkpoint('PASSIVE')")
          .get() as { log?: number } | undefined;
        walSize = walStat?.log ?? null;
      } catch (_e) {
        // WAL not available
      }
    }

    return {
      dbPath: this.dbPath,
      fileSize: pageCount * pageSize,
      pageCount,
      pageSize,
      wal: {
        enabled: journalMode === "wal",
        size: walSize,
      },
    };
  }

  /**
   * Get database file path
   */
  getDbPath(): string {
    return this.dbPath;
  }

  /**
   * Vacuum the database to reclaim space
   */
  vacuum(): void {
    if (this.isReadOnly) {
      throw new Error("Cannot vacuum database in read-only mode");
    }
    this.db.exec("VACUUM");
  }

  /**
   * Analyze the database for query optimization
   */
  analyze(): void {
    if (this.isReadOnly) {
      throw new Error("Cannot analyze database in read-only mode");
    }
    this.db.exec("ANALYZE");
  }

  /**
   * Checkpoint the WAL file
   */
  checkpoint(): void {
    if (this.isReadOnly) {
      throw new Error("Cannot checkpoint database in read-only mode");
    }
    this.db.pragma("wal_checkpoint(TRUNCATE)");
  }

  /**
   * Get current schema version
   */
  getSchemaVersion(): number {
    try {
      const result = this.db
        .prepare("SELECT MAX(version) as version FROM schema_version")
        .get() as { version: number } | undefined;
      return result?.version || 0;
    } catch (_error) {
      return 0;
    }
  }
}

// Instance cache keyed by dbPath to support multiple databases
const instances = new Map<string, SQLiteManager>();

/**
 * Get a SQLiteManager instance for the given config.
 * Instances are cached by dbPath to avoid re-opening the same database.
 */
export function getSQLiteManager(config?: SQLiteConfig): SQLiteManager {
  // Create a temporary instance to resolve the dbPath from config
  const resolvedPath = config?.dbPath || (() => {
    const projectPath = config?.projectPath || process.cwd();
    const projectFolderName = pathToProjectFolderName(projectPath);
    return join(
      homedir(),
      ".claude",
      "projects",
      projectFolderName,
      ".claude-conversations-memory.db"
    );
  })();

  // Check if we already have an instance for this path
  const existing = instances.get(resolvedPath);
  if (existing) {
    return existing;
  }

  // Create new instance and cache it
  const instance = new SQLiteManager(config);
  instances.set(resolvedPath, instance);
  return instance;
}

/**
 * Reset all cached SQLiteManager instances.
 * Useful for testing or when switching projects.
 */
export function resetSQLiteManager(): void {
  for (const instance of instances.values()) {
    instance.close();
  }
  instances.clear();
}

/**
 * Reset a specific SQLiteManager instance by path.
 */
export function resetSQLiteManagerByPath(dbPath: string): void {
  const instance = instances.get(dbPath);
  if (instance) {
    instance.close();
    instances.delete(dbPath);
  }
}
