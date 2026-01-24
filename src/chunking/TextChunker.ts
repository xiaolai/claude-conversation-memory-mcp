/**
 * Text Chunker Factory
 * Provides unified interface for text chunking strategies
 */

import type {
  ChunkingConfig,
  ChunkingResult,
  TextChunk,
} from "./ChunkingConfig.js";
import {
  DEFAULT_CHUNKING_CONFIG,
  getChunkingConfig,
} from "./ChunkingConfig.js";
import { chunkWithSentences, estimateTokens } from "./strategies/SentenceChunker.js";
import { chunkWithSlidingWindow } from "./strategies/SlidingWindowChunker.js";

/**
 * Interface for chunking strategies
 */
export interface ChunkingStrategy {
  chunk(text: string, config: ChunkingConfig): ChunkingResult;
}

/**
 * Text Chunker - Factory for creating and using chunking strategies
 */
export class TextChunker {
  private config: ChunkingConfig;

  constructor(config?: Partial<ChunkingConfig>) {
    // Merge with defaults and environment config
    const envConfig = getChunkingConfig();
    this.config = {
      ...DEFAULT_CHUNKING_CONFIG,
      ...envConfig,
      ...config,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): ChunkingConfig {
    return { ...this.config };
  }

  /**
   * Check if text needs chunking based on estimated token count
   */
  needsChunking(text: string): boolean {
    if (!this.config.enabled) {
      return false;
    }

    const estimatedTokenCount = estimateTokens(text, this.config);
    return estimatedTokenCount > this.config.chunkSize;
  }

  /**
   * Estimate token count for text
   */
  estimateTokens(text: string): number {
    return estimateTokens(text, this.config);
  }

  /**
   * Chunk text using configured strategy
   */
  chunk(text: string): ChunkingResult {
    // If chunking disabled, return single chunk
    if (!this.config.enabled) {
      return {
        originalLength: text.length,
        wasChunked: false,
        chunks: [
          {
            content: text,
            index: 0,
            totalChunks: 1,
            startOffset: 0,
            endOffset: text.length,
            estimatedTokens: estimateTokens(text, this.config),
            strategy: this.config.strategy,
          },
        ],
        strategy: this.config.strategy,
        estimatedTotalTokens: estimateTokens(text, this.config),
      };
    }

    // Select strategy based on configuration
    switch (this.config.strategy) {
      case "sentence":
        return chunkWithSentences(text, this.config);

      case "sliding_window":
        return chunkWithSlidingWindow(text, this.config);

      case "paragraph":
        // Fall back to sentence chunking for now
        // Paragraph chunking would split at \n\n boundaries
        return chunkWithSentences(text, this.config);

      default:
        // Default to sentence chunking
        return chunkWithSentences(text, this.config);
    }
  }

  /**
   * Chunk multiple texts in batch
   */
  chunkBatch(texts: string[]): ChunkingResult[] {
    return texts.map((text) => this.chunk(text));
  }

  /**
   * Flatten chunks from multiple texts into a single array with source tracking
   */
  chunkBatchFlat(
    texts: Array<{ id: string | number; content: string }>
  ): Array<TextChunk & { sourceId: string | number }> {
    const results: Array<TextChunk & { sourceId: string | number }> = [];

    for (const { id, content } of texts) {
      const result = this.chunk(content);
      for (const chunk of result.chunks) {
        results.push({
          ...chunk,
          sourceId: id,
        });
      }
    }

    return results;
  }
}

/**
 * Global chunker instance with default config
 */
let defaultChunker: TextChunker | null = null;

/**
 * Get or create global chunker instance
 */
export function getTextChunker(config?: Partial<ChunkingConfig>): TextChunker {
  if (config) {
    return new TextChunker(config);
  }

  if (!defaultChunker) {
    defaultChunker = new TextChunker();
  }

  return defaultChunker;
}

/**
 * Reset global chunker (useful for testing)
 */
export function resetTextChunker(): void {
  defaultChunker = null;
}

// Re-export types and utilities
export type { ChunkingConfig, ChunkingResult, TextChunk };
export { DEFAULT_CHUNKING_CONFIG, getChunkingConfig } from "./ChunkingConfig.js";
export { estimateTokens } from "./strategies/SentenceChunker.js";
