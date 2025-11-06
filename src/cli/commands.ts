/**
 * Command execution and parsing for CLI
 */

import chalk from "chalk";
import Table from "cli-table3";
import { ToolHandlers } from "../tools/ToolHandlers.js";
import { getSQLiteManager } from "../storage/SQLiteManager.js";
import { showHelp, showCommandHelp } from "./help.js";
import { ConfigManager } from "../embeddings/ConfigManager.js";
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
 * Parse command line arguments
 */
function parseArgs(input: string): { command: string; args: string[]; options: Record<string, string | boolean> } {
  const parts = input.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const command = parts[0] || "";
  const rest = parts.slice(1);

  const args: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const part = rest[i];

    if (part.startsWith("--")) {
      const key = part.slice(2);
      const nextPart = rest[i + 1];

      if (nextPart && !nextPart.startsWith("--")) {
        options[key] = nextPart.replace(/^"(.*)"$/, "$1");
        i++;
      } else {
        options[key] = true;
      }
    } else {
      args.push(part.replace(/^"(.*)"$/, "$1"));
    }
  }

  return { command, args, options };
}

/**
 * Execute a command
 */
export async function executeCommand(
  input: string,
  handlers: ToolHandlers
): Promise<string | null> {
  const { command, args, options } = parseArgs(input);

  // Handle exit commands
  if (command === "exit" || command === "quit" || command === "q") {
    return "exit";
  }

  // Handle clear
  if (command === "clear") {
    return "clear";
  }

  // Handle help
  if (command === "help" || command === "?") {
    if (args.length > 0) {
      return showCommandHelp(args[0]);
    }
    return showHelp();
  }

  // Handle version
  if (command === "version") {
    return chalk.cyan(`Claude Conversation Memory v${getVersion()}`);
  }

  // Handle status/stats
  if (command === "status" || command === "stats") {
    return await handleStatus();
  }

  // Handle index
  if (command === "index") {
    return await handleIndex(handlers, options);
  }

  // Handle reindex
  if (command === "reindex") {
    return await handleReindex(handlers, options);
  }

  // Handle search
  if (command === "search" || command === "find") {
    if (args.length === 0) {
      return chalk.yellow("Usage: search <query> [options]");
    }
    return await handleSearch(handlers, args.join(" "), options);
  }

  // Handle decisions
  if (command === "decisions" || command === "why") {
    if (args.length === 0) {
      return chalk.yellow("Usage: decisions <topic> [options]");
    }
    return await handleDecisions(handlers, args.join(" "), options);
  }

  // Handle mistakes
  if (command === "mistakes" || command === "errors") {
    if (args.length === 0) {
      return chalk.yellow("Usage: mistakes <query> [options]");
    }
    return await handleMistakes(handlers, args.join(" "), options);
  }

  // Handle check
  if (command === "check") {
    if (args.length === 0) {
      return chalk.yellow("Usage: check <file>");
    }
    return await handleCheck(handlers, args[0]);
  }

  // Handle history/evolution
  if (command === "history" || command === "evolution") {
    if (args.length === 0) {
      return chalk.yellow("Usage: history <file> [options]");
    }
    return await handleHistory(handlers, args[0], options);
  }

  // Handle commits/git
  if (command === "commits" || command === "git") {
    return await handleCommits(handlers, args.join(" "), options);
  }

  // Handle similar/related
  if (command === "similar" || command === "related") {
    if (args.length === 0) {
      return chalk.yellow("Usage: similar <query> [options]");
    }
    return await handleSimilar(handlers, args.join(" "), options);
  }

  // Handle requirements/deps
  if (command === "requirements" || command === "deps") {
    if (args.length === 0) {
      return chalk.yellow("Usage: requirements <component> [options]");
    }
    return await handleRequirements(handlers, args.join(" "), options);
  }

  // Handle tools
  if (command === "tools" || command === "history-tools") {
    return await handleTools(handlers, options);
  }

  // Handle docs/generate
  if (command === "docs" || command === "generate") {
    return await handleDocs(handlers, options);
  }

  // Handle reset
  if (command === "reset") {
    return await handleReset();
  }

  // Handle vacuum
  if (command === "vacuum") {
    return await handleVacuum();
  }

  // Handle config
  if (command === "config") {
    if (args.length === 0) {
      return handleConfigShow();
    } else if (args.length === 2) {
      return handleConfigSet(args[0], args[1]);
    } else {
      return chalk.yellow("Usage: config                  (show current config)\n       config <key> <value>    (set config value)");
    }
  }

  // Handle get
  if (command === "get") {
    if (args.length === 0) {
      return chalk.yellow("Usage: get <key>");
    }
    return handleConfigGet(args[0]);
  }

  // Handle set
  if (command === "set") {
    if (args.length < 2) {
      return chalk.yellow("Usage: set <key> <value>");
    }
    return handleConfigSet(args[0], args[1]);
  }

  // Handle commands
  if (command === "commands") {
    return showHelp();
  }

  // Unknown command
  return chalk.yellow(`Unknown command: ${command}\nType 'help' for available commands.`);
}

