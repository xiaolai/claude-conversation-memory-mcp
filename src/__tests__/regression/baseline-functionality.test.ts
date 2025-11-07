/**
 * Regression Test Suite - Baseline Functionality
 *
 * These tests capture the CURRENT behavior as the baseline.
 * Any changes that break these tests require explicit review.
 *
 * Purpose:
 * - Prevent unintended behavior changes
 * - Document expected behavior
 * - Catch regressions early
 */

import { ConversationMemory } from '../../ConversationMemory';
import { ToolHandlers } from '../../tools/ToolHandlers';
import { getSQLiteManager, resetSQLiteManager } from '../../storage/SQLiteManager';
import type { SQLiteManager } from '../../storage/SQLiteManager';
import { rmSync } from 'fs';
import { join } from 'path';

// Skip Transformers tests in CI due to environment compatibility issues
const isCI = Boolean(process.env.CI) || Boolean(process.env.GITHUB_ACTIONS);

describe('Regression Tests - Baseline Functionality', () => {
  let testDbPath: string;

  beforeEach(() => {
    // Use unique database for each test
    testDbPath = join('/tmp', `test-regression-${Date.now()}.db`);
  });

  afterEach(() => {
    // Cleanup test database
    try {
      resetSQLiteManager();
      rmSync(testDbPath, { force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('ConversationMemory - Core Functions', () => {
    beforeEach(() => {
      resetSQLiteManager();
    });

    it('should handle empty project path gracefully', async () => {
      const memory = new ConversationMemory();

      // Empty directory should not throw
      const result = await memory.indexConversations({
        projectPath: '/tmp/nonexistent-test-dir',
        sessionId: undefined,
      });

      // Baseline behavior: returns result with embeddings info
      expect(typeof result.embeddings_generated).toBe('boolean');

      // Should have stats after indexing (may have existing data from project)
      const stats = memory.getStats();
      expect(typeof stats.conversations.count).toBe('number');
      expect(typeof stats.messages.count).toBe('number');
    });

    it('should return consistent stats structure', () => {
      const memory = new ConversationMemory();
      const stats = memory.getStats();

      // Baseline: stats always has this structure
      expect(stats).toHaveProperty('conversations');
      expect(stats).toHaveProperty('messages');
      expect(stats).toHaveProperty('decisions');
      expect(stats).toHaveProperty('mistakes');

      expect(typeof stats.conversations.count).toBe('number');
      expect(typeof stats.messages.count).toBe('number');
    });

    // Skip in CI - TransformersEmbeddings has environment compatibility issues
    (isCI ? it.skip : it)('should handle search on empty database', async () => {
      const memory = new ConversationMemory();

      // Search with no indexed conversations
      const results = await memory.search('test query', 10);

      // Baseline: returns empty array, doesn't throw
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });

  describe('ToolHandlers - All 15 Tools', () => {
    let db: SQLiteManager;
    let memory: ConversationMemory;
    let handlers: ToolHandlers;

    beforeEach(() => {
      resetSQLiteManager();
      db = getSQLiteManager({ dbPath: testDbPath });
      memory = new ConversationMemory();
      handlers = new ToolHandlers(memory, db);
    });

    it('indexConversations - baseline response structure', async () => {
      const result = await handlers.indexConversations({
        project_path: '/tmp/nonexistent',
      });

      // Baseline structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('project_path');
      expect(result).toHaveProperty('stats');
      expect(result).toHaveProperty('message');

      expect(typeof result.success).toBe('boolean');
      expect(typeof result.message).toBe('string');
    });

    // Skip in CI - TransformersEmbeddings has environment compatibility issues
    (isCI ? it.skip : it)('searchConversations - baseline response structure', async () => {
      const result = await handlers.searchConversations({
        query: 'test query',
        limit: 10,
      });

      // Baseline structure
      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total_found');

      expect(result.query).toBe('test query');
      expect(Array.isArray(result.results)).toBe(true);
      expect(typeof result.total_found).toBe('number');
    });

    // Skip in CI - TransformersEmbeddings has environment compatibility issues
    (isCI ? it.skip : it)('getDecisions - baseline response structure', async () => {
      const result = await handlers.getDecisions({
        query: 'database',
        limit: 10,
      });

      // Baseline structure
      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('decisions');
      expect(result).toHaveProperty('total_found');

      expect(Array.isArray(result.decisions)).toBe(true);
    });

    it('checkBeforeModify - baseline response structure', async () => {
      const result = await handlers.checkBeforeModify({
        file_path: 'src/test.ts',
      });

      // Baseline structure
      expect(result).toHaveProperty('file_path');
      expect(result).toHaveProperty('warning');
      expect(result).toHaveProperty('recent_changes');
      expect(result).toHaveProperty('related_decisions');
      expect(result).toHaveProperty('mistakes_to_avoid');

      expect(result.file_path).toBe('src/test.ts');
    });

    it('getFileEvolution - baseline response structure', async () => {
      const result = await handlers.getFileEvolution({
        file_path: 'src/test.ts',
        include_decisions: true,
        include_commits: true,
      });

      // Baseline structure
      expect(result).toHaveProperty('file_path');
      expect(result).toHaveProperty('total_edits');
      expect(result).toHaveProperty('timeline');

      expect(Array.isArray(result.timeline)).toBe(true);
    });

    // Skip in CI - TransformersEmbeddings has environment compatibility issues
    (isCI ? it.skip : it)('searchMistakes - baseline response structure', async () => {
      const result = await handlers.searchMistakes({
        query: 'test',
        limit: 10,
      });

      // Baseline structure
      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('mistakes');
      expect(result).toHaveProperty('total_found');

      expect(Array.isArray(result.mistakes)).toBe(true);
    });

    it('getRequirements - baseline response structure', async () => {
      const result = await handlers.getRequirements({
        component: 'test-component',
      });

      // Baseline structure
      expect(result).toHaveProperty('component');
      expect(result).toHaveProperty('requirements');
      expect(result).toHaveProperty('total_found');

      expect(Array.isArray(result.requirements)).toBe(true);
    });

    // Skip in CI - TransformersEmbeddings has environment compatibility issues
    (isCI ? it.skip : it)('findSimilarSessions - baseline response structure', async () => {
      const result = await handlers.findSimilarSessions({
        query: 'authentication',
        limit: 5,
      });

      // Baseline structure
      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('sessions');
      expect(result).toHaveProperty('total_found');

      expect(Array.isArray(result.sessions)).toBe(true);
    });

    // Skip in CI - TransformersEmbeddings has environment compatibility issues
    (isCI ? it.skip : it)('recallAndApply - baseline response structure', async () => {
      const result = await handlers.recallAndApply({
        query: 'authentication',
        context_types: ['conversations', 'decisions'],
        limit: 5,
      });

      // Baseline structure (new in v0.6.0)
      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('context_summary');
      expect(result).toHaveProperty('recalled_context');
      expect(result).toHaveProperty('application_suggestions');
      expect(result).toHaveProperty('total_items_found');

      expect(typeof result.context_summary).toBe('string');
      expect(Array.isArray(result.application_suggestions)).toBe(true);
      expect(typeof result.total_items_found).toBe('number');
    });

    it('discoverOldConversations - baseline response structure', async () => {
      const result = await handlers.discoverOldConversations({
        current_project_path: '/tmp/test-project',
      });

      // Baseline structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('current_project_path');
      expect(result).toHaveProperty('candidates');
      expect(result).toHaveProperty('message');

      expect(Array.isArray(result.candidates)).toBe(true);
    });

    it.skip('migrateProject - dry run baseline behavior', async () => {
      // Skipped: Requires real source folder with conversation files
      // Migration validation intentionally rejects nonexistent paths
      // This is correct behavior - test would need actual test data
    });
  });

  describe('Data Integrity - Critical Workflows', () => {
    it('should maintain consistent behavior across index cycles', async () => {
      const memory = new ConversationMemory();
      const emptyPath = '/tmp/empty-test-' + Date.now();

      // First index
      await memory.indexConversations({
        projectPath: emptyPath,
      });
      const stats1 = memory.getStats();

      // Second index (should be idempotent)
      await memory.indexConversations({
        projectPath: emptyPath,
      });
      const stats2 = memory.getStats();

      // Should produce same results
      expect(stats1.conversations.count).toBe(stats2.conversations.count);
      expect(stats1.messages.count).toBe(stats2.messages.count);
    });
  });

  describe('Edge Cases - Must Handle Gracefully', () => {
    // Skip in CI - TransformersEmbeddings has environment compatibility issues
    (isCI ? it.skip : it)('should handle empty query in search', async () => {
      const memory = new ConversationMemory();

      // Empty query should still work
      const results = await memory.search('', 10);

      expect(Array.isArray(results)).toBe(true);
      // Empty query returns no results
      expect(results.length).toBe(0);
    });

    // Skip in CI - TransformersEmbeddings has environment compatibility issues
    (isCI ? it.skip : it)('should handle very large limit in search', async () => {
      const memory = new ConversationMemory();

      // Large limit should not crash
      const results = await memory.search('test', 10000);

      expect(Array.isArray(results)).toBe(true);
      // Should not throw or hang
    });

    it('should handle special characters in queries', async () => {
      const memory = new ConversationMemory();

      // Special characters should not break search
      const queries = [
        'emoji 🎉 test',
        'unicode 中文 test',
        'symbols !@#$%^&*()',
        'sql injection\'; DROP TABLE conversations; --',
      ];

      for (const query of queries) {
        const results = await memory.search(query, 10);
        expect(Array.isArray(results)).toBe(true);
      }
    });

    // Skip in CI - TransformersEmbeddings has environment compatibility issues
    (isCI ? it.skip : it)('should handle concurrent searches', async () => {
      const memory = new ConversationMemory();

      // Multiple concurrent searches should not conflict
      const promises = [
        memory.search('query1', 10),
        memory.search('query2', 10),
        memory.search('query3', 10),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(results.every(r => Array.isArray(r))).toBe(true);
    });
  });

  describe('Error Handling - Graceful Degradation', () => {
    it('should handle invalid project paths gracefully', async () => {
      const memory = new ConversationMemory();

      const invalidPaths = [
        '/invalid/path/that/does/not/exist',
        '',
        '/dev/null',
      ];

      for (const path of invalidPaths) {
        // Should not throw
        await memory.indexConversations({
          projectPath: path,
        });

        const stats = memory.getStats();
        expect(typeof stats.conversations.count).toBe('number');
      }
    });

    it('should handle missing tool handler arguments gracefully', async () => {
      resetSQLiteManager();
      const db = getSQLiteManager({ dbPath: testDbPath });
      const memory = new ConversationMemory();
      const handlers = new ToolHandlers(memory, db);

      // Missing required arguments should be handled gracefully
      // Note: Some handlers return default values instead of throwing
      const searchResult = await handlers.searchConversations({} as any);
      expect(searchResult).toHaveProperty('query');
      expect(searchResult).toHaveProperty('results');

      await expect(
        handlers.checkBeforeModify({} as any)
      ).rejects.toThrow();
    });
  });

  describe('Performance Baselines', () => {
    // Skip in CI - TransformersEmbeddings has environment compatibility issues
    (isCI ? it.skip : it)('search should complete in reasonable time', async () => {
      const memory = new ConversationMemory();

      const start = Date.now();
      await memory.search('test query', 10);
      const duration = Date.now() - start;

      // Should complete in under 5 seconds even on empty db
      expect(duration).toBeLessThan(5000);
    });

    it('indexConversations should complete in reasonable time', async () => {
      const memory = new ConversationMemory();

      const start = Date.now();
      await memory.indexConversations({
        projectPath: '/tmp/nonexistent',
      });
      const duration = Date.now() - start;

      // Should complete quickly for empty directory
      expect(duration).toBeLessThan(5000);
    });
  });
});
