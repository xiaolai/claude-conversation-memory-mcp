/**
 * Unit tests for GlobalIndex
 */

import { GlobalIndex } from "../../storage/GlobalIndex.js";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("GlobalIndex", () => {
  let testDbPath: string;
  let globalIndex: GlobalIndex;

  beforeEach(() => {
    // Use temporary database path for tests
    testDbPath = join(tmpdir(), `global-index-test-${Date.now()}.db`);
    globalIndex = new GlobalIndex(testDbPath);
  });

  afterEach(() => {
    // Cleanup
    globalIndex.close();
    if (existsSync(testDbPath)) {
      rmSync(testDbPath, { force: true });
    }
    // Also remove WAL files
    if (existsSync(`${testDbPath}-wal`)) {
      rmSync(`${testDbPath}-wal`, { force: true });
    }
    if (existsSync(`${testDbPath}-shm`)) {
      rmSync(`${testDbPath}-shm`, { force: true });
    }
  });

  describe("registerProject", () => {
    it("should register a new Claude Code project", () => {
      const project = globalIndex.registerProject({
        project_path: "/test/project",
        source_type: "claude-code",
        db_path: "/test/project/.cccmemory.db",
        message_count: 100,
        conversation_count: 10,
        decision_count: 5,
        mistake_count: 2,
      });

      expect(project.project_path).toBe("/test/project");
      expect(project.source_type).toBe("claude-code");
      expect(project.message_count).toBe(100);
      expect(project.conversation_count).toBe(10);
    });

    it("should register a Codex project", () => {
      const project = globalIndex.registerProject({
        project_path: "/home/user/.codex",
        source_type: "codex",
        db_path: "/home/user/.codex/.cccmemory.db",
        message_count: 200,
        conversation_count: 20,
        decision_count: 15,
        mistake_count: 3,
      });

      expect(project.source_type).toBe("codex");
      expect(project.message_count).toBe(200);
    });

    it("should update existing project on re-registration", () => {
      // Register first time
      globalIndex.registerProject({
        project_path: "/test/project",
        source_type: "claude-code",
        db_path: "/test/project/.db",
        message_count: 100,
        conversation_count: 10,
        decision_count: 5,
        mistake_count: 2,
      });

      // Update with new counts
      const updated = globalIndex.registerProject({
        project_path: "/test/project",
        source_type: "claude-code",
        db_path: "/test/project/.db",
        message_count: 150,
        conversation_count: 15,
        decision_count: 8,
        mistake_count: 3,
      });

      expect(updated.message_count).toBe(150);
      expect(updated.conversation_count).toBe(15);

      // Verify only one project exists
      const projects = globalIndex.getAllProjects();
      expect(projects).toHaveLength(1);
    });

    it("should store and retrieve metadata", () => {
      const metadata = {
        indexed_folders: ["folder1", "folder2"],
        custom_field: "value",
      };

      const project = globalIndex.registerProject({
        project_path: "/test/project",
        source_type: "claude-code",
        db_path: "/test/project/.db",
        message_count: 100,
        conversation_count: 10,
        decision_count: 5,
        mistake_count: 2,
        metadata,
      });

      expect(project.metadata).toEqual(metadata);
    });
  });

  describe("getAllProjects", () => {
    beforeEach(() => {
      // Register multiple projects
      globalIndex.registerProject({
        project_path: "/test/project1",
        source_type: "claude-code",
        db_path: "/test/project1/.db",
        message_count: 100,
        conversation_count: 10,
        decision_count: 5,
        mistake_count: 2,
      });

      globalIndex.registerProject({
        project_path: "/test/project2",
        source_type: "claude-code",
        db_path: "/test/project2/.db",
        message_count: 200,
        conversation_count: 20,
        decision_count: 10,
        mistake_count: 4,
      });

      globalIndex.registerProject({
        project_path: "/home/user/.codex",
        source_type: "codex",
        db_path: "/home/user/.codex/.db",
        message_count: 300,
        conversation_count: 30,
        decision_count: 15,
        mistake_count: 6,
      });
    });

    it("should return all projects when no filter", () => {
      const projects = globalIndex.getAllProjects();
      expect(projects).toHaveLength(3);
    });

    it("should filter Claude Code projects", () => {
      const projects = globalIndex.getAllProjects("claude-code");
      expect(projects).toHaveLength(2);
      expect(projects.every((p) => p.source_type === "claude-code")).toBe(true);
    });

    it("should filter Codex projects", () => {
      const projects = globalIndex.getAllProjects("codex");
      expect(projects).toHaveLength(1);
      expect(projects[0].source_type).toBe("codex");
      expect(projects[0].project_path).toBe("/home/user/.codex");
    });
  });

  describe("getProject", () => {
    beforeEach(() => {
      globalIndex.registerProject({
        project_path: "/test/project",
        source_type: "claude-code",
        db_path: "/test/project/.db",
        message_count: 100,
        conversation_count: 10,
        decision_count: 5,
        mistake_count: 2,
      });
    });

    it("should retrieve project by path", () => {
      const project = globalIndex.getProject("/test/project");
      expect(project).toBeDefined();
      expect(project?.project_path).toBe("/test/project");
    });

    it("should return null for non-existent project", () => {
      const project = globalIndex.getProject("/nonexistent");
      expect(project).toBeNull();
    });
  });

  describe("getGlobalStats", () => {
    it("should return zero stats for empty index", () => {
      const stats = globalIndex.getGlobalStats();
      expect(stats.total_projects).toBe(0);
      expect(stats.claude_code_projects).toBe(0);
      expect(stats.codex_projects).toBe(0);
      expect(stats.total_messages).toBe(0);
      expect(stats.total_conversations).toBe(0);
    });

    it("should aggregate stats correctly", () => {
      globalIndex.registerProject({
        project_path: "/test/project1",
        source_type: "claude-code",
        db_path: "/test/project1/.db",
        message_count: 100,
        conversation_count: 10,
        decision_count: 5,
        mistake_count: 2,
      });

      globalIndex.registerProject({
        project_path: "/test/project2",
        source_type: "claude-code",
        db_path: "/test/project2/.db",
        message_count: 200,
        conversation_count: 20,
        decision_count: 10,
        mistake_count: 4,
      });

      globalIndex.registerProject({
        project_path: "/home/user/.codex",
        source_type: "codex",
        db_path: "/home/user/.codex/.db",
        message_count: 300,
        conversation_count: 30,
        decision_count: 15,
        mistake_count: 6,
      });

      const stats = globalIndex.getGlobalStats();
      expect(stats.total_projects).toBe(3);
      expect(stats.claude_code_projects).toBe(2);
      expect(stats.codex_projects).toBe(1);
      expect(stats.total_messages).toBe(600);
      expect(stats.total_conversations).toBe(60);
      expect(stats.total_decisions).toBe(30);
      expect(stats.total_mistakes).toBe(12);
    });
  });

  describe("removeProject", () => {
    beforeEach(() => {
      globalIndex.registerProject({
        project_path: "/test/project",
        source_type: "claude-code",
        db_path: "/test/project/.db",
        message_count: 100,
        conversation_count: 10,
        decision_count: 5,
        mistake_count: 2,
      });
    });

    it("should remove project successfully", () => {
      const removed = globalIndex.removeProject("/test/project");
      expect(removed).toBe(true);

      const project = globalIndex.getProject("/test/project");
      expect(project).toBeNull();
    });

    it("should return false for non-existent project", () => {
      const removed = globalIndex.removeProject("/nonexistent");
      expect(removed).toBe(false);
    });
  });

  describe("getDbPath", () => {
    it("should return the database path", () => {
      const path = globalIndex.getDbPath();
      expect(path).toBe(testDbPath);
    });
  });

  describe("close", () => {
    it("should close database connection", () => {
      // Should not throw
      expect(() => globalIndex.close()).not.toThrow();

      // After close, operations should fail or create new instance
      // This is a basic test - in real usage, accessing after close would error
    });
  });

  describe("database persistence", () => {
    it("should persist data across instances", () => {
      // Register project with first instance
      globalIndex.registerProject({
        project_path: "/test/project",
        source_type: "claude-code",
        db_path: "/test/project/.db",
        message_count: 100,
        conversation_count: 10,
        decision_count: 5,
        mistake_count: 2,
      });

      globalIndex.close();

      // Create new instance with same path
      const newIndex = new GlobalIndex(testDbPath);

      const project = newIndex.getProject("/test/project");
      expect(project).toBeDefined();
      expect(project?.message_count).toBe(100);

      newIndex.close();
    });
  });
});
