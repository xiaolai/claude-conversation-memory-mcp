/**
 * Integration tests - End-to-end workflows
 */

import { ConversationMemory } from '../../ConversationMemory.js';
import { resetSQLiteManager } from '../../storage/SQLiteManager.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('End-to-End Integration', () => {
  let memory: ConversationMemory;
  let testDir: string;

  beforeEach(() => {
    memory = new ConversationMemory();
    // Create temporary test directory
    testDir = join(tmpdir(), `claude-memory-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    resetSQLiteManager();
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('Conversation Indexing Workflow', () => {
    it('should handle empty project directory gracefully', async () => {
      // This test verifies the system handles missing conversation files
      await expect(memory.indexConversations({
        projectPath: testDir,
        includeThinking: false,
        enableGitIntegration: false,
      })).rejects.toThrow(); // Should throw because directory structure doesn't exist
    });

    it('should collect statistics after indexing', () => {
      const stats = memory.getStats();

      expect(stats).toHaveProperty('conversations');
      expect(stats).toHaveProperty('messages');
      expect(stats).toHaveProperty('decisions');
      expect(stats).toHaveProperty('mistakes');
      expect(stats).toHaveProperty('git_commits');
    });
  });

  // Skip search tests - embeddings are optional and may not work in test environment
  describe.skip('Search Workflow', () => {
    it('should return empty results for new database', async () => {
      const results = await memory.search('test query', 10);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('should handle search with no results gracefully', async () => {
      const results = await memory.searchDecisions('nonexistent query', 10);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });

  describe('File Timeline Workflow', () => {
    it('should return empty timeline for non-indexed files', () => {
      const timeline = memory.getFileTimeline('src/nonexistent.ts');

      expect(timeline).toHaveProperty('file_path');
      expect(timeline).toHaveProperty('edits');
      expect(timeline).toHaveProperty('commits');
      expect(timeline).toHaveProperty('decisions');
      expect(Array.isArray(timeline.edits)).toBe(true);
      expect(Array.isArray(timeline.commits)).toBe(true);
      expect(Array.isArray(timeline.decisions)).toBe(true);
    });

    it('should handle file paths with special characters', () => {
      // Should not throw or cause SQL errors
      expect(() => {
        memory.getFileTimeline('src/file%with_special"chars.ts');
      }).not.toThrow();
    });
  });

  describe('Component Integration', () => {
    it('should have working storage instance', () => {
      const storage = memory.getStorage();
      expect(storage).toBeDefined();

      const stats = storage.getStats();
      expect(stats).toHaveProperty('conversations');
    });

    it('should have working semantic search instance', () => {
      const search = memory.getSemanticSearch();
      expect(search).toBeDefined();

      const stats = search.getStats();
      expect(stats).toHaveProperty('total_embeddings');
      expect(stats).toHaveProperty('vec_enabled');
    });
  });
});
