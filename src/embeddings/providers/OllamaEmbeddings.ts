/**
 * Ollama Embeddings Provider
 * Uses local Ollama API for embeddings
 */

import type { EmbeddingProvider, ModelInfo } from "../EmbeddingProvider.js";

interface OllamaEmbeddingResponse {
  embedding: number[];
}

export class OllamaEmbeddings implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;
  private dimensions: number;
  private available: boolean = false;
  private initializationError: Error | null = null;

  constructor(baseUrl: string = "http://localhost:11434", model: string = "mxbai-embed-large", dimensions?: number) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.model = model;
    this.dimensions = dimensions || this.getDefaultDimensions(model);
  }

  /**
   * Initialize by checking if Ollama is available
   */
  async initialize(): Promise<void> {
    try {
      // Check if Ollama is running
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(`Ollama API returned ${response.status}`);
      }

      // Check if model is available
      const data = (await response.json()) as { models: Array<{ name: string }> };
      const hasModel = data.models.some((m) => m.name.includes(this.model));

      if (!hasModel) {
        console.warn(
          `⚠️ Model '${this.model}' not found in Ollama. Available models: ${data.models.map((m) => m.name).join(", ")}`
        );
        console.warn(`   Pull the model with: ollama pull ${this.model}`);
        throw new Error(`Model ${this.model} not available in Ollama`);
      }

      this.available = true;
      console.log(`✓ Ollama embeddings ready (${this.model})`);
    } catch (error) {
      this.initializationError = error as Error;
      this.available = false;
      console.warn("⚠️ Ollama not available:", (error as Error).message);
      console.warn("   Make sure Ollama is running: ollama serve");
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
    if (!this.available) {
      throw new Error(
        `Ollama embeddings not available: ${this.initializationError?.message || "Not initialized"}`
      );
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as OllamaEmbeddingResponse;
      return new Float32Array(data.embedding);
    } catch (error) {
      console.error("Error generating embedding with Ollama:", error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts (batched)
   */
  async embedBatch(texts: string[], batchSize: number = 32): Promise<Float32Array[]> {
    if (!this.available) {
      throw new Error("Ollama embeddings not initialized");
    }

    const embeddings: Float32Array[] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      console.log(
        `Generating embeddings for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)} (Ollama)`
      );

      // Ollama doesn't have batch endpoint, so we do parallel requests
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
      provider: "ollama",
      model: this.model,
      dimensions: this.dimensions,
      available: this.available,
    };
  }

  /**
   * Get default dimensions for common Ollama models
   */
  private getDefaultDimensions(model: string): number {
    // Common Ollama embedding models and their dimensions
    const modelDimensions: Record<string, number> = {
      "nomic-embed-text": 768,
      "mxbai-embed-large": 1024,
      "all-minilm": 384,
      "snowflake-arctic-embed": 1024,
    };

    // Check if model name contains any known model
    for (const [knownModel, dims] of Object.entries(modelDimensions)) {
      if (model.includes(knownModel)) {
        return dims;
      }
    }

    // Default to 768 if unknown (most common)
    console.warn(
      `Unknown model dimensions for '${model}', defaulting to 768. Specify dimensions in config if different.`
    );
    return 768;
  }
}
