/**
 * Unit tests for Logger
 */

import { jest } from '@jest/globals';
import { Logger, LogLevel, createLogger } from '../../utils/Logger';

describe('Logger', () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalDebug = console.debug;

  let consoleLogMock: ReturnType<typeof jest.fn>;
  let consoleWarnMock: ReturnType<typeof jest.fn>;
  let consoleErrorMock: ReturnType<typeof jest.fn>;
  let consoleDebugMock: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    consoleLogMock = jest.fn();
    consoleWarnMock = jest.fn();
    consoleErrorMock = jest.fn();
    consoleDebugMock = jest.fn();

    console.log = consoleLogMock;
    console.warn = consoleWarnMock;
    console.error = consoleErrorMock;
    console.debug = consoleDebugMock;
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    console.debug = originalDebug;
  });

  // Note: All logging goes to stderr (console.error) to avoid interfering with MCP JSON-RPC on stdout
  describe('Log Levels', () => {
    it('should log debug messages when level is DEBUG', () => {
      const logger = new Logger({ level: LogLevel.DEBUG });
      logger.debug('test debug');

      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] test debug')
      );
    });

    it('should not log debug messages when level is INFO', () => {
      const logger = new Logger({ level: LogLevel.INFO });
      logger.debug('test debug');

      expect(consoleErrorMock).not.toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]')
      );
    });

    it('should log info messages when level is INFO', () => {
      const logger = new Logger({ level: LogLevel.INFO });
      logger.info('test info');

      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] test info')
      );
    });

    it('should log warnings when level is WARN', () => {
      const logger = new Logger({ level: LogLevel.WARN });
      logger.warn('test warning');

      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] test warning')
      );
    });

    it('should not log info when level is WARN', () => {
      const logger = new Logger({ level: LogLevel.WARN });
      logger.info('test info');

      expect(consoleErrorMock).not.toHaveBeenCalledWith(
        expect.stringContaining('[INFO]')
      );
    });

    it('should log errors when level is ERROR', () => {
      const logger = new Logger({ level: LogLevel.ERROR });
      logger.error('test error');

      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] test error')
      );
    });

    it('should not log anything when level is SILENT', () => {
      const logger = new Logger({ level: LogLevel.SILENT });
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      expect(consoleErrorMock).not.toHaveBeenCalled();
    });
  });

  describe('Formatting', () => {
    it('should include prefix when configured', () => {
      const logger = new Logger({ prefix: 'TestModule', level: LogLevel.INFO });
      logger.info('test message');

      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('[TestModule]')
      );
    });

    it('should include timestamp when configured', () => {
      const logger = new Logger({ timestamp: true, level: LogLevel.INFO });
      logger.info('test message');

      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
      );
    });

    it('should format with all components', () => {
      const logger = new Logger({
        prefix: 'Test',
        timestamp: true,
        level: LogLevel.INFO,
      });
      logger.info('message');

      const call = consoleErrorMock.mock.calls[0][0] as string;
      expect(call).toMatch(/^\d{4}/); // Timestamp
      expect(call).toContain('[Test]'); // Prefix
      expect(call).toContain('[INFO]'); // Level
      expect(call).toContain('message'); // Message
    });
  });

  describe('Child Loggers', () => {
    it('should create child logger with combined prefix', () => {
      const parent = new Logger({ prefix: 'Parent', level: LogLevel.INFO });
      const child = parent.child('Child');

      child.info('test');

      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('[Parent:Child]')
      );
    });

    it('should inherit log level from parent', () => {
      const parent = new Logger({ level: LogLevel.ERROR });
      const child = parent.child('Child');

      child.info('should not log');
      child.error('should log');

      // Both info and error go to stderr, but info shouldn't log when level is ERROR
      const calls = consoleErrorMock.mock.calls.map(c => c[0] as string);
      expect(calls.some(c => c.includes('[INFO]'))).toBe(false);
      expect(calls.some(c => c.includes('[ERROR]'))).toBe(true);
    });
  });

  describe('Dynamic Level Changes', () => {
    it('should allow changing log level', () => {
      const logger = new Logger({ level: LogLevel.ERROR });

      logger.info('not logged');
      // Initially should not have [INFO] calls
      let calls = consoleErrorMock.mock.calls.map(c => c[0] as string);
      expect(calls.some(c => c.includes('[INFO]'))).toBe(false);

      logger.setLevel(LogLevel.INFO);
      logger.info('now logged');
      calls = consoleErrorMock.mock.calls.map(c => c[0] as string);
      expect(calls.some(c => c.includes('[INFO]'))).toBe(true);
    });

    it('should return current log level', () => {
      const logger = new Logger({ level: LogLevel.WARN });
      expect(logger.getLevel()).toBe(LogLevel.WARN);

      logger.setLevel(LogLevel.DEBUG);
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);
    });
  });

  describe('Success Messages', () => {
    it('should log success messages at INFO level', () => {
      const logger = new Logger({ level: LogLevel.INFO });
      logger.success('operation complete');

      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('[✓] operation complete')
      );
    });

    it('should not log success when level is WARN', () => {
      const logger = new Logger({ level: LogLevel.WARN });
      logger.success('operation complete');

      // Success uses INFO level, so it shouldn't log when level is WARN
      const calls = consoleErrorMock.mock.calls.map(c => c[0] as string);
      expect(calls.some(c => c.includes('[✓]'))).toBe(false);
    });
  });

  describe('Additional Arguments', () => {
    it('should pass additional arguments to console', () => {
      const logger = new Logger({ level: LogLevel.INFO });
      const obj = { foo: 'bar' };
      logger.info('message', obj, 123);

      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.any(String),
        obj,
        123
      );
    });
  });

  describe('Factory Function', () => {
    it('should create logger with module prefix', () => {
      const logger = createLogger('MyModule');
      logger.info('test');

      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('[MyModule]')
      );
    });
  });
});
