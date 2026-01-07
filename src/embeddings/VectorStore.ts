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
      // First, check if vec0 module is registered by querying sqlite_master
      // This works even in read-only mode
      const vecTables = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vec_%'")
        .all() as Array<{ name: string }>;

      // If vec tables exist, the extension was loaded successfully before
      if (vecTables.length > 0) {
        this.hasVecExtension = true;
        console.error("✓ sqlite-vec extension detected (existing tables found)");
        return;
      }

      // Try to create a test virtual table (requires write access)
      this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS vec_test USING vec0(test float[1])");
      this.db.exec("DROP TABLE vec_test");
      this.hasVecExtension = true;
      console.error("✓ sqlite-vec extension detected");
    } catch (error) {
      const errorMessage = (error as Error).message;
      // Check if it's a read-only error vs actual missing extension
      if (errorMessage.includes("readonly") || errorMessage.includes("read-only")) {
        // Database is read-only, assume vec is available if extension loaded
        // (SQLiteManager would have failed to load if it wasn't)
        this.hasVecExtension = true;
        console.error("✓ sqlite-vec extension assumed available (read-only mode)");
      } else {
        this.hasVecExtension = false;
        console.error("⚠ sqlite-vec not available:", errorMessage);
      }
    }
  }

  /**
   * Check if vec extension is enabled
   */
  isVecEnabled(): boolean {
    return this.hasVecExtension;
  }

  /**
   * Generic helper to get existing embedding IDs from both BLOB and vec tables.
   * @param blobTable - BLOB table name (e.g., "message_embeddings")
   * @param idColumn - Column name for the entity ID (e.g., "message_id")
   * @param vecTable - Vec table name (e.g., "vec_message_embeddings")
   * @param prefix - ID prefix in vec table (e.g., "msg_")
   */
  private getExistingEmbeddingIds(
    blobTable: string,
    idColumn: string,
    vecTable: string,
    prefix: string
  ): Set<string> {
    const ids = new Set<string>();

    // Query BLOB fallback table
    try {
      const rows = this.db
        .prepare(`SELECT ${idColumn} FROM ${blobTable}`)
        .all() as Array<Record<string, string>>;
      for (const row of rows) {
        ids.add(row[idColumn]);
      }
    } catch (_e) {
      // Table might not exist yet
    }

    // Also query sqlite-vec table if extension is available
    if (this.hasVecExtension) {
      try {
        const vecRows = this.db
          .prepare(`SELECT id FROM ${vecTable}`)
          .all() as Array<{ id: string }>;
        for (const row of vecRows) {
          // Strip prefix to get actual entity ID
          if (row.id.startsWith(prefix)) {
            ids.add(row.id.substring(prefix.length));
          }
        }
      } catch (_e) {
        // Vec table might not exist yet
      }
    }

    return ids;
  }

  /**
   * Get set of message IDs that already have embeddings.
   */
  getExistingMessageEmbeddingIds(): Set<string> {
    return this.getExistingEmbeddingIds(
      "message_embeddings",
      "message_id",
      "vec_message_embeddings",
      "msg_"
    );
  }

  /**
   * Get set of decision IDs that already have embeddings.
   */
  getExistingDecisionEmbeddingIds(): Set<string> {
    return this.getExistingEmbeddingIds(
      "decision_embeddings",
      "decision_id",
      "vec_decision_embeddings",
      "dec_"
    );
  }

  /**
   * Get set of mistake IDs that already have embeddings.
   */
  getExistingMistakeEmbeddingIds(): Set<string> {
    return this.getExistingEmbeddingIds(
      "mistake_embeddings",
      "mistake_id",
      "vec_mistake_embeddings",
      "mst_"
    );
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
   * @param messageId - The message ID
   * @param content - The message content
   * @param embedding - The embedding vector
   * @param modelName - The model used to generate the embedding (default: all-MiniLM-L6-v2)
   */
  async storeMessageEmbedding(
    messageId: string,
    content: string,
    embedding: Float32Array,
    modelName: string = "all-MiniLM-L6-v2"
  ): Promise<void> {
    const embedId = `msg_${messageId}`;

    // ALWAYS store content in BLOB table for JOINs and fallback
    // This ensures search can always retrieve content regardless of vec mode
    this.storeInBlobTable(messageId, content, embedding, modelName);

    if (this.hasVecExtension) {
      // Ensure vec tables exist with correct dimensions
      try {
        this.ensureVecTables(embedding.length);
      } catch (error) {
        console.error("Failed to ensure vec tables:", (error as Error).message);
        // Content already stored in BLOB table, so we can continue
        return;
      }

      // Also store in sqlite-vec virtual table for fast similarity search
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
          console.error("Vec embedding storage failed, using BLOB only:", errorMessage);
        }
        // Content already stored in BLOB table, so search will still work
      }
    }
  }

  /**
   * Store embedding in BLOB table (fallback)
   */
  private storeInBlobTable(
    messageId: string,
    content: string,
    embedding: Float32Array,
    modelName: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO message_embeddings
         (id, message_id, content, embedding, model_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           message_id = excluded.message_id,
           content = excluded.content,
           embedding = excluded.embedding,
           model_name = excluded.model_name,
           created_at = excluded.created_at`
      )
      .run(
        `msg_${messageId}`,
        messageId,
        content,
        this.float32ArrayToBuffer(embedding),
        modelName,
        Date.now()
      );
  }

  /**
   * Generic helper to store embeddings for decisions/mistakes (simpler schema without content).
   * @param entityId - The entity ID (decision or mistake)
   * @param embedding - The embedding vector
   * @param blobTable - BLOB table name (e.g., "decision_embeddings")
   * @param idColumn - Column name for entity ID (e.g., "decision_id")
   * @param vecTable - Vec table name (e.g., "vec_decision_embeddings")
   * @param prefix - ID prefix (e.g., "dec_")
   * @param entityType - For logging (e.g., "decision")
   */
  private storeEntityEmbedding(
    entityId: string,
    embedding: Float32Array,
    blobTable: string,
    idColumn: string,
    vecTable: string,
    prefix: string,
    entityType: string
  ): void {
    const embedId = `${prefix}${entityId}`;

    // Store in BLOB table
    this.db
      .prepare(
        `INSERT INTO ${blobTable}
         (id, ${idColumn}, embedding, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           ${idColumn} = excluded.${idColumn},
           embedding = excluded.embedding,
           created_at = excluded.created_at`
      )
      .run(
        embedId,
        entityId,
        this.float32ArrayToBuffer(embedding),
        Date.now()
      );

    // Also store in sqlite-vec if available
    if (this.hasVecExtension) {
      try {
        this.ensureVecTables(embedding.length);
        try {
          this.db.prepare(`DELETE FROM ${vecTable} WHERE id = ?`).run(embedId);
        } catch (_e) {
          // Ignore - entry might not exist
        }
        this.db
          .prepare(`INSERT INTO ${vecTable} (id, embedding) VALUES (?, ?)`)
          .run(embedId, this.float32ArrayToBuffer(embedding));
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (!errorMessage.includes("UNIQUE constraint")) {
          console.error(`Vec ${entityType} embedding storage failed:`, errorMessage);
        }
      }
    }
  }

  /**
   * Store an embedding for a decision
   */
  async storeDecisionEmbedding(
    decisionId: string,
    embedding: Float32Array
  ): Promise<void> {
    this.storeEntityEmbedding(
      decisionId,
      embedding,
      "decision_embeddings",
      "decision_id",
      "vec_decision_embeddings",
      "dec_",
      "decision"
    );
  }

  /**
   * Store an embedding for a mistake
   */
  async storeMistakeEmbedding(
    mistakeId: string,
    embedding: Float32Array
  ): Promise<void> {
    this.storeEntityEmbedding(
      mistakeId,
      embedding,
      "mistake_embeddings",
      "mistake_id",
      "vec_mistake_embeddings",
      "mst_",
      "mistake"
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
      throw new Error(`Vectors must have same length: got ${a.length} and ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    // Guard against division by zero (zero vectors)
    if (normA === 0 || normB === 0) {
      return 0;
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
    // Validate byte alignment (must be divisible by 4 for Float32)
    if (buffer.byteLength % 4 !== 0) {
      console.error(`Invalid embedding buffer size: ${buffer.byteLength} bytes (not divisible by 4)`);
      return new Float32Array(0);
    }

    // Copy to ensure proper alignment (Node Buffers may not be aligned)
    const aligned = new Float32Array(buffer.byteLength / 4);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    for (let i = 0; i < aligned.length; i++) {
      aligned[i] = view.getFloat32(i * 4, true); // little-endian
    }
    return aligned;
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
    try {
      this.db.exec("DELETE FROM mistake_embeddings");
    } catch (_e) {
      // Table might not exist yet
    }

    if (this.hasVecExtension) {
      try {
        this.db.exec("DELETE FROM vec_message_embeddings");
      } catch (_e) {
        // Vector table might not exist
      }
      try {
        this.db.exec("DELETE FROM vec_decision_embeddings");
      } catch (_e) {
        // Vector table might not exist
      }
      try {
        this.db.exec("DELETE FROM vec_mistake_embeddings");
      } catch (_e) {
        // Vector table might not exist
      }
    }
  }
}
