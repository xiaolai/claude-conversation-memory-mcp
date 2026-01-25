/**
 * Solution Pattern Extractor - Identifies reusable solution patterns from conversations.
 *
 * This extractor analyzes conversation history to identify successful solutions
 * that can be reused for similar problems. It captures:
 * - Problem type/category
 * - Solution approach
 * - Code pattern or technique used
 * - Prerequisites/dependencies
 * - When to apply this solution
 * - When NOT to apply this solution
 *
 * @example
 * ```typescript
 * const extractor = new SolutionPatternExtractor();
 * const patterns = extractor.extractPatterns(messages, toolUses, toolResults);
 * patterns.forEach(p => {
 *   console.log(`Problem: ${p.problem_category}`);
 *   console.log(`Solution: ${p.solution_summary}`);
 *   console.log(`Applies when: ${p.applies_when}`);
 * });
 * ```
 */

import { nanoid } from "nanoid";
import type { Message, ToolUse, ToolResult } from "./ConversationParser.js";

/**
 * Represents a reusable solution pattern extracted from conversation history.
 */
export interface SolutionPattern {
  /** Unique pattern identifier */
  id: string;
  /** Conversation where this pattern was identified */
  conversation_id: string;
  /** Message where solution was applied */
  message_id: string;
  /** Category of problem this solves */
  problem_category: string;
  /** Brief description of the problem */
  problem_description: string;
  /** Summary of the solution */
  solution_summary: string;
  /** Detailed solution steps */
  solution_steps: string[];
  /** Code snippet or technique */
  code_pattern?: string;
  /** Technology/framework involved */
  technology: string[];
  /** Prerequisites for this solution */
  prerequisites: string[];
  /** When to apply this solution */
  applies_when: string;
  /** When NOT to apply this solution */
  avoid_when?: string;
  /** Files where this pattern was applied */
  applied_to_files: string[];
  /** How well did this work */
  effectiveness: "excellent" | "good" | "moderate" | "poor";
  /** When the pattern was identified */
  timestamp: number;
}

/**
 * Extracts reusable solution patterns from conversation history.
 */
export class SolutionPatternExtractor {
  // Noise patterns to filter out
  private readonly NOISE_PATTERNS = [
    /this session is being continued/i,
    /conversation is summarized below/i,
    /previous conversation that ran out of context/i,
  ];

  // Problem category patterns
  private readonly CATEGORY_PATTERNS: Record<string, RegExp[]> = {
    "error-handling": [
      /(?:error|exception|try|catch|throw)/i,
      /(?:handling errors?|error handling)/i,
    ],
    "performance": [
      /(?:performance|optimization|slow|fast|efficient)/i,
      /(?:caching|memoization|lazy)/i,
    ],
    "authentication": [
      /(?:auth|authentication|authorization|login|session|token)/i,
      /(?:jwt|oauth|credentials)/i,
    ],
    "database": [
      /(?:database|db|sql|query|migration)/i,
      /(?:sqlite|postgres|mysql|mongodb)/i,
    ],
    "api-design": [
      /(?:api|endpoint|route|rest|graphql)/i,
      /(?:request|response|http)/i,
    ],
    "testing": [
      /(?:test|testing|spec|jest|mocha)/i,
      /(?:unit test|integration test|e2e)/i,
    ],
    "refactoring": [
      /(?:refactor|restructure|reorganize|clean)/i,
      /(?:extract|inline|rename)/i,
    ],
    "configuration": [
      /(?:config|configuration|settings|environment)/i,
      /(?:env|dotenv|.env)/i,
    ],
    "file-operations": [
      /(?:file|read|write|path|directory)/i,
      /(?:fs|filesystem|io)/i,
    ],
    "async-patterns": [
      /(?:async|await|promise|callback)/i,
      /(?:concurrent|parallel|sequential)/i,
    ],
  };