/**
 * Handle status command
 */
async function handleStatus(): Promise<string> {
  const dbManager = getSQLiteManager();
  const db = dbManager.getDatabase();
  const stats = dbManager.getStats();
  const dbPath = stats.dbPath.replace(process.env.HOME || "", "~");

  // Query counts from database
  const conversations = (db.prepare("SELECT COUNT(*) as count FROM conversations").get() as { count: number }).count;
  const messages = (db.prepare("SELECT COUNT(*) as count FROM messages").get() as { count: number }).count;
  const decisions = (db.prepare("SELECT COUNT(*) as count FROM decisions").get() as { count: number }).count;
  const mistakes = (db.prepare("SELECT COUNT(*) as count FROM mistakes").get() as { count: number }).count;
  const commits = (db.prepare("SELECT COUNT(*) as count FROM git_commits").get() as { count: number }).count;
  const embeddings = (db.prepare("SELECT COUNT(*) as count FROM message_embeddings").get() as { count: number }).count;

  const table = new Table({
    head: [chalk.cyan("Metric"), chalk.cyan("Value")],
    colWidths: [30, 30],
  });

  table.push(
    ["Database", dbPath],
    ["Conversations", String(conversations)],
    ["Messages", String(messages)],
    ["Decisions", String(decisions)],
    ["Mistakes", String(mistakes)],
    ["Git Commits", String(commits)],
    ["Embeddings", String(embeddings)],
    ["Semantic Search", embeddings > 0 ? chalk.green("enabled") : chalk.yellow("disabled")]
  );

  let output = "\n" + table.toString() + "\n";

  if (conversations === 0) {
    output += "\n" + chalk.yellow("⚠️  No conversations indexed yet. Run 'index' to get started.\n");
  }

  return output;
}

/**
 * Handle index command
 */
async function handleIndex(handlers: ToolHandlers, options: Record<string, string | boolean>): Promise<string> {
  const args: Record<string, unknown> = {
    project_path: typeof options.project === "string" ? options.project : process.cwd(),
  };

  if (typeof options.session === "string") {
    args.session_id = options.session;
  }

  if (options["exclude-mcp"]) {
    args.exclude_mcp_conversations = "all-mcp";
  }

  if (options["include-mcp"]) {
    args.exclude_mcp_conversations = false;
  }

  if (options["no-git"]) {
    args.enable_git = false;
  }

  if (options.thinking) {
    args.include_thinking = true;
  }

  console.log(chalk.blue("Indexing conversations..."));
  const result = await handlers.indexConversations(args);

  return chalk.green(`\n✓ Indexing complete!\n\n${JSON.stringify(result, null, 2)}`);
}

/**
 * Handle reindex command
 */
async function handleReindex(handlers: ToolHandlers, options: Record<string, string | boolean>): Promise<string> {
  console.log(chalk.yellow("⚠️  This will clear all indexed data and re-index."));
  console.log(chalk.yellow("Press Ctrl+C to cancel, or wait 3 seconds to continue..."));

  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Clear database
  const db = getSQLiteManager().getDatabase();
  db.exec("DELETE FROM conversations");
  db.exec("DELETE FROM messages");
  db.exec("DELETE FROM decisions");
  db.exec("DELETE FROM mistakes");
  db.exec("DELETE FROM git_commits");

  console.log(chalk.blue("Database cleared. Indexing conversations..."));

  return await handleIndex(handlers, options);
}

