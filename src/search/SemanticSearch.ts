/**
 * Semantic Search Interface
 * Combines vector store and embedding generation for conversation search
 */

import type { SQLiteManager } from "../storage/SQLiteManager.js";
import { VectorStore } from "../embeddings/VectorStore.js";
import { getEmbeddingGenerator, EmbeddingGenerator } from "../embeddings/EmbeddingGenerator.js";
import type { Message, Conversation } from "../parsers/ConversationParser.js";
import type { Decision } from "../parsers/DecisionExtractor.js";
import type { Mistake } from "../parsers/MistakeExtractor.js";
import type { MessageRow, DecisionRow, ConversationRow } from "../types/ToolTypes.js";
import { safeJsonParse } from "../utils/safeJson.js";

export interface SearchFilter {
  date_range?: [number, number];
  message_type?: string[];
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

export interface MistakeSearchResult {
  mistake: Mistake;
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
   * @param messages - Messages to index
   * @param incremental - If true, skip messages that already have embeddings (default: true for fast re-indexing)
   */
  async indexMessages(messages: Message[], incremental: boolean = true): Promise<void> {
    console.error(`Indexing ${messages.length} messages...`);

    const embedder = await getEmbeddingGenerator();

    if (!embedder.isAvailable()) {
      console.error("Embeddings not available - skipping indexing");
      return;
    }

    // Filter messages with content
    const messagesWithContent = messages.filter(
      (m): m is Message & { content: string } => !!m.content && m.content.trim().length > 0
    );

    // In incremental mode, skip messages that already have embeddings
    let messagesToIndex = messagesWithContent;
    if (incremental) {
      const existingIds = this.vectorStore.getExistingMessageEmbeddingIds();
      messagesToIndex = messagesWithContent.filter((m) => !existingIds.has(m.id));

      if (messagesToIndex.length === 0) {
        console.error(`⏭ All ${messagesWithContent.length} messages already have embeddings`);
        return;
      }

      if (existingIds.size > 0) {
        console.error(`⏭ Skipping ${messagesWithContent.length - messagesToIndex.length} already-embedded messages`);
      }
    }
    console.error(`Generating embeddings for ${messagesToIndex.length} ${incremental ? "new " : ""}messages...`);

    // Generate embeddings in batches
    const texts = messagesToIndex.map((m) => m.content);
    const embeddings = await embedder.embedBatch(texts, 32);

    // Get model name from embedder info
    const embedderInfo = EmbeddingGenerator.getInfo();
    const modelName = embedderInfo?.model || "all-MiniLM-L6-v2";

    // Store embeddings
    for (let i = 0; i < messagesToIndex.length; i++) {
      await this.vectorStore.storeMessageEmbedding(
        messagesToIndex[i].id,
        messagesToIndex[i].content,
        embeddings[i],
        modelName
      );
    }

    console.error("✓ Indexing complete");
  }

  /**
   * Index decisions for semantic search
   * @param decisions - Decisions to index
   * @param incremental - If true, skip decisions that already have embeddings (default: true for fast re-indexing)
   */
  async indexDecisions(decisions: Decision[], incremental: boolean = true): Promise<void> {
    console.error(`Indexing ${decisions.length} decisions...`);

    const embedder = await getEmbeddingGenerator();

    if (!embedder.isAvailable()) {
      console.error("Embeddings not available - skipping decision indexing");
      return;
    }

    // In incremental mode, skip decisions that already have embeddings
    let decisionsToIndex = decisions;
    if (incremental) {
      const existingIds = this.vectorStore.getExistingDecisionEmbeddingIds();
      decisionsToIndex = decisions.filter((d) => !existingIds.has(d.id));

      if (decisionsToIndex.length === 0) {
        console.error(`⏭ All ${decisions.length} decisions already have embeddings`);
        return;
      }

      if (existingIds.size > 0) {
        console.error(`⏭ Skipping ${decisions.length - decisionsToIndex.length} already-embedded decisions`);
      }
    }
    console.error(`Generating embeddings for ${decisionsToIndex.length} ${incremental ? "new " : ""}decisions...`);

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

    console.error("✓ Decision indexing complete");
  }

