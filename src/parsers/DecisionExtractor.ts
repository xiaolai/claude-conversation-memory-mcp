/**
 * Decision Extractor - Identifies and extracts decisions from conversations.
 *
 * This extractor analyzes conversation messages and thinking blocks to identify
 * technical and architectural decisions made during development. It captures:
 * - What decision was made
 * - Why it was made (rationale)
 * - What alternatives were considered
 * - Why alternatives were rejected
 * - Context (what the decision was about)
 *
 * Uses pattern matching to detect decision indicators like "we decided to",
 * "using X instead of Y because", and user corrections.
 *
 * @example
 * ```typescript
 * const extractor = new DecisionExtractor();
 * const decisions = extractor.extractDecisions(messages, thinkingBlocks);
 * console.log(`Found ${decisions.length} decisions`);
 * decisions.forEach(d => {
 *   console.log(`Decision: ${d.decision_text}`);
 *   console.log(`Rationale: ${d.rationale}`);
 * });
 * ```
 */

import { nanoid } from "nanoid";
import type { Message, ThinkingBlock } from "./ConversationParser.js";

/**
 * Represents a technical or architectural decision made during development.
 */
export interface Decision {
  /** Unique decision identifier */
  id: string;
  /** Conversation where this decision was made */
  conversation_id: string;
  /** Message containing the decision */
  message_id: string;
  /** The decision that was made */
  decision_text: string;
  /** Why this decision was made */
  rationale?: string;
  /** Alternative approaches that were considered */
  alternatives_considered: string[];
  /** Reasons why alternatives were rejected */
  rejected_reasons: Record<string, string>;
  /** Context/domain of the decision (e.g., 'database', 'authentication') */
  context?: string;
  /** Files affected by this decision */
  related_files: string[];
  /** Git commits implementing this decision */
  related_commits: string[];
  /** When the decision was made */
  timestamp: number;
}

/**
 * Extracts technical and architectural decisions from conversation history.
 *
 * Analyzes messages and thinking blocks using pattern matching to identify
 * decisions, rationale, alternatives, and context.
 */
export class DecisionExtractor {
  // Minimum quality score required to store a decision
  private readonly MIN_QUALITY_SCORE = 2;

  // Patterns that indicate noise/garbage to filter out
  private readonly NOISE_PATTERNS = [
    /this session is being continued/i,
    /conversation is summarized below/i,
    /previous conversation that ran out of context/i,
    /here is the summary/i,
    /summary of the conversation/i,
    /context from previous session/i,
    /let me summarize/i,
    /to summarize what we've done/i,
    /^I'll help you/i,
    /^Let me help you/i,
    /^Sure,? I can/i,
    /^I understand/i,
    /^Great question/i,
  ];

  // Decision pattern indicators - more focused on technical decisions
  private readonly DECISION_PATTERNS = [
    // Technical decision with comparison and rationale
    /(?:using|use|implement|adopt)\s+(.+?)\s+(?:instead of|over|rather than)\s+(.+?)\s+(?:because|since|as|for)\s+(.+?)(?:\.|$)/gi,
    // Explicit architectural decision
    /(?:architectural|technical|design)\s+decision:\s*(.+?)(?:\.|$)/gi,
    // We decided with clear rationale
    /(?:we|i)\s+(?:decided|chose)\s+(?:to\s+)?(.+?)\s+(?:because|since|due to|for)\s+(.+?)(?:\.|$)/gi,
    // Rejected alternative with reason
    /(?:rejected|dismissed|avoided|ruled out)\s+(.+?)\s+(?:because|due to|since|as)\s+(.+?)(?:\.|$)/gi,
  ];

  // Correction patterns - stricter, require technical context
  private readonly CORRECTION_PATTERNS = [
    // "No, use X instead of Y"
    /^no[,\s]+(?:use|implement|go with)\s+(.+?)\s+(?:instead|rather)/i,
    // "Actually, we should use X because Y"
    /^actually[,\s]+(?:we should|you should|use|implement)\s+(.+?)\s+(?:because|since)/i,
    // "That's wrong, the correct approach is X"
    /that'?s?\s+(?:wrong|incorrect)[,\s]+(?:the correct|use|we should)\s+(.+)/i,
    // "Don't use X, use Y instead"
    /don't\s+(?:use|implement)\s+(.+?)[,\s]+(?:use|implement)\s+(.+)/i,
  ];

