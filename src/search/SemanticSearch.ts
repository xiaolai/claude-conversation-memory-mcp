/**
 * Semantic Search Interface
 * Combines vector store and embedding generation for conversation search
 */

import type { SQLiteManager } from "../storage/SQLiteManager.js";
import { VectorStore } from "../embeddings/VectorStore.js";
import { getEmbeddingGenerator } from "../embeddings/EmbeddingGenerator.js";
import type { Message, Conversation } from "../parsers/ConversationParser.js";
import type { Decision } from "../parsers/DecisionExtractor.js";
import type { MessageRow, DecisionRow, ConversationRow } from "../types/ToolTypes.js";

export interface SearchFilter {
  date_range?: [number, number];
  message_type?: string[];
  has_decisions?: boolean;
  conversation_id?: string;
}

export interface SearchResult {
  message: Message;
  conversation: Conversation;
  similarity: number;
  snippet: string;
}

export interface DecisionSearchResult {
  decision: Decision;
  conversation: Conversation;
  similarity: number;
}

export class SemanticSearch {
  private vectorStore: VectorStore;
  private db: SQLiteManager;

  constructor(sqliteManager: SQLiteManager) {
    this.db = sqliteManager;
    this.vectorStore = new VectorStore(sqliteManager);
  }

  /**
   * Index all messages for semantic search
   */
  async indexMessages(messages: Message[]): Promise<void> {
    console.log(`Indexing ${messages.length} messages...`);

    const embedder = await getEmbeddingGenerator();

    if (!embedder.isAvailable()) {
      console.warn("Embeddings not available - skipping indexing");
      return;
    }

    // Filter messages with content
    const messagesWithContent = messages.filter(
      (m): m is Message & { content: string } => !!m.content && m.content.trim().length > 0
    );

    // Skip messages that already have embeddings (incremental optimization)
    const existingIds = this.vectorStore.getExistingMessageEmbeddingIds();
    const messagesToIndex = messagesWithContent.filter((m) => !existingIds.has(m.id));

    if (messagesToIndex.length === 0) {
      console.log(`⏭ All ${messagesWithContent.length} messages already have embeddings`);
      return;
    }

    if (existingIds.size > 0) {
      console.log(`⏭ Skipping ${messagesWithContent.length - messagesToIndex.length} already-embedded messages`);
    }
    console.log(`Generating embeddings for ${messagesToIndex.length} new messages...`);

    // Generate embeddings in batches
    const texts = messagesToIndex.map((m) => m.content);
    const embeddings = await embedder.embedBatch(texts, 32);

    // Store embeddings
    for (let i = 0; i < messagesToIndex.length; i++) {
      await this.vectorStore.storeMessageEmbedding(
        messagesToIndex[i].id,
        messagesToIndex[i].content,
        embeddings[i]
      );
    }

    console.log("✓ Indexing complete");
  }

  /**
   * Index decisions for semantic search
   */
  async indexDecisions(decisions: Decision[]): Promise<void> {
    console.log(`Indexing ${decisions.length} decisions...`);

    const embedder = await getEmbeddingGenerator();

    if (!embedder.isAvailable()) {
      console.warn("Embeddings not available - skipping decision indexing");
      return;
    }

    // Skip decisions that already have embeddings (incremental optimization)
    const existingIds = this.vectorStore.getExistingDecisionEmbeddingIds();
    const decisionsToIndex = decisions.filter((d) => !existingIds.has(d.id));

    if (decisionsToIndex.length === 0) {
      console.log(`⏭ All ${decisions.length} decisions already have embeddings`);
      return;
    }

    if (existingIds.size > 0) {
      console.log(`⏭ Skipping ${decisions.length - decisionsToIndex.length} already-embedded decisions`);
    }
    console.log(`Generating embeddings for ${decisionsToIndex.length} new decisions...`);

    // Generate embeddings for decision text + rationale
    const texts = decisionsToIndex.map((d) => {
      const parts = [d.decision_text];
      if (d.rationale) {parts.push(d.rationale);}
      if (d.context) {parts.push(d.context);}
      return parts.join(" ");
    });

    const embeddings = await embedder.embedBatch(texts, 32);

    // Store embeddings
    for (let i = 0; i < decisionsToIndex.length; i++) {
      await this.vectorStore.storeDecisionEmbedding(
        decisionsToIndex[i].id,
        embeddings[i]
      );
    }

    console.log("✓ Decision indexing complete");
  }

