/**
 * Unit tests for SemanticSearch
 */

import { jest } from '@jest/globals';
import { SemanticSearch } from '../../search/SemanticSearch';
import { getSQLiteManager, resetSQLiteManager } from '../../storage/SQLiteManager';

// Skip Transformers tests in CI due to environment compatibility issues
// Also skip on macOS ARM64 where ONNX runtime has known compatibility issues
const isCI = Boolean(process.env.CI) || Boolean(process.env.GITHUB_ACTIONS);
const isMacOSArm64 = process.platform === 'darwin' && process.arch === 'arm64';
const skipTransformers = isCI || isMacOSArm64;

describe('SemanticSearch', () => {
  let semanticSearch: SemanticSearch;

  beforeEach(() => {
    // Use in-memory database for tests
    const sqliteManager = getSQLiteManager({ dbPath: ':memory:' });

    // Disable foreign keys for testing
    sqliteManager.getDatabase().pragma('foreign_keys = OFF');

    // Silence console logs during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    semanticSearch = new SemanticSearch(sqliteManager);

    // Force vectorStore to use BLOB storage
    const vectorStore = (semanticSearch as unknown as { vectorStore: { hasVecExtension: boolean } }).vectorStore;
    (vectorStore as { hasVecExtension: boolean }).hasVecExtension = false;
  });

  afterEach(() => {
    resetSQLiteManager();
    jest.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should create SemanticSearch instance', () => {
      expect(semanticSearch).toBeDefined();
    });
  });

  // Skip on incompatible platforms - TransformersEmbeddings has ONNX runtime issues on macOS ARM64
  (skipTransformers ? describe.skip : describe)('indexMessages', () => {
    it('should index messages with content', async () => {
      const messages = [
        { id: 1, content: 'Hello world' },
        { id: 2, content: 'Hi there' },
      ];

      // Should handle gracefully even if embeddings not available
      await expect(semanticSearch.indexMessages(messages)).resolves.not.toThrow();
    });

    it('should handle empty messages array', async () => {
      await expect(semanticSearch.indexMessages([])).resolves.not.toThrow();
    });

    it('should handle messages without content', async () => {
      const messages = [
        { id: 1, content: '' },
        { id: 2, content: undefined },
      ];

      await expect(semanticSearch.indexMessages(messages)).resolves.not.toThrow();
    });
  });

  // Skip on incompatible platforms - TransformersEmbeddings has ONNX runtime issues on macOS ARM64
  (skipTransformers ? describe.skip : describe)('indexDecisions', () => {
    it('should index decisions', async () => {
      const decisions = [
        {
          id: 1,
          decision_text: 'Use PostgreSQL',
          rationale: 'Better for structured data',
          context: 'Database selection',
        },
      ];

      await expect(semanticSearch.indexDecisions(decisions)).resolves.not.toThrow();
    });

    it('should handle empty decisions array', async () => {
      await expect(semanticSearch.indexDecisions([])).resolves.not.toThrow();
    });

    it('should handle decisions with minimal data', async () => {
      const decisions = [
        {
          id: 1,
          decision_text: 'Use PostgreSQL',
          rationale: undefined,
          context: undefined,
        },
      ];

      await expect(semanticSearch.indexDecisions(decisions)).resolves.not.toThrow();
    });
  });

  // Skip on incompatible platforms - TransformersEmbeddings has ONNX runtime issues on macOS ARM64
  (skipTransformers ? describe.skip : describe)('searchConversations', () => {
    it('should handle search without indexed data', async () => {
      const results = await semanticSearch.searchConversations('hello', 10);

      // Should return empty array or handle gracefully
      expect(Array.isArray(results)).toBe(true);
    });

    it('should not throw on valid queries', async () => {
      await expect(
        semanticSearch.searchConversations('test query', 10)
      ).resolves.not.toThrow();
    });

    it('should handle empty query', async () => {
      await expect(
        semanticSearch.searchConversations('', 10)
      ).resolves.not.toThrow();
    });
  });

  // Skip on incompatible platforms - TransformersEmbeddings has ONNX runtime issues on macOS ARM64
  (skipTransformers ? describe.skip : describe)('Edge Cases', () => {
    it('should handle messages with very long content', async () => {
      const longContent = 'a'.repeat(10000);
      const messages = [
        { id: 1, content: longContent },
      ];

      await expect(semanticSearch.indexMessages(messages)).resolves.not.toThrow();
    });

    it('should handle messages with special characters', async () => {
      const messages = [
        { id: 1, content: '你好 🎉 "quotes" \'single\'' },
      ];

      await expect(semanticSearch.indexMessages(messages)).resolves.not.toThrow();
    });

    it('should handle concurrent indexing', async () => {
      const messages = [
        { id: 1, content: 'Message 1' },
        { id: 2, content: 'Message 2' },
      ];

      const promises = [
        semanticSearch.indexMessages(messages.slice(0, 1)),
        semanticSearch.indexMessages(messages.slice(1, 2)),
      ];

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });
  });
});
