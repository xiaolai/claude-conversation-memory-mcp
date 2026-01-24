/**
 * Search Module
 * Exports semantic search, re-ranking, aggregation, and snippet generation
 */

export { SemanticSearch } from "./SemanticSearch.js";
export type { SearchFilter, SearchResult, DecisionSearchResult, MistakeSearchResult } from "./SemanticSearch.js";

export { ResultAggregator, getResultAggregator } from "./ResultAggregator.js";
export type { AggregatedResult, ChunkMatch, AggregationConfig } from "./ResultAggregator.js";

export { HybridReranker, getHybridReranker, getRerankConfig } from "./HybridReranker.js";
export type { RerankConfig, RankableResult, RerankResult } from "./HybridReranker.js";

export { SnippetGenerator, getSnippetGenerator, generateSnippet } from "./SnippetGenerator.js";
export type { SnippetConfig, SnippetMatch } from "./SnippetGenerator.js";

export { QueryExpander, getQueryExpander, getExpansionConfig } from "./QueryExpander.js";
export type { QueryExpansionConfig } from "./QueryExpander.js";
