/**
 * Transformers.js Embeddings Provider
 * Uses @xenova/transformers for local, offline embeddings
 */

import type { EmbeddingProvider, ModelInfo } from "../EmbeddingProvider.js";

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

      console.log(`Loading embedding model: ${this.model}...`);
      this.pipeline = (await pipeline("feature-extraction", this.model)) as unknown as EmbeddingPipeline;

      this.available = true;
      console.log(`✓ Transformers.js embeddings ready (${this.model})`);
    } catch (error) {
      this.initializationError = error as Error;
      this.available = false;

      if ((error as Error).message.includes("Cannot find module")) {
        console.warn("⚠️ @xenova/transformers not installed");
        console.warn("   Install with: npm install @xenova/transformers");
      } else {
        console.warn("⚠️ Could not load embedding model:", (error as Error).message);
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

      console.log(
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
   * Get default dimensions for common transformer models
   */
  private getDefaultDimensions(model: string): number {
    const modelDimensions: Record<string, number> = {
      "Xenova/all-MiniLM-L6-v2": 384,
      "Xenova/all-mpnet-base-v2": 768,
      "Xenova/bge-small-en-v1.5": 384,
      "Xenova/bge-base-en-v1.5": 768,
    };

    return modelDimensions[model] || 384;
  }
}
