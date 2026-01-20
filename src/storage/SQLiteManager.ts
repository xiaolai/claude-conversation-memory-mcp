/**
 * SQLite Manager with optimized settings for local indexing workloads
 */

import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync, openSync, closeSync, renameSync } from "fs";
import { join, dirname, basename, resolve } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { pathToProjectFolderName, escapeTableName } from "../utils/sanitization.js";
import { getCanonicalProjectPath } from "../utils/worktree.js";
import * as sqliteVec from "sqlite-vec";
import { MigrationManager, migrations } from "./migrations.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Performance constants
const DEFAULT_CACHE_SIZE_KB = 64000; // 64MB cache
const DEFAULT_MMAP_SIZE = 1000000000; // 1GB memory-mapped I/O (safe default)
const PAGE_SIZE = 4096; // 4KB page size
const WAL_AUTOCHECKPOINT = 1000; // Checkpoint WAL after 1000 pages
const NEW_DB_FILE_NAME = ".cccmemory.db";
const LEGACY_DB_FILE_NAMES = [".claude-conversations-memory.db", ".codex-conversations-memory.db"];

export interface SQLiteConfig {
  dbPath?: string;
  projectPath?: string;
  readOnly?: boolean;
  verbose?: boolean;
  dbMode?: "single" | "per-project";
  /** Memory-mapped I/O size in bytes (default: 1GB). Set to 0 to disable. */
  mmapSize?: number;
  /** Cache size in KB (default: 64MB) */
  cacheSizeKb?: number;
}

