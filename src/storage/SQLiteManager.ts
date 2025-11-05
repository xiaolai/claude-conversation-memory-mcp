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
import { pathToProjectFolderName } from "../utils/sanitization.js";
import * as sqliteVec from "sqlite-vec";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Performance constants (from code-graph-rag-mcp)
const CACHE_SIZE_KB = 64000; // 64MB cache
const MMAP_SIZE = 30000000000; // 30GB memory-mapped I/O
const PAGE_SIZE = 4096; // 4KB page size
const WAL_AUTOCHECKPOINT = 1000; // Checkpoint WAL after 1000 pages

export interface SQLiteConfig {
  dbPath?: string;
  projectPath?: string;
  readOnly?: boolean;
  verbose?: boolean;
}

export class SQLiteManager {
  private db: Database.Database;
  private dbPath: string;
  private isReadOnly: boolean;

  constructor(config: SQLiteConfig = {}) {
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

    // Ensure directory exists
    this.ensureDirectoryExists();

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
      console.log("✓ sqlite-vec extension loaded");
      // Note: Vec tables will be created when embedding dimensions are known
    } catch (error) {
      console.warn("⚠️ Failed to load sqlite-vec extension:", (error as Error).message);
      console.warn("   Vector search will use BLOB fallback");
    }
  }

  /**
   * Create sqlite-vec virtual tables for vector search with specified dimensions
   * Public method called when embedding provider dimensions are known
   */
  createVecTablesWithDimensions(dimensions: number): void {
    try {
      // Check if tables already exist with correct dimensions
      // If they exist with different dimensions, we need to drop and recreate
      try {
        const result = this.db.prepare("SELECT 1 FROM vec_message_embeddings LIMIT 1").get();
        if (result) {
          // Tables exist, assume they have correct dimensions
          // (Recreating would lose data)
          console.log(`✓ sqlite-vec virtual tables already exist`);
          return;
        }
      } catch {
        // Tables don't exist, create them
      }

      // Create message embeddings virtual table
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

      console.log(`✓ sqlite-vec virtual tables created (${dimensions} dimensions)`);
    } catch (error) {
      console.warn("⚠️ Failed to create vec virtual tables:", (error as Error).message);
      console.warn("   Will fall back to BLOB storage");
    }
  }

  /**
   * Apply performance optimizations
   * Based on code-graph-rag-mcp sqlite-manager.ts
   */
  private optimizeDatabase(): void {
    // WAL mode for concurrent reads during writes
    this.db.pragma("journal_mode = WAL");

    // 64MB cache for better performance
    this.db.pragma(`cache_size = -${CACHE_SIZE_KB}`);

    // NORMAL synchronous for balance between safety and speed
    this.db.pragma("synchronous = NORMAL");

    // Store temp tables in memory
    this.db.pragma("temp_store = MEMORY");

    // Memory-mapped I/O for faster access
    this.db.pragma(`mmap_size = ${MMAP_SIZE}`);

    // 4KB page size (optimal for most systems)
    this.db.pragma(`page_size = ${PAGE_SIZE}`);

    // Auto-checkpoint WAL after 1000 pages
    this.db.pragma(`wal_autocheckpoint = ${WAL_AUTOCHECKPOINT}`);

    // Enable foreign key constraints
    this.db.pragma("foreign_keys = ON");

    // Analysis for query optimization
    this.db.pragma("optimize");
  }

  /**
   * Initialize database schema from schema.sql
   */
  private initializeSchema(): void {
    try {
      // Check if schema is already initialized
      const tables = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
        )
        .all();

      if (tables.length === 0) {
        console.log("Initializing database schema...");

        // Read and execute schema.sql
        const schemaPath = join(__dirname, "schema.sql");
        const schema = readFileSync(schemaPath, "utf-8");

        // Execute the entire schema at once
        // SQLite can handle multiple statements in a single exec() call
        this.db.exec(schema);

        // Record schema version
        this.db
          .prepare(
            "INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)"
          )
          .run(1, Date.now(), "Initial schema");

        console.log("Database schema initialized successfully");
      }
    } catch (error) {
      console.error("Error initializing schema:", error);
      throw error;
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
   * Vacuum the database to reclaim space
   */
  vacuum(): void {
    this.db.exec("VACUUM");
  }

  /**
   * Analyze the database for query optimization
   */
  analyze(): void {
    this.db.exec("ANALYZE");
  }

  /**
   * Checkpoint the WAL file
   */
  checkpoint(): void {
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

// Singleton instance
let instance: SQLiteManager | null = null;

export function getSQLiteManager(config?: SQLiteConfig): SQLiteManager {
  if (!instance) {
    instance = new SQLiteManager(config);
  }
  return instance;
}

export function resetSQLiteManager(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
