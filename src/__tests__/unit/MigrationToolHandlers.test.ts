/**
 * Unit tests for Migration Tool Handlers
 * Following TDD approach - tests written FIRST
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { tmpdir } from "os";
import { join, basename, dirname } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "fs";
import { ToolHandlers } from "../../tools/ToolHandlers.js";
import { ConversationMemory } from "../../ConversationMemory.js";
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

describe("Migration Tool Handlers", () => {
  let testDir: string;
  let projectsDir: string;
  let handlers: ToolHandlers;
  let memory: ConversationMemory;

  beforeEach(() => {
    // Create temp directory structure
    testDir = join(tmpdir(), `migration-tool-test-${Date.now()}`);
    projectsDir = join(testDir, ".claude", "projects");
    mkdirSync(projectsDir, { recursive: true });

    // Mock HOME to use test directory
    process.env.HOME = testDir;
    process.env.USERPROFILE = testDir;

    const db = getSQLiteManager();
    memory = new ConversationMemory();
    handlers = new ToolHandlers(memory, db, projectsDir);
  });

  afterEach(() => {
    resetSQLiteManager();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("discover_old_conversations", () => {
    it("should discover old conversation folders", async () => {
      // Setup: Create old folder with database
      const oldFolder = join(projectsDir, "-Users-test-old-project");
      mkdirSync(oldFolder, { recursive: true });
      const db = getSQLiteManager().getDatabase();
      const projectId = insertProject(db, "/Users/test/old-project");
      const conv1 = insertConversation(db, projectId, "/Users/test/old-project", "c1", 2000);
      const conv2 = insertConversation(db, projectId, "/Users/test/old-project", "c2", 4000);
      insertMessage(db, conv1, "m1", 1000);
      insertMessage(db, conv1, "m2", 1001);
      insertMessage(db, conv2, "m3", 1002);

      writeFileSync(join(oldFolder, "session1.jsonl"), '{}');
      writeFileSync(join(oldFolder, "session2.jsonl"), '{}');

      // Test: Discover
      const result = await handlers.discoverOldConversations({
        current_project_path: "/Users/test/new-project",
      });

      // Verify: Found the old folder
      expect(result.success).toBe(true);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].folder_name).toBe("-Users-test-old-project");
      expect(result.candidates[0].stored_project_path).toBe("/Users/test/old-project");
      expect(result.candidates[0].stats.conversations).toBe(2);
      expect(result.candidates[0].stats.files).toBe(2);
      expect(result.message).toContain("Found 1 potential old conversation folder");
    });

    it("should return empty list when no candidates found", async () => {
      // Test: No old folders exist
      const result = await handlers.discoverOldConversations({
        current_project_path: "/Users/test/project",
      });

      // Verify: Empty results
      expect(result.success).toBe(true);
      expect(result.candidates).toHaveLength(0);
      expect(result.message).toContain("No old conversation folders found");
    });

    it("should rank candidates by score", async () => {
      // Setup: Create multiple folders with different similarity
      const folder1 = join(projectsDir, "-Users-test-exact-project");
      const folder2 = join(projectsDir, "-Users-test-similar-project");
      const folder3 = join(projectsDir, "-Users-different-other");

      [folder1, folder2, folder3].forEach((folder) => {
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "session.jsonl"), '{}');
      });

      const db = getSQLiteManager().getDatabase();
      const projectId1 = insertProject(db, "/Users/test/exact-project");
      insertConversation(db, projectId1, "/Users/test/exact-project", "c1", 1000);
      const projectId2 = insertProject(db, "/Users/test/similar-project");
      insertConversation(db, projectId2, "/Users/test/similar-project", "c2", 1000);

      // Test: Discover with path similar to folder1
      const result = await handlers.discoverOldConversations({
        current_project_path: "/Users/test/exact-project-renamed",
      });

      // Verify: Ranked by score (exact match should be first)
      expect(result.success).toBe(true);
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates[0].score).toBeGreaterThan(result.candidates[1]?.score || 0);
    });

    it("should include statistics for each candidate", async () => {
      // Setup: Create folder with multiple conversations
      const oldFolder = join(projectsDir, "-Users-test-project");
      mkdirSync(oldFolder, { recursive: true });
      const db = getSQLiteManager().getDatabase();
      const projectId = insertProject(db, "/Users/test/project");
      const conv1 = insertConversation(db, projectId, "/Users/test/project", "c1", 5000);
      const conv2 = insertConversation(db, projectId, "/Users/test/project", "c2", 6000);
      insertMessage(db, conv1, "m1", 1000);
      insertMessage(db, conv1, "m2", 1001);
      insertMessage(db, conv2, "m3", 1002);

      writeFileSync(join(oldFolder, "s1.jsonl"), '{}');
      writeFileSync(join(oldFolder, "s2.jsonl"), '{}');
      writeFileSync(join(oldFolder, "s3.jsonl"), '{}');

      // Test: Discover
      const result = await handlers.discoverOldConversations({
        current_project_path: "/Users/test/project-new",
      });

      // Verify: Statistics included
      expect(result.candidates[0].stats.conversations).toBe(2);
      expect(result.candidates[0].stats.messages).toBe(3);
      expect(result.candidates[0].stats.files).toBe(3);
      expect(result.candidates[0].stats.last_activity).toBe(6000);
    });
  });

  describe("migrate_project", () => {
    it("should migrate conversation history successfully", async () => {
      // Setup: Create source folder
      const sourceFolder = join(projectsDir, "-Users-test-old");
      mkdirSync(sourceFolder, { recursive: true });

      writeFileSync(join(sourceFolder, "session1.jsonl"), 'content1');
      writeFileSync(join(sourceFolder, "session2.jsonl"), 'content2');
      const db = getSQLiteManager().getDatabase();
      const projectId = insertProject(db, "/Users/test/old");
      insertConversation(db, projectId, "/Users/test/old", "c1", 1000);
      insertConversation(db, projectId, "/Users/test/old", "c2", 2000);

      // Test: Execute migration
      const result = await handlers.migrateProject({
        source_folder: sourceFolder,
        old_project_path: "/Users/test/old",
        new_project_path: "/Users/test/new",
        dry_run: false,
      });

      // Verify: Migration successful
      expect(result.success).toBe(true);
      expect(result.files_copied).toBe(2);
      expect(result.database_updated).toBe(true);
      expect(result.message).toContain("Successfully migrated");
      expect(result.backup_created).toBe(true);

      // Verify: Target folder created
      const targetFolder = join(projectsDir, "-Users-test-new");
      expect(existsSync(targetFolder)).toBe(true);
      expect(existsSync(join(targetFolder, "session1.jsonl"))).toBe(true);
      expect(existsSync(join(targetFolder, "session2.jsonl"))).toBe(true);

      // Verify: Database updated
      const rows = db
        .prepare("SELECT project_path FROM conversations WHERE project_id = ? ORDER BY external_id")
        .all(projectId) as Array<{ project_path: string }>;
      expect(rows).toHaveLength(2);
      rows.forEach(row => {
        expect(row.project_path).toBe("/Users/test/new");
      });
    });

    it("should perform dry run without making changes", async () => {
      // Setup: Create source folder
      const sourceFolder = join(projectsDir, "-Users-test-source");
      mkdirSync(sourceFolder, { recursive: true });

      writeFileSync(join(sourceFolder, "session.jsonl"), 'content');

      // Test: Dry run
      const result = await handlers.migrateProject({
        source_folder: sourceFolder,
        old_project_path: "/old",
        new_project_path: "/new",
        dry_run: true,
      });

      // Verify: Reports what would be done but doesn't do it
      expect(result.success).toBe(true);
      expect(result.files_copied).toBe(1);
      expect(result.database_updated).toBe(false);
      expect(result.message).toContain("Dry run");

      // Verify: Target folder NOT created
      const targetFolder = join(projectsDir, "-Users-test-target");
      expect(existsSync(targetFolder)).toBe(false);
    });

    it("should detect and report conflicts", async () => {
      // Setup: Create source with data
      const sourceFolder = join(projectsDir, "-Users-test-source");
      mkdirSync(sourceFolder, { recursive: true });

      writeFileSync(join(sourceFolder, "source.jsonl"), 'source');

      // Create target folder with existing data (using same naming as handler)
      const targetFolder = join(projectsDir, "-new");
      mkdirSync(targetFolder, { recursive: true });
      writeFileSync(join(targetFolder, "existing.jsonl"), 'existing');

      // Test: Should detect conflict
      await expect(
        handlers.migrateProject({
          source_folder: sourceFolder,
          old_project_path: "/old",
          new_project_path: "/new",
          dry_run: false,
        })
      ).rejects.toThrow(/already has/i);
    });

    it("should validate source folder exists", async () => {
      // Test: Non-existent source (but path must be under projectsDir to pass containment check)
      const nonExistentFolder = join(projectsDir, "-Users-nonexistent-folder");
      await expect(
        handlers.migrateProject({
          source_folder: nonExistentFolder,
          old_project_path: "/old",
          new_project_path: "/new",
          dry_run: false,
        })
      ).rejects.toThrow(/does not exist/i);
    });

    it("should create backup before migration", async () => {
      // Setup: Create source folder
      const sourceFolder = join(projectsDir, "-Users-test-source");
      mkdirSync(sourceFolder, { recursive: true });

      writeFileSync(join(sourceFolder, "session.jsonl"), 'content');
      const db = getSQLiteManager().getDatabase();
      const projectId = insertProject(db, "/old");
      insertConversation(db, projectId, "/old", "c1", 1000);

      // Test: Execute migration
      await handlers.migrateProject({
        source_folder: sourceFolder,
        old_project_path: "/old",
        new_project_path: "/new",
        dry_run: false,
      });

      // Verify: Backup created
      const dbPath = getSQLiteManager().getDbPath();
      const backupDir = dirname(dbPath);
      const backups = readdirSync(backupDir).filter((name) =>
        name.startsWith(`${basename(dbPath)}.bak.`)
      );
      expect(backups.length).toBeGreaterThan(0);
    });

    it("should preserve original source data", async () => {
      // Setup: Create source folder
      const sourceFolder = join(projectsDir, "-Users-test-source");
      mkdirSync(sourceFolder, { recursive: true });

      const originalContent = 'original content';
      writeFileSync(join(sourceFolder, "session.jsonl"), originalContent);

      // Test: Execute migration
      await handlers.migrateProject({
        source_folder: sourceFolder,
        old_project_path: "/old",
        new_project_path: "/new",
        dry_run: false,
      });

      // Verify: Original still exists and unchanged
      expect(existsSync(join(sourceFolder, "session.jsonl"))).toBe(true);
    });
  });
});
