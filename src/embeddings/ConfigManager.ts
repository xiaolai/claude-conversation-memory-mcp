/**
 * Configuration Manager for CLI
 * Handles reading and writing embedding configuration
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { ConfigLoader, EmbeddingConfig, EmbeddingProviderType } from "./EmbeddingConfig.js";

export class ConfigManager {
  private static readonly CONFIG_FILENAME = ".claude-memory-config.json";

  /**
   * Get current effective configuration (after all precedence rules)
   */
  static getCurrentConfig(): EmbeddingConfig {
    return ConfigLoader.load();
  }

  /**
   * Get configuration sources breakdown
   */
  static getConfigSources(): {
    home: Partial<EmbeddingConfig> | null;
    project: Partial<EmbeddingConfig> | null;
    env: Partial<EmbeddingConfig>;
    effective: EmbeddingConfig;
  } {
    const homeConfigPath = join(homedir(), this.CONFIG_FILENAME);
    const projectConfigPath = join(process.cwd(), this.CONFIG_FILENAME);

    const homeConfig = existsSync(homeConfigPath)
      ? this.loadConfigFile(homeConfigPath)?.embedding || null
      : null;

    const projectConfig = existsSync(projectConfigPath)
      ? this.loadConfigFile(projectConfigPath)?.embedding || null
      : null;

    const envConfig: Partial<EmbeddingConfig> = {};
    if (process.env.EMBEDDING_PROVIDER) {
      envConfig.provider = process.env.EMBEDDING_PROVIDER as EmbeddingProviderType;
    }
    if (process.env.EMBEDDING_MODEL) {
      envConfig.model = process.env.EMBEDDING_MODEL;
    }
    if (process.env.EMBEDDING_DIMENSIONS) {
      envConfig.dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS, 10);
    }
    if (process.env.EMBEDDING_BASE_URL) {
      envConfig.baseUrl = process.env.EMBEDDING_BASE_URL;
    }
    if (process.env.OPENAI_API_KEY) {
      envConfig.apiKey = process.env.OPENAI_API_KEY;
    }

    return {
      home: homeConfig,
      project: projectConfig,
      env: envConfig,
      effective: ConfigLoader.load(),
    };
  }

  /**
   * Get a specific config value
   */
  static getConfigValue(key: string): unknown {
    const config = this.getCurrentConfig();

    switch (key) {
      case "provider":
        return config.provider;
      case "model":
        return config.model;
      case "dimensions":
        return config.dimensions;
      case "baseUrl":
      case "base_url":
        return config.baseUrl;
      case "apiKey":
      case "api_key":
        return config.apiKey;
      default:
        throw new Error(`Unknown config key: ${key}. Valid keys: provider, model, dimensions, baseUrl, apiKey`);
    }
  }

  /**
   * Set a config value (writes to home config file)
   */
  static setConfigValue(key: string, value: string): void {
    const homeConfigPath = join(homedir(), this.CONFIG_FILENAME);

    // Load existing config or create new one
    let config: { embedding: Partial<EmbeddingConfig> } = { embedding: {} };
    if (existsSync(homeConfigPath)) {
      const existing = this.loadConfigFile(homeConfigPath);
      if (existing && existing.embedding) {
        config = { embedding: existing.embedding };
      }
    }

    // Ensure embedding object exists
    if (!config.embedding) {
      config.embedding = {};
    }

    // Set the value with type conversion
    switch (key) {
      case "provider":
        if (!["ollama", "transformers", "openai"].includes(value)) {
          throw new Error(`Invalid provider: ${value}. Must be 'ollama', 'transformers', or 'openai'`);
        }
        config.embedding.provider = value as EmbeddingProviderType;
        break;

      case "model":
        if (!value || value.trim() === "") {
          throw new Error("Model name cannot be empty");
        }
        config.embedding.model = value;
        break;

      case "dimensions":
        const dims = parseInt(value, 10);
        if (isNaN(dims) || dims < 1 || dims > 10000) {
          throw new Error("Dimensions must be a number between 1 and 10000");
        }
        config.embedding.dimensions = dims;
        break;

      case "baseUrl":
      case "base_url":
        config.embedding.baseUrl = value;
        break;

      case "apiKey":
      case "api_key":
        config.embedding.apiKey = value;
        break;

      default:
        throw new Error(`Unknown config key: ${key}. Valid keys: provider, model, dimensions, baseUrl, apiKey`);
    }

    // Write config file
    try {
      writeFileSync(homeConfigPath, JSON.stringify(config, null, 2), "utf-8");
    } catch (error) {
      throw new Error(`Failed to write config file: ${(error as Error).message}`);
    }
  }

  /**
   * Get config file path (home directory)
   */
  static getConfigPath(): string {
    return join(homedir(), this.CONFIG_FILENAME);
  }

  /**
   * Check if config file exists
   */
  static configExists(): boolean {
    return existsSync(this.getConfigPath());
  }

  /**
   * Load config file
   */
  private static loadConfigFile(path: string): { embedding?: Partial<EmbeddingConfig> } | null {
    try {
      const content = readFileSync(path, "utf-8");
      return JSON.parse(content);
    } catch (_error) {
      return null;
    }
  }

  /**
   * Get known model dimensions for common models
   */
  static getKnownModelDimensions(model: string): number | null {
    const knownDimensions: Record<string, number> = {
      // Ollama models
      "mxbai-embed-large": 1024,
      "nomic-embed-text": 768,
      "all-minilm": 384,
      "snowflake-arctic-embed": 1024,

      // OpenAI models
      "text-embedding-3-small": 1536,
      "text-embedding-3-large": 3072,
      "text-embedding-ada-002": 1536,

      // Transformers models
      "Xenova/all-MiniLM-L6-v2": 384,
      "Xenova/all-mpnet-base-v2": 768,
    };

    return knownDimensions[model] || null;
  }
}
