/**
 * Codex Conversation Parser for MCP integration.
 *
 * This parser reads conversation history from Codex's storage location
 * (~/.codex/sessions) and converts it to the same format as ConversationParser.
 *
 * Codex stores conversations in a date-hierarchical structure:
 * ~/.codex/sessions/YYYY/MM/DD/rollout-{timestamp}-{uuid}.jsonl
 *
 * Each line in a Codex session file has the structure:
 * {
 *   timestamp: string,
 *   type: "session_meta" | "response_item" | "event_msg" | "turn_context",
 *   payload: { ... }
 * }
 *
 * @example
 * ```typescript
 * const parser = new CodexConversationParser();
 * const result = parser.parseSessions('/Users/username/.codex');
 * console.log(`Parsed ${result.conversations.length} Codex sessions`);
 * ```
 */

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { nanoid } from "nanoid";
import type {
  Conversation,
  Message,
  ToolUse,
  ToolResult,
  FileEdit,
  ThinkingBlock,
  ParseResult,
} from "./ConversationParser.js";

// Codex-specific type definitions
interface CodexEntry {
  timestamp: string;
  type: "session_meta" | "response_item" | "event_msg" | "turn_context";
  payload: Record<string, unknown>;
}

interface CodexSessionMeta {
  id: string;
  timestamp: string;
  cwd?: string;
  originator?: string;
  cli_version?: string;
  instructions?: string;
  source?: string;
  model_provider?: string;
  git?: {
    commit_hash?: string;
    branch?: string;
    repository_url?: string;
  };
}

interface CodexContentItem {
  type?: string;
  text?: string;
  thinking?: string;
  signature?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  stdout?: string;
  stderr?: string;
}

/**
 * Parser for Codex conversation history.
 *
 * Converts Codex session files into the same format as ConversationParser
 * so they can be stored in the same database and searched together.
 */
export class CodexConversationParser {
  /**
   * Parse all Codex sessions.
   *
   * Recursively scans the sessions directory for JSONL files and parses them.
   *
   * @param codexPath - Path to Codex home directory (default: ~/.codex)
   * @param sessionId - Optional specific session ID to parse
   * @returns ParseResult with all extracted entities
   */
  parseSession(
    codexPath: string,
    sessionId?: string,
    lastIndexedMs?: number
  ): ParseResult {
    const sessionsDir = join(codexPath, "sessions");

    if (!existsSync(sessionsDir)) {
      throw new Error(`Codex sessions directory not found: ${sessionsDir}`);
    }

    const conversations: Conversation[] = [];
    const messages: Message[] = [];
    const tool_uses: ToolUse[] = [];
    const tool_results: ToolResult[] = [];
    const file_edits: FileEdit[] = [];
    const thinking_blocks: ThinkingBlock[] = [];
    const indexed_folders: string[] = [];
    let skippedCount = 0;

    // Recursively find all .jsonl files in date-hierarchical structure
    const sessionFiles = this.findSessionFiles(sessionsDir);

    for (const sessionFile of sessionFiles) {
      try {
        // Skip unchanged files in incremental mode
        if (lastIndexedMs) {
          const stats = statSync(sessionFile);
          if (stats.mtimeMs < lastIndexedMs) {
            skippedCount++;
            continue;
          }
        }

        // Extract session ID from filename: rollout-{timestamp}-{uuid}.jsonl
        const filename = sessionFile.split("/").pop();
        if (!filename) {
          continue;
        }

        // Match rollout-{timestamp}-{uuid}.jsonl where timestamp is like 2025-11-03T20-35-04
        // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        const match = filename.match(/rollout-.+-([0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+)\.jsonl$/i);
        let extractedSessionId: string;
        if (match) {
          extractedSessionId = match[1];
        } else {
          // Fallback: just strip "rollout-" prefix and ".jsonl" suffix
          const fallbackId = filename.replace(/^rollout-/, "").replace(/\.jsonl$/, "");
          if (!fallbackId) {
            continue;
          }
          extractedSessionId = fallbackId;
        }

        // Skip if filtering by session ID
        if (sessionId && extractedSessionId !== sessionId) {
          continue;
        }

        const result = this.parseSessionFile(sessionFile, codexPath);

        conversations.push(...result.conversations);
        messages.push(...result.messages);
        tool_uses.push(...result.tool_uses);
        tool_results.push(...result.tool_results);
        file_edits.push(...result.file_edits);
        thinking_blocks.push(...result.thinking_blocks);

        // Track indexed folder
        const sessionDir = sessionFile.substring(0, sessionFile.lastIndexOf("/"));
        if (!indexed_folders.includes(sessionDir)) {
          indexed_folders.push(sessionDir);
        }
      } catch (error) {
        console.warn(`Failed to parse Codex session file ${sessionFile}:`, error);
      }
    }

    if (skippedCount > 0) {
      console.log(`⏭ Skipped ${skippedCount} unchanged Codex session file(s)`);
    }

    return {
      conversations,
      messages,
      tool_uses,
      tool_results,
      file_edits,
      thinking_blocks,
      indexed_folders,
    };
  }

