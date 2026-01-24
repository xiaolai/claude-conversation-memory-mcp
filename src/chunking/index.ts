/**
 * Text Chunking Module
 * Provides text chunking strategies for handling long messages that exceed embedding model limits
 */

export {
  TextChunker,
  getTextChunker,
  resetTextChunker,
  estimateTokens,
  DEFAULT_CHUNKING_CONFIG,
  getChunkingConfig,
} from "./TextChunker.js";

export type {
  ChunkingConfig,
  ChunkingResult,
  TextChunk,
  ChunkingStrategy as ChunkingStrategyType,
} from "./ChunkingConfig.js";

export { chunkWithSentences } from "./strategies/SentenceChunker.js";
export { chunkWithSlidingWindow } from "./strategies/SlidingWindowChunker.js";
