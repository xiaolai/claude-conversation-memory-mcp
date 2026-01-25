/**
 * Methodology Extractor - Identifies problem-solving approaches from conversations.
 *
 * This extractor analyzes conversation history to identify how AI solved problems,
 * capturing the methodology, steps taken, and tools used. It helps trace:
 * - Problem statement / initial understanding
 * - Approach taken (exploration, research, implementation)
 * - Steps / sequence of actions
 * - Tools and commands used
 * - Files explored
 * - Outcome (success, partial, failed)
 *
 * @example
 * ```typescript
 * const extractor = new MethodologyExtractor();
 * const methodologies = extractor.extractMethodologies(messages, toolUses, toolResults);
 * methodologies.forEach(m => {
 *   console.log(`Problem: ${m.problem_statement}`);
 *   console.log(`Approach: ${m.approach}`);
 *   console.log(`Steps: ${m.steps_taken.length}`);
 * });
 * ```
 */

import { nanoid } from "nanoid";
import type { Message, ToolUse, ToolResult } from "./ConversationParser.js";

/**
 * Represents a problem-solving methodology extracted from conversation history.
 */
export interface Methodology {
  /** Unique methodology identifier */
  id: string;
  /** Conversation where this methodology was used */
  conversation_id: string;
  /** Starting message ID */
  start_message_id: string;
  /** Ending message ID */
  end_message_id: string;
  /** The problem being solved */
  problem_statement: string;
  /** High-level approach category */
  approach: "exploration" | "research" | "implementation" | "debugging" | "refactoring" | "testing";
  /** Sequence of steps taken */
  steps_taken: MethodologyStep[];
  /** Tools/commands used */
  tools_used: string[];
  /** Files explored or modified */
  files_involved: string[];
  /** Outcome of the approach */
  outcome: "success" | "partial" | "failed" | "ongoing";
  /** Summary of what worked */
  what_worked?: string;
  /** Summary of what didn't work */
  what_didnt_work?: string;
  /** When the methodology started */
  started_at: number;
  /** When the methodology ended */
  ended_at: number;
}

/**
 * A single step in the methodology.
 */
export interface MethodologyStep {
  /** Step number */
  order: number;
  /** What was done */
  action: string;
  /** Tool used (if any) */
  tool?: string;
  /** Result of the action */
  result?: string;
  /** Whether this step succeeded */
  succeeded: boolean;
}

/**
 * Extracts problem-solving methodologies from conversation history.
 */
