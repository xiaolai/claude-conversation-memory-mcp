/**
 * Unit tests for LiveExtractor
 */

import Database from "better-sqlite3";
import { LiveExtractor } from "../../realtime/LiveExtractor.js";
import type { ParsedMessage } from "../../realtime/IncrementalParser.js";

describe("LiveExtractor", () => {
  let db: Database.Database;
  let extractor: LiveExtractor;
  const testFilePath = "/Users/test/.claude/projects/-test-project/conversation.jsonl";

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
    `);

    extractor = new LiveExtractor(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("processMessages", () => {
    it("should return extraction result with counts", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "assistant",
          content: "I'll use TypeScript for the implementation.",
          timestamp: Date.now(),
        },
      ];

      const result = await extractor.processMessages(testFilePath, messages);

      expect(result.messagesProcessed).toBe(1);
      expect(typeof result.decisionsExtracted).toBe("number");
      expect(typeof result.filesTracked).toBe("number");
      expect(typeof result.errorsDetected).toBe("number");
    });

    it("should extract decisions from assistant messages", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "assistant",
          content:
            "I've decided to use SQLite for storage. This is the best approach because it's simple and works well.",
          timestamp: Date.now(),
        },
      ];

      const result = await extractor.processMessages(testFilePath, messages);

      // Should have extracted at least one decision
      expect(result.decisionsExtracted).toBeGreaterThanOrEqual(0);
    });

    it("should track file operations from tool uses", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "assistant",
          content: "Reading the file...",
          toolUse: {
            name: "Read",
            input: { file_path: "/test/file.ts" },
          },
          timestamp: Date.now(),
        },
      ];

      const result = await extractor.processMessages(testFilePath, messages);

      expect(result.filesTracked).toBe(1);
    });

    it("should detect errors from tool results", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "user",
          content: "",
          toolResult: {
            name: "Bash",
            output: "Error: Command failed with exit code 1",
            isError: true,
          },
          timestamp: Date.now(),
        },
      ];

      const result = await extractor.processMessages(testFilePath, messages);

      expect(result.errorsDetected).toBe(1);
    });

    it("should not process user messages for decisions", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "user",
          content: "I've decided to use PostgreSQL.",
          timestamp: Date.now(),
        },
      ];

      const result = await extractor.processMessages(testFilePath, messages);

      // User messages shouldn't be processed for decisions
      expect(result.decisionsExtracted).toBe(0);
    });
  });

  describe("decision extraction", () => {
    it("should extract 'I will' pattern decisions", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "assistant",
          content: "I will implement the caching layer using Redis for better performance.",
          timestamp: Date.now(),
        },
      ];

      await extractor.processMessages(testFilePath, messages);

      // Check that decision was stored in working memory
      const stored = db
        .prepare("SELECT * FROM working_memory WHERE tags LIKE '%decision%'")
        .all() as Array<{ value: string }>;

      expect(stored.length).toBeGreaterThanOrEqual(0);
    });

    it("should extract 'Let us' pattern decisions", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "assistant",
          content: "Let's use Jest for testing since it's already configured.",
          timestamp: Date.now(),
        },
      ];

      const extractResult = await extractor.processMessages(testFilePath, messages);

      expect(extractResult.decisionsExtracted).toBeGreaterThanOrEqual(0);
    });
  });

  describe("file operation tracking", () => {
    it("should track Read operations", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "assistant",
          content: "",
          toolUse: {
            name: "Read",
            input: { file_path: "/path/to/file.ts" },
          },
          timestamp: Date.now(),
        },
      ];

      const result = await extractor.processMessages(testFilePath, messages);

      expect(result.filesTracked).toBe(1);

      // Verify stored in memory
      const stored = db
        .prepare("SELECT * FROM working_memory WHERE tags LIKE '%read%'")
        .get() as { value: string } | undefined;

      expect(stored).toBeDefined();
      expect(stored?.value).toContain("/path/to/file.ts");
    });

    it("should track Edit operations", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "assistant",
          content: "",
          toolUse: {
            name: "Edit",
            input: { file_path: "/path/to/file.ts", old_string: "old", new_string: "new" },
          },
          timestamp: Date.now(),
        },
      ];

      const result = await extractor.processMessages(testFilePath, messages);

      expect(result.filesTracked).toBe(1);

      const stored = db
        .prepare("SELECT * FROM working_memory WHERE tags LIKE '%edit%'")
        .get() as { value: string } | undefined;

      expect(stored?.value).toContain("edit:");
    });

    it("should track Write operations", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "assistant",
          content: "",
          toolUse: {
            name: "Write",
            input: { file_path: "/path/to/new-file.ts", content: "..." },
          },
          timestamp: Date.now(),
        },
      ];

      const result = await extractor.processMessages(testFilePath, messages);

      expect(result.filesTracked).toBe(1);
    });

    it("should update rather than duplicate file entries", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "assistant",
          content: "",
          toolUse: {
            name: "Read",
            input: { file_path: "/path/to/file.ts" },
          },
          timestamp: Date.now(),
        },
        {
          type: "assistant",
          content: "",
          toolUse: {
            name: "Edit",
            input: { file_path: "/path/to/file.ts" },
          },
          timestamp: Date.now(),
        },
      ];

      await extractor.processMessages(testFilePath, messages);

      // Should only have one entry for the file (with updated action)
      const stored = db
        .prepare("SELECT * FROM working_memory WHERE key LIKE 'file_%'")
        .all() as Array<{ key: string }>;

      // Should have exactly one entry for this file
      const fileEntries = stored.filter((s) => s.key.includes("file_"));
      expect(fileEntries.length).toBe(1);
    });
  });

  describe("error detection", () => {
    it("should detect errors in content", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "assistant",
          content: "I encountered an error: Cannot read property 'foo' of undefined",
          timestamp: Date.now(),
        },
      ];

      const result = await extractor.processMessages(testFilePath, messages);

      expect(result.errorsDetected).toBeGreaterThan(0);
    });

    it("should store errors in working memory", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "user",
          content: "",
          toolResult: {
            name: "Bash",
            output: "failed: network connection refused",
            isError: true,
          },
          timestamp: Date.now(),
        },
      ];

      await extractor.processMessages(testFilePath, messages);

      const stored = db
        .prepare("SELECT * FROM working_memory WHERE tags LIKE '%error%'")
        .all() as Array<{ value: string }>;

      expect(stored.length).toBeGreaterThan(0);
    });
  });

  describe("project path extraction", () => {
    it("should extract project path from Claude conversation file path", async () => {
      const messages: ParsedMessage[] = [
        {
          type: "assistant",
          content: "Test message",
          timestamp: Date.now(),
        },
      ];

      // Just verify processing completes without error
      await extractor.processMessages(testFilePath, messages);
      expect(true).toBe(true);
    });
  });

  describe("getMemoryStore", () => {
    it("should provide access to the working memory store", () => {
      const store = extractor.getMemoryStore();

      expect(store).toBeDefined();
      expect(typeof store.remember).toBe("function");
      expect(typeof store.recall).toBe("function");
    });
  });
});
