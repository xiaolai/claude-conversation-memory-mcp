/**
 * Incremental Parser
 *
 * Parses new lines from Claude conversation JSONL files as they are appended.
 * Maintains file positions to only process new content.
 */

import { readFileSync, statSync, existsSync } from "fs";

/**
 * Parsed message from a JSONL file
 */
export interface ParsedMessage {
  type: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  toolUse?: {
    name: string;
    input: Record<string, unknown>;
  };
  toolResult?: {
    name: string;
    output: string;
    isError?: boolean;
  };
  thinkingContent?: string;
}

/**
 * File tracking info
 */
interface FileInfo {
  path: string;
  lastPosition: number;
  lastModified: number;
  lineCount: number;
}

export class IncrementalParser {
  private filePositions: Map<string, FileInfo> = new Map();

  constructor() {
    // No initialization needed - file positions are initialized inline
  }

  /**
   * Parse new content from a file since last read
   */
  parseNewContent(filePath: string): ParsedMessage[] {
    if (!existsSync(filePath)) {
      return [];
    }

    const stats = statSync(filePath);
    const fileInfo = this.filePositions.get(filePath);

    // Check if file has been modified (mtime granularity can be coarse)
    if (fileInfo) {
      const sizeUnchanged = stats.size <= fileInfo.lastPosition;
      const mtimeUnchanged = stats.mtimeMs <= fileInfo.lastModified;
      if (mtimeUnchanged && sizeUnchanged) {
        return []; // No changes
      }
    }

    // Read file content
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    // Determine where to start parsing (reset if file was truncated)
    const startLine =
      fileInfo && stats.size >= fileInfo.lastPosition ? fileInfo.lineCount : 0;

    // Parse new lines
    const messages: ParsedMessage[] = [];
    for (let i = startLine; i < lines.length; i++) {
      const parsed = this.parseLine(lines[i]);
      if (parsed) {
        messages.push(parsed);
      }
    }

    // Update tracking info
    this.filePositions.set(filePath, {
      path: filePath,
      lastPosition: content.length,
      lastModified: stats.mtimeMs,
      lineCount: lines.length,
    });

    return messages;
  }

  /**
   * Parse a single JSONL line
   */
  private parseLine(line: string): ParsedMessage | null {
    try {
      const data = JSON.parse(line) as Record<string, unknown>;
      return this.extractMessage(data);
    } catch (_error) {
      // Invalid JSON - skip
      return null;
    }
  }

  /**
   * Extract message from parsed JSON data
   */
  private extractMessage(data: Record<string, unknown>): ParsedMessage | null {
    // Handle different Claude message formats

    // Standard message format
    if (data.type === "message" || data.role) {
      const role = (data.role || data.type) as string;
      let messageType: ParsedMessage["type"] = "user";

      if (role === "assistant" || role === "model") {
        messageType = "assistant";
      } else if (role === "system") {
        messageType = "system";
      }

      const message: ParsedMessage = {
        type: messageType,
        content: this.extractContent(data.content),
        timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
      };

      // Extract tool use if present
      const toolUse = this.extractToolUse(data);
      if (toolUse) {
        message.toolUse = toolUse;
      }

      // Extract tool result if present
      const toolResult = this.extractToolResult(data);
      if (toolResult) {
        message.toolResult = toolResult;
      }

      // Extract thinking content
      const thinking = this.extractThinking(data);
      if (thinking) {
        message.thinkingContent = thinking;
      }

      return message;
    }

    // Tool use block format
    if (data.type === "tool_use") {
      return {
        type: "assistant",
        content: "",
        toolUse: {
          name: typeof data.name === "string" ? data.name : "unknown",
          input: (data.input || {}) as Record<string, unknown>,
        },
        timestamp: Date.now(),
      };
    }

    // Tool result format
    if (data.type === "tool_result") {
      return {
        type: "user",
        content: "",
        toolResult: {
          name: typeof data.tool_use_id === "string" ? data.tool_use_id : "unknown",
          output: this.extractContent(data.content),
          isError: data.is_error === true,
        },
        timestamp: Date.now(),
      };
    }

    return null;
  }

  /**
   * Extract text content from various content formats
   */
  private extractContent(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (typeof block === "string") {
            return block;
          }
          if (typeof block === "object" && block !== null) {
            const b = block as Record<string, unknown>;
            if (b.type === "text" && typeof b.text === "string") {
              return b.text;
            }
          }
          return "";
        })
        .join("\n");
    }

    return "";
  }

  /**
   * Extract tool use information
   */
  private extractToolUse(
    data: Record<string, unknown>
  ): { name: string; input: Record<string, unknown> } | null {
    // Check content array for tool_use blocks
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (typeof block === "object" && block !== null) {
          const b = block as Record<string, unknown>;
          if (b.type === "tool_use" && typeof b.name === "string") {
            return {
              name: b.name,
              input: (b.input || {}) as Record<string, unknown>,
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract tool result information
   */
  private extractToolResult(
    data: Record<string, unknown>
  ): { name: string; output: string; isError?: boolean } | null {
    // Check content array for tool_result blocks
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (typeof block === "object" && block !== null) {
          const b = block as Record<string, unknown>;
          if (b.type === "tool_result") {
            return {
              name: typeof b.tool_use_id === "string" ? b.tool_use_id : "unknown",
              output: this.extractContent(b.content),
              isError: b.is_error === true,
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract thinking/reasoning content
   */
  private extractThinking(data: Record<string, unknown>): string | null {
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (typeof block === "object" && block !== null) {
          const b = block as Record<string, unknown>;
          if (b.type === "thinking" && typeof b.thinking === "string") {
            return b.thinking;
          }
        }
      }
    }

    return null;
  }

  /**
   * Reset tracking for a specific file
   */
  resetFile(filePath: string): void {
    this.filePositions.delete(filePath);
  }

  /**
   * Reset all tracking
   */
  resetAll(): void {
    this.filePositions.clear();
  }

  /**
   * Get current tracking info for a file
   */
  getFileInfo(filePath: string): FileInfo | undefined {
    return this.filePositions.get(filePath);
  }

  /**
   * Get all tracked files
   */
  getTrackedFiles(): string[] {
    return Array.from(this.filePositions.keys());
  }
}
