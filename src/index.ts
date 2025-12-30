#!/usr/bin/env node

/**
 * Claude Conversation Memory - Main Entry Point
 * Supports both MCP server mode and interactive CLI mode
 */

import { ConversationMemoryServer } from "./mcp-server.js";
import { ConversationMemoryCLI } from "./cli/index.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get version from package.json
 */
function getVersion(): string {
  try {
    const packageJsonPath = join(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return packageJson.version;
  } catch (_error) {
    return "unknown";
  }
}

/**
 * Detect mode based on arguments and environment
 */
function detectMode(): "mcp" | "cli" | "single-command" | "version" {
  const args = process.argv.slice(2);

  // If --version or -v flag is present, show version
  if (args.includes("--version") || args.includes("-v")) {
    return "version";
  }

  // If --server flag is present, run MCP server mode
  if (args.includes("--server")) {
    return "mcp";
  }

  // If command arguments are present (excluding --server), run single command mode
  if (args.length > 0) {
    return "single-command";
  }

  // If not a TTY (running via stdio), run MCP server mode
  if (!process.stdin.isTTY) {
    return "mcp";
  }

  // Otherwise, run interactive CLI mode
  return "cli";
}

/**
 * Main entry point
 */
async function main() {
  const mode = detectMode();
  const args = process.argv.slice(2).filter((arg) => arg !== "--server");

  switch (mode) {
    case "version": {
      // Show version
      console.log(`claude-conversation-memory-mcp v${getVersion()}`);
      process.exit(0);
      break;
    }

    case "mcp": {
      // MCP Server Mode (for Claude Code CLI integration)
      const mcpServer = new ConversationMemoryServer();
      await mcpServer.start();
      break;
    }

    case "single-command": {
      // Single Command Mode
      const singleCLI = new ConversationMemoryCLI();
      await singleCLI.runSingleCommand(args.join(" "));
      break;
    }

    case "cli":
    default: {
      // Interactive REPL Mode
      const repl = new ConversationMemoryCLI();
      await repl.start();
      break;
    }
  }
}

// Run main
main().catch((error) => {
  const isDebug = process.env.LOG_LEVEL?.toUpperCase() === "DEBUG";
  console.error("Fatal error:", isDebug ? error : (error as Error).message);
  process.exit(1);
});
