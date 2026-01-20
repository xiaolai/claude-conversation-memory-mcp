/**
 * Help text and documentation for CLI
 */

import chalk from "chalk";
import { getSQLiteManager } from "../storage/SQLiteManager.js";
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
    const packageJsonPath = join(__dirname, "..", "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return packageJson.version;
  } catch (_error) {
    return "unknown";
  }
}

/**
 * Show welcome message
 */
export function showWelcome() {
  const dbPath = getSQLiteManager().getStats().dbPath;
  const shortPath = dbPath.replace(process.env.HOME || "", "~");
  const version = getVersion();
  const versionText = `CCCMemory v${version}`.padEnd(55);

  console.log(chalk.cyan("┌─────────────────────────────────────────────────────────┐"));
  console.log(chalk.cyan("│") + ` ${versionText} ` + chalk.cyan("│"));
  console.log(chalk.cyan("│") + ` Database: ${shortPath.padEnd(39)} ` + chalk.cyan("│"));
  console.log(chalk.cyan("│") + " Type 'help' for commands or 'exit' to quit             " + chalk.cyan("│"));
  console.log(chalk.cyan("└─────────────────────────────────────────────────────────┘"));
  console.log();
}

/**
 * Show main help screen
 */
export function showHelp(): string {
  const version = getVersion();
  return `
${chalk.bold(`CCCMemory v${version} - Interactive CLI`)}

${chalk.bold("CATEGORIES:")}

${chalk.yellow("📥 Indexing:")}
  ${chalk.green("index")}          Index conversation history
  ${chalk.green("reindex")}        Clear and re-index conversations

${chalk.yellow("🔍 Search:")}
  ${chalk.green("search")}         Search conversations
  ${chalk.green("decisions")}      Find decisions about a topic
  ${chalk.green("mistakes")}       Search past mistakes
  ${chalk.green("similar")}        Find similar sessions

${chalk.yellow("📋 Files:")}
  ${chalk.green("check")}          Check context before modifying file
  ${chalk.green("history")}        Show complete file evolution

${chalk.yellow("🔗 Git:")}
  ${chalk.green("commits")}        Link commits to conversations

${chalk.yellow("📝 Other:")}
  ${chalk.green("requirements")}   Get requirements for component
  ${chalk.green("tools")}          Query tool usage history
  ${chalk.green("docs")}           Generate documentation

${chalk.yellow("ℹ️ Info:")}
  ${chalk.green("status")}         Show database statistics
  ${chalk.green("info")}           Show information
  ${chalk.green("version")}        Show version

${chalk.yellow("⚙️ Config:")}
  ${chalk.green("config")}         Get/set configuration
  ${chalk.green("set")}            Set config value
  ${chalk.green("get")}            Get config value

${chalk.yellow("🔧 MCP Setup:")}
  ${chalk.green("init-mcp")}       Configure MCP in ~/.claude.json
  ${chalk.green("remove-mcp")}     Remove MCP configuration
  ${chalk.green("mcp-status")}     Check MCP configuration status

${chalk.yellow("🧹 Maintenance:")}
  ${chalk.green("clear")}          Clear screen
  ${chalk.green("reset")}          Reset database
  ${chalk.green("vacuum")}         Vacuum database

${chalk.yellow("📖 Help:")}
  ${chalk.green("help")}           Show this help or command help
  ${chalk.green("commands")}       List all commands

${chalk.yellow("🚪 Exit:")}
  ${chalk.green("exit")}           Exit REPL

${chalk.bold("COMMAND LINE OPTIONS:")}
  ${chalk.green("--version, -v")}   Show version and exit
  ${chalk.green("--server")}        Run as MCP server

Type ${chalk.cyan("'help <command>'")} for detailed command help.
Examples: ${chalk.cyan("help search")}, ${chalk.cyan("help index")}
`;
}

/**
 * Show command-specific help
 */
