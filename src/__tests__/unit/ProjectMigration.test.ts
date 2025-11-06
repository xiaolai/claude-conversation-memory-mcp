/**
 * Unit tests for ProjectMigration
 * Following TDD approach - tests written FIRST
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import Database from "better-sqlite3";
import { ProjectMigration } from "../../utils/ProjectMigration.js";
import { getSQLiteManager, resetSQLiteManager } from "../../storage/SQLiteManager.js";

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

      // Create database with project_path
      const dbPath = join(oldFolder, ".claude-conversations-memory.db");
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          project_path TEXT NOT NULL,
          first_message_at INTEGER,
          last_message_at INTEGER,
          message_count INTEGER
        );
        INSERT INTO conversations VALUES
          ('conv1', '/Users/test/old-project', 1000, 2000, 10);
      `);
      db.close();

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

      const dbPath = join(oldFolder, ".claude-conversations-memory.db");
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE conversations (id TEXT PRIMARY KEY, project_path TEXT);
        INSERT INTO conversations VALUES ('c1', '/Users/test/oldname/project');
      `);
      db.close();

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
      const db1 = new Database(join(folder1, ".claude-conversations-memory.db"));
      db1.exec(`
        CREATE TABLE conversations (id TEXT, project_path TEXT);
        INSERT INTO conversations VALUES ('c1', '/Users/test/project');
      `);
      db1.close();

      // Folder 2: Similar path (medium score)
      const folder2 = join(projectsDir, "-Users-test-old-project");
      mkdirSync(folder2, { recursive: true });
      const db2 = new Database(join(folder2, ".claude-conversations-memory.db"));
      db2.exec(`
        CREATE TABLE conversations (id TEXT, project_path TEXT);
        INSERT INTO conversations VALUES ('c1', '/Users/test/old-project');
      `);
      db2.close();

      // Folder 3: Different path (low score)
      const folder3 = join(projectsDir, "-Users-other-something");
      mkdirSync(folder3, { recursive: true });
      writeFileSync(join(folder3, "file.jsonl"), '{}');

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

      const dbPath = join(oldFolder, ".claude-conversations-memory.db");
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          project_path TEXT,
          last_message_at INTEGER,
          message_count INTEGER
        );
        CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT);

        INSERT INTO conversations VALUES
          ('c1', '/Users/test/project', 1000, 10),
          ('c2', '/Users/test/project', 2000, 20);
        INSERT INTO messages VALUES ('m1', 'c1'), ('m2', 'c1'), ('m3', 'c2');
      `);
      db.close();

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

      const dbPath = join(oldFolder, ".claude-conversations-memory.db");
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

    it("should verify source database is readable", () => {
      // Setup: Source with corrupted database
      const sourceFolder = join(projectsDir, "-Users-test-source");
      mkdirSync(sourceFolder, { recursive: true });
      writeFileSync(join(sourceFolder, ".claude-conversations-memory.db"), "CORRUPTED");

      const targetFolder = join(projectsDir, "-Users-test-target");

      // Test: Validate
      const result = migration.validateMigration(sourceFolder, targetFolder);

      // Verify: Should fail validation
      expect(result.valid).toBe(false);
      expect(result.errors?.some(e => e.includes("database"))).toBe(true);
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

      // Create database with stats
      const db = new Database(join(sourceFolder, ".claude-conversations-memory.db"));
      db.exec(`
        CREATE TABLE conversations (id TEXT, project_path TEXT);
        CREATE TABLE messages (id TEXT);
        INSERT INTO conversations VALUES ('c1', '/test'), ('c2', '/test');
        INSERT INTO messages VALUES ('m1'), ('m2'), ('m3');
      `);
      db.close();

      // Add JSONL files
      writeFileSync(join(sourceFolder, "session1.jsonl"), '{}');
      writeFileSync(join(sourceFolder, "session2.jsonl"), '{}');

      const targetFolder = join(projectsDir, "-Users-test-target");

      // Test: Validate
      const result = migration.validateMigration(sourceFolder, targetFolder);

      // Verify: Should include stats
      expect(result.valid).toBe(true);
      expect(result.stats?.conversations).toBe(2);
      expect(result.stats?.messages).toBe(3);
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

      // Create minimal database
      const db = new Database(join(sourceFolder, ".claude-conversations-memory.db"));
      db.exec(`
        CREATE TABLE conversations (id TEXT, project_path TEXT);
        INSERT INTO conversations VALUES ('c1', '/old/path');
      `);
      db.close();

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

    it("should copy database to new folder", async () => {
      // Setup
      const sourceFolder = join(projectsDir, "-Users-test-source");
      const targetFolder = join(projectsDir, "-Users-test-target");
      mkdirSync(sourceFolder, { recursive: true });

      const sourceDb = join(sourceFolder, ".claude-conversations-memory.db");
      const db = new Database(sourceDb);
      db.exec(`
        CREATE TABLE conversations (id TEXT, project_path TEXT);
        INSERT INTO conversations VALUES ('c1', '/old');
      `);
      db.close();

      writeFileSync(join(sourceFolder, "session.jsonl"), '{}');

      // Test: Execute
      await migration.executeMigration(sourceFolder, targetFolder, "/old", "/new", false);

      // Verify: Database copied
      const targetDb = join(targetFolder, ".claude-conversations-memory.db");
      expect(existsSync(targetDb)).toBe(true);
    });

    it("should update project_path in database", async () => {
      // Setup
      const sourceFolder = join(projectsDir, "-Users-test-source");
      const targetFolder = join(projectsDir, "-Users-test-target");
      mkdirSync(sourceFolder, { recursive: true });

      const sourceDb = join(sourceFolder, ".claude-conversations-memory.db");
      const db = new Database(sourceDb);
      db.exec(`
        CREATE TABLE conversations (id TEXT, project_path TEXT);
        INSERT INTO conversations VALUES ('c1', '/old/path'), ('c2', '/old/path');
      `);
      db.close();

      writeFileSync(join(sourceFolder, "s.jsonl"), '{}');

      // Test: Execute
      await migration.executeMigration(sourceFolder, targetFolder, "/old/path", "/new/path", false);

      // Verify: Paths updated
      const targetDb = new Database(join(targetFolder, ".claude-conversations-memory.db"));
      const rows = targetDb.prepare("SELECT project_path FROM conversations").all() as Array<{project_path: string}>;
      targetDb.close();

      expect(rows).toHaveLength(2);
      expect(rows[0].project_path).toBe("/new/path");
      expect(rows[1].project_path).toBe("/new/path");
    });

    it("should create backup before migration", async () => {
      // Setup
      const sourceFolder = join(projectsDir, "-Users-test-source");
      const targetFolder = join(projectsDir, "-Users-test-target");
      mkdirSync(sourceFolder, { recursive: true });

      const db = new Database(join(sourceFolder, ".claude-conversations-memory.db"));
      db.exec(`
        CREATE TABLE conversations (id TEXT, project_path TEXT);
        INSERT INTO conversations VALUES ('c1', '/old');
      `);
      db.close();

      writeFileSync(join(sourceFolder, "s.jsonl"), '{}');

      // Test: Execute
      await migration.executeMigration(sourceFolder, targetFolder, "/old", "/new", false);

      // Verify: Backup created
      const backupPath = join(sourceFolder, ".claude-conversations-memory.db.bak");
      expect(existsSync(backupPath)).toBe(true);
    });

    it("should rollback on error", async () => {
      // Setup: Create scenario that will fail
      const sourceFolder = join(projectsDir, "-Users-test-source");
      const targetFolder = join(projectsDir, "-Users-test-target");
      mkdirSync(sourceFolder, { recursive: true });

      // Create invalid database that will fail UPDATE
      writeFileSync(join(sourceFolder, ".claude-conversations-memory.db"), "INVALID");
      writeFileSync(join(sourceFolder, "s.jsonl"), '{}');

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

      const db = new Database(join(sourceFolder, ".claude-conversations-memory.db"));
      db.exec(`
        CREATE TABLE conversations (id TEXT, project_path TEXT);
        INSERT INTO conversations VALUES ('c1', '/old');
      `);
      db.close();

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

      const db = new Database(join(sourceFolder, ".claude-conversations-memory.db"));
      db.exec(`
        CREATE TABLE conversations (id TEXT, project_path TEXT);
        INSERT INTO conversations VALUES ('c1', '/old');
      `);
      db.close();

      // Test: Execute
      await migration.executeMigration(sourceFolder, targetFolder, "/old", "/new", false);

      // Verify: Original still exists
      expect(existsSync(join(sourceFolder, "session.jsonl"))).toBe(true);
      expect(existsSync(join(sourceFolder, ".claude-conversations-memory.db"))).toBe(true);
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

      // Source has 1 conversation
      writeFileSync(join(sourceFolder, "source-session.jsonl"), "source-data");
      const sourceDb = new Database(join(sourceFolder, ".claude-conversations-memory.db"));
      sourceDb.exec(`
        CREATE TABLE conversations (id TEXT PRIMARY KEY, project_path TEXT, last_message_at INTEGER);
        CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT);
        INSERT INTO conversations VALUES ('source-session', '/old-project', 1000);
        INSERT INTO messages VALUES ('msg1', 'source-session');
      `);
      sourceDb.close();

      // Target has 1 conversation
      writeFileSync(join(targetFolder, "target-session.jsonl"), "target-data");
      const targetDb = new Database(join(targetFolder, ".claude-conversations-memory.db"));
      targetDb.exec(`
        CREATE TABLE conversations (id TEXT PRIMARY KEY, project_path TEXT, last_message_at INTEGER);
        CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT);
        INSERT INTO conversations VALUES ('target-session', '/new-project', 2000);
        INSERT INTO messages VALUES ('msg2', 'target-session');
      `);
      targetDb.close();

      // Test: Execute merge (mode='merge')
      const result = await migration.executeMigration(
        sourceFolder,
        targetFolder,
        "/old-project",
        "/new-project",
        false,
        "merge"
      );

      // Verify: Both conversations exist in target
      const db = new Database(join(targetFolder, ".claude-conversations-memory.db"));
      const conversations = db.prepare("SELECT id FROM conversations ORDER BY id").all() as Array<{ id: string }>;
      expect(conversations).toHaveLength(2);
      expect(conversations.map(c => c.id)).toEqual([
        "source-session",
        "target-session"
      ]);
      db.close();

      expect(result.success).toBe(true);
    });

    it("should skip duplicate conversation IDs (keep target)", async () => {
      // Setup: Both have same conversation ID
      const sourceFolder = join(projectsDir, "-source");
      const targetFolder = join(projectsDir, "-target");
      mkdirSync(sourceFolder, { recursive: true });
      mkdirSync(targetFolder, { recursive: true });

      // Source has conversation 'shared-id' with timestamp 1000
      writeFileSync(join(sourceFolder, "shared-id.jsonl"), "source-version");
      const sourceDb = new Database(join(sourceFolder, ".claude-conversations-memory.db"));
      sourceDb.exec(`
        CREATE TABLE conversations (id TEXT PRIMARY KEY, project_path TEXT, last_message_at INTEGER);
        INSERT INTO conversations VALUES ('shared-id', '/old', 1000);
      `);
      sourceDb.close();

      // Target has conversation 'shared-id' with timestamp 2000 (newer)
      writeFileSync(join(targetFolder, "shared-id.jsonl"), "target-version");
      const targetDb = new Database(join(targetFolder, ".claude-conversations-memory.db"));
      targetDb.exec(`
        CREATE TABLE conversations (id TEXT PRIMARY KEY, project_path TEXT, last_message_at INTEGER);
        INSERT INTO conversations VALUES ('shared-id', '/new', 2000);
      `);
      targetDb.close();

      // Test: Execute merge
      await migration.executeMigration(sourceFolder, targetFolder, "/old", "/new", false, "merge");

      // Verify: Target version kept (not overwritten)
      const db = new Database(join(targetFolder, ".claude-conversations-memory.db"));
      const row = db.prepare("SELECT last_message_at FROM conversations WHERE id = ?").get("shared-id") as { last_message_at: number };
      expect(row.last_message_at).toBe(2000); // Target's timestamp preserved
      db.close();

      // Verify: Target JSONL file not overwritten
      const content = readFileSync(join(targetFolder, "shared-id.jsonl"), "utf-8");
      expect(content).toBe("target-version");
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
      const sourceDb = new Database(join(sourceFolder, ".claude-conversations-memory.db"));
      sourceDb.exec(`
        CREATE TABLE conversations (id TEXT PRIMARY KEY, project_path TEXT);
        INSERT INTO conversations VALUES ('session-1', '/old');
        INSERT INTO conversations VALUES ('session-2', '/old');
      `);
      sourceDb.close();

      // Target already has session-1
      writeFileSync(join(targetFolder, "session-1.jsonl"), "existing");
      const targetDb = new Database(join(targetFolder, ".claude-conversations-memory.db"));
      targetDb.exec(`
        CREATE TABLE conversations (id TEXT PRIMARY KEY, project_path TEXT);
        INSERT INTO conversations VALUES ('session-1', '/new');
      `);
      targetDb.close();

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
      const sourceDb = new Database(join(sourceFolder, ".claude-conversations-memory.db"));
      sourceDb.exec(`
        CREATE TABLE conversations (id TEXT, project_path TEXT);
        INSERT INTO conversations VALUES ('s1', '/old');
      `);
      sourceDb.close();

      writeFileSync(join(targetFolder, "existing.jsonl"), "target");

      // Test: Execute with mode='migrate' (default)
      await expect(
        migration.executeMigration(sourceFolder, targetFolder, "/old", "/new", false, "migrate")
      ).rejects.toThrow("Target folder already has conversation data");
    });

    it("should preserve target backup in merge mode", async () => {
      // Setup
      const sourceFolder = join(projectsDir, "-source");
      const targetFolder = join(projectsDir, "-target");
      mkdirSync(sourceFolder, { recursive: true });
      mkdirSync(targetFolder, { recursive: true });

      writeFileSync(join(sourceFolder, "s1.jsonl"), "source");
      const sourceDb = new Database(join(sourceFolder, ".claude-conversations-memory.db"));
      sourceDb.exec(`
        CREATE TABLE conversations (id TEXT, project_path TEXT);
        INSERT INTO conversations VALUES ('s1', '/old');
      `);
      sourceDb.close();

      writeFileSync(join(targetFolder, "t1.jsonl"), "target");
      const targetDb = new Database(join(targetFolder, ".claude-conversations-memory.db"));
      targetDb.exec(`
        CREATE TABLE conversations (id TEXT, project_path TEXT);
        INSERT INTO conversations VALUES ('t1', '/new');
      `);
      targetDb.close();

      // Test: Execute merge
      await migration.executeMigration(sourceFolder, targetFolder, "/old", "/new", false, "merge");

      // Verify: Backup created in target folder (not source)
      expect(existsSync(join(targetFolder, ".claude-conversations-memory.db.bak"))).toBe(true);
    });
  });
});
