/**
 * Unit tests for input sanitization utilities
 */

import {
  sanitizeForLike,
  validateFilePath,
  sanitizeProjectPath,
  sanitizeSQLIdentifier,
  pathToProjectFolderName,
} from '../../utils/sanitization.js';

describe('sanitization utilities', () => {
  describe('sanitizeForLike', () => {
    it('should escape % characters', () => {
      expect(sanitizeForLike('test%file')).toBe('test\\%file');
    });

    it('should escape _ characters', () => {
      expect(sanitizeForLike('test_file')).toBe('test\\_file');
    });

    it('should escape " characters', () => {
      expect(sanitizeForLike('test"file')).toBe('test\\"file');
    });

    it('should escape \\ characters', () => {
      expect(sanitizeForLike('test\\file')).toBe('test\\\\file');
    });

    it('should escape multiple special characters', () => {
      expect(sanitizeForLike('test%_"\\file')).toBe('test\\%\\_\\"\\\\file');
    });

    it('should handle strings without special characters', () => {
      expect(sanitizeForLike('normalfile')).toBe('normalfile');
    });

    it('should handle empty strings', () => {
      expect(sanitizeForLike('')).toBe('');
    });
  });

  describe('validateFilePath', () => {
    it('should accept valid file paths', () => {
      expect(validateFilePath('/Users/test/file.txt')).toBe('/Users/test/file.txt');
      expect(validateFilePath('src/auth/token.ts')).toBe('src/auth/token.ts');
    });

    it('should remove null bytes', () => {
      expect(validateFilePath('test\0file')).toBe('testfile');
    });

    it('should reject path traversal with ..', () => {
      expect(() => validateFilePath('../etc/passwd')).toThrow('Path traversal detected');
      expect(() => validateFilePath('test/../secret')).toThrow('Path traversal detected');
    });

    it('should reject access to system directories', () => {
      expect(() => validateFilePath('/etc/passwd')).toThrow('system directories');
      expect(() => validateFilePath('/sys/kernel')).toThrow('system directories');
      expect(() => validateFilePath('/proc/cpuinfo')).toThrow('system directories');
    });

    it('should allow relative paths', () => {
      expect(validateFilePath('src/index.ts')).toBe('src/index.ts');
    });
  });

  describe('sanitizeProjectPath', () => {
    it('should accept valid project paths', () => {
      expect(sanitizeProjectPath('/Users/test/project')).toBe('/Users/test/project');
    });

    it('should remove null bytes', () => {
      expect(sanitizeProjectPath('/path\0/project')).toBe('/path/project');
    });

    it('should reject path traversal', () => {
      expect(() => sanitizeProjectPath('../secret')).toThrow('Path traversal detected');
    });

    it('should normalize multiple slashes', () => {
      expect(sanitizeProjectPath('/path//to///project')).toBe('/path/to/project');
    });

    it('should remove trailing slashes', () => {
      expect(sanitizeProjectPath('/path/to/project/')).toBe('/path/to/project');
    });

    it('should handle absolute paths', () => {
      expect(sanitizeProjectPath('/absolute/path')).toBe('/absolute/path');
    });
  });

  describe('sanitizeSQLIdentifier', () => {
    it('should accept valid SQL identifiers', () => {
      expect(sanitizeSQLIdentifier('table_name')).toBe('table_name');
      expect(sanitizeSQLIdentifier('Column123')).toBe('Column123');
      expect(sanitizeSQLIdentifier('_private')).toBe('_private');
    });

    it('should reject identifiers starting with numbers', () => {
      expect(() => sanitizeSQLIdentifier('123table')).toThrow('Invalid SQL identifier');
    });

    it('should reject identifiers with special characters', () => {
      expect(() => sanitizeSQLIdentifier('table-name')).toThrow('Invalid SQL identifier');
      expect(() => sanitizeSQLIdentifier('table.name')).toThrow('Invalid SQL identifier');
      expect(() => sanitizeSQLIdentifier('table name')).toThrow('Invalid SQL identifier');
    });

    it('should reject empty identifiers', () => {
      expect(() => sanitizeSQLIdentifier('')).toThrow('Invalid SQL identifier');
    });

    it('should accept identifiers with underscores', () => {
      expect(sanitizeSQLIdentifier('my_table_name')).toBe('my_table_name');
    });
  });

  describe('Windows path handling', () => {
    describe('pathToProjectFolderName - Windows paths', () => {
      it('should handle Windows absolute paths with drive letter', () => {
        const result = pathToProjectFolderName('C:\\Users\\user\\project');
        expect(result).toBe('C-Users-user-project');
      });

      it('should handle Windows paths with lowercase drive letter', () => {
        const result = pathToProjectFolderName('c:\\users\\user\\project');
        expect(result).toBe('c-users-user-project');
      });

      it('should handle Windows UNC paths', () => {
        const result = pathToProjectFolderName('\\\\server\\share\\project');
        expect(result).toBe('-server-share-project');
      });

      it('should handle mixed forward and backward slashes', () => {
        const result = pathToProjectFolderName('C:\\Users/user\\github/project');
        expect(result).toBe('C-Users-user-github-project');
      });

      it('should handle multiple consecutive backslashes', () => {
        const result = pathToProjectFolderName('C:\\\\Users\\\\\\project');
        expect(result).toBe('C-Users-project');
      });
    });

    describe('sanitizeProjectPath - Windows normalization', () => {
      it('should normalize Windows paths with multiple backslashes', () => {
        const result = sanitizeProjectPath('C:\\path\\\\to\\\\\\project');
        // Result will be platform-specific, just verify no error
        expect(result).toBeTruthy();
        expect(result).not.toContain('\\\\\\');
      });

      it('should remove trailing backslashes on Windows-style paths', () => {
        const result = sanitizeProjectPath('C:\\path\\to\\project\\');
        expect(result.endsWith('\\')).toBe(false);
        expect(result.endsWith('/')).toBe(false);
      });
    });

    describe('validateFilePath - Windows system directories', () => {
      // Mock Windows platform for testing
      const originalPlatform = process.platform;

      beforeEach(() => {
        Object.defineProperty(process, 'platform', {
          value: 'win32',
          writable: true,
          configurable: true,
        });
      });

      afterEach(() => {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          writable: true,
          configurable: true,
        });
      });

      it('should reject Windows system directories', () => {
        expect(() => validateFilePath('C:\\Windows\\System32')).toThrow('system directories');
        expect(() => validateFilePath('C:\\Windows\\notepad.exe')).toThrow('system directories');
      });

      it('should reject Program Files directory', () => {
        expect(() => validateFilePath('C:\\Program Files\\app')).toThrow('system directories');
      });

      it('should reject ProgramData directory', () => {
        expect(() => validateFilePath('C:\\ProgramData\\config')).toThrow('system directories');
      });

      it('should allow user directories on Windows', () => {
        expect(validateFilePath('C:\\Users\\user\\project\\file.txt'))
          .toBe('C:\\Users\\user\\project\\file.txt');
      });

      it('should be case-insensitive for Windows paths', () => {
        expect(() => validateFilePath('c:\\windows\\system32')).toThrow('system directories');
        expect(() => validateFilePath('C:\\WINDOWS\\System32')).toThrow('system directories');
      });
    });
  });
});
