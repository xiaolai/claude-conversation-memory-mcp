/**
 * Query Expander
 * Expands search queries with domain-specific synonyms
 */

/**
 * Configuration for query expansion
 */
export interface QueryExpansionConfig {
  /** Whether query expansion is enabled */
  enabled: boolean;

  /** Maximum number of expanded queries to generate */
  maxVariants: number;

  /** Custom synonym map (key → alternatives) */
  customSynonyms?: Map<string, string[]>;
}

export const DEFAULT_EXPANSION_CONFIG: QueryExpansionConfig = {
  enabled: false, // Disabled by default, can be enabled via env
  maxVariants: 3,
};

/**
 * Domain-specific synonym map for development contexts
 */
const DOMAIN_SYNONYMS: Map<string, string[]> = new Map([
  // Errors and bugs
  ["error", ["bug", "issue", "problem", "exception", "failure"]],
  ["bug", ["error", "issue", "defect", "problem"]],
  ["issue", ["problem", "bug", "error", "concern"]],
  ["exception", ["error", "crash", "failure", "thrown"]],
  ["crash", ["exception", "failure", "error", "abort"]],

  // API and endpoints
  ["api", ["endpoint", "interface", "service", "route"]],
  ["endpoint", ["api", "route", "path", "url"]],
  ["route", ["endpoint", "path", "url", "api"]],

  // Functions and methods
  ["function", ["method", "procedure", "routine", "handler"]],
  ["method", ["function", "procedure", "operation"]],
  ["handler", ["callback", "listener", "function"]],
  ["callback", ["handler", "listener", "hook"]],

  // Data structures
  ["array", ["list", "collection", "sequence"]],
  ["list", ["array", "collection", "items"]],
  ["object", ["instance", "entity", "record"]],
  ["map", ["dictionary", "hash", "hashmap"]],
  ["dictionary", ["map", "hash", "object"]],

  // Database terms
  ["database", ["db", "datastore", "storage"]],
  ["query", ["search", "lookup", "fetch", "retrieve"]],
  ["schema", ["structure", "model", "definition"]],
  ["migration", ["upgrade", "change", "update"]],

  // UI terms
  ["component", ["widget", "element", "module"]],
  ["button", ["btn", "control", "action"]],
  ["modal", ["dialog", "popup", "overlay"]],
  ["form", ["input", "fields", "submission"]],

  // Testing
  ["test", ["spec", "check", "verify", "validate"]],
  ["unit test", ["spec", "test case"]],
  ["mock", ["stub", "fake", "double"]],

  // Configuration
  ["config", ["configuration", "settings", "options"]],
  ["settings", ["config", "preferences", "options"]],
  ["option", ["setting", "parameter", "flag"]],

  // Authentication
  ["auth", ["authentication", "login", "authorization"]],
  ["authentication", ["auth", "login", "signin"]],
  ["authorization", ["auth", "permissions", "access"]],
  ["login", ["signin", "authenticate", "auth"]],

  // Security
  ["password", ["credential", "secret", "passphrase"]],
  ["token", ["jwt", "key", "credential"]],
  ["encryption", ["crypto", "cipher", "encrypt"]],

  // Performance
  ["performance", ["speed", "optimization", "efficiency"]],
  ["optimize", ["improve", "enhance", "speed up"]],
  ["cache", ["memoize", "store", "buffer"]],

  // State management
  ["state", ["data", "store", "context"]],
  ["store", ["state", "repository", "cache"]],

  // File operations
  ["file", ["document", "asset", "resource"]],
  ["upload", ["import", "submit", "send"]],
  ["download", ["export", "fetch", "retrieve"]],

  // Misc development terms
  ["deploy", ["release", "publish", "ship"]],
  ["build", ["compile", "bundle", "package"]],
  ["install", ["setup", "configure", "add"]],
  ["dependency", ["package", "module", "library"]],
  ["refactor", ["restructure", "rewrite", "improve"]],
]);

/**
 * Query Expander class
 */
export class QueryExpander {
  private config: QueryExpansionConfig;
  private synonyms: Map<string, string[]>;

  constructor(config?: Partial<QueryExpansionConfig>) {
    this.config = { ...DEFAULT_EXPANSION_CONFIG, ...config };

    // Merge custom synonyms with domain synonyms
    this.synonyms = new Map(DOMAIN_SYNONYMS);
    if (this.config.customSynonyms) {
      for (const [key, values] of this.config.customSynonyms) {
        const existing = this.synonyms.get(key) || [];
        this.synonyms.set(key, [...new Set([...existing, ...values])]);
      }
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): QueryExpansionConfig {
    return { ...this.config };
  }

  /**
   * Expand a query into multiple variants
   */
  expand(query: string): string[] {
    if (!this.config.enabled) {
      return [query];
    }

    const variants: Set<string> = new Set([query]);
    const words = query.toLowerCase().split(/\s+/);

    // Find expandable words
    const expandableWords: Array<{ index: number; word: string; synonyms: string[] }> = [];

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const syns = this.synonyms.get(word);
      if (syns && syns.length > 0) {
        expandableWords.push({ index: i, word, synonyms: syns });
      }
    }

    // Generate variants by replacing one word at a time
    for (const { index, synonyms } of expandableWords) {
      for (const syn of synonyms) {
        if (variants.size >= this.config.maxVariants) {
          break;
        }

        const newWords = [...words];
        newWords[index] = syn;
        variants.add(newWords.join(" "));
      }

      if (variants.size >= this.config.maxVariants) {
        break;
      }
    }

    return Array.from(variants).slice(0, this.config.maxVariants);
  }

  /**
   * Get synonyms for a specific word
   */
  getSynonyms(word: string): string[] {
    return this.synonyms.get(word.toLowerCase()) || [];
  }

  /**
   * Check if a word has synonyms
   */
  hasSynonyms(word: string): boolean {
    return this.synonyms.has(word.toLowerCase());
  }

  /**
   * Add custom synonyms
   */
  addSynonyms(word: string, synonyms: string[]): void {
    const existing = this.synonyms.get(word.toLowerCase()) || [];
    this.synonyms.set(word.toLowerCase(), [...new Set([...existing, ...synonyms])]);
  }
}

/**
 * Get or create a query expander
 */
export function getQueryExpander(config?: Partial<QueryExpansionConfig>): QueryExpander {
  return new QueryExpander(config);
}

/**
 * Get expansion config from environment or defaults
 */
export function getExpansionConfig(): QueryExpansionConfig {
  const config = { ...DEFAULT_EXPANSION_CONFIG };

  if (process.env.CCCMEMORY_QUERY_EXPANSION !== undefined) {
    config.enabled = process.env.CCCMEMORY_QUERY_EXPANSION === "true";
  }

  if (process.env.CCCMEMORY_MAX_QUERY_VARIANTS) {
    const max = parseInt(process.env.CCCMEMORY_MAX_QUERY_VARIANTS, 10);
    if (!isNaN(max) && max > 0) {
      config.maxVariants = max;
    }
  }

  return config;
}
