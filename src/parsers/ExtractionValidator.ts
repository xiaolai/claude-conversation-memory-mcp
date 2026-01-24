/**
 * Extraction Validator
 * Validates extracted decisions and mistakes to reduce false positives
 */

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether the extraction is valid */
  isValid: boolean;

  /** Confidence score (0-1) */
  confidence: number;

  /** Reasons for the validation result */
  reasons: string[];

  /** Suggestions for improvement */
  suggestions?: string[];
}

/**
 * Configuration for validation
 */
export interface ValidationConfig {
  /** Minimum text length */
  minLength: number;

  /** Maximum text length */
  maxLength: number;

  /** Required actionable keywords for decisions */
  actionableKeywords: string[];

  /** Session summary artifact patterns to exclude */
  summaryPatterns: RegExp[];

  /** Noise patterns to exclude */
  noisePatterns: RegExp[];

  /** Minimum confidence threshold */
  minConfidence: number;
}

export const DEFAULT_DECISION_VALIDATION_CONFIG: ValidationConfig = {
  minLength: 20,
  maxLength: 500,
  actionableKeywords: [
    "use",
    "implement",
    "choose",
    "adopt",
    "prefer",
    "select",
    "create",
    "build",
    "switch",
    "migrate",
    "upgrade",
    "configure",
    "enable",
    "disable",
    "add",
    "remove",
    "install",
    "setup",
    "design",
    "architect",
    "structure",
    "organize",
    "refactor",
    "optimize",
  ],
  summaryPatterns: [
    /^session summary/i,
    /^conversation summary/i,
    /^in this session/i,
    /^today we/i,
    /^we discussed/i,
    /^the following/i,
    /^here's what/i,
    /^recap:/i,
    /^summary:/i,
  ],
  noisePatterns: [
    /^(yes|no|ok|okay|sure|thanks|thank you|got it)/i,
    /^(hi|hello|hey|good morning|good evening)/i,
    /^(bye|goodbye|see you|later)/i,
    /^\d+\.?\s*$/,
    /^[a-z]\)?\s*$/i,
    /^•\s*$/,
    /^-\s*$/,
  ],
  minConfidence: 0.5,
};

export const DEFAULT_MISTAKE_VALIDATION_CONFIG: ValidationConfig = {
  minLength: 15,
  maxLength: 600,
  actionableKeywords: [
    "error",
    "bug",
    "issue",
    "problem",
    "wrong",
    "incorrect",
    "failed",
    "failure",
    "crash",
    "exception",
    "fix",
    "fixed",
    "broke",
    "broken",
    "mistake",
    "misunderstanding",
    "typo",
    "missing",
    "forgot",
    "overlooked",
  ],
  summaryPatterns: [
    /^session summary/i,
    /^here's what happened/i,
    /^in this session/i,
  ],
  noisePatterns: [
    /^(yes|no|ok|okay|sure|thanks)/i,
    /^\d+\.?\s*$/,
  ],
  minConfidence: 0.4,
};

/**
 * Extraction Validator class
 */
export class ExtractionValidator {
  private config: ValidationConfig;

  constructor(config: ValidationConfig) {
    this.config = config;
  }

  /**
   * Validate an extracted decision
   */
  validateDecision(
    decisionText: string,
    originalContent?: string
  ): ValidationResult {
    const reasons: string[] = [];
    let confidence = 1.0;

    // Check minimum length
    if (decisionText.length < this.config.minLength) {
      reasons.push(`Too short (${decisionText.length} < ${this.config.minLength} chars)`);
      confidence *= 0.3;
    }

    // Check maximum length
    if (decisionText.length > this.config.maxLength) {
      reasons.push(`Too long (${decisionText.length} > ${this.config.maxLength} chars)`);
      confidence *= 0.7;
    }

    // Check for actionable keywords
    const hasActionable = this.hasActionableKeywords(decisionText);
    if (!hasActionable) {
      reasons.push("Missing actionable keywords");
      confidence *= 0.5;
    }

    // Check for session summary artifacts
    const isSummary = this.isSummaryArtifact(decisionText);
    if (isSummary) {
      reasons.push("Appears to be a session summary artifact");
      confidence *= 0.2;
    }

    // Check for noise patterns
    const isNoise = this.isNoisePattern(decisionText);
    if (isNoise) {
      reasons.push("Matches noise pattern");
      confidence *= 0.1;
    }

    // Verify content appears in source (if provided)
    if (originalContent) {
      const verified = this.verifyInSource(decisionText, originalContent);
      if (!verified) {
        reasons.push("Content not found in source");
        confidence *= 0.6;
      }
    }

    // Check for proper structure (sentences, not just keywords)
    if (!this.hasProperStructure(decisionText)) {
      reasons.push("Lacks proper sentence structure");
      confidence *= 0.7;
    }

    const isValid = confidence >= this.config.minConfidence && !isNoise && !isSummary;

    return {
      isValid,
      confidence,
      reasons: reasons.length > 0 ? reasons : ["Passed all validation checks"],
      suggestions: isValid ? undefined : this.generateSuggestions(reasons),
    };
  }

