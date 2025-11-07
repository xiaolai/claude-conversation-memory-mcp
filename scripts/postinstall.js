#!/usr/bin/env node
/**
 * Post-install script to automatically configure claude-conversation-memory-mcp
 * in Claude Code's global configuration (~/.claude.json)
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json');
const SERVER_NAME = 'conversation-memory';

function postInstall() {
  // Only run if this is a global installation
  if (process.env.npm_config_global !== 'true') {
    console.log('📦 Local installation detected - skipping global MCP configuration');
    console.log('   To configure manually, run: claude mcp add --scope user conversation-memory');
    return;
  }

  console.log('🔧 Configuring claude-conversation-memory-mcp in Claude Code...');

  // Check if Claude Code config exists
  if (!existsSync(CLAUDE_CONFIG_PATH)) {
    console.log('⚠️  Claude Code configuration not found at ~/.claude.json');
    console.log('   Please install Claude Code first: https://claude.ai/download');
    console.log('   Then run: claude mcp add --scope user conversation-memory claude-conversation-memory-mcp');
    return;
  }

  try {
    // Read current configuration
    const configContent = readFileSync(CLAUDE_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(configContent);

    // Check if already configured
    if (config.mcpServers && config.mcpServers[SERVER_NAME]) {
      console.log('✓ conversation-memory MCP server is already configured');
      console.log('  Current command:', config.mcpServers[SERVER_NAME].command);
      return;
    }

    // Create backup
    const backupPath = `${CLAUDE_CONFIG_PATH}.backup.${Date.now()}`;
    copyFileSync(CLAUDE_CONFIG_PATH, backupPath);
    console.log(`📋 Created backup: ${backupPath}`);

    // Initialize mcpServers object if it doesn't exist
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Add our MCP server configuration
    config.mcpServers[SERVER_NAME] = {
      type: 'stdio',
      command: 'claude-conversation-memory-mcp',
      args: [],
      env: {}
    };

    // Write updated configuration
    writeFileSync(
      CLAUDE_CONFIG_PATH,
      JSON.stringify(config, null, 2),
      'utf-8'
    );

    console.log('✅ Successfully configured conversation-memory MCP server!');
    console.log();
    console.log('🎉 Setup complete! You can now use these tools in Claude Code:');
    console.log('   • index_conversations      - Index conversation history');
    console.log('   • search_conversations     - Search past conversations');
    console.log('   • get_decisions            - Find design decisions');
    console.log('   • check_before_modify      - Check file context before editing');
    console.log('   • forget_by_topic          - Selectively delete conversations');
    console.log('   • and 10 more tools...');
    console.log();
    console.log('📚 Documentation: https://github.com/xiaolai/claude-conversation-memory-mcp');
    console.log('🔍 List tools: /mcp (in Claude Code)');

  } catch (error) {
    console.error('❌ Failed to configure MCP server:', error.message);
    console.log();
    console.log('💡 Manual configuration:');
    console.log('   Add this to ~/.claude.json under "mcpServers":');
    console.log('   {');
    console.log('     "conversation-memory": {');
    console.log('       "type": "stdio",');
    console.log('       "command": "claude-conversation-memory-mcp",');
    console.log('       "args": []');
    console.log('     }');
    console.log('   }');
  }
}

postInstall();
