/**
 * Unit tests for ContextInjector
 */

import Database from "better-sqlite3";
import { ContextInjector } from "../../context/ContextInjector.js";
import { WorkingMemoryStore } from "../../memory/WorkingMemoryStore.js";
import { SessionHandoffStore } from "../../handoff/SessionHandoffStore.js";

describe("ContextInjector", () => {
  let db: Database.Database;
  let injector: ContextInjector;
  let memoryStore: WorkingMemoryStore;
  let handoffStore: SessionHandoffStore;
  const projectPath = "/test/project";

  beforeEach(() => {
    db = new Database(":memory:");

    // Create required tables
    db.exec(`
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

      CREATE TABLE IF NOT EXISTS session_handoffs (
        id TEXT PRIMARY KEY,
        from_session_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        handoff_data TEXT NOT NULL,
        resumed_by_session_id TEXT,
        resumed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        decision_text TEXT NOT NULL,
        rationale TEXT,
        context TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_uses (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        parameters TEXT,
        result TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    injector = new ContextInjector(db);
    memoryStore = new WorkingMemoryStore(db);
    handoffStore = new SessionHandoffStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("getRelevantContext", () => {
    it("should return empty context when nothing is stored", async () => {
      const context = await injector.getRelevantContext({
        projectPath,
      });

      expect(context.decisions).toEqual([]);
      expect(context.memory).toEqual([]);
      expect(context.recentFiles).toEqual([]);
      expect(context.handoff).toBeUndefined();
    });

    it("should include working memory items", async () => {
      memoryStore.remember({
        key: "storage_choice",
        value: "Using SQLite",
        projectPath,
      });

      const context = await injector.getRelevantContext({
        projectPath,
        sources: ["memory"],
      });

      expect(context.memory.length).toBe(1);
      expect(context.memory[0].key).toBe("storage_choice");
    });

    it("should include handoff when available", async () => {
      const handoff = handoffStore.prepareHandoff({
        sessionId: "session-1",
        projectPath,
      });

      const context = await injector.getRelevantContext({
        projectPath,
        sources: ["handoffs"],
      });

      expect(context.handoff).toBeDefined();
      expect(context.handoff?.id).toBe(handoff.id);
    });

    it("should filter by query when provided", async () => {
      memoryStore.remember({
        key: "database",
        value: "Using PostgreSQL for production",
        projectPath,
      });

      memoryStore.remember({
        key: "testing",
        value: "Jest for unit tests",
        projectPath,
      });

      const context = await injector.getRelevantContext({
        query: "PostgreSQL",
        projectPath,
        sources: ["memory"],
      });

      // Semantic search should find the database-related item
      expect(context.memory.length).toBeGreaterThan(0);
    });

    it("should respect token budget", async () => {
      // Add many items
      for (let i = 0; i < 20; i++) {
        memoryStore.remember({
          key: `item_${i}`,
          value: "A moderately long value that takes up some tokens " + i,
          projectPath,
        });
      }

      const context = await injector.getRelevantContext({
        projectPath,
        maxTokens: 100,
        sources: ["memory"],
      });

      // Should not include all 20 items due to token limit
      expect(context.memory.length).toBeLessThan(20);
      expect(context.tokenEstimate).toBeLessThanOrEqual(100);
    });

    it("should prioritize critical items", async () => {
      memoryStore.remember({
        key: "low_priority",
        value: "Regular information",
        tags: [],
        projectPath,
      });

      memoryStore.remember({
        key: "critical_info",
        value: "Very important decision",
        tags: ["critical"],
        projectPath,
      });

      const context = await injector.getRelevantContext({
        projectPath,
        maxTokens: 50, // Tight budget
        sources: ["memory"],
      });

      // Critical items should be prioritized
      const hasCritical = context.memory.some(m => m.key === "critical_info");
      expect(hasCritical).toBe(true);
    });
  });

  describe("formatForInjection", () => {
    it("should format context as markdown", async () => {
      memoryStore.remember({
        key: "storage",
        value: "SQLite",
        projectPath,
      });

      // Create handoff to be retrieved by context injector
      handoffStore.prepareHandoff({
        sessionId: "session-1",
        projectPath,
        include: ["memory"],
      });

      const context = await injector.getRelevantContext({
        projectPath,
        sources: ["handoffs", "memory"],
      });

      const formatted = injector.formatForInjection(context);

      expect(formatted).toContain("## Previous Session Context");
      expect(formatted).toContain("## Remembered Context");
      expect(formatted).toContain("**storage**");
    });

    it("should include section for each available source", async () => {
      // Add working memory
      memoryStore.remember({
        key: "test",
        value: "value",
        projectPath,
      });

      const context = await injector.getRelevantContext({
        projectPath,
        sources: ["memory"],
      });

      const formatted = injector.formatForInjection(context);

      expect(formatted).toContain("Remembered Context");
    });

    it("should return empty string for empty context", async () => {
      const context = await injector.getRelevantContext({
        projectPath,
      });

      const formatted = injector.formatForInjection(context);

      // Should be empty or minimal
      expect(formatted.trim().length).toBeLessThan(50);
    });
  });

  describe("token estimation", () => {
    it("should provide reasonable token estimates", async () => {
      const testText = "This is a sample text for token estimation testing.";

      memoryStore.remember({
        key: "test",
        value: testText,
        projectPath,
      });

      const context = await injector.getRelevantContext({
        projectPath,
        sources: ["memory"],
      });

      // Token estimate should be positive (roughly 1/4 of character count)
      expect(context.tokenEstimate).toBeGreaterThan(0);
    });
  });

  describe("summary generation", () => {
    it("should generate descriptive summary", async () => {
      memoryStore.remember({
        key: "item1",
        value: "value1",
        projectPath,
      });

      memoryStore.remember({
        key: "item2",
        value: "value2",
        projectPath,
      });

      const context = await injector.getRelevantContext({
        projectPath,
        sources: ["memory"],
      });

      expect(context.summary).toContain(projectPath);
      expect(context.summary).toContain("memory item");
    });
  });
});