  // Context keywords to identify what the decision is about
  private readonly CONTEXT_KEYWORDS = [
    "authentication",
    "auth",
    "database",
    "api",
    "frontend",
    "backend",
    "testing",
    "deployment",
    "security",
    "performance",
    "architecture",
    "design pattern",
    "library",
    "framework",
    "optimization",
  ];

  /**
   * Extract decisions from messages and thinking blocks.
   *
   * Analyzes conversation messages to identify decisions using pattern matching.
   * Looks for explicit decision statements, user corrections, and thinking blocks
   * that contain decision-making processes.
   *
   * @param messages - Array of conversation messages to analyze
   * @param thinkingBlocks - Array of thinking blocks (Claude's internal reasoning)
   * @returns Array of extracted Decision objects
   *
   * @example
   * ```typescript
   * const extractor = new DecisionExtractor();
   * const decisions = extractor.extractDecisions(messages, thinkingBlocks);
   *
   * // Find decisions about databases
   * const dbDecisions = decisions.filter(d => d.context?.includes('database'));
   * ```
   */
  extractDecisions(
    messages: Message[],
    thinkingBlocks: ThinkingBlock[]
  ): Decision[] {
    const decisions: Decision[] = [];

    // Extract from assistant messages with thinking blocks
    for (const message of messages) {
      if (message.role === "assistant" && message.content) {
        // Skip messages that are noise (session summaries, etc.)
        if (this.isNoiseContent(message.content)) {
          continue;
        }

        const thinking = thinkingBlocks.find((t) => t.message_id === message.id);

        // Check for explicit decisions in message content
        const explicitDecisions = this.extractExplicitDecisions(message, thinking);
        decisions.push(...explicitDecisions);
      }

      // Extract from user corrections
      if (message.role === "user" && message.content) {
        // Skip noise content
        if (this.isNoiseContent(message.content)) {
          continue;
        }
        const corrections = this.extractCorrections(message);
        decisions.push(...corrections);
      }
    }

    // Deduplicate similar decisions
    const deduplicated = this.deduplicateDecisions(decisions);

    // Filter by quality score
    return deduplicated.filter(
      (d) => this.scoreDecisionImportance(d) >= this.MIN_QUALITY_SCORE
    );
  }

  /**
   * Check if content is noise that should be filtered out
   */
  private isNoiseContent(content: string): boolean {
    const firstChunk = content.substring(0, 500);
    return this.NOISE_PATTERNS.some((pattern) => pattern.test(firstChunk));
  }

  /**
   * Extract explicit decisions from assistant messages
   */
  private extractExplicitDecisions(
    message: Message,
    thinkingBlock?: ThinkingBlock
  ): Decision[] {
    const decisions: Decision[] = [];
    const content = message.content || "";
    const thinkingContent = thinkingBlock?.thinking_content || "";
    const combinedContent = `${content}\n${thinkingContent}`;

    // Look for decision patterns
    for (const pattern of this.DECISION_PATTERNS) {
      const matches = Array.from(combinedContent.matchAll(pattern));

      for (const match of matches) {
        const decision = this.parseDecisionMatch(match, message, thinkingBlock);
        if (decision) {
          decisions.push(decision);
        }
      }
    }

    // Extract from structured decision statements
    const structuredDecisions = this.extractStructuredDecisions(
      combinedContent,
      message,
      thinkingBlock
    );
    decisions.push(...structuredDecisions);

    return decisions;
  }

