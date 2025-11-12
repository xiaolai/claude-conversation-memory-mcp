/**
 * MCP Configuration Management Utilities
 * Handles reading, writing, and managing MCP server configuration in ~/.claude.json
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json');
const SERVER_NAME = 'conversation-memory';

export interface McpServerConfig {
  type: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ClaudeConfig {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

/**
 * Read Claude configuration
 */
export function readClaudeConfig(): ClaudeConfig | null {
  if (!existsSync(CLAUDE_CONFIG_PATH)) {
    return null;
  }

  try {
    const content = readFileSync(CLAUDE_CONFIG_PATH, 'utf-8');
    return JSON.parse(content) as ClaudeConfig;
  } catch (error) {
    throw new Error(`Failed to parse ${CLAUDE_CONFIG_PATH}: ${(error as Error).message}`);
  }
}

/**
 * Write Claude configuration
 */
export function writeClaudeConfig(config: ClaudeConfig, createBackup = true): void {
  if (createBackup && existsSync(CLAUDE_CONFIG_PATH)) {
    const backupPath = `${CLAUDE_CONFIG_PATH}.backup.${Date.now()}`;
    copyFileSync(CLAUDE_CONFIG_PATH, backupPath);
  }

  writeFileSync(
    CLAUDE_CONFIG_PATH,
    JSON.stringify(config, null, 2),
    'utf-8'
  );
}

/**
 * Get the command path for the MCP server
 * Handles both global npm install and local development
 */
export function getMcpCommand(): string {
  try {
    // Try to find global npm bin
    const npmBin = execSync('npm bin -g', { encoding: 'utf-8' }).trim();
    const globalPath = join(npmBin, 'claude-conversation-memory-mcp');

    if (existsSync(globalPath)) {
      return 'claude-conversation-memory-mcp';
    }
  } catch (_error) {
    // Fallback to command name
  }

  return 'claude-conversation-memory-mcp';
}

/**
 * Check if MCP server is configured
 */
export function isMcpConfigured(): { configured: boolean; config?: McpServerConfig; configPath?: string } {
  const config = readClaudeConfig();

  if (!config) {
    return { configured: false };
  }

  const mcpConfig = config.mcpServers?.[SERVER_NAME];

  if (mcpConfig) {
    return {
      configured: true,
      config: mcpConfig,
      configPath: CLAUDE_CONFIG_PATH
    };
  }

  return { configured: false, configPath: CLAUDE_CONFIG_PATH };
}

/**
 * Add MCP server to configuration
 */
export function addMcpServer(): void {
  const config = readClaudeConfig();

  if (!config) {
    throw new Error('Claude Code configuration not found. Please install Claude Code first.');
  }

  // Initialize mcpServers if it doesn't exist
  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  // Check if already configured
  if (config.mcpServers[SERVER_NAME]) {
    throw new Error('MCP server is already configured');
  }

  // Add MCP server configuration
  config.mcpServers[SERVER_NAME] = {
    type: 'stdio',
    command: getMcpCommand(),
    args: [],
    env: {}
  };

  writeClaudeConfig(config, true);
}

/**
 * Remove MCP server from configuration
 */
export function removeMcpServer(): void {
  const config = readClaudeConfig();

  if (!config) {
    throw new Error('Claude Code configuration not found');
  }

  if (!config.mcpServers || !config.mcpServers[SERVER_NAME]) {
    throw new Error('MCP server is not configured');
  }

  // Remove the server
  delete config.mcpServers[SERVER_NAME];

  writeClaudeConfig(config, true);
}

/**
 * Get MCP server status
 */
export function getMcpStatus(): {
  claudeConfigExists: boolean;
  mcpConfigured: boolean;
  serverConfig?: McpServerConfig;
  commandExists: boolean;
  commandPath?: string;
} {
  const claudeConfigExists = existsSync(CLAUDE_CONFIG_PATH);
  const { configured, config } = isMcpConfigured();

  let commandExists = false;
  let commandPath: string | undefined;

  try {
    const npmBin = execSync('npm bin -g', { encoding: 'utf-8' }).trim();
    commandPath = join(npmBin, 'claude-conversation-memory-mcp');
    commandExists = existsSync(commandPath);
  } catch (_error) {
    // Command not found
  }

  return {
    claudeConfigExists,
    mcpConfigured: configured,
    serverConfig: config,
    commandExists,
    commandPath
  };
}
