/**
 * Embedding Configuration Management
 * Loads config from file and environment variables (env vars take precedence)
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type EmbeddingProviderType = "ollama" | "transformers" | "openai";

export interface EmbeddingConfig {
  provider: EmbeddingProviderType;
  model: string;
  dimensions?: number; // Optional - can be auto-detected
  baseUrl?: string; // For Ollama
  apiKey?: string; // For OpenAI
}

export class ConfigLoader {
  private static readonly CONFIG_FILENAME = ".claude-memory-config.json";

  /**
   * Load configuration with precedence: env vars > project config > home config > defaults
   */
  static load(): EmbeddingConfig {
    // Start with defaults
    let config: EmbeddingConfig = {
      provider: "transformers",
      model: "Xenova/all-MiniLM-L6-v2",
      dimensions: 384,
    };

    // Try loading from home directory config
    const homeConfigPath = join(homedir(), this.CONFIG_FILENAME);
    if (existsSync(homeConfigPath)) {
      const homeConfig = this.loadConfigFile(homeConfigPath);
      if (homeConfig?.embedding) {
        config = { ...config, ...homeConfig.embedding };
      }
    }

    // Try loading from project config (overrides home config)
    const projectConfigPath = join(process.cwd(), this.CONFIG_FILENAME);
    if (existsSync(projectConfigPath)) {
      const projectConfig = this.loadConfigFile(projectConfigPath);
      if (projectConfig?.embedding) {
        config = { ...config, ...projectConfig.embedding };
      }
    }

    // Environment variables override everything
    if (process.env.EMBEDDING_PROVIDER) {
      config.provider = process.env.EMBEDDING_PROVIDER as EmbeddingProviderType;
    }

    if (process.env.EMBEDDING_MODEL) {
      config.model = process.env.EMBEDDING_MODEL;
    }

    if (process.env.EMBEDDING_DIMENSIONS) {
      config.dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS, 10);
    }

    if (process.env.EMBEDDING_BASE_URL) {
      config.baseUrl = process.env.EMBEDDING_BASE_URL;
    }

    if (process.env.OPENAI_API_KEY) {
      config.apiKey = process.env.OPENAI_API_KEY;
    }

    // Set provider-specific defaults
    config = this.applyProviderDefaults(config);

    return config;
  }

  /**
   * Load and parse config file
   */
  private static loadConfigFile(path: string): { embedding?: Partial<EmbeddingConfig> } | null {
    try {
      const content = readFileSync(path, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Warning: Could not load config file ${path}:`, error);
      return null;
    }
  }

  /**
   * Apply provider-specific defaults
   */
  private static applyProviderDefaults(config: EmbeddingConfig): EmbeddingConfig {
    switch (config.provider) {
      case "ollama":
        return {
          ...config,
          baseUrl: config.baseUrl || "http://localhost:11434",
          model: config.model || "mxbai-embed-large",
          dimensions: config.dimensions || 1024, // mxbai-embed-large default
        };

      case "openai":
        return {
          ...config,
          model: config.model || "text-embedding-3-small",
          dimensions: config.dimensions || 1536, // text-embedding-3-small default
        };

      case "transformers":
        return {
          ...config,
          model: config.model || "Xenova/all-MiniLM-L6-v2",
          dimensions: config.dimensions || 384,
        };

      default:
        return config;
    }
  }

  /**
   * Validate configuration
   */
  static validate(config: EmbeddingConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!["ollama", "transformers", "openai"].includes(config.provider)) {
      errors.push(
        `Invalid provider: ${config.provider}. Must be 'ollama', 'transformers', or 'openai'`
      );
    }

    if (!config.model || config.model.trim() === "") {
      errors.push("Model name is required");
    }

    if (config.provider === "openai" && !config.apiKey) {
      errors.push("OpenAI provider requires OPENAI_API_KEY environment variable or apiKey in config");
    }

    if (config.dimensions && (config.dimensions < 1 || config.dimensions > 10000)) {
      errors.push("Dimensions must be between 1 and 10000");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get example config for documentation
   */
  static getExampleConfig(): string {
    return JSON.stringify(
      {
        embedding: {
          provider: "ollama",
          model: "nomic-embed-text",
          baseUrl: "http://localhost:11434",
        },
      },
      null,
      2
    );
  }
}
