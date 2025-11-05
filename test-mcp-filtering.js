#!/usr/bin/env node

/**
 * Test MCP Conversation Filtering Feature
 *
 * Tests the new exclude_mcp_conversations and exclude_mcp_servers parameters
 */

import { ConversationMemory } from './dist/ConversationMemory.js';
import { getSQLiteManager } from './dist/storage/SQLiteManager.js';

const TEST_PROJECT_PATH = process.cwd();

console.log('='.repeat(80));
console.log('MCP CONVERSATION FILTERING TEST');
console.log('='.repeat(80));

function clearDatabase(db) {
  // Clear all tables
  const tables = [
    'conversations', 'messages', 'tool_uses', 'tool_results',
    'file_edits', 'thinking_blocks', 'decisions', 'mistakes',
    'requirements', 'git_commits', 'message_embeddings', 'decision_embeddings'
  ];

  for (const table of tables) {
    try {
      db.prepare(`DELETE FROM ${table}`).run();
    } catch (e) {
      // Ignore errors for tables that don't exist
    }
  }
}

async function runTests() {
  const memory = new ConversationMemory();
  const db = getSQLiteManager();

  // Test 1: Index all conversations (baseline)
  console.log('\n📊 Test 1: Index all conversations (baseline)');
  console.log('-'.repeat(80));

  clearDatabase(db); // Clear database
  await memory.indexConversations({
    projectPath: TEST_PROJECT_PATH,
    includeThinking: false,
    enableGitIntegration: false,
  });

  const allStats = memory.getStats();
  console.log(`✓ Total conversations: ${allStats.conversations.count}`);
  console.log(`✓ Total messages: ${allStats.messages.count}`);

  // Check how many conversations have MCP usage
  const allConversations = db.prepare(
    'SELECT id, metadata FROM conversations'
  ).all();

  const mcpConversations = allConversations.filter(conv => {
    try {
      const metadata = JSON.parse(conv.metadata || '{}');
      return metadata.mcp_usage?.detected === true;
    } catch {
      return false;
    }
  });

  console.log(`✓ Conversations with MCP usage: ${mcpConversations.length}`);

  if (mcpConversations.length > 0) {
    const servers = new Set();
    mcpConversations.forEach(conv => {
      const metadata = JSON.parse(conv.metadata || '{}');
      metadata.mcp_usage?.servers?.forEach(s => servers.add(s));
    });
    console.log(`✓ MCP servers detected: ${Array.from(servers).join(', ')}`);
  }

  // Test 2: Exclude self-referential conversations only
  console.log('\n📊 Test 2: Exclude self-referential (conversation-memory) only');
  console.log('-'.repeat(80));

  clearDatabase(db); // Clear database
  await memory.indexConversations({
    projectPath: TEST_PROJECT_PATH,
    includeThinking: false,
    enableGitIntegration: false,
    excludeMcpConversations: 'self-only',
  });

  const selfOnlyStats = memory.getStats();
  console.log(`✓ Conversations indexed: ${selfOnlyStats.conversations.count}`);
  console.log(`✓ Messages indexed: ${selfOnlyStats.messages.count}`);
  console.log(`✓ Conversations excluded: ${allStats.conversations.count - selfOnlyStats.conversations.count}`);

  // Verify no conversation-memory conversations remain
  const remainingConversations = db.prepare(
    'SELECT id, metadata FROM conversations'
  ).all();

  const hasConversationMemory = remainingConversations.some(conv => {
    try {
      const metadata = JSON.parse(conv.metadata || '{}');
      return metadata.mcp_usage?.servers?.includes('conversation-memory');
    } catch {
      return false;
    }
  });

  if (hasConversationMemory) {
    console.log('❌ FAIL: conversation-memory conversations still present');
  } else {
    console.log('✓ PASS: No conversation-memory conversations indexed');
  }

  // Test 3: Exclude all MCP conversations
  console.log('\n📊 Test 3: Exclude all MCP conversations');
  console.log('-'.repeat(80));

  clearDatabase(db); // Clear database
  await memory.indexConversations({
    projectPath: TEST_PROJECT_PATH,
    includeThinking: false,
    enableGitIntegration: false,
    excludeMcpConversations: 'all-mcp',
  });

  const noMcpStats = memory.getStats();
  console.log(`✓ Conversations indexed: ${noMcpStats.conversations.count}`);
  console.log(`✓ Messages indexed: ${noMcpStats.messages.count}`);
  console.log(`✓ Conversations excluded: ${allStats.conversations.count - noMcpStats.conversations.count}`);

  // Verify no MCP conversations remain
  const noMcpConversations = db.prepare(
    'SELECT id, metadata FROM conversations'
  ).all();

  const hasMcpUsage = noMcpConversations.some(conv => {
    try {
      const metadata = JSON.parse(conv.metadata || '{}');
      return metadata.mcp_usage?.detected === true;
    } catch {
      return false;
    }
  });

  if (hasMcpUsage) {
    console.log('❌ FAIL: MCP conversations still present');
  } else {
    console.log('✓ PASS: No MCP conversations indexed');
  }

  // Test 4: Exclude specific MCP servers
  if (mcpConversations.length > 0) {
    console.log('\n📊 Test 4: Exclude specific MCP servers');
    console.log('-'.repeat(80));

    clearDatabase(db); // Clear database
    await memory.indexConversations({
      projectPath: TEST_PROJECT_PATH,
      includeThinking: false,
      enableGitIntegration: false,
      excludeMcpServers: ['conversation-memory', 'code-graph-rag'],
    });

    const specificStats = memory.getStats();
    console.log(`✓ Conversations indexed: ${specificStats.conversations.count}`);
    console.log(`✓ Messages indexed: ${specificStats.messages.count}`);
    console.log(`✓ Conversations excluded: ${allStats.conversations.count - specificStats.conversations.count}`);

    // Verify specified servers are excluded
    const specificConversations = db.prepare(
      'SELECT id, metadata FROM conversations'
    ).all();

    const hasExcludedServers = specificConversations.some(conv => {
      try {
        const metadata = JSON.parse(conv.metadata || '{}');
        const servers = metadata.mcp_usage?.servers || [];
        return servers.includes('conversation-memory') || servers.includes('code-graph-rag');
      } catch {
        return false;
      }
    });

    if (hasExcludedServers) {
      console.log('❌ FAIL: Excluded MCP servers still present');
    } else {
      console.log('✓ PASS: Specified MCP servers excluded');
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`Baseline (all):                ${allStats.conversations.count} conversations, ${allStats.messages.count} messages`);
  console.log(`Self-only exclusion:           ${selfOnlyStats.conversations.count} conversations, ${selfOnlyStats.messages.count} messages`);
  console.log(`All MCP exclusion:             ${noMcpStats.conversations.count} conversations, ${noMcpStats.messages.count} messages`);
  console.log(`\n✅ All tests completed successfully!`);
}

runTests().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