  /**
   * Index all decisions in the database that don't have embeddings.
   * This catches decisions that were stored before embeddings were available.
   */
  async indexMissingDecisionEmbeddings(): Promise<number> {
    const embedder = await getEmbeddingGenerator();

    if (!embedder.isAvailable()) {
      console.error("Embeddings not available - skipping missing decision indexing");
      return 0;
    }

    // Get decisions without embeddings
    const existingIds = this.vectorStore.getExistingDecisionEmbeddingIds();

    interface DecisionRow {
      id: string;
      decision_text: string;
      rationale: string | null;
      context: string | null;
    }

    const allDecisions = this.db
      .prepare("SELECT id, decision_text, rationale, context FROM decisions")
      .all() as DecisionRow[];

    const missingDecisions = allDecisions.filter((d) => !existingIds.has(d.id));

    if (missingDecisions.length === 0) {
      return 0;
    }

    console.error(`Generating embeddings for ${missingDecisions.length} decisions missing embeddings...`);

    // Generate embeddings for decision text + rationale
    const texts = missingDecisions.map((d) => {
      const parts = [d.decision_text];
      if (d.rationale) {parts.push(d.rationale);}
      if (d.context) {parts.push(d.context);}
      return parts.join(" ");
    });

    const embeddings = await embedder.embedBatch(texts, 32);

    // Store embeddings
    for (let i = 0; i < missingDecisions.length; i++) {
      await this.vectorStore.storeDecisionEmbedding(
        missingDecisions[i].id,
        embeddings[i]
      );
    }

    console.error(`✓ Generated ${missingDecisions.length} missing decision embeddings`);
    return missingDecisions.length;
  }

  /**
   * Index mistakes for semantic search
   * @param mistakes - Mistakes to index
   * @param incremental - If true, skip mistakes that already have embeddings (default: true)
   */
  async indexMistakes(mistakes: Mistake[], incremental: boolean = true): Promise<void> {
    console.error(`Indexing ${mistakes.length} mistakes...`);

    const embedder = await getEmbeddingGenerator();

    if (!embedder.isAvailable()) {
      console.error("Embeddings not available - skipping mistake indexing");
      return;
    }

    // In incremental mode, skip mistakes that already have embeddings
    let mistakesToIndex = mistakes;
    if (incremental) {
      const existingIds = this.vectorStore.getExistingMistakeEmbeddingIds();
      mistakesToIndex = mistakes.filter((m) => !existingIds.has(m.id));

      if (mistakesToIndex.length === 0) {
        console.error(`⏭ All ${mistakes.length} mistakes already have embeddings`);
        return;
      }

      if (existingIds.size > 0) {
        console.error(`⏭ Skipping ${mistakes.length - mistakesToIndex.length} already-embedded mistakes`);
      }
    }
    console.error(`Generating embeddings for ${mistakesToIndex.length} ${incremental ? "new " : ""}mistakes...`);

    // Generate embeddings for mistake text + correction
    const texts = mistakesToIndex.map((m) => {
      const parts = [m.what_went_wrong];
      if (m.correction) {parts.push(m.correction);}
      if (m.mistake_type) {parts.push(m.mistake_type);}
      return parts.join(" ");
    });

    const embeddings = await embedder.embedBatch(texts, 32);

    // Store embeddings
    for (let i = 0; i < mistakesToIndex.length; i++) {
      await this.vectorStore.storeMistakeEmbedding(
        mistakesToIndex[i].id,
        embeddings[i]
      );
    }

    console.error("✓ Mistake indexing complete");
  }