  /**
   * Recursively find all .jsonl session files.
   */
  private findSessionFiles(dir: string): string[] {
    const files: string[] = [];

    if (!existsSync(dir)) {
      return files;
    }

    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...this.findSessionFiles(fullPath));
      } else if (entry.endsWith(".jsonl") && entry.startsWith("rollout-")) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Parse a single Codex session file.
   */
  private parseSessionFile(filePath: string, codexPath: string): ParseResult {
    const conversations: Conversation[] = [];
    const messages: Message[] = [];
    const tool_uses: ToolUse[] = [];
    const tool_results: ToolResult[] = [];
    const file_edits: FileEdit[] = [];
    const thinking_blocks: ThinkingBlock[] = [];

    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter((line) => line.trim());

    if (lines.length === 0) {
      return {
        conversations,
        messages,
        tool_uses,
        tool_results,
        file_edits,
        thinking_blocks,
      };
    }

    // Parse all entries
    const entries: CodexEntry[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as CodexEntry;
        entries.push(entry);
      } catch (_error) {
        // Skip malformed lines
        continue;
      }
    }

    // Extract session metadata
    const sessionMetaEntry = entries.find((e) => e.type === "session_meta");
    if (!sessionMetaEntry) {
      return {
        conversations,
        messages,
        tool_uses,
        tool_results,
        file_edits,
        thinking_blocks,
      };
    }

    const sessionMeta = sessionMetaEntry.payload as unknown as CodexSessionMeta;
    const sessionId = sessionMeta.id;
    const sessionTimestamp = new Date(sessionMeta.timestamp).getTime();

    // Create conversation record
    const conversation: Conversation = {
      id: sessionId,
      project_path: sessionMeta.cwd || codexPath,
      source_type: "codex",
      first_message_at: sessionTimestamp,
      last_message_at: sessionTimestamp,
      message_count: 0,
      git_branch: sessionMeta.git?.branch,
      claude_version: sessionMeta.cli_version,
      metadata: {
        source: "codex",
        originator: sessionMeta.originator,
        model_provider: sessionMeta.model_provider,
        git_commit: sessionMeta.git?.commit_hash,
        git_repo: sessionMeta.git?.repository_url,
      },
      created_at: sessionTimestamp,
      updated_at: sessionTimestamp,
    };

    // Process response_item entries (these contain user/assistant messages and tools)
    const responseItems = entries.filter((e) => e.type === "response_item");

    for (const entry of responseItems) {
      const timestamp = new Date(entry.timestamp).getTime();
      const payload = entry.payload;

      // Update conversation timestamps
      if (timestamp < conversation.first_message_at) {
        conversation.first_message_at = timestamp;
      }
      if (timestamp > conversation.last_message_at) {
        conversation.last_message_at = timestamp;
      }

      // Extract message role and content
      const role = payload.role as string | undefined;
      const content = payload.content as unknown[] | string | undefined;

      if (!role || !content) {
        continue;
      }

      // Create message record
      const messageId = payload.id as string || `${sessionId}-${nanoid()}`;
      const parentId = payload.parent_message_id as string | undefined;

      const message: Message = {
        id: messageId,
        conversation_id: sessionId,
        parent_id: parentId,
        message_type: role === "user" ? "user" : "assistant",
        role,
        content: typeof content === "string" ? content : JSON.stringify(content),
        timestamp,
        is_sidechain: false,
        metadata: payload as Record<string, unknown>,
      };

      messages.push(message);
      conversation.message_count++;

      // Extract tool uses and results from content array
      if (Array.isArray(content)) {
        for (const item of content) {
          const contentItem = item as CodexContentItem;

          // Extract thinking blocks
          if (contentItem.type === "thinking" && contentItem.thinking) {
            const thinkingBlock: ThinkingBlock = {
              id: `${messageId}-thinking-${nanoid()}`,
              message_id: messageId,
              thinking_content: contentItem.thinking,
              signature: contentItem.signature,
              timestamp,
            };
            thinking_blocks.push(thinkingBlock);
          }

          // Extract tool uses
          if (contentItem.type === "tool_use" && contentItem.name && contentItem.id) {
            const toolUse: ToolUse = {
              id: contentItem.id,
              message_id: messageId,
              tool_name: contentItem.name,
              tool_input: (contentItem.input || {}) as Record<string, unknown>,
              timestamp,
            };
            tool_uses.push(toolUse);
          }

          // Extract tool results
          if (contentItem.type === "tool_result" && contentItem.tool_use_id) {
            const toolResult: ToolResult = {
              id: `${contentItem.tool_use_id}-result`,
              tool_use_id: contentItem.tool_use_id,
              message_id: messageId,
              content: typeof contentItem.content === "string" ? contentItem.content : JSON.stringify(contentItem.content),
              is_error: Boolean(contentItem.is_error),
              stdout: contentItem.stdout,
              stderr: contentItem.stderr,
              is_image: false,
              timestamp,
            };
            tool_results.push(toolResult);
          }
        }
      }
    }

    conversations.push(conversation);

    return {
      conversations,
      messages,
      tool_uses,
      tool_results,
      file_edits,
      thinking_blocks,
    };
  }
}