  /**
   * Parse a regex match into a Decision object
   */
  private parseDecisionMatch(
    match: RegExpMatchArray,
    message: Message,
    _thinking?: ThinkingBlock
  ): Decision | null {
    if (!match[0]) {return null;}

    const fullText = match[0];
    const decisionText = this.extractDecisionText(fullText);
    const rationale = this.extractRationale(fullText);

    // Extract context (what this decision is about)
    const context = this.identifyContext(fullText);

    // Extract related files from message metadata
    const relatedFiles = this.extractRelatedFiles(message);

    return {
      id: nanoid(),
      conversation_id: message.conversation_id,
      message_id: message.id,
      decision_text: decisionText,
      rationale,
      alternatives_considered: this.extractAlternatives(fullText),
      rejected_reasons: this.extractRejectedReasons(fullText),
      context,
      related_files: relatedFiles,
      related_commits: [], // Will be filled by GitIntegrator
      timestamp: message.timestamp,
    };
  }

  /**
   * Extract structured decisions (e.g., "Decision: ..." format)
   */
  private extractStructuredDecisions(
    content: string,
    message: Message,
    _thinking?: ThinkingBlock
  ): Decision[] {
    const decisions: Decision[] = [];

    // Look for structured decision blocks
    const decisionBlockPattern =
      /(?:Decision|Chose|Selected|Using):\s*([^\n]+)(?:\s*Rationale:\s*([^\n]+))?(?:\s*Alternatives:\s*([^\n]+))?/gi;

    const matches = Array.from(content.matchAll(decisionBlockPattern));

    for (const match of matches) {
      const decisionText = match[1]?.trim();
      if (!decisionText) {continue;}

      const rationale = match[2]?.trim();
      const alternativesText = match[3]?.trim();

      const alternatives = alternativesText
        ? alternativesText.split(/,|;/).map((a) => a.trim())
        : [];

      decisions.push({
        id: nanoid(),
        conversation_id: message.conversation_id,
        message_id: message.id,
        decision_text: decisionText,
        rationale,
        alternatives_considered: alternatives,
        rejected_reasons: {},
        context: this.identifyContext(content),
        related_files: this.extractRelatedFiles(message),
        related_commits: [],
        timestamp: message.timestamp,
      });
    }

    return decisions;
  }

  /**
   * Extract decisions from user corrections
   */
  private extractCorrections(message: Message): Decision[] {
    const content = message.content || "";
    const decisions: Decision[] = [];

    // Check each correction pattern and extract structured data
    for (const pattern of this.CORRECTION_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        // Extract the decision from the capture groups
        const decisionText = match[1]?.trim() || match[0];
        const alternative = match[2]?.trim();

        // Must have technical context to be a valid correction
        const context = this.identifyContext(content);
        if (!context && !this.hasTechnicalKeywords(content)) {
          continue;
        }

        decisions.push({
          id: nanoid(),
          conversation_id: message.conversation_id,
          message_id: message.id,
          decision_text: alternative
            ? `Use ${alternative} instead of ${decisionText}`
            : decisionText,
          rationale: "User correction - previous approach was incorrect",
          alternatives_considered: alternative ? [decisionText] : [],
          rejected_reasons: alternative
            ? { [decisionText]: "user rejected" }
            : { "previous approach": "user rejected" },
          context,
          related_files: this.extractRelatedFiles(message),
          related_commits: [],
          timestamp: message.timestamp,
        });
        break; // Only extract one correction per message
      }
    }

