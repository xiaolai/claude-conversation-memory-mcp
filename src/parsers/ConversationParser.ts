/**
 * Multi-pass JSONL Conversation Parser
 * Parses Claude Code conversation history from ~/.claude/projects
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { nanoid } from "nanoid";
import { pathToProjectFolderName } from "../utils/sanitization.js";

// Helper types for parsing dynamic JSON data
interface MessageData {
  role?: string;
  content?: unknown[] | string;
}

interface ToolUseResultData {
  stdout?: string;
  stderr?: string;
  isImage?: boolean;
}

interface ContentItem {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  text?: string;
  thinking?: string;
  signature?: string;
}

interface SnapshotData {
  trackedFileBackups?: Record<string, unknown>;
  timestamp?: string;
}

// Type definitions based on investigation of conversation data
export interface ConversationMessage {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  isSidechain?: boolean;
  agentId?: string;
  userType?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  message?: unknown;
  requestId?: string;
  // File history snapshot fields
  messageId?: string;
  snapshot?: unknown;
  // Summary fields
  summary?: string;
  leafUuid?: string;
  // System message fields
  subtype?: string;
  level?: string;
  content?: string | unknown[];
  error?: unknown;
  // Tool use result fields
  toolUseResult?: unknown;
  // Other fields
  [key: string]: unknown;
}

export interface Conversation {
  id: string;
  project_path: string;
  first_message_at: number;
  last_message_at: number;
  message_count: number;
  git_branch?: string;
  claude_version?: string;
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  parent_id?: string;
  message_type: string;
  role?: string;
  content?: string;
  timestamp: number;
  is_sidechain: boolean;
  agent_id?: string;
  request_id?: string;
  git_branch?: string;
  cwd?: string;
  metadata: Record<string, unknown>;
}

export interface ToolUse {
  id: string;
  message_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  timestamp: number;
}

export interface ToolResult {
  id: string;
  tool_use_id: string;
  message_id: string;
  content?: string;
  is_error: boolean;
  stdout?: string;
  stderr?: string;
  is_image: boolean;
  timestamp: number;
}

export interface FileEdit {
  id: string;
  conversation_id: string;
  file_path: string;
  message_id: string;
  backup_version?: number;
  backup_time?: number;
  snapshot_timestamp: number;
  metadata: Record<string, unknown>;
}

export interface ThinkingBlock {
  id: string;
  message_id: string;
  thinking_content: string;
  signature?: string;
  timestamp: number;
}

export interface ParseResult {
  conversations: Conversation[];
  messages: Message[];
  tool_uses: ToolUse[];
  tool_results: ToolResult[];
  file_edits: FileEdit[];
  thinking_blocks: ThinkingBlock[];
}

export class ConversationParser {
  /**
   * Parse all conversations for a project
   */
  parseProject(projectPath: string, sessionId?: string): ParseResult {
    console.log(`Parsing conversations for project: ${projectPath}`);
    if (sessionId) {
      console.log(`Filtering for session: ${sessionId}`);
    }

    // Convert project path to Claude projects directory name
    const projectDirName = pathToProjectFolderName(projectPath);
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";

    // Try current naming convention first
    let conversationDir = join(homeDir, ".claude", "projects", projectDirName);

    // If not found, try legacy naming (dots replaced with dashes)
    if (!existsSync(conversationDir)) {
      const legacyDirName = projectDirName.replace(/\./g, '-');
      const legacyDir = join(homeDir, ".claude", "projects", legacyDirName);

      if (existsSync(legacyDir)) {
        console.log(`Using legacy folder naming: ${legacyDirName}`);
        conversationDir = legacyDir;
      }
    }

    console.log(`Looking in: ${conversationDir}`);

    // Check if directory exists
    if (!existsSync(conversationDir)) {
      console.warn(`⚠️ Conversation directory not found: ${conversationDir}`);
      return {
        conversations: [],
        messages: [],
        tool_uses: [],
        tool_results: [],
        file_edits: [],
        thinking_blocks: [],
      };
    }

    // Read all .jsonl files, optionally filtering by session_id
    let files = readdirSync(conversationDir).filter((f) =>
      f.endsWith(".jsonl")
    );

    // If session_id provided, filter to only that session file
    if (sessionId) {
      files = files.filter((f) => f === `${sessionId}.jsonl`);
      if (files.length === 0) {
        console.warn(`⚠️ Session file not found: ${sessionId}.jsonl`);
        console.warn(`Available sessions: ${readdirSync(conversationDir).filter((f) => f.endsWith(".jsonl")).join(", ")}`);
      }
    }

    console.log(`Found ${files.length} conversation file(s) to parse`);

    // Parse each file
    const result: ParseResult = {
      conversations: [],
      messages: [],
      tool_uses: [],
      tool_results: [],
      file_edits: [],
      thinking_blocks: [],
    };

    for (const file of files) {
      const filePath = join(conversationDir, file);
      this.parseFile(filePath, result, projectPath);
    }

    console.log(
      `Parsed ${result.conversations.length} conversations, ${result.messages.length} messages`
    );

    return result;
  }

  /**
   * Parse a single .jsonl file
   */
  private parseFile(
    filePath: string,
    result: ParseResult,
    projectPath: string
  ): void {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    // Parse messages from this file
    const fileMessages: ConversationMessage[] = [];
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        fileMessages.push(msg);
      } catch (error) {
        console.error(`Error parsing line in ${filePath}:`, error);
      }
    }

    if (fileMessages.length === 0) {return;}

    // Pass 1: Extract conversation info
    this.extractConversation(fileMessages, result, projectPath);

    // Pass 2: Extract messages
    this.extractMessages(fileMessages, result);

    // Pass 3: Extract tool uses and results
    this.extractToolCalls(fileMessages, result);

    // Pass 4: Extract file edits
    this.extractFileEdits(fileMessages, result);

    // Pass 5: Extract thinking blocks
    this.extractThinkingBlocks(fileMessages, result);
  }

  /**
   * Pass 1: Extract conversation metadata
   */
  private extractConversation(
    messages: ConversationMessage[],
    result: ParseResult,
    projectPath: string
  ): void {
    // Get sessionId from first message
    const firstMsg = messages.find((m) => m.sessionId);
    if (!firstMsg || !firstMsg.sessionId) {return;}

    const sessionId = firstMsg.sessionId;

    // Check if conversation already exists
    if (result.conversations.some((c) => c.id === sessionId)) {
      return;
    }

    // Find timestamps
    const timestamps = messages
      .filter((m): m is typeof m & { timestamp: string } => !!m.timestamp)
      .map((m) => new Date(m.timestamp).getTime())
      .sort((a, b) => a - b);

    if (timestamps.length === 0) {
      return;
    }

    // Get most common git branch and version
    const branches = messages
      .filter((m): m is typeof m & { gitBranch: string } => !!m.gitBranch)
      .map((m) => m.gitBranch);
    const versions = messages
      .filter((m): m is typeof m & { version: string } => !!m.version)
      .map((m) => m.version);

    // Detect MCP tool usage
    const mcpUsage = this.detectMcpUsage(messages);

    const conversation: Conversation = {
      id: sessionId,
      project_path: projectPath,
      first_message_at: timestamps[0],
      last_message_at: timestamps[timestamps.length - 1],
      message_count: messages.filter((m) => m.type === "user" || m.type === "assistant").length,
      git_branch: branches[branches.length - 1],
      claude_version: versions[versions.length - 1],
      metadata: {
        total_messages: messages.length,
        mcp_usage: mcpUsage,
      },
      created_at: timestamps[0],
      updated_at: Date.now(),
    };

    result.conversations.push(conversation);
  }

  /**
   * Detect MCP tool usage in conversation messages
   */
  private detectMcpUsage(messages: ConversationMessage[]): {
    detected: boolean;
    servers: string[];
  } {
    const servers = new Set<string>();

    for (const msg of messages) {
      const messageData = msg.message as MessageData | undefined;
      if (!messageData?.content || !Array.isArray(messageData.content)) {
        continue;
      }

      for (const item of messageData.content) {
        const contentItem = item as ContentItem;
        if (contentItem.type === "tool_use" && contentItem.name?.startsWith("mcp__")) {
          // Extract server name from tool name
          // Format: mcp__server-name__tool-name
          const parts = contentItem.name.split("__");
          if (parts.length >= 2) {
            servers.add(parts[1]);
          }
        }
      }
    }

    return {
      detected: servers.size > 0,
      servers: Array.from(servers),
    };
  }

  /**
   * Pass 2: Extract individual messages
   */
  private extractMessages(
    messages: ConversationMessage[],
    result: ParseResult
  ): void {
    for (const msg of messages) {
      if (!msg.uuid || !msg.sessionId) {continue;}

      const message: Message = {
        id: msg.uuid,
        conversation_id: msg.sessionId,
        parent_id: msg.parentUuid || undefined,
        message_type: msg.type,
        role: (msg.message as MessageData | undefined)?.role,
        content: this.extractContent(msg),
        timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
        is_sidechain: msg.isSidechain || false,
        agent_id: msg.agentId,
        request_id: msg.requestId,
        git_branch: msg.gitBranch,
        cwd: msg.cwd,
        metadata: msg,
      };

      result.messages.push(message);
    }
  }

  /**
   * Pass 3: Extract tool uses and results
   */
  private extractToolCalls(
    messages: ConversationMessage[],
    result: ParseResult
  ): void {
    for (const msg of messages) {
      const messageData = msg.message as MessageData | undefined;
      if (!messageData?.content || !Array.isArray(messageData.content) || !msg.uuid) {
        continue;
      }

      const timestamp = msg.timestamp
        ? new Date(msg.timestamp).getTime()
        : Date.now();

      for (const item of messageData.content) {
        const contentItem = item as ContentItem;

        // Tool use
        if (contentItem.type === "tool_use") {
          const toolUse: ToolUse = {
            id: contentItem.id || "",
            message_id: msg.uuid,
            tool_name: contentItem.name || "",
            tool_input: contentItem.input || {},
            timestamp,
          };
          result.tool_uses.push(toolUse);
        }

        // Tool result
        if (contentItem.type === "tool_result") {
          const toolUseResult = msg.toolUseResult as ToolUseResultData | undefined;
          const toolResult: ToolResult = {
            id: nanoid(),
            tool_use_id: contentItem.tool_use_id || "",
            message_id: msg.uuid,
            content: typeof contentItem.content === "string" ? contentItem.content : JSON.stringify(contentItem.content),
            is_error: contentItem.is_error || false,
            stdout: toolUseResult?.stdout,
            stderr: toolUseResult?.stderr,
            is_image: toolUseResult?.isImage || false,
            timestamp,
          };
          result.tool_results.push(toolResult);
        }
      }
    }
  }

  /**
   * Pass 4: Extract file edits from snapshots
   */
  private extractFileEdits(
    messages: ConversationMessage[],
    result: ParseResult
  ): void {
    // Build a Set of stored message IDs for quick lookup
    const storedMessageIds = new Set(result.messages.map(m => m.id));

    for (const msg of messages) {
      if (msg.type !== "file-history-snapshot" || !msg.snapshot) {
        continue;
      }

      // Get the message ID that would reference this snapshot
      const messageId = msg.messageId || msg.uuid;
      if (!messageId) {
        continue; // No message ID to reference
      }

      // Skip if the message wasn't stored (e.g., lacks uuid or sessionId)
      if (!storedMessageIds.has(messageId)) {
        // This is expected for file-history-snapshot messages that don't have uuid/sessionId
        continue;
      }

      const snapshot = msg.snapshot as SnapshotData;
      const trackedFiles = snapshot.trackedFileBackups || {};
      const conversationId = msg.sessionId;
      if (!conversationId) {
        continue; // Need conversation ID for foreign key
      }

      for (const [filePath, fileInfo] of Object.entries(trackedFiles)) {
        const info = fileInfo as Record<string, unknown>;
        const fileEdit: FileEdit = {
          id: nanoid(),
          conversation_id: conversationId,
          file_path: filePath,
          message_id: messageId,
          backup_version: info.version as number | undefined,
          backup_time: info.backupTime
            ? new Date(info.backupTime as string).getTime()
            : undefined,
          snapshot_timestamp: snapshot.timestamp
            ? new Date(snapshot.timestamp).getTime()
            : Date.now(),
          metadata: info,
        };
        result.file_edits.push(fileEdit);
      }
    }
  }

  /**
   * Pass 5: Extract thinking blocks
   */
  private extractThinkingBlocks(
    messages: ConversationMessage[],
    result: ParseResult
  ): void {
    for (const msg of messages) {
      const messageData = msg.message as MessageData | undefined;
      if (!messageData?.content || !Array.isArray(messageData.content) || !msg.uuid) {
        continue;
      }

      const timestamp = msg.timestamp
        ? new Date(msg.timestamp).getTime()
        : Date.now();

      for (const item of messageData.content) {
        const contentItem = item as ContentItem;
        if (contentItem.type === "thinking") {
          const thinking: ThinkingBlock = {
            id: nanoid(),
            message_id: msg.uuid,
            thinking_content: contentItem.thinking || "",
            signature: contentItem.signature,
            timestamp,
          };
          result.thinking_blocks.push(thinking);
        }
      }
    }
  }

  /**
   * Extract text content from message
   */
  private extractContent(msg: ConversationMessage): string | undefined {
    // System messages
    if (msg.type === "system" && typeof msg.content === "string") {
      return msg.content;
    }

    // Summary messages
    if (msg.type === "summary" && msg.summary) {
      return msg.summary;
    }

    // User/Assistant messages
    const messageData = msg.message as MessageData | undefined;
    if (messageData?.content) {
      if (typeof messageData.content === "string") {
        return messageData.content;
      }

      if (Array.isArray(messageData.content)) {
        // Extract text blocks
        const textBlocks = messageData.content.filter(
          (item: unknown) => (item as ContentItem).type === "text"
        );
        return textBlocks.map((item: unknown) => (item as ContentItem).text || "").join("\n");
      }
    }

    return undefined;
  }
}
