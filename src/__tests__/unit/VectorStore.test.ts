/**
 * Unit tests for VectorStore
 */

import { jest } from '@jest/globals';
import { VectorStore } from '../../embeddings/VectorStore';
import { getSQLiteManager, resetSQLiteManager } from '../../storage/SQLiteManager';

describe('VectorStore', () => {
  let vectorStore: VectorStore;

  beforeEach(() => {
    // Use in-memory database for tests
    const sqliteManager = getSQLiteManager({ dbPath: ':memory:' });

    // Disable foreign keys for testing (embeddings don't need actual messages)
    sqliteManager.getDatabase().pragma('foreign_keys = OFF');

    // Silence console logs during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    vectorStore = new VectorStore(sqliteManager);

    // Force vectorStore to use BLOB storage by disabling vec extension
    // This makes tests simpler since getEmbeddingCount() queries BLOB tables
    (vectorStore as unknown as { hasVecExtension: boolean }).hasVecExtension = false;

    const db = sqliteManager.getDatabase();
    const insertMessage = (id: number) => {
      db.prepare(
        `INSERT OR IGNORE INTO messages
         (id, conversation_id, external_id, message_type, timestamp, is_sidechain, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, 1, `msg-${id}`, 'test', Date.now(), 0, '{}');
    };

    const seededIds = [
      1, 2, 3, 10, 11, 12, 100, 200, 201, 202, 203, 204,
      ...Array.from({ length: 10 }, (_, i) => 1000 + i),
    ];
    for (const id of seededIds) {
      insertMessage(id);
    }
  });

  afterEach(() => {
    // Clean up
    resetSQLiteManager();
    jest.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should create VectorStore instance', () => {
      expect(vectorStore).toBeDefined();
      expect(typeof vectorStore.isVecEnabled()).toBe('boolean');
    });

    it('should detect vec extension availability', () => {
      const hasVec = vectorStore.isVecEnabled();
      expect(typeof hasVec).toBe('boolean');
    });
  });

  describe('isVecEnabled', () => {
    it('should return boolean value', () => {
      const enabled = vectorStore.isVecEnabled();
      expect([true, false]).toContain(enabled);
    });
  });

  describe('storeMessageEmbedding', () => {
    it('should store message embedding', async () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

      await vectorStore.storeMessageEmbedding(1, 'test content', embedding);

      // Verify it was stored
      const count = vectorStore.getEmbeddingCount();
      expect(count).toBeGreaterThan(0);
    });

    it('should handle multiple embeddings', async () => {
      const embedding1 = new Float32Array([0.1, 0.2, 0.3]);
      const embedding2 = new Float32Array([0.4, 0.5, 0.6]);

      await vectorStore.storeMessageEmbedding(1, 'content 1', embedding1);
      await vectorStore.storeMessageEmbedding(2, 'content 2', embedding2);

      const count = vectorStore.getEmbeddingCount();
      expect(count).toBe(2);
    });

    it('should replace existing embedding with same ID', async () => {
      const embedding1 = new Float32Array([0.1, 0.2]);
      const embedding2 = new Float32Array([0.3, 0.4]);

      await vectorStore.storeMessageEmbedding(1, 'content 1', embedding1);
      await vectorStore.storeMessageEmbedding(1, 'content 2', embedding2);

      const count = vectorStore.getEmbeddingCount();
      expect(count).toBe(1);
    });

    it('should handle empty content', async () => {
      const embedding = new Float32Array([0.1, 0.2]);

      await vectorStore.storeMessageEmbedding(1, '', embedding);

      const count = vectorStore.getEmbeddingCount();
      expect(count).toBe(1);
    });

    it('should handle large embeddings', async () => {
      const embedding = new Float32Array(1536); // OpenAI embedding size
      for (let i = 0; i < 1536; i++) {
        embedding[i] = Math.random();
      }

      await vectorStore.storeMessageEmbedding(100, 'large embedding', embedding);

      const count = vectorStore.getEmbeddingCount();
      expect(count).toBe(1);
    });
  });

  describe('storeDecisionEmbedding', () => {
    it('should store decision embedding', async () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);

      await vectorStore.storeDecisionEmbedding(10, embedding);

      // Decision embeddings are in a separate table, so this should not throw
      expect(true).toBe(true);
    });

    it('should handle multiple decision embeddings', async () => {
      const embedding1 = new Float32Array([0.1, 0.2]);
      const embedding2 = new Float32Array([0.3, 0.4]);

      await vectorStore.storeDecisionEmbedding(10, embedding1);
      await vectorStore.storeDecisionEmbedding(11, embedding2);

      // Should not throw
      expect(true).toBe(true);
    });

    it('should replace existing decision embedding', async () => {
      const embedding1 = new Float32Array([0.1, 0.2]);
      const embedding2 = new Float32Array([0.3, 0.4]);

      await vectorStore.storeDecisionEmbedding(10, embedding1);
      await vectorStore.storeDecisionEmbedding(10, embedding2);

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('searchMessages', () => {
    beforeEach(async () => {
      // Store some test embeddings
      await vectorStore.storeMessageEmbedding(1, 'hello world', new Float32Array([1.0, 0.0, 0.0]));
      await vectorStore.storeMessageEmbedding(2, 'goodbye world', new Float32Array([0.0, 1.0, 0.0]));
      await vectorStore.storeMessageEmbedding(3, 'test message', new Float32Array([0.0, 0.0, 1.0]));
    });

    it('should search for similar messages', async () => {
      const queryEmbedding = new Float32Array([1.0, 0.0, 0.0]);

      const results = await vectorStore.searchMessages(queryEmbedding, 3);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should return results with correct structure', async () => {
      const queryEmbedding = new Float32Array([1.0, 0.0, 0.0]);

      const results = await vectorStore.searchMessages(queryEmbedding, 1);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('content');
      expect(results[0]).toHaveProperty('similarity');
      expect(typeof results[0].similarity).toBe('number');
    });

    it('should limit results', async () => {
      const queryEmbedding = new Float32Array([1.0, 0.0, 0.0]);

      const results = await vectorStore.searchMessages(queryEmbedding, 2);

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should handle search with no stored embeddings', async () => {
      vectorStore.clearAllEmbeddings();

      const queryEmbedding = new Float32Array([1.0, 0.0, 0.0]);
      const results = await vectorStore.searchMessages(queryEmbedding, 10);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('should return most similar results first', async () => {
      // Clear and add new test data
      vectorStore.clearAllEmbeddings();

      await vectorStore.storeMessageEmbedding(10, 'exact match', new Float32Array([1.0, 0.0]));
      await vectorStore.storeMessageEmbedding(11, 'close match', new Float32Array([0.9, 0.1]));
      await vectorStore.storeMessageEmbedding(12, 'far match', new Float32Array([0.0, 1.0]));

      const queryEmbedding = new Float32Array([1.0, 0.0]);
      const results = await vectorStore.searchMessages(queryEmbedding, 3);

      // First result should be most similar (highest similarity score)
      expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
      expect(results[1].similarity).toBeGreaterThanOrEqual(results[2].similarity);
    });
  });

  describe('getEmbeddingCount', () => {
    it('should return 0 for empty store', () => {
      vectorStore.clearAllEmbeddings();
      expect(vectorStore.getEmbeddingCount()).toBe(0);
    });

    it('should return correct count after storing embeddings', async () => {
      vectorStore.clearAllEmbeddings();

      await vectorStore.storeMessageEmbedding(1, 'test 1', new Float32Array([0.1]));
      expect(vectorStore.getEmbeddingCount()).toBe(1);

      await vectorStore.storeMessageEmbedding(2, 'test 2', new Float32Array([0.2]));
      expect(vectorStore.getEmbeddingCount()).toBe(2);
    });

    it('should not double count replaced embeddings', async () => {
      vectorStore.clearAllEmbeddings();

      await vectorStore.storeMessageEmbedding(1, 'test 1', new Float32Array([0.1]));
      await vectorStore.storeMessageEmbedding(1, 'test 1 updated', new Float32Array([0.2]));

      expect(vectorStore.getEmbeddingCount()).toBe(1);
    });
  });

  describe('clearAllEmbeddings', () => {
    it('should clear all message embeddings', async () => {
      await vectorStore.storeMessageEmbedding(1, 'test', new Float32Array([0.1]));
      await vectorStore.storeMessageEmbedding(2, 'test', new Float32Array([0.2]));

      expect(vectorStore.getEmbeddingCount()).toBe(2);

      vectorStore.clearAllEmbeddings();

      expect(vectorStore.getEmbeddingCount()).toBe(0);
    });

    it('should not throw on empty store', () => {
      vectorStore.clearAllEmbeddings();
      expect(() => vectorStore.clearAllEmbeddings()).not.toThrow();
    });

    it('should clear decision embeddings too', async () => {
      await vectorStore.storeDecisionEmbedding(10, new Float32Array([0.1]));

      vectorStore.clearAllEmbeddings();

      // Should not throw when trying to query
      expect(vectorStore.getEmbeddingCount()).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero-length embeddings gracefully', async () => {
      const embedding = new Float32Array(0);

      await expect(
        vectorStore.storeMessageEmbedding(200, 'empty embedding', embedding)
      ).resolves.not.toThrow();
    });

    it('should handle very long content strings', async () => {
      const longContent = 'a'.repeat(100000);
      const embedding = new Float32Array([0.1, 0.2]);

      await vectorStore.storeMessageEmbedding(201, longContent, embedding);

      const count = vectorStore.getEmbeddingCount();
      expect(count).toBe(1);
    });

    it('should handle special characters in content', async () => {
      const specialContent = 'Test with 你好 émojis 🎉 and "quotes"';
      const embedding = new Float32Array([0.1, 0.2]);

      await vectorStore.storeMessageEmbedding(202, specialContent, embedding);

      const results = await vectorStore.searchMessages(embedding, 1);
      expect(results[0].content).toBe(specialContent);
    });

    it('should handle embeddings with all zeros', async () => {
      const zeroEmbedding = new Float32Array([0.0, 0.0, 0.0]);

      await vectorStore.storeMessageEmbedding(203, 'zero embedding', zeroEmbedding);

      const count = vectorStore.getEmbeddingCount();
      expect(count).toBe(1);
    });

    it('should handle embeddings with negative values', async () => {
      const negativeEmbedding = new Float32Array([-0.5, 0.3, -0.2]);

      await vectorStore.storeMessageEmbedding(204, 'negative values', negativeEmbedding);

      const count = vectorStore.getEmbeddingCount();
      expect(count).toBe(1);
    });

    it('should handle concurrent stores', async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          vectorStore.storeMessageEmbedding(
            i + 1000,
            `content ${i}`,
            new Float32Array([i / 10, (10 - i) / 10])
          )
        );
      }

      await Promise.all(promises);

      const count = vectorStore.getEmbeddingCount();
      expect(count).toBe(10);
    });
  });

  describe('Cosine Similarity', () => {
    it('should calculate similarity between identical vectors as 1.0', async () => {
      vectorStore.clearAllEmbeddings();

      const embedding = new Float32Array([1.0, 0.0, 0.0]);
      await vectorStore.storeMessageEmbedding(1, 'test', embedding);

      const results = await vectorStore.searchMessages(embedding, 1);

      expect(results[0].similarity).toBeCloseTo(1.0, 5);
    });

    it('should calculate similarity between orthogonal vectors as 0.0', async () => {
      vectorStore.clearAllEmbeddings();

      await vectorStore.storeMessageEmbedding(1, 'test', new Float32Array([1.0, 0.0]));

      const queryEmbedding = new Float32Array([0.0, 1.0]);
      const results = await vectorStore.searchMessages(queryEmbedding, 1);

      expect(results[0].similarity).toBeCloseTo(0.0, 5);
    });

    it('should handle normalized embeddings', async () => {
      vectorStore.clearAllEmbeddings();

      // Normalized vectors (length = 1)
      const norm1 = new Float32Array([0.6, 0.8]);
      const norm2 = new Float32Array([0.8, 0.6]);

      await vectorStore.storeMessageEmbedding(1, 'test1', norm1);
      await vectorStore.storeMessageEmbedding(2, 'test2', norm2);

      const results = await vectorStore.searchMessages(norm1, 2);

      expect(results[0].id).toBe(1);
      expect(results[0].similarity).toBeCloseTo(1.0, 5);
    });
  });
});
