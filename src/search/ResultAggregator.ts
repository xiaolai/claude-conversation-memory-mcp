/**
 * Result Aggregator
 * Combines chunk search results back to message level
 */

import type { ChunkSearchResult } from "../embeddings/VectorStore.js";

/**
 * Match info from a single chunk
 */
export interface ChunkMatch {
  chunkId: string;
  chunkIndex: number;
  totalChunks: number;
  content: string;
  startOffset: number;
  endOffset: number;
  similarity: number;
}

/**
 * Aggregated result combining multiple chunks from the same message
 */
export interface AggregatedResult {
  messageId: number;
  similarity: number; // Max chunk similarity
  matchedChunks: ChunkMatch[];
  bestSnippet: string; // From highest-scoring chunk
  totalChunks: number;
}

/**
 * Configuration for result aggregation
 */
export interface AggregationConfig {
  /** Minimum similarity threshold */
  minSimilarity: number;

  /** Maximum results to return after aggregation */
  limit: number;

  /** Whether to deduplicate similar content within conversation */
  deduplicate: boolean;

  /** Jaccard similarity threshold for deduplication (0-1) */
  deduplicationThreshold: number;
}

export const DEFAULT_AGGREGATION_CONFIG: AggregationConfig = {
  minSimilarity: 0.30,
  limit: 10,
  deduplicate: true,
  deduplicationThreshold: 0.7,
};

/**
 * Calculate Jaccard similarity between two strings (word-level)
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2));

  if (wordsA.size === 0 && wordsB.size === 0) {
    return 1.0;
  }

  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0.0;
  }

  const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

/**
 * Result Aggregator class
 */
export class ResultAggregator {
  private config: AggregationConfig;

  constructor(config?: Partial<AggregationConfig>) {
    this.config = { ...DEFAULT_AGGREGATION_CONFIG, ...config };
  }

  /**
   * Aggregate chunk search results by parent message
   */
  aggregate(chunkResults: ChunkSearchResult[]): AggregatedResult[] {
    // Group by message ID
    const messageGroups = new Map<number, ChunkSearchResult[]>();

    for (const chunk of chunkResults) {
      // Apply minimum similarity filter
      if (chunk.similarity < this.config.minSimilarity) {
        continue;
      }

      const existing = messageGroups.get(chunk.messageId);
      if (existing) {
        existing.push(chunk);
      } else {
        messageGroups.set(chunk.messageId, [chunk]);
      }
    }

    // Convert to aggregated results
    const aggregatedResults: AggregatedResult[] = [];

    for (const [messageId, chunks] of messageGroups) {
      // Sort chunks by similarity (descending)
      chunks.sort((a, b) => b.similarity - a.similarity);

      // Get best chunk for snippet
      const bestChunk = chunks[0];

      // Calculate max similarity for the message
      const maxSimilarity = bestChunk.similarity;

      // Convert to ChunkMatch format
      const matchedChunks: ChunkMatch[] = chunks.map((c) => ({
        chunkId: c.chunkId,
        chunkIndex: c.chunkIndex,
        totalChunks: c.totalChunks,
        content: c.content,
        startOffset: c.startOffset,
        endOffset: c.endOffset,
        similarity: c.similarity,
      }));

      aggregatedResults.push({
        messageId,
        similarity: maxSimilarity,
        matchedChunks,
        bestSnippet: bestChunk.content,
        totalChunks: bestChunk.totalChunks,
      });
    }

    // Sort by similarity (descending)
    aggregatedResults.sort((a, b) => b.similarity - a.similarity);

    // Apply deduplication if enabled
    let results = aggregatedResults;
    if (this.config.deduplicate) {
      results = this.deduplicateResults(aggregatedResults);
    }

    // Apply limit
    return results.slice(0, this.config.limit);
  }

  /**
   * Deduplicate similar results using Jaccard similarity
   */
  private deduplicateResults(results: AggregatedResult[]): AggregatedResult[] {
    const deduplicated: AggregatedResult[] = [];

    for (const result of results) {
      // Check if this result is too similar to any already accepted result
      let isDuplicate = false;

      for (const accepted of deduplicated) {
        const similarity = jaccardSimilarity(result.bestSnippet, accepted.bestSnippet);
        if (similarity >= this.config.deduplicationThreshold) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        deduplicated.push(result);
      }
    }

    return deduplicated;
  }

  /**
   * Merge results from multiple search sources (e.g., chunk + message embeddings)
   * Uses max similarity for duplicate message IDs
   */
  mergeResults(
    chunkResults: AggregatedResult[],
    messageResults: Array<{ messageId: number; content: string; similarity: number }>
  ): AggregatedResult[] {
    const merged = new Map<number, AggregatedResult>();

    // Add chunk results first
    for (const result of chunkResults) {
      merged.set(result.messageId, result);
    }

    // Add or update with message results
    for (const msgResult of messageResults) {
      const existing = merged.get(msgResult.messageId);

      if (existing) {
        // Keep higher similarity
        if (msgResult.similarity > existing.similarity) {
          existing.similarity = msgResult.similarity;
          existing.bestSnippet = msgResult.content;
        }
      } else {
        // Add new result from message search
        merged.set(msgResult.messageId, {
          messageId: msgResult.messageId,
          similarity: msgResult.similarity,
          matchedChunks: [],
          bestSnippet: msgResult.content,
          totalChunks: 1,
        });
      }
    }

    // Convert to array, sort, and return
    const results = Array.from(merged.values());
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, this.config.limit);
  }
}

/**
 * Get or create a result aggregator with given config
 */
export function getResultAggregator(config?: Partial<AggregationConfig>): ResultAggregator {
  return new ResultAggregator(config);
}
