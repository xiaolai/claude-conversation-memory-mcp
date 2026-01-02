/**
 * Claude Conversation Memory - MCP Server
 * MCP server implementation with stdio transport
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { ConversationMemory } from "./ConversationMemory.js";
import { ToolHandlers } from "./tools/ToolHandlers.js";
import { TOOLS } from "./tools/ToolDefinitions.js";
import { getSQLiteManager } from "./storage/SQLiteManager.js";

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, "..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
const VERSION = packageJson.version;

/**
 * Main MCP Server
 */
export class ConversationMemoryServer {
  private server: Server;
  private memory: ConversationMemory;
  private handlers: ToolHandlers;

  constructor() {
    this.server = new Server(
      {
        name: "claude-conversation-memory",
        version: VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.memory = new ConversationMemory();
    this.handlers = new ToolHandlers(this.memory, getSQLiteManager());

    this.setupHandlers();
  }

  /**
   * Get tool handler map for dynamic dispatch
   * Using a map prevents switch/case drift and makes it easy to add new tools
   */
  private getToolHandlerMap(): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
    return {
      index_conversations: (args) => this.handlers.indexConversations(args),
      search_conversations: (args) => this.handlers.searchConversations(args),
      get_decisions: (args) => this.handlers.getDecisions(args),
      check_before_modify: (args) => this.handlers.checkBeforeModify(args),
      get_file_evolution: (args) => this.handlers.getFileEvolution(args),
      link_commits_to_conversations: (args) => this.handlers.linkCommitsToConversations(args),
      search_mistakes: (args) => this.handlers.searchMistakes(args),
      get_requirements: (args) => this.handlers.getRequirements(args),
      get_tool_history: (args) => this.handlers.getToolHistory(args),
      find_similar_sessions: (args) => this.handlers.findSimilarSessions(args),
      recall_and_apply: (args) => this.handlers.recallAndApply(args),
      generate_documentation: (args) => this.handlers.generateDocumentation(args),
      discover_old_conversations: (args) => this.handlers.discoverOldConversations(args),
      migrate_project: (args) => this.handlers.migrateProject(args),
      forget_by_topic: (args) => this.handlers.forgetByTopic(args),
      search_by_file: (args) => this.handlers.searchByFile(args),
      list_recent_sessions: (args) => this.handlers.listRecentSessions(args),
      index_all_projects: (args) => this.handlers.indexAllProjects(args),
      search_all_conversations: (args) => this.handlers.searchAllConversations(args),
      get_all_decisions: (args) => this.handlers.getAllDecisions(args),
      search_all_mistakes: (args) => this.handlers.searchAllMistakes(args),
      // Live Context Layer: Working Memory
      remember: (args) => this.handlers.remember(args),
      recall: (args) => this.handlers.recall(args),
      recall_relevant: (args) => this.handlers.recallRelevant(args),
      list_memory: (args) => this.handlers.listMemory(args),
      forget: (args) => this.handlers.forget(args),
      // Live Context Layer: Session Handoff
      prepare_handoff: (args) => this.handlers.prepareHandoff(args),
      resume_from_handoff: (args) => this.handlers.resumeFromHandoff(args),
      list_handoffs: (args) => this.handlers.listHandoffs(args),
      // Live Context Layer: Context Injection
      get_startup_context: (args) => this.handlers.getStartupContext(args),
      inject_relevant_context: (args) => this.handlers.injectRelevantContext(args),
    };
  }

  /**
   * Setup MCP request handlers
   */
  private setupHandlers() {
    const toolHandlers = this.getToolHandlerMap();

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Object.values(TOOLS),
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      // Ensure args is always an object, defaulting to empty
      const argsObj = (args ?? {}) as Record<string, unknown>;

      try {
        console.error(`[MCP] Executing tool: ${name}`);

        // Guard against prototype pollution: only allow own properties
        if (!Object.hasOwn(toolHandlers, name)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: `Unknown tool: ${name}` }),
              },
            ],
            isError: true,
          };
        }

        const handler = toolHandlers[name];
        const result = await handler(argsObj);

        // Use compact JSON for responses (no pretty-printing)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error: unknown) {
        // Safely handle non-Error throws
        const err = error instanceof Error ? error : new Error(String(error));
        // Log full error details server-side only
        console.error(`[MCP] Error executing tool ${name}:`, err.message);
        if (err.stack) {
          console.error(`[MCP] Stack trace:`, err.stack);
        }

        // SECURITY: Return only error message to client, not stack traces
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: err.message }),
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Start the server
   */
  async start() {
    const transport = new StdioServerTransport();

    console.error("[MCP] Claude Conversation Memory Server starting...");
    console.error(`[MCP] Database: ${getSQLiteManager().getStats().dbPath}`);

    await this.server.connect(transport);

    console.error("[MCP] Server ready - listening on stdio");
  }
}
