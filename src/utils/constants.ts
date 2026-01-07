/**
 * Application Constants
 *
 * Centralized location for magic numbers and configuration values.
 * Extracted from scattered literals throughout the codebase.
 */

// Database Configuration
export const DB_CONFIG = {
  // Performance settings (from SQLiteManager)
  CACHE_SIZE_KB: 64000, // 64MB cache
  MMAP_SIZE: 30000000000, // 30GB memory-mapped I/O
  PAGE_SIZE: 4096, // 4KB page size
  WAL_AUTOCHECKPOINT: 1000, // Checkpoint WAL after 1000 pages

  // Database file name
  DB_FILE_NAME: '.cccmemory.db',

  // Backup suffix
  BACKUP_SUFFIX: '.bak',
} as const;

// Embedding Configuration
export const EMBEDDING_CONFIG = {
  // Default model dimensions
  OLLAMA_DEFAULT_DIMENSIONS: 1024, // mxbai-embed-large
  TRANSFORMERS_DEFAULT_DIMENSIONS: 384, // Xenova/all-MiniLM-L6-v2
  OPENAI_DEFAULT_DIMENSIONS: 1536, // text-embedding-ada-002

  // Default models
  OLLAMA_DEFAULT_MODEL: 'mxbai-embed-large',
  TRANSFORMERS_DEFAULT_MODEL: 'Xenova/all-MiniLM-L6-v2',
  OPENAI_DEFAULT_MODEL: 'text-embedding-ada-002',

  // Batch size for embedding generation
  BATCH_SIZE: 100,

  // Similarity threshold
  DEFAULT_SIMILARITY_THRESHOLD: 0.7,
} as const;

// Search Configuration
export const SEARCH_CONFIG = {
  // Default result limits
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,

  // Context window for snippets
  SNIPPET_CONTEXT_CHARS: 200,

  // Date range defaults
  DEFAULT_DAYS_BACK: 30,
} as const;

// File Path Patterns
export const PATH_PATTERNS = {
  // Conversation directories
  CLAUDE_DIR: '.claude',
  PROJECTS_DIR: 'projects',

  // Legacy patterns
  LEGACY_PREFIX: '-Users-',

  // Config file
  CONFIG_FILE: '.claude-memory-config.jsonc',
} as const;

// Time Constants (milliseconds)
export const TIME = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

// Validation Limits
export const LIMITS = {
  // String length limits
  MAX_MESSAGE_LENGTH: 100000,
  MAX_FILE_PATH_LENGTH: 4096,
  MAX_DECISION_LENGTH: 10000,

  // Array size limits
  MAX_BATCH_SIZE: 1000,
  MAX_SEARCH_RESULTS: 1000,

  // Numeric limits
  MIN_SIMILARITY_SCORE: 0.0,
  MAX_SIMILARITY_SCORE: 1.0,
} as const;

// Migration Configuration
export const MIGRATION_CONFIG = {
  // Validation thresholds
  MIN_CONVERSATIONS_FOR_MIGRATION: 1,
  MIN_SIMILARITY_SCORE_FOR_MATCH: 0.7,

  // Backup behavior
  AUTO_BACKUP: true,
  KEEP_SOURCE_FILES: true,
} as const;

// MCP Configuration
export const MCP_CONFIG = {
  // Tool timeout
  TOOL_TIMEOUT_MS: 30000, // 30 seconds

  // Batch processing
  BATCH_PROCESSING_SIZE: 50,
} as const;

// Error Messages (commonly reused)
export const ERROR_MESSAGES = {
  NO_CONVERSATIONS_FOUND: 'No conversations found',
  INDEX_REQUIRED: 'Please index conversations first',
  INVALID_PROJECT_PATH: 'Invalid project path',
  DATABASE_ERROR: 'Database operation failed',
  EMBEDDING_ERROR: 'Embedding generation failed',
} as const;

// Success Messages (commonly reused)
export const SUCCESS_MESSAGES = {
  INDEX_COMPLETE: 'Indexing complete',
  MIGRATION_COMPLETE: 'Migration complete',
  BACKUP_CREATED: 'Backup created successfully',
} as const;
