/**
 * Test Helper Utilities
 * Shared utilities for all test files
 */

import { getSQLiteManager } from '../../storage/SQLiteManager';
import type { SQLiteManager } from '../../storage/SQLiteManager';
import { rmSync } from 'fs';
import { join } from 'path';

/**
 * Create isolated test database
 */
export function createTestDatabase(): SQLiteManager {
  const testDbPath = join('/tmp', `test-db-${Date.now()}-${Math.random()}.db`);
  return getSQLiteManager(testDbPath);
}

/**
 * Cleanup test database
 */
export function cleanupTestDatabase(dbPath?: string): void {
  try {
    getSQLiteManager().close();
    if (dbPath) {
      rmSync(dbPath, { force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Normalize object for snapshot testing
 * Removes timestamps, IDs, and other dynamic values
 */
export function normalizeForSnapshot<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (key, value) => {
      // Normalize timestamps
      if (
        key.includes('timestamp') ||
        key.includes('time') ||
        key === 'created_at' ||
        key === 'updated_at'
      ) {
        return '[TIMESTAMP]';
      }

      // Normalize IDs
      if (key === 'id' || key.endsWith('_id')) {
        return '[ID]';
      }

      // Normalize paths
      if (key.includes('path') && typeof value === 'string' && value.startsWith('/')) {
        return '[PATH]';
      }

      return value;
    })
  );
}

/**
 * Wait for async operation with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Suppress console output during test
 */
export function suppressConsole(): () => void {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();

  return () => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  };
}

/**
 * Create test conversation data
 */
export function createTestConversation(overrides?: Partial<any>): any {
  return {
    id: 'test-conv-' + Math.random(),
    project_path: '/tmp/test-project',
    first_message_at: Date.now() - 3600000,
    last_message_at: Date.now(),
    message_count: 10,
    git_branch: 'main',
    claude_version: '3.5',
    metadata: {},
    created_at: Date.now() - 3600000,
    updated_at: Date.now(),
    ...overrides,
  };
}

/**
 * Create test message data
 */
export function createTestMessage(overrides?: Partial<any>): any {
  return {
    id: 'test-msg-' + Math.random(),
    conversation_id: 'test-conv-123',
    message_type: 'text',
    role: 'user',
    content: 'Test message content',
    timestamp: Date.now(),
    is_sidechain: false,
    metadata: {},
    ...overrides,
  };
}

/**
 * Assert table row count
 */
export function assertTableCount(
  db: any,
  table: string,
  expectedCount: number
): void {
  const result = db
    .prepare(`SELECT COUNT(*) as count FROM ${table}`)
    .get() as { count: number };
  expect(result.count).toBe(expectedCount);
}

/**
 * Get all test utilities as a single export
 */
export const TestHelpers = {
  createTestDatabase,
  cleanupTestDatabase,
  normalizeForSnapshot,
  waitFor,
  suppressConsole,
  createTestConversation,
  createTestMessage,
  assertTableCount,
};
