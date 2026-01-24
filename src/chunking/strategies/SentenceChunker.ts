/**
 * Sentence-Aware Text Chunker
 * Splits text at sentence boundaries while respecting code blocks and paragraphs
 */

import type { ChunkingConfig, TextChunk, ChunkingResult } from "../ChunkingConfig.js";

/**
 * Estimate token count using character ratios
 */
function estimateTokens(text: string, config: ChunkingConfig): number {
  // Detect if text is mostly code
  const codeBlockPattern = /```[\s\S]*?```|`[^`\n]+`/g;
  const codeMatches = text.match(codeBlockPattern) || [];
  const codeLength = codeMatches.reduce((sum, m) => sum + m.length, 0);
  const proseLength = text.length - codeLength;

  const codeTokens = codeLength / config.charsPerTokenCode;
  const proseTokens = proseLength / config.charsPerTokenProse;

  return Math.ceil(codeTokens + proseTokens);
}

/**
 * Detect if text contains code patterns
 */
function isCodeLike(text: string): boolean {
  // Check for code block markers
  if (text.includes("```") || text.includes("    ")) {
    return true;
  }
  // Check for common code patterns
  const codePatterns = [
    /^(const|let|var|function|class|import|export|if|for|while|return)\s/m,
    /[{};]$/m,
    /^\s*(public|private|protected)\s/m,
    /=>/,
    /\(\)\s*{/,
  ];
  return codePatterns.some((p) => p.test(text));
}

/**
 * Split text into sentences, preserving code blocks
 */
function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];

  // Match code blocks to preserve them
  const codeBlockPattern = /```[\s\S]*?```/g;
  const codeBlocks: Array<{ start: number; end: number; content: string }> = [];

  let match;
  while ((match = codeBlockPattern.exec(text)) !== null) {
    codeBlocks.push({
      start: match.index,
      end: match.index + match[0].length,
      content: match[0],
    });
  }

  // Process text segments between code blocks
  const segments: Array<{ text: string; isCode: boolean }> = [];
  let lastEnd = 0;

  for (const block of codeBlocks) {
    if (block.start > lastEnd) {
      segments.push({ text: text.slice(lastEnd, block.start), isCode: false });
    }
    segments.push({ text: block.content, isCode: true });
    lastEnd = block.end;
  }

  if (lastEnd < text.length) {
    segments.push({ text: text.slice(lastEnd), isCode: false });
  }

  // If no code blocks, treat entire text as prose
  if (segments.length === 0) {
    segments.push({ text, isCode: false });
  }

  // Process each segment
  for (const segment of segments) {
    if (segment.isCode) {
      // Keep code blocks intact
      sentences.push(segment.text);
    } else {
      // Split prose at sentence boundaries
      // Handle common sentence endings: . ! ? followed by space or end
      const sentencePattern = /[^.!?\n]+[.!?]+(?:\s+|$)|[^.!?\n]+$/g;
      let sentenceMatch;

      while ((sentenceMatch = sentencePattern.exec(segment.text)) !== null) {
        const sentence = sentenceMatch[0].trim();
        if (sentence.length > 0) {
          sentences.push(sentence);
        }
      }
    }
  }

  return sentences;
}

/**
 * Merge sentences into chunks respecting token limits
 */
