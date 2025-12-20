/**
 * Embedding Generator Factory
 * Creates appropriate embedding provider based on configuration
 */

import type { EmbeddingProvider } from "./EmbeddingProvider.js";
import { ConfigLoader } from "./EmbeddingConfig.js";
import { OllamaEmbeddings } from "./providers/OllamaEmbeddings.js";
import { OpenAIEmbeddings } from "./providers/OpenAIEmbeddings.js";
import { TransformersEmbeddings } from "./providers/TransformersEmbeddings.js";

/**
 * Factory class for creating embedding providers
 */
export class EmbeddingGenerator {
  private static instance: EmbeddingProvider | null = null;

  /**
   * Get or create embedding provider based on configuration
   */
  static async getProvider(): Promise<EmbeddingProvider> {
    if (this.instance) {
      return this.instance;
    }

    // Load configuration
    const config = ConfigLoader.load();

    // Validate configuration
    const validation = ConfigLoader.validate(config);
    if (!validation.valid) {
      console.warn("⚠️ Invalid embedding configuration:");
      validation.errors.forEach((error) => console.warn(`   - ${error}`));
      console.warn("   Falling back to auto-detection...");
    }

    // Try to create provider based on config (or auto-detect)
    let provider: EmbeddingProvider;

    if (validation.valid) {
      console.log(`Attempting to use ${config.provider} embeddings...`);
      provider = this.createProvider(config.provider, config);
    } else {
      // Auto-detect: try providers in order of preference
      console.log("Auto-detecting available embedding provider...");
      provider = await this.autoDetectProvider();
    }

    // Initialize the provider
    await provider.initialize();

    // If provider is not available, try fallback
    if (!provider.isAvailable()) {
      console.warn(`⚠️ ${config.provider} provider not available, trying fallback...`);
      provider = await this.autoDetectProvider();
      await provider.initialize();
    }

    this.instance = provider;
    return provider;
  }

  /**
   * Create specific provider instance
   */
  private static createProvider(type: string, config: { model: string; baseUrl?: string; apiKey?: string; dimensions?: number }): EmbeddingProvider {
    switch (type) {
      case "ollama":
        return new OllamaEmbeddings(
          config.baseUrl || "http://localhost:11434",
          config.model,
          config.dimensions
        );

      case "openai":
        return new OpenAIEmbeddings(
          config.apiKey || "",
          config.model,
          config.dimensions
        );

      case "transformers":
        return new TransformersEmbeddings(
          config.model,
          config.dimensions
        );

      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }

  /**
   * Auto-detect best available provider
   * Tries in order: Transformers.js (bundled, reliable) → Ollama (fast if running)
   */
  private static async autoDetectProvider(): Promise<EmbeddingProvider> {
    // Try Transformers.js first (bundled dependency, always works offline)
    const transformers = new TransformersEmbeddings();
    await transformers.initialize();
    if (transformers.isAvailable()) {
      console.log("✓ Auto-detected: Using Transformers.js embeddings");
      return transformers;
    }

    // Try Ollama as fallback (requires Ollama to be running)
    const ollama = new OllamaEmbeddings();
    await ollama.initialize();
    if (ollama.isAvailable()) {
      console.log("✓ Auto-detected: Using Ollama embeddings");
      return ollama;
    }

    // No provider available - return transformers as placeholder
    // It will fail gracefully when used, falling back to FTS
    console.warn("⚠️ No embedding provider available");
    console.warn("   Options:");
    console.warn("   1. Ensure @xenova/transformers is properly installed");
    console.warn("   2. Install Ollama: https://ollama.com");
    console.warn("   3. Configure OpenAI: Set OPENAI_API_KEY environment variable");
    console.warn("   Falling back to full-text search only.");

    return transformers; // Return uninitialized provider (will fail gracefully)
  }

  /**
   * Reset singleton (useful for testing)
   */
  static reset(): void {
    this.instance = null;
  }

  /**
   * Get current provider info (if initialized)
   */
  static getInfo(): { provider: string; model: string; available: boolean } | null {
    if (!this.instance) {
      return null;
    }

    const info = this.instance.getModelInfo();
    return {
      provider: info.provider,
      model: info.model,
      available: info.available,
    };
  }
}

/**
 * Legacy API compatibility - returns provider instance
 */
export async function getEmbeddingGenerator(): Promise<EmbeddingProvider> {
  return EmbeddingGenerator.getProvider();
}

/**
 * Legacy API compatibility - resets singleton
 */
export function resetEmbeddingGenerator(): void {
  EmbeddingGenerator.reset();
}
