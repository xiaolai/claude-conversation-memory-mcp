/**
 * Live Extractor
 *
 * Extracts decisions, file operations, and errors from parsed messages
 * in real-time and stores them in working memory.
 */

import type { Database } from "better-sqlite3";
import type { ParsedMessage } from "./IncrementalParser.js";
import type { RealtimeConfig } from "../memory/types.js";
import { WorkingMemoryStore } from "../memory/WorkingMemoryStore.js";
import { dirname } from "path";
import { getCanonicalProjectPath } from "../utils/worktree.js";

/**
 * Result of extraction processing
 */
export interface ExtractionResult {
  messagesProcessed: number;
  decisionsExtracted: number;
  filesTracked: number;
  errorsDetected: number;
  memoryItemsCreated: number;
}

/**
 * Detected decision pattern
 */
interface DetectedDecision {
  text: string;
  rationale?: string;
  confidence: number;
}

/**
 * Detected file operation
 */
interface DetectedFileOp {
  path: string;
  action: "read" | "edit" | "create" | "delete";
  timestamp: number;
}

export class LiveExtractor {
  private memoryStore: WorkingMemoryStore;
  private config: RealtimeConfig;

  // Decision detection patterns
  private decisionPatterns = [
    /(?:I'll|I will|Let's|We should|I've decided to|Going to) ([^.]+)/gi,
    /(?:decided|choosing|opting|selecting) (?:to )?([^.]+)/gi,
    /(?:using|implementing|adopting) ([^.]+?) (?:for|because|since)/gi,
    /(?:the (?:best|right|correct) (?:approach|solution|way) is) ([^.]+)/gi,
  ];

  // Error detection patterns
  private errorPatterns = [
    /error[:\s]+(.+)/gi,
    /failed[:\s]+(.+)/gi,
    /exception[:\s]+(.+)/gi,
    /cannot (.+)/gi,
    /unable to (.+)/gi,
  ];

  constructor(db: Database, config?: Partial<RealtimeConfig>) {
    this.memoryStore = new WorkingMemoryStore(db);
    this.config = {
      enabled: true,
      watchPaths: [],
      extractionInterval: 1000,
      checkpointInterval: 60000,
      autoRemember: {
        decisions: true,
        fileEdits: true,
        errors: true,
      },
      ...config,
    };
  }

  /**
   * Process a batch of messages and extract relevant information
   */
  async processMessages(
    filePath: string,
    messages: ParsedMessage[]
  ): Promise<ExtractionResult> {
    const projectPath = this.extractProjectPath(filePath);
    const result: ExtractionResult = {
      messagesProcessed: messages.length,
      decisionsExtracted: 0,
      filesTracked: 0,
      errorsDetected: 0,
      memoryItemsCreated: 0,
    };

    for (const message of messages) {
      // Process assistant messages for decisions
      if (message.type === "assistant" && this.config.autoRemember.decisions) {
        const decisions = this.extractDecisions(message.content);
        for (const decision of decisions) {
          if (decision.confidence > 0.5) {
            this.storeDecision(projectPath, decision);
            result.decisionsExtracted++;
            result.memoryItemsCreated++;
          }
        }
      }

      // Process tool uses for file operations
      if (message.toolUse && this.config.autoRemember.fileEdits) {
        const fileOp = this.extractFileOperation(message.toolUse);
        if (fileOp) {
          this.storeFileOperation(projectPath, fileOp);
          result.filesTracked++;
          result.memoryItemsCreated++;
        }
      }

      // Process tool results for errors
      if (message.toolResult?.isError && this.config.autoRemember.errors) {
        this.storeError(projectPath, message.toolResult.output);
        result.errorsDetected++;
        result.memoryItemsCreated++;
      }

      // Also check content for errors
      if (this.config.autoRemember.errors) {
        const errors = this.extractErrors(message.content);
        for (const error of errors) {
          this.storeError(projectPath, error);
          result.errorsDetected++;
          result.memoryItemsCreated++;
        }
      }
    }

    return result;
  }

  /**
   * Extract project path from file path
   */
  private extractProjectPath(filePath: string): string {
    // Claude conversation paths are typically:
    // ~/.claude/projects/-Users-name-project/.../conversation.jsonl
    // We want to extract the actual project path

    const match = filePath.match(/projects\/(.+?)\//);
    if (match) {
      // Convert the encoded path back to real path
      const encoded = match[1];
      const decodedPath = "/" + encoded.replace(/-/g, "/").replace(/\/\//g, "-");
      return getCanonicalProjectPath(decodedPath).canonicalPath;
    }

    return getCanonicalProjectPath(dirname(filePath)).canonicalPath;
  }

  /**
   * Extract decisions from message content
   */
  private extractDecisions(content: string): DetectedDecision[] {
    const decisions: DetectedDecision[] = [];

    for (const pattern of this.decisionPatterns) {
      // Reset regex lastIndex
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        const decisionText = match[1].trim();

        // Skip if too short or too long
        if (decisionText.length < 10 || decisionText.length > 200) {
          continue;
        }

        // Calculate confidence based on context
        const confidence = this.calculateDecisionConfidence(decisionText, content);

        decisions.push({
          text: decisionText,
          confidence,
        });
      }
    }

    // Deduplicate similar decisions
    return this.deduplicateDecisions(decisions);
  }

  /**
   * Calculate confidence score for a decision
   */
  private calculateDecisionConfidence(decision: string, context: string): number {
    let confidence = 0.5;

    // Higher confidence if it mentions specific tech/patterns
    const techPatterns = [
      /typescript|javascript|python|rust|go/i,
      /react|vue|angular|svelte/i,
      /sqlite|postgres|mongodb|redis/i,
      /api|rest|graphql|grpc/i,
      /pattern|architecture|design/i,
    ];

    for (const pattern of techPatterns) {
      if (pattern.test(decision)) {
        confidence += 0.1;
      }
    }

    // Higher confidence if in a longer context
    if (context.length > 500) {
      confidence += 0.1;
    }

    // Lower confidence if it looks like a question
    if (decision.includes("?")) {
      confidence -= 0.2;
    }

    return Math.min(1, Math.max(0, confidence));
  }

  /**
   * Deduplicate similar decisions
   */
  private deduplicateDecisions(decisions: DetectedDecision[]): DetectedDecision[] {
    const seen = new Set<string>();
    const unique: DetectedDecision[] = [];

    for (const decision of decisions) {
      const normalized = decision.text.toLowerCase().replace(/\s+/g, " ");
      if (!seen.has(normalized)) {
        seen.add(normalized);
        unique.push(decision);
      }
    }

    return unique;
  }

  /**
   * Extract file operation from tool use
   */
  private extractFileOperation(toolUse: {
    name: string;
    input: Record<string, unknown>;
  }): DetectedFileOp | null {
    const { name, input } = toolUse;

    let filePath: string | undefined;
    let action: DetectedFileOp["action"] = "read";

    switch (name) {
      case "Read":
        filePath = input.file_path as string | undefined;
        action = "read";
        break;
      case "Edit":
        filePath = input.file_path as string | undefined;
        action = "edit";
        break;
      case "Write":
        filePath = input.file_path as string | undefined;
        action = "create";
        break;
      case "Bash": {
        // Try to extract file paths from bash commands
        const cmd = input.command as string | undefined;
        if (cmd) {
          if (cmd.includes("rm ") || cmd.includes("rm -")) {
            const rmMatch = cmd.match(/rm\s+(?:-\w+\s+)*(\S+)/);
            if (rmMatch) {
              filePath = rmMatch[1];
              action = "delete";
            }
          }
        }
        break;
      }
    }

    if (filePath) {
      return {
        path: filePath,
        action,
        timestamp: Date.now(),
      };
    }

    return null;
  }

  /**
   * Extract errors from content
   */
  private extractErrors(content: string): string[] {
    const errors: string[] = [];

    for (const pattern of this.errorPatterns) {
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        const errorText = match[1].trim();
        if (errorText.length > 5 && errorText.length < 500) {
          errors.push(errorText);
        }
      }
    }

    return errors.slice(0, 5); // Limit to 5 errors per message
  }

  /**
   * Store a detected decision in working memory
   */
  private storeDecision(projectPath: string, decision: DetectedDecision): void {
    const key = `decision_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.memoryStore.remember({
      key,
      value: decision.text,
      context: decision.rationale,
      tags: ["decision", "auto-extracted"],
      projectPath,
      ttl: 86400 * 7, // 7 days
    });
  }

  /**
   * Store a file operation in working memory
   */
  private storeFileOperation(projectPath: string, fileOp: DetectedFileOp): void {
    // Use a stable key for the file to update rather than create new entries
    const key = `file_${fileOp.path.replace(/[^a-zA-Z0-9]/g, "_")}`;

    this.memoryStore.remember({
      key,
      value: `${fileOp.action}: ${fileOp.path}`,
      tags: ["file", fileOp.action, "auto-extracted"],
      projectPath,
      ttl: 86400, // 1 day
    });
  }

  /**
   * Store an error in working memory
   */
  private storeError(projectPath: string, error: string): void {
    const key = `error_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.memoryStore.remember({
      key,
      value: error,
      tags: ["error", "auto-extracted"],
      projectPath,
      ttl: 86400 * 3, // 3 days
    });
  }

  /**
   * Get the working memory store for direct access
   */
  getMemoryStore(): WorkingMemoryStore {
    return this.memoryStore;
  }
}
