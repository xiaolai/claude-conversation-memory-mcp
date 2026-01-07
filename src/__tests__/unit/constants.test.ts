/**
 * Unit tests for Constants
 *
 * Validates that all constants are properly defined and have expected values.
 */

import {
  DB_CONFIG,
  EMBEDDING_CONFIG,
  SEARCH_CONFIG,
  PATH_PATTERNS,
  TIME,
  LIMITS,
  MIGRATION_CONFIG,
  MCP_CONFIG,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '../../utils/constants';

describe('Constants', () => {
  describe('DB_CONFIG', () => {
    it('should have valid database configuration values', () => {
      expect(DB_CONFIG.CACHE_SIZE_KB).toBeGreaterThan(0);
      expect(DB_CONFIG.MMAP_SIZE).toBeGreaterThan(0);
      expect(DB_CONFIG.PAGE_SIZE).toBeGreaterThan(0);
      expect(DB_CONFIG.WAL_AUTOCHECKPOINT).toBeGreaterThan(0);
    });

    it('should have valid file names', () => {
      expect(DB_CONFIG.DB_FILE_NAME).toBe('.cccmemory.db');
      expect(DB_CONFIG.BACKUP_SUFFIX).toBe('.bak');
    });

    it('should provide TypeScript compile-time immutability', () => {
      // `as const` provides TypeScript compile-time immutability
      // Runtime modification is technically possible but prevented by TypeScript
      // This test documents the immutability expectation
      expect(typeof DB_CONFIG.CACHE_SIZE_KB).toBe('number');
    });
  });

  describe('EMBEDDING_CONFIG', () => {
    it('should have valid dimension values', () => {
      expect(EMBEDDING_CONFIG.OLLAMA_DEFAULT_DIMENSIONS).toBe(1024);
      expect(EMBEDDING_CONFIG.TRANSFORMERS_DEFAULT_DIMENSIONS).toBe(384);
      expect(EMBEDDING_CONFIG.OPENAI_DEFAULT_DIMENSIONS).toBe(1536);
    });

    it('should have valid model names', () => {
      expect(EMBEDDING_CONFIG.OLLAMA_DEFAULT_MODEL).toBe('mxbai-embed-large');
      expect(EMBEDDING_CONFIG.TRANSFORMERS_DEFAULT_MODEL).toBe('Xenova/all-MiniLM-L6-v2');
      expect(EMBEDDING_CONFIG.OPENAI_DEFAULT_MODEL).toBe('text-embedding-ada-002');
    });

    it('should have valid batch size', () => {
      expect(EMBEDDING_CONFIG.BATCH_SIZE).toBeGreaterThan(0);
      expect(EMBEDDING_CONFIG.BATCH_SIZE).toBeLessThanOrEqual(1000);
    });

    it('should have valid similarity threshold', () => {
      expect(EMBEDDING_CONFIG.DEFAULT_SIMILARITY_THRESHOLD).toBeGreaterThanOrEqual(0);
      expect(EMBEDDING_CONFIG.DEFAULT_SIMILARITY_THRESHOLD).toBeLessThanOrEqual(1);
    });
  });

  describe('SEARCH_CONFIG', () => {
    it('should have valid limit values', () => {
      expect(SEARCH_CONFIG.DEFAULT_LIMIT).toBe(10);
      expect(SEARCH_CONFIG.MAX_LIMIT).toBe(100);
      expect(SEARCH_CONFIG.DEFAULT_LIMIT).toBeLessThanOrEqual(SEARCH_CONFIG.MAX_LIMIT);
    });

    it('should have valid snippet context size', () => {
      expect(SEARCH_CONFIG.SNIPPET_CONTEXT_CHARS).toBeGreaterThan(0);
    });

    it('should have valid date range defaults', () => {
      expect(SEARCH_CONFIG.DEFAULT_DAYS_BACK).toBeGreaterThan(0);
    });
  });

  describe('PATH_PATTERNS', () => {
    it('should have valid path components', () => {
      expect(PATH_PATTERNS.CLAUDE_DIR).toBe('.claude');
      expect(PATH_PATTERNS.PROJECTS_DIR).toBe('projects');
      expect(PATH_PATTERNS.LEGACY_PREFIX).toBe('-Users-');
      expect(PATH_PATTERNS.CONFIG_FILE).toBe('.claude-memory-config.jsonc');
    });
  });

  describe('TIME', () => {
    it('should have correct time conversions', () => {
      expect(TIME.SECOND).toBe(1000);
      expect(TIME.MINUTE).toBe(60 * 1000);
      expect(TIME.HOUR).toBe(60 * 60 * 1000);
      expect(TIME.DAY).toBe(24 * 60 * 60 * 1000);
      expect(TIME.WEEK).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('should have correct time relationships', () => {
      expect(TIME.MINUTE).toBe(TIME.SECOND * 60);
      expect(TIME.HOUR).toBe(TIME.MINUTE * 60);
      expect(TIME.DAY).toBe(TIME.HOUR * 24);
      expect(TIME.WEEK).toBe(TIME.DAY * 7);
    });
  });

  describe('LIMITS', () => {
    it('should have valid length limits', () => {
      expect(LIMITS.MAX_MESSAGE_LENGTH).toBeGreaterThan(0);
      expect(LIMITS.MAX_FILE_PATH_LENGTH).toBeGreaterThan(0);
      expect(LIMITS.MAX_DECISION_LENGTH).toBeGreaterThan(0);
    });

    it('should have valid batch size limits', () => {
      expect(LIMITS.MAX_BATCH_SIZE).toBeGreaterThan(0);
      expect(LIMITS.MAX_SEARCH_RESULTS).toBeGreaterThan(0);
    });

    it('should have valid similarity score range', () => {
      expect(LIMITS.MIN_SIMILARITY_SCORE).toBe(0.0);
      expect(LIMITS.MAX_SIMILARITY_SCORE).toBe(1.0);
      expect(LIMITS.MIN_SIMILARITY_SCORE).toBeLessThan(LIMITS.MAX_SIMILARITY_SCORE);
    });
  });

  describe('MIGRATION_CONFIG', () => {
    it('should have valid migration thresholds', () => {
      expect(MIGRATION_CONFIG.MIN_CONVERSATIONS_FOR_MIGRATION).toBeGreaterThanOrEqual(1);
      expect(MIGRATION_CONFIG.MIN_SIMILARITY_SCORE_FOR_MATCH).toBeGreaterThanOrEqual(0);
      expect(MIGRATION_CONFIG.MIN_SIMILARITY_SCORE_FOR_MATCH).toBeLessThanOrEqual(1);
    });

    it('should have valid backup configuration', () => {
      expect(typeof MIGRATION_CONFIG.AUTO_BACKUP).toBe('boolean');
      expect(typeof MIGRATION_CONFIG.KEEP_SOURCE_FILES).toBe('boolean');
    });
  });

  describe('MCP_CONFIG', () => {
    it('should have valid timeout', () => {
      expect(MCP_CONFIG.TOOL_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('should have valid batch size', () => {
      expect(MCP_CONFIG.BATCH_PROCESSING_SIZE).toBeGreaterThan(0);
    });
  });

  describe('ERROR_MESSAGES', () => {
    it('should have all error messages defined', () => {
      expect(ERROR_MESSAGES.NO_CONVERSATIONS_FOUND).toBeTruthy();
      expect(ERROR_MESSAGES.INDEX_REQUIRED).toBeTruthy();
      expect(ERROR_MESSAGES.INVALID_PROJECT_PATH).toBeTruthy();
      expect(ERROR_MESSAGES.DATABASE_ERROR).toBeTruthy();
      expect(ERROR_MESSAGES.EMBEDDING_ERROR).toBeTruthy();
    });

    it('should have non-empty error messages', () => {
      Object.values(ERROR_MESSAGES).forEach(message => {
        expect(message.length).toBeGreaterThan(0);
      });
    });
  });

  describe('SUCCESS_MESSAGES', () => {
    it('should have all success messages defined', () => {
      expect(SUCCESS_MESSAGES.INDEX_COMPLETE).toBeTruthy();
      expect(SUCCESS_MESSAGES.MIGRATION_COMPLETE).toBeTruthy();
      expect(SUCCESS_MESSAGES.BACKUP_CREATED).toBeTruthy();
    });

    it('should have non-empty success messages', () => {
      Object.values(SUCCESS_MESSAGES).forEach(message => {
        expect(message.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Type Safety', () => {
    it('should have readonly properties', () => {
      // TypeScript will catch attempts to modify at compile time
      // This test documents the immutability expectation
      expect(Object.isFrozen(DB_CONFIG)).toBe(false); // `as const` doesn't freeze at runtime
      // But TypeScript will prevent: DB_CONFIG.CACHE_SIZE_KB = 999
    });
  });
});
