/**
 * Unit tests for ConversationStorage with caching
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { SQLiteManager } from "../../storage/SQLiteManager.js";
import { ConversationStorage } from "../../storage/ConversationStorage.js";
import type { Conversation, FileEdit, Message } from "../../parsers/ConversationParser.js";
import type { Decision } from "../../parsers/DecisionExtractor.js";
import type { GitCommit } from "../../parsers/GitIntegrator.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("ConversationStorage with Caching", () => {
  let dbPath: string;
  let db: SQLiteManager;
  let storage: ConversationStorage;

  beforeEach(async () => {
    // Create temp database
    dbPath = path.join(os.tmpdir(), `test-cached-storage-${Date.now()}.db`);
    db = new SQLiteManager({ dbPath });
    storage = new ConversationStorage(db);

    // Create test data - store in order of dependencies
    const conversations: Conversation[] = [
      {
        id: "conv1",
        project_path: "/test/project",
        first_message_at: 1000,
        last_message_at: 2000,
        message_count: 10,
        git_branch: "main",
        claude_version: "3.5",
        metadata: {},
        created_at: 1000,
        updated_at: 2000,
      },
    ];

    // Store conversations first (foreign key dependency for messages)
    await storage.storeConversations(conversations);

    // Now store messages (foreign key dependency for file_edits)
    const messages: Message[] = [
      {
        id: "msg1",
        conversation_id: "conv1",
        message_type: "text",
        role: "user",
        content: "test message",
        timestamp: 1400,
        is_sidechain: false,
        metadata: {},
      },
    ];
    await storage.storeMessages(messages);

    const fileEdits: FileEdit[] = [
      {
        id: "edit1",
        conversation_id: "conv1",
        message_id: "msg1",
        file_path: "/test/file.ts",
        snapshot_timestamp: 1500,
        metadata: {},
      },
    ];

    const decisions: Decision[] = [
      {
        id: "dec1",
        conversation_id: "conv1",
        message_id: "msg1",
        decision_text: "Use TypeScript",
        rationale: "Better type safety",
        alternatives_considered: ["JavaScript"],
        rejected_reasons: { JavaScript: "No types" },
        context: "language",
        related_files: ["/test/file.ts"],
        related_commits: [],
        timestamp: 1500,
      },
    ];

    const commits: GitCommit[] = [
      {
        hash: "abc123",
        message: "Initial commit",
        author: "Test User",
        timestamp: 1600,
        files_changed: ["/test/file.ts"],
        conversation_id: "conv1",
        metadata: {},
      },
    ];

    // Note: conversations already stored above
    await storage.storeFileEdits(fileEdits);
    await storage.storeDecisions(decisions);
    await storage.storeGitCommits(commits);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  describe("Cache Integration", () => {
    it("should enable caching", () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });
      expect(storage.isCacheEnabled()).toBe(true);
    });

    it("should disable caching", () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });
      storage.disableCache();
      expect(storage.isCacheEnabled()).toBe(false);
    });

    it("should return cache statistics when enabled", () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });

      const stats = storage.getCacheStats();
      expect(stats).toBeDefined();
      expect(stats).not.toBeNull();
      if (stats) {
        expect(stats.size).toBe(0);
        expect(stats.maxSize).toBe(100);
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);
      }
    });

    it("should return null stats when caching disabled", () => {
      const stats = storage.getCacheStats();
      expect(stats).toBeNull();
    });
  });

  describe("Cached getConversation", () => {
    it("should cache conversation lookups", () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });

      // First call - cache miss
      const conv1 = storage.getConversation("conv1");
      expect(conv1).not.toBeNull();
      expect(conv1?.id).toBe("conv1");

      const stats1 = storage.getCacheStats();
      expect(stats1?.misses).toBe(1);
      expect(stats1?.hits).toBe(0);

      // Second call - cache hit
      const conv2 = storage.getConversation("conv1");
      expect(conv2).toEqual(conv1);

      const stats2 = storage.getCacheStats();
      expect(stats2?.misses).toBe(1);
      expect(stats2?.hits).toBe(1);
    });

    it("should work without cache", () => {
      // Cache disabled by default
      const conv = storage.getConversation("conv1");
      expect(conv).not.toBeNull();
      expect(conv?.id).toBe("conv1");

      const stats = storage.getCacheStats();
      expect(stats).toBeNull();
    });

    it("should invalidate cache on update", async () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });

      // Cache the conversation
      const conv1 = storage.getConversation("conv1");
      expect(conv1?.message_count).toBe(10);

      // Update conversation
      await storage.storeConversations([
        {
          id: "conv1",
          project_path: "/test/project",
          first_message_at: 1000,
          last_message_at: 3000,
          message_count: 20, // Changed
          git_branch: "main",
          claude_version: "3.5",
          metadata: {},
          created_at: 1000,
          updated_at: 3000,
        },
      ]);

      // Should get fresh data
      const conv2 = storage.getConversation("conv1");
      expect(conv2?.message_count).toBe(20);
    });
  });

  describe("Cached getFileTimeline", () => {
    it("should cache file timeline queries", () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });

      // First call - cache miss (timeline + edits + decisions + commits = 4 misses)
      const timeline1 = storage.getFileTimeline("/test/file.ts");
      expect(timeline1.edits.length).toBe(1);
      expect(timeline1.decisions.length).toBe(1);
      expect(timeline1.commits.length).toBe(1);

      const stats1 = storage.getCacheStats();
      expect(stats1?.misses).toBe(4); // timeline, edits, decisions, commits all miss

      // Second call - cache hit
      const timeline2 = storage.getFileTimeline("/test/file.ts");
      expect(timeline2).toEqual(timeline1);

      const stats2 = storage.getCacheStats();
      expect(stats2?.hits).toBe(1);
    });

    it("should invalidate timeline cache on file edit", async () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });

      // Cache the timeline
      const timeline1 = storage.getFileTimeline("/test/file.ts");
      expect(timeline1.edits.length).toBe(1);

      // Add message for new edit
      await storage.storeMessages([
        {
          id: "msg2",
          conversation_id: "conv1",
          message_type: "text",
          role: "assistant",
          content: "edited file",
          timestamp: 1650,
          is_sidechain: false,
          metadata: {},
        },
      ]);

      // Add new file edit
      await storage.storeFileEdits([
        {
          id: "edit2",
          conversation_id: "conv1",
          message_id: "msg2",
          file_path: "/test/file.ts",
          snapshot_timestamp: 1700,
          metadata: {},
        },
      ]);

      // Should get fresh data
      const timeline2 = storage.getFileTimeline("/test/file.ts");
      expect(timeline2.edits.length).toBe(2);
    });
  });

  describe("Cached getFileEdits", () => {
    it("should cache file edits queries", () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });

      // First call - cache miss
      const edits1 = storage.getFileEdits("/test/file.ts");
      expect(edits1.length).toBe(1);

      const stats1 = storage.getCacheStats();
      expect(stats1?.misses).toBe(1);

      // Second call - cache hit
      const edits2 = storage.getFileEdits("/test/file.ts");
      expect(edits2).toEqual(edits1);

      const stats2 = storage.getCacheStats();
      expect(stats2?.hits).toBe(1);
    });
  });

  describe("Cached getDecisionsForFile", () => {
    it("should cache decisions for file queries", () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });

      // First call - cache miss
      const decisions1 = storage.getDecisionsForFile("/test/file.ts");
      expect(decisions1.length).toBe(1);

      // Second call - cache hit
      const decisions2 = storage.getDecisionsForFile("/test/file.ts");
      expect(decisions2).toEqual(decisions1);

      const stats = storage.getCacheStats();
      expect(stats?.hits).toBe(1);
      expect(stats?.misses).toBe(1);
    });
  });

  describe("Cached getCommitsForFile", () => {
    it("should cache commits for file queries", () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });

      // First call - cache miss
      const commits1 = storage.getCommitsForFile("/test/file.ts");
      expect(commits1.length).toBe(1);

      // Second call - cache hit
      const commits2 = storage.getCommitsForFile("/test/file.ts");
      expect(commits2).toEqual(commits1);

      const stats = storage.getCacheStats();
      expect(stats?.hits).toBe(1);
      expect(stats?.misses).toBe(1);
    });
  });

  describe("Cache Performance", () => {
    it("should improve performance on repeated queries", () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });

      // Warm up cache
      for (let i = 0; i < 10; i++) {
        storage.getConversation("conv1");
        storage.getFileTimeline("/test/file.ts");
      }

      const stats = storage.getCacheStats();
      // First call of each method results in misses (conv + timeline with its 3 sub-calls = 5 misses)
      // Next 9 calls each = 18 hits (both methods cached)
      expect(stats?.misses).toBe(5); // conversation (1) + timeline (4: timeline, edits, decisions, commits)
      expect(stats?.hits).toBe(18);
      expect(stats?.hitRate).toBeCloseTo(0.78, 1); // 18 / (18 + 5) = 0.78
    });

    it("should respect cache size limits", () => {
      storage.enableCache({ maxSize: 2, ttlMs: 60000 });

      // Fill cache beyond capacity
      storage.getConversation("conv1"); // Entry 1
      storage.getFileTimeline("/test/file.ts"); // Entry 2
      storage.getFileEdits("/test/file.ts"); // Entry 3, evicts entry 1

      const stats = storage.getCacheStats();
      expect(stats?.size).toBeLessThanOrEqual(2);
      expect(stats?.evictions).toBeGreaterThan(0);
    });
  });

  describe("Cache Invalidation", () => {
    it("should invalidate all related caches on storeConversations", async () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });

      // Cache some queries
      storage.getConversation("conv1");

      // Update conversation
      await storage.storeConversations([
        {
          id: "conv1",
          project_path: "/test/project",
          first_message_at: 1000,
          last_message_at: 4000,
          message_count: 30,
          git_branch: "main",
          claude_version: "3.5",
          metadata: {},
          created_at: 1000,
          updated_at: 4000,
        },
      ]);

      // Next query should fetch fresh data
      const conv = storage.getConversation("conv1");
      expect(conv?.message_count).toBe(30);
    });

    it("should clear cache on clearCache call", () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });

      // Cache some queries
      storage.getConversation("conv1");
      storage.getFileTimeline("/test/file.ts");

      const stats1 = storage.getCacheStats();
      expect(stats1?.size).toBeGreaterThan(0);

      // Clear cache
      storage.clearCache();

      const stats2 = storage.getCacheStats();
      expect(stats2?.size).toBe(0);
      expect(stats2?.hits).toBe(0); // Stats should be reset too
    });
  });

  describe("Cache Configuration", () => {
    it("should allow reconfiguring cache", () => {
      storage.enableCache({ maxSize: 10, ttlMs: 1000 });

      let stats = storage.getCacheStats();
      expect(stats?.maxSize).toBe(10);

      // Reconfigure
      storage.enableCache({ maxSize: 50, ttlMs: 5000 });

      stats = storage.getCacheStats();
      expect(stats?.maxSize).toBe(50);
    });

    it("should clear cache on reconfigure (new behavior)", () => {
      storage.enableCache({ maxSize: 100, ttlMs: 60000 });

      // Cache a query
      storage.getConversation("conv1");

      const stats1 = storage.getCacheStats();
      expect(stats1?.size).toBe(1);

      // Reconfigure - creates new cache instance (clears old entries)
      storage.enableCache({ maxSize: 100, ttlMs: 30000 });

      const stats2 = storage.getCacheStats();
      expect(stats2?.size).toBe(0); // New cache is empty

      // Next access will miss and repopulate cache
      storage.getConversation("conv1");
      const stats3 = storage.getCacheStats();
      expect(stats3?.misses).toBe(1);
      expect(stats3?.size).toBe(1);
    });
  });
});
