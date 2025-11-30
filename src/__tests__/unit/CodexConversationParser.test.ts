/**
 * Unit tests for CodexConversationParser
 */

import { CodexConversationParser } from "../../parsers/CodexConversationParser.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("CodexConversationParser", () => {
  let testCodexPath: string;
  let parser: CodexConversationParser;

  beforeEach(() => {
    // Create temporary directory for test
    testCodexPath = join(tmpdir(), `codex-test-${Date.now()}`);
    mkdirSync(testCodexPath, { recursive: true });
    parser = new CodexConversationParser();
  });

  afterEach(() => {
    // Cleanup temporary directory
    if (existsSync(testCodexPath)) {
      rmSync(testCodexPath, { recursive: true, force: true });
    }
  });

  describe("parseSession", () => {
    it("should throw error if sessions directory does not exist", () => {
      expect(() => parser.parseSession("/nonexistent/path")).toThrow(
        "Codex sessions directory not found"
      );
    });

    it("should return empty result for empty sessions directory", () => {
      const sessionsDir = join(testCodexPath, "sessions");
      mkdirSync(sessionsDir, { recursive: true });

      const result = parser.parseSession(testCodexPath);

      expect(result.conversations).toHaveLength(0);
      expect(result.messages).toHaveLength(0);
      expect(result.tool_uses).toHaveLength(0);
      expect(result.tool_results).toHaveLength(0);
    });

    it("should parse a simple Codex session file", () => {
      // Create session directory structure: sessions/2025/01/17/
      const sessionDir = join(testCodexPath, "sessions", "2025", "01", "17");
      mkdirSync(sessionDir, { recursive: true });

      // Create a session file with UUID format matching real Codex files
      const sessionId = "00000001-0000-0000-0000-000000000001";
      const sessionFile = join(sessionDir, `rollout-2025-01-17T10-00-00-${sessionId}.jsonl`);

      const sessionMeta = {
        timestamp: "2025-01-17T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          cwd: "/test/project",
          originator: "cli",
          cli_version: "1.0.0",
          model_provider: "anthropic",
          git: {
            branch: "main",
            commit_hash: "abc123",
            repository_url: "https://github.com/test/repo",
          },
        },
      };

      const userMessage = {
        timestamp: "2025-01-17T10:00:01.000Z",
        type: "response_item",
        payload: {
          id: "msg-1",
          role: "user",
          content: "Hello, how are you?",
        },
      };

      const assistantMessage = {
        timestamp: "2025-01-17T10:00:02.000Z",
        type: "response_item",
        payload: {
          id: "msg-2",
          role: "assistant",
          content: [
            {
              type: "text",
              text: "I am doing well!",
            },
          ],
        },
      };

      const sessionContent = [sessionMeta, userMessage, assistantMessage]
        .map((entry) => JSON.stringify(entry))
        .join("\n");

      writeFileSync(sessionFile, sessionContent);

      // Parse the session
      const result = parser.parseSession(testCodexPath);

      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].id).toBe(sessionId);
      expect(result.conversations[0].project_path).toBe("/test/project");
      expect(result.conversations[0].source_type).toBe("codex");
      expect(result.conversations[0].git_branch).toBe("main");
      expect(result.conversations[0].message_count).toBe(2);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content).toBe("Hello, how are you?");
      expect(result.messages[1].role).toBe("assistant");
    });

    it("should extract tool uses from assistant messages", () => {
      const sessionDir = join(testCodexPath, "sessions", "2025", "01", "17");
      mkdirSync(sessionDir, { recursive: true });

      const sessionId = "00000002-0000-0000-0000-000000000002";
      const sessionFile = join(sessionDir, `rollout-2025-01-17T10-00-00-${sessionId}.jsonl`);

      const sessionMeta = {
        timestamp: "2025-01-17T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          cwd: "/test/project",
        },
      };

      const toolUseMessage = {
        timestamp: "2025-01-17T10:00:01.000Z",
        type: "response_item",
        payload: {
          id: "msg-1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "bash",
              input: {
                command: "ls -la",
              },
            },
          ],
        },
      };

      const toolResultMessage = {
        timestamp: "2025-01-17T10:00:02.000Z",
        type: "response_item",
        payload: {
          id: "msg-2",
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "file1.txt\nfile2.txt",
              stdout: "file1.txt\nfile2.txt",
            },
          ],
        },
      };

      const sessionContent = [sessionMeta, toolUseMessage, toolResultMessage]
        .map((entry) => JSON.stringify(entry))
        .join("\n");

      writeFileSync(sessionFile, sessionContent);

      const result = parser.parseSession(testCodexPath);

      expect(result.tool_uses).toHaveLength(1);
      expect(result.tool_uses[0].tool_name).toBe("bash");
      expect(result.tool_uses[0].tool_input).toEqual({ command: "ls -la" });

      expect(result.tool_results).toHaveLength(1);
      expect(result.tool_results[0].tool_use_id).toBe("tool-1");
      expect(result.tool_results[0].content).toBe("file1.txt\nfile2.txt");
      expect(result.tool_results[0].stdout).toBe("file1.txt\nfile2.txt");
    });

    it("should extract thinking blocks", () => {
      const sessionDir = join(testCodexPath, "sessions", "2025", "01", "17");
      mkdirSync(sessionDir, { recursive: true });

      const sessionId = "00000003-0000-0000-0000-000000000003";
      const sessionFile = join(sessionDir, `rollout-2025-01-17T10-00-00-${sessionId}.jsonl`);

      const sessionMeta = {
        timestamp: "2025-01-17T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          cwd: "/test/project",
        },
      };

      const thinkingMessage = {
        timestamp: "2025-01-17T10:00:01.000Z",
        type: "response_item",
        payload: {
          id: "msg-1",
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Let me analyze this problem...",
              signature: "sha256:abc123",
            },
            {
              type: "text",
              text: "Based on my analysis...",
            },
          ],
        },
      };

      const sessionContent = [sessionMeta, thinkingMessage]
        .map((entry) => JSON.stringify(entry))
        .join("\n");

      writeFileSync(sessionFile, sessionContent);

      const result = parser.parseSession(testCodexPath);

      expect(result.thinking_blocks).toHaveLength(1);
      expect(result.thinking_blocks[0].thinking_content).toBe("Let me analyze this problem...");
      expect(result.thinking_blocks[0].signature).toBe("sha256:abc123");
    });

    it("should filter by session ID", () => {
      const sessionDir = join(testCodexPath, "sessions", "2025", "01", "17");
      mkdirSync(sessionDir, { recursive: true });

      // Create two session files with UUID format
      const sessionId1 = "00000004-0000-0000-0000-000000000001";
      const sessionId2 = "00000004-0000-0000-0000-000000000002";

      for (const sessionId of [sessionId1, sessionId2]) {
        const sessionFile = join(sessionDir, `rollout-2025-01-17T10-00-00-${sessionId}.jsonl`);
        const sessionMeta = {
          timestamp: "2025-01-17T10:00:00.000Z",
          type: "session_meta",
          payload: {
            id: sessionId,
            timestamp: "2025-01-17T10:00:00.000Z",
            cwd: "/test/project",
          },
        };
        writeFileSync(sessionFile, JSON.stringify(sessionMeta));
      }

      // Parse only session-1
      const result = parser.parseSession(testCodexPath, sessionId1);

      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].id).toBe(sessionId1);
    });

    it("should handle malformed JSONL lines gracefully", () => {
      const sessionDir = join(testCodexPath, "sessions", "2025", "01", "17");
      mkdirSync(sessionDir, { recursive: true });

      const sessionId = "00000005-0000-0000-0000-000000000005";
      const sessionFile = join(sessionDir, `rollout-2025-01-17T10-00-00-${sessionId}.jsonl`);

      const sessionMeta = {
        timestamp: "2025-01-17T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          cwd: "/test/project",
        },
      };

      // Include a malformed line
      const sessionContent = [
        JSON.stringify(sessionMeta),
        "{ invalid json",
        JSON.stringify({
          timestamp: "2025-01-17T10:00:01.000Z",
          type: "response_item",
          payload: {
            id: "msg-1",
            role: "user",
            content: "Hello",
          },
        }),
      ].join("\n");

      writeFileSync(sessionFile, sessionContent);

      const result = parser.parseSession(testCodexPath);

      // Should parse session and valid message, skip malformed line
      expect(result.conversations).toHaveLength(1);
      expect(result.messages).toHaveLength(1);
    });

    it("should handle empty session files", () => {
      const sessionDir = join(testCodexPath, "sessions", "2025", "01", "17");
      mkdirSync(sessionDir, { recursive: true });

      const sessionFile = join(sessionDir, "rollout-2025-01-17T10-00-00-00000006-0000-0000-0000-000000000006.jsonl");
      writeFileSync(sessionFile, "");

      const result = parser.parseSession(testCodexPath);

      expect(result.conversations).toHaveLength(0);
      expect(result.messages).toHaveLength(0);
    });

    it("should skip files without session_meta", () => {
      const sessionDir = join(testCodexPath, "sessions", "2025", "01", "17");
      mkdirSync(sessionDir, { recursive: true });

      const sessionFile = join(sessionDir, "rollout-2025-01-17T10-00-00-00000007-0000-0000-0000-000000000007.jsonl");
      const messageOnly = {
        timestamp: "2025-01-17T10:00:01.000Z",
        type: "response_item",
        payload: {
          id: "msg-1",
          role: "user",
          content: "Hello",
        },
      };

      writeFileSync(sessionFile, JSON.stringify(messageOnly));

      const result = parser.parseSession(testCodexPath);

      // Should skip session without metadata
      expect(result.conversations).toHaveLength(0);
      expect(result.messages).toHaveLength(0);
    });
  });
});
