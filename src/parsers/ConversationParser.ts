/**
 * Multi-pass JSONL Conversation Parser for Claude Code history.
 *
 * This parser reads conversation history from Claude Code's storage locations
 * (~/.claude/projects) and extracts structured data including messages, tool uses,
 * file edits, and thinking blocks.
 *
 * The parser handles two directory structures:
 * - Modern: ~/.claude/projects/{sanitized-path}
 * - Legacy: ~/.claude/projects/{original-project-name}
 *
 * It performs a multi-pass parsing approach:
 * 1. First pass: Extract conversations and messages
 * 2. Second pass: Link tool uses and results
 * 3. Third pass: Extract file edits from snapshots
 * 4. Fourth pass: Extract thinking blocks
 *
 * @example
 * ```typescript
 * const parser = new ConversationParser();
 * const result = parser.parseProject('/path/to/project');
 * console.error(`Parsed ${result.conversations.length} conversations`);
 * console.error(`Found ${result.messages.length} messages`);
 * console.error(`Extracted ${result.tool_uses.length} tool uses`);
 * ```
 */

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
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
  source_type?: 'claude-code' | 'codex';
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

/**
 * Result of parsing conversation history.
 *
 * Contains all extracted entities from conversation files.
 */
export interface ParseResult {
  /** Parsed conversations with metadata */
  conversations: Conversation[];
  /** All messages from conversations */
  messages: Message[];
  /** Tool invocations extracted from assistant messages */
  tool_uses: ToolUse[];
  /** Results from tool executions */
  tool_results: ToolResult[];
  /** File edit records from snapshots */
  file_edits: FileEdit[];
  /** Thinking blocks (Claude's internal reasoning) */
  thinking_blocks: ThinkingBlock[];
  /** Folders that were actually indexed */
  indexed_folders?: string[];
}

/**
 * Parser for Claude Code conversation history.
 *
 * Extracts structured data from JSONL conversation files stored in
 * ~/.claude/projects. Handles both modern and legacy naming conventions.
 */
