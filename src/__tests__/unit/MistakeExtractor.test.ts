/**
 * Unit tests for MistakeExtractor
 */

import { MistakeExtractor } from '../../parsers/MistakeExtractor';
import type { Message, ToolResult } from '../../parsers/ConversationParser';

describe('MistakeExtractor', () => {
  let extractor: MistakeExtractor;

  beforeEach(() => {
    extractor = new MistakeExtractor();
  });

  describe('extractMistakes', () => {
    it('should extract mistakes from tool errors', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Running the test',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const toolResults: ToolResult[] = [
        {
          id: 'tool-1',
          tool_use_id: 'use-1',
          message_id: 'msg-1',
          content: 'TypeError: undefined is not a function',
          stdout: '',
          stderr: 'TypeError: undefined is not a function at src/app.ts:42',
          is_error: true,
          is_image: false,
          timestamp: Date.now(),
        },
      ];

      const mistakes = extractor.extractMistakes(messages, toolResults);

      // Tool errors are always extracted (no min severity for real errors)
      expect(mistakes.length).toBeGreaterThan(0);
      expect(mistakes[0].mistake_type).toBe('tool_error');
      expect(mistakes[0].what_went_wrong).toContain('TypeError');
    });

    it('should extract mistakes from user corrections', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'I will use the legacy database approach',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
        {
          id: 'msg-2',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: "That's wrong, you should use the new API endpoint instead because it has better caching.",
          timestamp: Date.now() + 1000,
          is_sidechain: false,
          metadata: {},
        },
      ];

      const mistakes = extractor.extractMistakes(messages, []);

      // Stricter patterns require technical context and explicit correction
      expect(mistakes.length).toBeGreaterThan(0);
      const correction = mistakes.find(m => m.user_correction_message);
      expect(correction).toBeDefined();
      // "should use" pattern triggers wrong_approach classification
      expect(correction?.mistake_type).toBe('wrong_approach');
    });

    it('should extract mistakes from error discussions', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Error: The function broke because of incorrect logic. This is a logic error.',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const mistakes = extractor.extractMistakes(messages, []);

      expect(mistakes.length).toBeGreaterThan(0);
      expect(mistakes[0].mistake_type).toBe('logic_error');
    });

    it('should handle empty inputs', () => {
      const mistakes = extractor.extractMistakes([], []);
      expect(mistakes).toEqual([]);
    });

    it('should deduplicate similar mistakes from same message', () => {
      // Test deduplication: same message_id, same content prefix, same timestamp
      // The new signature includes message_id to prevent collisions, so we test
      // that duplicates from the same message are properly deduped
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Error: This broke. Error: This broke again.',
          timestamp: 12345,
          is_sidechain: false,
          metadata: {},
        },
      ];

      const mistakes = extractor.extractMistakes(messages, []);

      // Multiple errors from same message with same signature should dedupe
      expect(mistakes.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Mistake Type Classification', () => {
    it('should classify logic errors', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Error: TypeError caused by a logic error in the condition. The function returned undefined.',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const mistakes = extractor.extractMistakes(messages, []);

      // Stricter ERROR_INDICATORS require explicit error patterns
      expect(mistakes.length).toBeGreaterThan(0);
      expect(mistakes[0].mistake_type).toBe('logic_error');
    });

    it('should classify wrong approach', () => {
      const messages: Message[] = [
        {
          id: 'msg-0',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Let me implement it',
          timestamp: Date.now() - 1000,
          is_sidechain: false,
          metadata: {},
        },
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'No, that is the wrong approach. We should use the better way.',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const mistakes = extractor.extractMistakes(messages, []);

      expect(Array.isArray(mistakes)).toBe(true);
      if (mistakes.length > 0) {
        expect(mistakes[0].mistake_type).toBe('wrong_approach');
      }
    });

    it('should classify misunderstandings', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'I misunderstood the requirement. Error: This didn\'t work.',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const mistakes = extractor.extractMistakes(messages, []);

      expect(Array.isArray(mistakes)).toBe(true);
      expect(mistakes.length).toBeGreaterThan(0);
      // Note: May be classified as logic_error or misunderstanding depending on pattern matching order
      expect(['misunderstanding', 'logic_error']).toContain(mistakes[0].mistake_type);
    });

    it('should classify syntax errors', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Error: Got a syntax error in the code. This is broken.',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const mistakes = extractor.extractMistakes(messages, []);

      expect(Array.isArray(mistakes)).toBe(true);
      if (mistakes.length > 0) {
        expect(mistakes[0].mistake_type).toBe('syntax_error');
      }
    });
  });

  describe('Correction Extraction', () => {
    it('should extract corrections with explicit error message', () => {
      // Stricter patterns require explicit correction indicators like "that's wrong"
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Using method A',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
        {
          id: 'msg-2',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: "That's wrong, you should use method B for better performance.",
          timestamp: Date.now() + 1000,
          is_sidechain: false,
          metadata: {},
        },
      ];

      const mistakes = extractor.extractMistakes(messages, []);

      expect(mistakes.length).toBeGreaterThan(0);
      const withCorrection = mistakes.find(m => m.correction);
      expect(withCorrection).toBeDefined();
      // The "should" pattern captures everything after "should" until the period
      expect(withCorrection?.correction).toContain('use method B');
    });

    it('should extract corrections with "should"', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Doing X',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
        {
          id: 'msg-2',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'No, you should use Y for this case.',
          timestamp: Date.now() + 1000,
          is_sidechain: false,
          metadata: {},
        },
      ];

      const mistakes = extractor.extractMistakes(messages, []);

      expect(Array.isArray(mistakes)).toBe(true);
      if (mistakes.length > 0) {
        const withCorrection = mistakes.find(m => m.correction);
        if (withCorrection) {
          expect(withCorrection.correction).toBeTruthy();
        }
      }
    });
  });

  describe('File Extraction', () => {
    it('should extract files from error messages', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Running test',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const toolResults: ToolResult[] = [
        {
          id: 'tool-1',
          tool_use_id: 'use-1',
          message_id: 'msg-1',
          content: 'Error in src/components/Button.tsx',
          stdout: '',
          stderr: 'Error in src/components/Button.tsx',
          is_error: true,
          is_image: false,
          timestamp: Date.now(),
        },
      ];

      const mistakes = extractor.extractMistakes(messages, toolResults);

      expect(mistakes.length).toBeGreaterThan(0);
      expect(mistakes[0].files_affected).toContain('src/components/Button.tsx');
    });

    it('should extract files from message metadata', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'No, fix the file',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {
            files: ['/src/utils/helper.ts'],
          },
        },
        {
          id: 'msg-0',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Editing',
          timestamp: Date.now() - 1000,
          is_sidechain: false,
          metadata: {},
        },
      ];

      const mistakes = extractor.extractMistakes(messages, []);

      expect(Array.isArray(mistakes)).toBe(true);
    });
  });

  describe('Severity Scoring', () => {
    it('should score mistakes with corrections higher', () => {
      const mistakeWithCorrection = {
        id: '1',
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        mistake_type: 'logic_error' as const,
        what_went_wrong: 'Error occurred',
        correction: 'Fixed by doing X',
        files_affected: [],
        timestamp: Date.now(),
      };

      const mistakeWithoutCorrection = {
        id: '2',
        conversation_id: 'conv-1',
        message_id: 'msg-2',
        mistake_type: 'logic_error' as const,
        what_went_wrong: 'Error occurred',
        files_affected: [],
        timestamp: Date.now(),
      };

      const score1 = extractor.scoreMistakeSeverity(mistakeWithCorrection);
      const score2 = extractor.scoreMistakeSeverity(mistakeWithoutCorrection);

      expect(score1).toBeGreaterThan(score2);
    });

    it('should score user corrections highest', () => {
      const userCorrected = {
        id: '1',
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        mistake_type: 'logic_error' as const,
        what_went_wrong: 'Error occurred',
        user_correction_message: 'No, fix this',
        files_affected: [],
        timestamp: Date.now(),
      };

      const notUserCorrected = {
        id: '2',
        conversation_id: 'conv-1',
        message_id: 'msg-2',
        mistake_type: 'logic_error' as const,
        what_went_wrong: 'Error occurred',
        files_affected: [],
        timestamp: Date.now(),
      };

      const score1 = extractor.scoreMistakeSeverity(userCorrected);
      const score2 = extractor.scoreMistakeSeverity(notUserCorrected);

      expect(score1).toBeGreaterThan(score2);
    });

    it('should score by mistake type severity', () => {
      const logicError = {
        id: '1',
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        mistake_type: 'logic_error' as const,
        what_went_wrong: 'Error',
        files_affected: [],
        timestamp: Date.now(),
      };

      const syntaxError = {
        id: '2',
        conversation_id: 'conv-1',
        message_id: 'msg-2',
        mistake_type: 'syntax_error' as const,
        what_went_wrong: 'Error',
        files_affected: [],
        timestamp: Date.now(),
      };

      const score1 = extractor.scoreMistakeSeverity(logicError);
      const score2 = extractor.scoreMistakeSeverity(syntaxError);

      expect(score1).toBeGreaterThan(score2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle messages with null content', () => {
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

      const mistakes = extractor.extractMistakes(messages, []);
      expect(mistakes).toEqual([]);
    });

    it('should handle tool results without stderr', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Running',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const toolResults: ToolResult[] = [
        {
          id: 'tool-1',
          tool_use_id: 'use-1',
          message_id: 'msg-1',
          content: 'Failed',
          stdout: '',
          stderr: '',
          is_error: true,
          is_image: false,
          timestamp: Date.now(),
        },
      ];

      const mistakes = extractor.extractMistakes(messages, toolResults);

      expect(Array.isArray(mistakes)).toBe(true);
    });

    it('should handle corrections without previous assistant message', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'No, that is wrong',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const mistakes = extractor.extractMistakes(messages, []);

      // Should not crash, may return empty array
      expect(Array.isArray(mistakes)).toBe(true);
    });
  });
});
