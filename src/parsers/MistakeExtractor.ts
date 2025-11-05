/**
 * Mistake Extractor
 * Identifies errors and how they were corrected to prevent repetition
 */

import { nanoid } from "nanoid";
import type { Message, ToolResult } from "./ConversationParser.js";

export interface Mistake {
  id: string;
  conversation_id: string;
  message_id: string;
  mistake_type: "logic_error" | "wrong_approach" | "misunderstanding" | "tool_error" | "syntax_error";
  what_went_wrong: string;
  correction?: string;
  user_correction_message?: string;
  files_affected: string[];
  timestamp: number;
}

export class MistakeExtractor {
  // User correction indicators
  private readonly CORRECTION_INDICATORS = [
    /^no[,\s]/i,
    /that'?s?\s+(?:wrong|incorrect|not right|a mistake)/i,
    /(?:you|that)\s+(?:made|caused|introduced)\s+(?:a|an)\s+(?:error|bug|mistake)/i,
    /don't\s+do\s+(?:that|this)/i,
    /(?:should not|shouldn't|must not|mustn't)\s+(?:have\s+)?(?:done|used)/i,
    /(?:fix|correct|change)\s+(?:that|this)/i,
  ];

  // Error indicators in assistant messages
  private readonly ERROR_INDICATORS = [
    /error:/i,
    /failed:/i,
    /exception:/i,
    /(?:this|that)\s+(?:didn't|doesn't|won't)\s+work/i,
    /(?:broke|breaking|broken)/i,
    /(?:issue|problem|bug)/i,
  ];

  // Mistake type patterns
  private readonly MISTAKE_PATTERNS = {
    logic_error: [/logic\s+error/i, /incorrect\s+logic/i, /wrong\s+condition/i],
    wrong_approach: [
      /wrong\s+approach/i,
      /better\s+way/i,
      /should\s+(?:have\s+)?use(?:d)?/i,
    ],
    misunderstanding: [
      /misunderstood/i,
      /(?:didn't|don't)\s+understand/i,
      /confused\s+about/i,
    ],
    syntax_error: [/syntax\s+error/i, /parse\s+error/i, /invalid\s+syntax/i],
  };

  /**
   * Extract mistakes from messages and tool results
   */
  extractMistakes(messages: Message[], toolResults: ToolResult[]): Mistake[] {
    const mistakes: Mistake[] = [];

    // Extract from tool errors
    const toolErrors = this.extractToolErrors(toolResults, messages);
    mistakes.push(...toolErrors);

    // Extract from user corrections
    const userCorrections = this.extractUserCorrections(messages);
    mistakes.push(...userCorrections);

    // Extract from error discussions
    const errorDiscussions = this.extractErrorDiscussions(messages);
    mistakes.push(...errorDiscussions);

    return this.deduplicateMistakes(mistakes);
  }

  /**
   * Extract mistakes from tool execution errors
   */
  private extractToolErrors(
    toolResults: ToolResult[],
    messages: Message[]
  ): Mistake[] {
    const mistakes: Mistake[] = [];

    for (const result of toolResults) {
      if (!result.is_error) {continue;}

      const message = messages.find((m) => m.id === result.message_id);
      if (!message) {continue;}

      // Extract error details
      const errorContent = result.stderr || result.content || "";
      const mistakeType = this.classifyMistakeType(errorContent);

      mistakes.push({
        id: nanoid(),
        conversation_id: message.conversation_id,
        message_id: message.id,
        mistake_type: mistakeType || "tool_error",
        what_went_wrong: this.summarizeError(errorContent),
        correction: this.findCorrection(message, messages),
        files_affected: this.extractFilesFromError(errorContent),
        timestamp: result.timestamp,
      });
    }

    return mistakes;
  }

  /**
   * Extract mistakes from user corrections
   */
  private extractUserCorrections(messages: Message[]): Mistake[] {
    const mistakes: Mistake[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      if (message.role !== "user" || !message.content) {
        continue;
      }

      const content = message.content;

      // Check if this is a correction
      const isCorrection = this.CORRECTION_INDICATORS.some((pattern) =>
        pattern.test(content)
      );

      if (!isCorrection) {continue;}

      // Find the previous assistant message
      const previousAssistant = this.findPreviousAssistantMessage(messages, i);
      if (!previousAssistant) {continue;}

      const mistakeType = this.classifyMistakeType(message.content);

      mistakes.push({
        id: nanoid(),
        conversation_id: message.conversation_id,
        message_id: previousAssistant.id,
        mistake_type: mistakeType || "misunderstanding",
        what_went_wrong: this.extractWhatWentWrong(message.content),
        correction: this.extractCorrection(message.content),
        user_correction_message: message.content,
        files_affected: this.extractFilesFromMessage(message),
        timestamp: message.timestamp,
      });
    }

    return mistakes;
  }

  /**
   * Extract mistakes from error discussions in messages
   */
  private extractErrorDiscussions(messages: Message[]): Mistake[] {
    const mistakes: Mistake[] = [];

    for (const message of messages) {
      if (message.role !== "assistant" || !message.content) {
        continue;
      }

      const content = message.content;

      // Check if message discusses an error
      const hasErrorDiscussion = this.ERROR_INDICATORS.some((pattern) =>
        pattern.test(content)
      );

      if (!hasErrorDiscussion) {continue;}

      // Extract error discussion
      const errorText = this.extractErrorDiscussion(message.content);
      if (!errorText) {continue;}

      const mistakeType = this.classifyMistakeType(errorText);

      mistakes.push({
        id: nanoid(),
        conversation_id: message.conversation_id,
        message_id: message.id,
        mistake_type: mistakeType || "logic_error",
        what_went_wrong: errorText,
        correction: this.extractSolutionFromSameMessage(message.content),
        files_affected: this.extractFilesFromMessage(message),
        timestamp: message.timestamp,
      });
    }

    return mistakes;
  }

  /**
   * Classify the type of mistake
   */
  private classifyMistakeType(
    text: string
  ):
    | "logic_error"
    | "wrong_approach"
    | "misunderstanding"
    | "syntax_error"
    | null {
    for (const [type, patterns] of Object.entries(this.MISTAKE_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return type as "logic_error" | "wrong_approach" | "misunderstanding" | "syntax_error";
        }
      }
    }
    return null;
  }