function resolveDbPath(config: SQLiteConfig = {}): string {
  const projectPath = config.projectPath || process.cwd();
  const canonicalPath = getCanonicalProjectPath(projectPath).canonicalPath;
  const projectFolderName = pathToProjectFolderName(canonicalPath);
  const homeDir = process.env.HOME ? resolve(process.env.HOME) : homedir();
  const defaultPath = join(
    homeDir,
    ".claude",
    "projects",
    projectFolderName,
    NEW_DB_FILE_NAME
  );
  const fallbackPath = join(canonicalPath, ".cccmemory", NEW_DB_FILE_NAME);
  const singleDbPath = join(homeDir, NEW_DB_FILE_NAME);
  const dbMode = config.dbMode || (process.env.CCCMEMORY_DB_MODE as "single" | "per-project" | undefined) || "single";

  const normalizeRequestedPath = (requestedPath: string): string => {
    const requestedBase = basename(requestedPath);
    if (LEGACY_DB_FILE_NAMES.includes(requestedBase)) {
      return join(dirname(requestedPath), NEW_DB_FILE_NAME);
    }
    return requestedPath;
  };

  const getLegacyCandidates = (dir: string, targetPath: string): string[] => {
    return LEGACY_DB_FILE_NAMES
      .map((name) => join(dir, name))
      .filter((legacyPath) => legacyPath !== targetPath);
  };

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

  const maybeMigrateLegacyDb = (targetPath: string, readOnly: boolean): string => {
    if (existsSync(targetPath)) {
      return targetPath;
    }

    const legacyCandidates = getLegacyCandidates(dirname(targetPath), targetPath);
    const legacyPath = legacyCandidates.find((candidate) => existsSync(candidate));
    if (!legacyPath) {
      return targetPath;
    }

    if (readOnly) {
      console.error(
        `⚠️ Found legacy database at ${legacyPath}. Using legacy file in read-only mode.`
      );
      return legacyPath;
    }

    try {
      renameSync(legacyPath, targetPath);
      console.error(`✓ Migrated legacy database to ${targetPath}`);
      return targetPath;
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === "EACCES" || err.code === "EPERM" || err.code === "EXDEV" || err.code === "EROFS") {
        const canWriteLegacy = canWriteExistingDbFile(legacyPath);
        if (canWriteLegacy) {
          console.error(
            `⚠️ Failed to rename legacy database (${legacyPath} → ${targetPath}). Using legacy file instead.`
          );
          return legacyPath;
        }
        throw new Error(
          `Legacy database found at ${legacyPath} but cannot be migrated or written.\n` +
            `Fix permissions for ${dirname(legacyPath)} or set CCCMEMORY_DB_PATH to a writable file path.`
        );
      }
      throw error;
    }
  };

  const requestedPath = config.dbPath || process.env.CCCMEMORY_DB_PATH;
  if (requestedPath) {
    const normalizedPath = normalizeRequestedPath(requestedPath);
    if (config.readOnly) {
      const migratedPath = maybeMigrateLegacyDb(normalizedPath, true);
      if (existsSync(migratedPath)) {
        return migratedPath;
      }
      throw new Error(
        `Database file not found at ${migratedPath} (read-only mode).\n` +
          `Provide a valid path via CCCMEMORY_DB_PATH or config.dbPath.`
      );
    }
    const migratedPath = maybeMigrateLegacyDb(normalizedPath, false);
    if (migratedPath !== normalizedPath) {
      return migratedPath;
    }
    if (canCreateDbFile(normalizedPath)) {
      return normalizedPath;
    }
    throw new Error(
      `Database path is not writable: ${normalizedPath}\n` +
        "Fix permissions or set CCCMEMORY_DB_PATH to a writable file path.\n" +
        "If you're running under Codex or Claude with a locked home dir (~/.claude or ~/.codex), " +
        "you must set CCCMEMORY_DB_PATH explicitly."
    );
  }

  if (dbMode === "single") {
    if (config.readOnly) {
      const migratedSingle = maybeMigrateLegacyDb(singleDbPath, true);
      if (existsSync(migratedSingle)) {
        return migratedSingle;
      }
      throw new Error(
        `Database file not found at ${singleDbPath} (read-only mode).\n` +
          "Create the database in write mode, or set CCCMEMORY_DB_PATH to an existing file."
      );
    }
    const migratedSingle = maybeMigrateLegacyDb(singleDbPath, false);
    if (migratedSingle !== singleDbPath) {
      return migratedSingle;
    }
    if (canCreateDbFile(singleDbPath)) {
      return singleDbPath;
    }
    throw new Error(
      `Unable to create database at ${singleDbPath}.\n` +
        "Fix permissions or set CCCMEMORY_DB_PATH to a writable file path.\n" +
        "If you're running under Codex or Claude with a locked home dir (~/.claude or ~/.codex), " +
        "you must set CCCMEMORY_DB_PATH explicitly."
    );
  }

  if (config.readOnly) {
    const migratedDefault = maybeMigrateLegacyDb(defaultPath, true);
    if (existsSync(migratedDefault)) {
      return migratedDefault;
    }
    if (existsSync(fallbackPath)) {
      console.error(
        `⚠️ Using existing project-local database at ${fallbackPath}. ` +
          "No new files are created there automatically. " +
          "Set CCCMEMORY_DB_PATH to make this explicit."
      );
      return fallbackPath;
    }
    throw new Error(
      `Database file not found at ${defaultPath} (read-only mode).\n` +
        "Create the database in write mode, or set CCCMEMORY_DB_PATH to an existing file."
    );
  }

  const migratedDefault = maybeMigrateLegacyDb(defaultPath, false);
  if (migratedDefault !== defaultPath) {
    return migratedDefault;
  }
  if (canCreateDbFile(defaultPath)) {
    return defaultPath;
  }
  if (existsSync(fallbackPath) && canWriteExistingDbFile(fallbackPath)) {
    console.error(
      `⚠️ Using existing project-local database at ${fallbackPath}. ` +
        "No new files are created there automatically. " +
        "Set CCCMEMORY_DB_PATH to make this explicit."
    );
    return fallbackPath;
  }
  throw new Error(
    `Unable to create database in ${dirname(defaultPath)}.\n` +
      `Fix permissions for ${dirname(defaultPath)} or set CCCMEMORY_DB_PATH to a writable file path.\n` +
      "If you're running under Codex or Claude with a locked home dir (~/.claude or ~/.codex), " +
      "you must set CCCMEMORY_DB_PATH explicitly."
  );
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
    this.dbPath = resolveDbPath(config);

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
      // Check if ALL vec tables exist - only skip if all three exist
      let allTablesExist = true;
      const vecTables = ['vec_message_embeddings', 'vec_decision_embeddings', 'vec_mistake_embeddings'];
      for (const table of vecTables) {
        try {
          this.db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
        } catch {
          allTablesExist = false;
          break;
        }
      }

      if (allTablesExist) {
        console.error(`✓ sqlite-vec virtual tables already exist`);
        return;
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
   */
  private optimizeDatabase(): void {
    // Skip write-related PRAGMAs in read-only mode
    if (!this.isReadOnly) {
      // WAL mode for concurrent reads during writes
      // If WAL cannot be enabled (e.g., sandboxed filesystem), fall back to MEMORY
      try {
        this.db.pragma("journal_mode = WAL");
      } catch (error) {
        console.error("⚠️ Failed to enable WAL mode, falling back to MEMORY journal:", (error as Error).message);
        this.db.pragma("journal_mode = MEMORY");
      }

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
          const conversationColumns = this.db
            .prepare("PRAGMA table_info(conversations)")
            .all() as Array<{ name: string }>;

          const hasSourceType = conversationColumns.some(
            (col) => col.name === "source_type"
          );
          const hasMessageCount = conversationColumns.some(
            (col) => col.name === "message_count"
          );
          const hasProjectId = conversationColumns.some(
            (col) => col.name === "project_id"
          );
          const hasExternalId = conversationColumns.some(
            (col) => col.name === "external_id"
          );

          const messagesExists = this.db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'"
            )
            .all();
          const messageColumns = messagesExists.length > 0
            ? (this.db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>)
            : [];
          const messageHasExternalId = messageColumns.some(
            (col) => col.name === "external_id"
          );

          if (!hasSourceType || !hasMessageCount || !hasProjectId || !hasExternalId || !messageHasExternalId) {
            // Legacy database with incompatible schema - drop and recreate
            console.error(
              "⚠️ Legacy database detected with incompatible schema. Recreating..."
            );

            this.dropAllTables();

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

        const latestVersion = migrations[migrations.length - 1]?.version ?? 1;
        const latestDescription = migrations[migrations.length - 1]?.description ?? "Initial schema";

        // Record schema version (schema.sql already includes latest tables)
        this.db
          .prepare(
            "INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)"
          )
          .run(latestVersion, Date.now(), latestDescription);

        console.error("Database schema initialized successfully");
      } else {
        // If schema_version exists, verify core columns match expected schema
        if (this.isLegacySchema()) {
          console.error(
            "⚠️ Legacy database detected with incompatible schema. Recreating..."
          );
          this.dropAllTables();
          console.error("Legacy tables dropped");

          console.error("Initializing database schema...");
          const schemaPath = join(__dirname, "schema.sql");
          const schema = readFileSync(schemaPath, "utf-8");
          this.db.exec(schema);

          const latestVersion = migrations[migrations.length - 1]?.version ?? 1;
          const latestDescription = migrations[migrations.length - 1]?.description ?? "Initial schema";
          this.db
            .prepare(
              "INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)"
            )
            .run(latestVersion, Date.now(), latestDescription);

          console.error("Database schema initialized successfully");
        } else {
          // Apply migrations if needed
          this.applyMigrations();
        }
      }
    } catch (error) {
      console.error("Error initializing schema:", error);
      throw error;
    }
  }

  private isLegacySchema(): boolean {
    const conversationsExists = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
      )
      .all();
    if (conversationsExists.length === 0) {
      return false;
    }

    const conversationColumns = this.db
      .prepare("PRAGMA table_info(conversations)")
      .all() as Array<{ name: string }>;
    const hasProjectId = conversationColumns.some((col) => col.name === "project_id");
    const hasExternalId = conversationColumns.some((col) => col.name === "external_id");

    const messagesExists = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'"
      )
      .all();
    const messageColumns = messagesExists.length > 0
      ? (this.db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>)
      : [];
    const messageHasExternalId = messageColumns.some((col) => col.name === "external_id");

    return !hasProjectId || !hasExternalId || !messageHasExternalId;
  }

  private dropAllTables(): void {
    const allTables = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .all() as Array<{ name: string }>;

    for (const table of allTables) {
      try {
        const safeName = escapeTableName(table.name);
        this.db.exec(`DROP TABLE IF EXISTS "${safeName}"`);
      } catch (_e) {
        // Ignore errors when dropping (virtual tables may have dependencies)
      }
    }
  }

  /**
   * Apply database migrations for existing databases
   */
  private applyMigrations(): void {
    // Ensure schema_version table exists (legacy DBs may not have it)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT,
        checksum TEXT
      )
    `);

    const manager = new MigrationManager(this);
    manager.applyPendingMigrations();
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
  const resolvedPath = resolveDbPath(config);

  // Check if we already have an instance for this path
  const existing = instances.get(resolvedPath);
  if (existing) {
    return existing;
  }

  // Create new instance and cache it
  const instance = new SQLiteManager({ ...config, dbPath: resolvedPath });
  instances.set(instance.getDbPath(), instance);
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
