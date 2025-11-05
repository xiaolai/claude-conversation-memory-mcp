#!/usr/bin/env node
/**
 * Manual test for conversation memory indexing
 */

import { ConversationMemory } from './dist/ConversationMemory.js';

async function test() {
  console.log('🧪 Testing conversation memory indexing...\n');

  const memory = new ConversationMemory({
    projectPath: '/Users/joker/github/xiaolai/claude-conversation-memory-mcp'
  });

  try {
    console.log('📥 Indexing conversations...');
    await memory.indexConversations({
      projectPath: '/Users/joker/github/xiaolai/claude-conversation-memory-mcp',
      includeThinking: false,
      enableGitIntegration: true
    });

    const stats = memory.getStats();
    console.log('\n✅ Indexing complete!');
    console.log('Stats:', JSON.stringify(stats, null, 2));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

test();