  /**
   * Summarize error message
   */
  private summarizeError(errorText: string): string {
    // Take first line or first 200 characters
    const firstLine = errorText.split("\n")[0];
    return firstLine.length > 200
      ? firstLine.substring(0, 200) + "..."
      : firstLine;
  }

  /**
   * Find correction in subsequent messages
   */
  private findCorrection(errorMessage: Message, allMessages: Message[]): string | undefined {
    const index = allMessages.findIndex((m) => m.id === errorMessage.id);
    if (index === -1) {return undefined;}

    // Look at next few messages for a fix
    const nextMessages = allMessages.slice(index + 1, index + 5);

    for (const msg of nextMessages) {
      if (msg.role === "assistant" && msg.content) {
        // Look for fix indicators
        if (
          /(?:fixed|resolved|corrected|solved)/i.test(msg.content)
        ) {
          return msg.content.substring(0, 500);
        }
      }
    }

    return undefined;
  }

  /**
   * Extract files mentioned in error
   */
  private extractFilesFromError(errorText: string): string[] {
    const files: string[] = [];

    // Common file path patterns
    const filePathPattern = /(?:\/|\.\/|\.\.\/)?(?:[\w-]+\/)*[\w-]+\.[\w]+/g;
    const matches = errorText.match(filePathPattern);

    if (matches) {
      files.push(...matches);
    }

    return [...new Set(files)];
  }

  /**
   * Extract files from message metadata
   */
  private extractFilesFromMessage(message: Message): string[] {
    const files: string[] = [];

    if (message.metadata) {
      const metadataStr = JSON.stringify(message.metadata);
      const filePathPattern = /(?:\/[\w-]+)+\.[\w]+/g;
      const matches = metadataStr.match(filePathPattern);

      if (matches) {
        files.push(...matches);
      }
    }

    return [...new Set(files)];
  }

  /**
   * Find previous assistant message
   */
  private findPreviousAssistantMessage(
    messages: Message[],
    currentIndex: number
  ): Message | undefined {
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        return messages[i];
      }
    }
    return undefined;
  }

  /**
   * Extract what went wrong from correction message
   */
  private extractWhatWentWrong(correctionText: string): string {
    // Remove correction indicators
    let cleaned = correctionText;
    for (const pattern of this.CORRECTION_INDICATORS) {
      cleaned = cleaned.replace(pattern, "");
    }

    // Take first sentence or up to 300 characters
    const sentences = cleaned.split(/\.|!|\?/);
    const firstSentence = sentences[0]?.trim();

    return firstSentence && firstSentence.length > 0
      ? firstSentence.substring(0, 300)
      : cleaned.substring(0, 300);
  }

  /**
   * Extract correction from user message
   */
  private extractCorrection(correctionText: string): string | undefined {
    // Look for "instead" or "should" patterns
    const insteadMatch = correctionText.match(/instead[,\s]+(.+?)(?:\.|$)/i);
    if (insteadMatch) {
      return insteadMatch[1].trim();
    }

    const shouldMatch = correctionText.match(/should\s+(?:have\s+)?(.+?)(?:\.|$)/i);
    if (shouldMatch) {
      return shouldMatch[1].trim();
    }

    return undefined;
  }

  /**
   * Extract error discussion from message
   */
  private extractErrorDiscussion(content: string): string | undefined {
    // Find sentences containing error indicators
    const sentences = content.split(/\.|!|\?/);

    for (const sentence of sentences) {
      if (this.ERROR_INDICATORS.some((pattern) => pattern.test(sentence))) {
        return sentence.trim();
      }
    }

    return undefined;
  }

  /**
   * Extract solution from same message that discusses error
   */
  private extractSolutionFromSameMessage(content: string): string | undefined {
    // Look for solution indicators
    const solutionPattern = /(?:to fix|solution|resolved by|corrected by|fixed by)\s+(.+?)(?:\.|$)/i;
    const match = content.match(solutionPattern);

    return match?.[1]?.trim();
  }

  /**
   * Deduplicate similar mistakes
   */
  private deduplicateMistakes(mistakes: Mistake[]): Mistake[] {
    const unique: Mistake[] = [];
    const seen = new Set<string>();

    for (const mistake of mistakes) {
      // Create signature
      const signature = `${mistake.what_went_wrong.substring(0, 100)}_${mistake.timestamp}`;

      if (!seen.has(signature)) {
        seen.add(signature);
        unique.push(mistake);
      }
    }

    return unique;
  }

  /**
   * Score mistake severity (for prioritization)
   */
  scoreMistakeSeverity(mistake: Mistake): number {
    let score = 0;

    // Has correction
    if (mistake.correction) {score += 2;}

    // User explicitly corrected
    if (mistake.user_correction_message) {score += 3;}

    // Affects files
    if (mistake.files_affected.length > 0) {score += 2;}

    // Type-based severity
    switch (mistake.mistake_type) {
      case "logic_error":
        score += 3;
        break;
      case "wrong_approach":
        score += 2;
        break;
      case "syntax_error":
        score += 1;
        break;
      case "tool_error":
        score += 1;
        break;
    }

    return score;
  }
}
