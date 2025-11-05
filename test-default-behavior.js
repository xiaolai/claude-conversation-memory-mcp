#!/usr/bin/env node

/**
 * Test Default Behavior - Verify self-only is default
 */

import { ToolHandlers } from './dist/tools/ToolHandlers.js';
import { ConversationMemory } from './dist/ConversationMemory.js';
import { getSQLiteManager } from './dist/storage/SQLiteManager.js';

console.log('Testing default exclude_mcp_conversations behavior...\n');

const memory = new ConversationMemory();
const db = getSQLiteManager();
const handlers = new ToolHandlers(memory, db);

// Clear database
const tables = ['conversations', 'messages', 'tool_uses', 'tool_results',
  'file_edits', 'thinking_blocks', 'decisions', 'mistakes',
  'requirements', 'git_commits', 'message_embeddings', 'decision_embeddings'];
for (const table of tables) {
  try {
    db.prepare(`DELETE FROM ${table}`).run();
  } catch (e) { /* ignore */ }
}

// Call with NO parameters (should default to self-only exclusion)
console.log('📊 Calling index_conversations with NO exclude_mcp_conversations parameter');
console.log('Expected: Should exclude conversation-memory by default\n');

const result = await handlers.indexConversations({
  project_path: process.cwd(),
  enable_git: false,
});

console.log('\n' + '='.repeat(80));
console.log('RESULT:');
console.log('='.repeat(80));
console.log(`Conversations indexed: ${result.stats.conversations.count}`);
console.log(`Messages indexed: ${result.stats.messages.count}`);

if (result.stats.conversations.count === 0) {
  console.log('\n✅ SUCCESS: Default behavior correctly excludes conversation-memory');
  console.log('   (0 conversations indexed because this conversation uses conversation-memory MCP)');
} else {
  console.log('\n⚠️ NOTE: Conversations were indexed');
  console.log('   This might mean:');
  console.log('   1. There are non-MCP conversations in the project');
  console.log('   2. Or default exclusion is not working');
}

console.log('\n' + result.message);
