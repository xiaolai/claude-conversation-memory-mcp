/**
 * Jest test setup file
 * Runs before all tests
 */

import { jest, beforeEach, afterEach } from '@jest/globals';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resetSQLiteManager } from '../storage/SQLiteManager.js';

// Set test environment
process.env.NODE_ENV = 'test';
let testDbPath = '';
beforeEach(() => {
  testDbPath = join(
    tmpdir(),
    `cccmemory-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
  );
  process.env.CCCMEMORY_DB_PATH = testDbPath;
  resetSQLiteManager();
});

// Extend Jest matchers if needed
// expect.extend({ ... });

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Suppress console.log in tests unless explicitly needed
  log: jest.fn(),
  // Suppress error/warn to keep test output clean
  error: jest.fn(),
  warn: jest.fn(),
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  resetSQLiteManager();
  rmSync(testDbPath, { force: true });
  rmSync(`${testDbPath}-wal`, { force: true });
  rmSync(`${testDbPath}-shm`, { force: true });
});
