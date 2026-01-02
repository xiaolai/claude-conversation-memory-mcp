#!/usr/bin/env node
/**
 * Generate MCP configuration for local development testing.
 *
 * Usage: npm run dev:config
 *
 * This outputs the JSON configuration to add to your Claude Code settings
 * for testing the local build instead of the published npm package.
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const entryPoint = resolve(projectRoot, "dist", "index.js");

const config = {
  "conversation-memory": {
    command: "node",
    args: [entryPoint],
  },
};

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           Local Development MCP Configuration                    ║
╚══════════════════════════════════════════════════════════════════╝

Add this to your Claude Code MCP settings (~/.claude.json or VS Code settings):

${JSON.stringify({ mcpServers: config }, null, 2)}

Or just the server entry:

${JSON.stringify(config, null, 2)}

────────────────────────────────────────────────────────────────────
Entry point: ${entryPoint}

Steps to test local changes:
1. Make your code changes
2. Run: npm run build
3. Restart Claude Code (Cmd+Shift+P > "Developer: Reload Window" in VS Code)
4. Test your changes

To switch back to published version, use:
{
  "conversation-memory": {
    "command": "npx",
    "args": ["-y", "claude-conversation-memory-mcp"]
  }
}
────────────────────────────────────────────────────────────────────
`);
