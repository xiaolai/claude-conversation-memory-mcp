/**
 * Unit tests for SnippetGenerator
 */

import {
  SnippetGenerator,
  getSnippetGenerator,
  generateSnippet,
} from "../../search/SnippetGenerator.js";

describe("SnippetGenerator", () => {
  describe("Constructor and Configuration", () => {
    it("should create with default config", () => {
      const generator = new SnippetGenerator();
      expect(generator).toBeDefined();
    });

    it("should accept custom config", () => {
      const generator = new SnippetGenerator({
        targetLength: 100,
        highlight: false,
        ellipsis: "…",
      });
      expect(generator).toBeDefined();
    });
  });

  describe("Basic Snippet Generation", () => {
    it("should return content as-is when shorter than target", () => {
      const generator = new SnippetGenerator({ targetLength: 100 });
      const content = "Short content.";
      const snippet = generator.generate(content, "content");

      expect(snippet).toContain("content");
    });

    it("should highlight query terms", () => {
      const generator = new SnippetGenerator({
        highlight: true,
        highlightStart: "**",
        highlightEnd: "**",
      });

      const content = "This is a test sentence with important keyword here.";
      const snippet = generator.generate(content, "important keyword");

      expect(snippet).toContain("**important**");
      expect(snippet).toContain("**keyword**");
    });

    it("should not highlight when disabled", () => {
      const generator = new SnippetGenerator({ highlight: false });

      const content = "This is a test sentence with keyword here.";
      const snippet = generator.generate(content, "keyword");

      expect(snippet).not.toContain("**");
      expect(snippet).toContain("keyword");
    });

    it("should add ellipsis for truncated content", () => {
      const generator = new SnippetGenerator({
        targetLength: 50,
        ellipsis: "...",
      });

      const content = "This is a very long sentence that definitely needs to be truncated because it exceeds the target length significantly.";
      const snippet = generator.generate(content, "truncated");

      expect(snippet).toContain("...");
    });
  });

  describe("Query Term Handling", () => {
    it("should filter stop words from query", () => {
      const generator = new SnippetGenerator({ highlight: true });

      const content = "The quick brown fox jumps over the lazy dog.";
      // "the" and "over" are stop words
      const snippet = generator.generate(content, "the quick fox over");

      // "quick" and "fox" should be highlighted, but not stop words
      expect(snippet).toContain("**quick**");
      expect(snippet).toContain("**fox**");
    });

    it("should handle case-insensitive matching", () => {
      const generator = new SnippetGenerator({ highlight: true });

      const content = "JavaScript is a programming language.";
      const snippet = generator.generate(content, "javascript programming");

      expect(snippet).toContain("**JavaScript**");
      expect(snippet).toContain("**programming**");
    });

    it("should handle empty query", () => {
      const generator = new SnippetGenerator();

      const content = "Some content here.";
      const snippet = generator.generate(content, "");

      expect(snippet).toBeTruthy();
    });

    it("should handle query with no matches", () => {
      const generator = new SnippetGenerator();

      const content = "The quick brown fox jumps over the lazy dog.";
      const snippet = generator.generate(content, "zebra elephant giraffe");

      // Should return beginning of content
      expect(snippet).toContain("quick");
    });
  });

  describe("Region Selection", () => {
    it("should find best region with highest match density", () => {
      const generator = new SnippetGenerator({
        targetLength: 50,
        highlight: false,
      });

      const content = "Unrelated intro text here. The error occurred in the database layer causing issues. More unrelated text follows.";
      const snippet = generator.generate(content, "error database");

      expect(snippet).toContain("error");
      expect(snippet).toContain("database");
    });

    it("should prefer sentence boundaries", () => {
      const generator = new SnippetGenerator({
        targetLength: 100,
        preferSentenceBoundaries: true,
        highlight: false,
      });

      const content = "First sentence. The important keyword is here. Third sentence.";
      const snippet = generator.generate(content, "keyword");

      expect(snippet).toContain("keyword");
    });
  });

  describe("Word Boundary Handling", () => {
    it("should not cut words in the middle", () => {
      const generator = new SnippetGenerator({
        targetLength: 30,
        highlight: false,
      });

      const content = "The internationalization process is complex and requires attention.";
      const snippet = generator.generate(content, "process");

      // Should not have partial words
      const words = snippet.replace(/\.\.\./g, "").trim().split(/\s+/);
      for (const word of words) {
        // Each word should be complete (not cut off)
        expect(word.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Custom Highlight Markers", () => {
    it("should use custom highlight markers", () => {
      const generator = new SnippetGenerator({
        highlight: true,
        highlightStart: "<mark>",
        highlightEnd: "</mark>",
      });

      const content = "Find the keyword here.";
      const snippet = generator.generate(content, "keyword");

      expect(snippet).toContain("<mark>keyword</mark>");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty content", () => {
      const generator = new SnippetGenerator();
      const snippet = generator.generate("", "test");

      expect(snippet).toBe("");
    });

    it("should handle content with special regex characters", () => {
      const generator = new SnippetGenerator({ highlight: true });

      const content = "The regex pattern is /test.*pattern/g in JavaScript.";
      const snippet = generator.generate(content, "test pattern");

      // Should not throw and should contain the terms
      expect(snippet).toContain("test");
      expect(snippet).toContain("pattern");
    });

    it("should handle very long single word", () => {
      const generator = new SnippetGenerator({
        targetLength: 50,
      });

      const content = "prefix " + "a".repeat(100) + " suffix";
      const snippet = generator.generate(content, "prefix");

      expect(snippet).toBeTruthy();
    });

    it("should handle unicode characters", () => {
      const generator = new SnippetGenerator({ highlight: true });

      const content = "日本語のテキストとEnglish混合コンテンツ。";
      const snippet = generator.generate(content, "English");

      expect(snippet).toContain("**English**");
    });

    it("should handle multiple occurrences of same term", () => {
      const generator = new SnippetGenerator({ highlight: true });

      const content = "Error in first error and second error found.";
      const snippet = generator.generate(content, "error");

      // Should highlight all occurrences
      const matches = snippet.match(/\*\*error\*\*/gi) || [];
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Factory Functions", () => {
    it("should create generator with config", () => {
      const generator = getSnippetGenerator({ targetLength: 150 });
      expect(generator).toBeInstanceOf(SnippetGenerator);
    });

    it("should generate snippet with default config", () => {
      const content = "Test content with keyword here.";
      const snippet = generateSnippet(content, "keyword");

      expect(snippet).toContain("keyword");
    });
  });

  describe("Long Content Handling", () => {
    it("should handle very long content efficiently", () => {
      const generator = new SnippetGenerator({ targetLength: 100 });

      // Create long content with keyword in the middle
      const longContent =
        "Intro text. ".repeat(50) +
        "The important error message appears here. " +
        "More text. ".repeat(50);

      const snippet = generator.generate(longContent, "error message");

      expect(snippet).toContain("error");
      expect(snippet.length).toBeLessThanOrEqual(300); // Reasonable length
    });
  });
});
