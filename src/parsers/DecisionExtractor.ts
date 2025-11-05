/**
 * Decision Extractor
 * Identifies and extracts decisions from conversations to prevent regressions
 */

import { nanoid } from "nanoid";
import type { Message, ThinkingBlock } from "./ConversationParser.js";

export interface Decision {
  id: string;
  conversation_id: string;
  message_id: string;
  decision_text: string;
  rationale?: string;
  alternatives_considered: string[];
  rejected_reasons: Record<string, string>;
  context?: string;
  related_files: string[];
  related_commits: string[];
  timestamp: number;
}

export class DecisionExtractor {
  // Decision pattern indicators
  private readonly DECISION_PATTERNS = [
    /(?:we|i|let's)\s+(?:decided|choose|chose|went with|picked|selected)\s+(?:to\s+)?(.+?(?:because|since|as|for|due to))/gi,
    /(?:using|use|implement|go with|adopt)\s+(.+?)\s+(?:instead of|over|rather than)\s+(.+?)\s+(?:because|since|as)/gi,
    /(?:decision|chose|selected|picked):\s*(.+?)(?:\.|$)/gi,
    /(?:rationale|reason|why):\s*(.+?)(?:\.|$)/gi,
    /(?:rejected|dismissed|avoided|didn't use)\s+(.+?)\s+(?:because|due to|since)/gi,
  ];

  // Correction patterns (user correcting assistant)
  private readonly CORRECTION_PATTERNS = [
    /^no[,\s]+/i,
    /that'?s?\s+(?:wrong|incorrect|not right)/i,
    /actually[,\s]+/i,
    /instead[,\s]+(?:we should|you should|do)/i,
    /don't\s+(?:do that|use that)/i,
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
   * Extract decisions from messages and thinking blocks
   */
  extractDecisions(
    messages: Message[],
    thinkingBlocks: ThinkingBlock[]
  ): Decision[] {
    const decisions: Decision[] = [];

    // Extract from assistant messages with thinking blocks
    for (const message of messages) {
      if (message.role === "assistant" && message.content) {
        const thinking = thinkingBlocks.find((t) => t.message_id === message.id);

        // Check for explicit decisions in message content
        const explicitDecisions = this.extractExplicitDecisions(message, thinking);
        decisions.push(...explicitDecisions);
      }

      // Extract from user corrections
      if (message.role === "user" && message.content) {
        const corrections = this.extractCorrections(message);
        decisions.push(...corrections);
      }
    }

    // Deduplicate similar decisions
    return this.deduplicateDecisions(decisions);
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

    // Check if this is a correction
    const isCorrection = this.CORRECTION_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (!isCorrection) {return [];}

    // Extract what the correction is about
    const correctionText = content.replace(/^(no[,\s]+|actually[,\s]+)/i, "").trim();

    return [
      {
        id: nanoid(),
        conversation_id: message.conversation_id,
        message_id: message.id,
        decision_text: correctionText,
        rationale: "User correction - previous approach was incorrect",
        alternatives_considered: [],
        rejected_reasons: { "previous approach": "user rejected" },
        context: this.identifyContext(content),
        related_files: this.extractRelatedFiles(message),
        related_commits: [],
        timestamp: message.timestamp,
      },
    ];
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
      // Create a signature for the decision
      const signature = `${decision.decision_text.toLowerCase()}_${decision.timestamp}`.substring(
        0,
        100
      );

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
