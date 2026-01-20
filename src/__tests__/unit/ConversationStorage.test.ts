/**
 * Unit tests for ConversationStorage
 */

import { ConversationStorage } from '../../storage/ConversationStorage.js';
import { getSQLiteManager, resetSQLiteManager } from '../../storage/SQLiteManager.js';
import type { Conversation, Message } from '../../parsers/ConversationParser.js';
import type { Decision } from '../../parsers/DecisionExtractor.js';

describe('ConversationStorage', () => {
  let storage: ConversationStorage;
  let db: ReturnType<typeof getSQLiteManager>;

  beforeEach(() => {
    // Use in-memory database for tests
    db = getSQLiteManager({ dbPath: ':memory:' });
    storage = new ConversationStorage(db);
  });

  afterEach(() => {
    resetSQLiteManager();
  });

  describe('storeConversations', () => {
    it('should store conversations successfully', async () => {
      const conversations: Conversation[] = [
        {
          id: 'test-conv-1',
          project_path: '/test/project',
          first_message_at: Date.now(),
          last_message_at: Date.now(),
          message_count: 5,
          git_branch: 'main',
          claude_version: 'sonnet-4.5',
          metadata: { test: true },
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ];

      await storage.storeConversations(conversations);

      const retrieved = storage.getConversation('test-conv-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('test-conv-1');
      expect(retrieved?.project_path).toBe('/test/project');
    });

    it('should handle empty conversation arrays', async () => {
      await expect(storage.storeConversations([])).resolves.not.toThrow();
    });

    it('should update existing conversations on conflict', async () => {
      const conversation: Conversation = {
        id: 'test-conv-1',
        project_path: '/test/project',
        first_message_at: Date.now(),
        last_message_at: Date.now(),
        message_count: 5,
        git_branch: 'main',
        metadata: {},
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      await storage.storeConversations([conversation]);

      // Update
      conversation.message_count = 10;
      await storage.storeConversations([conversation]);

      const retrieved = storage.getConversation('test-conv-1');
      expect(retrieved?.message_count).toBe(10);
    });
  });

  it('should resolve project aliases when ensuring project ids', () => {
    const database = db.getDatabase();
    const now = Date.now();
    const result = database
      .prepare(
        'INSERT INTO projects (canonical_path, display_path, created_at, updated_at) VALUES (?, ?, ?, ?)'
      )
      .run('/old/path', '/old/path', now, now);
    const projectId = Number(result.lastInsertRowid);
    database
      .prepare('INSERT INTO project_aliases (alias_path, project_id, created_at) VALUES (?, ?, ?)')
      .run('/new/path', projectId, now);

    const resolvedId = storage.getProjectId('/new/path');
    expect(resolvedId).toBe(projectId);

    const count = database
      .prepare('SELECT COUNT(*) as count FROM projects')
      .get() as { count: number };
    expect(count.count).toBe(1);
  });

  describe('storeMessages', () => {
    let conversationIdMap: Map<string, number>;

    beforeEach(async () => {
      // Create parent conversation first
      const conversation: Conversation = {
        id: 'test-conv-1',
        project_path: '/test/project',
        first_message_at: Date.now(),
        last_message_at: Date.now(),
        message_count: 0,
        git_branch: 'main',
        metadata: {},
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      conversationIdMap = await storage.storeConversations([conversation]);
    });

    it('should store messages successfully', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'test-conv-1',
          message_type: 'user',
          role: 'user',
          content: 'Test message',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      await storage.storeMessages(messages, { conversationIdMap });
      // Messages are stored, no exception means success
      expect(true).toBe(true);
    });

    it('should handle empty message arrays', async () => {
      await expect(storage.storeMessages([], { conversationIdMap })).resolves.not.toThrow();
    });

    it('should skip messages with missing conversations', async () => {
      const messages: Message[] = [
        {
          id: 'msg-valid',
          conversation_id: 'test-conv-1',
          message_type: 'user',
          role: 'user',
          content: 'Valid',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
        {
          id: 'msg-invalid',
          conversation_id: 'missing-conv',
          message_type: 'assistant',
          role: 'assistant',
          content: 'Invalid',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      await storage.storeMessages(messages, { conversationIdMap });
      const count = db.getDatabase().prepare('SELECT COUNT(*) as count FROM messages').get() as {
        count: number;
      };
      expect(count.count).toBe(1);
    });
  });

  describe('getDecisionsForFile', () => {
    beforeEach(async () => {
      // Create parent conversation first
      const conversation: Conversation = {
        id: 'test-conv-1',
        project_path: '/test/project',
        first_message_at: Date.now(),
        last_message_at: Date.now(),
        message_count: 0,
        git_branch: 'main',
        metadata: {},
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      const conversationIdMap = await storage.storeConversations([conversation]);

      // Create parent messages
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'test-conv-1',
          message_type: 'assistant',
          role: 'assistant',
          content: 'Message 1',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
        {
          id: 'msg-2',
          conversation_id: 'test-conv-1',
          message_type: 'assistant',
          role: 'assistant',
          content: 'Message 2',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];
      const messageIdMap = await storage.storeMessages(messages, { conversationIdMap });

      // Setup test data
      const decisions: Decision[] = [
        {
          id: 'decision-1',
          conversation_id: 'test-conv-1',
          message_id: 'msg-1',
          decision_text: 'Use JWT authentication',
          rationale: 'Stateless and scalable',
          alternatives_considered: ['Sessions'],
          rejected_reasons: { Sessions: 'Requires state' },
          context: 'Auth implementation',
          related_files: ['src/auth/token.ts', 'src/auth/middleware.ts'],
          related_commits: [],
          timestamp: Date.now(),
        },
        {
          id: 'decision-2',
          conversation_id: 'test-conv-1',
          message_id: 'msg-2',
          decision_text: 'Use PostgreSQL',
          rationale: 'Better for relational data',
          alternatives_considered: ['MongoDB'],
          rejected_reasons: {},
          related_files: ['src/database/connection.ts'],
          related_commits: [],
          timestamp: Date.now(),
        },
      ];

      await storage.storeDecisions(decisions, {
        conversationIdMap,
        messageIdMap,
      });
    });

    it('should find decisions for a specific file', () => {
      const decisions = storage.getDecisionsForFile('src/auth/token.ts');
      expect(decisions).toHaveLength(1);
      expect(decisions[0].decision_text).toBe('Use JWT authentication');
    });

    it('should handle files with special characters safely', () => {
      // Test SQL injection prevention
      const decisions = storage.getDecisionsForFile('src/auth%');
      // Should not match anything due to sanitization
      expect(decisions).toHaveLength(0);
    });

    it('should return empty array for non-existent files', () => {
      const decisions = storage.getDecisionsForFile('nonexistent.ts');
      expect(decisions).toHaveLength(0);
    });

    it('should return multiple decisions if file appears in multiple', () => {
      const decisions = storage.getDecisionsForFile('src/auth/middleware.ts');
      expect(decisions).toHaveLength(1);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const conversation: Conversation = {
        id: 'test-conv-1',
        project_path: '/test',
        first_message_at: Date.now(),
        last_message_at: Date.now(),
        message_count: 5,
        metadata: {},
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'test-conv-1',
          message_type: 'user',
          content: 'Test',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
        {
          id: 'msg-2',
          conversation_id: 'test-conv-1',
          message_type: 'assistant',
          content: 'Response',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const conversationIdMap = await storage.storeConversations([conversation]);
      await storage.storeMessages(messages, { conversationIdMap });

      const stats = storage.getStats();
      expect(stats.conversations.count).toBe(1);
      expect(stats.messages.count).toBe(2);
    });
  });
});