  /**
   * Search conversations using natural language query
   */
  async searchConversations(
    query: string,
    limit: number = 10,
    filter?: SearchFilter
  ): Promise<SearchResult[]> {
    const embedder = await getEmbeddingGenerator();

    if (!embedder.isAvailable()) {
      console.warn("Embeddings not available - falling back to full-text search");
      return this.fallbackFullTextSearch(query, limit, filter);
    }

    try {
      // Generate query embedding
      const queryEmbedding = await embedder.embed(query);

      // Search vector store
      const vectorResults = await this.vectorStore.searchMessages(
        queryEmbedding,
        limit * 2 // Get more results for filtering
      );

      // Enrich with message and conversation data
      const enrichedResults: SearchResult[] = [];

      for (const vecResult of vectorResults) {
        const message = this.getMessage(vecResult.id);
        if (!message) {continue;}

        // Apply filters
        if (filter) {
          if (!this.applyFilter(message, filter)) {continue;}
        }

        const conversation = this.getConversation(message.conversation_id);
        if (!conversation) {continue;}

        enrichedResults.push({
          message,
          conversation,
          similarity: vecResult.similarity,
          snippet: this.generateSnippet(vecResult.content, query),
        });

        if (enrichedResults.length >= limit) {break;}
      }

      // Fall back to FTS if vector search returned no results
      if (enrichedResults.length === 0) {
        console.warn("Vector search returned no results - falling back to FTS");
        return this.fallbackFullTextSearch(query, limit, filter);
      }

      return enrichedResults;
    } catch (error) {
      // If embedding fails, fall back to FTS
      console.warn("Embedding error, falling back to FTS:", (error as Error).message);
      return this.fallbackFullTextSearch(query, limit, filter);
    }
  }

