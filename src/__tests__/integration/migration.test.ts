/**
 * Integration tests for end-to-end migration workflow
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
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

    const targetFolder = join(projectsDir, "-Users-test-myproject-new");
    const oldPath = "/Users/test/myproject-old";
    const newPath = "/Users/test/myproject-new";

    const db = getSQLiteManager().getDatabase();
    const projectId = insertProject(db, oldPath);
    const conv1 = insertConversation(db, projectId, oldPath, "conv1", 2000, 10);
    insertConversation(db, projectId, oldPath, "conv2", 4000, 15);
    insertConversation(db, projectId, oldPath, "conv3", 6000, 20);
    insertMessage(db, conv1, "m1", 1000);
    insertMessage(db, conv1, "m2", 1001);
    db.prepare(
      `
      INSERT INTO git_commits
      (project_id, hash, message, author, timestamp, branch, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).run(projectId, "abc123", "Initial commit", "Test User", 1000, "main", "{}");
    db.prepare(
      `
      INSERT INTO git_commits
      (project_id, hash, message, author, timestamp, branch, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).run(projectId, "def456", "Add feature", "Test User", 3000, "main", "{}");

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

    // Verify: Database updated
    const projectRow = db
      .prepare("SELECT canonical_path FROM projects WHERE id = ?")
      .get(projectId) as { canonical_path: string };
    expect(projectRow.canonical_path).toBe(newPath);

    const conversations = db
      .prepare("SELECT project_path FROM conversations WHERE project_id = ?")
      .all(projectId) as Array<{ project_path: string }>;
    expect(conversations).toHaveLength(3);
    conversations.forEach(conv => {
      expect(conv.project_path).toBe(newPath);
    });

    const messages = db
      .prepare("SELECT COUNT(*) as count FROM messages")
      .get() as { count: number };
    expect(messages.count).toBe(2);

    const commits = db
      .prepare("SELECT COUNT(*) as count FROM git_commits WHERE project_id = ?")
      .get(projectId) as { count: number };
    expect(commits.count).toBe(2);

    // Verify: Original preserved
    expect(existsSync(join(sourceFolder, "session1.jsonl"))).toBe(true);
  });

  it("should handle legacy folder naming", async () => {
    // Setup: Legacy folder with dots replaced by dashes
    const legacyFolder = join(projectsDir, "-Users-test-my-project-com-old");
    mkdirSync(legacyFolder, { recursive: true });

    writeFileSync(join(legacyFolder, "session.jsonl"), '{}');
    const db = getSQLiteManager().getDatabase();
    const projectId = insertProject(db, "/Users/test/my.project.com/old");
    insertConversation(db, projectId, "/Users/test/my.project.com/old", "c1", 1000);

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
    const db = getSQLiteManager().getDatabase();
    const projectId = insertProject(db, "/old");
    insertConversation(db, projectId, "/old", "c1", 1000);

    const targetFolder = join(projectsDir, "-Users-test-target");
    // Target doesn't exist yet

    // Test: Should create target and migrate
    await migration.executeMigration(sourceFolder, targetFolder, "/old", "/new", false);

    // Verify: Target created with data
    expect(existsSync(targetFolder)).toBe(true);
    expect(existsSync(join(targetFolder, "session.jsonl"))).toBe(true);
  });

  it("should abort on conflicts", async () => {
    // Setup: Both source and target have data
    const sourceFolder = join(projectsDir, "-Users-test-source");
    const targetFolder = join(projectsDir, "-Users-test-target");
    mkdirSync(sourceFolder, { recursive: true });
    mkdirSync(targetFolder, { recursive: true });

    writeFileSync(join(sourceFolder, "source.jsonl"), '{}');
    writeFileSync(join(targetFolder, "target.jsonl"), '{}');

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

    const db = getSQLiteManager().getDatabase();
    const projectId = insertProject(db, "/old/path");
    const convId = insertConversation(db, projectId, "/old/path", "c1", 12345);
    db.prepare(
      `
      UPDATE conversations
      SET metadata = ?
      WHERE id = ?
      `
    ).run('{"key":"value"}', convId);
    insertMessage(db, convId, "m1", 12345);

    const targetFolder = join(projectsDir, "-Users-test-target");

    // Test: Migrate
    await migration.executeMigration(sourceFolder, targetFolder, "/old/path", "/new/path", false);

    // Verify: JSONL content exactly preserved
    const copiedContent = readFileSync(join(targetFolder, "session.jsonl"), "utf-8");
    expect(copiedContent).toBe(jsonlContent);

    // Verify: Database content preserved (except project_path)
    const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId) as {
      id: number;
      project_path: string;
      metadata: string;
    };
    expect(conv.project_path).toBe("/new/path"); // Updated
    expect(conv.metadata).toBe('{"key":"value"}'); // Preserved

    const msg = db
      .prepare("SELECT * FROM messages WHERE external_id = 'm1' AND conversation_id = ?")
      .get(convId) as {
      id: number;
      content: string;
      timestamp: number;
    };
    expect(msg.content).toBe("content");
    expect(msg.timestamp).toBe(12345);
  });
});
