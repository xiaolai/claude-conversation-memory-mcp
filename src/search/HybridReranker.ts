/**
 * Hybrid Re-Ranker using Reciprocal Rank Fusion (RRF)
 * Combines vector search results with FTS5 results for better ranking
 */

/**
 * Configuration for hybrid re-ranking
 */
export interface RerankConfig {
  /** RRF constant k - higher values reduce the impact of rank differences (default: 60) */
  rrfK: number;

  /** Weight for vector search results (0-1, default: 0.7) */
  vectorWeight: number;

  /** Weight for FTS results (0-1, default: 0.3) */
  ftsWeight: number;

  /** Whether re-ranking is enabled */
  enabled: boolean;
}

export const DEFAULT_RERANK_CONFIG: RerankConfig = {
  rrfK: 60,
  vectorWeight: 0.7,
  ftsWeight: 0.3,
  enabled: true,
};

/**
 * Generic result with ID and score
 */
export interface RankableResult {
  id: number | string;
  score: number;
}

/**
 * Re-ranked result with combined score
 */
export interface RerankResult {
  id: number | string;
  combinedScore: number;
  vectorRank: number | null;
  ftsRank: number | null;
  vectorScore: number | null;
  ftsScore: number | null;
}

/**
 * Hybrid Re-Ranker class
 */
export class HybridReranker {
  private config: RerankConfig;

  constructor(config?: Partial<RerankConfig>) {
    this.config = { ...DEFAULT_RERANK_CONFIG, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): RerankConfig {
    return { ...this.config };
  }

  /**
   * Calculate RRF score for a given rank
   * Formula: 1 / (k + rank)
   */
  private calculateRrfScore(rank: number): number {
    return 1 / (this.config.rrfK + rank);
  }

  /**
   * Re-rank results using Reciprocal Rank Fusion
   * Combines vector search and FTS results for better overall ranking
   *
   * @param vectorResults - Results from vector/semantic search (sorted by similarity)
   * @param ftsResults - Results from full-text search (sorted by relevance)
   * @param limit - Maximum results to return
   */
  rerank(
    vectorResults: RankableResult[],
    ftsResults: RankableResult[],
    limit: number
  ): RerankResult[] {
    // If re-ranking is disabled, just return vector results
    if (!this.config.enabled) {
      return vectorResults.slice(0, limit).map((r, idx) => ({
        id: r.id,
        combinedScore: r.score,
        vectorRank: idx + 1,
        ftsRank: null,
        vectorScore: r.score,
        ftsScore: null,
      }));
    }

    // Build lookup maps for ranks
    const vectorRanks = new Map<number | string, { rank: number; score: number }>();
    const ftsRanks = new Map<number | string, { rank: number; score: number }>();

    vectorResults.forEach((result, idx) => {
      vectorRanks.set(result.id, { rank: idx + 1, score: result.score });
    });

    ftsResults.forEach((result, idx) => {
      ftsRanks.set(result.id, { rank: idx + 1, score: result.score });
    });

    // Collect all unique IDs
    const allIds = new Set<number | string>();
    for (const result of vectorResults) {
      allIds.add(result.id);
    }
    for (const result of ftsResults) {
      allIds.add(result.id);
    }

    // Calculate combined RRF scores
    const combinedResults: RerankResult[] = [];

    for (const id of allIds) {
      const vectorData = vectorRanks.get(id);
      const ftsData = ftsRanks.get(id);

      let combinedScore = 0;

      if (vectorData) {
        combinedScore += this.config.vectorWeight * this.calculateRrfScore(vectorData.rank);
      }

      if (ftsData) {
        combinedScore += this.config.ftsWeight * this.calculateRrfScore(ftsData.rank);
      }

      combinedResults.push({
        id,
        combinedScore,
        vectorRank: vectorData?.rank ?? null,
        ftsRank: ftsData?.rank ?? null,
        vectorScore: vectorData?.score ?? null,
        ftsScore: ftsData?.score ?? null,
      });
    }

    // Sort by combined score (descending)
    combinedResults.sort((a, b) => b.combinedScore - a.combinedScore);

    // Return top-K results
    return combinedResults.slice(0, limit);
  }

  /**
   * Re-rank with boosting for results that appear in both sources
   * Results in both vector and FTS get an extra boost
   *
   * @param vectorResults - Results from vector/semantic search
   * @param ftsResults - Results from full-text search
   * @param limit - Maximum results to return
   * @param overlapBoost - Extra score multiplier for overlapping results (default: 1.2)
   */
  rerankWithOverlapBoost(
    vectorResults: RankableResult[],
    ftsResults: RankableResult[],
    limit: number,
    overlapBoost: number = 1.2
  ): RerankResult[] {
    const results = this.rerank(vectorResults, ftsResults, limit);

    // Apply overlap boost
    for (const result of results) {
      if (result.vectorRank !== null && result.ftsRank !== null) {
        result.combinedScore *= overlapBoost;
      }
    }

    // Re-sort after boost
    results.sort((a, b) => b.combinedScore - a.combinedScore);

    return results;
  }
}

/**
 * Get or create a hybrid reranker with given config
 */
export function getHybridReranker(config?: Partial<RerankConfig>): HybridReranker {
  return new HybridReranker(config);
}

/**
 * Get rerank config from environment or defaults
 */
export function getRerankConfig(): RerankConfig {
  const config = { ...DEFAULT_RERANK_CONFIG };

  if (process.env.CCCMEMORY_RERANK_ENABLED !== undefined) {
    config.enabled = process.env.CCCMEMORY_RERANK_ENABLED === "true";
  }

  if (process.env.CCCMEMORY_RERANK_WEIGHT) {
    const weight = parseFloat(process.env.CCCMEMORY_RERANK_WEIGHT);
    if (!isNaN(weight) && weight >= 0 && weight <= 1) {
      config.vectorWeight = weight;
      config.ftsWeight = 1 - weight;
    }
  }

  if (process.env.CCCMEMORY_RRF_K) {
    const k = parseInt(process.env.CCCMEMORY_RRF_K, 10);
    if (!isNaN(k) && k > 0) {
      config.rrfK = k;
    }
  }

  return config;
}
