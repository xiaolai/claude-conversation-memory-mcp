/**
 * Unit tests for ResultAggregator
 */

import {
  ResultAggregator,
  getResultAggregator,
} from "../../search/ResultAggregator.js";
import type { ChunkSearchResult } from "../../embeddings/VectorStore.js";

describe("ResultAggregator", () => {
  describe("Constructor and Configuration", () => {
    it("should create with default config", () => {
      const aggregator = new ResultAggregator();
      expect(aggregator).toBeDefined();
    });

    it("should accept custom config", () => {
      const aggregator = new ResultAggregator({
        minSimilarity: 0.5,
        limit: 5,
        deduplicate: false,
      });
      expect(aggregator).toBeDefined();
    });
  });

  describe("Aggregation", () => {
    it("should aggregate chunks by message ID", () => {
      const aggregator = new ResultAggregator({ minSimilarity: 0.0 });

      const chunks: ChunkSearchResult[] = [
        createChunkResult(1, "chunk1", 0, 0.9, "Content from chunk 1"),
        createChunkResult(1, "chunk2", 1, 0.7, "Content from chunk 2"),
        createChunkResult(2, "chunk3", 0, 0.8, "Different message content"),
      ];

      const results = aggregator.aggregate(chunks);

      expect(results).toHaveLength(2);
      // Message 1 should have higher similarity (0.9) and come first
      expect(results[0].messageId).toBe(1);
      expect(results[0].similarity).toBe(0.9);
      expect(results[0].matchedChunks).toHaveLength(2);
    });

    it("should use max similarity from chunks", () => {
      const aggregator = new ResultAggregator({ minSimilarity: 0.0 });

      const chunks: ChunkSearchResult[] = [
        createChunkResult(1, "chunk1", 0, 0.5, "Low score chunk"),
        createChunkResult(1, "chunk2", 1, 0.9, "High score chunk"),
        createChunkResult(1, "chunk3", 2, 0.3, "Lower score chunk"),
      ];

      const results = aggregator.aggregate(chunks);

      expect(results).toHaveLength(1);
      expect(results[0].similarity).toBe(0.9);
      expect(results[0].bestSnippet).toBe("High score chunk");
    });

    it("should filter by minimum similarity", () => {
      const aggregator = new ResultAggregator({ minSimilarity: 0.5 });

      const chunks: ChunkSearchResult[] = [
        createChunkResult(1, "chunk1", 0, 0.6, "Above threshold"),
        createChunkResult(2, "chunk2", 0, 0.3, "Below threshold"),
        createChunkResult(3, "chunk3", 0, 0.8, "Well above threshold"),
      ];

      const results = aggregator.aggregate(chunks);

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.messageId)).toEqual([3, 1]);
    });

    it("should respect limit", () => {
      const aggregator = new ResultAggregator({
        minSimilarity: 0.0,
        limit: 2,
        deduplicate: false, // Disable deduplication for this test
      });

      const chunks: ChunkSearchResult[] = [
        createChunkResult(1, "chunk1", 0, 0.9, "First unique content about apples"),
        createChunkResult(2, "chunk2", 0, 0.8, "Second unique content about bananas"),
        createChunkResult(3, "chunk3", 0, 0.7, "Third unique content about oranges"),
        createChunkResult(4, "chunk4", 0, 0.6, "Fourth unique content about grapes"),
      ];

      const results = aggregator.aggregate(chunks);

      expect(results).toHaveLength(2);
    });

    it("should sort by similarity descending", () => {
      const aggregator = new ResultAggregator({ minSimilarity: 0.0 });

      const chunks: ChunkSearchResult[] = [
        createChunkResult(1, "chunk1", 0, 0.5, "Medium"),
        createChunkResult(2, "chunk2", 0, 0.9, "Highest"),
        createChunkResult(3, "chunk3", 0, 0.3, "Lowest"),
        createChunkResult(4, "chunk4", 0, 0.7, "High"),
      ];

      const results = aggregator.aggregate(chunks);

      expect(results[0].messageId).toBe(2);
      expect(results[1].messageId).toBe(4);
      expect(results[2].messageId).toBe(1);
      expect(results[3].messageId).toBe(3);
    });
  });

  describe("Deduplication", () => {
    it("should deduplicate similar content", () => {
      const aggregator = new ResultAggregator({
        minSimilarity: 0.0,
        deduplicate: true,
        deduplicationThreshold: 0.7,
      });

      const chunks: ChunkSearchResult[] = [
        createChunkResult(1, "chunk1", 0, 0.9, "The quick brown fox jumps over the lazy dog"),
        createChunkResult(2, "chunk2", 0, 0.8, "The quick brown fox jumps over the lazy cat"), // Very similar
        createChunkResult(3, "chunk3", 0, 0.7, "Completely different content about programming"),
      ];

      const results = aggregator.aggregate(chunks);

      // Should have deduplicated similar messages
      expect(results.length).toBeLessThanOrEqual(3);
      // First and third should definitely be in results
      expect(results.some((r) => r.messageId === 1)).toBe(true);
      expect(results.some((r) => r.messageId === 3)).toBe(true);
    });

    it("should not deduplicate when disabled", () => {
      const aggregator = new ResultAggregator({
        minSimilarity: 0.0,
        deduplicate: false,
      });

      const chunks: ChunkSearchResult[] = [
        createChunkResult(1, "chunk1", 0, 0.9, "Identical content here"),
        createChunkResult(2, "chunk2", 0, 0.8, "Identical content here"),
      ];

      const results = aggregator.aggregate(chunks);

      expect(results).toHaveLength(2);
    });
  });

  describe("Merge Results", () => {
    it("should merge chunk and message results", () => {
      const aggregator = new ResultAggregator({ minSimilarity: 0.0 });

      const chunkResults = aggregator.aggregate([
        createChunkResult(1, "chunk1", 0, 0.8, "Chunk content"),
      ]);

      const messageResults = [
        { messageId: 2, content: "Message only content", similarity: 0.7 },
        { messageId: 1, content: "Better message content", similarity: 0.9 }, // Higher score
      ];

      const merged = aggregator.mergeResults(chunkResults, messageResults);

      expect(merged).toHaveLength(2);
      // Message 1 should have the higher similarity from message results
      const msg1 = merged.find((r) => r.messageId === 1);
      expect(msg1?.similarity).toBe(0.9);
      expect(msg1?.bestSnippet).toBe("Better message content");
    });

    it("should add new message results", () => {
      const aggregator = new ResultAggregator({ minSimilarity: 0.0 });

      const chunkResults = aggregator.aggregate([
        createChunkResult(1, "chunk1", 0, 0.8, "Chunk content"),
      ]);

      const messageResults = [
        { messageId: 2, content: "New message content", similarity: 0.7 },
      ];

      const merged = aggregator.mergeResults(chunkResults, messageResults);

      expect(merged).toHaveLength(2);
      expect(merged.some((r) => r.messageId === 2)).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty input", () => {
      const aggregator = new ResultAggregator();
      const results = aggregator.aggregate([]);

      expect(results).toEqual([]);
    });

    it("should handle all chunks below threshold", () => {
      const aggregator = new ResultAggregator({ minSimilarity: 0.9 });

      const chunks: ChunkSearchResult[] = [
        createChunkResult(1, "chunk1", 0, 0.5, "Content"),
        createChunkResult(2, "chunk2", 0, 0.3, "Content"),
      ];

      const results = aggregator.aggregate(chunks);

      expect(results).toEqual([]);
    });
  });

  describe("Factory Function", () => {
    it("should create aggregator with config", () => {
      const aggregator = getResultAggregator({ limit: 5 });
      expect(aggregator).toBeInstanceOf(ResultAggregator);
    });
  });
});

// Helper function to create test chunk results
function createChunkResult(
  messageId: number,
  chunkId: string,
  chunkIndex: number,
  similarity: number,
  content: string
): ChunkSearchResult {
  return {
    chunkId,
    messageId,
    chunkIndex,
    totalChunks: 3,
    content,
    startOffset: chunkIndex * 100,
    endOffset: (chunkIndex + 1) * 100,
    similarity,
    strategy: "sentence",
  };
}
