/**
 * Unit tests for ToolHandlers
 */

import { ToolHandlers } from '../../tools/ToolHandlers.js';
import { ConversationMemory } from '../../ConversationMemory.js';
import { getSQLiteManager, resetSQLiteManager } from '../../storage/SQLiteManager.js';

describe('ToolHandlers', () => {
  let handlers: ToolHandlers;
  let memory: ConversationMemory;

  beforeEach(() => {
    memory = new ConversationMemory();
    const db = getSQLiteManager({ dbPath: ':memory:' });
    handlers = new ToolHandlers(memory, db);
  });

  afterEach(() => {
    resetSQLiteManager();
  });

  // Skip semantic search tests - embeddings are optional and may not work in test environment
  describe.skip('searchConversations', () => {
    it('should return properly typed search results', async () => {
      const result = await handlers.searchConversations({
        query: 'test query',
        limit: 10,
      });

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total_found');
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const result = await handlers.searchConversations({
        query: 'test',
        limit: 5,
      });

      expect(result.results.length).toBeLessThanOrEqual(5);
    });

    it('should handle date_range filter', async () => {
      const now = Date.now();
      const result = await handlers.searchConversations({
        query: 'test',
        limit: 10,
        date_range: [now - 86400000, now], // Last 24 hours
      });

      expect(result).toBeDefined();
    });
  });

  describe.skip('getDecisions', () => {
    it('should return properly typed decision results', async () => {
      const result = await handlers.getDecisions({
        query: 'authentication',
        limit: 10,
      });

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('decisions');
      expect(result).toHaveProperty('total_found');
      expect(Array.isArray(result.decisions)).toBe(true);
    });

    it('should filter by file_path when provided', async () => {
      const result = await handlers.getDecisions({
        query: 'authentication',
        file_path: 'src/auth/token.ts',
        limit: 10,
      });

      expect(result.file_path).toBe('src/auth/token.ts');
    });
  });

  describe('checkBeforeModify', () => {
    it('should return file context information', async () => {
      const result = await handlers.checkBeforeModify({
        file_path: 'src/auth/token.ts',
      });

      expect(result).toHaveProperty('file_path');
      expect(result).toHaveProperty('warning');
      expect(result).toHaveProperty('recent_changes');
      expect(result).toHaveProperty('related_decisions');
      expect(result).toHaveProperty('mistakes_to_avoid');
    });

    it('should have properly structured recent_changes', async () => {
      const result = await handlers.checkBeforeModify({
        file_path: 'test.ts',
      });

      expect(result.recent_changes).toHaveProperty('edits');
      expect(result.recent_changes).toHaveProperty('commits');
      expect(Array.isArray(result.recent_changes.edits)).toBe(true);
      expect(Array.isArray(result.recent_changes.commits)).toBe(true);
    });
  });

  describe('getFileEvolution', () => {
    it('should return timeline with events', async () => {
      const result = await handlers.getFileEvolution({
        file_path: 'src/index.ts',
        include_decisions: true,
        include_commits: true,
      });

      expect(result).toHaveProperty('file_path');
      expect(result).toHaveProperty('total_edits');
      expect(result).toHaveProperty('timeline');
      expect(Array.isArray(result.timeline)).toBe(true);
    });

    it('should exclude decisions when requested', async () => {
      const result = await handlers.getFileEvolution({
        file_path: 'src/index.ts',
        include_decisions: false,
      });

      const decisionEvents = result.timeline.filter(e => e.type === 'decision');
      expect(decisionEvents.length).toBe(0);
    });

    it('should exclude commits when requested', async () => {
      const result = await handlers.getFileEvolution({
        file_path: 'src/index.ts',
        include_commits: false,
      });

      const commitEvents = result.timeline.filter(e => e.type === 'commit');
      expect(commitEvents.length).toBe(0);
    });
  });

  describe('searchMistakes', () => {
    it('should return properly typed mistake results', async () => {
      const result = await handlers.searchMistakes({
        query: 'error',
        limit: 10,
      });

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('mistakes');
      expect(result).toHaveProperty('total_found');
      expect(Array.isArray(result.mistakes)).toBe(true);
    });

    it('should filter by mistake_type when provided', async () => {
      const result = await handlers.searchMistakes({
        query: 'error',
        mistake_type: 'logic_error',
        limit: 10,
      });

      expect(result.mistake_type).toBe('logic_error');
    });

    it('should sanitize query to prevent SQL injection', async () => {
      // Should not throw or cause issues
      await expect(handlers.searchMistakes({
        query: "test'; DROP TABLE mistakes; --",
        limit: 10,
      })).resolves.toBeDefined();
    });
  });

  describe('getRequirements', () => {
    it('should return requirements for component', async () => {
      const result = await handlers.getRequirements({
        component: 'authentication',
      });

      expect(result).toHaveProperty('component');
      expect(result).toHaveProperty('requirements');
      expect(result).toHaveProperty('total_found');
      expect(Array.isArray(result.requirements)).toBe(true);
    });

    it('should filter by type when provided', async () => {
      const result = await handlers.getRequirements({
        component: 'auth',
        type: 'security',
      });

      expect(result.type).toBe('security');
    });

    it('should sanitize component name to prevent SQL injection', async () => {
      await expect(handlers.getRequirements({
        component: "test%' OR '1'='1",
      })).resolves.toBeDefined();
    });
  });

  describe('getToolHistory', () => {
    it('should return tool usage history', async () => {
      const result = await handlers.getToolHistory({
        limit: 20,
      });

      expect(result).toHaveProperty('tool_uses');
      expect(result).toHaveProperty('total_found');
      expect(Array.isArray(result.tool_uses)).toBe(true);
    });

    it('should filter by tool_name when provided', async () => {
      const result = await handlers.getToolHistory({
        tool_name: 'Bash',
        limit: 20,
      });

      expect(result.tool_name).toBe('Bash');
    });

    it('should filter by file_path when provided', async () => {
      const result = await handlers.getToolHistory({
        file_path: 'src/index.ts',
        limit: 20,
      });

      expect(result.file_path).toBe('src/index.ts');
    });
  });

  describe.skip('findSimilarSessions', () => {
    it('should return similar sessions grouped by conversation', async () => {
      const result = await handlers.findSimilarSessions({
        query: 'authentication',
        limit: 5,
      });

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('sessions');
      expect(result).toHaveProperty('total_found');
      expect(Array.isArray(result.sessions)).toBe(true);
      expect(result.sessions.length).toBeLessThanOrEqual(5);
    });

    it('should include relevant messages in each session', async () => {
      const result = await handlers.findSimilarSessions({
        query: 'test',
        limit: 3,
      });

      if (result.sessions.length > 0) {
        expect(result.sessions[0]).toHaveProperty('relevant_messages');
        expect(Array.isArray(result.sessions[0].relevant_messages)).toBe(true);
      }
    });
  });
});