/**
 * Handle search command
 */
async function handleSearch(
  handlers: ToolHandlers,
  query: string,
  options: Record<string, string | boolean>
): Promise<string> {
  const args: Record<string, unknown> = { query };

  if (typeof options.limit === "string") {
    args.limit = parseInt(options.limit, 10);
  }

  const result = await handlers.searchConversations(args);

  if (!result.results || result.results.length === 0) {
    return chalk.yellow(`No results found for: ${query}`);
  }

  let output = chalk.green(`\nFound ${result.results.length} results:\n\n`);

  result.results.forEach((r, i) => {
    output += chalk.cyan(`${i + 1}. `) + `[${r.timestamp}] Session ${r.conversation_id.slice(0, 8)}\n`;
    output += `   ${r.snippet.slice(0, 200)}${r.snippet.length > 200 ? "..." : ""}\n`;
    output += chalk.gray(`   Similarity: ${(r.similarity * 100).toFixed(1)}%\n\n`);
  });

  return output;
}

/**
 * Handle decisions command
 */
async function handleDecisions(
  handlers: ToolHandlers,
  query: string,
  options: Record<string, string | boolean>
): Promise<string> {
  const args: Record<string, unknown> = { query };

  if (typeof options.file === "string") {
    args.file_path = options.file;
  }

  if (typeof options.limit === "string") {
    args.limit = parseInt(options.limit, 10);
  }

  const result = await handlers.getDecisions(args);

  if (!result.decisions || result.decisions.length === 0) {
    return chalk.yellow(`No decisions found for: ${query}`);
  }

  let output = chalk.green(`\nFound ${result.decisions.length} decisions:\n\n`);

  result.decisions.forEach((d, i) => {
    output += chalk.cyan(`${i + 1}. ${d.decision_text}\n`);
    output += `   Date: ${d.timestamp}\n`;
    output += `   Rationale: ${d.rationale || "N/A"}\n`;
    if (d.alternatives_considered && d.alternatives_considered.length > 0) {
      output += `   Alternatives: ${d.alternatives_considered.join(", ")}\n`;
    }
    output += "\n";
  });

  return output;
}

/**
 * Handle mistakes command
 */
async function handleMistakes(
  handlers: ToolHandlers,
  query: string,
  options: Record<string, string | boolean>
): Promise<string> {
  const args: Record<string, unknown> = { query };

  if (typeof options.type === "string") {
    args.mistake_type = options.type;
  }

  if (typeof options.limit === "string") {
    args.limit = parseInt(options.limit, 10);
  }

  const result = await handlers.searchMistakes(args);

  if (!result.mistakes || result.mistakes.length === 0) {
    return chalk.yellow(`No mistakes found for: ${query}`);
  }

  let output = chalk.green(`\nFound ${result.mistakes.length} mistakes:\n\n`);

  result.mistakes.forEach((m, i) => {
    output += chalk.red(`${i + 1}. [${m.mistake_type}] ${m.what_went_wrong}\n`);
    output += `   Date: ${m.timestamp}\n`;
    output += chalk.green(`   Fix: ${m.correction || m.user_correction_message || "N/A"}\n\n`);
  });

  return output;
}

/**
 * Handle check command
 */
async function handleCheck(handlers: ToolHandlers, filePath: string): Promise<string> {
  const result = await handlers.checkBeforeModify({ file_path: filePath });

  return chalk.green(`\nContext for: ${filePath}\n\n`) + JSON.stringify(result, null, 2);
}

/**
 * Handle history command
 */
async function handleHistory(
  handlers: ToolHandlers,
  filePath: string,
  options: Record<string, string | boolean>
): Promise<string> {
  const args: Record<string, unknown> = { file_path: filePath };

  if (options["no-commits"]) {
    args.include_commits = false;
  }

  if (options["no-decisions"]) {
    args.include_decisions = false;
  }

  const result = await handlers.getFileEvolution(args);

  return chalk.green(`\nFile evolution for: ${filePath}\n\n`) + JSON.stringify(result, null, 2);
}

