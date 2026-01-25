/**
 * Research Extractor - Identifies discoveries and findings from conversations.
 *
 * This extractor analyzes conversation history to identify research activities
 * and their discoveries. It captures:
 * - What was being researched
 * - Discovery / finding
 * - Source of the discovery (code, docs, web, experimentation)
 * - Relevance to the current problem
 * - Confidence level
 *
 * @example
 * ```typescript
 * const extractor = new ResearchExtractor();
 * const findings = extractor.extractFindings(messages, toolUses, toolResults);
 * findings.forEach(f => {
 *   console.log(`Topic: ${f.topic}`);
 *   console.log(`Discovery: ${f.discovery}`);
 *   console.log(`Source: ${f.source_type}`);
 * });
 * ```
 */

import { nanoid } from "nanoid";
import type { Message, ToolUse, ToolResult } from "./ConversationParser.js";

/**
 * Represents a research finding extracted from conversation history.
 */
export interface ResearchFinding {
  /** Unique finding identifier */
  id: string;
  /** Conversation where this finding was made */
  conversation_id: string;
  /** Message containing the finding */
  message_id: string;
  /** Topic being researched */
  topic: string;
  /** The actual discovery/finding */
  discovery: string;
  /** Type of source */
  source_type: "code" | "documentation" | "web" | "experimentation" | "user_input";
  /** Specific source reference (file path, URL, etc.) */
  source_reference?: string;
  /** How relevant this is to the problem */
  relevance: "high" | "medium" | "low";
  /** Confidence in this finding */
  confidence: "verified" | "likely" | "uncertain";
  /** Related files or components */
  related_to: string[];
  /** When the finding was made */
  timestamp: number;
}

/**
 * Extracts research findings from conversation history.
 */
export class ResearchExtractor {
  // Noise patterns to filter out
  private readonly NOISE_PATTERNS = [
    /this session is being continued/i,
    /conversation is summarized below/i,
    /previous conversation that ran out of context/i,
  ];

