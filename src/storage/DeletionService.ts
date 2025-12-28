/**
 * DeletionService - Handle selective deletion of conversations by topic/keyword
 * Uses semantic + FTS5 search to find matching conversations
 */

import type Database from "better-sqlite3";
import { BackupManager, type BackupMetadata } from "./BackupManager.js";
import type { ConversationStorage } from "./ConversationStorage.js";
import type { SemanticSearch } from "../search/SemanticSearch.js";

/**
 * Deletion preview - shows what would be deleted
 */
export interface DeletionPreview {
  conversationIds: string[];
  conversations: Array<{
    id: string;
    session_id: string;
    created_at: number;
    message_count: number;
  }>;
  totalMessages: number;
  totalDecisions: number;
  totalMistakes: number;
  summary: string;
}

/**
 * Deletion result - what was actually deleted
 */
export interface DeletionResult {
  backup: BackupMetadata;
  deleted: {
    conversations: number;
    messages: number;
    decisions: number;
    mistakes: number;
    toolUses: number;
    fileEdits: number;
  };
  summary: string;
}

/**
 * DeletionService class
 */
export class DeletionService {
  private db: Database.Database;
  private backupManager: BackupManager;
  private storage: ConversationStorage;
  private semanticSearch: SemanticSearch | null;

  constructor(
    db: Database.Database,
    storage: ConversationStorage,
    semanticSearch: SemanticSearch | null = null
  ) {
    this.db = db;
    this.backupManager = new BackupManager(db);
    this.storage = storage;
    this.semanticSearch = semanticSearch;
  }

  /**
   * Preview what would be deleted for given keywords/topics
   */
  async previewDeletionByTopic(
    keywords: string[],
    projectPath: string
  ): Promise<DeletionPreview> {
    // Find matching conversations using search
    const conversationIds = await this.findConversationsByTopic(keywords, projectPath);

    if (conversationIds.length === 0) {
      return {
        conversationIds: [],
        conversations: [],
        totalMessages: 0,
        totalDecisions: 0,
        totalMistakes: 0,
        summary: `No conversations found matching: ${keywords.join(", ")}`,
      };
    }

    // Get conversation details
    const placeholders = conversationIds.map(() => "?").join(",");
    const conversations = this.db
      .prepare(
        `SELECT id, session_id, created_at, message_count
         FROM conversations
         WHERE id IN (${placeholders})
         ORDER BY created_at DESC`
      )
      .all(...conversationIds) as Array<{
      id: string;
      session_id: string;
      created_at: number;
      message_count: number;
    }>;

    // Count related records
    const totalMessages = this.countMessages(conversationIds);
    const totalDecisions = this.countDecisions(conversationIds);
    const totalMistakes = this.countMistakes(conversationIds);

    const summary = `Found ${conversations.length} conversation${conversations.length !== 1 ? "s" : ""} (${totalMessages} messages, ${totalDecisions} decisions, ${totalMistakes} mistakes) matching: ${keywords.join(", ")}`;

    return {
      conversationIds,
      conversations,
      totalMessages,
      totalDecisions,
      totalMistakes,
      summary,
    };
  }

