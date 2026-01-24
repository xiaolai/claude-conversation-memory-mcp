/**
 * Unit tests for TextChunker and chunking strategies
 */

import { jest } from "@jest/globals";
import {
  TextChunker,
  resetTextChunker,
  getTextChunker,
  estimateTokens,
  DEFAULT_CHUNKING_CONFIG,
} from "../../chunking/TextChunker.js";

describe("TextChunker", () => {
  beforeEach(() => {
    resetTextChunker();
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Constructor and Configuration", () => {
    it("should create with default config", () => {
      const chunker = new TextChunker();
      const config = chunker.getConfig();

      expect(config.chunkSize).toBe(DEFAULT_CHUNKING_CONFIG.chunkSize);
      expect(config.overlap).toBe(DEFAULT_CHUNKING_CONFIG.overlap);
      expect(config.strategy).toBe(DEFAULT_CHUNKING_CONFIG.strategy);
    });

    it("should accept custom config", () => {
      const chunker = new TextChunker({
        chunkSize: 300,
        overlap: 0.2,
        strategy: "sliding_window",
      });
      const config = chunker.getConfig();

      expect(config.chunkSize).toBe(300);
      expect(config.overlap).toBe(0.2);
      expect(config.strategy).toBe("sliding_window");
    });
  });

  describe("Token Estimation", () => {
    it("should estimate tokens for plain text", () => {
      const text = "This is a simple test sentence with eight words.";
      const tokens = estimateTokens(text, DEFAULT_CHUNKING_CONFIG);

      // ~4 chars per token for prose
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(text.length); // Should be less than char count
    });

    it("should estimate tokens for code", () => {
      const code = `function hello() {
  console.log("Hello, world!");
  return true;
}`;
      const tokens = estimateTokens(code, DEFAULT_CHUNKING_CONFIG);

      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe("needsChunking", () => {
    it("should return false for short text", () => {
      const chunker = new TextChunker({ enabled: true, chunkSize: 450 });
      const shortText = "This is a short message.";

      expect(chunker.needsChunking(shortText)).toBe(false);
    });

    it("should return true for long text", () => {
      const chunker = new TextChunker({ enabled: true, chunkSize: 50 });
      const longText = "This is a much longer message that contains many words and should exceed the token limit for chunking to be necessary. ".repeat(10);

      expect(chunker.needsChunking(longText)).toBe(true);
    });

    it("should return false when chunking is disabled", () => {
      const chunker = new TextChunker({ enabled: false });
      const longText = "Very long text ".repeat(1000);

      expect(chunker.needsChunking(longText)).toBe(false);
    });
  });

  describe("Sentence Chunking", () => {
    it("should return single chunk for short text", () => {
      const chunker = new TextChunker({ enabled: true, strategy: "sentence" });
      const text = "This is a short sentence.";
      const result = chunker.chunk(text);

      expect(result.wasChunked).toBe(false);
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].content).toBe(text);
    });

    it("should split long text into multiple chunks", () => {
      const chunker = new TextChunker({
        enabled: true,
        strategy: "sentence",
        chunkSize: 20, // Very small for testing (20 tokens ~ 80 chars)
        minChunkSize: 5,
      });

      // Make sure the text is long enough to require chunking
      const text = "First sentence with some words here. Second sentence follows with more content. Third sentence appears with additional text. Fourth sentence concludes this paragraph.";
      const result = chunker.chunk(text);

      expect(result.wasChunked).toBe(true);
      expect(result.chunks.length).toBeGreaterThan(1);
    });

    it("should preserve code blocks", () => {
      const chunker = new TextChunker({
        enabled: true,
        strategy: "sentence",
        chunkSize: 100,
      });

      const text = `Some text before.
\`\`\`javascript
function test() {
  return 42;
}
\`\`\`
Some text after.`;

      const result = chunker.chunk(text);

      // Code block should not be split
      const codeChunk = result.chunks.find((c) =>
        c.content.includes("```javascript")
      );
      expect(codeChunk).toBeDefined();
      if (codeChunk) {
        expect(codeChunk.content).toContain("return 42");
      }
    });

    it("should track chunk indices correctly", () => {
      const chunker = new TextChunker({
        enabled: true,
        strategy: "sentence",
        chunkSize: 30,
      });

      const text = "Sentence one. Sentence two. Sentence three.";
      const result = chunker.chunk(text);

      for (let i = 0; i < result.chunks.length; i++) {
        expect(result.chunks[i].index).toBe(i);
        expect(result.chunks[i].totalChunks).toBe(result.chunks.length);
      }
    });

    it("should track character offsets", () => {
      const chunker = new TextChunker({
        enabled: true,
        strategy: "sentence",
        chunkSize: 100,
      });

      const text = "First part of text. Second part of the content.";
      const result = chunker.chunk(text);

      for (const chunk of result.chunks) {
        expect(chunk.startOffset).toBeGreaterThanOrEqual(0);
        expect(chunk.endOffset).toBeLessThanOrEqual(text.length);
        expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
      }
    });
  });

  describe("Sliding Window Chunking", () => {
    it("should create overlapping chunks", () => {
      const chunker = new TextChunker({
        enabled: true,
        strategy: "sliding_window",
        chunkSize: 50,
        overlap: 0.2,
      });

      const text = "Word ".repeat(100);
      const result = chunker.chunk(text);

      expect(result.wasChunked).toBe(true);
      expect(result.strategy).toBe("sliding_window");
    });
  });

  describe("Batch Chunking", () => {
    it("should chunk multiple texts", () => {
      const chunker = new TextChunker({ enabled: true });
      const texts = [
        "First short text.",
        "Second short text.",
        "Third short text.",
      ];

      const results = chunker.chunkBatch(texts);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      });
    });

    it("should flatten batch with source tracking", () => {
      const chunker = new TextChunker({ enabled: true, chunkSize: 50 });
      const texts = [
        { id: "msg1", content: "Short message one." },
        { id: "msg2", content: "Short message two." },
      ];

      const flattened = chunker.chunkBatchFlat(texts);

      expect(flattened.length).toBeGreaterThanOrEqual(2);
      for (const chunk of flattened) {
        expect(["msg1", "msg2"]).toContain(chunk.sourceId);
      }
    });
  });

  describe("Disabled Chunking", () => {
    it("should return single chunk when disabled", () => {
      const chunker = new TextChunker({ enabled: false });
      const longText = "Very long text ".repeat(1000);
      const result = chunker.chunk(longText);

      expect(result.wasChunked).toBe(false);
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].content).toBe(longText);
    });
  });

  describe("Global Instance", () => {
    it("should return same instance without config", () => {
      const instance1 = getTextChunker();
      const instance2 = getTextChunker();

      expect(instance1).toBe(instance2);
    });

    it("should create new instance with config", () => {
      const instance1 = getTextChunker();
      const instance2 = getTextChunker({ chunkSize: 200 });

      expect(instance1).not.toBe(instance2);
    });

    it("should reset global instance", () => {
      const instance1 = getTextChunker();
      resetTextChunker();
      const instance2 = getTextChunker();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty text", () => {
      const chunker = new TextChunker({ enabled: true });
      const result = chunker.chunk("");

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].content).toBe("");
    });

    it("should handle text with only whitespace", () => {
      const chunker = new TextChunker({ enabled: true });
      const result = chunker.chunk("   \n\t   ");

      expect(result.chunks).toHaveLength(1);
    });

    it("should handle unicode characters", () => {
      const chunker = new TextChunker({ enabled: true });
      const text = "你好世界！这是一个测试。🎉 Emojis work too!";
      const result = chunker.chunk(text);

      expect(result.chunks[0].content).toContain("你好");
      expect(result.chunks[0].content).toContain("🎉");
    });

    it("should handle very long single word", () => {
      const chunker = new TextChunker({ enabled: true, chunkSize: 10 });
      const longWord = "a".repeat(1000);
      const result = chunker.chunk(longWord);

      // Should handle without crashing
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    });
  });
});
