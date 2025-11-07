/**
 * Unit tests for SemanticSearch
 */

import { jest } from '@jest/globals';
import { SemanticSearch } from '../../search/SemanticSearch';
import { getSQLiteManager, resetSQLiteManager } from '../../storage/SQLiteManager';
import type { Message } from '../../parsers/ConversationParser';
import type { Decision } from '../../parsers/DecisionExtractor';

// Skip Transformers tests in CI due to environment compatibility issues
const isCI = Boolean(process.env.CI) || Boolean(process.env.GITHUB_ACTIONS);

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

  // Skip in CI - TransformersEmbeddings has environment compatibility issues
  (isCI ? describe.skip : describe)('indexMessages', () => {
    it('should index messages with content', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'Hello world',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
        {
          id: 'msg-2',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Hi there',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      // Should handle gracefully even if embeddings not available
      await expect(semanticSearch.indexMessages(messages)).resolves.not.toThrow();
    });

    it('should handle empty messages array', async () => {
      await expect(semanticSearch.indexMessages([])).resolves.not.toThrow();
    });

    it('should handle messages without content', async () => {
      const messages: Message[] = [
        {
          id: 'msg-2',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
        {
          id: 'msg-3',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: undefined,
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      await expect(semanticSearch.indexMessages(messages)).resolves.not.toThrow();
    });
  });

  // Skip in CI - TransformersEmbeddings has environment compatibility issues
  (isCI ? describe.skip : describe)('indexDecisions', () => {
    it('should index decisions', async () => {
      const decisions: Decision[] = [
        {
          id: 'dec-1',
          conversation_id: 'conv-1',
          message_id: 'msg-1',
          decision_text: 'Use PostgreSQL',
          rationale: 'Better for structured data',
          context: 'Database selection',
          alternatives_considered: ['MongoDB'],
          rejected_reasons: {},
          related_files: [],
          related_commits: [],
          timestamp: Date.now(),
        },
      ];

      await expect(semanticSearch.indexDecisions(decisions)).resolves.not.toThrow();
    });

    it('should handle empty decisions array', async () => {
      await expect(semanticSearch.indexDecisions([])).resolves.not.toThrow();
    });

    it('should handle decisions with minimal data', async () => {
      const decisions: Decision[] = [
        {
          id: 'dec-1',
          conversation_id: 'conv-1',
          message_id: 'msg-1',
          decision_text: 'Use PostgreSQL',
          rationale: undefined,
          context: undefined,
          alternatives_considered: [],
          rejected_reasons: {},
          related_files: [],
          related_commits: [],
          timestamp: Date.now(),
        },
      ];

      await expect(semanticSearch.indexDecisions(decisions)).resolves.not.toThrow();
    });
  });

  // Skip in CI - TransformersEmbeddings has environment compatibility issues
  (isCI ? describe.skip : describe)('searchConversations', () => {
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

  // Skip in CI - TransformersEmbeddings has environment compatibility issues
  (isCI ? describe.skip : describe)('Edge Cases', () => {
    it('should handle messages with very long content', async () => {
      const longContent = 'a'.repeat(10000);
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: longContent,
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      await expect(semanticSearch.indexMessages(messages)).resolves.not.toThrow();
    });

    it('should handle messages with special characters', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: '你好 🎉 "quotes" \'single\'',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      await expect(semanticSearch.indexMessages(messages)).resolves.not.toThrow();
    });

    it('should handle concurrent indexing', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'Message 1',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
        {
          id: 'msg-2',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'Message 2',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const promises = [
        semanticSearch.indexMessages(messages.slice(0, 1)),
        semanticSearch.indexMessages(messages.slice(1, 2)),
      ];

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });
  });
});