export function showCommandHelp(command: string): string {
  const helps: Record<string, string> = {
    index: `
${chalk.bold("COMMAND:")} index

${chalk.bold("USAGE:")}
  index [options]

${chalk.bold("DESCRIPTION:")}
  Index conversation history for current project.
  Parses .jsonl conversation files, extracts decisions and mistakes,
  links git commits, and generates embeddings for semantic search.

${chalk.bold("OPTIONS:")}
  --project <path>    Project path (default: current directory)
  --session <id>      Index specific session only (use list_recent_sessions.session_id)
  --exclude-mcp       Exclude MCP conversations
  --include-mcp       Include all MCP conversations
  --no-git            Disable git integration
  --thinking          Include thinking blocks

${chalk.bold("EXAMPLES:")}
  index
  index --exclude-mcp
  index --project /path/to/project
  index --session a1172af3-ca62-41be-9b90-701cef39daae

${chalk.bold("ALIASES:")}
  None

${chalk.bold("SEE ALSO:")}
  reindex, status
`,

    search: `
${chalk.bold("COMMAND:")} search

${chalk.bold("USAGE:")}
  search <query> [options]

${chalk.bold("DESCRIPTION:")}
  Search conversation history using natural language queries.
  Returns relevant messages with context including timestamps,
  git branches, and similarity scores.

${chalk.bold("OPTIONS:")}
  --limit <n>         Maximum number of results (default: 10)
  --after <date>      Filter messages after this date
  --before <date>     Filter messages before this date

${chalk.bold("EXAMPLES:")}
  search authentication system
  search "database migration" --limit 5
  search error --after 2025-01-01

${chalk.bold("ALIASES:")}
  find

${chalk.bold("SEE ALSO:")}
  decisions, mistakes, similar
`,

    status: `
${chalk.bold("COMMAND:")} status

${chalk.bold("USAGE:")}
  status

${chalk.bold("DESCRIPTION:")}
  Show database statistics including:
  - Number of indexed conversations
  - Total messages
  - Decisions and mistakes tracked
  - Git commits linked
  - Embeddings count and semantic search status

${chalk.bold("EXAMPLES:")}
  status

${chalk.bold("ALIASES:")}
  stats

${chalk.bold("SEE ALSO:")}
  info, version
`,

    decisions: `
${chalk.bold("COMMAND:")} decisions

${chalk.bold("USAGE:")}
  decisions <topic> [options]

${chalk.bold("DESCRIPTION:")}
  Find decisions made about a specific topic, file, or component.
  Shows rationale, alternatives considered, and rejected approaches.

${chalk.bold("OPTIONS:")}
  --file <path>       Filter by file path
  --limit <n>         Maximum results (default: 10)

${chalk.bold("EXAMPLES:")}
  decisions authentication
  decisions "API design"
  decisions database --file src/db.ts

${chalk.bold("ALIASES:")}
  why

${chalk.bold("SEE ALSO:")}
  search, mistakes
`,

    mistakes: `
${chalk.bold("COMMAND:")} mistakes

${chalk.bold("USAGE:")}
  mistakes <query> [options]

${chalk.bold("DESCRIPTION:")}
  Search past mistakes to avoid repeating them.
  Shows what went wrong and how it was corrected.

${chalk.bold("OPTIONS:")}
  --type <type>       Filter by type:
                      - logic_error
                      - wrong_approach
                      - misunderstanding
                      - tool_error
                      - syntax_error
  --limit <n>         Maximum results (default: 10)

${chalk.bold("EXAMPLES:")}
  mistakes async/await
  mistakes "type error" --type logic_error

${chalk.bold("ALIASES:")}
  errors

${chalk.bold("SEE ALSO:")}
  decisions, search
`,

    check: `
${chalk.bold("COMMAND:")} check

${chalk.bold("USAGE:")}
  check <file>

${chalk.bold("DESCRIPTION:")}
  Show important context before modifying a file.
  Shows recent changes, related decisions, commits, and past mistakes.

${chalk.bold("EXAMPLES:")}
  check src/auth.ts
  check database.ts

${chalk.bold("ALIASES:")}
  None

${chalk.bold("SEE ALSO:")}
  history, decisions
`,

    exit: `
${chalk.bold("COMMAND:")} exit

${chalk.bold("USAGE:")}
  exit

${chalk.bold("DESCRIPTION:")}
  Exit the REPL and return to shell.
  You can also use Ctrl+D to exit.

${chalk.bold("ALIASES:")}
  quit, q

${chalk.bold("SEE ALSO:")}
  None
`,

    "init-mcp": `
${chalk.bold("COMMAND:")} init-mcp

${chalk.bold("USAGE:")}
  init-mcp

${chalk.bold("DESCRIPTION:")}
  Automatically configure the cccmemory MCP server in
  Claude Code's global configuration (~/.claude.json).

  This command:
  - Checks if Claude Code is installed
  - Creates a backup of your configuration
  - Adds the MCP server to the mcpServers section
  - Provides helpful status messages

${chalk.bold("EXAMPLES:")}
  init-mcp

${chalk.bold("ALIASES:")}
  None

${chalk.bold("SEE ALSO:")}
  remove-mcp, mcp-status
`,

    "remove-mcp": `
${chalk.bold("COMMAND:")} remove-mcp

${chalk.bold("USAGE:")}
  remove-mcp

${chalk.bold("DESCRIPTION:")}
  Remove the cccmemory MCP server from Claude Code's
  global configuration (~/.claude.json).

  This command:
  - Confirms before removal
  - Creates a backup of your configuration
  - Removes the MCP server entry
  - Provides instructions for next steps

${chalk.bold("EXAMPLES:")}
  remove-mcp

${chalk.bold("ALIASES:")}
  None

${chalk.bold("SEE ALSO:")}
  init-mcp, mcp-status
`,

    "mcp-status": `
${chalk.bold("COMMAND:")} mcp-status

${chalk.bold("USAGE:")}
  mcp-status

${chalk.bold("DESCRIPTION:")}
  Display comprehensive status information about the MCP server
  configuration and installation.

  Shows:
  - Whether ~/.claude.json exists
  - Whether MCP server is configured
  - Whether command is installed globally
  - Current configuration details
  - Helpful recommendations if issues found

${chalk.bold("EXAMPLES:")}
  mcp-status

${chalk.bold("ALIASES:")}
  None

${chalk.bold("SEE ALSO:")}
  init-mcp, remove-mcp
`,
  };

  return helps[command] || chalk.yellow(`No help available for command: ${command}\n\nUse 'help' to see all available commands.`);
}
