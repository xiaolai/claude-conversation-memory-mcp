/**
 * Sliding Window Text Chunker
 * Simple overlap-based chunking for fallback scenarios
 */

import type { ChunkingConfig, TextChunk, ChunkingResult } from "../ChunkingConfig.js";
import { estimateTokens } from "./SentenceChunker.js";

/**
 * Find the nearest word boundary at or before the given position
 */
function findWordBoundary(text: string, position: number, searchBackward: boolean = true): number {
  if (position >= text.length) {
    return text.length;
  }
  if (position <= 0) {
    return 0;
  }

  // If already at a space, return position
  if (text[position] === " " || text[position] === "\n") {
    return position;
  }

  if (searchBackward) {
    // Search backward for space
    for (let i = position; i >= 0; i--) {
      if (text[i] === " " || text[i] === "\n") {
        return i + 1;
      }
    }
    return 0;
  } else {
    // Search forward for space
    for (let i = position; i < text.length; i++) {
      if (text[i] === " " || text[i] === "\n") {
        return i;
      }
    }
    return text.length;
  }
}

/**
 * Estimate character count for target token size
 */
function estimateCharsForTokens(tokens: number, config: ChunkingConfig, text: string): number {
  // Use average of prose and code ratios, weighted by content
  const codeBlockPattern = /```[\s\S]*?```|`[^`\n]+`/g;
  const codeMatches = text.match(codeBlockPattern) || [];
  const codeLength = codeMatches.reduce((sum, m) => sum + m.length, 0);
  const codeRatio = text.length > 0 ? codeLength / text.length : 0;

  const avgCharsPerToken =
    config.charsPerTokenCode * codeRatio +
    config.charsPerTokenProse * (1 - codeRatio);

  return Math.floor(tokens * avgCharsPerToken);
}

/**
 * Chunk text using sliding window strategy
 */
export function chunkWithSlidingWindow(
  text: string,
  config: ChunkingConfig
): ChunkingResult {
  const estimatedTotalTokens = estimateTokens(text, config);

  // Don't chunk if text is small enough
  if (estimatedTotalTokens <= config.chunkSize) {
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
          estimatedTokens: estimatedTotalTokens,
          strategy: "sliding_window",
        },
      ],
      strategy: "sliding_window",
      estimatedTotalTokens,
    };
  }

  const chunks: TextChunk[] = [];

  // Calculate window sizes in characters
  const windowChars = estimateCharsForTokens(config.chunkSize, config, text);
  const overlapChars = Math.floor(windowChars * config.overlap);
  const stepChars = windowChars - overlapChars;

  let position = 0;

  while (position < text.length) {
    // Calculate end position (with word boundary adjustment)
    let endPosition = Math.min(position + windowChars, text.length);

    // Adjust to word boundary if not at end
    if (endPosition < text.length) {
      endPosition = findWordBoundary(text, endPosition, true);
      // Ensure we make progress
      if (endPosition <= position) {
        endPosition = findWordBoundary(text, position + windowChars, false);
      }
    }

    const content = text.slice(position, endPosition).trim();

    if (content.length > 0) {
      chunks.push({
        content,
        index: chunks.length,
        totalChunks: 0, // Updated later
        startOffset: position,
        endOffset: endPosition,
        estimatedTokens: estimateTokens(content, config),
        strategy: "sliding_window",
      });
    }

    // Move window forward
    if (endPosition >= text.length) {
      break;
    }

    // Calculate next start position
    let nextPosition = position + stepChars;

    // Adjust to word boundary
    nextPosition = findWordBoundary(text, nextPosition, true);

    // Ensure we make progress
    if (nextPosition <= position) {
      nextPosition = position + 1;
    }

    position = nextPosition;
  }

  // Update totalChunks for all chunks
  const totalChunks = chunks.length;
  for (const chunk of chunks) {
    chunk.totalChunks = totalChunks;
  }

  return {
    originalLength: text.length,
    wasChunked: chunks.length > 1,
    chunks,
    strategy: "sliding_window",
    estimatedTotalTokens,
  };
}
