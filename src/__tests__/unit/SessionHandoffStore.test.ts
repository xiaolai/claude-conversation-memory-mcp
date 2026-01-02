/**
 * Unit tests for SessionHandoffStore
 */

import Database from "better-sqlite3";
import { SessionHandoffStore } from "../../handoff/SessionHandoffStore.js";

describe("SessionHandoffStore", () => {
  let db: Database.Database;
  let store: SessionHandoffStore;
  const projectPath = "/test/project";

  beforeEach(() => {
    // Create in-memory database with required schema
    db = new Database(":memory:");

    // Create required tables
    db.exec(`
      -- Session Handoffs table
      CREATE TABLE IF NOT EXISTS session_handoffs (
        id TEXT PRIMARY KEY,
        from_session_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        handoff_data TEXT NOT NULL,
        resumed_by_session_id TEXT,
        resumed_at INTEGER
      );

      -- Working Memory table
      CREATE TABLE IF NOT EXISTS working_memory (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        context TEXT,
        tags TEXT,
        session_id TEXT,
        project_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        embedding BLOB,
        UNIQUE(project_path, key)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS working_memory_fts USING fts5(
        id UNINDEXED,
        key,
        value,
        context
      );

      -- Decisions table (minimal for testing)
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        decision_text TEXT NOT NULL,
        rationale TEXT,
        context TEXT,
        timestamp INTEGER NOT NULL
      );

      -- Tool uses table (minimal for testing)
      CREATE TABLE IF NOT EXISTS tool_uses (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        parameters TEXT,
        result TEXT,
        timestamp INTEGER NOT NULL
      );

      -- Messages table (minimal for testing)
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        timestamp INTEGER NOT NULL
      );

      -- Conversations table (minimal for testing)
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    store = new SessionHandoffStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("prepareHandoff", () => {
    it("should create a handoff document", () => {
      const handoff = store.prepareHandoff({
        sessionId: "session-123",
        projectPath,
      });

      expect(handoff.id).toBeDefined();
      expect(handoff.fromSessionId).toBe("session-123");
      expect(handoff.projectPath).toBe(projectPath);
      expect(handoff.createdAt).toBeDefined();
      expect(handoff.contextSummary).toBeDefined();
    });

    it("should store handoff in database", () => {
      const handoff = store.prepareHandoff({
        sessionId: "session-123",
        projectPath,
      });

      const row = db
        .prepare("SELECT * FROM session_handoffs WHERE id = ?")
        .get(handoff.id) as { id: string; from_session_id: string } | undefined;

      expect(row).toBeDefined();
      expect(row?.from_session_id).toBe("session-123");
    });

    it("should include working memory items when requested", () => {
      // Add some working memory
      db.prepare(
        `INSERT INTO working_memory (id, key, value, project_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run("mem-1", "storage", "SQLite", projectPath, Date.now(), Date.now());

      const handoff = store.prepareHandoff({
        sessionId: "session-123",
        projectPath,
        include: ["memory"],
      });

      expect(handoff.workingMemory.length).toBe(1);
      expect(handoff.workingMemory[0].key).toBe("storage");
    });

    it("should use default session ID if not provided", () => {
      const handoff = store.prepareHandoff({
        projectPath,
      });

      expect(handoff.fromSessionId).toBe("current");
    });

    it("should include selective data based on include array", () => {
      const handoff = store.prepareHandoff({
        projectPath,
        include: ["decisions"],
      });

      // Should have attempted to get decisions (empty array due to no data)
      expect(handoff.decisions).toEqual([]);
      // Should not have working memory since it wasn't included
      expect(handoff.workingMemory).toEqual([]);
    });
  });

  describe("resumeFromHandoff", () => {
    it("should resume from a specific handoff by ID", () => {
      const original = store.prepareHandoff({
        sessionId: "session-123",
        projectPath,
      });

      const resumed = store.resumeFromHandoff({
        handoffId: original.id,
        projectPath,
        newSessionId: "session-456",
      });

      expect(resumed).not.toBeNull();
      expect(resumed?.id).toBe(original.id);
      expect(resumed?.resumedBy).toBe("session-456");
    });

    it("should resume from most recent unresumed handoff when no ID specified", async () => {
      // Create two handoffs with a delay to ensure different timestamps
      store.prepareHandoff({
        sessionId: "session-1",
        projectPath,
      });

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const second = store.prepareHandoff({
        sessionId: "session-2",
        projectPath,
      });

      const resumed = store.resumeFromHandoff({
        projectPath,
        newSessionId: "session-3",
      });

      expect(resumed).not.toBeNull();
      expect(resumed?.fromSessionId).toBe("session-2");
      expect(resumed?.id).toBe(second.id);
    });

    it("should return null when no unresumed handoff found", () => {
      // Create and resume a handoff
      const handoff = store.prepareHandoff({
        sessionId: "session-1",
        projectPath,
      });

      store.resumeFromHandoff({
        handoffId: handoff.id,
        projectPath,
        newSessionId: "session-2",
      });

      // Try to resume again without specifying ID
      const result = store.resumeFromHandoff({
        projectPath,
        newSessionId: "session-3",
      });

      expect(result).toBeNull();
    });

    it("should mark handoff as resumed in database", () => {
      const handoff = store.prepareHandoff({
        sessionId: "session-1",
        projectPath,
      });

      store.resumeFromHandoff({
        handoffId: handoff.id,
        projectPath,
        newSessionId: "session-2",
      });

      const row = db
        .prepare("SELECT * FROM session_handoffs WHERE id = ?")
        .get(handoff.id) as {
        resumed_by_session_id: string;
        resumed_at: number;
      } | undefined;

      expect(row?.resumed_by_session_id).toBe("session-2");
      expect(row?.resumed_at).toBeDefined();
    });

    it("should inject working memory when requested", () => {
      // Create handoff with working memory
      db.prepare(
        `INSERT INTO working_memory (id, key, value, project_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run("mem-1", "test_key", "test_value", projectPath, Date.now(), Date.now());

      const handoff = store.prepareHandoff({
        sessionId: "session-1",
        projectPath,
        include: ["memory"],
      });

      // Clear working memory
      db.prepare("DELETE FROM working_memory").run();

      // Resume with inject_context
      store.resumeFromHandoff({
        handoffId: handoff.id,
        projectPath,
        newSessionId: "session-2",
        injectContext: true,
      });

      // Check working memory was restored
      const restored = db
        .prepare("SELECT * FROM working_memory WHERE key = ?")
        .get("test_key") as { value: string } | undefined;

      expect(restored?.value).toBe("test_value");
    });
  });

  describe("listHandoffs", () => {
    let secondHandoff: ReturnType<typeof store.prepareHandoff>;

    beforeEach(async () => {
      // Create several handoffs with delays to ensure different timestamps
      store.prepareHandoff({
        sessionId: "session-1",
        projectPath,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      secondHandoff = store.prepareHandoff({
        sessionId: "session-2",
        projectPath,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      store.prepareHandoff({
        sessionId: "session-3",
        projectPath,
      });

      // Resume the second one
      store.resumeFromHandoff({
        handoffId: secondHandoff.id,
        projectPath,
        newSessionId: "session-4",
      });
    });

    it("should list unresumed handoffs by default", () => {
      const handoffs = store.listHandoffs(projectPath);

      expect(handoffs.length).toBe(2);
      expect(handoffs.every((h) => h.resumedBy === undefined)).toBe(true);
    });

    it("should include resumed handoffs when requested", () => {
      const handoffs = store.listHandoffs(projectPath, { includeResumed: true });

      expect(handoffs.length).toBe(3);
    });

    it("should respect limit parameter", () => {
      const handoffs = store.listHandoffs(projectPath, { limit: 1 });

      expect(handoffs.length).toBe(1);
    });

    it("should order by created_at descending", () => {
      const handoffs = store.listHandoffs(projectPath);

      // Most recent first
      expect(handoffs[0].fromSessionId).toBe("session-3");
    });

    it("should include summary for each handoff", () => {
      const handoffs = store.listHandoffs(projectPath);

      expect(handoffs.every((h) => typeof h.summary === "string")).toBe(true);
    });
  });

  describe("getHandoff", () => {
    it("should get a specific handoff by ID", () => {
      const created = store.prepareHandoff({
        sessionId: "session-1",
        projectPath,
      });

      const handoff = store.getHandoff(created.id);

      expect(handoff).not.toBeNull();
      expect(handoff?.id).toBe(created.id);
      expect(handoff?.fromSessionId).toBe("session-1");
    });

    it("should return null for non-existent ID", () => {
      const handoff = store.getHandoff("nonexistent");

      expect(handoff).toBeNull();
    });
  });

  describe("deleteHandoff", () => {
    it("should delete a handoff by ID", () => {
      const handoff = store.prepareHandoff({
        sessionId: "session-1",
        projectPath,
      });

      const deleted = store.deleteHandoff(handoff.id);

      expect(deleted).toBe(true);
      expect(store.getHandoff(handoff.id)).toBeNull();
    });

    it("should return false for non-existent ID", () => {
      const deleted = store.deleteHandoff("nonexistent");

      expect(deleted).toBe(false);
    });
  });

  describe("context summary generation", () => {
    it("should generate summary with decision count", () => {
      // Set up test data for decisions
      const convId = "conv-1";
      const msgId = "msg-1";

      db.prepare(
        `INSERT INTO conversations (id, session_id, project_path, created_at)
         VALUES (?, ?, ?, ?)`
      ).run(convId, "session-1", projectPath, Date.now());

      db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp)
         VALUES (?, ?, ?, ?, ?)`
      ).run(msgId, convId, "assistant", "test", Date.now());

      db.prepare(
        `INSERT INTO decisions (id, message_id, decision_text, timestamp)
         VALUES (?, ?, ?, ?)`
      ).run("dec-1", msgId, "Use TypeScript", Date.now());

      const handoff = store.prepareHandoff({
        sessionId: "session-1",
        projectPath,
        include: ["decisions"],
      });

      expect(handoff.contextSummary).toContain("1 decision");
    });

    it("should indicate empty handoff", () => {
      const handoff = store.prepareHandoff({
        sessionId: "session-1",
        projectPath,
        include: [],
      });

      expect(handoff.contextSummary).toBe("Empty handoff.");
    });
  });
});
