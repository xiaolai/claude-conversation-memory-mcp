/**
 * Command execution and parsing for CLI
 */

import chalk from "chalk";
import Table from "cli-table3";
import { ToolHandlers } from "../tools/ToolHandlers.js";
import { getSQLiteManager } from "../storage/SQLiteManager.js";
import { showHelp, showCommandHelp } from "./help.js";
import { ConfigManager } from "../embeddings/ConfigManager.js";
import { getMcpStatus } from "../utils/McpConfig.js";
import {
  getModelsByProvider,
  getAllModels,
  getModelsByQuality,
  getRecommendedModel,
  modelExists,
  type ModelInfo
} from "../embeddings/ModelRegistry.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import prompts from "prompts";

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
    return chalk.cyan(`CCCMemory v${getVersion()}`);
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

  // Handle models
  if (command === "models") {
    return handleModels(args);
  }

  // Handle select-model (interactive)
  if (command === "select-model" || command === "select") {
    return await handleSelectModel();
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

  // Handle init-mcp
  if (command === "init-mcp") {
    return await handleInitMcp();
  }

  // Handle remove-mcp
  if (command === "remove-mcp") {
    return await handleRemoveMcp();
  }

  // Handle mcp-status
  if (command === "mcp-status") {
    return handleMcpStatus();
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

  // Show available models by provider using ModelRegistry
  output += chalk.bold("Known Models by Provider:\n\n");

  // Ollama models
  output += chalk.yellow("Ollama (local):\n");
  const ollamaModels = getModelsByProvider("ollama");
  for (const model of ollamaModels) {
    const suffix = model.installation ? ` ${chalk.dim(`(${model.description})`)}` : "";
    output += `  ${model.name.padEnd(30)} ${model.dimensions.toString().padStart(4)} dims${suffix}\n`;
  }
  output += "\n";

  // Transformers models
  output += chalk.yellow("Transformers (offline):\n");
  const transformersModels = getModelsByProvider("transformers");
  for (const model of transformersModels) {
    output += `  ${model.name.padEnd(30)} ${model.dimensions.toString().padStart(4)} dims  ${chalk.dim(`(${model.description})`)}\n`;
  }
  output += "\n";

  // OpenAI models
  output += chalk.yellow("OpenAI (cloud):\n");
  const openaiModels = getModelsByProvider("openai");
  for (const model of openaiModels) {
    const costSuffix = model.cost ? ` - ${model.cost}` : "";
    output += `  ${model.name.padEnd(30)} ${model.dimensions.toString().padStart(4)} dims  ${chalk.dim(`(${model.description}${costSuffix})`)}\n`;
  }
  output += "\n";

  output += chalk.gray(`Config file location: ${configPath}\n`);
  if (!configExists) {
    output += chalk.yellow("Config file will be created on first 'set' command.\n");
  }

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
    // Validate model name if setting model
    if (key === "model") {
      if (!modelExists(value)) {
        let warning = chalk.yellow(`⚠️  Model '${value}' is not in the registry.\n\n`);
        warning += chalk.gray("This might be a custom model. If so, make sure to also set the correct dimensions.\n\n");
        warning += chalk.cyan("Known models:\n");
        warning += chalk.gray("  Run 'models' to see all available models\n");
        warning += chalk.gray("  Or 'models <provider>' to see provider-specific models\n\n");
        warning += chalk.yellow("Proceeding with custom model...\n\n");
        console.warn(warning);
      }
    }

    ConfigManager.setConfigValue(key, value);

    // Show confirmation with helpful info
    let output = chalk.green(`✓ Config updated: ${key} = ${value}\n\n`);

    // If setting dimensions, suggest matching models
    if (key === "dimensions") {
      const dims = parseInt(value, 10);
      const matchingModels = getAllModels().filter(m => m.dimensions === dims);
      if (matchingModels.length > 0) {
        output += chalk.cyan("Models with matching dimensions:\n");
        for (const model of matchingModels) {
          output += `  - ${model.name} (${model.provider})\n`;
        }
        output += "\n";
      }
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

/**
 * Handle models command - List, filter, search models
 * Usage:
 *   models                    - List all models
 *   models <provider>         - Filter by provider (ollama, transformers, openai)
 *   models quality <tier>     - Filter by quality (low, medium, high, highest)
 *   models recommend          - Show recommended models for each provider
 */
function handleModels(args: string[]): string {
  let output = "";

  // No args: list all models
  if (args.length === 0) {
    output += chalk.bold("📚 All Available Embedding Models\n\n");
    const allModels = getAllModels();
    output += formatModelsTable(allModels);
    output += "\n";
    output += chalk.gray("💡 Tip: Use 'models <provider>' to filter by provider\n");
    output += chalk.gray("   Or: 'models quality <tier>' to filter by quality\n");
    output += chalk.gray("   Or: 'models recommend' to see recommendations\n");
    return output;
  }

  const subcommand = args[0].toLowerCase();

  // Filter by provider
  if (["ollama", "transformers", "openai"].includes(subcommand)) {
    const models = getModelsByProvider(subcommand);
    output += chalk.bold(`📚 ${capitalize(subcommand)} Models\n\n`);
    output += formatModelsTable(models);

    // Show recommended model for this provider
    const recommended = getRecommendedModel(subcommand);
    if (recommended) {
      output += "\n";
      output += chalk.cyan(`⭐ Recommended: ${recommended.name} (${recommended.dimensions} dims, ${recommended.quality} quality)\n`);
    }
    return output;
  }

  // Filter by quality
  if (subcommand === "quality") {
    if (args.length < 2) {
      return chalk.yellow("Usage: models quality <tier>\nTiers: low, medium, high, highest");
    }
    const quality = args[1].toLowerCase() as ModelInfo["quality"];
    if (!["low", "medium", "high", "highest"].includes(quality)) {
      return chalk.red(`Invalid quality tier: ${args[1]}\nValid tiers: low, medium, high, highest`);
    }
    const models = getModelsByQuality(quality);
    output += chalk.bold(`📚 ${capitalize(quality)} Quality Models\n\n`);
    output += formatModelsTable(models);
    return output;
  }

  // Show recommended models
  if (subcommand === "recommend" || subcommand === "recommended") {
    output += chalk.bold("⭐ Recommended Models by Provider\n\n");

    const providers = ["ollama", "transformers", "openai"];
    for (const provider of providers) {
      const recommended = getRecommendedModel(provider);
      if (recommended) {
        output += chalk.yellow(`${capitalize(provider)}:\n`);
        output += `  ${chalk.green(recommended.name)} ${chalk.dim(`(${recommended.dimensions} dims, ${recommended.quality} quality)`)}\n`;
        output += `  ${chalk.dim(recommended.description)}\n`;
        if (recommended.installation) {
          output += `  ${chalk.dim(`Install: ${recommended.installation}`)}\n`;
        }
        if (recommended.cost) {
          output += `  ${chalk.dim(`Cost: ${recommended.cost}`)}\n`;
        }
        output += "\n";
      }
    }
    return output;
  }

  return chalk.yellow(`Unknown models subcommand: ${subcommand}\n\nUsage:\n  models                    - List all models\n  models <provider>         - Filter by provider (ollama, transformers, openai)\n  models quality <tier>     - Filter by quality\n  models recommend          - Show recommendations`);
}

/**
 * Format models into a table
 */
function formatModelsTable(models: ModelInfo[]): string {
  const table = new Table({
    head: [
      chalk.cyan("Model"),
      chalk.cyan("Provider"),
      chalk.cyan("Dimensions"),
      chalk.cyan("Quality"),
      chalk.cyan("Description")
    ],
    colWidths: [35, 13, 12, 10, 45],
    wordWrap: true,
  });

  for (const model of models) {
    table.push([
      model.name,
      model.provider,
      model.dimensions.toString(),
      model.quality,
      model.description
    ]);
  }

  return table.toString();
}

/**
 * Capitalize first letter
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Handle interactive model selection
 */
async function handleSelectModel(): Promise<string> {
  try {
    // Step 1: Choose provider
    const providerResponse = await prompts({
      type: "select",
      name: "provider",
      message: "Choose an embedding provider:",
      choices: [
        {
          title: "Ollama (Local, High Quality)",
          value: "ollama",
          description: "Run models locally with Ollama. Requires: ollama serve"
        },
        {
          title: "Transformers (Offline, No Setup)",
          value: "transformers",
          description: "Auto-download models, runs offline. No external setup needed."
        },
        {
          title: "OpenAI (Cloud, Highest Quality)",
          value: "openai",
          description: "Cloud API with best quality. Requires API key and costs money."
        }
      ],
      initial: 0,
    });

    if (!providerResponse.provider) {
      return chalk.yellow("Selection cancelled");
    }

    const provider = providerResponse.provider as string;

    // Step 2: Choose model from that provider
    const models = getModelsByProvider(provider);
    const modelChoices = models.map(m => ({
      title: `${m.name} (${m.dimensions} dims, ${m.quality} quality)`,
      value: m.name,
      description: m.description + (m.installation ? ` - ${m.installation}` : "") + (m.cost ? ` - ${m.cost}` : "")
    }));

    // Highlight recommended model
    const recommended = getRecommendedModel(provider);
    if (recommended) {
      const recIndex = modelChoices.findIndex(c => c.value === recommended.name);
      if (recIndex >= 0) {
        modelChoices[recIndex].title = `⭐ ${modelChoices[recIndex].title} (recommended)`;
      }
    }

    const modelResponse = await prompts({
      type: "select",
      name: "model",
      message: `Choose a model from ${capitalize(provider)}:`,
      choices: modelChoices,
      initial: 0,
    });

    if (!modelResponse.model) {
      return chalk.yellow("Selection cancelled");
    }

    const modelName = modelResponse.model as string;
    const selectedModel = models.find(m => m.name === modelName);

    if (!selectedModel) {
      return chalk.red("Error: Model not found");
    }

    // Step 3: Confirm and save
    const confirmResponse = await prompts({
      type: "confirm",
      name: "confirm",
      message: `Set ${selectedModel.name} as your embedding model?\n  Provider: ${selectedModel.provider}\n  Dimensions: ${selectedModel.dimensions}\n  Quality: ${selectedModel.quality}`,
      initial: true,
    });

    if (!confirmResponse.confirm) {
      return chalk.yellow("Selection cancelled");
    }

    // Save configuration
    ConfigManager.setConfigValue("provider", provider);
    ConfigManager.setConfigValue("model", modelName);
    ConfigManager.setConfigValue("dimensions", selectedModel.dimensions.toString());

    let output = chalk.green(`✓ Configuration updated!\n\n`);
    output += `  Provider: ${chalk.cyan(provider)}\n`;
    output += `  Model: ${chalk.cyan(modelName)}\n`;
    output += `  Dimensions: ${chalk.cyan(selectedModel.dimensions)}\n\n`;

    // Add setup instructions
    if (selectedModel.installation) {
      output += chalk.yellow(`⚠️  Setup Required:\n`);
      output += `  ${selectedModel.installation}\n\n`;
    }

    if (selectedModel.cost) {
      output += chalk.yellow(`💰 Cost: ${selectedModel.cost}\n\n`);
    }

    output += chalk.dim("💡 Tip: You may need to reindex conversations for the new model:\n");
    output += chalk.dim("   reset && index\n\n");
    output += chalk.gray(`Config saved to: ${ConfigManager.getConfigPath()}\n`);

    return output;
  } catch (error) {
    if ((error as { message?: string }).message === "User force closed the prompt") {
      return chalk.yellow("\nSelection cancelled");
    }
    return chalk.red(`Error: ${(error as Error).message}`);
  }
}

/**
 * Handle init-mcp command - Configure MCP server in ~/.claude.json
 */
async function handleInitMcp(): Promise<string> {
  const { isMcpConfigured, addMcpServer } = await import("../utils/McpConfig.js");

  try {
    const { configured, configPath } = isMcpConfigured();

    if (configured) {
      return chalk.yellow(`✓ MCP server is already configured in ${configPath}\n`) +
             chalk.dim("  Use 'mcp-status' to see configuration details\n");
    }

    // Configure the MCP server
    addMcpServer();

    let output = chalk.green("✅ Successfully configured cccmemory MCP server!\n\n");
    output += chalk.cyan("Configuration added to: ") + chalk.white(`${configPath}\n\n`);
    output += chalk.bold("🎉 Available MCP Tools:\n");
    output += chalk.dim("   • index_conversations      - Index conversation history\n");
    output += chalk.dim("   • search_conversations     - Search past conversations\n");
    output += chalk.dim("   • get_decisions            - Find design decisions\n");
    output += chalk.dim("   • check_before_modify      - Check file context before editing\n");
    output += chalk.dim("   • get_file_evolution       - Track file changes over time\n");
    output += chalk.dim("   • and 10 more tools...\n\n");
    output += chalk.yellow("💡 Restart Claude Code to load the new MCP server\n");
    output += chalk.dim("   Run '/mcp' in Claude Code to list all available tools\n");

    return output;
  } catch (error) {
    return chalk.red(`❌ Failed to configure MCP server: ${(error as Error).message}\n\n`) +
           chalk.yellow("Manual configuration:\n") +
           chalk.dim("  Add this to ~/.claude.json under \"mcpServers\":\n") +
           chalk.dim("  {\n") +
           chalk.dim("    \"cccmemory\": {\n") +
           chalk.dim("      \"type\": \"stdio\",\n") +
           chalk.dim("      \"command\": \"cccmemory\",\n") +
           chalk.dim("      \"args\": []\n") +
           chalk.dim("    }\n") +
           chalk.dim("  }\n");
  }
}

/**
 * Handle remove-mcp command - Remove MCP server configuration
 */
async function handleRemoveMcp(): Promise<string> {
  const { isMcpConfigured, removeMcpServer } = await import("../utils/McpConfig.js");
  const prompts = (await import("prompts")).default;

  try {
    const { configured, configPath } = isMcpConfigured();

    if (!configured) {
      return chalk.yellow("⚠️  MCP server is not configured\n") +
             chalk.dim("  Nothing to remove\n");
    }

    // Confirm removal
    const response = await prompts({
      type: "confirm",
      name: "confirm",
      message: `Remove cccmemory MCP server from ${configPath}?`,
      initial: false,
    });

    if (!response.confirm) {
      return chalk.yellow("Removal cancelled\n");
    }

    // Remove the MCP server
    removeMcpServer();

    let output = chalk.green("✅ Successfully removed cccmemory MCP server\n\n");
    output += chalk.cyan("Configuration removed from: ") + chalk.white(`${configPath}\n\n`);
    output += chalk.yellow("💡 Restart Claude Code to apply changes\n");
    output += chalk.dim("   Run 'init-mcp' to reconfigure if needed\n");

    return output;
  } catch (error) {
    if ((error as { message?: string }).message === "User force closed the prompt") {
      return chalk.yellow("\nRemoval cancelled");
    }
    return chalk.red(`❌ Failed to remove MCP server: ${(error as Error).message}\n`);
  }
}

/**
 * Handle mcp-status command - Show MCP server configuration status
 */
function handleMcpStatus(): string {
  const status = getMcpStatus();

  const table = new Table({
    head: [chalk.cyan("Status"), chalk.cyan("Value")],
    colWidths: [30, 50],
  });

  table.push(
    ["Claude Config Exists", status.claudeConfigExists ? chalk.green("✓ Yes") : chalk.red("✗ No")],
    ["MCP Server Configured", status.mcpConfigured ? chalk.green("✓ Yes") : chalk.yellow("✗ No")],
    ["Command Installed", status.commandExists ? chalk.green("✓ Yes") : chalk.yellow("✗ No")]
  );

  if (status.commandPath) {
    table.push(["Command Path", chalk.dim(status.commandPath)]);
  }

  if (status.serverConfig) {
    table.push(
      ["Server Type", chalk.dim(status.serverConfig.type)],
      ["Server Command", chalk.dim(status.serverConfig.command)]
    );
  }

  let output = "\n" + table.toString() + "\n";

  // Add recommendations
  if (!status.claudeConfigExists) {
    output += "\n" + chalk.yellow("⚠️  Claude Code configuration not found at ~/.claude.json\n");
    output += chalk.dim("   Please install Claude Code first: https://claude.ai/download\n");
  } else if (!status.mcpConfigured) {
    output += "\n" + chalk.yellow("⚠️  MCP server is not configured\n");
    output += chalk.dim("   Run 'init-mcp' to configure automatically\n");
  } else if (!status.commandExists) {
    output += "\n" + chalk.yellow("⚠️  Command not found in global npm bin\n");
    output += chalk.dim("   Reinstall: npm install -g cccmemory\n");
  } else {
    output += "\n" + chalk.green("✅ Everything looks good! MCP server is ready to use.\n");
    output += chalk.dim("   Restart Claude Code if you haven't already\n");
  }

  return output;
}
