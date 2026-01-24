/**
 * Unit tests for HybridReranker
 */

import {
  HybridReranker,
  getHybridReranker,
  getRerankConfig,
  DEFAULT_RERANK_CONFIG,
} from "../../search/HybridReranker.js";
import type { RankableResult } from "../../search/HybridReranker.js";

describe("HybridReranker", () => {
  describe("Constructor and Configuration", () => {
    it("should create with default config", () => {
      const reranker = new HybridReranker();
      const config = reranker.getConfig();

      expect(config.rrfK).toBe(DEFAULT_RERANK_CONFIG.rrfK);
      expect(config.vectorWeight).toBe(DEFAULT_RERANK_CONFIG.vectorWeight);
      expect(config.ftsWeight).toBe(DEFAULT_RERANK_CONFIG.ftsWeight);
      expect(config.enabled).toBe(true);
    });

    it("should accept custom config", () => {
      const reranker = new HybridReranker({
        rrfK: 30,
        vectorWeight: 0.5,
        ftsWeight: 0.5,
      });
      const config = reranker.getConfig();

      expect(config.rrfK).toBe(30);
      expect(config.vectorWeight).toBe(0.5);
      expect(config.ftsWeight).toBe(0.5);
    });
  });

  describe("Basic Re-ranking", () => {
    it("should combine vector and FTS results", () => {
      const reranker = new HybridReranker();

      const vectorResults: RankableResult[] = [
        { id: 1, score: 0.9 },
        { id: 2, score: 0.8 },
        { id: 3, score: 0.7 },
      ];

      const ftsResults: RankableResult[] = [
        { id: 2, score: 0.95 }, // Different ranking in FTS
        { id: 1, score: 0.85 },
        { id: 4, score: 0.75 }, // Only in FTS
      ];

      const results = reranker.rerank(vectorResults, ftsResults, 10);

      expect(results.length).toBeGreaterThan(0);
      // All unique IDs should be present
      const ids = results.map((r) => r.id);
      expect(ids).toContain(1);
      expect(ids).toContain(2);
      expect(ids).toContain(3);
      expect(ids).toContain(4);
    });

    it("should include rank information", () => {
      const reranker = new HybridReranker();

      const vectorResults: RankableResult[] = [{ id: 1, score: 0.9 }];
      const ftsResults: RankableResult[] = [{ id: 1, score: 0.8 }];

      const results = reranker.rerank(vectorResults, ftsResults, 10);

      expect(results[0].vectorRank).toBe(1);
      expect(results[0].ftsRank).toBe(1);
      expect(results[0].vectorScore).toBe(0.9);
      expect(results[0].ftsScore).toBe(0.8);
    });

    it("should mark null for missing rankings", () => {
      const reranker = new HybridReranker();

      const vectorResults: RankableResult[] = [{ id: 1, score: 0.9 }];
      const ftsResults: RankableResult[] = [{ id: 2, score: 0.8 }];

      const results = reranker.rerank(vectorResults, ftsResults, 10);

      const result1 = results.find((r) => r.id === 1);
      const result2 = results.find((r) => r.id === 2);

      expect(result1?.vectorRank).toBe(1);
      expect(result1?.ftsRank).toBeNull();
      expect(result2?.vectorRank).toBeNull();
      expect(result2?.ftsRank).toBe(1);
    });

    it("should respect limit", () => {
      const reranker = new HybridReranker();

      const vectorResults: RankableResult[] = [
        { id: 1, score: 0.9 },
        { id: 2, score: 0.8 },
        { id: 3, score: 0.7 },
      ];

      const ftsResults: RankableResult[] = [
        { id: 4, score: 0.9 },
        { id: 5, score: 0.8 },
        { id: 6, score: 0.7 },
      ];

      const results = reranker.rerank(vectorResults, ftsResults, 3);

      expect(results).toHaveLength(3);
    });
  });

  describe("RRF Scoring", () => {
    it("should boost items that appear in both sources", () => {
      const reranker = new HybridReranker({
        vectorWeight: 0.5,
        ftsWeight: 0.5,
      });

      const vectorResults: RankableResult[] = [
        { id: 1, score: 0.9 }, // In both
        { id: 2, score: 0.85 }, // Only vector
      ];

      const ftsResults: RankableResult[] = [
        { id: 1, score: 0.8 }, // In both
        { id: 3, score: 0.85 }, // Only FTS
      ];

      const results = reranker.rerank(vectorResults, ftsResults, 10);

      // Item 1 should have highest combined score (in both sources)
      expect(results[0].id).toBe(1);
    });

    it("should handle different weights", () => {
      // Vector-heavy weighting
      const vectorHeavy = new HybridReranker({
        vectorWeight: 0.9,
        ftsWeight: 0.1,
      });

      // FTS-heavy weighting
      const ftsHeavy = new HybridReranker({
        vectorWeight: 0.1,
        ftsWeight: 0.9,
      });

      const vectorResults: RankableResult[] = [{ id: 1, score: 0.9 }];
      const ftsResults: RankableResult[] = [{ id: 2, score: 0.9 }];

      const vectorHeavyResults = vectorHeavy.rerank(vectorResults, ftsResults, 10);
      const ftsHeavyResults = ftsHeavy.rerank(vectorResults, ftsResults, 10);

      // Vector-heavy should rank vector result higher
      expect(vectorHeavyResults[0].id).toBe(1);
      // FTS-heavy should rank FTS result higher
      expect(ftsHeavyResults[0].id).toBe(2);
    });
  });

  describe("Overlap Boost", () => {
    it("should apply boost to overlapping results", () => {
      const reranker = new HybridReranker();

      const vectorResults: RankableResult[] = [
        { id: 1, score: 0.8 }, // In both
        { id: 2, score: 0.9 }, // Only vector - higher initial
      ];

      const ftsResults: RankableResult[] = [
        { id: 1, score: 0.8 }, // In both
      ];

      const results = reranker.rerankWithOverlapBoost(
        vectorResults,
        ftsResults,
        10,
        1.5 // High boost
      );

      // With boost, overlapping result should be ranked higher
      expect(results[0].id).toBe(1);
    });

    it("should use default boost of 1.2", () => {
      const reranker = new HybridReranker();

      const vectorResults: RankableResult[] = [{ id: 1, score: 0.9 }];
      const ftsResults: RankableResult[] = [{ id: 1, score: 0.8 }];

      const withoutBoost = reranker.rerank(vectorResults, ftsResults, 10);
      const withBoost = reranker.rerankWithOverlapBoost(
        vectorResults,
        ftsResults,
        10
      );

      expect(withBoost[0].combinedScore).toBeGreaterThan(
        withoutBoost[0].combinedScore
      );
    });
  });

  describe("Disabled Re-ranking", () => {
    it("should return vector results unchanged when disabled", () => {
      const reranker = new HybridReranker({ enabled: false });

      const vectorResults: RankableResult[] = [
        { id: 1, score: 0.9 },
        { id: 2, score: 0.8 },
      ];

      const ftsResults: RankableResult[] = [
        { id: 3, score: 0.95 },
        { id: 4, score: 0.85 },
      ];

      const results = reranker.rerank(vectorResults, ftsResults, 10);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe(1);
      expect(results[0].combinedScore).toBe(0.9);
      expect(results[0].ftsRank).toBeNull();
      expect(results[0].ftsScore).toBeNull();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty vector results", () => {
      const reranker = new HybridReranker();

      const vectorResults: RankableResult[] = [];
      const ftsResults: RankableResult[] = [{ id: 1, score: 0.9 }];

      const results = reranker.rerank(vectorResults, ftsResults, 10);

      expect(results).toHaveLength(1);
      expect(results[0].vectorRank).toBeNull();
    });

    it("should handle empty FTS results", () => {
      const reranker = new HybridReranker();

      const vectorResults: RankableResult[] = [{ id: 1, score: 0.9 }];
      const ftsResults: RankableResult[] = [];

      const results = reranker.rerank(vectorResults, ftsResults, 10);

      expect(results).toHaveLength(1);
      expect(results[0].ftsRank).toBeNull();
    });

    it("should handle both empty", () => {
      const reranker = new HybridReranker();

      const results = reranker.rerank([], [], 10);

      expect(results).toEqual([]);
    });

    it("should handle string IDs", () => {
      const reranker = new HybridReranker();

      const vectorResults: RankableResult[] = [{ id: "msg-123", score: 0.9 }];
      const ftsResults: RankableResult[] = [{ id: "msg-123", score: 0.8 }];

      const results = reranker.rerank(vectorResults, ftsResults, 10);

      expect(results[0].id).toBe("msg-123");
    });
  });

  describe("Factory Functions", () => {
    it("should create reranker with config", () => {
      const reranker = getHybridReranker({ rrfK: 30 });
      expect(reranker.getConfig().rrfK).toBe(30);
    });

    it("should get config from environment", () => {
      const originalEnv = process.env.CCCMEMORY_RERANK_ENABLED;
      process.env.CCCMEMORY_RERANK_ENABLED = "false";

      const config = getRerankConfig();
      expect(config.enabled).toBe(false);

      // Restore
      if (originalEnv !== undefined) {
        process.env.CCCMEMORY_RERANK_ENABLED = originalEnv;
      } else {
        delete process.env.CCCMEMORY_RERANK_ENABLED;
      }
    });
  });
});
