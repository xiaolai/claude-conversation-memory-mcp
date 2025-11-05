/**
 * Embedding Provider Interface
 * Defines the contract for all embedding implementations
 */

export interface ModelInfo {
  provider: string;
  model: string;
  dimensions: number;
  available: boolean;
}

export interface EmbeddingProvider {
  /**
   * Initialize the embedding provider
   * Should handle graceful failure if provider unavailable
   */
  initialize(): Promise<void>;

  /**
   * Check if embeddings are available
   */
  isAvailable(): boolean;

  /**
   * Generate embedding for a single text
   */
  embed(text: string): Promise<Float32Array>;

  /**
   * Generate embeddings for multiple texts (batched for efficiency)
   */
  embedBatch(texts: string[], batchSize?: number): Promise<Float32Array[]>;

  /**
   * Get information about the model being used
   */
  getModelInfo(): ModelInfo;
}
