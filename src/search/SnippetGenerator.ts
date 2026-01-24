/**
 * Snippet Generator
 * Generates context-aware snippets with query term highlighting
 */

/**
 * Configuration for snippet generation
 */
export interface SnippetConfig {
  /** Target snippet length in characters */
  targetLength: number;

  /** Context before match (characters) */
  contextBefore: number;

  /** Context after match (characters) */
  contextAfter: number;

  /** Whether to highlight query terms */
  highlight: boolean;

  /** Highlight format (markdown bold by default) */
  highlightStart: string;
  highlightEnd: string;

  /** Ellipsis character for truncation */
  ellipsis: string;

  /** Whether to prefer sentence boundaries */
  preferSentenceBoundaries: boolean;
}

export const DEFAULT_SNIPPET_CONFIG: SnippetConfig = {
  targetLength: 200,
  contextBefore: 60,
  contextAfter: 120,
  highlight: true,
  highlightStart: "**",
  highlightEnd: "**",
  ellipsis: "...",
  preferSentenceBoundaries: true,
};

/**
 * Information about a snippet match
 */
export interface SnippetMatch {
  start: number;
  end: number;
  term: string;
}

/**
 * Snippet Generator class
 */
export class SnippetGenerator {
  private config: SnippetConfig;

  constructor(config?: Partial<SnippetConfig>) {
    this.config = { ...DEFAULT_SNIPPET_CONFIG, ...config };
  }

  /**
   * Generate a snippet from content highlighting query terms
   */
  generate(content: string, query: string): string {
    if (!content || content.length === 0) {
      return "";
    }

    // Tokenize query into terms
    const queryTerms = this.tokenizeQuery(query);

    if (queryTerms.length === 0) {
      // No query terms - return beginning of content
      return this.truncateToLength(content, this.config.targetLength);
    }

    // Find all matches in content
    const matches = this.findMatches(content, queryTerms);

    if (matches.length === 0) {
      // No matches found - return beginning of content
      return this.truncateToLength(content, this.config.targetLength);
    }

    // Find the best region using sliding window
    const bestRegion = this.findBestRegion(content, matches);

    // Extract snippet from best region
    let snippet = this.extractRegion(content, bestRegion.start, bestRegion.end);

    // Highlight query terms if enabled
    if (this.config.highlight) {
      snippet = this.highlightTerms(snippet, queryTerms);
    }

    return snippet;
  }

  /**
   * Tokenize query into searchable terms
   */
  private tokenizeQuery(query: string): string[] {
    // Split on whitespace and filter short words
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    // Remove common stop words
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "is",
      "it",
      "as",
      "be",
      "was",
      "are",
      "were",
      "been",
      "has",
      "have",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "can",
      "this",
      "that",
      "these",
      "those",
      "i",
      "you",
      "we",
      "they",
      "he",
      "she",
    ]);

    return words.filter((w) => !stopWords.has(w));
  }

  /**
   * Find all matches of query terms in content
   */
  private findMatches(content: string, terms: string[]): SnippetMatch[] {
    const matches: SnippetMatch[] = [];
    const lowerContent = content.toLowerCase();

    for (const term of terms) {
      let index = 0;
      while (true) {
        const pos = lowerContent.indexOf(term, index);
        if (pos === -1) {break;}

        matches.push({
          start: pos,
          end: pos + term.length,
          term,
        });

        index = pos + 1;
      }
    }

    // Sort by position
    matches.sort((a, b) => a.start - b.start);

    return matches;
  }

  /**
   * Find the best region using sliding window density
   */
  private findBestRegion(
    content: string,
    matches: SnippetMatch[]
  ): { start: number; end: number } {
    const windowSize = this.config.targetLength;

    if (content.length <= windowSize) {
      return { start: 0, end: content.length };
    }

    let bestStart = 0;
    let bestScore = 0;

    // Slide window across content
    for (let start = 0; start <= content.length - windowSize; start += 10) {
      const end = Math.min(start + windowSize, content.length);

      // Count matches in window
      let score = 0;
      for (const match of matches) {
        if (match.start >= start && match.end <= end) {
          // Full match in window
          score += 2;
        } else if (
          (match.start >= start && match.start < end) ||
          (match.end > start && match.end <= end)
        ) {
          // Partial match
          score += 1;
        }
      }

      // Bonus for starting near sentence boundary
      if (this.config.preferSentenceBoundaries) {
        const before = content.slice(Math.max(0, start - 5), start);
        if (/[.!?]\s*$/.test(before) || start === 0) {
          score += 0.5;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestStart = start;
      }
    }

    return {
      start: bestStart,
      end: Math.min(bestStart + windowSize, content.length),
    };
  }

  /**
   * Extract a region from content with proper boundaries
   */
  private extractRegion(content: string, start: number, end: number): string {
    // Adjust to word boundaries
    let adjustedStart = start;
    let adjustedEnd = end;

    // Find word boundary for start (search backward)
    if (start > 0) {
      while (adjustedStart > 0 && !/\s/.test(content[adjustedStart - 1])) {
        adjustedStart--;
      }
      // If we're in the middle of content, trim to word start
      if (adjustedStart > 0) {
        // Skip leading whitespace
        while (adjustedStart < content.length && /\s/.test(content[adjustedStart])) {
          adjustedStart++;
        }
      }
    }

    // Find word boundary for end (search forward)
    if (end < content.length) {
      while (adjustedEnd < content.length && !/\s/.test(content[adjustedEnd])) {
        adjustedEnd++;
      }
    }

    // Extract the region
    let snippet = content.slice(adjustedStart, adjustedEnd).trim();

    // Add ellipsis if truncated
    if (adjustedStart > 0) {
      snippet = this.config.ellipsis + snippet;
    }
    if (adjustedEnd < content.length) {
      snippet = snippet + this.config.ellipsis;
    }

    return snippet;
  }

  /**
   * Highlight query terms in snippet
   */
  private highlightTerms(snippet: string, terms: string[]): string {
    let result = snippet;

    // Sort terms by length (longest first) to avoid partial replacements
    const sortedTerms = [...terms].sort((a, b) => b.length - a.length);

    for (const term of sortedTerms) {
      // Use word boundary-aware regex for highlighting
      const regex = new RegExp(`(${this.escapeRegex(term)})`, "gi");
      result = result.replace(
        regex,
        `${this.config.highlightStart}$1${this.config.highlightEnd}`
      );
    }

    return result;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Truncate content to target length at word boundary
   */
  private truncateToLength(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }

    // Find word boundary near max length
    let end = maxLength;
    while (end > 0 && !/\s/.test(content[end])) {
      end--;
    }

    // If we couldn't find a space, just cut at maxLength
    if (end === 0) {
      end = maxLength;
    }

    return content.slice(0, end).trim() + this.config.ellipsis;
  }
}

/**
 * Get or create a snippet generator
 */
export function getSnippetGenerator(config?: Partial<SnippetConfig>): SnippetGenerator {
  return new SnippetGenerator(config);
}

/**
 * Generate a snippet using default configuration
 */
export function generateSnippet(content: string, query: string): string {
  const generator = new SnippetGenerator();
  return generator.generate(content, query);
}
