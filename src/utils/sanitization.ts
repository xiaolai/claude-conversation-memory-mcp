/**
 * Input sanitization utilities for SQL LIKE queries and path validation
 */

import { normalize, sep } from 'path';

/**
 * Sanitize string for use in SQL LIKE patterns
 * Escapes special LIKE characters: %, _, "
 */
export function sanitizeForLike(input: string): string {
  return input.replace(/[%_"\\]/g, '\\$&');
}

/**
 * Validate and sanitize file path
 * Cross-platform: prevents path traversal attacks and blocks system directories
 */
export function validateFilePath(filePath: string): string {
  // Remove any null bytes
  const cleaned = filePath.replace(/\0/g, '');

  // Check for path traversal attempts
  if (cleaned.includes('..')) {
    throw new Error('Path traversal detected: .. is not allowed in file paths');
  }

  // Check for absolute paths outside allowed directories (platform-specific)
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    // Windows system directories (case-insensitive)
    const forbidden = [
      /^[A-Z]:\\Windows\\/i,
      /^[A-Z]:\\Program Files/i,
      /^[A-Z]:\\ProgramData/i,
      /^[A-Z]:\\System/i,
    ];
    if (forbidden.some(pattern => pattern.test(cleaned))) {
      throw new Error('Access to system directories is not allowed');
    }
  } else {
    // Unix system directories
    if (cleaned.startsWith('/etc') ||
        cleaned.startsWith('/sys') ||
        cleaned.startsWith('/proc')) {
      throw new Error('Access to system directories is not allowed');
    }
  }

  return cleaned;
}

/**
 * Validate and normalize project path
 * Cross-platform: handles both Unix (/) and Windows (\) paths
 * Used for converting file paths to Claude project directory names
 */
export function sanitizeProjectPath(path: string): string {
  // Remove null bytes
  const cleaned = path.replace(/\0/g, '');

  // Check for path traversal
  if (cleaned.includes('..')) {
    throw new Error('Path traversal detected in project path');
  }

  // First normalize with Node's native path module for current platform
  let normalized = normalize(cleaned);

  // Then handle any remaining separators from other platforms
  // Replace multiple consecutive slashes/backslashes with single separator
  normalized = normalized.replace(/[\\/]+/g, sep);

  // Remove trailing path separator
  const trailingSepRegex = new RegExp(`${sep.replace(/\\/g, '\\\\')}+$`);
  return normalized.replace(trailingSepRegex, '');
}

/**
 * Sanitize SQL identifier (table/column name)
 * Only allows alphanumeric and underscore
 */
export function sanitizeSQLIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return identifier;
}

/**
 * Convert a project path to Claude Code's project folder name
 * Cross-platform compatible - handles both Unix and Windows paths
 *
 * Examples:
 * - macOS/Linux: /Users/joker/github/project → -Users-joker-github-project
 * - Windows: C:\Users\user\project → C-Users-user-project
 * - Windows UNC: \\server\share\project → -server-share-project
 */
export function pathToProjectFolderName(projectPath: string): string {
  // Normalize the path first
  const normalized = sanitizeProjectPath(projectPath);

  // Replace Windows drive letters (C: → C, D: → D)
  // Replace both forward and backward slashes with dashes
  const folderName = normalized
    .replace(/^([A-Z]):/i, '$1')  // Remove colon from drive letter
    .replace(/[\\/]+/g, '-');     // Replace / or \ with -

  return folderName;
}
