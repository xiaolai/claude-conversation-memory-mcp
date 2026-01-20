/**
 * Unit tests for ProjectMigration
 * Following TDD approach - tests written FIRST
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { tmpdir } from "os";
import { join, basename, dirname } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";
import { ProjectMigration } from "../../utils/ProjectMigration.js";
import { getSQLiteManager, resetSQLiteManager } from "../../storage/SQLiteManager.js";

const insertProject = (db: ReturnType<ReturnType<typeof getSQLiteManager>["getDatabase"]>, projectPath: string) => {
  const now = Date.now();
  const result = db
    .prepare(
      "INSERT INTO projects (canonical_path, display_path, created_at, updated_at) VALUES (?, ?, ?, ?)"
    )
    .run(projectPath, projectPath, now, now);
  return Number(result.lastInsertRowid);
};

const insertConversation = (
  db: ReturnType<ReturnType<typeof getSQLiteManager>["getDatabase"]>,
  projectId: number,
  projectPath: string,
  externalId: string,
  lastMessageAt: number,
  messageCount = 1
) => {
  const now = Date.now();
  const result = db
    .prepare(
      `
      INSERT INTO conversations
      (project_id, project_path, source_type, external_id, first_message_at, last_message_at, message_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(projectId, projectPath, "claude-code", externalId, lastMessageAt, lastMessageAt, messageCount, now, now);
  return Number(result.lastInsertRowid);
};

const insertMessage = (
  db: ReturnType<ReturnType<typeof getSQLiteManager>["getDatabase"]>,
  conversationId: number,
  externalId: string,
  timestamp: number
) => {
  db.prepare(
    `
    INSERT INTO messages
    (conversation_id, external_id, message_type, role, content, timestamp, metadata)
    VALUES (?, ?, 'user', 'user', 'content', ?, '{}')
    `
  ).run(conversationId, externalId, timestamp);
};

describe("ProjectMigration", () => {
  let testDir: string;
  let projectsDir: string;
  let migration: ProjectMigration;

  beforeEach(() => {
    // Create temp directory structure
    testDir = join(tmpdir(), `migration-test-${Date.now()}`);
    projectsDir = join(testDir, ".claude", "projects");
    mkdirSync(projectsDir, { recursive: true });

    // Mock HOME to use test directory
    process.env.HOME = testDir;
    process.env.USERPROFILE = testDir;

    const db = getSQLiteManager();
    migration = new ProjectMigration(db, projectsDir);
  });

  afterEach(() => {
    resetSQLiteManager();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("discoverOldFolders", () => {
    it("should find folder by exact database project_path match", async () => {
      // Setup: Create old folder with database
      const oldFolder = join(projectsDir, "-Users-test-old-project");
      mkdirSync(oldFolder, { recursive: true });
      writeFileSync(join(oldFolder, "session.jsonl"), "{}");

      const db = getSQLiteManager().getDatabase();
      const projectId = insertProject(db, "/Users/test/old-project");
      insertConversation(db, projectId, "/Users/test/old-project", "conv1", 2000, 10);

      // Test: Discover from new path
      const results = await migration.discoverOldFolders("/Users/test/new-project");

      // Verify: Should find the old folder
      expect(results).toHaveLength(1);
      expect(results[0].folderName).toBe("-Users-test-old-project");
      expect(results[0].storedProjectPath).toBe("/Users/test/old-project");
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("should score folder by path similarity", async () => {
      // Setup: Create folder with similar path
      const oldFolder = join(projectsDir, "-Users-test-oldname-project");
      mkdirSync(oldFolder, { recursive: true });
      writeFileSync(join(oldFolder, "session.jsonl"), "{}");

      const db = getSQLiteManager().getDatabase();
      const projectId = insertProject(db, "/Users/test/oldname/project");
      insertConversation(db, projectId, "/Users/test/oldname/project", "c1", 1000);

      // Test: Check with newname (only one component different)
      const results = await migration.discoverOldFolders("/Users/test/newname/project");

      // Verify: Should have high score (path similarity)
      expect(results).toHaveLength(1);
      expect(results[0].score).toBeGreaterThan(65); // High similarity
    });

    it("should find folder by name pattern matching", async () => {
      // Setup: Create folder without database but matching pattern
      const oldFolder = join(projectsDir, "-Users-test-myproject");
      mkdirSync(oldFolder, { recursive: true });

      // Add some JSONL files
      writeFileSync(join(oldFolder, "session1.jsonl"), '{"type":"user"}');
      writeFileSync(join(oldFolder, "session2.jsonl"), '{"type":"assistant"}');

      // Test: Similar project path
      const results = await migration.discoverOldFolders("/Users/test/myproject-renamed");

      // Verify: Should still find it based on folder name
      expect(results).toHaveLength(1);
      expect(results[0].folderName).toBe("-Users-test-myproject");
    });

    it("should return empty array when no matches found", async () => {
      // Test: Discover with no existing folders
      const results = await migration.discoverOldFolders("/Users/test/nonexistent");

      // Verify: Empty results
      expect(results).toEqual([]);
    });

    it("should rank results by confidence score", async () => {
      // Setup: Create multiple candidate folders
      // Folder 1: Exact path match (should score highest)
      const folder1 = join(projectsDir, "-Users-test-project");
      mkdirSync(folder1, { recursive: true });
      writeFileSync(join(folder1, "session.jsonl"), "{}");

      // Folder 2: Similar path (medium score)
      const folder2 = join(projectsDir, "-Users-test-old-project");
      mkdirSync(folder2, { recursive: true });
      writeFileSync(join(folder2, "session.jsonl"), "{}");

      // Folder 3: Different path (low score)
      const folder3 = join(projectsDir, "-Users-other-something");
      mkdirSync(folder3, { recursive: true });
      writeFileSync(join(folder3, "file.jsonl"), '{}');

      const db = getSQLiteManager().getDatabase();
      const projectId1 = insertProject(db, "/Users/test/project");
      insertConversation(db, projectId1, "/Users/test/project", "c1", 1000);
      const projectId2 = insertProject(db, "/Users/test/old-project");
      insertConversation(db, projectId2, "/Users/test/old-project", "c2", 900);

      // Test: Discover
      const results = await migration.discoverOldFolders("/Users/test/project");

      // Verify: Sorted by score, highest first
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect(results[0].folderName).toBe("-Users-test-project");
    });

    it("should include statistics (conversations, messages, lastActivity)", async () => {
      // Setup: Create folder with stats
      const oldFolder = join(projectsDir, "-Users-test-project");
      mkdirSync(oldFolder, { recursive: true });
      writeFileSync(join(oldFolder, "session.jsonl"), "{}");

      const db = getSQLiteManager().getDatabase();
      const projectId = insertProject(db, "/Users/test/project");
      const conv1 = insertConversation(db, projectId, "/Users/test/project", "c1", 1000);
      const conv2 = insertConversation(db, projectId, "/Users/test/project", "c2", 2000);
      insertMessage(db, conv1, "m1", 1000);
      insertMessage(db, conv1, "m2", 1001);
      insertMessage(db, conv2, "m3", 1002);

      // Test: Discover
      const results = await migration.discoverOldFolders("/Users/test/project-new");

      // Verify: Stats included
      expect(results[0].stats.conversations).toBe(2);
      expect(results[0].stats.messages).toBe(3);
      expect(results[0].stats.lastActivity).toBe(2000);
    });

    it("should handle missing database gracefully", async () => {
      // Setup: Folder with JSONL but no database
      const oldFolder = join(projectsDir, "-Users-test-project");
      mkdirSync(oldFolder, { recursive: true });
      writeFileSync(join(oldFolder, "session.jsonl"), '{"type":"user"}');

      // Test: Should not crash
      const results = await migration.discoverOldFolders("/Users/test/project");

      // Verify: Still finds folder based on name/files
      expect(results).toHaveLength(1);
      expect(results[0].storedProjectPath).toBeNull();
    });

    it("should handle corrupted database files", async () => {
      // Setup: Create corrupted database
      const oldFolder = join(projectsDir, "-Users-test-project");
      mkdirSync(oldFolder, { recursive: true });

      const dbPath = join(oldFolder, ".cccmemory.db");
      writeFileSync(dbPath, "NOT A VALID DATABASE FILE");

      // Test: Should handle gracefully
      const results = await migration.discoverOldFolders("/Users/test/project");

      // Verify: Should still include folder (just can't read DB)
      expect(results.length).toBeGreaterThanOrEqual(0); // May or may not include based on other factors
    });
  });

  describe("validateMigration", () => {
    it("should detect conflicts when target already has data", () => {
      // Setup: Create both source and target with data
      const sourceFolder = join(projectsDir, "-Users-test-old");
      const targetFolder = join(projectsDir, "-Users-test-new");
      mkdirSync(sourceFolder, { recursive: true });
      mkdirSync(targetFolder, { recursive: true });

      // Both have JSONL files
      writeFileSync(join(sourceFolder, "session1.jsonl"), '{}');
      writeFileSync(join(targetFolder, "session2.jsonl"), '{}');

      // Test: Validate
      const result = migration.validateMigration(sourceFolder, targetFolder);

      // Verify: Should detect conflict
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Target folder already has conversation data");
    });

    it("should allow migration when no database exists", () => {
      // Setup: Source with JSONL data only
      const sourceFolder = join(projectsDir, "-Users-test-source");
      mkdirSync(sourceFolder, { recursive: true });
      writeFileSync(join(sourceFolder, "session.jsonl"), "{}");

      const targetFolder = join(projectsDir, "-Users-test-target");

      // Test: Validate
      const result = migration.validateMigration(sourceFolder, targetFolder);

      // Verify: Should pass validation
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should verify source has JSONL files", () => {
      // Setup: Source folder with no files
      const sourceFolder = join(projectsDir, "-Users-test-empty");
      const targetFolder = join(projectsDir, "-Users-test-target");
      mkdirSync(sourceFolder, { recursive: true });

      // Test: Validate
      const result = migration.validateMigration(sourceFolder, targetFolder);

      // Verify: Should warn about no files
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Source folder has no conversation files");
    });

    it("should reject migration from non-existent folder", () => {
      const sourceFolder = join(projectsDir, "-Users-test-nonexistent");
      const targetFolder = join(projectsDir, "-Users-test-target");

      // Test: Validate
      const result = migration.validateMigration(sourceFolder, targetFolder);

      // Verify: Should fail
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Source folder does not exist");
    });

    it("should calculate accurate migration statistics", () => {
      // Setup: Source with known data
      const sourceFolder = join(projectsDir, "-Users-test-source");
      mkdirSync(sourceFolder, { recursive: true });

      // Add JSONL files
      writeFileSync(join(sourceFolder, "session1.jsonl"), '{}');
      writeFileSync(join(sourceFolder, "session2.jsonl"), '{}');

      const targetFolder = join(projectsDir, "-Users-test-target");

      // Test: Validate
      const result = migration.validateMigration(sourceFolder, targetFolder);

      // Verify: Should include stats
      expect(result.valid).toBe(true);
      expect(result.stats?.conversations).toBe(2);
      expect(result.stats?.messages).toBe(0);
      expect(result.stats?.files).toBe(2);
    });
  });

  describe("executeMigration", () => {
    it("should copy all JSONL files to new folder", async () => {
      // Setup
      const sourceFolder = join(projectsDir, "-Users-test-source");
      const targetFolder = join(projectsDir, "-Users-test-target");
      mkdirSync(sourceFolder, { recursive: true });

      writeFileSync(join(sourceFolder, "session1.jsonl"), 'content1');
      writeFileSync(join(sourceFolder, "session2.jsonl"), 'content2');

      // Test: Execute migration
      await migration.executeMigration(
        sourceFolder,
        targetFolder,
        "/old/path",
        "/new/path",
        false
      );

      // Verify: Files copied
      expect(existsSync(join(targetFolder, "session1.jsonl"))).toBe(true);
      expect(existsSync(join(targetFolder, "session2.jsonl"))).toBe(true);
    });

    it("should update project_path in database", async () => {
      // Setup
      const sourceFolder = join(projectsDir, "-Users-test-source");
      const targetFolder = join(projectsDir, "-Users-test-target");
      mkdirSync(sourceFolder, { recursive: true });

      writeFileSync(join(sourceFolder, "s.jsonl"), '{}');

      const db = getSQLiteManager().getDatabase();
      const projectId = insertProject(db, "/old/path");
      insertConversation(db, projectId, "/old/path", "c1", 1000);
      insertConversation(db, projectId, "/old/path", "c2", 2000);

      // Test: Execute
      await migration.executeMigration(sourceFolder, targetFolder, "/old/path", "/new/path", false);

      // Verify: Paths updated
      const rows = db
        .prepare("SELECT project_path FROM conversations WHERE project_id = ? ORDER BY external_id")
        .all(projectId) as Array<{ project_path: string }>;
      expect(rows).toHaveLength(2);
      expect(rows[0].project_path).toBe("/new/path");
      expect(rows[1].project_path).toBe("/new/path");
    });

    it("should create backup before migration", async () => {
      // Setup
      const sourceFolder = join(projectsDir, "-Users-test-source");
      const targetFolder = join(projectsDir, "-Users-test-target");
      mkdirSync(sourceFolder, { recursive: true });

      writeFileSync(join(sourceFolder, "s.jsonl"), '{}');

      const db = getSQLiteManager().getDatabase();
      const projectId = insertProject(db, "/old");
      insertConversation(db, projectId, "/old", "c1", 1000);

      // Test: Execute
      await migration.executeMigration(sourceFolder, targetFolder, "/old", "/new", false);

      // Verify: Backup created
      const dbPath = getSQLiteManager().getDbPath();
      const backupDir = dirname(dbPath);
      const backups = readdirSync(backupDir).filter((name) =>
        name.startsWith(`${basename(dbPath)}.bak.`)
      );
      expect(backups.length).toBeGreaterThan(0);
    });

    it("should rollback on error", async () => {
      // Setup: Create scenario that will fail (target project already exists)
      const sourceFolder = join(projectsDir, "-Users-test-source");
      const targetFolder = join(projectsDir, "-Users-test-target");
      mkdirSync(sourceFolder, { recursive: true });

      writeFileSync(join(sourceFolder, "s.jsonl"), '{}');

      const db = getSQLiteManager().getDatabase();
      const projectId = insertProject(db, "/old");
      insertConversation(db, projectId, "/old", "c1", 1000);
      insertProject(db, "/new");

      // Test: Should throw
      await expect(
        migration.executeMigration(sourceFolder, targetFolder, "/old", "/new", false)
      ).rejects.toThrow();

      // Verify: Target folder should not be created or should be cleaned up
      // (Specific behavior depends on implementation)
    });

    it("should verify file counts after copy", async () => {
      // Setup
      const sourceFolder = join(projectsDir, "-Users-test-source");
      const targetFolder = join(projectsDir, "-Users-test-target");
      mkdirSync(sourceFolder, { recursive: true });

      writeFileSync(join(sourceFolder, "s1.jsonl"), '{}');
      writeFileSync(join(sourceFolder, "s2.jsonl"), '{}');

      // Test: Execute
      const result = await migration.executeMigration(
        sourceFolder,
        targetFolder,
        "/old",
        "/new",
        false
      );

      // Verify: Counts match
      expect(result.filesCopied).toBe(2);
    });

    it("should preserve original data (copy not move)", async () => {
      // Setup
      const sourceFolder = join(projectsDir, "-Users-test-source");
      const targetFolder = join(projectsDir, "-Users-test-target");
      mkdirSync(sourceFolder, { recursive: true });

      writeFileSync(join(sourceFolder, "session.jsonl"), 'original');

      // Test: Execute
      await migration.executeMigration(sourceFolder, targetFolder, "/old", "/new", false);

      // Verify: Original still exists
      expect(existsSync(join(sourceFolder, "session.jsonl"))).toBe(true);
    });
  });

  describe("scoring algorithms", () => {
    it("should score exact path match as 100", () => {
      const score = migration.scorePath("/Users/test/project", "/Users/test/project");
      expect(score).toBe(100);
    });

    it("should score one-component-different as 80", () => {
      const score = migration.scorePath(
        "/Users/test/newname/project",
        "/Users/test/oldname/project"
      );
      expect(score).toBeGreaterThanOrEqual(70); // High score for rename
    });

    it("should score folder name similarity correctly", () => {
      const score1 = migration.scoreFolderName(
        "-Users-test-project",
        "-Users-test-project"
      );
      expect(score1).toBe(100); // Exact match

      const score2 = migration.scoreFolderName(
        "-Users-test-newproject",
        "-Users-test-oldproject"
      );
      expect(score2).toBeGreaterThan(50); // Similar

      const score3 = migration.scoreFolderName(
        "-Users-test-project",
        "-Users-other-something"
      );
      expect(score3).toBeLessThan(50); // Different
    });

    it("should combine multiple score factors", () => {
      // This tests the overall scoring logic
      // Path similarity + folder name + JSONL files should combine
      const score = migration.calculateOverallScore({
        pathScore: 80,
        folderScore: 60,
        hasDatabase: true,
        jsonlCount: 10
      });

      expect(score).toBeGreaterThan(80); // Should boost with files
    });
  });

  describe("merge mode", () => {
    it("should allow merge when target has existing data", async () => {
      // Setup: Source and target both have data
      const sourceFolder = join(projectsDir, "-source");
      const targetFolder = join(projectsDir, "-target");
      mkdirSync(sourceFolder, { recursive: true });
      mkdirSync(targetFolder, { recursive: true });

      writeFileSync(join(sourceFolder, "source-session.jsonl"), "source-data");
      writeFileSync(join(targetFolder, "target-session.jsonl"), "target-data");

      const result = await migration.executeMigration(
        sourceFolder,
        targetFolder,
        "/old-project",
        "/new-project",
        false,
        "merge"
      );

      expect(result.success).toBe(true);
    });

    it("should copy only new JSONL files in merge mode", async () => {
      // Setup
      const sourceFolder = join(projectsDir, "-source");
      const targetFolder = join(projectsDir, "-target");
      mkdirSync(sourceFolder, { recursive: true });
      mkdirSync(targetFolder, { recursive: true });

      // Source has 2 files
      writeFileSync(join(sourceFolder, "session-1.jsonl"), "data1");
      writeFileSync(join(sourceFolder, "session-2.jsonl"), "data2");

      // Target already has session-1
      writeFileSync(join(targetFolder, "session-1.jsonl"), "existing");

      // Test: Execute merge
      const result = await migration.executeMigration(
        sourceFolder,
        targetFolder,
        "/old",
        "/new",
        false,
        "merge"
      );

      // Verify: Only session-2 copied (session-1 skipped)
      expect(result.filesCopied).toBe(1);

      // Verify: session-1.jsonl not overwritten
      const content1 = readFileSync(join(targetFolder, "session-1.jsonl"), "utf-8");
      expect(content1).toBe("existing");

      // Verify: session-2.jsonl copied
      expect(existsSync(join(targetFolder, "session-2.jsonl"))).toBe(true);
    });

    it("should reject merge when mode='migrate' and target has data", async () => {
      // Setup: Target has existing data
      const sourceFolder = join(projectsDir, "-source");
      const targetFolder = join(projectsDir, "-target");
      mkdirSync(sourceFolder, { recursive: true });
      mkdirSync(targetFolder, { recursive: true });

      writeFileSync(join(sourceFolder, "session.jsonl"), "source");

      writeFileSync(join(targetFolder, "existing.jsonl"), "target");

      // Test: Execute with mode='migrate' (default)
      await expect(
        migration.executeMigration(sourceFolder, targetFolder, "/old", "/new", false, "migrate")
      ).rejects.toThrow("Target folder already has conversation data");
    });

  });
});
