/**
 * Transformers.js Embeddings Provider
 * Uses @xenova/transformers for local, offline embeddings
 */

import type { EmbeddingProvider, ModelInfo } from "../EmbeddingProvider.js";
import { getModelDimensions } from "../ModelRegistry.js";

// Type for the pipeline function from @xenova/transformers
type EmbeddingPipeline = ((text: string, options?: Record<string, unknown>) => Promise<Record<string, unknown>>) | null;

export class TransformersEmbeddings implements EmbeddingProvider {
  private pipeline: EmbeddingPipeline = null;
  private model: string;
  private dimensions: number;
  private available: boolean = false;
  private initializationError: Error | null = null;

  constructor(model: string = "Xenova/all-MiniLM-L6-v2", dimensions?: number) {
    this.model = model;
    this.dimensions = dimensions || this.getDefaultDimensions(model);
  }

  /**
   * Initialize the embedding pipeline
   */
  async initialize(): Promise<void> {
    if (this.available) {
      return;
    }

    try {
      // Try to import @xenova/transformers
      const { pipeline } = await import("@xenova/transformers");

      console.error(`Loading embedding model: ${this.model}...`);
      this.pipeline = (await pipeline("feature-extraction", this.model)) as unknown as EmbeddingPipeline;

      this.available = true;
      console.error(`✓ Transformers.js embeddings ready (${this.model})`);
    } catch (error) {
      this.initializationError = error as Error;
      this.available = false;

      if ((error as Error).message.includes("Cannot find module")) {
        console.error("⚠️ @xenova/transformers not installed");
        console.error("   Install with: npm install @xenova/transformers");
      } else {
        console.error("⚠️ Could not load embedding model:", (error as Error).message);
      }
    }
  }

  /**
   * Check if embeddings are available
   */
  isAvailable(): boolean {
    return this.available && this.pipeline !== null;
  }

  /**
   * Generate embedding for text
   */
  async embed(text: string): Promise<Float32Array> {
    if (!this.isAvailable()) {
      throw new Error(
        `Transformers embeddings not available: ${this.initializationError?.message || "Not initialized"}`
      );
    }

    if (!this.pipeline) {
      throw new Error("Pipeline not initialized");
    }

    try {
      // Generate embedding
      const output = await this.pipeline(text, {
        pooling: "mean",
        normalize: true,
      });

      // Extract the embedding array
      const embedding = (output as { data: number[] }).data;

      return new Float32Array(embedding);
    } catch (error) {
      console.error("Error generating embedding:", error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts (batched)
   */
  async embedBatch(texts: string[], batchSize: number = 32): Promise<Float32Array[]> {
    if (!this.isAvailable()) {
      throw new Error("Transformers embeddings not initialized");
    }

    const embeddings: Float32Array[] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      console.error(
        `Generating embeddings for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)} (Transformers.js)`
      );

      const batchEmbeddings = await Promise.all(
        batch.map((text) => this.embed(text))
      );

      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }

  /**
   * Get model information
   */
  getModelInfo(): ModelInfo {
    return {
      provider: "transformers",
      model: this.model,
      dimensions: this.dimensions,
      available: this.available,
    };
  }

  /**
   * Get default dimensions for common transformer models using ModelRegistry
   */
  private getDefaultDimensions(model: string): number {
    // Try to get dimensions from ModelRegistry
    const dimensions = getModelDimensions(model);
    if (dimensions) {
      return dimensions;
    }

    // Default to 384 if unknown (most common for small models)
    return 384;
  }
}
