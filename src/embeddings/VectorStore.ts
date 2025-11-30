/**
 * Vector Store with sqlite-vec integration
 * Dual-schema support (vector extension or BLOB fallback)
 */

import type { SQLiteManager } from "../storage/SQLiteManager.js";
import Database from "better-sqlite3";

export interface VectorSearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export class VectorStore {
  private db: Database.Database;
  private sqliteManager: SQLiteManager;
  private hasVecExtension: boolean = false;
  private vecTablesInitialized: boolean = false;

  constructor(sqliteManager: SQLiteManager) {
    this.db = sqliteManager.getDatabase();
    this.sqliteManager = sqliteManager;
    this.detectVecExtension();
  }

  /**
   * Detect if sqlite-vec extension is available
   */
  private detectVecExtension(): void {
    try {
      // Try to create a test virtual table
      this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS vec_test USING vec0(test float[1])");
      this.db.exec("DROP TABLE vec_test");
      this.hasVecExtension = true;
      console.log("✓ sqlite-vec extension detected");
    } catch (_error) {
      this.hasVecExtension = false;
      console.log("⚠ sqlite-vec not available, using BLOB fallback");
    }
  }

  /**
   * Check if vec extension is enabled
   */
  isVecEnabled(): boolean {
    return this.hasVecExtension;
  }

  /**
   * Get set of message IDs that already have embeddings
   */
  getExistingMessageEmbeddingIds(): Set<string> {
    const ids = new Set<string>();
    try {
      const rows = this.db
        .prepare("SELECT message_id FROM message_embeddings")
        .all() as Array<{ message_id: string }>;
      for (const row of rows) {
        ids.add(row.message_id);
      }
    } catch (_e) {
      // Table might not exist yet
    }
    return ids;
  }

  /**
   * Get set of decision IDs that already have embeddings
   */
  getExistingDecisionEmbeddingIds(): Set<string> {
    const ids = new Set<string>();
    try {
      const rows = this.db
        .prepare("SELECT decision_id FROM decision_embeddings")
        .all() as Array<{ decision_id: string }>;
      for (const row of rows) {
        ids.add(row.decision_id);
      }
    } catch (_e) {
      // Table might not exist yet
    }
    return ids;
  }

  /**
   * Ensure vec tables exist with correct dimensions
   */
  private ensureVecTables(dimensions: number): void {
    if (!this.hasVecExtension || this.vecTablesInitialized) {
      return;
    }

    this.sqliteManager.createVecTablesWithDimensions(dimensions);
    this.vecTablesInitialized = true;
  }

  /**
   * Store an embedding for a message
   */
  async storeMessageEmbedding(
    messageId: string,
    content: string,
    embedding: Float32Array
  ): Promise<void> {
    const embedId = `msg_${messageId}`;

    if (this.hasVecExtension) {
      // Ensure vec tables exist with correct dimensions
      this.ensureVecTables(embedding.length);

      // Use sqlite-vec virtual table
      try {
        // Try to delete existing entry first (handles dimension mismatches)
        try {
          this.db
            .prepare("DELETE FROM vec_message_embeddings WHERE id = ?")
            .run(embedId);
        } catch (_deleteError) {
          // Ignore - entry might not exist
        }

        // Now insert the new embedding
        this.db
          .prepare(
            "INSERT INTO vec_message_embeddings (id, embedding) VALUES (?, ?)"
          )
          .run(embedId, this.float32ArrayToBuffer(embedding));
      } catch (error) {
        // Only log non-UNIQUE-constraint errors
        const errorMessage = (error as Error).message;
        if (!errorMessage.includes("UNIQUE constraint")) {
          console.error("Error storing vector embedding:", error);
        }
        // Fallback to BLOB
        this.storeInBlobTable(messageId, content, embedding);
      }
    } else {
      // Use BLOB storage
      this.storeInBlobTable(messageId, content, embedding);
    }
  }

  /**
   * Store embedding in BLOB table (fallback)
   */
  private storeInBlobTable(
    messageId: string,
    content: string,
    embedding: Float32Array
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO message_embeddings
         (id, message_id, content, embedding, model_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        `msg_${messageId}`,
        messageId,
        content,
        this.float32ArrayToBuffer(embedding),
        "all-MiniLM-L6-v2",
        Date.now()
      );
  }

  /**
   * Store an embedding for a decision
   */
  async storeDecisionEmbedding(
    decisionId: string,
    embedding: Float32Array
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO decision_embeddings
         (id, decision_id, embedding, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        `dec_${decisionId}`,
        decisionId,
        this.float32ArrayToBuffer(embedding),
        Date.now()
      );
  }

  /**
   * Search for similar messages
   */
  async searchMessages(
    queryEmbedding: Float32Array,
    limit: number = 10
  ): Promise<VectorSearchResult[]> {
    if (this.hasVecExtension) {
      return this.searchWithVecExtension(queryEmbedding, limit);
    } else {
      return this.searchWithCosine(queryEmbedding, limit);
    }
  }

  /**
   * Search using sqlite-vec extension
   */
  private searchWithVecExtension(
    queryEmbedding: Float32Array,
    limit: number
  ): VectorSearchResult[] {
    try {
      const queryBuffer = this.float32ArrayToBuffer(queryEmbedding);

      const results = this.db
        .prepare(
          `SELECT
            vec.id,
            me.content,
            vec_distance_cosine(vec.embedding, ?) as distance
          FROM vec_message_embeddings vec
          JOIN message_embeddings me ON vec.id = me.id
          ORDER BY distance
          LIMIT ?`
        )
        .all(queryBuffer, limit) as Array<{
        id: string;
        content: string;
        distance: number;
      }>;

      return results.map((r) => ({
        id: r.id.replace("msg_", ""),
        content: r.content,
        similarity: 1 - r.distance, // Convert distance to similarity
      }));
    } catch (error) {
      console.error("Error in vec search:", error);
      // Fallback to cosine
      return this.searchWithCosine(queryEmbedding, limit);
    }
  }

  /**
   * Search using manual cosine similarity (fallback)
   */
  private searchWithCosine(
    queryEmbedding: Float32Array,
    limit: number
  ): VectorSearchResult[] {
    const allEmbeddings = this.db
      .prepare("SELECT id, message_id, content, embedding FROM message_embeddings")
      .all() as Array<{
      id: string;
      message_id: string;
      content: string;
      embedding: Buffer;
    }>;

    const results = allEmbeddings
      .map((row) => {
        const embedding = this.bufferToFloat32Array(row.embedding);
        const similarity = this.cosineSimilarity(queryEmbedding, embedding);

        return {
          id: row.message_id,
          content: row.content,
          similarity,
        };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have same length");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Convert Float32Array to Buffer for storage
   */
  private float32ArrayToBuffer(array: Float32Array): Buffer {
    return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  }

  /**
   * Convert Buffer to Float32Array for retrieval
   */
  private bufferToFloat32Array(buffer: Buffer): Float32Array {
    return new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / 4
    );
  }

  /**
   * Get embedding count
   */
  getEmbeddingCount(): number {
    const result = this.db
      .prepare("SELECT COUNT(*) as count FROM message_embeddings")
      .get() as { count: number };
    return result.count;
  }

  /**
   * Clear all embeddings
   */
  clearAllEmbeddings(): void {
    this.db.exec("DELETE FROM message_embeddings");
    this.db.exec("DELETE FROM decision_embeddings");

    if (this.hasVecExtension) {
      try {
        this.db.exec("DELETE FROM vec_message_embeddings");
      } catch (_e) {
        // Vector table might not exist
      }
    }
  }
}
