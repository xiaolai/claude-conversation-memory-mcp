/**
 * Integration tests for end-to-end migration workflow
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import Database from "better-sqlite3";
import { ProjectMigration } from "../../utils/ProjectMigration.js";
import { getSQLiteManager, resetSQLiteManager } from "../../storage/SQLiteManager.js";

describe("Migration Integration", () => {
  let testDir: string;
  let projectsDir: string;
  let migration: ProjectMigration;

  beforeEach(() => {
    testDir = join(tmpdir(), `migration-integration-${Date.now()}`);
    projectsDir = join(testDir, ".claude", "projects");
    mkdirSync(projectsDir, { recursive: true });

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

  it("should migrate full conversation history end-to-end", async () => {
    // Setup: Create realistic source data
    const sourceFolder = join(projectsDir, "-Users-test-myproject-old");
    mkdirSync(sourceFolder, { recursive: true });

    // Create 5 JSONL conversation files
    const sessions = ['session1', 'session2', 'session3', 'session4', 'session5'];
    sessions.forEach(session => {
      const content = [
        '{"type":"user","uuid":"u1","sessionId":"s1","timestamp":"2024-01-01T10:00:00Z","message":{"role":"user","content":"Hello"}}',
        '{"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"s1","timestamp":"2024-01-01T10:00:01Z","message":{"role":"assistant","content":"Hi there"}}'
      ].join('\n');
      writeFileSync(join(sourceFolder, `${session}.jsonl`), content);
    });

    // Create database with full schema
    const sourceDb = join(sourceFolder, ".cccmemory.db");
    const db = new Database(sourceDb);
    db.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        first_message_at INTEGER,
        last_message_at INTEGER,
        message_count INTEGER,
        git_branch TEXT,
        claude_version TEXT,
        metadata TEXT,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        parent_id TEXT,
        message_type TEXT NOT NULL,
        role TEXT,
        content TEXT,
        timestamp INTEGER NOT NULL,
        is_sidechain INTEGER DEFAULT 0,
        agent_id TEXT,
        request_id TEXT,
        git_branch TEXT,
        cwd TEXT,
        metadata TEXT DEFAULT '{}'
      );

      CREATE TABLE git_commits (
        sha TEXT PRIMARY KEY,
        message TEXT,
        author TEXT,
        timestamp INTEGER,
        conversation_id TEXT,
        confidence INTEGER
      );

      INSERT INTO conversations VALUES
        ('conv1', '/Users/test/myproject-old', 1000, 2000, 10, 'main', '1.0', '{}', 1000, 2000),
        ('conv2', '/Users/test/myproject-old', 3000, 4000, 15, 'main', '1.0', '{}', 3000, 4000),
        ('conv3', '/Users/test/myproject-old', 5000, 6000, 20, 'dev', '1.0', '{}', 5000, 6000);

      INSERT INTO messages VALUES
        ('m1', 'conv1', NULL, 'user', 'user', 'Hello', 1000, 0, NULL, NULL, 'main', '/test', '{}'),
        ('m2', 'conv1', 'm1', 'assistant', 'assistant', 'Hi', 1001, 0, NULL, NULL, 'main', '/test', '{}');

      INSERT INTO git_commits VALUES
        ('abc123', 'Initial commit', 'Test User', 1000, 'conv1', 80),
        ('def456', 'Add feature', 'Test User', 3000, 'conv2', 75);
    `);
    db.close();

    const targetFolder = join(projectsDir, "-Users-test-myproject-new");
    const oldPath = "/Users/test/myproject-old";
    const newPath = "/Users/test/myproject-new";

    // Test: Execute full migration
    const result = await migration.executeMigration(
      sourceFolder,
      targetFolder,
      oldPath,
      newPath,
      false
    );

    // Verify: All files copied
    expect(result.success).toBe(true);
    expect(result.filesCopied).toBe(5);
    sessions.forEach(session => {
      expect(existsSync(join(targetFolder, `${session}.jsonl`))).toBe(true);
    });

    // Verify: Database copied and updated
    const targetDb = new Database(join(targetFolder, ".cccmemory.db"));

    // Check project_path updated
    const conversations = targetDb.prepare("SELECT * FROM conversations").all() as Array<{id: string; project_path: string}>;
    expect(conversations).toHaveLength(3);
    conversations.forEach(conv => {
      expect(conv.project_path).toBe(newPath);
    });

    // Check other data preserved
    const messages = targetDb.prepare("SELECT * FROM messages").all();
    expect(messages).toHaveLength(2);

    const commits = targetDb.prepare("SELECT * FROM git_commits").all();
    expect(commits).toHaveLength(2);

    targetDb.close();

    // Verify: Backup created
    expect(existsSync(join(sourceFolder, ".cccmemory.db.bak"))).toBe(true);

    // Verify: Original preserved
    expect(existsSync(join(sourceFolder, "session1.jsonl"))).toBe(true);
  });

  it("should handle legacy folder naming", async () => {
    // Setup: Legacy folder with dots replaced by dashes
    const legacyFolder = join(projectsDir, "-Users-test-my-project-com-old");
    mkdirSync(legacyFolder, { recursive: true });

    writeFileSync(join(legacyFolder, "session.jsonl"), '{}');

    const db = new Database(join(legacyFolder, ".cccmemory.db"));
    db.exec(`
      CREATE TABLE conversations (id TEXT, project_path TEXT);
      INSERT INTO conversations VALUES ('c1', '/Users/test/my.project.com/old');
    `);
    db.close();

    // Test: Discover should find legacy folder
    const results = await migration.discoverOldFolders("/Users/test/my.project.com/new");

    // Verify: Found despite naming difference
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].folderName).toBe("-Users-test-my-project-com-old");
  });

  it("should work with empty target location", async () => {
    // Setup: Source with data, target doesn't exist yet
    const sourceFolder = join(projectsDir, "-Users-test-source");
    mkdirSync(sourceFolder, { recursive: true });

    writeFileSync(join(sourceFolder, "session.jsonl"), '{}');

    const db = new Database(join(sourceFolder, ".cccmemory.db"));
    db.exec(`
      CREATE TABLE conversations (id TEXT, project_path TEXT);
      INSERT INTO conversations VALUES ('c1', '/old');
    `);
    db.close();

    const targetFolder = join(projectsDir, "-Users-test-target");
    // Target doesn't exist yet

    // Test: Should create target and migrate
    await migration.executeMigration(sourceFolder, targetFolder, "/old", "/new", false);

    // Verify: Target created with data
    expect(existsSync(targetFolder)).toBe(true);
    expect(existsSync(join(targetFolder, "session.jsonl"))).toBe(true);
    expect(existsSync(join(targetFolder, ".cccmemory.db"))).toBe(true);
  });

  it("should abort on conflicts", async () => {
    // Setup: Both source and target have data
    const sourceFolder = join(projectsDir, "-Users-test-source");
    const targetFolder = join(projectsDir, "-Users-test-target");
    mkdirSync(sourceFolder, { recursive: true });
    mkdirSync(targetFolder, { recursive: true });

    writeFileSync(join(sourceFolder, "source.jsonl"), '{}');
    writeFileSync(join(targetFolder, "target.jsonl"), '{}');

    const db = new Database(join(sourceFolder, ".cccmemory.db"));
    db.exec(`CREATE TABLE conversations (id TEXT);`);
    db.close();

    // Test: Should detect conflict and abort
    const validation = migration.validateMigration(sourceFolder, targetFolder);
    expect(validation.valid).toBe(false);

    // Verify: executeMigration should reject
    await expect(
      migration.executeMigration(sourceFolder, targetFolder, "/old", "/new", false)
    ).rejects.toThrow(/already has/i);
  });

  it("should preserve all data integrity after migration", async () => {
    // Setup: Create data with specific content to verify
    const sourceFolder = join(projectsDir, "-Users-test-source");
    mkdirSync(sourceFolder, { recursive: true });

    const jsonlContent = '{"type":"user","uuid":"unique123","sessionId":"s1","message":{"role":"user","content":"Test message"}}';
    writeFileSync(join(sourceFolder, "session.jsonl"), jsonlContent);

    const sourceDb = join(sourceFolder, ".cccmemory.db");
    const db = new Database(sourceDb);
    db.exec(`
      CREATE TABLE conversations (id TEXT, project_path TEXT, metadata TEXT);
      CREATE TABLE messages (id TEXT, content TEXT, timestamp INTEGER);
      INSERT INTO conversations VALUES ('c1', '/old/path', '{"key":"value"}');
      INSERT INTO messages VALUES ('m1', 'Test content', 12345);
    `);
    db.close();

    const targetFolder = join(projectsDir, "-Users-test-target");

    // Test: Migrate
    await migration.executeMigration(sourceFolder, targetFolder, "/old/path", "/new/path", false);

    // Verify: JSONL content exactly preserved
    const copiedContent = readFileSync(join(targetFolder, "session.jsonl"), "utf-8");
    expect(copiedContent).toBe(jsonlContent);

    // Verify: Database content preserved (except project_path)
    const targetDb = new Database(join(targetFolder, ".cccmemory.db"));

    const conv = targetDb.prepare("SELECT * FROM conversations WHERE id = 'c1'").get() as {
      id: string;
      project_path: string;
      metadata: string;
    };
    expect(conv.project_path).toBe("/new/path"); // Updated
    expect(conv.metadata).toBe('{"key":"value"}'); // Preserved

    const msg = targetDb.prepare("SELECT * FROM messages WHERE id = 'm1'").get() as {
      id: string;
      content: string;
      timestamp: number;
    };
    expect(msg.content).toBe("Test content");
    expect(msg.timestamp).toBe(12345);

    targetDb.close();
  });
});