  /**
   * Index all mistakes in the database that don't have embeddings.
   * This catches mistakes that were stored before embeddings were available.
   */
  async indexMissingMistakeEmbeddings(): Promise<number> {
    const embedder = await getEmbeddingGenerator();

    if (!embedder.isAvailable()) {
      console.error("Embeddings not available - skipping missing mistake indexing");
      return 0;
    }

    // Get mistakes without embeddings
    const existingIds = this.vectorStore.getExistingMistakeEmbeddingIds();

    interface MistakeRow {
      id: string;
      what_went_wrong: string;
      correction: string | null;
      mistake_type: string;
    }

    const allMistakes = this.db
      .prepare("SELECT id, what_went_wrong, correction, mistake_type FROM mistakes")
      .all() as MistakeRow[];

    const missingMistakes = allMistakes.filter((m) => !existingIds.has(m.id));

    if (missingMistakes.length === 0) {
      return 0;
    }

    console.error(`Generating embeddings for ${missingMistakes.length} mistakes missing embeddings...`);

    // Generate embeddings for mistake text + correction
    const texts = missingMistakes.map((m) => {
      const parts = [m.what_went_wrong];
      if (m.correction) {parts.push(m.correction);}
      if (m.mistake_type) {parts.push(m.mistake_type);}
      return parts.join(" ");
    });

    const embeddings = await embedder.embedBatch(texts, 32);

    // Store embeddings
    for (let i = 0; i < missingMistakes.length; i++) {
      await this.vectorStore.storeMistakeEmbedding(
        missingMistakes[i].id,
        embeddings[i]
      );
    }

    console.error(`✓ Generated ${missingMistakes.length} missing mistake embeddings`);
    return missingMistakes.length;
  }

  /**
   * Search for mistakes using semantic search
   */
  async searchMistakes(
    query: string,
    limit: number = 10
  ): Promise<MistakeSearchResult[]> {
    const embedder = await getEmbeddingGenerator();

    if (!embedder.isAvailable()) {
      console.error("Embeddings not available - using text search");
      return this.fallbackMistakeSearch(query, limit);
    }

    // Generate query embedding
    const queryEmbedding = await embedder.embed(query);

    try {
      // Use vec_distance_cosine for efficient ANN search with JOINs
      // Note: Must include byteOffset/byteLength in case Float32Array is a view
      const queryBuffer = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);

      const rows = this.db
        .prepare(
          `SELECT
            vec.id as vec_id,
            vec_distance_cosine(vec.embedding, ?) as distance,
            m.id,
            m.conversation_id,
            m.message_id,
            m.mistake_type,
            m.what_went_wrong,
            m.correction,
            m.user_correction_message,
            m.files_affected,
            m.timestamp,
            c.id as conv_id,
            c.project_path,
            c.first_message_at,
            c.last_message_at,
            c.message_count,
            c.git_branch,
            c.claude_version,
            c.metadata as conv_metadata,
            c.created_at as conv_created_at,
            c.updated_at as conv_updated_at
          FROM vec_mistake_embeddings vec
          JOIN mistake_embeddings me ON vec.id = me.id
          JOIN mistakes m ON me.mistake_id = m.id
          JOIN conversations c ON m.conversation_id = c.id
          ORDER BY distance
          LIMIT ?`
        )
        .all(queryBuffer, limit) as Array<{
        vec_id: string;
        distance: number;
        id: string;
        conversation_id: string;
        message_id: string;
        mistake_type: string;
        what_went_wrong: string;
        correction: string | null;
        user_correction_message: string | null;
        files_affected: string;
        timestamp: number;
        conv_id: string;
        project_path: string;
        first_message_at: number;
        last_message_at: number;
        message_count: number;
        git_branch: string;
        claude_version: string;
        conv_metadata: string;
        conv_created_at: number;
        conv_updated_at: number;
      }>;

      // Fall back to FTS if vector search returned no results
      if (rows.length === 0) {
        console.error("Vector search returned no mistake results - falling back to FTS");
        return this.fallbackMistakeSearch(query, limit);
      }

      return rows.map((row) => ({
        mistake: {
          id: row.id,
          conversation_id: row.conversation_id,
          message_id: row.message_id,
          mistake_type: row.mistake_type as Mistake["mistake_type"],
          what_went_wrong: row.what_went_wrong,
          correction: row.correction || undefined,
          user_correction_message: row.user_correction_message || undefined,
          files_affected: safeJsonParse<string[]>(row.files_affected, []),
          timestamp: row.timestamp,
        },
        conversation: {
          id: row.conv_id,
          project_path: row.project_path,
          first_message_at: row.first_message_at,
          last_message_at: row.last_message_at,
          message_count: row.message_count,
          git_branch: row.git_branch,
          claude_version: row.claude_version,
          metadata: safeJsonParse<Record<string, unknown>>(row.conv_metadata, {}),
          created_at: row.conv_created_at,
          updated_at: row.conv_updated_at,
        },
        similarity: 1 - row.distance, // Convert distance to similarity
      }));
    } catch (error) {
      // Fallback to text search if vec search fails
      console.error("Vec mistake search failed, falling back to text search:", (error as Error).message);
      return this.fallbackMistakeSearch(query, limit);
    }
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
      console.error("Embeddings not available - falling back to full-text search");
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
        console.error("Vector search returned no results - falling back to FTS");
        return this.fallbackFullTextSearch(query, limit, filter);
      }

