#!/usr/bin/env node
/**
 * Comprehensive test for all 11 MCP tools
 */

import { ConversationMemory } from './dist/ConversationMemory.js';
import { ToolHandlers } from './dist/tools/ToolHandlers.js';
import { getSQLiteManager } from './dist/storage/SQLiteManager.js';

async function testAllTools() {
  console.log('🧪 Testing all 11 MCP tools...\n');

  const sqliteManager = getSQLiteManager({
    projectPath: '/Users/joker/github/xiaolai/claude-conversation-memory-mcp'
  });

  const memory = new ConversationMemory({
    projectPath: '/Users/joker/github/xiaolai/claude-conversation-memory-mcp'
  });

  const handlers = new ToolHandlers(memory, sqliteManager);

  try {
    // Tool 1: index_conversations
    console.log('\n📥 [1/11] Testing index_conversations...');
    const indexResult = await handlers.indexConversations({
      project_path: '/Users/joker/github/xiaolai/claude-conversation-memory-mcp',
      enable_git: true,
      include_thinking: false
    });
    console.log(`✅ Indexed: ${indexResult.stats.messages.count} messages, ${indexResult.stats.decisions.count} decisions`);

    // Tool 2: search_conversations
    console.log('\n🔍 [2/11] Testing search_conversations...');
    const searchResult = await handlers.searchConversations({
      query: 'embedding system',
      limit: 5
    });
    console.log(`✅ Found ${searchResult.results.length} matching conversations`);
    if (searchResult.results.length > 0) {
      console.log(`   Top result: ${searchResult.results[0].snippet.substring(0, 80)}...`);
    }

    // Tool 3: get_decisions
    console.log('\n🎯 [3/11] Testing get_decisions...');
    const decisionsResult = await handlers.getDecisions({
      query: 'embedding',
      limit: 3
    });
    console.log(`✅ Found ${decisionsResult.decisions.length} decisions about 'embedding'`);
    if (decisionsResult.decisions.length > 0) {
      console.log(`   Example: ${decisionsResult.decisions[0].decision_text.substring(0, 80)}...`);
    }

    // Tool 4: check_before_modify
    console.log('\n📋 [4/11] Testing check_before_modify...');
    const checkResult = await handlers.checkBeforeModify({
      file_path: 'src/embeddings/EmbeddingGenerator.ts'
    });
    console.log(`✅ File context: ${checkResult.recent_changes?.length || 0} changes, ${checkResult.related_decisions.length} decisions`);

    // Tool 5: get_file_evolution
    console.log('\n📜 [5/11] Testing get_file_evolution...');
    const evolutionResult = await handlers.getFileEvolution({
      file_path: 'package.json',
      include_commits: true,
      include_decisions: true
    });
    console.log(`✅ File evolution: ${evolutionResult.timeline.length} events`);

    // Tool 6: link_commits_to_conversations
    console.log('\n🔗 [6/11] Testing link_commits_to_conversations...');
    const linkResult = await handlers.linkCommitsToConversations({
      limit: 5
    });
    console.log(`✅ Linked commits: ${linkResult.commits.length} commits found`);

    // Tool 7: search_mistakes
    console.log('\n⚠️  [7/11] Testing search_mistakes...');
    const mistakesResult = await handlers.searchMistakes({
      query: 'bug',
      limit: 5
    });
    console.log(`✅ Found ${mistakesResult.mistakes.length} past mistakes`);
    if (mistakesResult.mistakes.length > 0) {
      console.log(`   Example: ${mistakesResult.mistakes[0].what_went_wrong.substring(0, 80)}...`);
    }

    // Tool 8: get_requirements
    console.log('\n📝 [8/11] Testing get_requirements...');
    const reqResult = await handlers.getRequirements({
      component: 'embedding'
    });
    console.log(`✅ Found ${reqResult.requirements.length} requirements for 'embedding'`);

    // Tool 9: get_tool_history
    console.log('\n🛠️  [9/11] Testing get_tool_history...');
    const toolHistoryResult = await handlers.getToolHistory({
      tool_name: 'Edit',
      limit: 10
    });
    console.log(`✅ Tool history: ${toolHistoryResult.tool_uses.length} Edit operations found`);

    // Tool 10: find_similar_sessions
    console.log('\n🔄 [10/11] Testing find_similar_sessions...');
    const similarResult = await handlers.findSimilarSessions({
      query: 'fixing bugs and linting errors',
      limit: 3
    });
    console.log(`✅ Found ${similarResult.sessions.length} similar sessions`);

    // Tool 11: generate_documentation
    console.log('\n📚 [11/11] Testing generate_documentation...');
    const docsResult = await handlers.generateDocumentation({
      scope: 'architecture',
      project_path: '/Users/joker/github/xiaolai/claude-conversation-memory-mcp'
    });
    console.log(`✅ Generated documentation: ${docsResult.documentation.length} characters`);
    console.log(`   Preview: ${docsResult.documentation.substring(0, 120)}...`);

    console.log('\n\n🎉 All 11 tools tested successfully!\n');

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('📊 Test Summary');
    console.log('═══════════════════════════════════════');
    console.log('✅ index_conversations');
    console.log('✅ search_conversations');
    console.log('✅ get_decisions');
    console.log('✅ check_before_modify');
    console.log('✅ get_file_evolution');
    console.log('✅ link_commits_to_conversations');
    console.log('✅ search_mistakes');
    console.log('✅ get_requirements');
    console.log('✅ get_tool_history');
    console.log('✅ find_similar_sessions');
    console.log('✅ generate_documentation');
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    sqliteManager.close();
  }
}

testAllTools();
