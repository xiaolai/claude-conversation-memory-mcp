/**
 * Chunking Configuration Types
 * Defines configuration options for text chunking strategies
 */

export type ChunkingStrategy = "sentence" | "sliding_window" | "paragraph";

export interface ChunkingConfig {
  /** Enable or disable chunking (default: true) */
  enabled: boolean;

  /** Chunking strategy to use (default: "sentence") */
  strategy: ChunkingStrategy;

  /** Target chunk size in tokens (default: 450 for 512 limit with margin) */
  chunkSize: number;

  /** Overlap between chunks as a fraction (default: 0.1 = 10%) */
  overlap: number;

  /** Minimum chunk size in tokens - don't split smaller texts (default: 50) */
  minChunkSize: number;

  /** Maximum chunk size as hard limit (default: 500) */
  maxChunkSize: number;

  /** Characters per token estimate for prose (default: 4) */
  charsPerTokenProse: number;

  /** Characters per token estimate for code (default: 3.5) */
  charsPerTokenCode: number;
}

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  enabled: true,
  strategy: "sentence",
  chunkSize: 450,
  overlap: 0.1,
  minChunkSize: 50,
  maxChunkSize: 500,
  charsPerTokenProse: 4,
  charsPerTokenCode: 3.5,
};

/**
 * Result of chunking a text
 */
export interface TextChunk {
  /** The chunk content */
  content: string;

  /** Index of this chunk within the source text */
  index: number;

  /** Total number of chunks from the source text */
  totalChunks: number;

  /** Character offset where this chunk starts in the original text */
  startOffset: number;

  /** Character offset where this chunk ends in the original text */
  endOffset: number;

  /** Estimated token count for this chunk */
  estimatedTokens: number;

  /** Strategy used to create this chunk */
  strategy: ChunkingStrategy;
}

/**
 * Metadata about the chunking operation
 */
export interface ChunkingResult {
  /** Original text that was chunked */
  originalLength: number;

  /** Whether the text was actually chunked or returned as-is */
  wasChunked: boolean;

  /** Chunks produced */
  chunks: TextChunk[];

  /** Strategy used */
  strategy: ChunkingStrategy;

  /** Estimated total tokens in original text */
  estimatedTotalTokens: number;
}

/**
 * Get chunking config from environment or defaults
 */
export function getChunkingConfig(): ChunkingConfig {
  const config = { ...DEFAULT_CHUNKING_CONFIG };

  // Environment overrides
  if (process.env.CCCMEMORY_CHUNKING_ENABLED !== undefined) {
    config.enabled = process.env.CCCMEMORY_CHUNKING_ENABLED === "true";
  }

  if (process.env.CCCMEMORY_CHUNK_SIZE) {
    const size = parseInt(process.env.CCCMEMORY_CHUNK_SIZE, 10);
    if (!isNaN(size) && size > 0) {
      config.chunkSize = size;
    }
  }

  if (process.env.CCCMEMORY_CHUNKING_STRATEGY) {
    const strategy = process.env.CCCMEMORY_CHUNKING_STRATEGY as ChunkingStrategy;
    if (["sentence", "sliding_window", "paragraph"].includes(strategy)) {
      config.strategy = strategy;
    }
  }

  if (process.env.CCCMEMORY_CHUNK_OVERLAP) {
    const overlap = parseFloat(process.env.CCCMEMORY_CHUNK_OVERLAP);
    if (!isNaN(overlap) && overlap >= 0 && overlap < 1) {
      config.overlap = overlap;
    }
  }

  return config;
}