function mergeSentencesIntoChunks(
  sentences: string[],
  config: ChunkingConfig,
  originalText: string
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;
  let currentStartOffset = 0;

  const overlapTokens = Math.floor(config.chunkSize * config.overlap);
  const targetSize = config.chunkSize - overlapTokens;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentenceTokens = estimateTokens(sentence, config);

    // If single sentence exceeds max chunk size, it needs special handling
    if (sentenceTokens > config.maxChunkSize) {
      // Flush current chunk first
      if (currentChunk.length > 0) {
        const content = currentChunk.join(" ");
        const endOffset = originalText.indexOf(content, currentStartOffset) + content.length;

        chunks.push({
          content,
          index: chunks.length,
          totalChunks: 0, // Updated later
          startOffset: currentStartOffset,
          endOffset: Math.min(endOffset, originalText.length),
          estimatedTokens: currentTokens,
          strategy: "sentence",
        });

        currentStartOffset = endOffset;
        currentChunk = [];
        currentTokens = 0;
      }

      // Split long sentence using sliding window fallback
      const words = sentence.split(/\s+/);
      let wordChunk: string[] = [];
      let wordTokens = 0;

      for (const word of words) {
        const wordTokenCount = estimateTokens(word + " ", config);

        if (wordTokens + wordTokenCount > config.maxChunkSize && wordChunk.length > 0) {
          const content = wordChunk.join(" ");
          const offset = originalText.indexOf(content, currentStartOffset);

          chunks.push({
            content,
            index: chunks.length,
            totalChunks: 0,
            startOffset: offset >= 0 ? offset : currentStartOffset,
            endOffset: Math.min((offset >= 0 ? offset : currentStartOffset) + content.length, originalText.length),
            estimatedTokens: wordTokens,
            strategy: "sentence",
          });

          currentStartOffset = offset >= 0 ? offset + content.length : currentStartOffset + content.length;
          wordChunk = [];
          wordTokens = 0;
        }

        wordChunk.push(word);
        wordTokens += wordTokenCount;
      }

      // Add remaining words
      if (wordChunk.length > 0) {
        currentChunk = wordChunk;
        currentTokens = wordTokens;
      }

      continue;
    }

    // Check if adding this sentence would exceed target size
    if (currentTokens + sentenceTokens > targetSize && currentChunk.length > 0) {
      // Create chunk from current sentences
      const content = currentChunk.join(" ");
      const contentIndex = originalText.indexOf(content, currentStartOffset);
      const effectiveStart = contentIndex >= 0 ? contentIndex : currentStartOffset;

      chunks.push({
        content,
        index: chunks.length,
        totalChunks: 0,
        startOffset: effectiveStart,
        endOffset: Math.min(effectiveStart + content.length, originalText.length),
        estimatedTokens: currentTokens,
        strategy: "sentence",
      });

      // Start new chunk with overlap from previous sentences
      const overlapSentences: string[] = [];
      let overlapTokenCount = 0;

      // Add sentences from end of current chunk for overlap
      for (let j = currentChunk.length - 1; j >= 0 && overlapTokenCount < overlapTokens; j--) {
        const overlapSentence = currentChunk[j];
        const tokens = estimateTokens(overlapSentence, config);
        if (overlapTokenCount + tokens <= overlapTokens) {
          overlapSentences.unshift(overlapSentence);
          overlapTokenCount += tokens;
        } else {
          break;
        }
      }

      currentStartOffset = effectiveStart + content.length - overlapSentences.join(" ").length;
      currentChunk = overlapSentences;
      currentTokens = overlapTokenCount;
    }

    currentChunk.push(sentence);
    currentTokens += sentenceTokens;
  }

  // Add final chunk
  if (currentChunk.length > 0) {
    const content = currentChunk.join(" ");
    const contentIndex = originalText.indexOf(content, currentStartOffset);
    const effectiveStart = contentIndex >= 0 ? contentIndex : currentStartOffset;

    chunks.push({
      content,
      index: chunks.length,
      totalChunks: 0,
      startOffset: effectiveStart,
      endOffset: Math.min(effectiveStart + content.length, originalText.length),
      estimatedTokens: currentTokens,
      strategy: "sentence",
    });
  }

  // Update totalChunks for all chunks
  const totalChunks = chunks.length;
  for (const chunk of chunks) {
    chunk.totalChunks = totalChunks;
  }

  return chunks;
}

/**
 * Chunk text using sentence-aware strategy
 */
export function chunkWithSentences(
  text: string,
  config: ChunkingConfig
): ChunkingResult {
  const estimatedTokens = estimateTokens(text, config);

  // Don't chunk if text is small enough
  if (estimatedTokens <= config.chunkSize) {
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
          estimatedTokens,
          strategy: "sentence",
        },
      ],
      strategy: "sentence",
      estimatedTotalTokens: estimatedTokens,
    };
  }

  // Split into sentences
  const sentences = splitIntoSentences(text);

  // Merge into chunks
  const chunks = mergeSentencesIntoChunks(sentences, config, text);

  return {
    originalLength: text.length,
    wasChunked: chunks.length > 1,
    chunks,
    strategy: "sentence",
    estimatedTotalTokens: estimatedTokens,
  };
}

export { estimateTokens, isCodeLike };