  /**
   * Delete conversations by topic/keywords with automatic backup
   */
  async forgetByTopic(
    keywords: string[],
    projectPath: string
  ): Promise<DeletionResult> {
    // First, preview what we're going to delete
    const preview = await this.previewDeletionByTopic(keywords, projectPath);

    if (preview.conversationIds.length === 0) {
      throw new Error(`No conversations found matching: ${keywords.join(", ")}`);
    }

    // Create backup before deletion
    const description = `Forget conversations about: ${keywords.join(", ")}`;
    const backup = this.backupManager.createBackupForConversations(
      preview.conversationIds,
      description,
      projectPath
    );

    // Count records before deletion for reporting
    const beforeCounts = {
      conversations: preview.conversationIds.length,
      messages: preview.totalMessages,
      decisions: preview.totalDecisions,
      mistakes: preview.totalMistakes,
      toolUses: this.countToolUses(preview.conversationIds),
      fileEdits: this.countFileEdits(preview.conversationIds),
    };

    // Perform deletion (CASCADE will handle related records)
    const placeholders = preview.conversationIds.map(() => "?").join(",");

    // Use transaction for atomic deletion
    this.db.transaction(() => {
      // Delete FTS entries first (no CASCADE)
      this.db
        .prepare(
          `DELETE FROM messages_fts
           WHERE rowid IN (
             SELECT rowid FROM messages
             WHERE conversation_id IN (${placeholders})
           )`
        )
        .run(...preview.conversationIds);

      this.db
        .prepare(
          `DELETE FROM decisions_fts
           WHERE rowid IN (
             SELECT rowid FROM decisions
             WHERE conversation_id IN (${placeholders})
           )`
        )
        .run(...preview.conversationIds);

      // Delete conversations (CASCADE handles the rest)
      this.db
        .prepare(`DELETE FROM conversations WHERE id IN (${placeholders})`)
        .run(...preview.conversationIds);
    })();

    // Clear cache since data was deleted
    this.storage.clearCache();

    const summary = `✓ Deleted ${beforeCounts.conversations} conversations (${beforeCounts.messages} messages, ${beforeCounts.decisions} decisions, ${beforeCounts.mistakes} mistakes)\n✓ Backup saved: ${backup.backupPath}`;

    return {
      backup,
      deleted: beforeCounts,
      summary,
    };
  }

  /**
   * Find conversations matching keywords/topics using search
   */
  private async findConversationsByTopic(
    keywords: string[],
    projectPath: string
  ): Promise<string[]> {
    const conversationIds = new Set<string>();

    // Build search query from keywords
    const searchQuery = keywords.join(" ");

    // Try semantic search if available
    if (this.semanticSearch) {
      try {
        const results = await this.semanticSearch.searchConversations(
          searchQuery,
          100 // Cast wide net
        );

        // Filter by project path
        for (const result of results) {
          if (result.conversation.project_path === projectPath) {
            conversationIds.add(result.conversation.id);
          }
        }
      } catch (error) {
        console.error("Semantic search failed, falling back to FTS:", (error as Error).message);
      }
    }

    // Also try FTS5 search for exact matches
    try {
      const ftsQuery = keywords.map((k) => `"${k}"`).join(" OR ");
      const messages = this.db
        .prepare(
          `SELECT DISTINCT m.conversation_id
           FROM messages_fts mf
           JOIN messages m ON m.rowid = mf.rowid
           WHERE messages_fts MATCH ?
           AND m.project_path = ?
           LIMIT 100`
        )
        .all(ftsQuery, projectPath) as Array<{ conversation_id: string }>;

      for (const msg of messages) {
        conversationIds.add(msg.conversation_id);
      }
    } catch (error) {
      console.error("FTS search failed:", (error as Error).message);
    }

    return Array.from(conversationIds);
  }

  /**
   * Count helpers
   */
  private countMessages(conversationIds: string[]): number {
    const placeholders = conversationIds.map(() => "?").join(",");
    const result = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM messages WHERE conversation_id IN (${placeholders})`
      )
      .get(...conversationIds) as { count: number };
    return result.count;
  }

  private countDecisions(conversationIds: string[]): number {
    const placeholders = conversationIds.map(() => "?").join(",");
    const result = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM decisions WHERE conversation_id IN (${placeholders})`
      )
      .get(...conversationIds) as { count: number };
    return result.count;
  }

  private countMistakes(conversationIds: string[]): number {
    const placeholders = conversationIds.map(() => "?").join(",");
    const result = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM mistakes WHERE conversation_id IN (${placeholders})`
      )
      .get(...conversationIds) as { count: number };
    return result.count;
  }

  private countToolUses(conversationIds: string[]): number {
    const placeholders = conversationIds.map(() => "?").join(",");
    const result = this.db
      .prepare(
        `SELECT COUNT(*) as count
         FROM tool_uses
         WHERE message_id IN (
           SELECT id FROM messages WHERE conversation_id IN (${placeholders})
         )`
      )
      .get(...conversationIds) as { count: number };
    return result.count;
  }

  private countFileEdits(conversationIds: string[]): number {
    const placeholders = conversationIds.map(() => "?").join(",");
    const result = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM file_edits WHERE conversation_id IN (${placeholders})`
      )
      .get(...conversationIds) as { count: number };
    return result.count;
  }
}