export class ConversationParser {
  /**
   * Parse all conversations for a project.
   *
   * Searches for conversation files in Claude's storage directories and
   * parses them into structured entities. Supports filtering by session ID
   * and handles both modern and legacy directory naming conventions.
   *
   * @param projectPath - Absolute path to the project
   * @param sessionId - Optional session ID to filter for a single conversation
   * @returns ParseResult containing all extracted entities
   *
   * @example
   * ```typescript
   * const parser = new ConversationParser();
   *
   * // Parse all conversations
   * const allResults = parser.parseProject('/Users/me/my-project');
   *
   * // Parse specific session
   * const sessionResults = parser.parseProject('/Users/me/my-project', 'session-123');
   * ```
   */
  parseProject(projectPath: string, sessionId?: string): ParseResult {
    console.error(`Parsing conversations for project: ${projectPath}`);
    if (sessionId) {
      console.error(`Filtering for session: ${sessionId}`);
    }

    // Convert project path to Claude projects directory name
    const projectDirName = pathToProjectFolderName(projectPath);
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const projectsBaseDir = join(homeDir, ".claude", "projects");

    // Generate path variants to handle Claude Code's potential encoding differences
    // Claude Code may encode hyphens as underscores or vice versa in path components
    const pathVariants = this.generatePathVariants(projectDirName);

    // Collect directories that exist
    const dirsToCheck: string[] = [];
    const checkedPaths: string[] = [];

    for (const variant of pathVariants) {
      const variantDir = join(projectsBaseDir, variant);
      checkedPaths.push(variantDir);

      if (existsSync(variantDir)) {
        // Check if this directory has any .jsonl files
        try {
          const files = readdirSync(variantDir).filter(f => f.endsWith(".jsonl"));
          if (files.length > 0 && !dirsToCheck.includes(variantDir)) {
            dirsToCheck.push(variantDir);
            console.error(`Found conversation directory: ${variant}`);
          }
        } catch (_e) {
          // Directory exists but can't be read, skip it
        }
      }
    }

    if (dirsToCheck.length === 0) {
      console.error(`⚠️ No conversation directories found`);
      console.error(`  Checked ${checkedPaths.length} path variants:`);
      for (const path of checkedPaths.slice(0, 5)) {
        console.error(`    - ${path}`);
      }
      if (checkedPaths.length > 5) {
        console.error(`    ... and ${checkedPaths.length - 5} more`);
      }
      return {
        conversations: [],
        messages: [],
        tool_uses: [],
        tool_results: [],
        file_edits: [],
        thinking_blocks: [],
        indexed_folders: [],
      };
    }

    console.error(`Looking in ${dirsToCheck.length} director(ies): ${dirsToCheck.join(", ")}`);

    // Collect all .jsonl files from all directories
    const fileMap = new Map<string, string>(); // filename -> full path

    for (const dir of dirsToCheck) {
      const dirFiles = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      for (const file of dirFiles) {
        const fullPath = join(dir, file);
        // If file already exists in map, keep the one from the first directory (modern takes precedence)
        if (!fileMap.has(file)) {
          fileMap.set(file, fullPath);
        }
      }
    }

    let files = Array.from(fileMap.keys());

    // If session_id provided, filter to only that session file
    if (sessionId) {
      files = files.filter((f) => f === `${sessionId}.jsonl`);
      if (files.length === 0) {
        console.error(`⚠️ Session file not found: ${sessionId}.jsonl`);
        console.error(`Available sessions: ${Array.from(fileMap.keys()).join(", ")}`);
      }
    }

    console.error(`Found ${files.length} conversation file(s) to parse`);

    // Parse each file
    const result: ParseResult = {
      conversations: [],
      messages: [],
      tool_uses: [],
      tool_results: [],
      file_edits: [],
      thinking_blocks: [],
      indexed_folders: dirsToCheck,
    };

    for (const file of files) {
      const filePath = fileMap.get(file);
      if (filePath) {
        this.parseFile(filePath, result, projectPath);
      }
    }

    console.error(
      `Parsed ${result.conversations.length} conversations, ${result.messages.length} messages`
    );

    return result;
  }

