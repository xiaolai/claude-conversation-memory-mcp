/**
 * OpenAI Embeddings Provider
 * Uses OpenAI API for high-quality embeddings
 */

import type { EmbeddingProvider, ModelInfo } from "../EmbeddingProvider.js";

// Type for OpenAI client (dynamic import)
type OpenAIClient = {
  embeddings: {
    create: (params: {
      model: string;
      input: string | string[];
    }) => Promise<{
      data: Array<{ embedding: number[] }>;
    }>;
  };
};

export class OpenAIEmbeddings implements EmbeddingProvider {
  private client: OpenAIClient | null = null;
  private model: string;
  private dimensions: number;
  private apiKey: string;
  private available: boolean = false;
  private initializationError: Error | null = null;

  constructor(apiKey: string, model: string = "text-embedding-3-small", dimensions?: number) {
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions || this.getDefaultDimensions(model);
  }

  /**
   * Initialize OpenAI client
   */
  async initialize(): Promise<void> {
    try {
      if (!this.apiKey) {
        throw new Error("OpenAI API key required. Set OPENAI_API_KEY environment variable.");
      }

      // Dynamic import of OpenAI SDK (optional dependency)
      // @ts-expect-error - openai is an optional dependency
      const OpenAI = (await import("openai")).default;
      this.client = new OpenAI({
        apiKey: this.apiKey,
      }) as unknown as OpenAIClient;

      // Test the API key with a small request
      await this.client.embeddings.create({
        model: this.model,
        input: "test",
      });

      this.available = true;
      console.log(`✓ OpenAI embeddings ready (${this.model})`);
    } catch (error) {
      this.initializationError = error as Error;
      this.available = false;

      if ((error as Error).message.includes("Cannot find module")) {
        console.warn("⚠️ OpenAI SDK not installed");
        console.warn("   Install with: npm install openai");
      } else {
        console.warn("⚠️ OpenAI initialization failed:", (error as Error).message);
      }
    }
  }

  /**
   * Check if embeddings are available
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<Float32Array> {
    if (!this.available || !this.client) {
      throw new Error(
        `OpenAI embeddings not available: ${this.initializationError?.message || "Not initialized"}`
      );
    }

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
      });

      return new Float32Array(response.data[0].embedding);
    } catch (error) {
      console.error("Error generating embedding with OpenAI:", error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts (batched)
   * OpenAI supports batch requests natively
   */
  async embedBatch(texts: string[], batchSize: number = 100): Promise<Float32Array[]> {
    if (!this.available || !this.client) {
      throw new Error("OpenAI embeddings not initialized");
    }

    const embeddings: Float32Array[] = [];

    // OpenAI allows up to 2048 inputs per request, but we use smaller batches for reliability
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      console.log(
        `Generating embeddings for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)} (OpenAI)`
      );

      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: batch,
        });

        // Convert all embeddings in the batch
        const batchEmbeddings = response.data.map(
          (item) => new Float32Array(item.embedding)
        );

        embeddings.push(...batchEmbeddings);
      } catch (error) {
        console.error("Error in batch embedding:", error);
        throw error;
      }
    }

    return embeddings;
  }

  /**
   * Get model information
   */
  getModelInfo(): ModelInfo {
    return {
      provider: "openai",
      model: this.model,
      dimensions: this.dimensions,
      available: this.available,
    };
  }

  /**
   * Get default dimensions for OpenAI models
   */
  private getDefaultDimensions(model: string): number {
    const modelDimensions: Record<string, number> = {
      "text-embedding-3-small": 1536,
      "text-embedding-3-large": 3072,
      "text-embedding-ada-002": 1536,
    };

    return modelDimensions[model] || 1536;
  }
}