/**
 * Handle commits command
 */
async function handleCommits(
  handlers: ToolHandlers,
  query: string,
  options: Record<string, string | boolean>
): Promise<string> {
  const args: Record<string, unknown> = {};

  if (query) {
    args.query = query;
  }

  if (typeof options.conversation === "string") {
    args.conversation_id = options.conversation;
  }

  if (typeof options.limit === "string") {
    args.limit = parseInt(options.limit, 10);
  }

  const result = await handlers.linkCommitsToConversations(args);

  return chalk.green("\nCommits linked to conversations:\n\n") + JSON.stringify(result, null, 2);
}

/**
 * Handle similar command
 */
async function handleSimilar(
  handlers: ToolHandlers,
  query: string,
  options: Record<string, string | boolean>
): Promise<string> {
  const args: Record<string, unknown> = { query };

  if (typeof options.limit === "string") {
    args.limit = parseInt(options.limit, 10);
  }

  const result = await handlers.findSimilarSessions(args);

  return chalk.green("\nSimilar sessions:\n\n") + JSON.stringify(result, null, 2);
}

/**
 * Handle requirements command
 */
async function handleRequirements(
  handlers: ToolHandlers,
  component: string,
  options: Record<string, string | boolean>
): Promise<string> {
  const args: Record<string, unknown> = { component };

  if (typeof options.type === "string") {
    args.type = options.type;
  }

  const result = await handlers.getRequirements(args);

  return chalk.green(`\nRequirements for: ${component}\n\n`) + JSON.stringify(result, null, 2);
}

/**
 * Handle tools command
 */
async function handleTools(handlers: ToolHandlers, options: Record<string, string | boolean>): Promise<string> {
  const args: Record<string, unknown> = {};

  if (typeof options.file === "string") {
    args.file_path = options.file;
  }

  if (typeof options.tool === "string") {
    args.tool_name = options.tool;
  }

  if (typeof options.limit === "string") {
    args.limit = parseInt(options.limit, 10);
  }

  const result = await handlers.getToolHistory(args);

  return chalk.green("\nTool usage history:\n\n") + JSON.stringify(result, null, 2);
}

/**
 * Handle docs command
 */
async function handleDocs(handlers: ToolHandlers, options: Record<string, string | boolean>): Promise<string> {
  const args: Record<string, unknown> = {
    project_path: process.cwd(),
  };

  if (typeof options.scope === "string") {
    args.scope = options.scope;
  }

  if (typeof options.module === "string") {
    args.module_filter = options.module;
  }

  console.log(chalk.blue("Generating documentation..."));
  const result = await handlers.generateDocumentation(args);

  return chalk.green("\n✓ Documentation generated!\n\n") + JSON.stringify(result, null, 2);
}

/**
 * Handle reset command
 */
async function handleReset(): Promise<string> {
  console.log(chalk.red("⚠️  WARNING: This will delete ALL indexed data!"));
  console.log(chalk.yellow("Press Ctrl+C to cancel, or wait 5 seconds to continue..."));

  await new Promise((resolve) => setTimeout(resolve, 5000));

  const db = getSQLiteManager().getDatabase();
  db.exec("DELETE FROM conversations");
  db.exec("DELETE FROM messages");
  db.exec("DELETE FROM decisions");
  db.exec("DELETE FROM mistakes");
  db.exec("DELETE FROM git_commits");

  return chalk.green("\n✓ Database reset complete.\n");
}

/**
 * Handle vacuum command
 */
async function handleVacuum(): Promise<string> {
  const db = getSQLiteManager().getDatabase();
  const beforeSize = db.prepare("PRAGMA page_count").get() as { page_count: number };

  db.exec("VACUUM");

  const afterSize = db.prepare("PRAGMA page_count").get() as { page_count: number };
  const beforeKB = (beforeSize.page_count * 4096) / 1024;
  const afterKB = (afterSize.page_count * 4096) / 1024;

  return chalk.green(`\n✓ Database vacuumed: ${beforeKB.toFixed(1)}KB → ${afterKB.toFixed(1)}KB\n`);
}

