#!/usr/bin/env node
/**
 * Post-install script to automatically configure cccmemory
 * in Claude Code's global configuration (~/.claude.json)
 */

/* eslint-env node */
/* eslint-disable no-console */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json');
const SERVER_NAME = 'cccmemory';
const ABI_RECORD_PATH = join(process.cwd(), '.node-abi.json');

function recordNodeAbi() {
  const payload = {
    nodeVersion: process.versions.node || 'unknown',
    modules: process.versions.modules || 'unknown',
    recordedAt: new Date().toISOString(),
  };

  try {
    writeFileSync(ABI_RECORD_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (error) {
    console.log(`⚠️  Failed to record Node ABI: ${error.message}`);
  }
}

function postInstall() {
  recordNodeAbi();

  // Only run if this is a global installation
  if (process.env.npm_config_global !== 'true') {
    console.log('📦 Local installation detected - skipping global MCP configuration');
    console.log('   To configure manually, run: claude mcp add --scope user cccmemory');
    return;
  }

  console.log('🔧 Configuring cccmemory in Claude Code...');

  // Check if Claude Code config exists
  if (!existsSync(CLAUDE_CONFIG_PATH)) {
    console.log('⚠️  Claude Code configuration not found at ~/.claude.json');
    console.log('   Please install Claude Code first: https://claude.ai/download');
    console.log('   Then run: claude mcp add --scope user cccmemory cccmemory');
    return;
  }

  try {
    // Read current configuration
    const configContent = readFileSync(CLAUDE_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(configContent);

    // Check if already configured
    if (config.mcpServers && config.mcpServers[SERVER_NAME]) {
      console.log('✓ cccmemory MCP server is already configured');
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
      command: 'cccmemory',
      args: [],
      env: {}
    };

    // Write updated configuration
    writeFileSync(
      CLAUDE_CONFIG_PATH,
      JSON.stringify(config, null, 2),
      'utf-8'
    );

    console.log('✅ Successfully configured cccmemory MCP server!');
    console.log();
    console.log('🎉 Setup complete! You can now use these tools in Claude Code:');
    console.log('   • index_conversations      - Index conversation history');
    console.log('   • search_conversations     - Search past conversations');
    console.log('   • get_decisions            - Find design decisions');
    console.log('   • check_before_modify      - Check file context before editing');
    console.log('   • forget_by_topic          - Selectively delete conversations');
    console.log('   • and 10 more tools...');
    console.log();
    console.log('📚 Documentation: https://github.com/xiaolai/cccmemory');
    console.log('🔍 List tools: /mcp (in Claude Code)');

  } catch (error) {
    console.error('❌ Failed to configure MCP server:', error.message);
    console.log();
    console.log('💡 Manual configuration:');
    console.log('   Add this to ~/.claude.json under "mcpServers":');
    console.log('   {');
    console.log('     "cccmemory": {');
    console.log('       "type": "stdio",');
    console.log('       "command": "cccmemory",');
    console.log('       "args": []');
    console.log('     }');
    console.log('   }');
  }
}

postInstall();
