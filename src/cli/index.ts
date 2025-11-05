/**
 * Claude Conversation Memory - Interactive CLI/REPL
 * Main entry point for interactive mode
 */

import * as readline from "node:readline";
import chalk from "chalk";
import { ConversationMemory } from "../ConversationMemory.js";
import { ToolHandlers } from "../tools/ToolHandlers.js";
import { getSQLiteManager } from "../storage/SQLiteManager.js";
import { executeCommand } from "./commands.js";
import { showWelcome } from "./help.js";

/**
 * Interactive REPL for Claude Conversation Memory
 */
export class ConversationMemoryCLI {
  private rl: readline.Interface | null = null;
  private memory: ConversationMemory;
  private handlers: ToolHandlers;

  constructor() {
    this.memory = new ConversationMemory();
    this.handlers = new ToolHandlers(this.memory, getSQLiteManager());
  }

  /**
   * Setup readline interface and handlers (only for REPL mode)
   */
  private setupREPL() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan("ccm> "),
    });

    this.rl.on("line", async (line: string) => {
      const trimmed = line.trim();

      if (!trimmed) {
        this.rl!.prompt();
        return;
      }

      await this.handleCommand(trimmed);
      this.rl!.prompt();
    });

    this.rl.on("close", () => {
      console.log(chalk.green("\nGoodbye!"));
      process.exit(0);
    });

    // Handle Ctrl+C gracefully
    this.rl.on("SIGINT", () => {
      console.log(chalk.yellow("\nUse 'exit' or Ctrl+D to quit"));
      this.rl!.prompt();
    });
  }

  /**
   * Handle a command
   */
  private async handleCommand(input: string) {
    try {
      const result = await executeCommand(input, this.handlers);

      if (result === "exit") {
        if (this.rl) {
          this.rl.close();
        }
        return;
      }

      if (result === "clear") {
        console.clear();
        showWelcome();
        return;
      }

      if (result !== null) {
        console.log(result);
      }
    } catch (error: unknown) {
      const err = error as Error;
      console.error(chalk.red(`Error: ${err.message}`));
    }
  }

  /**
   * Start the REPL
   */
  async start() {
    this.setupREPL();
    showWelcome();
    this.rl!.prompt();
  }

  /**
   * Execute a single command and exit
   */
  async runSingleCommand(command: string) {
    try {
      const result = await executeCommand(command, this.handlers);
      if (result !== null && result !== "exit" && result !== "clear") {
        console.log(result);
      }
      process.exit(0);
    } catch (error: unknown) {
      const err = error as Error;
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  }
}
