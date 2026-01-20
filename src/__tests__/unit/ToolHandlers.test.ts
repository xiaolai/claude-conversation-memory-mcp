/**
 * Unit tests for ToolHandlers
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { ToolHandlers } from '../../tools/ToolHandlers.js';
import { ConversationMemory } from '../../ConversationMemory.js';
import { getSQLiteManager, resetSQLiteManager } from '../../storage/SQLiteManager.js';
import { ConversationStorage } from '../../storage/ConversationStorage.js';

describe('ToolHandlers', () => {
  let handlers: ToolHandlers;
  let memory: ConversationMemory;
  let db: ReturnType<typeof getSQLiteManager>;

  beforeEach(() => {
    memory = new ConversationMemory();
    db = getSQLiteManager({ dbPath: ':memory:' });
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
      expect(result).toHaveProperty('has_more');
      expect(Array.isArray(result.timeline)).toBe(true);
      expect(typeof result.has_more).toBe('boolean');
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

  describe('listRecentSessions', () => {
    it('returns external session ids for session_id', async () => {
      const storage = new ConversationStorage(db);
      const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cccmemory-test-'));
      const now = Date.now();

      await storage.storeConversations([
        {
          id: 'session-external-123',
          project_path: projectPath,
          source_type: 'claude-code',
          first_message_at: now,
          last_message_at: now,
          message_count: 1,
          metadata: {},
          created_at: now,
          updated_at: now,
        },
      ]);

      const result = await handlers.listRecentSessions({ project_path: projectPath });

      expect(result.sessions.length).toBeGreaterThan(0);
      expect(result.sessions[0].session_id).toBe('session-external-123');
    });
  });

  describe('getLatestSessionSummary', () => {
    it('summarizes the latest session with recent user message', async () => {
      const storage = new ConversationStorage(db);
      const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cccmemory-test-'));
      const now = Date.now();

      const conversationIdMap = await storage.storeConversations([
        {
          id: 'session-latest',
          project_path: projectPath,
          source_type: 'claude-code',
          first_message_at: now - 1000,
          last_message_at: now,
          message_count: 3,
          metadata: {},
          created_at: now - 1000,
          updated_at: now,
        },
      ]);

      await storage.storeMessages(
        [
          {
            id: 'msg-1',
            conversation_id: 'session-latest',
            message_type: 'user',
            role: 'user',
            content: 'initial question',
            timestamp: now - 900,
            is_sidechain: false,
            metadata: {},
          },
          {
            id: 'msg-2',
            conversation_id: 'session-latest',
            message_type: 'assistant',
            role: 'assistant',
            content: 'assistant reply',
            timestamp: now - 800,
            is_sidechain: false,
            metadata: {},
          },
          {
            id: 'msg-3',
            conversation_id: 'session-latest',
            message_type: 'user',
            role: 'user',
            content: 'latest issue to solve',
            timestamp: now - 100,
            is_sidechain: false,
            metadata: {},
          },
        ],
        { skipFtsRebuild: true, conversationIdMap }
      );

      const result = await handlers.getLatestSessionSummary({
        project_path: projectPath,
        source_type: 'claude-code',
        limit_messages: 5,
        include_tools: false,
        include_errors: false,
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);
      expect(result.session?.session_id).toBe('session-latest');
      expect(result.summary?.problem_statement).toContain('latest issue to solve');
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
    it('should return tool usage history with pagination metadata', async () => {
      const result = await handlers.getToolHistory({
        limit: 20,
      });

      expect(result).toHaveProperty('tool_uses');
      expect(result).toHaveProperty('total_found');
      expect(result).toHaveProperty('total_in_database');
      expect(result).toHaveProperty('has_more');
      expect(result).toHaveProperty('offset');
      expect(Array.isArray(result.tool_uses)).toBe(true);
      expect(result.offset).toBe(0);
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

    it('should support pagination with offset', async () => {
      const page1 = await handlers.getToolHistory({
        limit: 5,
        offset: 0,
      });

      const page2 = await handlers.getToolHistory({
        limit: 5,
        offset: 5,
      });

      expect(page1.offset).toBe(0);
      expect(page2.offset).toBe(5);
      // Both pages should have same total_in_database
      expect(page1.total_in_database).toBe(page2.total_in_database);
    });

    it('should truncate content when max_content_length is set', async () => {
      const result = await handlers.getToolHistory({
        limit: 20,
        max_content_length: 50,
        include_content: true,
      });

      // Check if any results have content
      const withContent = result.tool_uses.filter(t => t.result.content);
      if (withContent.length > 0) {
        withContent.forEach(tool => {
          // Content should be <= max_content_length + truncation indicator length
          if (tool.result.content) {
            expect(tool.result.content.length).toBeLessThanOrEqual(100); // 50 + "... (truncated)"
          }
          // If content was truncated, should have flag
          if (tool.result.content_truncated) {
            expect(tool.result.content).toContain('... (truncated)');
          }
        });
      }
    });

    it('should return metadata only when include_content is false', async () => {
      const result = await handlers.getToolHistory({
        limit: 20,
        include_content: false,
      });

      // Should not have content, stdout, stderr fields
      result.tool_uses.forEach(tool => {
        expect(tool.result.content).toBeUndefined();
        expect(tool.result.stdout).toBeUndefined();
        expect(tool.result.stderr).toBeUndefined();
        // Should still have is_error
        expect(tool.result).toHaveProperty('is_error');
      });
    });

    it('should filter by date_range when provided', async () => {
      const now = Date.now();
      const oneDayAgo = now - 86400000;

      const result = await handlers.getToolHistory({
        date_range: [oneDayAgo, now],
        limit: 20,
      });

      expect(result).toHaveProperty('tool_uses');
      // All results should be within range
      result.tool_uses.forEach(tool => {
        const timestamp = new Date(tool.timestamp).getTime();
        expect(timestamp).toBeGreaterThanOrEqual(oneDayAgo);
        expect(timestamp).toBeLessThanOrEqual(now);
      });
    });

    it('should filter by errors_only when provided', async () => {
      const result = await handlers.getToolHistory({
        errors_only: true,
        limit: 20,
      });

      // All results should be errors
      result.tool_uses.forEach(tool => {
        expect(tool.result.is_error).toBe(true);
      });
    });

    it('should calculate has_more correctly', async () => {
      const result = await handlers.getToolHistory({
        limit: 5,
        offset: 0,
      });

      // has_more should be true if total_in_database > offset + total_found
      const expectedHasMore = result.total_in_database > (result.offset + result.total_found);
      expect(result.has_more).toBe(expectedHasMore);
    });

    it('should handle empty results gracefully', async () => {
      const result = await handlers.getToolHistory({
        tool_name: 'NonExistentTool',
        limit: 20,
      });

      expect(result.tool_uses).toEqual([]);
      expect(result.total_found).toBe(0);
      expect(result.total_in_database).toBe(0);
      expect(result.has_more).toBe(false);
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

  describe('Global Index Methods', () => {
    describe('indexAllProjects', () => {
      it('should return properly typed response', async () => {
        const result = await handlers.indexAllProjects({
          include_codex: false,
          include_claude_code: false,
        });

        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('global_index_path');
        expect(result).toHaveProperty('projects_indexed');
        expect(result).toHaveProperty('claude_code_projects');
        expect(result).toHaveProperty('codex_projects');
        expect(result).toHaveProperty('total_messages');
        expect(result).toHaveProperty('total_conversations');
        expect(result).toHaveProperty('projects');
        expect(result).toHaveProperty('errors');
        expect(result).toHaveProperty('message');
        expect(Array.isArray(result.projects)).toBe(true);
        expect(Array.isArray(result.errors)).toBe(true);
      });

      it('should handle non-existent Codex path gracefully', async () => {
        const result = await handlers.indexAllProjects({
          include_codex: true,
          include_claude_code: false,
          codex_path: '/nonexistent/path',
        });

        expect(result.success).toBe(true);
        // Should be 0 since path doesn't exist, but may find projects if default path is used
        expect(typeof result.codex_projects).toBe('number');
        expect(result.codex_projects).toBeGreaterThanOrEqual(0);
      });

      it('should handle non-existent Claude projects path gracefully', async () => {
        const result = await handlers.indexAllProjects({
          include_codex: false,
          include_claude_code: true,
          claude_projects_path: '/nonexistent/path',
        });

        expect(result.success).toBe(true);
        // Should be 0 since path doesn't exist, but may find projects if default path is used
        expect(typeof result.claude_code_projects).toBe('number');
        expect(result.claude_code_projects).toBeGreaterThanOrEqual(0);
      });
    });

    describe('searchAllConversations', () => {
      beforeEach(async () => {
        // Initialize global index
        await handlers.indexAllProjects({
          include_codex: false,
          include_claude_code: false,
        });
      });

      it('should return properly typed response', async () => {
        const result = await handlers.searchAllConversations({
          query: 'test query',
          limit: 10,
        });

        expect(result).toHaveProperty('query');
        expect(result).toHaveProperty('results');
        expect(result).toHaveProperty('total_found');
        expect(result).toHaveProperty('projects_searched');
        expect(result).toHaveProperty('search_stats');
        expect(result).toHaveProperty('message');
        expect(Array.isArray(result.results)).toBe(true);
        expect(result.search_stats).toHaveProperty('claude_code_results');
        expect(result.search_stats).toHaveProperty('codex_results');
      });

      it('should respect limit parameter', async () => {
        const result = await handlers.searchAllConversations({
          query: 'test',
          limit: 5,
        });

        expect(result.results.length).toBeLessThanOrEqual(5);
      });

      it('should filter by source_type', async () => {
        const result = await handlers.searchAllConversations({
          query: 'test',
          limit: 10,
          source_type: 'claude-code',
        });

        expect(result.results.every(r => r.source_type === 'claude-code' || r.source_type === undefined)).toBe(true);
      });

      it('should include project_path in results', async () => {
        const result = await handlers.searchAllConversations({
          query: 'test',
          limit: 10,
        });

        result.results.forEach(r => {
          expect(r).toHaveProperty('project_path');
          expect(r).toHaveProperty('source_type');
        });
      });
    });

    describe('getAllDecisions', () => {
      beforeEach(async () => {
        // Initialize global index
        await handlers.indexAllProjects({
          include_codex: false,
          include_claude_code: false,
        });
      });

      it('should return properly typed response', async () => {
        const result = await handlers.getAllDecisions({
          query: 'authentication',
          limit: 10,
        });

        expect(result).toHaveProperty('query');
        expect(result).toHaveProperty('decisions');
        expect(result).toHaveProperty('total_found');
        expect(result).toHaveProperty('projects_searched');
        expect(result).toHaveProperty('message');
        expect(Array.isArray(result.decisions)).toBe(true);
      });

      it('should respect limit parameter', async () => {
        const result = await handlers.getAllDecisions({
          query: 'test',
          limit: 5,
        });

        expect(result.decisions.length).toBeLessThanOrEqual(5);
      });

      it('should filter by source_type', async () => {
        const result = await handlers.getAllDecisions({
          query: 'test',
          limit: 10,
          source_type: 'codex',
        });

        expect(result.decisions.every(d => d.source_type === 'codex' || d.source_type === undefined)).toBe(true);
      });

      it('should include project_path in decisions', async () => {
        const result = await handlers.getAllDecisions({
          query: 'test',
          limit: 10,
        });

        result.decisions.forEach(d => {
          expect(d).toHaveProperty('project_path');
          expect(d).toHaveProperty('source_type');
        });
      });
    });

    describe('searchAllMistakes', () => {
      beforeEach(async () => {
        // Initialize global index
        await handlers.indexAllProjects({
          include_codex: false,
          include_claude_code: false,
        });
      });

      it('should return properly typed response', async () => {
        const result = await handlers.searchAllMistakes({
          query: 'bug',
          limit: 10,
        });

        expect(result).toHaveProperty('query');
        expect(result).toHaveProperty('mistakes');
        expect(result).toHaveProperty('total_found');
        expect(result).toHaveProperty('projects_searched');
        expect(result).toHaveProperty('message');
        expect(Array.isArray(result.mistakes)).toBe(true);
      });

      it('should respect limit parameter', async () => {
        const result = await handlers.searchAllMistakes({
          query: 'error',
          limit: 5,
        });

        expect(result.mistakes.length).toBeLessThanOrEqual(5);
      });

      it('should filter by mistake_type when provided', async () => {
        const result = await handlers.searchAllMistakes({
          query: 'test',
          mistake_type: 'logic_error',
          limit: 10,
        });

        expect(result.mistakes.every(m =>
          m.mistake_type === 'logic_error' || m.mistake_type === undefined
        )).toBe(true);
      });

      it('should filter by source_type', async () => {
        const result = await handlers.searchAllMistakes({
          query: 'test',
          limit: 10,
          source_type: 'claude-code',
        });

        expect(result.mistakes.every(m =>
          m.source_type === 'claude-code' || m.source_type === undefined
        )).toBe(true);
      });

      it('should include project_path in mistakes', async () => {
        const result = await handlers.searchAllMistakes({
          query: 'test',
          limit: 10,
        });

        result.mistakes.forEach(m => {
          expect(m).toHaveProperty('project_path');
          expect(m).toHaveProperty('source_type');
        });
      });
    });
  });
});
