#!/usr/bin/env node

/**
 * Claude Conversation Memory - Main Entry Point
 * Supports both MCP server mode and interactive CLI mode
 */

import { ConversationMemoryServer } from "./mcp-server.js";
import { ConversationMemoryCLI } from "./cli/index.js";

/**
 * Detect mode based on arguments and environment
 */
function detectMode(): "mcp" | "cli" | "single-command" {
  const args = process.argv.slice(2);

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
    case "mcp":
      // MCP Server Mode (for Claude Code CLI integration)
      const mcpServer = new ConversationMemoryServer();
      await mcpServer.start();
      break;

    case "single-command":
      // Single Command Mode
      const singleCLI = new ConversationMemoryCLI();
      await singleCLI.runSingleCommand(args.join(" "));
      break;

    case "cli":
    default:
      // Interactive REPL Mode
      const repl = new ConversationMemoryCLI();
      await repl.start();
      break;
  }
}

// Run main
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
