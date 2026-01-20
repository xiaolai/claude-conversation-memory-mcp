/**
 * Project Migration Utility
 * Handles migration of conversation history when project directories are renamed
 */

import { existsSync, readdirSync, mkdirSync, copyFileSync } from "fs";
import { basename, dirname, join } from "path";
import { homedir } from "os";
import { getSQLiteManager, type SQLiteManager } from "../storage/SQLiteManager.js";
import { getCanonicalProjectPath } from "./worktree.js";
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
  private sqliteManager: SQLiteManager;
  private db: ReturnType<SQLiteManager["getDatabase"]>;

  constructor(sqliteManager?: SQLiteManager, projectsDir?: string) {
    this.sqliteManager = sqliteManager ?? getSQLiteManager();
    this.db = this.sqliteManager.getDatabase();
    // Allow override of projects directory for testing
    this.projectsDir = projectsDir || join(homedir(), ".claude", "projects");
  }

  private buildFolderCandidates(): Map<
    string,
    Array<{ projectId: number; path: string }>
  > {
    const candidates = new Map<string, Array<{ projectId: number; path: string }>>();

    const addCandidate = (path: string, projectId: number) => {
      const folderName = pathToProjectFolderName(path);
      const list = candidates.get(folderName) ?? [];
      list.push({ projectId, path });
      candidates.set(folderName, list);
    };

    try {
      const projects = this.db
        .prepare("SELECT id, canonical_path FROM projects")
        .all() as Array<{ id: number; canonical_path: string }>;
      for (const project of projects) {
        addCandidate(project.canonical_path, project.id);
      }

      const aliases = this.db
        .prepare("SELECT alias_path, project_id FROM project_aliases")
        .all() as Array<{ alias_path: string; project_id: number }>;
      for (const alias of aliases) {
        addCandidate(alias.alias_path, alias.project_id);
      }
    } catch (_error) {
      // If DB is unavailable, skip DB-backed candidates
    }

    return candidates;
  }

  private selectBestCandidate(
    candidates: Array<{ projectId: number; path: string }>,
    currentProjectPath?: string
  ): { projectId: number; path: string } | null {
    if (candidates.length === 0) {
      return null;
    }

    if (!currentProjectPath) {
      return candidates[0];
    }

    let best = candidates[0];
    let bestScore = this.scorePath(currentProjectPath, candidates[0].path);

    for (let i = 1; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const score = this.scorePath(currentProjectPath, candidate.path);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return best;
  }

  private getProjectStats(projectId: number): {
    conversations: number;
    messages: number;
    lastActivity: number | null;
  } {
    const statsRow = this.db
      .prepare(
        `
        SELECT
          COUNT(DISTINCT id) as conversations,
          MAX(last_message_at) as last_activity
        FROM conversations
        WHERE project_id = ?
      `
      )
      .get(projectId) as { conversations: number; last_activity: number | null } | undefined;

    const messageRow = this.db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.project_id = ?
      `
      )
      .get(projectId) as { count: number } | undefined;

    return {
      conversations: statsRow?.conversations ?? 0,
      messages: messageRow?.count ?? 0,
      lastActivity: statsRow?.last_activity ?? null
    };
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
    if (aliasRow) {
      return aliasRow.project_id;
    }

    const conversationRow = this.db
      .prepare("SELECT project_id FROM conversations WHERE project_path = ? LIMIT 1")
      .get(canonical) as { project_id: number } | undefined;

    return conversationRow?.project_id ?? null;
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
    const expectedFolder = pathToProjectFolderName(currentProjectPath);
    const folderCandidates = this.buildFolderCandidates();

    for (const folder of folders) {
      const folderPath = join(projectsDir, folder);
      const dbPath = join(folderPath, ".cccmemory.db");

      let storedPath: string | null = null;
      let stats = { conversations: 0, messages: 0, lastActivity: null as number | null };
      let pathScore = 0;

      const candidateList = folderCandidates.get(folder);
      const bestCandidate = candidateList
        ? this.selectBestCandidate(candidateList, currentProjectPath)
        : null;

      if (bestCandidate) {
        storedPath = bestCandidate.path;
        stats = this.getProjectStats(bestCandidate.projectId);
        pathScore = this.scorePath(currentProjectPath, bestCandidate.path);
      }

      // Strategy 2: Folder name similarity
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
    let sourceFiles: string[] = [];

    // Check source exists
    if (!existsSync(sourceFolder)) {
      errors.push("Source folder does not exist");
      return { valid: false, errors };
    }

    // Check source has JSONL files
    sourceFiles = readdirSync(sourceFolder).filter(f => f.endsWith(".jsonl"));
    if (sourceFiles.length === 0) {
      errors.push("Source folder has no conversation files");
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
    if (errors.length === 0) {
      stats = {
        conversations: sourceFiles.length,
        messages: 0,
        files: sourceFiles.length
      };
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

    const filesCopied =
      mode === "merge"
        ? this.copyNewJsonlFiles(sourceFolder, targetFolder)
        : this.copyAllJsonlFiles(sourceFolder, targetFolder);

    const databaseUpdated = this.updateProjectReferences(oldProjectPath, newProjectPath);

    return {
      success: true,
      filesCopied,
      databaseUpdated,
      message:
        mode === "merge"
          ? `Merged ${filesCopied} new conversation files into target`
          : `Migrated ${filesCopied} conversation files`
    };
  }

  private copyAllJsonlFiles(sourceFolder: string, targetFolder: string): number {
    const jsonlFiles = readdirSync(sourceFolder).filter(f => f.endsWith(".jsonl"));
    let filesCopied = 0;

    for (const file of jsonlFiles) {
      const sourcePath = join(sourceFolder, file);
      const targetPath = join(targetFolder, file);
      copyFileSync(sourcePath, targetPath);
      filesCopied++;
    }

    return filesCopied;
  }

  private copyNewJsonlFiles(sourceFolder: string, targetFolder: string): number {
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

    return filesCopied;
  }

  private backupDatabase(): string {
    const dbPath = this.sqliteManager.getDbPath();
    if (dbPath === ":memory:") {
      return dbPath;
    }
    const backupName = `${basename(dbPath)}.bak.${Date.now()}`;
    const backupPath = join(dirname(dbPath), backupName);

    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

    return backupPath;
  }

  private updateProjectReferences(oldPath: string, newPath: string): boolean {
    const canonicalOld = getCanonicalProjectPath(oldPath).canonicalPath;
    const canonicalNew = getCanonicalProjectPath(newPath).canonicalPath;

    if (canonicalOld === canonicalNew) {
      return false;
    }

    const projectId = this.resolveProjectId(canonicalOld);
    if (!projectId) {
      return false;
    }

    const existingNew = this.resolveProjectId(canonicalNew);
    if (existingNew && existingNew !== projectId) {
      throw new Error(
        `Target project path already exists in database: ${canonicalNew}. ` +
          "Resolve duplicate projects before migrating."
      );
    }

    const now = Date.now();
    this.backupDatabase();

    try {
      this.db.exec("BEGIN TRANSACTION");

      this.db
        .prepare("UPDATE projects SET canonical_path = ?, display_path = ?, updated_at = ? WHERE id = ?")
        .run(canonicalNew, canonicalNew, now, projectId);

      this.db
        .prepare("UPDATE conversations SET project_path = ? WHERE project_id = ?")
        .run(canonicalNew, projectId);

      this.db
        .prepare("UPDATE working_memory SET project_path = ? WHERE project_path = ?")
        .run(canonicalNew, canonicalOld);

      this.db
        .prepare("UPDATE session_handoffs SET project_path = ? WHERE project_path = ?")
        .run(canonicalNew, canonicalOld);

      this.db
        .prepare("UPDATE session_checkpoints SET project_path = ? WHERE project_path = ?")
        .run(canonicalNew, canonicalOld);

      this.db
        .prepare(
          "INSERT OR IGNORE INTO project_aliases (alias_path, project_id, created_at) VALUES (?, ?, ?)"
        )
        .run(canonicalOld, projectId, now);

      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Score path similarity
   */
  scorePath(currentPath: string, oldPath: string): number {
    // Exact match
    if (currentPath === oldPath) {
      return 100;
    }

    // Split into components using platform-aware separator
    // Handle both Unix (/) and Windows (\) paths
    const pathSeparatorRegex = /[\\/]/;
    const currentParts = currentPath.split(pathSeparatorRegex).filter(p => p.length > 0);
    const oldParts = oldPath.split(pathSeparatorRegex).filter(p => p.length > 0);

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