  /**
   * Parse conversations directly from a Claude projects folder.
   *
   * This method is used when you already have the path to the conversation
   * folder (e.g., ~/.claude/projects/-Users-me-my-project) rather than
   * a project path that needs to be converted.
   *
   * @param folderPath - Absolute path to the Claude projects folder
   * @param projectIdentifier - Optional identifier to use as project_path in records (defaults to folder path)
   * @returns ParseResult containing all extracted entities
   *
   * @example
   * ```typescript
   * const parser = new ConversationParser();
   * const result = parser.parseFromFolder('~/.claude/projects/-Users-me-my-project');
   * ```
   */
  parseFromFolder(
    folderPath: string,
    projectIdentifier?: string,
    lastIndexedMs?: number
  ): ParseResult {
    const result: ParseResult = {
      conversations: [],
      messages: [],
      tool_uses: [],
      tool_results: [],
      file_edits: [],
      thinking_blocks: [],
      indexed_folders: [folderPath],
    };

    // Use folder path as project identifier if not provided
    const projectPath = projectIdentifier || folderPath;

    if (!existsSync(folderPath)) {
      console.error(`⚠️ Folder does not exist: ${folderPath}`);
      return result;
    }

    // Get all .jsonl files in the folder
    const files = readdirSync(folderPath).filter((f) => f.endsWith(".jsonl"));
    console.error(`Found ${files.length} conversation file(s) in ${folderPath}`);

    // Parse each file, optionally skipping unchanged files in incremental mode
    let skippedCount = 0;
    for (const file of files) {
      const filePath = join(folderPath, file);

      // Skip unchanged files in incremental mode
      if (lastIndexedMs) {
        try {
          const stats = statSync(filePath);
          if (stats.mtimeMs < lastIndexedMs) {
            skippedCount++;
            continue;
          }
        } catch (_e) {
          // If we can't stat the file, try to parse it anyway
        }
      }

      this.parseFile(filePath, result, projectPath);
    }

    if (skippedCount > 0) {
      console.error(`⏭ Skipped ${skippedCount} unchanged file(s)`);
    }
    console.error(
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
   * Generate path variants to handle potential encoding differences.
   *
   * Claude Code may encode paths differently than expected:
   * - Hyphens in path components might become underscores
   * - Underscores might become hyphens
   * - Dots might become hyphens (legacy)
   *
   * This method generates multiple variants to try when searching for directories.
   *
   * @example
   * Input: "-Users-myid-GIT-projects-myProject"
   * Output: [
   *   "-Users-myid-GIT-projects-myProject",     // Original
   *   "-Users-myid-GIT_projects-myProject",     // Hyphens in components -> underscores
   *   "-Users-myid-GIT-projects-myProject",     // Dots -> hyphens (legacy)
   * ]
   */
  private generatePathVariants(projectDirName: string): string[] {
    const variants = new Set<string>();

    // 1. Original encoding (as computed by pathToProjectFolderName)
    variants.add(projectDirName);

    // 2. Legacy: dots replaced with hyphens
    const legacyVariant = projectDirName.replace(/\./g, '-');
    variants.add(legacyVariant);

    // 3. Try swapping hyphens and underscores within path components
    // Path format: "-Component1-Component2-Component3" or "Drive-Component1-Component2"
    // We need to be careful not to change the leading hyphen or the separating hyphens

    // Split into components by hyphen (the first element might be empty for Unix paths starting with -)
    const parts = projectDirName.split('-');

    // Try converting internal hyphens within multi-hyphen component names to underscores
    // This handles cases like "GIT-projects" becoming "GIT_projects"

    // Strategy: For each part that looks like it might have been originally hyphenated,
    // create a variant with underscores
    const hyphenToUnderscoreVariant = parts
      .map((part) => {
        // Skip empty parts and single chars (likely path separators)
        if (part.length === 0) {
          return part;
        }

        // Convert any underscores in parts to hyphens (in case source had underscores)
        return part.replace(/_/g, '-');
      })
      .join('-');

    const underscoreToHyphenVariant = parts
      .map((part) => {
        if (part.length === 0) {
          return part;
        }
        // Convert any hyphens that might be internal to underscores
        // This is tricky because hyphens are also used as separators
        return part;
      })
      .join('-');

    variants.add(hyphenToUnderscoreVariant);
    variants.add(underscoreToHyphenVariant);

    // 4. Try a variant where we replace all underscores with hyphens
    const allUnderscoresToHyphens = projectDirName.replace(/_/g, '-');
    variants.add(allUnderscoresToHyphens);

    // 5. Try a variant where path components with hyphens have them as underscores
    // e.g., "GIT-projects" -> "GIT_projects"
    // We need to identify which consecutive hyphens are part of component names vs separators
    // A simple heuristic: look for patterns like "X-Y" where X and Y are both alphanumeric
    const internalHyphensToUnderscores = projectDirName.replace(
      /([a-zA-Z0-9])[-]([a-zA-Z0-9])/g,
      '$1_$2'
    );
    variants.add(internalHyphensToUnderscores);

    // 6. Also try the reverse: convert underscores to hyphens
    const internalUnderscoresToHyphens = projectDirName.replace(
      /([a-zA-Z0-9])[_]([a-zA-Z0-9])/g,
      '$1-$2'
    );
    variants.add(internalUnderscoresToHyphens);

    // Apply the same transformations to the legacy variant
    const legacyInternalHyphensToUnderscores = legacyVariant.replace(
      /([a-zA-Z0-9])[-]([a-zA-Z0-9])/g,
      '$1_$2'
    );
    variants.add(legacyInternalHyphensToUnderscores);

    return Array.from(variants);
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
