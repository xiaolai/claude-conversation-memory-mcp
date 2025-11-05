/**
 * Jest test setup file
 * Runs before all tests
 */

import { jest, afterEach } from '@jest/globals';

// Set test environment
process.env.NODE_ENV = 'test';

// Extend Jest matchers if needed
// expect.extend({ ... });

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Suppress console.log in tests unless explicitly needed
  log: jest.fn(),
  // Keep error and warn for debugging
  error: console.error,
  warn: console.warn,
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});