/**
 * Handle config show command
 */
function handleConfigShow(): string {
  const sources = ConfigManager.getConfigSources();
  const configPath = ConfigManager.getConfigPath();
  const configExists = ConfigManager.configExists();

  let output = chalk.cyan("\n=== Embedding Configuration ===\n\n");

  // Show effective config
  output += chalk.bold("Current (Effective) Configuration:\n");
  const table = new Table({
    head: [chalk.cyan("Key"), chalk.cyan("Value")],
    colWidths: [20, 50],
  });

  table.push(
    ["Provider", sources.effective.provider],
    ["Model", sources.effective.model],
    ["Dimensions", String(sources.effective.dimensions || "auto")],
    ["Base URL", sources.effective.baseUrl || "N/A"],
    ["API Key", sources.effective.apiKey ? "***" + sources.effective.apiKey.slice(-4) : "N/A"]
  );

  output += table.toString() + "\n\n";

  // Show sources breakdown
  output += chalk.bold("Configuration Sources:\n\n");

  if (sources.home) {
    output += chalk.green(`✓ Home Config: ${configPath}\n`);
    output += `  Provider: ${sources.home.provider || "not set"}\n`;
    output += `  Model: ${sources.home.model || "not set"}\n`;
    output += `  Dimensions: ${sources.home.dimensions || "not set"}\n\n`;
  } else {
    output += chalk.gray(`  Home Config: ${configPath} (not found)\n\n`);
  }

  if (sources.project) {
    output += chalk.green("✓ Project Config: .claude-memory-config.json\n");
    output += `  Provider: ${sources.project.provider || "not set"}\n`;
    output += `  Model: ${sources.project.model || "not set"}\n\n`;
  }

  if (Object.keys(sources.env).length > 0) {
    output += chalk.green("✓ Environment Variables:\n");
    if (sources.env.provider) {
      output += `  EMBEDDING_PROVIDER=${sources.env.provider}\n`;
    }
    if (sources.env.model) {
      output += `  EMBEDDING_MODEL=${sources.env.model}\n`;
    }
    if (sources.env.dimensions) {
      output += `  EMBEDDING_DIMENSIONS=${sources.env.dimensions}\n`;
    }
    if (sources.env.baseUrl) {
      output += `  EMBEDDING_BASE_URL=${sources.env.baseUrl}\n`;
    }
    if (sources.env.apiKey) {
      output += `  OPENAI_API_KEY=***\n`;
    }
    output += "\n";
  }

  // Show usage instructions
  output += chalk.bold("Usage:\n");
  output += `  ${chalk.cyan("config")}                    Show this config\n`;
  output += `  ${chalk.cyan("config <key> <value>")}      Set config value\n`;
  output += `  ${chalk.cyan("get <key>")}                 Get specific value\n`;
  output += `  ${chalk.cyan("set <key> <value>")}         Set specific value\n\n`;

  output += chalk.bold("Valid Keys:\n");
  output += `  ${chalk.cyan("provider")}       ollama, transformers, openai\n`;
  output += `  ${chalk.cyan("model")}          Model name (e.g., mxbai-embed-large)\n`;
  output += `  ${chalk.cyan("dimensions")}     Embedding dimensions (e.g., 1024)\n`;
  output += `  ${chalk.cyan("baseUrl")}        Ollama base URL (default: http://localhost:11434)\n`;
  output += `  ${chalk.cyan("apiKey")}         OpenAI API key\n\n`;

  // Show available models by provider
  output += chalk.bold("Known Models by Provider:\n\n");

  output += chalk.yellow("Ollama (local):\n");
  output += `  ${"mxbai-embed-large".padEnd(30)} 1024 dims  ${chalk.dim("(recommended)")}\n`;
  output += `  ${"nomic-embed-text".padEnd(30)}  768 dims  ${chalk.dim("(fast, good quality)")}\n`;
  output += `  ${"all-minilm".padEnd(30)}  384 dims  ${chalk.dim("(lightweight)")}\n`;
  output += `  ${"snowflake-arctic-embed".padEnd(30)} 1024 dims  ${chalk.dim("(optimized for retrieval)")}\n\n`;

  output += chalk.yellow("Transformers (offline):\n");
  output += `  ${"Xenova/all-MiniLM-L6-v2".padEnd(30)}  384 dims  ${chalk.dim("(default, no setup)")}\n`;
  output += `  ${"Xenova/all-mpnet-base-v2".padEnd(30)}  768 dims  ${chalk.dim("(better quality)")}\n`;
  output += `  ${"Xenova/bge-small-en-v1.5".padEnd(30)}  384 dims  ${chalk.dim("(English-optimized)")}\n`;
  output += `  ${"Xenova/bge-base-en-v1.5".padEnd(30)}  768 dims  ${chalk.dim("(English, higher quality)")}\n\n`;

  output += chalk.yellow("OpenAI (cloud):\n");
  output += `  ${"text-embedding-3-small".padEnd(30)} 1536 dims  ${chalk.dim("(cost-effective)")}\n`;
  output += `  ${"text-embedding-3-large".padEnd(30)} 3072 dims  ${chalk.dim("(best quality)")}\n`;
  output += `  ${"text-embedding-ada-002".padEnd(30)} 1536 dims  ${chalk.dim("(legacy)")}\n\n`;

  output += chalk.gray(`Config file location: ${configPath}\n`);
  if (!configExists) {
    output += chalk.yellow("Config file will be created on first 'set' command.\n");
  }
  output += chalk.gray("See example config: .claude-memory-config.example.jsonc\n");

  return output;
}