export class MethodologyExtractor {
  // Patterns indicating start of problem-solving
  private readonly PROBLEM_START_PATTERNS = [
    /(?:I need to|help me|can you|let's|we need to|I want to)\s+(.+?)(?:\.|$)/i,
    /(?:how do I|how can I|what's the best way to)\s+(.+?)(?:\?|$)/i,
    /(?:fix|solve|resolve|implement|create|build|add|update|refactor|debug)\s+(.+?)(?:\.|$)/i,
    /(?:there's (?:a|an)|I have (?:a|an))\s+(?:bug|error|issue|problem)\s+(?:in|with)\s+(.+?)(?:\.|$)/i,
  ];

  // Patterns indicating approach type
  private readonly APPROACH_PATTERNS: Record<string, RegExp[]> = {
    exploration: [
      /let me (?:look|check|explore|examine|see)/i,
      /first,? (?:I'll|let me) (?:understand|read|examine)/i,
      /exploring the codebase/i,
    ],
    research: [
      /(?:searching|looking up|researching)/i,
      /(?:documentation|docs) (?:says|shows|indicates)/i,
      /according to/i,
      /best practices? (?:suggest|recommend)/i,
    ],
    implementation: [
      /(?:I'll|let me) (?:implement|create|write|add)/i,
      /(?:implementing|creating|writing|adding)/i,
      /here's the (?:code|implementation)/i,
    ],
    debugging: [
      /(?:debugging|investigating|tracing)/i,
      /the (?:error|bug|issue) (?:is|was|occurs)/i,
      /root cause/i,
      /stack trace/i,
    ],
    refactoring: [
      /(?:refactoring|restructuring|reorganizing)/i,
      /(?:cleaning up|simplifying|improving)/i,
      /better (?:structure|organization|design)/i,
    ],
    testing: [
      /(?:testing|running tests|verifying)/i,
      /test (?:passes|fails|results)/i,
      /npm (?:test|run test)/i,
    ],
  };

  // Patterns indicating outcome
  private readonly OUTCOME_PATTERNS = {
    success: [
      /(?:done|complete|finished|working|fixed|resolved|implemented)/i,
      /(?:successfully|correctly) (?:implemented|fixed|added)/i,
      /(?:all tests pass|tests are passing)/i,
      /✓|✅/,
    ],
    failed: [
      /(?:failed|error|broken|doesn't work)/i,
      /(?:still|continues to) (?:fail|error)/i,
      /cannot|could not|unable to/i,
      /✗|❌/,
    ],
    partial: [
      /(?:partially|almost|mostly) (?:done|working)/i,
      /(?:some|few) (?:issues|problems) remain/i,
      /needs? more work/i,
    ],
  };

  /**
   * Extract methodologies from conversation history.
   *
   * @param messages - Array of conversation messages
   * @param toolUses - Array of tool uses
   * @param toolResults - Array of tool results
   * @returns Array of extracted Methodology objects
   */
  extractMethodologies(
    messages: Message[],
    toolUses: ToolUse[],
    toolResults: ToolResult[]
  ): Methodology[] {
    const methodologies: Methodology[] = [];

    // Group messages by conversation
    const conversationMessages = this.groupByConversation(messages);

    for (const [conversationId, convMessages] of conversationMessages) {
      // Get tool uses and results for this conversation
      const convToolUses = toolUses.filter((tu) =>
        convMessages.some((m) => m.id === tu.message_id)
      );
      const convToolResults = toolResults.filter((tr) =>
        convMessages.some((m) => m.id === tr.message_id)
      );

      // Find problem-solving segments
      const segments = this.identifyProblemSegments(convMessages);

      for (const segment of segments) {
        const methodology = this.extractMethodologyFromSegment(
          conversationId,
          segment,
          convToolUses,
          convToolResults
        );
        if (methodology) {
          methodologies.push(methodology);
        }
      }
    }

    return methodologies;
  }

  /**
   * Group messages by conversation ID.
   */
  private groupByConversation(messages: Message[]): Map<string, Message[]> {
    const groups = new Map<string, Message[]>();

    for (const message of messages) {
      const convId = message.conversation_id;
      const existing = groups.get(convId);
      if (existing) {
        existing.push(message);
      } else {
        groups.set(convId, [message]);
      }
    }

    // Sort each group by timestamp
    for (const [, msgs] of groups) {
      msgs.sort((a, b) => a.timestamp - b.timestamp);
    }

    return groups;
  }

  /**
   * Identify segments of messages that represent problem-solving.
   */
  private identifyProblemSegments(messages: Message[]): Message[][] {
    const segments: Message[][] = [];
    let currentSegment: Message[] = [];
    let inProblem = false;

    for (const message of messages) {
      const content = message.content || "";

      // Check if this starts a new problem
      if (message.role === "user") {
        const isProblemStart = this.PROBLEM_START_PATTERNS.some((p) =>
          p.test(content)
        );
        if (isProblemStart) {
          // Save previous segment if exists
          if (currentSegment.length >= 2) {
            segments.push(currentSegment);
          }
          currentSegment = [message];
          inProblem = true;
          continue;
        }
      }

      // Continue collecting messages for current problem
      if (inProblem) {
        currentSegment.push(message);

        // Check if problem is resolved
        if (message.role === "assistant") {
          const isResolved = this.OUTCOME_PATTERNS.success.some((p) =>
            p.test(content)
          );
          const isFailed = this.OUTCOME_PATTERNS.failed.some((p) =>
            p.test(content)
          );

          if ((isResolved || isFailed) && currentSegment.length >= 2) {
            segments.push(currentSegment);
            currentSegment = [];
            inProblem = false;
          }
        }
      }
    }

    // Don't forget last segment
    if (currentSegment.length >= 2) {
      segments.push(currentSegment);
    }

    return segments;
  }

  /**
   * Extract methodology from a problem-solving segment.
   */
  private extractMethodologyFromSegment(
    conversationId: string,
    segment: Message[],
    toolUses: ToolUse[],
    toolResults: ToolResult[]
  ): Methodology | null {
    if (segment.length < 2) {
      return null;
    }

    const firstMessage = segment[0];
    const lastMessage = segment[segment.length - 1];

    // Extract problem statement
    const problemStatement = this.extractProblemStatement(segment);
    if (!problemStatement) {
      return null;
    }

    // Identify approach
    const approach = this.identifyApproach(segment);

    // Extract steps
    const steps = this.extractSteps(segment, toolUses, toolResults);

    // Get tools used
    const toolsUsed = this.extractToolsUsed(segment, toolUses);

    // Get files involved
    const filesInvolved = this.extractFilesInvolved(segment, toolUses, toolResults);

    // Determine outcome
    const outcome = this.determineOutcome(segment);

    // Extract what worked/didn't work
    const { whatWorked, whatDidntWork } = this.extractLessonsLearned(segment);

    return {
      id: nanoid(),
      conversation_id: conversationId,
      start_message_id: firstMessage.id,
      end_message_id: lastMessage.id,
      problem_statement: problemStatement,
      approach,
      steps_taken: steps,
      tools_used: toolsUsed,
      files_involved: filesInvolved,
      outcome,
      what_worked: whatWorked,
      what_didnt_work: whatDidntWork,
      started_at: firstMessage.timestamp,
      ended_at: lastMessage.timestamp,
    };
  }

  /**
   * Extract the problem statement from the first user message.
   */
  private extractProblemStatement(segment: Message[]): string | null {
    const userMessages = segment.filter((m) => m.role === "user" && m.content);
    if (userMessages.length === 0) {
      return null;
    }

    const firstUser = userMessages[0];
    const content = firstUser.content || "";

    // Try to extract a clean problem statement
    for (const pattern of this.PROBLEM_START_PATTERNS) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    // Fall back to first sentence
    const sentences = content.split(/[.!?]/);
    const firstSentence = sentences[0]?.trim();
    return firstSentence && firstSentence.length > 10
      ? firstSentence.substring(0, 200)
      : null;
  }

  /**
   * Identify the primary approach used.
   */
  private identifyApproach(
    segment: Message[]
  ): Methodology["approach"] {
    const combinedContent = segment
      .map((m) => m.content || "")
      .join("\n");

    for (const [approach, patterns] of Object.entries(this.APPROACH_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(combinedContent)) {
          return approach as Methodology["approach"];
        }
      }
    }

    return "implementation"; // Default
  }

  /**
   * Extract steps taken during problem-solving.
   */
  private extractSteps(
    segment: Message[],
    toolUses: ToolUse[],
    toolResults: ToolResult[]
  ): MethodologyStep[] {
    const steps: MethodologyStep[] = [];
    let order = 1;

    // Get message IDs in this segment
    const segmentMessageIds = new Set(segment.map((m) => m.id));

    // Get tool uses for this segment
    const segmentToolUses = toolUses.filter((tu) =>
      segmentMessageIds.has(tu.message_id)
    );

    for (const toolUse of segmentToolUses) {
      // Find the corresponding result
      const result = toolResults.find((tr) => tr.tool_use_id === toolUse.id);

      // Describe the action
      const action = this.describeToolAction(toolUse);
      const resultSummary = result
        ? this.summarizeToolResult(result)
        : undefined;

      steps.push({
        order: order++,
        action,
        tool: toolUse.tool_name,
        result: resultSummary,
        succeeded: !result?.is_error,
      });
    }

    return steps;
  }

  /**
   * Describe what a tool action did.
   */
  private describeToolAction(toolUse: ToolUse): string {
    const toolName = toolUse.tool_name;
    const input = toolUse.tool_input || {};

    switch (toolName) {
      case "Read":
        return `Read file: ${input.file_path || "unknown"}`;
      case "Write":
        return `Write file: ${input.file_path || "unknown"}`;
      case "Edit":
        return `Edit file: ${input.file_path || "unknown"}`;
      case "Glob":
        return `Search files matching: ${input.pattern || "unknown"}`;
      case "Grep":
        return `Search content for: ${input.pattern || "unknown"}`;
      case "Bash": {
        const cmd = String(input.command || "");
        return `Execute: ${cmd.substring(0, 100)}`;
      }
      case "WebSearch":
        return `Search web for: ${input.query || "unknown"}`;
      case "WebFetch":
        return `Fetch URL: ${input.url || "unknown"}`;
      default:
        return `Use tool: ${toolName}`;
    }
  }

  /**
   * Summarize a tool result.
   */
  private summarizeToolResult(result: ToolResult): string {
    if (result.is_error) {
      const error = result.stderr || result.content || "Error occurred";
      return `Error: ${error.substring(0, 100)}`;
    }

    const content = result.content || result.stdout || "";
    if (content.length > 100) {
      return content.substring(0, 100) + "...";
    }
    return content || "Success";
  }

  /**
   * Extract unique tools used in the segment.
   */
  private extractToolsUsed(segment: Message[], toolUses: ToolUse[]): string[] {
    const segmentMessageIds = new Set(segment.map((m) => m.id));
    const tools = new Set<string>();

    for (const toolUse of toolUses) {
      if (segmentMessageIds.has(toolUse.message_id)) {
        tools.add(toolUse.tool_name);
      }
    }

    return Array.from(tools);
  }

  /**
   * Extract files involved in the segment.
   */
  private extractFilesInvolved(
    segment: Message[],
    toolUses: ToolUse[],
    _toolResults: ToolResult[]
  ): string[] {
    const files = new Set<string>();
    const segmentMessageIds = new Set(segment.map((m) => m.id));

    // Extract from tool uses
    for (const toolUse of toolUses) {
      if (!segmentMessageIds.has(toolUse.message_id)) {
        continue;
      }

      const input = toolUse.tool_input || {};
      if (input.file_path) {
        files.add(String(input.file_path));
      }
      if (input.path) {
        files.add(String(input.path));
      }
    }

    // Extract file paths from message content
    const filePattern = /(?:\/[\w.-]+)+\.[\w]+/g;
    for (const message of segment) {
      const matches = (message.content || "").match(filePattern);
      if (matches) {
        for (const match of matches) {
          files.add(match);
        }
      }
    }

    return Array.from(files);
  }

  /**
   * Determine the outcome of the problem-solving.
   */
  private determineOutcome(segment: Message[]): Methodology["outcome"] {
    // Check last few messages for outcome indicators
    const lastMessages = segment.slice(-3);
    const combinedContent = lastMessages
      .map((m) => m.content || "")
      .join("\n");

    for (const pattern of this.OUTCOME_PATTERNS.success) {
      if (pattern.test(combinedContent)) {
        return "success";
      }
    }

    for (const pattern of this.OUTCOME_PATTERNS.failed) {
      if (pattern.test(combinedContent)) {
        return "failed";
      }
    }

    for (const pattern of this.OUTCOME_PATTERNS.partial) {
      if (pattern.test(combinedContent)) {
        return "partial";
      }
    }

    return "ongoing";
  }

  /**
   * Extract lessons learned from the segment.
   */
  private extractLessonsLearned(
    segment: Message[]
  ): { whatWorked?: string; whatDidntWork?: string } {
    const assistantMessages = segment.filter(
      (m) => m.role === "assistant" && m.content
    );

    let whatWorked: string | undefined;
    let whatDidntWork: string | undefined;

    // Look for patterns indicating what worked
    const workedPatterns = [
      /(?:this|that) (?:works?|solved|fixed)/i,
      /(?:the|this) (?:solution|fix|approach) (?:is|was)/i,
      /(?:successfully|correctly) (?:implemented|fixed)/i,
    ];

    const failedPatterns = [
      /(?:didn't|doesn't|won't) work/i,
      /(?:this|that) (?:failed|broke|caused)/i,
      /(?:the|this) (?:issue|problem|error) (?:is|was)/i,
    ];

    for (const message of assistantMessages) {
      const content = message.content || "";
      const sentences = content.split(/[.!?]/);

      for (const sentence of sentences) {
        if (!whatWorked) {
          for (const pattern of workedPatterns) {
            if (pattern.test(sentence)) {
              whatWorked = sentence.trim().substring(0, 200);
              break;
            }
          }
        }

        if (!whatDidntWork) {
          for (const pattern of failedPatterns) {
            if (pattern.test(sentence)) {
              whatDidntWork = sentence.trim().substring(0, 200);
              break;
            }
          }
        }
      }
    }

    return { whatWorked, whatDidntWork };
  }
}