  /**
   * Validate an extracted mistake
   */
  validateMistake(
    mistakeText: string,
    originalContent?: string
  ): ValidationResult {
    const reasons: string[] = [];
    let confidence = 1.0;

    // Check minimum length
    if (mistakeText.length < this.config.minLength) {
      reasons.push(`Too short (${mistakeText.length} < ${this.config.minLength} chars)`);
      confidence *= 0.3;
    }

    // Check maximum length
    if (mistakeText.length > this.config.maxLength) {
      reasons.push(`Too long (${mistakeText.length} > ${this.config.maxLength} chars)`);
      confidence *= 0.7;
    }

    // Check for error-related keywords
    const hasErrorKeyword = this.hasActionableKeywords(mistakeText);
    if (!hasErrorKeyword) {
      reasons.push("Missing error/mistake keywords");
      confidence *= 0.5;
    }

    // Check for session summary artifacts
    const isSummary = this.isSummaryArtifact(mistakeText);
    if (isSummary) {
      reasons.push("Appears to be a session summary artifact");
      confidence *= 0.2;
    }

    // Check for noise patterns
    const isNoise = this.isNoisePattern(mistakeText);
    if (isNoise) {
      reasons.push("Matches noise pattern");
      confidence *= 0.1;
    }

    // Verify content appears in source (if provided)
    if (originalContent) {
      const verified = this.verifyInSource(mistakeText, originalContent);
      if (!verified) {
        reasons.push("Content not found in source");
        confidence *= 0.6;
      }
    }

    const isValid = confidence >= this.config.minConfidence && !isNoise && !isSummary;

    return {
      isValid,
      confidence,
      reasons: reasons.length > 0 ? reasons : ["Passed all validation checks"],
      suggestions: isValid ? undefined : this.generateSuggestions(reasons),
    };
  }

  /**
   * Check if text contains actionable keywords
   */
  private hasActionableKeywords(text: string): boolean {
    const lowerText = text.toLowerCase();
    return this.config.actionableKeywords.some((keyword) =>
      lowerText.includes(keyword)
    );
  }

  /**
   * Check if text is a session summary artifact
   */
  private isSummaryArtifact(text: string): boolean {
    return this.config.summaryPatterns.some((pattern) => pattern.test(text));
  }

  /**
   * Check if text matches noise patterns
   */
  private isNoisePattern(text: string): boolean {
    const trimmed = text.trim();
    return this.config.noisePatterns.some((pattern) => pattern.test(trimmed));
  }

  /**
   * Verify that extracted content appears in source
   */
  private verifyInSource(extracted: string, source: string): boolean {
    // Normalize both for comparison
    const normalizedExtracted = extracted.toLowerCase().replace(/\s+/g, " ");
    const normalizedSource = source.toLowerCase().replace(/\s+/g, " ");

    // Check for substantial overlap (at least 50% of extracted text)
    const words = normalizedExtracted.split(" ");
    const minWords = Math.ceil(words.length * 0.5);
    let foundWords = 0;

    for (const word of words) {
      if (word.length > 3 && normalizedSource.includes(word)) {
        foundWords++;
      }
    }

    return foundWords >= minWords;
  }

  /**
   * Check if text has proper sentence structure
   */
  private hasProperStructure(text: string): boolean {
    // Should have at least one verb-like word
    const verbPatterns = /\b(is|are|was|were|be|been|use|implement|choose|create|make|do|does|did|has|have|had|will|would|could|should|can|may|might)\b/i;

    // Should have reasonable word count
    const words = text.split(/\s+/).filter((w) => w.length > 0);

    return verbPatterns.test(text) && words.length >= 3;
  }

  /**
   * Generate suggestions based on validation failures
   */
  private generateSuggestions(reasons: string[]): string[] {
    const suggestions: string[] = [];

    for (const reason of reasons) {
      if (reason.includes("Too short")) {
        suggestions.push("Provide more context about the decision/mistake");
      }
      if (reason.includes("Too long")) {
        suggestions.push("Consider breaking into multiple, focused extractions");
      }
      if (reason.includes("Missing actionable keywords")) {
        suggestions.push("Include specific technical terms or action verbs");
      }
      if (reason.includes("summary artifact")) {
        suggestions.push("Extract specific decisions, not summaries");
      }
      if (reason.includes("noise pattern")) {
        suggestions.push("Focus on substantive technical content");
      }
    }

    return suggestions;
  }
}

/**
 * Get a decision validator
 */
export function getDecisionValidator(
  config?: Partial<ValidationConfig>
): ExtractionValidator {
  return new ExtractionValidator({
    ...DEFAULT_DECISION_VALIDATION_CONFIG,
    ...config,
  });
}

/**
 * Get a mistake validator
 */
export function getMistakeValidator(
  config?: Partial<ValidationConfig>
): ExtractionValidator {
  return new ExtractionValidator({
    ...DEFAULT_MISTAKE_VALIDATION_CONFIG,
    ...config,
  });
}