/**
 * Handle config get command
 */
function handleConfigGet(key: string): string {
  try {
    const value = ConfigManager.getConfigValue(key);

    if (value === undefined || value === null) {
      return chalk.yellow(`Config key '${key}' is not set`);
    }

    // Mask API keys
    if (key === "apiKey" || key === "api_key") {
      const apiKey = value as string;
      return chalk.green(`${key}: ***${apiKey.slice(-4)}`);
    }

    return chalk.green(`${key}: ${value}`);
  } catch (error) {
    return chalk.red(`Error: ${(error as Error).message}`);
  }
}

/**
 * Handle config set command
 */
function handleConfigSet(key: string, value: string): string {
  try {
    ConfigManager.setConfigValue(key, value);

    // Show confirmation with helpful info
    let output = chalk.green(`✓ Config updated: ${key} = ${value}\n\n`);

    // If setting dimensions, suggest matching models
    if (key === "dimensions") {
      const dims = parseInt(value, 10);
      output += chalk.cyan("Models with matching dimensions:\n");
      if (dims === 384) {
        output += "  - Xenova/all-MiniLM-L6-v2 (transformers)\n";
        output += "  - all-minilm (ollama)\n";
      } else if (dims === 768) {
        output += "  - nomic-embed-text (ollama)\n";
        output += "  - Xenova/all-mpnet-base-v2 (transformers)\n";
      } else if (dims === 1024) {
        output += "  - mxbai-embed-large (ollama) ⭐ default\n";
        output += "  - snowflake-arctic-embed (ollama)\n";
      } else if (dims === 1536) {
        output += "  - text-embedding-3-small (openai)\n";
        output += "  - text-embedding-ada-002 (openai)\n";
      } else if (dims === 3072) {
        output += "  - text-embedding-3-large (openai)\n";
      }
      output += "\n";
    }

    // If setting model, suggest dimensions
    if (key === "model") {
      const knownDims = ConfigManager.getKnownModelDimensions(value);
      if (knownDims) {
        output += chalk.cyan(`💡 Tip: This model uses ${knownDims} dimensions\n`);
        output += `   Run: ${chalk.green(`set dimensions ${knownDims}`)}\n\n`;
      }
    }

    output += chalk.gray(`Config saved to: ${ConfigManager.getConfigPath()}\n`);

    return output;
  } catch (error) {
    return chalk.red(`Error: ${(error as Error).message}`);
  }
}
