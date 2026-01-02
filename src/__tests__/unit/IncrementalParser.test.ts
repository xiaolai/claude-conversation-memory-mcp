/**
 * Unit tests for IncrementalParser
 */

import { writeFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { IncrementalParser } from "../../realtime/IncrementalParser.js";

describe("IncrementalParser", () => {
  let parser: IncrementalParser;
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    parser = new IncrementalParser();
    testDir = join(tmpdir(), `parser-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    testFile = join(testDir, "test.jsonl");
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("parseNewContent", () => {
    it("should return empty array for non-existent file", () => {
      const messages = parser.parseNewContent("/nonexistent/file.jsonl");
      expect(messages).toEqual([]);
    });

    it("should parse a single user message", () => {
      const jsonl = JSON.stringify({
        type: "message",
        role: "user",
        content: "Hello, Claude!",
      });
      writeFileSync(testFile, jsonl + "\n");

      const messages = parser.parseNewContent(testFile);

      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe("user");
      expect(messages[0].content).toBe("Hello, Claude!");
    });

    it("should parse assistant message", () => {
      const jsonl = JSON.stringify({
        type: "message",
        role: "assistant",
        content: "Hello! How can I help?",
      });
      writeFileSync(testFile, jsonl + "\n");

      const messages = parser.parseNewContent(testFile);

      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe("assistant");
    });

    it("should parse content array format", () => {
      const jsonl = JSON.stringify({
        role: "assistant",
        content: [
          { type: "text", text: "First part." },
          { type: "text", text: "Second part." },
        ],
      });
      writeFileSync(testFile, jsonl + "\n");

      const messages = parser.parseNewContent(testFile);

      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe("First part.\nSecond part.");
    });

    it("should only return new lines on subsequent reads", () => {
      // First write
      writeFileSync(testFile, JSON.stringify({ role: "user", content: "First" }) + "\n");
      const firstRead = parser.parseNewContent(testFile);
      expect(firstRead.length).toBe(1);

      // Add more content
      writeFileSync(
        testFile,
        JSON.stringify({ role: "user", content: "First" }) +
          "\n" +
          JSON.stringify({ role: "assistant", content: "Second" }) +
          "\n"
      );

      const secondRead = parser.parseNewContent(testFile);
      expect(secondRead.length).toBe(1);
      expect(secondRead[0].content).toBe("Second");
    });

    it("should extract tool use information", () => {
      const jsonl = JSON.stringify({
        role: "assistant",
        content: [
          { type: "text", text: "Let me read that file." },
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: "/test/file.ts" },
          },
        ],
      });
      writeFileSync(testFile, jsonl + "\n");

      const messages = parser.parseNewContent(testFile);

      expect(messages.length).toBe(1);
      expect(messages[0].toolUse).toBeDefined();
      expect(messages[0].toolUse?.name).toBe("Read");
      expect(messages[0].toolUse?.input).toEqual({ file_path: "/test/file.ts" });
    });

    it("should skip invalid JSON lines", () => {
      writeFileSync(
        testFile,
        "invalid json\n" +
          JSON.stringify({ role: "user", content: "Valid" }) +
          "\n"
      );

      const messages = parser.parseNewContent(testFile);

      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe("Valid");
    });

    it("should handle empty files", () => {
      writeFileSync(testFile, "");
      const messages = parser.parseNewContent(testFile);
      expect(messages).toEqual([]);
    });

    it("should handle files with only whitespace lines", () => {
      writeFileSync(testFile, "  \n\n  \n");
      const messages = parser.parseNewContent(testFile);
      expect(messages).toEqual([]);
    });
  });

  describe("file tracking", () => {
    it("should track file info after parsing", () => {
      writeFileSync(testFile, JSON.stringify({ role: "user", content: "Test" }) + "\n");
      parser.parseNewContent(testFile);

      const fileInfo = parser.getFileInfo(testFile);

      expect(fileInfo).toBeDefined();
      expect(fileInfo?.path).toBe(testFile);
      expect(fileInfo?.lineCount).toBe(1);
    });

    it("should list all tracked files", () => {
      const file1 = join(testDir, "file1.jsonl");
      const file2 = join(testDir, "file2.jsonl");

      writeFileSync(file1, JSON.stringify({ role: "user", content: "Test1" }) + "\n");
      writeFileSync(file2, JSON.stringify({ role: "user", content: "Test2" }) + "\n");

      parser.parseNewContent(file1);
      parser.parseNewContent(file2);

      const tracked = parser.getTrackedFiles();

      expect(tracked).toContain(file1);
      expect(tracked).toContain(file2);
    });

    it("should reset file tracking", () => {
      writeFileSync(testFile, JSON.stringify({ role: "user", content: "Test" }) + "\n");
      parser.parseNewContent(testFile);

      parser.resetFile(testFile);

      expect(parser.getFileInfo(testFile)).toBeUndefined();
    });

    it("should reset all file tracking", () => {
      const file1 = join(testDir, "file1.jsonl");
      const file2 = join(testDir, "file2.jsonl");

      writeFileSync(file1, JSON.stringify({ role: "user", content: "Test1" }) + "\n");
      writeFileSync(file2, JSON.stringify({ role: "user", content: "Test2" }) + "\n");

      parser.parseNewContent(file1);
      parser.parseNewContent(file2);

      parser.resetAll();

      expect(parser.getTrackedFiles()).toEqual([]);
    });
  });

  describe("message type detection", () => {
    it("should detect system messages", () => {
      const jsonl = JSON.stringify({
        role: "system",
        content: "System prompt",
      });
      writeFileSync(testFile, jsonl + "\n");

      const messages = parser.parseNewContent(testFile);

      expect(messages[0].type).toBe("system");
    });

    it("should handle model role as assistant", () => {
      const jsonl = JSON.stringify({
        role: "model",
        content: "Response",
      });
      writeFileSync(testFile, jsonl + "\n");

      const messages = parser.parseNewContent(testFile);

      expect(messages[0].type).toBe("assistant");
    });
  });
});
