/**
 * Unit tests for ConversationParser with streaming support
 */

import { ConversationParser } from "../../parsers/ConversationParser.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("ConversationParser", () => {
  let testProjectPath: string;
  let testClaudePath: string;
  let parser: ConversationParser;

  beforeEach(() => {
    // Create temporary directories for test
    const timestamp = Date.now();
    testProjectPath = join(tmpdir(), `test-project-${timestamp}`);
    testClaudePath = join(tmpdir(), `.claude-test-${timestamp}`);
    mkdirSync(testProjectPath, { recursive: true });
    mkdirSync(testClaudePath, { recursive: true });
    parser = new ConversationParser();
  });

  afterEach(() => {
    // Cleanup temporary directories
    for (const path of [testProjectPath, testClaudePath]) {
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true });
      }
    }
  });

  describe("parseFromFolder", () => {
    it("should return empty result for non-existent folder", () => {
      const result = parser.parseFromFolder("/nonexistent/path");
      expect(result.conversations).toHaveLength(0);
      expect(result.messages).toHaveLength(0);
    });

    it("should return empty result for folder without JSONL files", () => {
      const result = parser.parseFromFolder(testClaudePath);
      expect(result.conversations).toHaveLength(0);
      expect(result.messages).toHaveLength(0);
    });

    it("should parse a simple conversation file", () => {
      const sessionId = "test-session-001";
      const sessionFile = join(testClaudePath, `${sessionId}.jsonl`);

      const messages = [
        {
          type: "user",
          uuid: "msg-001",
          sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          message: { role: "user", content: "Hello, Claude!" },
        },
        {
          type: "assistant",
          uuid: "msg-002",
          parentUuid: "msg-001",
          sessionId,
          timestamp: "2025-01-17T10:00:01.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Hello! How can I help?" }],
          },
        },
      ];

      writeFileSync(
        sessionFile,
        messages.map((m) => JSON.stringify(m)).join("\n")
      );

      const result = parser.parseFromFolder(testClaudePath, testProjectPath);

      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].id).toBe(sessionId);
      expect(result.conversations[0].project_path).toBe(testProjectPath);
      expect(result.conversations[0].message_count).toBe(2);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content).toBe("Hello, Claude!");
      expect(result.messages[1].role).toBe("assistant");
      expect(result.messages[1].content).toBe("Hello! How can I help?");
    });

    it("should extract tool uses and results", () => {
      const sessionId = "test-session-tools";
      const sessionFile = join(testClaudePath, `${sessionId}.jsonl`);

      const messages = [
        {
          type: "user",
          uuid: "msg-001",
          sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          message: { role: "user", content: "List files" },
        },
        {
          type: "assistant",
          uuid: "msg-002",
          sessionId,
          timestamp: "2025-01-17T10:00:01.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-001",
                name: "bash",
                input: { command: "ls -la" },
              },
            ],
          },
        },
        {
          type: "user",
          uuid: "msg-003",
          sessionId,
          timestamp: "2025-01-17T10:00:02.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-001",
                content: "file1.txt\nfile2.txt",
              },
            ],
          },
          toolUseResult: {
            stdout: "file1.txt\nfile2.txt",
          },
        },
      ];

      writeFileSync(
        sessionFile,
        messages.map((m) => JSON.stringify(m)).join("\n")
      );

      const result = parser.parseFromFolder(testClaudePath);

      expect(result.tool_uses).toHaveLength(1);
      expect(result.tool_uses[0].tool_name).toBe("bash");
      expect(result.tool_uses[0].tool_input).toEqual({ command: "ls -la" });

      expect(result.tool_results).toHaveLength(1);
      expect(result.tool_results[0].tool_use_id).toBe("tool-001");
      expect(result.tool_results[0].stdout).toBe("file1.txt\nfile2.txt");
    });

    it("should extract thinking blocks", () => {
      const sessionId = "test-session-thinking";
      const sessionFile = join(testClaudePath, `${sessionId}.jsonl`);

      const messages = [
        {
          type: "user",
          uuid: "msg-001",
          sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          message: { role: "user", content: "Analyze this" },
        },
        {
          type: "assistant",
          uuid: "msg-002",
          sessionId,
          timestamp: "2025-01-17T10:00:01.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "Let me analyze this step by step...",
                signature: "sha256:abc123",
              },
              { type: "text", text: "Here is my analysis." },
            ],
          },
        },
      ];

      writeFileSync(
        sessionFile,
        messages.map((m) => JSON.stringify(m)).join("\n")
      );

      const result = parser.parseFromFolder(testClaudePath);

      expect(result.thinking_blocks).toHaveLength(1);
      expect(result.thinking_blocks[0].thinking_content).toBe(
        "Let me analyze this step by step..."
      );
      expect(result.thinking_blocks[0].signature).toBe("sha256:abc123");
    });

    it("should handle malformed JSONL lines gracefully", () => {
      const sessionId = "test-session-errors";
      const sessionFile = join(testClaudePath, `${sessionId}.jsonl`);

      const content = [
        JSON.stringify({
          type: "user",
          uuid: "msg-001",
          sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          message: { role: "user", content: "Hello" },
        }),
        "{ invalid json line",
        JSON.stringify({
          type: "assistant",
          uuid: "msg-002",
          sessionId,
          timestamp: "2025-01-17T10:00:01.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "Hi!" }] },
        }),
      ].join("\n");

      writeFileSync(sessionFile, content);

      const result = parser.parseFromFolder(testClaudePath);

      // Should parse valid messages and track error
      expect(result.conversations).toHaveLength(1);
      expect(result.messages).toHaveLength(2);
      expect(result.parse_errors).toBeDefined();
      expect(result.parse_errors).toHaveLength(1);
      expect(result.parse_errors![0].line).toBe(2);
      // Error message format varies by Node version
      expect(result.parse_errors![0].error).toMatch(/JSON|token|parse/i);
    });

    it("should skip unchanged files in incremental mode", async () => {
      const sessionId = "test-session-incremental";
      const sessionFile = join(testClaudePath, `${sessionId}.jsonl`);

      const messages = [
        {
          type: "user",
          uuid: "msg-001",
          sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          message: { role: "user", content: "Hello" },
        },
      ];

      writeFileSync(
        sessionFile,
        messages.map((m) => JSON.stringify(m)).join("\n")
      );

      // First parse (no lastIndexedMs)
      const result1 = parser.parseFromFolder(testClaudePath);
      expect(result1.conversations).toHaveLength(1);

      // Second parse with lastIndexedMs in the future
      const futureTime = Date.now() + 100000;
      const result2 = parser.parseFromFolder(testClaudePath, undefined, futureTime);
      expect(result2.conversations).toHaveLength(0);
    });

    it("should handle empty JSONL files", () => {
      const sessionFile = join(testClaudePath, "empty-session.jsonl");
      writeFileSync(sessionFile, "");

      const result = parser.parseFromFolder(testClaudePath);

      expect(result.conversations).toHaveLength(0);
      expect(result.messages).toHaveLength(0);
    });

    it("should handle files with only whitespace lines", () => {
      const sessionFile = join(testClaudePath, "whitespace-session.jsonl");
      writeFileSync(sessionFile, "   \n\n   \n");

      const result = parser.parseFromFolder(testClaudePath);

      expect(result.conversations).toHaveLength(0);
      expect(result.messages).toHaveLength(0);
    });

    it("should parse multiple conversation files", () => {
      for (let i = 1; i <= 3; i++) {
        const sessionId = `multi-session-${i}`;
        const sessionFile = join(testClaudePath, `${sessionId}.jsonl`);
        const msg = {
          type: "user",
          uuid: `msg-${i}`,
          sessionId,
          timestamp: `2025-01-17T10:0${i}:00.000Z`,
          message: { role: "user", content: `Message ${i}` },
        };
        writeFileSync(sessionFile, JSON.stringify(msg));
      }

      const result = parser.parseFromFolder(testClaudePath);

      expect(result.conversations).toHaveLength(3);
      expect(result.messages).toHaveLength(3);
    });

    it("should detect MCP tool usage", () => {
      const sessionId = "test-session-mcp";
      const sessionFile = join(testClaudePath, `${sessionId}.jsonl`);

      const messages = [
        {
          type: "user",
          uuid: "msg-001",
          sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          message: { role: "user", content: "Search conversations" },
        },
        {
          type: "assistant",
          uuid: "msg-002",
          sessionId,
          timestamp: "2025-01-17T10:00:01.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-001",
                name: "mcp__cccmemory__search_conversations",
                input: { query: "test" },
              },
            ],
          },
        },
      ];

      writeFileSync(
        sessionFile,
        messages.map((m) => JSON.stringify(m)).join("\n")
      );

      const result = parser.parseFromFolder(testClaudePath);

      expect(result.conversations).toHaveLength(1);
      const metadata = result.conversations[0].metadata as {
        mcp_usage?: { detected: boolean; servers: string[] };
      };
      expect(metadata.mcp_usage?.detected).toBe(true);
      expect(metadata.mcp_usage?.servers).toContain("cccmemory");
    });

    it("should filter NaN timestamps", () => {
      const sessionId = "test-session-nan-timestamps";
      const sessionFile = join(testClaudePath, `${sessionId}.jsonl`);

      const messages = [
        {
          type: "user",
          uuid: "msg-001",
          sessionId,
          timestamp: "invalid-date",
          message: { role: "user", content: "Message with bad timestamp" },
        },
        {
          type: "assistant",
          uuid: "msg-002",
          sessionId,
          timestamp: "2025-01-17T10:00:01.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Valid timestamp" }],
          },
        },
      ];

      writeFileSync(
        sessionFile,
        messages.map((m) => JSON.stringify(m)).join("\n")
      );

      const result = parser.parseFromFolder(testClaudePath);

      // Conversation should be created with valid timestamp
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].first_message_at).not.toBeNaN();
      expect(result.conversations[0].last_message_at).not.toBeNaN();
    });
  });

  describe("parseFromFolderAsync (streaming)", () => {
    it("should parse a conversation file using streaming", async () => {
      const sessionId = "test-async-session-001";
      const sessionFile = join(testClaudePath, `${sessionId}.jsonl`);

      const messages = [
        {
          type: "user",
          uuid: "async-msg-001",
          sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          message: { role: "user", content: "Hello from streaming!" },
        },
        {
          type: "assistant",
          uuid: "async-msg-002",
          parentUuid: "async-msg-001",
          sessionId,
          timestamp: "2025-01-17T10:00:01.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Streaming response!" }],
          },
        },
      ];

      writeFileSync(
        sessionFile,
        messages.map((m) => JSON.stringify(m)).join("\n")
      );

      const result = await parser.parseFromFolderAsync(testClaudePath, testProjectPath);

      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].id).toBe(sessionId);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe("Hello from streaming!");
    });

    it("should handle large files efficiently with streaming", async () => {
      const sessionId = "test-large-file";
      const sessionFile = join(testClaudePath, `${sessionId}.jsonl`);

      // Create a file with many lines
      const lineCount = 1000;
      const lines: string[] = [];
      for (let i = 0; i < lineCount; i++) {
        lines.push(
          JSON.stringify({
            type: i % 2 === 0 ? "user" : "assistant",
            uuid: `msg-${i.toString().padStart(4, "0")}`,
            sessionId,
            timestamp: new Date(Date.now() + i * 1000).toISOString(),
            message: {
              role: i % 2 === 0 ? "user" : "assistant",
              content:
                i % 2 === 0
                  ? `User message ${i}`
                  : [{ type: "text", text: `Assistant response ${i}` }],
            },
          })
        );
      }

      writeFileSync(sessionFile, lines.join("\n"));

      const result = await parser.parseFromFolderAsync(testClaudePath);

      expect(result.conversations).toHaveLength(1);
      expect(result.messages).toHaveLength(lineCount);
      expect(result.conversations[0].message_count).toBe(lineCount);
    });

    it("should handle malformed lines gracefully with streaming", async () => {
      const sessionId = "test-async-errors";
      const sessionFile = join(testClaudePath, `${sessionId}.jsonl`);

      const content = [
        JSON.stringify({
          type: "user",
          uuid: "async-msg-001",
          sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          message: { role: "user", content: "Valid message" },
        }),
        "{ broken json",
        '{"also": broken',
        JSON.stringify({
          type: "assistant",
          uuid: "async-msg-002",
          sessionId,
          timestamp: "2025-01-17T10:00:01.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Another valid message" }],
          },
        }),
      ].join("\n");

      writeFileSync(sessionFile, content);

      const result = await parser.parseFromFolderAsync(testClaudePath);

      expect(result.conversations).toHaveLength(1);
      expect(result.messages).toHaveLength(2);
      expect(result.parse_errors).toBeDefined();
      expect(result.parse_errors!.length).toBe(2);
    });

    it("should skip unchanged files in incremental mode with streaming", async () => {
      const sessionId = "test-async-incremental";
      const sessionFile = join(testClaudePath, `${sessionId}.jsonl`);

      writeFileSync(
        sessionFile,
        JSON.stringify({
          type: "user",
          uuid: "msg-inc-001",
          sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          message: { role: "user", content: "Hello" },
        })
      );

      // Parse with future lastIndexedMs
      const futureTime = Date.now() + 100000;
      const result = await parser.parseFromFolderAsync(
        testClaudePath,
        undefined,
        futureTime
      );

      expect(result.conversations).toHaveLength(0);
      expect(result.messages).toHaveLength(0);
    });

    it("should produce same results as sync parseFromFolder", async () => {
      const sessionId = "test-sync-async-compare";
      const sessionFile = join(testClaudePath, `${sessionId}.jsonl`);

      const messages = [
        {
          type: "user",
          uuid: "cmp-msg-001",
          sessionId,
          timestamp: "2025-01-17T10:00:00.000Z",
          message: { role: "user", content: "Compare sync/async" },
        },
        {
          type: "assistant",
          uuid: "cmp-msg-002",
          sessionId,
          timestamp: "2025-01-17T10:00:01.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-cmp",
                name: "test_tool",
                input: { test: true },
              },
            ],
          },
        },
        {
          type: "user",
          uuid: "cmp-msg-003",
          sessionId,
          timestamp: "2025-01-17T10:00:02.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-cmp",
                content: "Result",
              },
            ],
          },
        },
      ];

      writeFileSync(
        sessionFile,
        messages.map((m) => JSON.stringify(m)).join("\n")
      );

      const syncResult = parser.parseFromFolder(testClaudePath, testProjectPath);
      const asyncResult = await parser.parseFromFolderAsync(
        testClaudePath,
        testProjectPath
      );

      // Compare key fields
      expect(asyncResult.conversations.length).toBe(syncResult.conversations.length);
      expect(asyncResult.messages.length).toBe(syncResult.messages.length);
      expect(asyncResult.tool_uses.length).toBe(syncResult.tool_uses.length);
      expect(asyncResult.tool_results.length).toBe(syncResult.tool_results.length);

      // Compare conversation details
      expect(asyncResult.conversations[0].id).toBe(syncResult.conversations[0].id);
      expect(asyncResult.conversations[0].message_count).toBe(
        syncResult.conversations[0].message_count
      );

      // Compare message content
      for (let i = 0; i < syncResult.messages.length; i++) {
        expect(asyncResult.messages[i].id).toBe(syncResult.messages[i].id);
        expect(asyncResult.messages[i].content).toBe(syncResult.messages[i].content);
      }
    });
  });
});
