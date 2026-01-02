/**
 * Working Memory Store
 *
 * A key-value store for facts, decisions, and context that persists
 * across conversation boundaries. Enables Claude to "remember" things
 * explicitly and retrieve them later.
 */

import { nanoid } from "nanoid";
import type { Database } from "better-sqlite3";
import type {
  WorkingMemoryItem,
  WorkingMemoryRow,
  RememberOptions,
  RecallOptions,
  SemanticRecallOptions,
  SemanticRecallResult,
} from "./types.js";

export class WorkingMemoryStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Store a fact/decision/context in working memory
   */
  remember(options: RememberOptions): WorkingMemoryItem {
    const now = Date.now();
    const id = nanoid();
    const expiresAt = options.ttl ? now + options.ttl * 1000 : null;

    // Check if key already exists for this project
    const existing = this.db
      .prepare(
        "SELECT id FROM working_memory WHERE project_path = ? AND key = ?"
      )
      .get(options.projectPath, options.key) as { id: string } | undefined;

    if (existing) {
      // Update existing
      this.db
        .prepare(
          `UPDATE working_memory
           SET value = ?, context = ?, tags = ?, session_id = ?, updated_at = ?, expires_at = ?
           WHERE id = ?`
        )
        .run(
          options.value,
          options.context || null,
          options.tags ? JSON.stringify(options.tags) : null,
          options.sessionId || null,
          now,
          expiresAt,
          existing.id
        );

      // Update FTS
      this.updateFts(existing.id, options.key, options.value, options.context);

      return this.getById(existing.id) as WorkingMemoryItem;
    }

    // Insert new
    this.db
      .prepare(
        `INSERT INTO working_memory
         (id, key, value, context, tags, session_id, project_path, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        options.key,
        options.value,
        options.context || null,
        options.tags ? JSON.stringify(options.tags) : null,
        options.sessionId || null,
        options.projectPath,
        now,
        now,
        expiresAt
      );

    // Insert into FTS
    this.insertFts(id, options.key, options.value, options.context);

    return {
      id,
      key: options.key,
      value: options.value,
      context: options.context,
      tags: options.tags || [],
      sessionId: options.sessionId,
      projectPath: options.projectPath,
      createdAt: now,
      updatedAt: now,
      expiresAt: expiresAt || undefined,
    };
  }

  /**
   * Recall a specific item by key
   */
  recall(key: string, projectPath: string): WorkingMemoryItem | null {
    // First, clean up expired items
    this.cleanupExpired();

    const row = this.db
      .prepare(
        `SELECT * FROM working_memory
         WHERE project_path = ? AND key = ?
         AND (expires_at IS NULL OR expires_at > ?)`
      )
      .get(projectPath, key, Date.now()) as WorkingMemoryRow | undefined;

    if (!row) {
      return null;
    }

    return this.rowToItem(row);
  }

  /**
   * Recall items matching options
   */
  recallMany(options: RecallOptions): WorkingMemoryItem[] {
    // First, clean up expired items
    if (!options.includeExpired) {
      this.cleanupExpired();
    }

    let sql = "SELECT * FROM working_memory WHERE 1=1";
    const params: (string | number)[] = [];

    if (options.projectPath) {
      sql += " AND project_path = ?";
      params.push(options.projectPath);
    }

    if (options.key) {
      sql += " AND key = ?";
      params.push(options.key);
    }

    if (options.sessionId) {
      sql += " AND session_id = ?";
      params.push(options.sessionId);
    }

    if (!options.includeExpired) {
      sql += " AND (expires_at IS NULL OR expires_at > ?)";
      params.push(Date.now());
    }

    sql += " ORDER BY updated_at DESC";

    const rows = this.db.prepare(sql).all(...params) as WorkingMemoryRow[];

    // Filter by tags in JavaScript (JSON array in SQLite)
    let items = rows.map((row) => this.rowToItem(row));

    const filterTags = options.tags;
    if (filterTags && filterTags.length > 0) {
      items = items.filter((item) =>
        filterTags.some((tag) => item.tags.includes(tag))
      );
    }

    return items;
  }

  /**
   * Semantic search across working memory using FTS
   */
  recallRelevant(options: SemanticRecallOptions): SemanticRecallResult[] {
    // First, clean up expired items
    this.cleanupExpired();

    const limit = options.limit || 10;

    // Use FTS5 for text search
    const ftsResults = this.db
      .prepare(
        `SELECT wm.*,
                bm25(working_memory_fts) as rank
         FROM working_memory_fts fts
         JOIN working_memory wm ON wm.id = fts.id
         WHERE working_memory_fts MATCH ?
         AND wm.project_path = ?
         AND (wm.expires_at IS NULL OR wm.expires_at > ?)
         ORDER BY rank
         LIMIT ?`
      )
      .all(
        this.escapeFtsQuery(options.query),
        options.projectPath,
        Date.now(),
        limit
      ) as Array<WorkingMemoryRow & { rank: number }>;

    return ftsResults.map((row) => ({
      ...this.rowToItem(row),
      similarity: this.normalizeRank(row.rank),
    }));
  }

  /**
   * Forget (delete) a memory item by key
   */
  forget(key: string, projectPath: string): boolean {
    const item = this.recall(key, projectPath);
    if (!item) {
      return false;
    }

    // Delete from FTS first
    this.deleteFts(item.id);

    // Delete from main table
    const result = this.db
      .prepare("DELETE FROM working_memory WHERE project_path = ? AND key = ?")
      .run(projectPath, key);

    return result.changes > 0;
  }

  /**
   * Forget all items for a project
   */
  forgetAll(projectPath: string): number {
    // Get all IDs first for FTS cleanup
    const items = this.db
      .prepare("SELECT id FROM working_memory WHERE project_path = ?")
      .all(projectPath) as Array<{ id: string }>;

    for (const item of items) {
      this.deleteFts(item.id);
    }

    const result = this.db
      .prepare("DELETE FROM working_memory WHERE project_path = ?")
      .run(projectPath);

    return result.changes;
  }

  /**
   * List all memory items for a project
   */
  list(
    projectPath: string,
    options?: { tags?: string[]; limit?: number; offset?: number }
  ): WorkingMemoryItem[] {
    // First, clean up expired items
    this.cleanupExpired();

    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM working_memory
         WHERE project_path = ?
         AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(projectPath, Date.now(), limit, offset) as WorkingMemoryRow[];

    let items = rows.map((row) => this.rowToItem(row));

    // Filter by tags if specified
    const listTags = options?.tags;
    if (listTags && listTags.length > 0) {
      items = items.filter((item) =>
        listTags.some((tag) => item.tags.includes(tag))
      );
    }

    return items;
  }

  /**
   * Get count of items for a project
   */
  count(projectPath: string): number {
    const result = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM working_memory
         WHERE project_path = ?
         AND (expires_at IS NULL OR expires_at > ?)`
      )
      .get(projectPath, Date.now()) as { count: number };

    return result.count;
  }

  /**
   * Get a single item by ID
   */
  private getById(id: string): WorkingMemoryItem | null {
    const row = this.db
      .prepare("SELECT * FROM working_memory WHERE id = ?")
      .get(id) as WorkingMemoryRow | undefined;

    if (!row) {
      return null;
    }

    return this.rowToItem(row);
  }

  /**
   * Convert database row to WorkingMemoryItem
   */
  private rowToItem(row: WorkingMemoryRow): WorkingMemoryItem {
    return {
      id: row.id,
      key: row.key,
      value: row.value,
      context: row.context || undefined,
      tags: row.tags ? JSON.parse(row.tags) : [],
      sessionId: row.session_id || undefined,
      projectPath: row.project_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at || undefined,
    };
  }

  /**
   * Clean up expired items
   */
  private cleanupExpired(): void {
    const now = Date.now();

    // Get expired IDs for FTS cleanup
    const expired = this.db
      .prepare(
        "SELECT id FROM working_memory WHERE expires_at IS NOT NULL AND expires_at <= ?"
      )
      .all(now) as Array<{ id: string }>;

    for (const item of expired) {
      this.deleteFts(item.id);
    }

    // Delete expired items
    this.db
      .prepare(
        "DELETE FROM working_memory WHERE expires_at IS NOT NULL AND expires_at <= ?"
      )
      .run(now);
  }

  /**
   * Insert into FTS index
   */
  private insertFts(
    id: string,
    key: string,
    value: string,
    context?: string
  ): void {
    try {
      this.db
        .prepare(
          `INSERT INTO working_memory_fts(id, key, value, context)
           VALUES (?, ?, ?, ?)`
        )
        .run(id, key, value, context || "");
    } catch (_error) {
      // FTS insert can fail if table doesn't exist yet
      // Silently ignore - search will fall back to non-FTS
    }
  }

  /**
   * Update FTS index
   */
  private updateFts(
    id: string,
    key: string,
    value: string,
    context?: string
  ): void {
    try {
      // Delete old entry
      this.deleteFts(id);
      // Insert new entry
      this.insertFts(id, key, value, context);
    } catch (_error) {
      // Silently ignore FTS errors
    }
  }

  /**
   * Delete from FTS index
   */
  private deleteFts(id: string): void {
    try {
      this.db
        .prepare("DELETE FROM working_memory_fts WHERE id = ?")
        .run(id);
    } catch (_error) {
      // Silently ignore FTS errors
    }
  }

  /**
   * Escape FTS query for safe matching
   */
  private escapeFtsQuery(query: string): string {
    // Escape special FTS5 characters and wrap in quotes for phrase matching
    // Also handle simple word queries
    const words = query
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .map((word) => {
        // Remove special characters that could break FTS
        const cleaned = word.replace(/['"(){}[\]:*^~\\-]/g, "");
        return cleaned;
      })
      .filter((w) => w.length > 0);

    if (words.length === 0) {
      return '""';
    }

    // Join with OR for broad matching
    return words.map((w) => `"${w}"`).join(" OR ");
  }

  /**
   * Normalize BM25 rank to a similarity score (0-1)
   * BM25 returns negative scores, lower is better
   */
  private normalizeRank(rank: number): number {
    // Convert negative BM25 score to positive similarity
    // Typical BM25 scores range from -50 to 0
    return Math.max(0, Math.min(1, 1 + rank / 50));
  }
}