  // Discovery indicator patterns
  private readonly DISCOVERY_PATTERNS = [
    /(?:I (?:found|discovered|noticed|see) that)\s+(.+?)(?:\.|$)/i,
    /(?:it (?:appears|seems|looks like))\s+(.+?)(?:\.|$)/i,
    /(?:the (?:code|file|function|class|module) (?:shows|indicates|reveals))\s+(.+?)(?:\.|$)/i,
    /(?:according to (?:the|this))\s+(.+?)(?:\.|$)/i,
    /(?:based on (?:my|the) (?:analysis|reading|exploration))[,\s]+(.+?)(?:\.|$)/i,
    /(?:this (?:means|indicates|suggests|shows))\s+(.+?)(?:\.|$)/i,
    /(?:the (?:issue|problem|error) is)\s+(.+?)(?:\.|$)/i,
    /(?:(?:here's|here is) what I (?:found|learned))[:\s]+(.+?)(?:\.|$)/i,
  ];

  // Source type patterns
  private readonly SOURCE_PATTERNS: Record<ResearchFinding["source_type"], RegExp[]> = {
    code: [
      /(?:in|from) the (?:code|file|source|implementation)/i,
      /(?:looking at|reading|examining) (?:the )?[\w./]+\.\w+/i,
      /(?:the function|class|method|variable)/i,
    ],
    documentation: [
      /(?:according to|from|in) (?:the )?(?:docs|documentation|readme|guide)/i,
      /(?:the documentation (?:says|shows|indicates))/i,
      /(?:as (?:documented|specified|described) in)/i,
    ],
    web: [
      /(?:according to|from|based on) (?:the )?(?:web|online|internet)/i,
      /(?:searching|searched|googled|looked up)/i,
      /https?:\/\//i,
    ],
    experimentation: [
      /(?:testing|tried|tested|experimented)/i,
      /(?:running|ran) (?:the )?(?:code|test|command)/i,
      /(?:the (?:result|output) (?:shows|is))/i,
    ],
    user_input: [
      /(?:you (?:said|mentioned|asked|told me))/i,
      /(?:based on (?:your|the user's) (?:input|request|question))/i,
    ],
  };

  // Topic extraction patterns
  private readonly TOPIC_PATTERNS = [
    /(?:looking (?:at|into)|investigating|researching|exploring)\s+(.+?)(?:\.|,|$)/i,
    /(?:understanding|learning about|figuring out)\s+(.+?)(?:\.|,|$)/i,
    /(?:how (?:to|does)|what is|why does)\s+(.+?)(?:\?|$)/i,
  ];

  // Relevance indicators
  private readonly RELEVANCE_INDICATORS = {
    high: [
      /(?:this is (?:critical|crucial|essential|important|key))/i,
      /(?:(?:directly|exactly) (?:what|how|why))/i,
      /(?:the (?:root cause|main issue|solution|answer))/i,
    ],
    medium: [
      /(?:(?:related|relevant) to)/i,
      /(?:this (?:helps|explains|clarifies))/i,
      /(?:might|could|may) (?:be|help)/i,
    ],
    low: [
      /(?:for (?:reference|future|later))/i,
      /(?:not (?:directly|immediately) (?:relevant|needed))/i,
      /(?:tangentially|incidentally)/i,
    ],
  };

  // Confidence indicators
  private readonly CONFIDENCE_INDICATORS = {
    verified: [
      /(?:confirmed|verified|proven|definitely|certainly)/i,
      /(?:this is correct|I'm certain|no doubt)/i,
      /(?:tests? (?:pass|confirm)|output shows)/i,
    ],
    likely: [
      /(?:likely|probably|most likely|appears to be)/i,
      /(?:seems|looks like|I (?:think|believe))/i,
    ],
    uncertain: [
      /(?:might|could|may|possibly|perhaps)/i,
      /(?:I'm not sure|unclear|uncertain)/i,
      /(?:need(?:s)? to (?:verify|confirm|check))/i,
    ],
  };

  /**
   * Extract research findings from conversation history.
   *
   * @param messages - Array of conversation messages
   * @param toolUses - Array of tool uses
   * @param toolResults - Array of tool results
   * @returns Array of extracted ResearchFinding objects
   */
  extractFindings(
    messages: Message[],
    toolUses: ToolUse[],
    toolResults: ToolResult[]
  ): ResearchFinding[] {
    const findings: ResearchFinding[] = [];

    // Filter out noise
    const cleanMessages = messages.filter(
      (m) => !this.isNoiseContent(m.content || "")
    );

    // Create lookup maps
    const toolUsesByMessage = this.groupToolUsesByMessage(toolUses);
    const toolResultsByUse = this.mapToolResultsByUse(toolResults);

    for (const message of cleanMessages) {
      if (message.role !== "assistant" || !message.content) {
        continue;
      }

      // Extract findings from assistant messages
      const messageFindings = this.extractFromMessage(
        message,
        toolUsesByMessage.get(message.id) || [],
        toolResultsByUse
      );
      findings.push(...messageFindings);
    }

    // Deduplicate similar findings
    return this.deduplicateFindings(findings);
  }

  /**
   * Check if content is noise that should be filtered out.
   */
  private isNoiseContent(content: string): boolean {
    const firstChunk = content.substring(0, 500);
    return this.NOISE_PATTERNS.some((pattern) => pattern.test(firstChunk));
  }

  /**
   * Group tool uses by message ID.
   */
  private groupToolUsesByMessage(toolUses: ToolUse[]): Map<string, ToolUse[]> {
    const groups = new Map<string, ToolUse[]>();
    for (const toolUse of toolUses) {
      const existing = groups.get(toolUse.message_id);
      if (existing) {
        existing.push(toolUse);
      } else {
        groups.set(toolUse.message_id, [toolUse]);
      }
    }
    return groups;
  }

  /**
   * Map tool results by tool use ID.
   */
  private mapToolResultsByUse(toolResults: ToolResult[]): Map<string, ToolResult> {
    const resultMap = new Map<string, ToolResult>();
    for (const result of toolResults) {
      resultMap.set(result.tool_use_id, result);
    }
    return resultMap;
  }

  /**
   * Extract findings from a single message.
   */
  private extractFromMessage(
    message: Message,
    messageToolUses: ToolUse[],
    toolResultsByUse: Map<string, ToolResult>
  ): ResearchFinding[] {
    const findings: ResearchFinding[] = [];
    const content = message.content || "";

    // Find discovery statements
    for (const pattern of this.DISCOVERY_PATTERNS) {
      const matches = content.matchAll(new RegExp(pattern, "gi"));

      for (const match of matches) {
        const discovery = match[1]?.trim();
        if (!discovery || discovery.length < 20) {
          continue;
        }

        // Extract context around the discovery
        const context = this.getContextAround(content, match.index || 0);

        // Identify topic
        const topic = this.identifyTopic(context, message);

        // Identify source type
        const sourceType = this.identifySourceType(
          context,
          messageToolUses,
          toolResultsByUse
        );

        // Get source reference
        const sourceReference = this.extractSourceReference(
          context,
          messageToolUses
        );

        // Determine relevance
        const relevance = this.determineRelevance(context);

        // Determine confidence
        const confidence = this.determineConfidence(context);

        // Extract related files/components
        const relatedTo = this.extractRelatedItems(context, messageToolUses);

        findings.push({
          id: nanoid(),
          conversation_id: message.conversation_id,
          message_id: message.id,
          topic,
          discovery: discovery.substring(0, 500),
          source_type: sourceType,
          source_reference: sourceReference,
          relevance,
          confidence,
          related_to: relatedTo,
          timestamp: message.timestamp,
        });
      }
    }

    return findings;
  }

  /**
   * Get context around a match position.
   */
  private getContextAround(content: string, position: number): string {
    const start = Math.max(0, position - 200);
    const end = Math.min(content.length, position + 400);
    return content.substring(start, end);
  }

  /**
   * Identify the topic being researched.
   */
  private identifyTopic(context: string, _message: Message): string {
    // Try topic patterns
    for (const pattern of this.TOPIC_PATTERNS) {
      const match = context.match(pattern);
      if (match && match[1]) {
        return match[1].trim().substring(0, 100);
      }
    }

    // Fall back to extracting from first sentence
    const firstSentence = context.split(/[.!?]/)[0]?.trim();
    return firstSentence?.substring(0, 100) || "General exploration";
  }

  /**
   * Identify the source type of the finding.
   */
  private identifySourceType(
    context: string,
    toolUses: ToolUse[],
    _toolResultsByUse: Map<string, ToolResult>
  ): ResearchFinding["source_type"] {
    // Check tool uses first
    for (const toolUse of toolUses) {
      const toolName = toolUse.tool_name;

      if (["Read", "Glob", "Grep"].includes(toolName)) {
        return "code";
      }
      if (toolName === "WebFetch") {
        return "documentation";
      }
      if (toolName === "WebSearch") {
        return "web";
      }
      if (toolName === "Bash") {
        return "experimentation";
      }
    }

    // Check content patterns
    for (const [sourceType, patterns] of Object.entries(this.SOURCE_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(context)) {
          return sourceType as ResearchFinding["source_type"];
        }
      }
    }

    return "code"; // Default
  }

  /**
   * Extract source reference (file path, URL, etc.).
   */
  private extractSourceReference(
    context: string,
    toolUses: ToolUse[]
  ): string | undefined {
    // Check tool uses for file paths or URLs
    for (const toolUse of toolUses) {
      const input = toolUse.tool_input || {};
      if (input.file_path && typeof input.file_path === "string") {
        return input.file_path;
      }
      if (input.url && typeof input.url === "string") {
        return input.url;
      }
      if (input.path && typeof input.path === "string") {
        return input.path;
      }
    }

    // Look for file paths in context
    const fileMatch = context.match(/(?:\/[\w.-]+)+\.[\w]+/);
    if (fileMatch) {
      return fileMatch[0];
    }

    // Look for URLs in context
    const urlMatch = context.match(/https?:\/\/[^\s)]+/);
    if (urlMatch) {
      return urlMatch[0];
    }

    return undefined;
  }

  /**
   * Determine relevance of the finding.
   */
  private determineRelevance(context: string): ResearchFinding["relevance"] {
    for (const pattern of this.RELEVANCE_INDICATORS.high) {
      if (pattern.test(context)) {
        return "high";
      }
    }

    for (const pattern of this.RELEVANCE_INDICATORS.low) {
      if (pattern.test(context)) {
        return "low";
      }
    }

    return "medium"; // Default
  }

  /**
   * Determine confidence level of the finding.
   */
  private determineConfidence(context: string): ResearchFinding["confidence"] {
    for (const pattern of this.CONFIDENCE_INDICATORS.verified) {
      if (pattern.test(context)) {
        return "verified";
      }
    }

    for (const pattern of this.CONFIDENCE_INDICATORS.uncertain) {
      if (pattern.test(context)) {
        return "uncertain";
      }
    }

    return "likely"; // Default
  }

  /**
   * Extract related files or components.
   */
  private extractRelatedItems(
    context: string,
    toolUses: ToolUse[]
  ): string[] {
    const items = new Set<string>();

    // Extract from tool uses
    for (const toolUse of toolUses) {
      const input = toolUse.tool_input || {};
      if (input.file_path && typeof input.file_path === "string") {
        items.add(input.file_path);
      }
      if (input.path && typeof input.path === "string") {
        items.add(input.path);
      }
    }

    // Extract file paths from context
    const filePattern = /(?:\/[\w.-]+)+\.[\w]+/g;
    const matches = context.match(filePattern);
    if (matches) {
      for (const match of matches) {
        items.add(match);
      }
    }

    return Array.from(items);
  }

  /**
   * Deduplicate similar findings.
   */
  private deduplicateFindings(findings: ResearchFinding[]): ResearchFinding[] {
    const unique: ResearchFinding[] = [];
    const seen = new Set<string>();

    for (const finding of findings) {
      // Create signature
      const discoveryPrefix = finding.discovery.substring(0, 100).toLowerCase();
      const signature = `${finding.message_id}_${discoveryPrefix}`;

      if (!seen.has(signature)) {
        seen.add(signature);
        unique.push(finding);
      }
    }

    return unique;
  }
}
