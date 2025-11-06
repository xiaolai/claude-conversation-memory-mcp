/**
 * Project Migration Utility
 * Handles migration of conversation history when project directories are renamed
 */

import { existsSync, readdirSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import Database from "better-sqlite3";
import { pathToProjectFolderName } from "./sanitization.js";

export interface OldFolder {
  folderPath: string;
  folderName: string;
  storedProjectPath: string | null;
  stats: {
    conversations: number;
    messages: number;
    lastActivity: number | null;
  };
  score: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  stats?: {
    conversations: number;
    messages: number;
    files: number;
  };
}

export interface MigrationResult {
  success: boolean;
  filesCopied: number;
  databaseUpdated: boolean;
  message: string;
}

interface ScoreFactors {
  pathScore: number;
  folderScore: number;
  hasDatabase: boolean;
  jsonlCount: number;
}

export class ProjectMigration {
  private projectsDir: string;

  constructor(_sqliteManager?: unknown, projectsDir?: string) {
    // Parameter kept for backwards compatibility but not used
    // Allow override of projects directory for testing
    this.projectsDir = projectsDir || join(homedir(), ".claude", "projects");
  }

  /**
   * Get the projects directory (for use by other classes)
   */
  getProjectsDir(): string {
    return this.projectsDir;
  }

  /**
   * Discover old conversation folders using combined approach
   */
  async discoverOldFolders(currentProjectPath: string): Promise<OldFolder[]> {
    const candidates: OldFolder[] = [];
    const projectsDir = this.projectsDir;

    if (!existsSync(projectsDir)) {
      return [];
    }

    const folders = readdirSync(projectsDir);

    for (const folder of folders) {
      const folderPath = join(projectsDir, folder);
      const dbPath = join(folderPath, ".claude-conversations-memory.db");

      let storedPath: string | null = null;
      let stats = { conversations: 0, messages: 0, lastActivity: null as number | null };
      let pathScore = 0;

      // Strategy 1: Check database for stored project_path
      if (existsSync(dbPath)) {
        try {
          const db = new Database(dbPath, { readonly: true });

          // Get stored project path
          const pathRow = db
            .prepare("SELECT project_path FROM conversations LIMIT 1")
            .get() as { project_path: string } | undefined;
          storedPath = pathRow?.project_path || null;

          // Get statistics
          const statsRow = db.prepare(`
            SELECT
              COUNT(DISTINCT id) as conversations,
              MAX(last_message_at) as last_activity
            FROM conversations
          `).get() as { conversations: number; last_activity: number | null } | undefined;

          const messageCount = db
            .prepare("SELECT COUNT(*) as count FROM messages")
            .get() as { count: number } | undefined;

          stats = {
            conversations: statsRow?.conversations || 0,
            messages: messageCount?.count || 0,
            lastActivity: statsRow?.last_activity || null
          };

          db.close();

          // Score based on path match
          if (storedPath) {
            pathScore = this.scorePath(currentProjectPath, storedPath);
          }
        } catch (_error) {
          // Database exists but can't read - still a candidate
          pathScore = 10;
        }
      }

      // Strategy 2: Folder name similarity
      const expectedFolder = pathToProjectFolderName(currentProjectPath);
      const folderScore = this.scoreFolderName(expectedFolder, folder);

      // Strategy 3: Check for JSONL files
      let jsonlCount = 0;
      try {
        jsonlCount = readdirSync(folderPath).filter(f => f.endsWith(".jsonl")).length;
      } catch (_error) {
        // Can't read folder
        continue;
      }

      // Calculate overall score
      const score = this.calculateOverallScore({
        pathScore,
        folderScore,
        hasDatabase: existsSync(dbPath),
        jsonlCount
      });

      if (score > 0 || storedPath !== null) {
        candidates.push({
          folderPath,
          folderName: folder,
          storedProjectPath: storedPath,
          stats,
          score
        });
      }
    }

    // Sort by score (highest first)
    return candidates.sort((a, b) => b.score - a.score);
  }

  /**
   * Validate migration is safe and possible
   */
  validateMigration(
    sourceFolder: string,
    targetFolder: string,
    mode: "migrate" | "merge" = "migrate"
  ): ValidationResult {
    const errors: string[] = [];

    // Check source exists
    if (!existsSync(sourceFolder)) {
      errors.push("Source folder does not exist");
      return { valid: false, errors };
    }

    // Check source has JSONL files
    const sourceFiles = readdirSync(sourceFolder).filter(f => f.endsWith(".jsonl"));
    if (sourceFiles.length === 0) {
      errors.push("Source folder has no conversation files");
    }

    // Check source database is readable
    const sourceDb = join(sourceFolder, ".claude-conversations-memory.db");
    if (existsSync(sourceDb)) {
      try {
        const db = new Database(sourceDb, { readonly: true });
        db.prepare("SELECT 1 FROM conversations LIMIT 1").get();
        db.close();
      } catch (_error) {
        errors.push("Source database is corrupted or unreadable");
      }
    }

    // Check target doesn't have data (conflict detection) - ONLY for migrate mode
    if (mode === "migrate" && existsSync(targetFolder)) {
      const targetFiles = readdirSync(targetFolder).filter(f => f.endsWith(".jsonl"));
      if (targetFiles.length > 0) {
        errors.push("Target folder already has conversation data");
      }
    }

    // Get statistics if validation passed so far
    let stats: { conversations: number; messages: number; files: number } | undefined;
    if (errors.length === 0 && existsSync(sourceDb)) {
      try {
        const db = new Database(sourceDb, { readonly: true });
        const convCount = db
          .prepare("SELECT COUNT(*) as count FROM conversations")
          .get() as { count: number };
        const msgCount = db
          .prepare("SELECT COUNT(*) as count FROM messages")
          .get() as { count: number };
        db.close();

        stats = {
          conversations: convCount.count,
          messages: msgCount.count,
          files: sourceFiles.length
        };
      } catch (_error) {
        // Can't get stats, but not a blocker
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      stats
    };
  }

  /**
   * Execute migration (copy files and update database)
   */
  async executeMigration(
    sourceFolder: string,
    targetFolder: string,
    oldProjectPath: string,
    newProjectPath: string,
    dryRun: boolean,
    mode: "migrate" | "merge" = "migrate"
  ): Promise<MigrationResult> {
    // Validate first
    const validation = this.validateMigration(sourceFolder, targetFolder, mode);
    if (!validation.valid) {
      throw new Error(`Migration validation failed: ${validation.errors.join(", ")}`);
    }

    if (dryRun) {
      return {
        success: true,
        filesCopied: validation.stats?.files || 0,
        databaseUpdated: false,
        message: "Dry run: No changes made"
      };
    }

    // Create target folder
    if (!existsSync(targetFolder)) {
      mkdirSync(targetFolder, { recursive: true });
    }

    const sourceDb = join(sourceFolder, ".claude-conversations-memory.db");
    const targetDb = join(targetFolder, ".claude-conversations-memory.db");

    // Branch based on mode
    if (mode === "merge") {
      return this.executeMerge(
        sourceFolder,
        targetFolder,
        sourceDb,
        targetDb,
        oldProjectPath,
        newProjectPath
      );
    } else {
      // Original migrate logic (replace target)
      // Copy all JSONL files
      const jsonlFiles = readdirSync(sourceFolder).filter(f => f.endsWith(".jsonl"));
      let filesCopied = 0;

      for (const file of jsonlFiles) {
        const sourcePath = join(sourceFolder, file);
        const targetPath = join(targetFolder, file);
        copyFileSync(sourcePath, targetPath);
        filesCopied++;
      }

      if (existsSync(sourceDb)) {
        // Create backup
        const backupPath = join(sourceFolder, ".claude-conversations-memory.db.bak");
        copyFileSync(sourceDb, backupPath);

        // Copy database
        copyFileSync(sourceDb, targetDb);

        // Update project_path in the copied database
        this.updateProjectPaths(targetDb, oldProjectPath, newProjectPath);
      }

      return {
        success: true,
        filesCopied,
        databaseUpdated: true,
        message: `Migrated ${filesCopied} conversation files`
      };
    }
  }

  /**
   * Execute merge (combine source into existing target)
   */
  private executeMerge(
    sourceFolder: string,
    targetFolder: string,
    sourceDb: string,
    targetDb: string,
    oldProjectPath: string,
    newProjectPath: string
  ): MigrationResult {
    // Copy only JSONL files that don't exist in target (skip duplicates)
    const sourceFiles = readdirSync(sourceFolder).filter(f => f.endsWith(".jsonl"));
    const existingFiles = existsSync(targetFolder)
      ? readdirSync(targetFolder).filter(f => f.endsWith(".jsonl"))
      : [];
    const existingSet = new Set(existingFiles);

    let filesCopied = 0;
    for (const file of sourceFiles) {
      if (!existingSet.has(file)) {
        const sourcePath = join(sourceFolder, file);
        const targetPath = join(targetFolder, file);
        copyFileSync(sourcePath, targetPath);
        filesCopied++;
      }
    }

    // Merge databases
    if (existsSync(sourceDb)) {
      if (existsSync(targetDb)) {
        // Backup target database before merge
        const backupPath = join(targetFolder, ".claude-conversations-memory.db.bak");
        copyFileSync(targetDb, backupPath);

        // Merge source into target
        this.mergeDatabase(sourceDb, targetDb, oldProjectPath, newProjectPath);
      } else {
        // No target database yet, just copy
        copyFileSync(sourceDb, targetDb);
        this.updateProjectPaths(targetDb, oldProjectPath, newProjectPath);
      }
    }

    return {
      success: true,
      filesCopied,
      databaseUpdated: true,
      message: `Merged ${filesCopied} new conversation files into target`
    };
  }

  /**
   * Merge source database into target database (INSERT OR IGNORE strategy)
   */
  private mergeDatabase(
    sourceDbPath: string,
    targetDbPath: string,
    oldProjectPath: string,
    newProjectPath: string
  ): void {
    // Check which tables exist BEFORE attaching
    const source = new Database(sourceDbPath, { readonly: true });
    const sourceTables = new Set(
      (
        source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
      ).map(row => row.name)
    );
    source.close();

    const target = new Database(targetDbPath);
    const targetTables = new Set(
      (
        target.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
      ).map(row => row.name)
    );

    try {
      target.exec("BEGIN TRANSACTION");

      // Attach source database
      target.exec(`ATTACH DATABASE '${sourceDbPath}' AS source`);

      // Merge conversations (always exists)
      target.exec(`
        INSERT OR IGNORE INTO conversations
        SELECT * FROM source.conversations
      `);

      // Merge other tables only if they exist in both databases
      const tablesToMerge = [
        "messages",
        "tool_uses",
        "decisions",
        "mistakes",
        "requirements",
        "file_evolution",
        "git_commits"
      ];

      for (const table of tablesToMerge) {
        if (sourceTables.has(table) && targetTables.has(table)) {
          target.exec(`
            INSERT OR IGNORE INTO ${table}
            SELECT * FROM source.${table}
          `);
        }
      }

      // Update project_path for newly merged conversations from source
      const stmt = target.prepare(`
        UPDATE conversations
        SET project_path = ?
        WHERE project_path = ?
      `);
      stmt.run(newProjectPath, oldProjectPath);

      target.exec("COMMIT");

      // Detach source after commit
      target.exec("DETACH DATABASE source");
    } catch (error) {
      try {
        target.exec("ROLLBACK");
      } catch (_rollbackError) {
        // Rollback might fail if transaction already ended
      }
      throw error;
    } finally {
      target.close();
    }
  }

  /**
   * Update project_path in database (with transaction)
   */
  private updateProjectPaths(dbPath: string, oldPath: string, newPath: string): void {
    const db = new Database(dbPath);

    try {
      db.exec("BEGIN TRANSACTION");

      const stmt = db.prepare("UPDATE conversations SET project_path = ? WHERE project_path = ?");
      const result = stmt.run(newPath, oldPath);

      if (result.changes === 0) {
        throw new Error("No conversations updated - path mismatch");
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      db.close();
      throw error;
    }

    db.close();
  }

  /**
   * Score path similarity
   */
  scorePath(currentPath: string, oldPath: string): number {
    // Exact match
    if (currentPath === oldPath) {
      return 100;
    }

    // Split into components
    const currentParts = currentPath.split("/").filter(p => p.length > 0);
    const oldParts = oldPath.split("/").filter(p => p.length > 0);

    // Count matching components
    let matches = 0;
    const minLength = Math.min(currentParts.length, oldParts.length);

    for (let i = 0; i < minLength; i++) {
      if (currentParts[i] === oldParts[i]) {
        matches++;
      }
    }

    // If only one component differs and same length, likely a rename
    if (
      currentParts.length === oldParts.length &&
      matches === currentParts.length - 1
    ) {
      return 80;
    }

    // General similarity score
    return (matches / Math.max(currentParts.length, oldParts.length)) * 100;
  }

  /**
   * Score folder name similarity
   */
  scoreFolderName(expected: string, actual: string): number {
    // Exact match
    if (expected === actual) {
      return 100;
    }

    // Split by dashes
    const expectedParts = expected.split("-").filter(p => p.length > 0);
    const actualParts = actual.split("-").filter(p => p.length > 0);

    // Count matching parts
    let matches = 0;
    const minLength = Math.min(expectedParts.length, actualParts.length);

    for (let i = 0; i < minLength; i++) {
      if (expectedParts[i] === actualParts[i]) {
        matches++;
      }
    }

    // Calculate percentage
    return (matches / Math.max(expectedParts.length, actualParts.length)) * 100;
  }

  /**
   * Calculate overall score from multiple factors
   */
  calculateOverallScore(factors: ScoreFactors): number {
    let score = 0;

    // Path similarity is most important (0-100 points)
    score += factors.pathScore;

    // Folder name similarity (weighted 50%)
    score += factors.folderScore * 0.5;

    // Having a database is good (20 points)
    if (factors.hasDatabase) {
      score += 20;
    }

    // More JSONL files = higher confidence (1 point per file, max 30)
    score += Math.min(factors.jsonlCount, 30);

    return score;
  }
}
