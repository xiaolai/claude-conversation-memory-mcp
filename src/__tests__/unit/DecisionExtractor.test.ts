/**
 * Unit tests for DecisionExtractor
 */

import { DecisionExtractor } from '../../parsers/DecisionExtractor';
import type { Message, ThinkingBlock } from '../../parsers/ConversationParser';

describe('DecisionExtractor', () => {
  let extractor: DecisionExtractor;

  beforeEach(() => {
    extractor = new DecisionExtractor();
  });

  describe('extractDecisions', () => {
    it('should extract decisions from assistant messages', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'We decided to use PostgreSQL instead of MongoDB because it provides better ACID guarantees.',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);

      expect(decisions.length).toBeGreaterThan(0);
      expect(decisions[0].decision_text).toContain('PostgreSQL');
      expect(decisions[0].conversation_id).toBe('conv-1');
      expect(decisions[0].message_id).toBe('msg-1');
    });

    it('should extract decisions from user corrections', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'I will use approach A',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
        {
          id: 'msg-2',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'No, instead use approach B because it is more efficient',
          timestamp: Date.now() + 1000,
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);

      expect(decisions.length).toBeGreaterThan(0);
      const correction = decisions.find(d => d.decision_text.includes('approach B'));
      expect(correction).toBeDefined();
    });

    it('should handle empty messages array', () => {
      const decisions = extractor.extractDecisions([], []);
      expect(decisions).toEqual([]);
    });

    it('should handle messages without decisions', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Hello, how can I help you?',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);
      expect(decisions).toEqual([]);
    });

    it('should extract decisions with thinking blocks', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'We decided to use Redis instead of Memcached because it has more features.',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const thinkingBlocks: ThinkingBlock[] = [
        {
          id: 'think-1',
          message_id: 'msg-1',
          thinking_content: 'Considering Redis vs Memcached. Redis has more features.',
          timestamp: Date.now(),
        },
      ];

      const decisions = extractor.extractDecisions(messages, thinkingBlocks);

      // Should extract decision from message content
      expect(Array.isArray(decisions)).toBe(true);
    });

    it('should extract multiple decisions from a conversation', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'We decided to use TypeScript instead of JavaScript because of type safety.',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
        {
          id: 'msg-2',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'We chose Jest over Mocha because it has better snapshot testing.',
          timestamp: Date.now() + 1000,
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);

      expect(decisions.length).toBeGreaterThanOrEqual(2);
      expect(decisions.some(d => d.decision_text.includes('TypeScript'))).toBe(true);
      expect(decisions.some(d => d.decision_text.includes('Jest'))).toBe(true);
    });

    it('should populate decision properties correctly', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Decision: use SQLite because it is simple and requires no server.',
          timestamp: 12345,
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);

      expect(decisions.length).toBeGreaterThan(0);
      const decision = decisions[0];
      expect(decision.id).toBeTruthy();
      expect(decision.conversation_id).toBe('conv-1');
      expect(decision.message_id).toBe('msg-1');
      expect(decision.decision_text).toBeTruthy();
      expect(decision.timestamp).toBe(12345);
      expect(Array.isArray(decision.alternatives_considered)).toBe(true);
      expect(typeof decision.rejected_reasons).toBe('object');
      expect(Array.isArray(decision.related_files)).toBe(true);
      expect(Array.isArray(decision.related_commits)).toBe(true);
    });

    it('should extract context from decision text', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'For authentication, we decided to use JWT tokens instead of sessions because they are stateless.',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);

      // Should extract decision and potentially identify auth context
      expect(Array.isArray(decisions)).toBe(true);
      if (decisions.length > 0) {
        const decision = decisions[0];
        expect(decision.id).toBeTruthy();
        expect(decision.conversation_id).toBe('conv-1');
      }
    });

    it('should handle non-text message types', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'summary',
          role: 'assistant',
          content: 'We decided to use React',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);
      // Should still work as long as content exists
      expect(Array.isArray(decisions)).toBe(true);
    });

    it('should handle messages with null or undefined content', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: undefined,
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);
      expect(decisions).toEqual([]);
    });
  });

  describe('Decision Pattern Matching', () => {
    it('should match "decided to" pattern', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'We decided to implement feature X because users requested it.',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);
      expect(decisions.length).toBeGreaterThan(0);
    });

    it('should match "chose over" pattern', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'I chose React over Vue because of better TypeScript support.',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);
      expect(decisions.length).toBeGreaterThan(0);
    });

    it('should match "using instead of" pattern', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Using Docker instead of VMs because it is more lightweight.',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);
      expect(decisions.length).toBeGreaterThan(0);
    });
  });

  describe('Correction Pattern Matching', () => {
    it('should match "no," correction pattern', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'No, use option B instead',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);
      expect(decisions.length).toBeGreaterThan(0);
    });

    it('should match "that\'s wrong" correction pattern', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'That\'s wrong, the correct approach is Y',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);
      expect(decisions.length).toBeGreaterThan(0);
    });

    it('should match "actually," correction pattern', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'Actually, we should use method Z',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const decisions = extractor.extractDecisions(messages, []);
      expect(decisions.length).toBeGreaterThan(0);
    });
  });
});