      return enrichedResults;
    } catch (error) {
      // If embedding fails, fall back to FTS
      console.error("Embedding error, falling back to FTS:", (error as Error).message);
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
      console.error("Embeddings not available - using text search");
      return this.fallbackDecisionSearch(query, limit);
    }

    // Generate query embedding
    const queryEmbedding = await embedder.embed(query);

    try {
      // Use vec_distance_cosine for efficient ANN search with JOINs to avoid N+1 queries
      // Note: Must include byteOffset/byteLength in case Float32Array is a view
      const queryBuffer = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);

      const rows = this.db
        .prepare(
          `SELECT
            vec.id as vec_id,
            vec_distance_cosine(vec.embedding, ?) as distance,
            d.id,
            d.conversation_id,
            d.message_id,
            d.decision_text,
            d.rationale,
            d.alternatives_considered,
            d.rejected_reasons,
            d.context,
            d.related_files,
            d.related_commits,
            d.timestamp,
            c.id as conv_id,
            c.project_path,
            c.first_message_at,
            c.last_message_at,
            c.message_count,
            c.git_branch,
            c.claude_version,
            c.metadata as conv_metadata,
            c.created_at as conv_created_at,
            c.updated_at as conv_updated_at
          FROM vec_decision_embeddings vec
          JOIN decision_embeddings de ON vec.id = de.id
          JOIN decisions d ON de.decision_id = d.id
          JOIN conversations c ON d.conversation_id = c.id
          ORDER BY distance
          LIMIT ?`
        )
        .all(queryBuffer, limit) as Array<{
        vec_id: string;
        distance: number;
        id: string;
        conversation_id: string;
        message_id: string;
        decision_text: string;
        rationale: string;
        alternatives_considered: string;
        rejected_reasons: string;
        context: string;
        related_files: string;
        related_commits: string;
        timestamp: number;
        conv_id: string;
        project_path: string;
        first_message_at: number;
        last_message_at: number;
        message_count: number;
        git_branch: string;
        claude_version: string;
        conv_metadata: string;
        conv_created_at: number;
        conv_updated_at: number;
      }>;

      // Fall back to FTS if vector search returned no results
      if (rows.length === 0) {
        console.error("Vector search returned no decision results - falling back to FTS");
        return this.fallbackDecisionSearch(query, limit);
      }

      return rows.map((row) => ({
        decision: {
          id: row.id,
          conversation_id: row.conversation_id,
          message_id: row.message_id,
          decision_text: row.decision_text,
          rationale: row.rationale,
          alternatives_considered: safeJsonParse<string[]>(row.alternatives_considered, []),
          rejected_reasons: safeJsonParse<Record<string, string>>(row.rejected_reasons, {}),
          context: row.context,
          related_files: safeJsonParse<string[]>(row.related_files, []),
          related_commits: safeJsonParse<string[]>(row.related_commits, []),
          timestamp: row.timestamp,
        },
        conversation: {
          id: row.conv_id,
          project_path: row.project_path,
          first_message_at: row.first_message_at,
          last_message_at: row.last_message_at,
          message_count: row.message_count,
          git_branch: row.git_branch,
          claude_version: row.claude_version,
          metadata: safeJsonParse<Record<string, unknown>>(row.conv_metadata, {}),
          created_at: row.conv_created_at,
          updated_at: row.conv_updated_at,
        },
        similarity: 1 - row.distance, // Convert distance to similarity
      }));
    } catch (error) {
      // Fallback to text search if vec search fails (e.g., table doesn't exist)
      console.error("Vec decision search failed, falling back to text search:", (error as Error).message);
      return this.fallbackDecisionSearch(query, limit);
    }
  }

  /**
   * Sanitize query for FTS5 MATCH syntax.
   * FTS5 has special characters that need escaping: . * " - + ( ) OR AND NOT
   * We wrap each word in double quotes to treat them as literal strings.
   */
  private sanitizeFtsQuery(query: string): string {
    // Split into words and wrap each in double quotes to escape special chars
    // Also escape any existing double quotes within words
    const words = query.trim().split(/\s+/).filter(w => w.length > 0);

    if (words.length === 0) {
      return '""'; // Empty query
    }

    // Escape double quotes and wrap each word
    const escapedWords = words.map(word => {
      // Escape internal double quotes by doubling them
      const escaped = word.replace(/"/g, '""');
      return `"${escaped}"`;
    });

    // Join with space (implicit AND in FTS5)
    return escapedWords.join(' ');
  }

  /**
   * Fallback to full-text search when embeddings unavailable
   */
  private fallbackFullTextSearch(
    query: string,
    limit: number,
    filter?: SearchFilter
  ): SearchResult[] {
    // Sanitize the query for FTS5 syntax
    const ftsQuery = this.sanitizeFtsQuery(query);

    interface JoinedRow extends MessageRow {
      conv_id: string;
      project_path: string;
      first_message_at: number;
      last_message_at: number;
      conv_message_count: number;
      git_branch: string;
      claude_version: string;
      conv_metadata: string;
      conv_created_at: number;
      conv_updated_at: number;
    }

    const mapRowToResult = (row: JoinedRow): SearchResult => {
      const conversation = {
        id: row.conv_id,
        project_path: row.project_path,
        first_message_at: row.first_message_at,
        last_message_at: row.last_message_at,
        message_count: row.conv_message_count,
        git_branch: row.git_branch,
        claude_version: row.claude_version,
        metadata: safeJsonParse<Record<string, unknown>>(row.conv_metadata, {}),
        created_at: row.conv_created_at,
        updated_at: row.conv_updated_at,
      };

      return {
        message: {
          ...row,
          metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
          is_sidechain: Boolean(row.is_sidechain),
        } as Message,
        conversation,
        similarity: 0.5, // Default similarity for FTS/LIKE
        snippet: this.generateSnippet(row.content || "", query),
      };
    };

    // Try FTS first, fall back to LIKE if FTS fails
    try {
      let sql = `
        SELECT m.*,
          c.id as conv_id,
          c.project_path,
          c.first_message_at,
          c.last_message_at,
          c.message_count as conv_message_count,
          c.git_branch,
          c.claude_version,
          c.metadata as conv_metadata,
          c.created_at as conv_created_at,
          c.updated_at as conv_updated_at
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE m.id IN (
          SELECT id FROM messages_fts WHERE messages_fts MATCH ?
        )
      `;

      const params: (string | number)[] = [ftsQuery];

      // Apply filters
      if (filter) {
        if (filter.date_range) {
          sql += " AND m.timestamp BETWEEN ? AND ?";
          params.push(filter.date_range[0], filter.date_range[1]);
        }

        if (filter.message_type && filter.message_type.length > 0) {
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

      const rows = this.db.prepare(sql).all(...params) as JoinedRow[];
      return rows.map(mapRowToResult);
    } catch (_e) {
      // FTS table may not exist or be corrupted, fall back to LIKE search
      console.error("Messages FTS not available, using LIKE search");

      let sql = `
        SELECT m.*,
          c.id as conv_id,
          c.project_path,
          c.first_message_at,
          c.last_message_at,
          c.message_count as conv_message_count,
          c.git_branch,
          c.claude_version,
          c.metadata as conv_metadata,
          c.created_at as conv_created_at,
          c.updated_at as conv_updated_at
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE m.content LIKE ?
      `;

      const likeQuery = `%${query}%`;
      const params: (string | number)[] = [likeQuery];

      // Apply filters
      if (filter) {
        if (filter.date_range) {
          sql += " AND m.timestamp BETWEEN ? AND ?";
          params.push(filter.date_range[0], filter.date_range[1]);
        }

        if (filter.message_type && filter.message_type.length > 0) {
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

      const rows = this.db.prepare(sql).all(...params) as JoinedRow[];
      return rows.map(mapRowToResult);
    }
  }

  /**
   * Fallback decision search
   */
  private fallbackDecisionSearch(
    query: string,
    limit: number
  ): DecisionSearchResult[] {
    // Sanitize the query for FTS5 syntax
    const ftsQuery = this.sanitizeFtsQuery(query);

    const mapRowToResult = (row: DecisionRow): DecisionSearchResult => {
      const conversation = this.getConversation(row.conversation_id);
      if (!conversation) {
        console.error(`Warning: Conversation ${row.conversation_id} not found for decision ${row.id}`);
        throw new Error(`Data integrity error: Conversation ${row.conversation_id} not found`);
      }

      return {
        decision: {
          ...row,
          alternatives_considered: safeJsonParse<string[]>(row.alternatives_considered, []),
          rejected_reasons: safeJsonParse<Record<string, string>>(row.rejected_reasons, {}),
          related_files: safeJsonParse<string[]>(row.related_files, []),
          related_commits: safeJsonParse<string[]>(row.related_commits, []),
        } as Decision,
        conversation,
        similarity: 0.5,
      };
    };

    // Try FTS first, fall back to LIKE if FTS fails
    try {
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

      const rows = this.db.prepare(sql).all(ftsQuery, limit) as DecisionRow[];
      return rows.map(mapRowToResult);
    } catch (_e) {
      // FTS table may not exist or be corrupted, fall back to LIKE search
      console.error("Decisions FTS not available, using LIKE search");

      const sql = `
        SELECT d.*, c.project_path, c.git_branch
        FROM decisions d
        JOIN conversations c ON d.conversation_id = c.id
        WHERE d.decision_text LIKE ? OR d.rationale LIKE ? OR d.context LIKE ?
        ORDER BY d.timestamp DESC
        LIMIT ?
      `;

      const likeQuery = `%${query}%`;
      const rows = this.db.prepare(sql).all(likeQuery, likeQuery, likeQuery, limit) as DecisionRow[];
      return rows.map(mapRowToResult);
    }
  }

  /**
   * Fallback mistake search using FTS
   */
  private fallbackMistakeSearch(
    query: string,
    limit: number
  ): MistakeSearchResult[] {
    // Sanitize the query for FTS5 syntax
    const ftsQuery = this.sanitizeFtsQuery(query);

    // Try FTS first, fall back to LIKE if FTS table doesn't exist
    try {
      const sql = `
        SELECT m.*, c.project_path, c.git_branch,
          c.id as conv_id, c.first_message_at, c.last_message_at,
          c.message_count, c.claude_version, c.metadata as conv_metadata,
          c.created_at as conv_created_at, c.updated_at as conv_updated_at
        FROM mistakes m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE m.id IN (
          SELECT id FROM mistakes_fts WHERE mistakes_fts MATCH ?
        )
        ORDER BY m.timestamp DESC
        LIMIT ?
      `;

      interface MistakeRowWithConv {
        id: string;
        conversation_id: string;
        message_id: string;
        mistake_type: string;
        what_went_wrong: string;
        correction: string | null;
        user_correction_message: string | null;
        files_affected: string;
        timestamp: number;
        project_path: string;
        git_branch: string;
        conv_id: string;
        first_message_at: number;
        last_message_at: number;
        message_count: number;
        claude_version: string;
        conv_metadata: string;
        conv_created_at: number;
        conv_updated_at: number;
      }

      const rows = this.db.prepare(sql).all(ftsQuery, limit) as MistakeRowWithConv[];

      return rows.map((row) => ({
        mistake: {
          id: row.id,
          conversation_id: row.conversation_id,
          message_id: row.message_id,
          mistake_type: row.mistake_type as Mistake["mistake_type"],
          what_went_wrong: row.what_went_wrong,
          correction: row.correction || undefined,
          user_correction_message: row.user_correction_message || undefined,
          files_affected: safeJsonParse<string[]>(row.files_affected, []),
          timestamp: row.timestamp,
        },
        conversation: {
          id: row.conv_id,
          project_path: row.project_path,
          first_message_at: row.first_message_at,
          last_message_at: row.last_message_at,
          message_count: row.message_count,
          git_branch: row.git_branch,
          claude_version: row.claude_version,
          metadata: safeJsonParse<Record<string, unknown>>(row.conv_metadata, {}),
          created_at: row.conv_created_at,
          updated_at: row.conv_updated_at,
        },
        similarity: 0.5,
      }));
    } catch (_e) {
      // FTS table may not exist, fall back to LIKE search
      console.error("Mistakes FTS not available, using LIKE search");

      const sql = `
        SELECT m.*, c.project_path, c.git_branch,
          c.id as conv_id, c.first_message_at, c.last_message_at,
          c.message_count, c.claude_version, c.metadata as conv_metadata,
          c.created_at as conv_created_at, c.updated_at as conv_updated_at
        FROM mistakes m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE m.what_went_wrong LIKE ? OR m.correction LIKE ?
        ORDER BY m.timestamp DESC
        LIMIT ?
      `;

      interface MistakeRowWithConv {
        id: string;
        conversation_id: string;
        message_id: string;
        mistake_type: string;
        what_went_wrong: string;
        correction: string | null;
        user_correction_message: string | null;
        files_affected: string;
        timestamp: number;
        project_path: string;
        git_branch: string;
        conv_id: string;
        first_message_at: number;
        last_message_at: number;
        message_count: number;
        claude_version: string;
        conv_metadata: string;
        conv_created_at: number;
        conv_updated_at: number;
      }

      const likeQuery = `%${query}%`;
      const rows = this.db.prepare(sql).all(likeQuery, likeQuery, limit) as MistakeRowWithConv[];

      return rows.map((row) => ({
        mistake: {
          id: row.id,
          conversation_id: row.conversation_id,
          message_id: row.message_id,
          mistake_type: row.mistake_type as Mistake["mistake_type"],
          what_went_wrong: row.what_went_wrong,
          correction: row.correction || undefined,
          user_correction_message: row.user_correction_message || undefined,
          files_affected: safeJsonParse<string[]>(row.files_affected, []),
          timestamp: row.timestamp,
        },
        conversation: {
          id: row.conv_id,
          project_path: row.project_path,
          first_message_at: row.first_message_at,
          last_message_at: row.last_message_at,
          message_count: row.message_count,
          git_branch: row.git_branch,
          claude_version: row.claude_version,
          metadata: safeJsonParse<Record<string, unknown>>(row.conv_metadata, {}),
          created_at: row.conv_created_at,
          updated_at: row.conv_updated_at,
        },
        similarity: 0.5,
      }));
    }
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
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
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
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
    };
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
