/**
 * Unit tests for WorkingMemoryStore
 */

import Database from "better-sqlite3";
import { WorkingMemoryStore } from "../../memory/WorkingMemoryStore.js";

describe("WorkingMemoryStore", () => {
  let db: Database.Database;
  let store: WorkingMemoryStore;
  const projectPath = "/test/project";

  beforeEach(() => {
    // Create in-memory database with required schema
    db = new Database(":memory:");

    // Create working_memory table
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

      CREATE INDEX IF NOT EXISTS idx_wm_project ON working_memory(project_path);
      CREATE INDEX IF NOT EXISTS idx_wm_project_key ON working_memory(project_path, key);

      CREATE VIRTUAL TABLE IF NOT EXISTS working_memory_fts USING fts5(
        id UNINDEXED,
        key,
        value,
        context
      );
    `);

    store = new WorkingMemoryStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("remember", () => {
    it("should store a new memory item", () => {
      const result = store.remember({
        key: "storage_decision",
        value: "Using SQLite for simplicity",
        projectPath,
      });

      expect(result.id).toBeDefined();
      expect(result.key).toBe("storage_decision");
      expect(result.value).toBe("Using SQLite for simplicity");
      expect(result.projectPath).toBe(projectPath);
      expect(result.tags).toEqual([]);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it("should store memory with context and tags", () => {
      const result = store.remember({
        key: "api_key",
        value: "Use environment variables",
        context: "Security best practice for credential management",
        tags: ["security", "config"],
        projectPath,
      });

      expect(result.context).toBe("Security best practice for credential management");
      expect(result.tags).toEqual(["security", "config"]);
    });

    it("should update existing key instead of duplicating", () => {
      store.remember({
        key: "storage",
        value: "PostgreSQL",
        projectPath,
      });

      const updated = store.remember({
        key: "storage",
        value: "SQLite",
        projectPath,
      });

      expect(updated.value).toBe("SQLite");

      // Should have only one item
      const items = store.list(projectPath);
      expect(items.length).toBe(1);
      expect(items[0].value).toBe("SQLite");
    });

    it("should store memory with TTL", () => {
      const result = store.remember({
        key: "temp_setting",
        value: "test",
        ttl: 3600, // 1 hour
        projectPath,
      });

      expect(result.expiresAt).toBeDefined();
      // Should expire approximately 1 hour from now
      const expectedExpiry = Date.now() + 3600 * 1000;
      expect(result.expiresAt).toBeGreaterThan(expectedExpiry - 1000);
      expect(result.expiresAt).toBeLessThan(expectedExpiry + 1000);
    });

    it("should store memory with session ID", () => {
      const result = store.remember({
        key: "session_data",
        value: "user preferences",
        sessionId: "session-123",
        projectPath,
      });

      expect(result.sessionId).toBe("session-123");
    });
  });

  describe("recall", () => {
    it("should recall a stored item by key", () => {
      store.remember({
        key: "api_endpoint",
        value: "https://api.example.com",
        projectPath,
      });

      const result = store.recall("api_endpoint", projectPath);

      expect(result).not.toBeNull();
      expect(result?.key).toBe("api_endpoint");
      expect(result?.value).toBe("https://api.example.com");
    });

    it("should return null for non-existent key", () => {
      const result = store.recall("nonexistent", projectPath);
      expect(result).toBeNull();
    });

    it("should not recall expired items", async () => {
      store.remember({
        key: "expired_item",
        value: "will expire",
        ttl: -1, // Already expired
        projectPath,
      });

      const result = store.recall("expired_item", projectPath);
      expect(result).toBeNull();
    });

    it("should scope by project path", () => {
      store.remember({
        key: "setting",
        value: "project1_value",
        projectPath: "/project1",
      });

      store.remember({
        key: "setting",
        value: "project2_value",
        projectPath: "/project2",
      });

      const result1 = store.recall("setting", "/project1");
      const result2 = store.recall("setting", "/project2");

      expect(result1?.value).toBe("project1_value");
      expect(result2?.value).toBe("project2_value");
    });
  });

  describe("recallMany", () => {
    beforeEach(() => {
      store.remember({
        key: "decision1",
        value: "Use TypeScript",
        tags: ["tech", "language"],
        sessionId: "session-1",
        projectPath,
      });

      store.remember({
        key: "decision2",
        value: "Use SQLite",
        tags: ["tech", "database"],
        sessionId: "session-1",
        projectPath,
      });

      store.remember({
        key: "decision3",
        value: "Use Jest",
        tags: ["tech", "testing"],
        sessionId: "session-2",
        projectPath,
      });
    });

    it("should recall all items for a project", () => {
      const results = store.recallMany({ projectPath });
      expect(results.length).toBe(3);
    });

    it("should filter by session ID", () => {
      const results = store.recallMany({
        projectPath,
        sessionId: "session-1",
      });

      expect(results.length).toBe(2);
    });

    it("should filter by tags", () => {
      const results = store.recallMany({
        projectPath,
        tags: ["database"],
      });

      expect(results.length).toBe(1);
      expect(results[0].value).toBe("Use SQLite");
    });

    it("should match any tag in the list", () => {
      const results = store.recallMany({
        projectPath,
        tags: ["database", "testing"],
      });

      expect(results.length).toBe(2);
    });
  });

  describe("recallRelevant", () => {
    beforeEach(() => {
      store.remember({
        key: "auth_decision",
        value: "Using JWT for authentication",
        context: "Chosen for stateless API design",
        projectPath,
      });

      store.remember({
        key: "db_decision",
        value: "PostgreSQL for production",
        context: "Better scalability",
        projectPath,
      });
    });

    it("should find relevant items by semantic search", () => {
      const results = store.recallRelevant({
        query: "authentication",
        projectPath,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].key).toBe("auth_decision");
    });

    it("should include similarity scores", () => {
      const results = store.recallRelevant({
        query: "JWT",
        projectPath,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].similarity).toBeDefined();
      expect(results[0].similarity).toBeGreaterThanOrEqual(0);
      expect(results[0].similarity).toBeLessThanOrEqual(1);
    });

    it("should respect limit parameter", () => {
      const results = store.recallRelevant({
        query: "decision",
        projectPath,
        limit: 1,
      });

      expect(results.length).toBe(1);
    });
  });

  describe("forget", () => {
    it("should delete an item by key", () => {
      store.remember({
        key: "to_forget",
        value: "temporary",
        projectPath,
      });

      const deleted = store.forget("to_forget", projectPath);
      expect(deleted).toBe(true);

      const result = store.recall("to_forget", projectPath);
      expect(result).toBeNull();
    });

    it("should return false for non-existent key", () => {
      const deleted = store.forget("nonexistent", projectPath);
      expect(deleted).toBe(false);
    });
  });

  describe("forgetAll", () => {
    it("should delete all items for a project", () => {
      store.remember({ key: "item1", value: "v1", projectPath });
      store.remember({ key: "item2", value: "v2", projectPath });
      store.remember({ key: "other", value: "v3", projectPath: "/other/project" });

      const deleted = store.forgetAll(projectPath);

      expect(deleted).toBe(2);
      expect(store.count(projectPath)).toBe(0);
      expect(store.count("/other/project")).toBe(1);
    });
  });

  describe("list", () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) {
        store.remember({
          key: `item${i}`,
          value: `value${i}`,
          tags: i % 2 === 0 ? ["even"] : ["odd"],
          projectPath,
        });
      }
    });

    it("should list all items for a project", () => {
      const items = store.list(projectPath);
      expect(items.length).toBe(5);
    });

    it("should respect limit parameter", () => {
      const items = store.list(projectPath, { limit: 2 });
      expect(items.length).toBe(2);
    });

    it("should respect offset parameter", () => {
      const items = store.list(projectPath, { offset: 3 });
      expect(items.length).toBe(2);
    });

    it("should filter by tags", () => {
      const items = store.list(projectPath, { tags: ["even"] });
      expect(items.length).toBe(3);
    });
  });

  describe("count", () => {
    it("should return correct count", () => {
      expect(store.count(projectPath)).toBe(0);

      store.remember({ key: "item1", value: "v1", projectPath });
      expect(store.count(projectPath)).toBe(1);

      store.remember({ key: "item2", value: "v2", projectPath });
      expect(store.count(projectPath)).toBe(2);
    });

    it("should not count expired items", () => {
      store.remember({ key: "active", value: "v1", projectPath });
      store.remember({ key: "expired", value: "v2", ttl: -1, projectPath });

      // Force cleanup by triggering recall
      store.recall("trigger_cleanup", projectPath);

      expect(store.count(projectPath)).toBe(1);
    });
  });
});
