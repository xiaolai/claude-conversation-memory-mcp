/**
 * BackupManager - Create and manage backups before deletion operations
 * Exports affected data to JSON for potential restoration
 */

import { writeFileSync, mkdirSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type Database from "better-sqlite3";
import { pathToProjectFolderName } from "../utils/sanitization.js";

/**
 * Backup metadata
 */
export interface BackupMetadata {
  timestamp: number;
  description: string;
  projectPath: string;
  tables: string[];
  recordCounts: Record<string, number>;
  backupPath: string;
}

/**
 * Backup data structure
 */
export interface BackupData {
  metadata: BackupMetadata;
  data: Record<string, unknown[]>;
}

/**
 * BackupManager class
 */
export class BackupManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Create a backup of specific conversations and related data
   */
  createBackupForConversations(
    conversationIds: string[],
    description: string,
    projectPath: string
  ): BackupMetadata {
    if (conversationIds.length === 0) {
      throw new Error("No conversations to backup");
    }

    // Prepare backup directory
    const backupDir = this.getBackupDirectory(projectPath);
    this.ensureDirectoryExists(backupDir);

    // Generate backup filename
    const timestamp = Date.now();
    const backupFilename = `backup-${timestamp}.json`;
    const backupPath = join(backupDir, backupFilename);

    // Collect data from all related tables
    const backupData: Record<string, unknown[]> = {};
    const recordCounts: Record<string, number> = {};

    // Conversations
    const conversations = this.getConversations(conversationIds);
    backupData.conversations = conversations;
    recordCounts.conversations = conversations.length;

    // Messages
    const messages = this.getMessages(conversationIds);
    backupData.messages = messages;
    recordCounts.messages = messages.length;

    // Get message IDs for related data
    const messageIds = messages.map((m) => (m as Record<string, unknown>).id as string);

    // Tool uses
    const toolUses = this.getToolUses(messageIds);
    backupData.tool_uses = toolUses;
    recordCounts.tool_uses = toolUses.length;

    // Tool results
    const toolResults = this.getToolResults(messageIds);
    backupData.tool_results = toolResults;
    recordCounts.tool_results = toolResults.length;

    // File edits
    const fileEdits = this.getFileEdits(conversationIds);
    backupData.file_edits = fileEdits;
    recordCounts.file_edits = fileEdits.length;

    // Thinking blocks
    const thinkingBlocks = this.getThinkingBlocks(messageIds);
    backupData.thinking_blocks = thinkingBlocks;
    recordCounts.thinking_blocks = thinkingBlocks.length;

    // Decisions
    const decisions = this.getDecisions(conversationIds);
    backupData.decisions = decisions;
    recordCounts.decisions = decisions.length;

    // Mistakes
    const mistakes = this.getMistakes(conversationIds);
    backupData.mistakes = mistakes;
    recordCounts.mistakes = mistakes.length;

    // Requirements
    const requirements = this.getRequirements(conversationIds);
    backupData.requirements = requirements;
    recordCounts.requirements = requirements.length;

    // Validations
    const validations = this.getValidations(conversationIds);
    backupData.validations = validations;
    recordCounts.validations = validations.length;

    // Embeddings
    const messageEmbeddings = this.getMessageEmbeddings(messageIds);
    backupData.message_embeddings = messageEmbeddings;
    recordCounts.message_embeddings = messageEmbeddings.length;

    const decisionIds = decisions.map((d) => (d as Record<string, unknown>).id as string);
    const decisionEmbeddings = this.getDecisionEmbeddings(decisionIds);
    backupData.decision_embeddings = decisionEmbeddings;
    recordCounts.decision_embeddings = decisionEmbeddings.length;

    // Create metadata
    const metadata: BackupMetadata = {
      timestamp,
      description,
      projectPath,
      tables: Object.keys(backupData),
      recordCounts,
      backupPath,
    };

    // Write backup file
    const fullBackup: BackupData = {
      metadata,
      data: backupData,
    };

    writeFileSync(backupPath, JSON.stringify(fullBackup, null, 2), "utf-8");

    // Set restrictive permissions (owner read/write only) to protect sensitive data
    // 0o600 = rw------- (only owner can read/write)
    try {
      chmodSync(backupPath, 0o600);
    } catch (_error) {
      // chmod may fail on some platforms (e.g., Windows), continue anyway
    }

    console.error(`✓ Backup created: ${backupPath}`);
    console.error(`  ${recordCounts.conversations} conversations`);
    console.error(`  ${recordCounts.messages} messages`);
    console.error(`  ${recordCounts.decisions} decisions`);
    console.error(`  ${recordCounts.mistakes} mistakes`);

    return metadata;
  }

  /**
   * Get backup directory for project
   */
  private getBackupDirectory(projectPath: string): string {
    const projectFolderName = pathToProjectFolderName(projectPath);
    return join(homedir(), ".claude", "backups", projectFolderName);
  }

  /**
   * Ensure directory exists
   */
  private ensureDirectoryExists(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Query helpers for each table
   */
  private getConversations(conversationIds: string[]): unknown[] {
    const placeholders = conversationIds.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM conversations WHERE id IN (${placeholders})`)
      .all(...conversationIds);
  }

  private getMessages(conversationIds: string[]): unknown[] {
    const placeholders = conversationIds.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM messages WHERE conversation_id IN (${placeholders})`)
      .all(...conversationIds);
  }

  private getToolUses(messageIds: string[]): unknown[] {
    if (messageIds.length === 0) {
      return [];
    }
    const placeholders = messageIds.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM tool_uses WHERE message_id IN (${placeholders})`)
      .all(...messageIds);
  }

  private getToolResults(messageIds: string[]): unknown[] {
    if (messageIds.length === 0) {
      return [];
    }
    const placeholders = messageIds.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM tool_results WHERE message_id IN (${placeholders})`)
      .all(...messageIds);
  }

  private getFileEdits(conversationIds: string[]): unknown[] {
    const placeholders = conversationIds.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM file_edits WHERE conversation_id IN (${placeholders})`)
      .all(...conversationIds);
  }

  private getThinkingBlocks(messageIds: string[]): unknown[] {
    if (messageIds.length === 0) {
      return [];
    }
    const placeholders = messageIds.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM thinking_blocks WHERE message_id IN (${placeholders})`)
      .all(...messageIds);
  }

  private getDecisions(conversationIds: string[]): unknown[] {
    const placeholders = conversationIds.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM decisions WHERE conversation_id IN (${placeholders})`)
      .all(...conversationIds);
  }

  private getMistakes(conversationIds: string[]): unknown[] {
    const placeholders = conversationIds.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM mistakes WHERE conversation_id IN (${placeholders})`)
      .all(...conversationIds);
  }

  private getRequirements(conversationIds: string[]): unknown[] {
    const placeholders = conversationIds.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM requirements WHERE conversation_id IN (${placeholders})`)
      .all(...conversationIds);
  }

  private getValidations(conversationIds: string[]): unknown[] {
    const placeholders = conversationIds.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM validations WHERE conversation_id IN (${placeholders})`)
      .all(...conversationIds);
  }

  private getMessageEmbeddings(messageIds: string[]): unknown[] {
    if (messageIds.length === 0) {
      return [];
    }
    const placeholders = messageIds.map(() => "?").join(",");
    // Note: Only metadata is exported, not the actual embedding BLOBs (too large for JSON)
    return this.db
      .prepare(`SELECT id, message_id, model_name, dimensions, created_at FROM message_embeddings WHERE message_id IN (${placeholders})`)
      .all(...messageIds);
  }

  private getDecisionEmbeddings(decisionIds: string[]): unknown[] {
    if (decisionIds.length === 0) {
      return [];
    }
    const placeholders = decisionIds.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT id, decision_id, model_name, dimensions, created_at FROM decision_embeddings WHERE decision_id IN (${placeholders})`)
      .all(...decisionIds);
  }
}