  // Solution indicator patterns
  private readonly SOLUTION_PATTERNS = [
    /(?:the (?:solution|fix|answer) is to)\s+(.+?)(?:\.|$)/i,
    /(?:(?:to )?(?:solve|fix|resolve) this)[,\s]+(.+?)(?:\.|$)/i,
    /(?:the (?:correct|right|proper) (?:way|approach) is to)\s+(.+?)(?:\.|$)/i,
    /(?:(?:you (?:can|should)|we (?:can|should)) (?:use|apply|implement))\s+(.+?)(?:\.|$)/i,
    /(?:here's how to (?:fix|solve|handle) it)[:\s]+(.+?)(?:\.|$)/i,
    /(?:the (?:trick|key) is to)\s+(.+?)(?:\.|$)/i,
  ];

  // Applies when patterns
  private readonly APPLIES_WHEN_PATTERNS = [
    /(?:when (?:you|we) (?:need|want) to)\s+(.+?)(?:\.|,|$)/i,
    /(?:if (?:you|we) (?:have|encounter|see))\s+(.+?)(?:\.|,|$)/i,
    /(?:for (?:situations|cases) (?:where|when))\s+(.+?)(?:\.|,|$)/i,
    /(?:this is useful when)\s+(.+?)(?:\.|,|$)/i,
  ];

  // Avoid when patterns
  private readonly AVOID_WHEN_PATTERNS = [
    /(?:(?:don't|do not) use this (?:when|if))\s+(.+?)(?:\.|,|$)/i,
    /(?:avoid (?:this|using this) (?:when|if))\s+(.+?)(?:\.|,|$)/i,
    /(?:this (?:won't|doesn't) work (?:when|if))\s+(.+?)(?:\.|,|$)/i,
    /(?:not (?:suitable|appropriate) (?:for|when))\s+(.+?)(?:\.|,|$)/i,
  ];

  // Technology extraction patterns
  private readonly TECH_PATTERNS = [
    /(?:using|with|via)\s+([\w.-]+(?:\s+[\w.-]+)?)/gi,
    /(?:in|for)\s+(typescript|javascript|python|ruby|go|rust)/gi,
    /(?:react|vue|angular|svelte|next\.?js|node\.?js|express|fastify)/gi,
    /(?:jest|mocha|pytest|rspec|vitest)/gi,
  ];

  // Effectiveness indicators
  private readonly EFFECTIVENESS_PATTERNS = {
    excellent: [
      /(?:works? (?:perfectly|great|excellently))/i,
      /(?:exactly what (?:we|I) needed)/i,
      /(?:solves? the problem completely)/i,
    ],
    good: [
      /(?:works? (?:well|correctly|fine))/i,
      /(?:this (?:fixes|solves|resolves) it)/i,
      /(?:successfully (?:implemented|fixed))/i,
    ],
    moderate: [
      /(?:mostly works?|works? for (?:most|some))/i,
      /(?:partial(?:ly)? (?:fixes|solves))/i,
      /(?:could be better)/i,
    ],
    poor: [
      /(?:still (?:has|have) (?:issues|problems))/i,
      /(?:doesn't (?:fully|completely) (?:work|solve))/i,
      /(?:needs? more work)/i,
    ],
  };

  /**
   * Extract solution patterns from conversation history.
   *
   * @param messages - Array of conversation messages
   * @param toolUses - Array of tool uses
   * @param toolResults - Array of tool results
   * @returns Array of extracted SolutionPattern objects
   */
  extractPatterns(
    messages: Message[],
    toolUses: ToolUse[],
    toolResults: ToolResult[]
  ): SolutionPattern[] {
    const patterns: SolutionPattern[] = [];

    // Filter out noise
    const cleanMessages = messages.filter(
      (m) => !this.isNoiseContent(m.content || "")
    );

    // Find solution segments (problem + solution pairs)
    const segments = this.findSolutionSegments(cleanMessages);

    for (const segment of segments) {
      const pattern = this.extractPatternFromSegment(
        segment,
        toolUses,
        toolResults
      );
      if (pattern) {
        patterns.push(pattern);
      }
    }

    return this.deduplicatePatterns(patterns);
  }

  /**
   * Check if content is noise.
   */
  private isNoiseContent(content: string): boolean {
    const firstChunk = content.substring(0, 500);
    return this.NOISE_PATTERNS.some((pattern) => pattern.test(firstChunk));
  }

  /**
   * Find message segments that contain problem + solution pairs.
   */
  private findSolutionSegments(messages: Message[]): Message[][] {
    const segments: Message[][] = [];
    let currentSegment: Message[] = [];
    let hasSolution = false;

    for (const message of messages) {
      currentSegment.push(message);

      // Check if this message contains a solution
      if (message.role === "assistant" && message.content) {
        const hasSolutionIndicator = this.SOLUTION_PATTERNS.some((p) =>
          p.test(message.content || "")
        );
        if (hasSolutionIndicator) {
          hasSolution = true;
        }
      }

      // Check for segment end (solution applied or conversation shift)
      if (hasSolution && currentSegment.length >= 2) {
        const content = message.content || "";
        const isComplete =
          /(?:done|complete|finished|working|fixed)/i.test(content) ||
          /(?:successfully|correctly) (?:implemented|fixed)/i.test(content);

        if (isComplete) {
          segments.push(currentSegment);
          currentSegment = [];
          hasSolution = false;
        }
      }

      // Limit segment size
      if (currentSegment.length > 10) {
        if (hasSolution) {
          segments.push(currentSegment);
        }
        currentSegment = [];
        hasSolution = false;
      }
    }

    // Don't forget last segment
    if (hasSolution && currentSegment.length >= 2) {
      segments.push(currentSegment);
    }

    return segments;
  }

  /**
   * Extract a solution pattern from a message segment.
   */
  private extractPatternFromSegment(
    segment: Message[],
    toolUses: ToolUse[],
    _toolResults: ToolResult[]
  ): SolutionPattern | null {
    if (segment.length < 2) {
      return null;
    }

    // Find the user problem
    const userMessages = segment.filter((m) => m.role === "user" && m.content);
    if (userMessages.length === 0) {
      return null;
    }

    const problemMessage = userMessages[0];
    const problemDescription = this.extractProblemDescription(problemMessage);
    if (!problemDescription) {
      return null;
    }

    // Find the solution message
    const assistantMessages = segment.filter(
      (m) => m.role === "assistant" && m.content
    );
    const solutionMessage = this.findSolutionMessage(assistantMessages);
    if (!solutionMessage) {
      return null;
    }

    // Extract all components
    const problemCategory = this.identifyCategory(problemDescription);
    const solutionSummary = this.extractSolutionSummary(solutionMessage);
    const solutionSteps = this.extractSolutionSteps(segment);
    const codePattern = this.extractCodePattern(solutionMessage);
    const technology = this.extractTechnology(segment);
    const prerequisites = this.extractPrerequisites(solutionMessage);
    const appliesWhen = this.extractAppliesWhen(segment, problemDescription);
    const avoidWhen = this.extractAvoidWhen(segment);
    const appliedToFiles = this.extractAppliedFiles(segment, toolUses);
    const effectiveness = this.determineEffectiveness(segment);

    return {
      id: nanoid(),
      conversation_id: solutionMessage.conversation_id,
      message_id: solutionMessage.id,
      problem_category: problemCategory,
      problem_description: problemDescription,
      solution_summary: solutionSummary,
      solution_steps: solutionSteps,
      code_pattern: codePattern,
      technology,
      prerequisites,
      applies_when: appliesWhen,
      avoid_when: avoidWhen,
      applied_to_files: appliedToFiles,
      effectiveness,
      timestamp: solutionMessage.timestamp,
    };
  }

  /**
   * Extract problem description from user message.
   */
  private extractProblemDescription(message: Message): string | null {
    const content = message.content || "";
    const sentences = content.split(/[.!?]/);
    const firstSentence = sentences[0]?.trim();

    if (firstSentence && firstSentence.length >= 15) {
      return firstSentence.substring(0, 300);
    }

    return content.substring(0, 300) || null;
  }

  /**
   * Find the message containing the solution.
   */
  private findSolutionMessage(messages: Message[]): Message | null {
    for (const message of messages) {
      const content = message.content || "";
      const hasSolution = this.SOLUTION_PATTERNS.some((p) => p.test(content));
      if (hasSolution) {
        return message;
      }
    }

    // Fall back to last assistant message if it looks complete
    const lastMessage = messages[messages.length - 1];
    if (lastMessage) {
      const content = lastMessage.content || "";
      const isComplete = /(?:done|complete|fixed|working)/i.test(content);
      if (isComplete) {
        return lastMessage;
      }
    }

    return messages[0] || null;
  }

  /**
   * Identify problem category.
   */
  private identifyCategory(problem: string): string {
    for (const [category, patterns] of Object.entries(this.CATEGORY_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(problem)) {
          return category;
        }
      }
    }
    return "general";
  }

  /**
   * Extract solution summary.
   */
  private extractSolutionSummary(message: Message): string {
    const content = message.content || "";

    for (const pattern of this.SOLUTION_PATTERNS) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1].trim().substring(0, 300);
      }
    }

    // Fall back to first sentence of solution
    const sentences = content.split(/[.!?]/);
    return sentences[0]?.trim().substring(0, 300) || "Solution applied";
  }

