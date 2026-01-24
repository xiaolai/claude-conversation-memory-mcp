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
import { getTextChunker, getChunkingConfig } from "../chunking/index.js";
import { ResultAggregator } from "./ResultAggregator.js";
import { HybridReranker, getRerankConfig } from "./HybridReranker.js";
import { SnippetGenerator } from "./SnippetGenerator.js";

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
   * Uses chunking for long messages that exceed the embedding model's token limit
   * @param messages - Messages to index
   * @param incremental - If true, skip messages that already have embeddings (default: true for fast re-indexing)
   */
  async indexMessages(
    messages: Array<{ id: number; content?: string }>,
    incremental: boolean = true
  ): Promise<void> {
    console.error(`Indexing ${messages.length} messages...`);

    const embedder = await getEmbeddingGenerator();

    if (!embedder.isAvailable()) {
      console.error("Embeddings not available - skipping indexing");
      return;
    }

    // Filter messages with content
    const messagesWithContent = messages.filter(
      (m): m is { id: number; content: string } => !!m.content && m.content.trim().length > 0
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

    // Get model name from embedder info
    const embedderInfo = EmbeddingGenerator.getInfo();
    const modelName = embedderInfo?.model || "all-MiniLM-L6-v2";

    // Check if chunking is enabled and supported
    const chunkingConfig = getChunkingConfig();
    const useChunking = chunkingConfig.enabled && this.vectorStore.hasChunkEmbeddingsTable();

    if (useChunking) {
      await this.indexMessagesWithChunking(messagesToIndex, embedder, modelName);
    } else {
      // Original behavior: embed full messages
      const texts = messagesToIndex.map((m) => m.content);
      const embeddings = await embedder.embedBatch(texts, 32);

      for (let i = 0; i < messagesToIndex.length; i++) {
        await this.vectorStore.storeMessageEmbedding(
          messagesToIndex[i].id,
          messagesToIndex[i].content,
          embeddings[i],
          modelName
        );
      }
    }

    console.error("✓ Indexing complete");
  }

  /**
   * Index messages using chunking for long content
   */
  private async indexMessagesWithChunking(
    messages: Array<{ id: number; content: string }>,
    embedder: Awaited<ReturnType<typeof getEmbeddingGenerator>>,
    modelName: string
  ): Promise<void> {
    const chunker = getTextChunker();
    let totalChunks = 0;
    let chunkedMessages = 0;

    // Process each message
    for (const message of messages) {
      const chunkResult = chunker.chunk(message.content);

      if (chunkResult.wasChunked) {
        // Message was chunked - store chunk embeddings
        chunkedMessages++;

        // Generate embeddings for all chunks
        const chunkTexts = chunkResult.chunks.map((c) => c.content);
        const chunkEmbeddings = await embedder.embedBatch(chunkTexts, 32);

        // Store chunk embeddings
        for (let i = 0; i < chunkResult.chunks.length; i++) {
          await this.vectorStore.storeChunkEmbedding({
            messageId: message.id,
            chunk: chunkResult.chunks[i],
            embedding: chunkEmbeddings[i],
            modelName,
          });
        }

        totalChunks += chunkResult.chunks.length;

        // Also store the first chunk as the "representative" message embedding
        // This ensures backwards compatibility with non-chunk-aware search
        await this.vectorStore.storeMessageEmbedding(
          message.id,
          chunkResult.chunks[0].content,
          chunkEmbeddings[0],
          modelName
        );
      } else {
        // Message fits in single embedding - use standard approach
        const embedding = await embedder.embed(message.content);
        await this.vectorStore.storeMessageEmbedding(
          message.id,
          message.content,
          embedding,
          modelName
        );
      }
    }

    if (chunkedMessages > 0) {
      console.error(`📦 Chunked ${chunkedMessages} long messages into ${totalChunks} chunks`);
    }
  }

  /**
   * Index decisions for semantic search
   * @param decisions - Decisions to index
   * @param incremental - If true, skip decisions that already have embeddings (default: true for fast re-indexing)
   */
  async indexDecisions(
    decisions: Array<{ id: number; decision_text: string; rationale?: string; context?: string | null }>,
    incremental: boolean = true
  ): Promise<void> {
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
      id: number;
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
  async indexMistakes(
    mistakes: Array<{ id: number; what_went_wrong: string; correction?: string | null; mistake_type: string }>,
    incremental: boolean = true
  ): Promise<void> {
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
      id: number;
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

    try {
      // Generate query embedding
      const queryEmbedding = await embedder.embed(query);
      this.vectorStore.prepareVecTables(queryEmbedding.length);
      // Use vec_distance_cosine for efficient ANN search with JOINs
      // Note: Must include byteOffset/byteLength in case Float32Array is a view
      const queryBuffer = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);

      const rows = this.db
        .prepare(
          `SELECT
            vec.id as vec_id,
            vec_distance_cosine(vec.embedding, ?) as distance,
            m.external_id as mistake_external_id,
            m.conversation_id,
            m.message_id,
            m.mistake_type,
            m.what_went_wrong,
            m.correction,
            m.user_correction_message,
            m.files_affected,
            m.timestamp,
            c.id as conv_id,
            c.external_id as conv_external_id,
            c.project_path,
            c.source_type,
            c.first_message_at,
            c.last_message_at,
            c.message_count,
            c.git_branch,
            c.claude_version,
            c.metadata as conv_metadata,
            c.created_at as conv_created_at,
            c.updated_at as conv_updated_at,
            msg.external_id as message_external_id
          FROM vec_mistake_embeddings vec
          JOIN mistake_embeddings me ON vec.id = me.id
          JOIN mistakes m ON me.mistake_id = m.id
          JOIN conversations c ON m.conversation_id = c.id
          LEFT JOIN messages msg ON m.message_id = msg.id
          ORDER BY distance
          LIMIT ?`
        )
        .all(queryBuffer, limit) as Array<{
        vec_id: string;
        distance: number;
        mistake_external_id: string;
        conversation_id: number;
        message_id: number;
        mistake_type: string;
        what_went_wrong: string;
        correction: string | null;
        user_correction_message: string | null;
        files_affected: string;
        timestamp: number;
        conv_id: number;
        conv_external_id: string;
        project_path: string;
        source_type: string;
        first_message_at: number;
        last_message_at: number;
        message_count: number;
        git_branch: string;
        claude_version: string;
        conv_metadata: string;
        conv_created_at: number;
        conv_updated_at: number;
        message_external_id: string | null;
      }>;

      // Fall back to FTS if vector search returned no results
      if (rows.length === 0) {
        if (process.env.NODE_ENV !== "test") {
          console.error("Vector search returned no mistake results - falling back to FTS");
        }
        return this.fallbackMistakeSearch(query, limit);
      }

      const results: MistakeSearchResult[] = [];
      for (const row of rows) {
        if (!row.message_external_id) {
          continue;
        }
        results.push({
          mistake: {
            id: row.mistake_external_id,
            conversation_id: row.conv_external_id,
            message_id: row.message_external_id,
            mistake_type: row.mistake_type as Mistake["mistake_type"],
            what_went_wrong: row.what_went_wrong,
            correction: row.correction || undefined,
            user_correction_message: row.user_correction_message || undefined,
            files_affected: safeJsonParse<string[]>(row.files_affected, []),
            timestamp: row.timestamp,
          },
          conversation: {
            id: row.conv_external_id,
            project_path: row.project_path,
            source_type: row.source_type as "claude-code" | "codex",
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
        });
      }
      return results;
    } catch (error) {
      // Fallback to text search if vec search fails
      const message = error instanceof Error ? error.message : String(error);
      if (
        process.env.NODE_ENV !== "test" &&
        !message.includes("no such table: vec_mistake_embeddings")
      ) {
        console.error("Vec mistake search failed, falling back to text search:", message);
      }
      return this.fallbackMistakeSearch(query, limit);
    }
  }

  /**
   * Search conversations using natural language query
   * Uses chunk search for better coverage of long messages
   * @param query - The search query text
   * @param limit - Maximum results to return
   * @param filter - Optional filter criteria
   * @param precomputedEmbedding - Optional pre-computed embedding to avoid re-embedding
   */
  async searchConversations(
    query: string,
    limit: number = 10,
    filter?: SearchFilter,
    precomputedEmbedding?: Float32Array
  ): Promise<SearchResult[]> {
    const embedder = await getEmbeddingGenerator();

    if (!embedder.isAvailable() && !precomputedEmbedding) {
      console.error("Embeddings not available - falling back to full-text search");
      return this.fallbackFullTextSearch(query, limit, filter);
    }

    try {
      // Use pre-computed embedding if provided, otherwise generate
      const queryEmbedding = precomputedEmbedding ?? await embedder.embed(query);

      // Check if chunk embeddings are available
      const useChunks = this.vectorStore.hasChunkEmbeddingsTable() &&
                        this.vectorStore.getChunkEmbeddingCount() > 0;

      let enrichedResults: SearchResult[] = [];

      if (useChunks) {
        // Use hybrid search: chunks + messages
        enrichedResults = await this.searchWithChunkAggregation(
          queryEmbedding,
          query,
          limit,
          filter
        );
      } else {
        // Original behavior: search message embeddings only
        const vectorResults = await this.vectorStore.searchMessages(
          queryEmbedding,
          limit * 2 // Get more results for filtering
        );

        for (const vecResult of vectorResults) {
          const message = this.getMessage(vecResult.id);
          if (!message) {continue;}

          // Apply filters
          if (filter) {
            if (!this.applyFilter(message, filter)) {continue;}
          }

          const conversation = this.getConversation(message.conversation_internal_id);
          if (!conversation) {continue;}

          enrichedResults.push({
            message,
            conversation,
            similarity: vecResult.similarity,
            snippet: this.generateSnippet(vecResult.content, query),
          });

          if (enrichedResults.length >= limit) {break;}
        }
      }

      // Fall back to FTS if vector search returned no results
      if (enrichedResults.length === 0) {
        if (process.env.NODE_ENV !== "test") {
          console.error("Vector search returned no results - falling back to FTS");
        }
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
   * Search using chunk aggregation for better coverage of long messages
   * Now includes hybrid re-ranking with FTS results
   */
  private async searchWithChunkAggregation(
    queryEmbedding: Float32Array,
    query: string,
    limit: number,
    filter?: SearchFilter
  ): Promise<SearchResult[]> {
    // Calculate dynamic similarity threshold
    const minSimilarity = this.calculateDynamicThreshold(query);

    // Search chunks with 3x limit for aggregation
    const chunkResults = await this.vectorStore.searchChunks(queryEmbedding, limit * 3);

    // Also search message embeddings for non-chunked messages
    const messageResults = await this.vectorStore.searchMessages(queryEmbedding, limit * 2);

    // Aggregate chunk results by message
    const aggregator = new ResultAggregator({
      minSimilarity,
      limit: limit * 2, // Get more for filtering/reranking
      deduplicate: true,
      deduplicationThreshold: 0.7,
    });

    const aggregatedChunks = aggregator.aggregate(chunkResults);

    // Merge with message results
    const mergedResults = aggregator.mergeResults(
      aggregatedChunks,
      messageResults.map((r) => ({
        messageId: r.id,
        content: r.content,
        similarity: r.similarity,
      }))
    );

    // Check if hybrid re-ranking is enabled
    const rerankConfig = getRerankConfig();

    let rankedResults: Array<{ messageId: number; similarity: number; snippet: string }>;

    if (rerankConfig.enabled) {
      // Get FTS results for re-ranking
      const ftsMessageIds = this.getFtsMessageIds(query, limit * 2, filter);

      if (ftsMessageIds.length > 0) {
        // Create reranker
        const reranker = new HybridReranker(rerankConfig);

        // Prepare results for reranking
        const vectorRankable = mergedResults.map((r) => ({
          id: r.messageId,
          score: r.similarity,
        }));

        const ftsRankable = ftsMessageIds.map((r, idx) => ({
          id: r.id,
          score: 1 / (idx + 1), // Convert rank to score
        }));

        // Apply RRF
        const reranked = reranker.rerankWithOverlapBoost(
          vectorRankable,
          ftsRankable,
          limit * 2
        );

        // Map reranked results back to our format
        const resultMap = new Map(
          mergedResults.map((r) => [r.messageId, r])
        );

        rankedResults = reranked
          .map((rr) => {
            const original = resultMap.get(rr.id as number);
            if (original) {
              return {
                messageId: original.messageId,
                similarity: rr.combinedScore,
                snippet: original.bestSnippet,
              };
            }
            // FTS-only result - need to fetch content
            return {
              messageId: rr.id as number,
              similarity: rr.combinedScore,
              snippet: "", // Will be filled later
            };
          })
          .filter((r) => r !== null);
      } else {
        // No FTS results, use vector-only
        rankedResults = mergedResults.map((r) => ({
          messageId: r.messageId,
          similarity: r.similarity,
          snippet: r.bestSnippet,
        }));
      }
    } else {
      // Re-ranking disabled, use merged results directly
      rankedResults = mergedResults.map((r) => ({
        messageId: r.messageId,
        similarity: r.similarity,
        snippet: r.bestSnippet,
      }));
    }

    // Enrich with message and conversation data
    const enrichedResults: SearchResult[] = [];

    for (const result of rankedResults) {
      const message = this.getMessage(result.messageId);
      if (!message) {continue;}

      // Apply filters
      if (filter) {
        if (!this.applyFilter(message, filter)) {continue;}
      }

      const conversation = this.getConversation(message.conversation_internal_id);
      if (!conversation) {continue;}

      // If snippet is empty (FTS-only result), generate it
      const snippet = result.snippet || message.content || "";

      enrichedResults.push({
        message,
        conversation,
        similarity: result.similarity,
        snippet: this.generateSnippet(snippet, query),
      });

      if (enrichedResults.length >= limit) {break;}
    }

    return enrichedResults;
  }

  /**
   * Get message IDs from FTS search (for re-ranking)
   */
  private getFtsMessageIds(
    query: string,
    limit: number,
    filter?: SearchFilter
  ): Array<{ id: number; content: string }> {
    const ftsQuery = this.sanitizeFtsQuery(query);

    try {
      let sql = `
        SELECT m.id, m.content
        FROM messages m
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
          sql += " AND m.conversation_id IN (SELECT id FROM conversations WHERE external_id = ?)";
          params.push(filter.conversation_id);
        }
      }

      sql += " ORDER BY m.timestamp DESC LIMIT ?";
      params.push(limit);

      const rows = this.db.prepare(sql).all(...params) as Array<{
        id: number;
        content: string;
      }>;

      return rows;
    } catch (_e) {
      // FTS might not be available
      return [];
    }
  }

  /**
   * Calculate dynamic similarity threshold based on query length
   * Longer queries should have higher thresholds (more context = better matching)
   */
  private calculateDynamicThreshold(query: string): number {
    const baseThreshold = 0.30;
    const maxThreshold = 0.55;
    const words = query.trim().split(/\s+/).length;

    // Add 0.01 per word, capped at maxThreshold
    return Math.min(baseThreshold + words * 0.01, maxThreshold);
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

    try {
      // Generate query embedding
      const queryEmbedding = await embedder.embed(query);
      this.vectorStore.prepareVecTables(queryEmbedding.length);
      // Use vec_distance_cosine for efficient ANN search with JOINs to avoid N+1 queries
      // Note: Must include byteOffset/byteLength in case Float32Array is a view
      const queryBuffer = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);

      const rows = this.db
        .prepare(
          `SELECT
            vec.id as vec_id,
            vec_distance_cosine(vec.embedding, ?) as distance,
            d.external_id as decision_external_id,
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
            c.external_id as conv_external_id,
            c.project_path,
            c.source_type,
            c.first_message_at,
            c.last_message_at,
            c.message_count,
            c.git_branch,
            c.claude_version,
            c.metadata as conv_metadata,
            c.created_at as conv_created_at,
            c.updated_at as conv_updated_at,
            m.external_id as message_external_id
          FROM vec_decision_embeddings vec
          JOIN decision_embeddings de ON vec.id = de.id
          JOIN decisions d ON de.decision_id = d.id
          JOIN conversations c ON d.conversation_id = c.id
          LEFT JOIN messages m ON d.message_id = m.id
          ORDER BY distance
          LIMIT ?`
        )
        .all(queryBuffer, limit) as Array<{
        vec_id: string;
        distance: number;
        decision_external_id: string;
        conversation_id: number;
        message_id: number;
        decision_text: string;
        rationale: string;
        alternatives_considered: string;
        rejected_reasons: string;
        context: string;
        related_files: string;
        related_commits: string;
        timestamp: number;
        conv_id: number;
        conv_external_id: string;
        project_path: string;
        source_type: string;
        first_message_at: number;
        last_message_at: number;
        message_count: number;
        git_branch: string;
        claude_version: string;
        conv_metadata: string;
        conv_created_at: number;
        conv_updated_at: number;
        message_external_id: string | null;
      }>;

      // Fall back to FTS if vector search returned no results
      if (rows.length === 0) {
        if (process.env.NODE_ENV !== "test") {
          console.error("Vector search returned no decision results - falling back to FTS");
        }
        return this.fallbackDecisionSearch(query, limit);
      }

      const results: DecisionSearchResult[] = [];
      for (const row of rows) {
        if (!row.message_external_id) {
          continue;
        }
        results.push({
          decision: {
            id: row.decision_external_id,
            conversation_id: row.conv_external_id,
            message_id: row.message_external_id,
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
            id: row.conv_external_id,
            project_path: row.project_path,
            source_type: row.source_type as "claude-code" | "codex",
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
        });
      }
      return results;
    } catch (error) {
      // Fallback to text search if vec search fails (e.g., table doesn't exist)
      const message = error instanceof Error ? error.message : String(error);
      if (
        process.env.NODE_ENV !== "test" &&
        !message.includes("no such table: vec_decision_embeddings")
      ) {
        console.error("Vec decision search failed, falling back to text search:", message);
      }
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

    interface JoinedRow {
      internal_message_id: number;
      message_external_id: string;
      parent_external_id?: string | null;
      message_type: string;
      role?: string;
      content?: string;
      timestamp: number;
      is_sidechain: number;
      agent_id?: string;
      request_id?: string;
      git_branch?: string;
      cwd?: string;
      metadata: string;
      conv_internal_id: number;
      conv_external_id: string;
      project_path: string;
      first_message_at: number;
      last_message_at: number;
      conv_message_count: number;
      conv_git_branch?: string;
      claude_version?: string;
      conv_metadata: string;
      conv_created_at: number;
      conv_updated_at: number;
    }

    const mapRowToResult = (row: JoinedRow): SearchResult => {
      const conversation = {
        id: row.conv_external_id,
        project_path: row.project_path,
        first_message_at: row.first_message_at,
        last_message_at: row.last_message_at,
        message_count: row.conv_message_count,
        git_branch: row.conv_git_branch,
        claude_version: row.claude_version,
        metadata: safeJsonParse<Record<string, unknown>>(row.conv_metadata, {}),
        created_at: row.conv_created_at,
        updated_at: row.conv_updated_at,
      };

      return {
        message: {
          id: row.message_external_id,
          conversation_id: row.conv_external_id,
          parent_id: row.parent_external_id ?? undefined,
          message_type: row.message_type,
          role: row.role,
          content: row.content,
          timestamp: row.timestamp,
          is_sidechain: Boolean(row.is_sidechain),
          agent_id: row.agent_id,
          request_id: row.request_id,
          git_branch: row.git_branch,
          cwd: row.cwd,
          metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
        } as Message,
        conversation,
        similarity: 0.5, // Default similarity for FTS/LIKE
        snippet: this.generateSnippet(row.content || "", query),
      };
    };

    // Try FTS first, fall back to LIKE if FTS fails
    try {
      let sql = `
        SELECT
          m.id as internal_message_id,
          m.external_id as message_external_id,
          m.parent_external_id,
          m.message_type,
          m.role,
          m.content,
          m.timestamp,
          m.is_sidechain,
          m.agent_id,
          m.request_id,
          m.git_branch,
          m.cwd,
          m.metadata,
          c.id as conv_internal_id,
          c.external_id as conv_external_id,
          c.project_path,
          c.first_message_at,
          c.last_message_at,
          c.message_count as conv_message_count,
          c.git_branch as conv_git_branch,
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
          sql += " AND c.external_id = ?";
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
        SELECT
          m.id as internal_message_id,
          m.external_id as message_external_id,
          m.parent_external_id,
          m.message_type,
          m.role,
          m.content,
          m.timestamp,
          m.is_sidechain,
          m.agent_id,
          m.request_id,
          m.git_branch,
          m.cwd,
          m.metadata,
          c.id as conv_internal_id,
          c.external_id as conv_external_id,
          c.project_path,
          c.first_message_at,
          c.last_message_at,
          c.message_count as conv_message_count,
          c.git_branch as conv_git_branch,
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
          sql += " AND c.external_id = ?";
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

    const mapRowToResult = (
      row: DecisionRow & { message_external_id: string }
    ): DecisionSearchResult => {
      const conversation = this.getConversation(row.conversation_id);
      if (!conversation) {
        console.error(`Warning: Conversation ${row.conversation_id} not found for decision ${row.id}`);
        throw new Error(`Data integrity error: Conversation ${row.conversation_id} not found`);
      }

      return {
        decision: {
          id: row.external_id,
          conversation_id: conversation.id,
          message_id: row.message_external_id,
          decision_text: row.decision_text,
          rationale: row.rationale,
          alternatives_considered: safeJsonParse<string[]>(row.alternatives_considered, []),
          rejected_reasons: safeJsonParse<Record<string, string>>(row.rejected_reasons, {}),
          context: row.context,
          related_files: safeJsonParse<string[]>(row.related_files, []),
          related_commits: safeJsonParse<string[]>(row.related_commits, []),
          timestamp: row.timestamp,
        } as Decision,
        conversation,
        similarity: 0.5,
      };
    };

    // Try FTS first, fall back to LIKE if FTS fails
    try {
      const sql = `
        SELECT d.*, m.external_id as message_external_id
        FROM decisions d
        LEFT JOIN messages m ON d.message_id = m.id
        WHERE d.id IN (
          SELECT id FROM decisions_fts WHERE decisions_fts MATCH ?
        )
        ORDER BY d.timestamp DESC
        LIMIT ?
      `;

      const rows = this.db.prepare(sql).all(ftsQuery, limit) as Array<DecisionRow & { message_external_id?: string | null }>;
      const filteredRows = rows.filter(
        (row): row is DecisionRow & { message_external_id: string } => Boolean(row.message_external_id)
      );
      return filteredRows.map(mapRowToResult);
    } catch (_e) {
      // FTS table may not exist or be corrupted, fall back to LIKE search
      console.error("Decisions FTS not available, using LIKE search");

      const sql = `
        SELECT d.*, m.external_id as message_external_id
        FROM decisions d
        LEFT JOIN messages m ON d.message_id = m.id
        WHERE d.decision_text LIKE ? OR d.rationale LIKE ? OR d.context LIKE ?
        ORDER BY d.timestamp DESC
        LIMIT ?
      `;

      const likeQuery = `%${query}%`;
      const rows = this.db
        .prepare(sql)
        .all(likeQuery, likeQuery, likeQuery, limit) as Array<DecisionRow & { message_external_id?: string | null }>;
      const filteredRows = rows.filter(
        (row): row is DecisionRow & { message_external_id: string } => Boolean(row.message_external_id)
      );
      return filteredRows.map(mapRowToResult);
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
        SELECT
          m.id,
          m.external_id as mistake_external_id,
          m.conversation_id,
          m.message_id,
          m.mistake_type,
          m.what_went_wrong,
          m.correction,
          m.user_correction_message,
          m.files_affected,
          m.timestamp,
          c.external_id as conv_external_id,
          c.project_path,
          c.git_branch,
          c.first_message_at,
          c.last_message_at,
          c.message_count,
          c.claude_version,
          c.metadata as conv_metadata,
          c.created_at as conv_created_at,
          c.updated_at as conv_updated_at,
          msg.external_id as message_external_id
        FROM mistakes m
        JOIN conversations c ON m.conversation_id = c.id
        LEFT JOIN messages msg ON m.message_id = msg.id
        WHERE m.id IN (
          SELECT id FROM mistakes_fts WHERE mistakes_fts MATCH ?
        )
        ORDER BY m.timestamp DESC
        LIMIT ?
      `;

      interface MistakeRowWithConv {
        id: number;
        mistake_external_id: string;
        conversation_id: number;
        message_id: number;
        mistake_type: string;
        what_went_wrong: string;
        correction: string | null;
        user_correction_message: string | null;
        files_affected: string;
        timestamp: number;
        project_path: string;
        git_branch: string;
        conv_external_id: string;
        first_message_at: number;
        last_message_at: number;
        message_count: number;
        claude_version: string;
        conv_metadata: string;
        conv_created_at: number;
        conv_updated_at: number;
        message_external_id: string | null;
      }

      const rows = this.db.prepare(sql).all(ftsQuery, limit) as MistakeRowWithConv[];

      const results: MistakeSearchResult[] = [];
      for (const row of rows) {
        if (!row.message_external_id) {
          continue;
        }
        results.push({
          mistake: {
            id: row.mistake_external_id,
            conversation_id: row.conv_external_id,
            message_id: row.message_external_id,
            mistake_type: row.mistake_type as Mistake["mistake_type"],
            what_went_wrong: row.what_went_wrong,
            correction: row.correction || undefined,
            user_correction_message: row.user_correction_message || undefined,
            files_affected: safeJsonParse<string[]>(row.files_affected, []),
            timestamp: row.timestamp,
          },
          conversation: {
            id: row.conv_external_id,
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
        });
      }
      return results;
    } catch (_e) {
      // FTS table may not exist, fall back to LIKE search
      console.error("Mistakes FTS not available, using LIKE search");

      const sql = `
        SELECT
          m.id,
          m.external_id as mistake_external_id,
          m.conversation_id,
          m.message_id,
          m.mistake_type,
          m.what_went_wrong,
          m.correction,
          m.user_correction_message,
          m.files_affected,
          m.timestamp,
          c.external_id as conv_external_id,
          c.project_path,
          c.git_branch,
          c.first_message_at,
          c.last_message_at,
          c.message_count,
          c.claude_version,
          c.metadata as conv_metadata,
          c.created_at as conv_created_at,
          c.updated_at as conv_updated_at,
          msg.external_id as message_external_id
        FROM mistakes m
        JOIN conversations c ON m.conversation_id = c.id
        LEFT JOIN messages msg ON m.message_id = msg.id
        WHERE m.what_went_wrong LIKE ? OR m.correction LIKE ?
        ORDER BY m.timestamp DESC
        LIMIT ?
      `;

      interface MistakeRowWithConv {
        id: number;
        mistake_external_id: string;
        conversation_id: number;
        message_id: number;
        mistake_type: string;
        what_went_wrong: string;
        correction: string | null;
        user_correction_message: string | null;
        files_affected: string;
        timestamp: number;
        project_path: string;
        git_branch: string;
        conv_external_id: string;
        first_message_at: number;
        last_message_at: number;
        message_count: number;
        claude_version: string;
        conv_metadata: string;
        conv_created_at: number;
        conv_updated_at: number;
        message_external_id: string | null;
      }

      const likeQuery = `%${query}%`;
      const rows = this.db.prepare(sql).all(likeQuery, likeQuery, limit) as MistakeRowWithConv[];

      const results: MistakeSearchResult[] = [];
      for (const row of rows) {
        if (!row.message_external_id) {
          continue;
        }
        results.push({
          mistake: {
            id: row.mistake_external_id,
            conversation_id: row.conv_external_id,
            message_id: row.message_external_id,
            mistake_type: row.mistake_type as Mistake["mistake_type"],
            what_went_wrong: row.what_went_wrong,
            correction: row.correction || undefined,
            user_correction_message: row.user_correction_message || undefined,
            files_affected: safeJsonParse<string[]>(row.files_affected, []),
            timestamp: row.timestamp,
          },
          conversation: {
            id: row.conv_external_id,
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
        });
      }
      return results;
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
   * Snippet generator instance
   */
  private snippetGenerator: SnippetGenerator = new SnippetGenerator();

  /**
   * Generate snippet from content using advanced snippet generation
   */
  private generateSnippet(content: string, query: string, _length: number = 150): string {
    return this.snippetGenerator.generate(content, query);
  }

  /**
   * Get message by ID
   */
  private getMessage(id: number): (Message & { conversation_internal_id: number }) | null {
    const row = this.db
      .prepare(
        `SELECT
           m.id,
           m.external_id,
           m.conversation_id,
           c.external_id as conversation_external_id,
           m.parent_message_id,
           m.parent_external_id,
           m.message_type,
           m.role,
           m.content,
           m.timestamp,
           m.is_sidechain,
           m.agent_id,
           m.request_id,
           m.git_branch,
           m.cwd,
           m.metadata
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.id = ?`
      )
      .get(id) as (MessageRow & { conversation_external_id: string }) | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.external_id,
      conversation_id: row.conversation_external_id,
      parent_id: row.parent_external_id ?? undefined,
      message_type: row.message_type,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      is_sidechain: Boolean(row.is_sidechain),
      agent_id: row.agent_id,
      request_id: row.request_id,
      git_branch: row.git_branch,
      cwd: row.cwd,
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
      conversation_internal_id: row.conversation_id,
    } as Message & { conversation_internal_id: number };
  }

  /**
   * Get conversation by ID
   */
  private getConversation(id: number): Conversation | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          external_id,
          project_path,
          source_type,
          first_message_at,
          last_message_at,
          message_count,
          git_branch,
          claude_version,
          metadata,
          created_at,
          updated_at
        FROM conversations WHERE id = ?`
      )
      .get(id) as ConversationRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.external_id,
      project_path: row.project_path,
      source_type: row.source_type as 'claude-code' | 'codex',
      first_message_at: row.first_message_at,
      last_message_at: row.last_message_at,
      message_count: row.message_count,
      git_branch: row.git_branch,
      claude_version: row.claude_version,
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
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