  /**
   * Search for decisions
   */
  async searchDecisions(
    query: string,
    limit: number = 10
  ): Promise<DecisionSearchResult[]> {
    const embedder = await getEmbeddingGenerator();

    if (!embedder.isAvailable()) {
      console.warn("Embeddings not available - using text search");
      return this.fallbackDecisionSearch(query, limit);
    }

    // Generate query embedding
    const queryEmbedding = await embedder.embed(query);

    // Get all decision embeddings and calculate similarity
    const allDecisions = this.db
      .prepare(
        "SELECT id, decision_id, embedding FROM decision_embeddings"
      )
      .all() as Array<{ id: string; decision_id: string; embedding: Buffer }>;

    const results = allDecisions
      .map((row) => {
        const embedding = this.bufferToFloat32Array(row.embedding);
        const similarity = this.cosineSimilarity(queryEmbedding, embedding);

        const decision = this.getDecision(row.decision_id);
        if (!decision) {return null;}

        const conversation = this.getConversation(decision.conversation_id);
        if (!conversation) {return null;}

        return { decision, conversation, similarity };
      })
      .filter((r): r is DecisionSearchResult => r !== null)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  /**
   * Fallback to full-text search when embeddings unavailable
   */
  private fallbackFullTextSearch(
    query: string,
    limit: number,
    filter?: SearchFilter
  ): SearchResult[] {
    let sql = `
      SELECT m.*, c.project_path, c.git_branch, c.claude_version
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id IN (
        SELECT id FROM messages_fts WHERE messages_fts MATCH ?
      )
    `;

    const params: (string | number)[] = [query];

    // Apply filters
    if (filter) {
      if (filter.date_range) {
        sql += " AND m.timestamp BETWEEN ? AND ?";
        params.push(filter.date_range[0], filter.date_range[1]);
      }

      if (filter.message_type) {
        sql += ` AND m.message_type IN (${filter.message_type.map(() => "?").join(",")})`;
        params.push(...filter.message_type);
      }

      if (filter.conversation_id) {
        sql += " AND m.conversation_id = ?";
        params.push(filter.conversation_id);
      }
    }

    sql += " ORDER BY m.timestamp DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as MessageRow[];

    return rows.map((row) => {
      const conversation = this.getConversation(row.conversation_id);
      if (!conversation) {
        console.warn(`Warning: Conversation ${row.conversation_id} not found for message ${row.id}`);
        // Return a placeholder - in production, this shouldn't happen
        throw new Error(`Data integrity error: Conversation ${row.conversation_id} not found`);
      }

      return {
        message: {
          ...row,
          metadata: JSON.parse(row.metadata || "{}"),
          is_sidechain: Boolean(row.is_sidechain),
        } as Message,
        conversation,
        similarity: 0.5, // Default similarity for FTS
        snippet: this.generateSnippet(row.content || "", query),
      };
    });
  }

  /**
   * Fallback decision search
   */
  private fallbackDecisionSearch(
    query: string,
    limit: number
  ): DecisionSearchResult[] {
    const sql = `
      SELECT d.*, c.project_path, c.git_branch
      FROM decisions d
      JOIN conversations c ON d.conversation_id = c.id
      WHERE d.id IN (
        SELECT id FROM decisions_fts WHERE decisions_fts MATCH ?
      )
      ORDER BY d.timestamp DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(sql).all(query, limit) as DecisionRow[];

    return rows.map((row) => {
      const conversation = this.getConversation(row.conversation_id);
      if (!conversation) {
        console.warn(`Warning: Conversation ${row.conversation_id} not found for decision ${row.id}`);
        throw new Error(`Data integrity error: Conversation ${row.conversation_id} not found`);
      }

      return {
        decision: {
          ...row,
          alternatives_considered: JSON.parse(row.alternatives_considered || "[]"),
          rejected_reasons: JSON.parse(row.rejected_reasons || "{}"),
          related_files: JSON.parse(row.related_files || "[]"),
          related_commits: JSON.parse(row.related_commits || "[]"),
        } as Decision,
        conversation,
        similarity: 0.5,
      };
    });
  }

  /**
   * Apply filter to message
   */
  private applyFilter(message: Message, filter: SearchFilter): boolean {
    if (filter.date_range) {
      if (
        message.timestamp < filter.date_range[0] ||
        message.timestamp > filter.date_range[1]
      ) {
        return false;
      }
    }

    if (filter.message_type) {
      if (!filter.message_type.includes(message.message_type)) {
        return false;
      }
    }

    if (filter.conversation_id) {
      if (message.conversation_id !== filter.conversation_id) {
        return false;
      }
    }

    return true;
  }

  /**
   * Generate snippet from content
   */
  private generateSnippet(content: string, query: string, length: number = 150): string {
    // Try to find query term in content
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerContent.indexOf(lowerQuery);

    if (index !== -1) {
      // Extract around query term
      const start = Math.max(0, index - 50);
      const end = Math.min(content.length, index + query.length + 100);
      let snippet = content.substring(start, end);

      if (start > 0) {snippet = "..." + snippet;}
      if (end < content.length) {snippet = snippet + "...";}

      return snippet;
    }

    // Otherwise just return beginning
    return content.substring(0, length) + (content.length > length ? "..." : "");
  }

  /**
   * Get message by ID
   */
  private getMessage(id: string): Message | null {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(id) as MessageRow | undefined;

    if (!row) {
      return null;
    }

    return {
      ...row,
      metadata: JSON.parse(row.metadata || "{}"),
      is_sidechain: Boolean(row.is_sidechain),
    };
  }

  /**
   * Get conversation by ID
   */
  private getConversation(id: string): Conversation | null {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as ConversationRow | undefined;

    if (!row) {
      return null;
    }

    return {
      ...row,
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }

  /**
   * Get decision by ID
   */
  private getDecision(id: string): Decision | null {
    const row = this.db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as DecisionRow | undefined;

    if (!row) {
      return null;
    }

    return {
      ...row,
      alternatives_considered: JSON.parse(row.alternatives_considered || "[]"),
      rejected_reasons: JSON.parse(row.rejected_reasons || "{}"),
      related_files: JSON.parse(row.related_files || "[]"),
      related_commits: JSON.parse(row.related_commits || "[]"),
    };
  }

  /**
   * Cosine similarity helper
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
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
   * Buffer to Float32Array helper
   */
  private bufferToFloat32Array(buffer: Buffer): Float32Array {
    return new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / 4
    );
  }

  /**
   * Get search statistics
   */
  getStats(): {
    total_embeddings: number;
    vec_enabled: boolean;
    model_info: Record<string, unknown>;
  } {
    return {
      total_embeddings: this.vectorStore.getEmbeddingCount(),
      vec_enabled: this.vectorStore.isVecEnabled(),
      model_info: {
        model: "all-MiniLM-L6-v2",
        dimensions: 384,
      },
    };
  }
}