    return decisions;
  }

  /**
   * Check if content contains technical keywords suggesting a real decision
   */
  private hasTechnicalKeywords(content: string): boolean {
    const technicalKeywords = [
      "function",
      "class",
      "method",
      "variable",
      "import",
      "export",
      "component",
      "module",
      "package",
      "library",
      "framework",
      "database",
      "query",
      "api",
      "endpoint",
      "route",
      "config",
      "setting",
      "type",
      "interface",
      "schema",
    ];
    const lowerContent = content.toLowerCase();
    return technicalKeywords.some((kw) => lowerContent.includes(kw));
  }

  /**
   * Extract decision text from matched pattern
   */
  private extractDecisionText(text: string): string {
    // Remove common prefixes
    let cleaned = text.replace(
      /^(?:we|i|let's)\s+(?:decided|choose|chose|went with|picked|selected)\s+(?:to\s+)?/i,
      ""
    );

    // Remove trailing explanation
    cleaned = cleaned.replace(/\s+(?:because|since|as|for|due to).+$/i, "");

    return cleaned.trim();
  }

  /**
   * Extract rationale from decision text
   */
  private extractRationale(text: string): string | undefined {
    const rationaleMatch = text.match(/(?:because|since|as|for|due to)\s+(.+?)(?:\.|$)/i);
    return rationaleMatch?.[1]?.trim();
  }

  /**
   * Extract alternative approaches that were considered
   */
  private extractAlternatives(text: string): string[] {
    const alternatives: string[] = [];

    // Look for "instead of X" patterns
    const insteadOfMatch = text.match(/(?:instead of|over|rather than)\s+(.+?)(?:\s+because|$)/i);
    if (insteadOfMatch) {
      alternatives.push(insteadOfMatch[1].trim());
    }

    // Look for "considered X, Y, and Z"
    const consideredMatch = text.match(/considered\s+(.+?)(?:\s+but|$)/i);
    if (consideredMatch) {
      const items = consideredMatch[1].split(/,|and/).map((s) => s.trim());
      alternatives.push(...items);
    }

    return alternatives;
  }

  /**
   * Extract reasons for rejecting alternatives
   */
  private extractRejectedReasons(text: string): Record<string, string> {
    const reasons: Record<string, string> = {};

    // Look for "rejected X because Y" patterns
    const rejectedPattern =
      /(?:rejected|dismissed|avoided|didn't use)\s+(.+?)\s+(?:because|due to|since)\s+(.+?)(?:\.|$)/gi;

    const matches = Array.from(text.matchAll(rejectedPattern));

    for (const match of matches) {
      const alternative = match[1]?.trim();
      const reason = match[2]?.trim();
      if (alternative && reason) {
        reasons[alternative] = reason;
      }
    }

    return reasons;
  }

  /**
   * Identify what context/area this decision relates to
   */
  private identifyContext(text: string): string | undefined {
    const lowerText = text.toLowerCase();

    for (const keyword of this.CONTEXT_KEYWORDS) {
      if (lowerText.includes(keyword)) {
        return keyword;
      }
    }

    return undefined;
  }

  /**
   * Extract related files from message metadata
   */
  private extractRelatedFiles(message: Message): string[] {
    const files: string[] = [];

    // Check message metadata for file references
    if (message.metadata) {
      // Look for file paths in various metadata fields
      const metadataStr = JSON.stringify(message.metadata);
      const filePathPattern = /(?:\/[\w-]+)+\.[\w]+/g;
      const matches = metadataStr.match(filePathPattern);

      if (matches) {
        files.push(...matches);
      }
    }

    return [...new Set(files)]; // Deduplicate
  }

  /**
   * Deduplicate similar decisions
   */
  private deduplicateDecisions(decisions: Decision[]): Decision[] {
    const unique: Decision[] = [];
    const seen = new Set<string>();

    for (const decision of decisions) {
      // Create a signature including message_id to avoid collisions
      // between different decisions with similar text in the same conversation
      const textPrefix = decision.decision_text.toLowerCase().substring(0, 100);
      const signature = `${decision.message_id}_${textPrefix}_${decision.timestamp}`;

      if (!seen.has(signature)) {
        seen.add(signature);
        unique.push(decision);
      }
    }

    return unique;
  }

  /**
   * Score a decision's importance (for prioritization)
   */
  scoreDecisionImportance(decision: Decision): number {
    let score = 0;

    // Has rationale
    if (decision.rationale) {score += 2;}

    // Has alternatives considered
    if (decision.alternatives_considered.length > 0) {score += 3;}

    // Has rejected reasons
    if (Object.keys(decision.rejected_reasons).length > 0) {score += 3;}

    // Has related files
    if (decision.related_files.length > 0) {score += 2;}

    // Has context
    if (decision.context) {score += 1;}

    // Is a correction (high importance)
    if (decision.rationale?.includes("User correction")) {score += 5;}

    return score;
  }
}