  /**
   * Extract solution steps from messages.
   */
  private extractSolutionSteps(segment: Message[]): string[] {
    const steps: string[] = [];

    for (const message of segment) {
      if (message.role !== "assistant" || !message.content) {
        continue;
      }

      const content = message.content;

      // Look for numbered steps
      const numberedPattern = /(?:^|\n)\s*\d+[.)]\s*(.+?)(?:\n|$)/g;
      const matches = content.matchAll(numberedPattern);
      for (const match of matches) {
        if (match[1]) {
          steps.push(match[1].trim());
        }
      }

      // Look for bullet points
      const bulletPattern = /(?:^|\n)\s*[-*•]\s*(.+?)(?:\n|$)/g;
      const bulletMatches = content.matchAll(bulletPattern);
      for (const match of bulletMatches) {
        if (match[1] && steps.length < 10) {
          steps.push(match[1].trim());
        }
      }
    }

    return steps.slice(0, 10);
  }

  /**
   * Extract code pattern if present.
   */
  private extractCodePattern(message: Message): string | undefined {
    const content = message.content || "";

    // Look for code blocks
    const codeBlockPattern = /```(?:\w+)?\n([\s\S]+?)```/;
    const match = content.match(codeBlockPattern);

    if (match && match[1]) {
      const code = match[1].trim();
      // Return code if it's not too long
      if (code.length <= 500) {
        return code;
      }
      return code.substring(0, 500) + "\n// ...";
    }

    return undefined;
  }

  /**
   * Extract technology mentions.
   */
  private extractTechnology(segment: Message[]): string[] {
    const tech = new Set<string>();
    const combinedContent = segment.map((m) => m.content || "").join("\n");

    for (const pattern of this.TECH_PATTERNS) {
      const matches = combinedContent.matchAll(new RegExp(pattern, "gi"));
      for (const match of matches) {
        const techName = (match[1] || match[0]).trim().toLowerCase();
        if (techName.length >= 2 && techName.length <= 30) {
          tech.add(techName);
        }
      }
    }

    return Array.from(tech).slice(0, 5);
  }

  /**
   * Extract prerequisites.
   */
  private extractPrerequisites(message: Message): string[] {
    const prereqs: string[] = [];
    const content = message.content || "";

    // Look for prerequisite patterns
    const prereqPatterns = [
      /(?:(?:first|before),? (?:you need|ensure|make sure))\s+(.+?)(?:\.|$)/gi,
      /(?:requires?|needs?)\s+(.+?)(?:\.|$)/gi,
      /(?:install|setup|configure)\s+(.+?)(?:\.|$)/gi,
    ];

    for (const pattern of prereqPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && prereqs.length < 5) {
          prereqs.push(match[1].trim().substring(0, 100));
        }
      }
    }

    return prereqs;
  }

  /**
   * Extract when the solution applies.
   */
  private extractAppliesWhen(segment: Message[], problem: string): string {
    const combinedContent = segment.map((m) => m.content || "").join("\n");

    for (const pattern of this.APPLIES_WHEN_PATTERNS) {
      const match = combinedContent.match(pattern);
      if (match && match[1]) {
        return match[1].trim().substring(0, 200);
      }
    }

    // Fall back to problem description
    return problem.substring(0, 200);
  }

  /**
   * Extract when to avoid this solution.
   */
  private extractAvoidWhen(segment: Message[]): string | undefined {
    const combinedContent = segment.map((m) => m.content || "").join("\n");

    for (const pattern of this.AVOID_WHEN_PATTERNS) {
      const match = combinedContent.match(pattern);
      if (match && match[1]) {
        return match[1].trim().substring(0, 200);
      }
    }

    return undefined;
  }

  /**
   * Extract files where solution was applied.
   */
  private extractAppliedFiles(segment: Message[], toolUses: ToolUse[]): string[] {
    const files = new Set<string>();
    const segmentMessageIds = new Set(segment.map((m) => m.id));

    // Extract from tool uses
    for (const toolUse of toolUses) {
      if (!segmentMessageIds.has(toolUse.message_id)) {
        continue;
      }

      if (["Write", "Edit", "MultiEdit"].includes(toolUse.tool_name)) {
        const input = toolUse.tool_input || {};
        if (input.file_path && typeof input.file_path === "string") {
          files.add(input.file_path);
        }
      }
    }

    return Array.from(files);
  }

  /**
   * Determine effectiveness of the solution.
   */
  private determineEffectiveness(segment: Message[]): SolutionPattern["effectiveness"] {
    const lastMessages = segment.slice(-3);
    const combinedContent = lastMessages.map((m) => m.content || "").join("\n");

    for (const pattern of this.EFFECTIVENESS_PATTERNS.excellent) {
      if (pattern.test(combinedContent)) {
        return "excellent";
      }
    }

    for (const pattern of this.EFFECTIVENESS_PATTERNS.poor) {
      if (pattern.test(combinedContent)) {
        return "poor";
      }
    }

    for (const pattern of this.EFFECTIVENESS_PATTERNS.moderate) {
      if (pattern.test(combinedContent)) {
        return "moderate";
      }
    }

    return "good"; // Default
  }

  /**
   * Deduplicate similar patterns.
   */
  private deduplicatePatterns(patterns: SolutionPattern[]): SolutionPattern[] {
    const unique: SolutionPattern[] = [];
    const seen = new Set<string>();

    for (const pattern of patterns) {
      const signature = `${pattern.problem_category}_${pattern.solution_summary.substring(0, 50).toLowerCase()}`;

      if (!seen.has(signature)) {
        seen.add(signature);
        unique.push(pattern);
      }
    }

    return unique;
  }
}
