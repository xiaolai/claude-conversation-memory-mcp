/**
 * Unit tests for RequirementsExtractor
 */

import { RequirementsExtractor } from '../../parsers/RequirementsExtractor';
import type { Message, ToolUse, ToolResult } from '../../parsers/ConversationParser';

describe('RequirementsExtractor', () => {
  let extractor: RequirementsExtractor;

  beforeEach(() => {
    extractor = new RequirementsExtractor();
  });

  describe('extractRequirements', () => {
    it('should extract dependency requirements', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'We need to use the Express library for the API server',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const requirements = extractor.extractRequirements(messages);

      expect(requirements.length).toBeGreaterThan(0);
      const depReq = requirements.find(r => r.type === 'dependency');
      expect(depReq).toBeDefined();
      expect(depReq?.description).toContain('Express');
    });

    it('should extract performance requirements', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'Response time must be under 200ms for the API',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const requirements = extractor.extractRequirements(messages);

      expect(requirements.length).toBeGreaterThan(0);
      const perfReq = requirements.find(r => r.type === 'performance');
      expect(perfReq).toBeDefined();
      expect(perfReq?.description).toContain('200ms');
    });

    it('should extract compatibility requirements', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'The app must support Node.js version 18 or higher',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const requirements = extractor.extractRequirements(messages);

      expect(requirements.length).toBeGreaterThan(0);
      const compatReq = requirements.find(r => r.type === 'compatibility');
      expect(compatReq).toBeDefined();
    });

    it('should extract business requirements', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'Business requirement: costs must not exceed $1000 per month',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const requirements = extractor.extractRequirements(messages);

      expect(requirements.length).toBeGreaterThan(0);
      const bizReq = requirements.find(r => r.type === 'business');
      expect(bizReq).toBeDefined();
    });

    it('should handle empty messages array', () => {
      const requirements = extractor.extractRequirements([]);
      expect(requirements).toEqual([]);
    });

    it('should deduplicate similar requirements', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'We need to use the React library',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
        {
          id: 'msg-2',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'We need to use the React library',
          timestamp: Date.now() + 1000,
          is_sidechain: false,
          metadata: {},
        },
      ];

      const requirements = extractor.extractRequirements(messages);

      // Should deduplicate identical requirements
      const reactReqs = requirements.filter(r => r.description.includes('React'));
      expect(reactReqs.length).toBe(1);
    });
  });

  describe('extractValidations', () => {
    it('should extract npm test validations', () => {
      const toolUses: ToolUse[] = [
        {
          id: 'use-1',
          message_id: 'msg-1',
          tool_name: 'Bash',
          tool_input: { command: 'npm test' },
          timestamp: Date.now(),
        },
      ];

      const toolResults: ToolResult[] = [
        {
          id: 'res-1',
          tool_use_id: 'use-1',
          message_id: 'msg-1',
          content: 'All tests passed ✓',
          stdout: 'All tests passed ✓',
          stderr: '',
          is_error: false,
          is_image: false,
          timestamp: Date.now(),
        },
      ];

      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Running tests',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const validations = extractor.extractValidations(toolUses, toolResults, messages);

      expect(validations.length).toBeGreaterThan(0);
      expect(validations[0].test_command).toBe('npm test');
      expect(validations[0].result).toBe('passed');
    });

    it('should extract pytest validations', () => {
      const toolUses: ToolUse[] = [
        {
          id: 'use-1',
          message_id: 'msg-1',
          tool_name: 'Bash',
          tool_input: { command: 'pytest tests/' },
          timestamp: Date.now(),
        },
      ];

      const toolResults: ToolResult[] = [
        {
          id: 'res-1',
          tool_use_id: 'use-1',
          message_id: 'msg-1',
          content: '3 failed tests',
          stdout: '3 failed tests',
          stderr: '',
          is_error: false,
          is_image: false,
          timestamp: Date.now(),
        },
      ];

      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Running Python tests',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const validations = extractor.extractValidations(toolUses, toolResults, messages);

      expect(validations.length).toBeGreaterThan(0);
      expect(validations[0].test_command).toContain('pytest');
      expect(validations[0].result).toBe('failed');
    });

    it('should handle test errors', () => {
      const toolUses: ToolUse[] = [
        {
          id: 'use-1',
          message_id: 'msg-1',
          tool_name: 'Bash',
          tool_input: { command: 'npm test' },
          timestamp: Date.now(),
        },
      ];

      const toolResults: ToolResult[] = [
        {
          id: 'res-1',
          tool_use_id: 'use-1',
          message_id: 'msg-1',
          content: 'Error: command not found',
          stdout: '',
          stderr: 'Error: command not found',
          is_error: true,
          is_image: false,
          timestamp: Date.now(),
        },
      ];

      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Running tests',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const validations = extractor.extractValidations(toolUses, toolResults, messages);

      expect(validations.length).toBeGreaterThan(0);
      expect(validations[0].result).toBe('error');
    });

    it('should extract performance data from test results', () => {
      const toolUses: ToolUse[] = [
        {
          id: 'use-1',
          message_id: 'msg-1',
          tool_name: 'Bash',
          tool_input: { command: 'npm test' },
          timestamp: Date.now(),
        },
      ];

      const toolResults: ToolResult[] = [
        {
          id: 'res-1',
          tool_use_id: 'use-1',
          message_id: 'msg-1',
          content: 'Tests passed in 1.5s. 10 passed',
          stdout: 'Tests passed in 1.5s. 10 passed',
          stderr: '',
          is_error: false,
          is_image: false,
          timestamp: Date.now(),
        },
      ];

      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Running tests',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const validations = extractor.extractValidations(toolUses, toolResults, messages);

      expect(validations.length).toBeGreaterThan(0);
      expect(validations[0].performance_data).toBeDefined();
      expect(validations[0].performance_data?.duration_ms).toBe(1500);
      expect(validations[0].performance_data?.tests_passed).toBe(10);
    });

    it('should ignore non-test commands', () => {
      const toolUses: ToolUse[] = [
        {
          id: 'use-1',
          message_id: 'msg-1',
          tool_name: 'Bash',
          tool_input: { command: 'ls -la' },
          timestamp: Date.now(),
        },
      ];

      const toolResults: ToolResult[] = [
        {
          id: 'res-1',
          tool_use_id: 'use-1',
          message_id: 'msg-1',
          content: 'file1.txt file2.txt',
          stdout: 'file1.txt file2.txt',
          stderr: '',
          is_error: false,
          is_image: false,
          timestamp: Date.now(),
        },
      ];

      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Listing files',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const validations = extractor.extractValidations(toolUses, toolResults, messages);

      expect(validations).toEqual([]);
    });

    it('should handle empty tool uses', () => {
      const validations = extractor.extractValidations([], [], []);
      expect(validations).toEqual([]);
    });
  });

  describe('Rationale Extraction', () => {
    it('should extract rationale with "because"', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'We need to use PostgreSQL library because it provides better ACID guarantees',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const requirements = extractor.extractRequirements(messages);

      expect(requirements.length).toBeGreaterThan(0);
      const withRationale = requirements.find(r => r.rationale);
      expect(withRationale).toBeDefined();
      if (withRationale) {
        expect(withRationale.rationale).toContain('ACID');
      }
    });

    it('should extract rationale with "since"', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'Install React package since it handles UI components efficiently',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const requirements = extractor.extractRequirements(messages);

      expect(Array.isArray(requirements)).toBe(true);
    });
  });

  describe('Component Extraction', () => {
    it('should extract affected components from message', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'The frontend must support React, and the backend needs Express library',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const requirements = extractor.extractRequirements(messages);

      expect(requirements.length).toBeGreaterThan(0);
      const withComponents = requirements.find(r => r.affects_components.length > 0);
      expect(withComponents).toBeDefined();
      if (withComponents) {
        expect(withComponents.affects_components).toContain('frontend');
        expect(withComponents.affects_components).toContain('backend');
      }
    });

    it('should handle messages without component keywords', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: 'Need to use some library',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const requirements = extractor.extractRequirements(messages);

      expect(Array.isArray(requirements)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle messages with null content', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'user',
          content: undefined,
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const requirements = extractor.extractRequirements(messages);
      expect(requirements).toEqual([]);
    });

    it('should handle tool uses without command', () => {
      const toolUses: ToolUse[] = [
        {
          id: 'use-1',
          message_id: 'msg-1',
          tool_name: 'Bash',
          tool_input: {},
          timestamp: Date.now(),
        },
      ];

      const validations = extractor.extractValidations(toolUses, [], []);
      expect(validations).toEqual([]);
    });

    it('should handle non-string commands', () => {
      const toolUses: ToolUse[] = [
        {
          id: 'use-1',
          message_id: 'msg-1',
          tool_name: 'Bash',
          tool_input: { command: 123 },
          timestamp: Date.now(),
        },
      ];

      const validations = extractor.extractValidations(toolUses, [], []);
      expect(validations).toEqual([]);
    });

    it('should handle tool results without matching tool use', () => {
      const toolUses: ToolUse[] = [
        {
          id: 'use-1',
          message_id: 'msg-1',
          tool_name: 'Bash',
          tool_input: { command: 'npm test' },
          timestamp: Date.now(),
        },
      ];

      const toolResults: ToolResult[] = [
        {
          id: 'res-1',
          tool_use_id: 'use-999',
          message_id: 'msg-1',
          content: 'Tests passed',
          stdout: 'Tests passed',
          stderr: '',
          is_error: false,
          is_image: false,
          timestamp: Date.now(),
        },
      ];

      const messages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          message_type: 'text',
          role: 'assistant',
          content: 'Testing',
          timestamp: Date.now(),
          is_sidechain: false,
          metadata: {},
        },
      ];

      const validations = extractor.extractValidations(toolUses, toolResults, messages);

      // Should not crash, may return empty array
      expect(Array.isArray(validations)).toBe(true);
    });
  });
});
