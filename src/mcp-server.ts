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

import { ConversationMemory } from "./ConversationMemory.js";
import { ToolHandlers } from "./tools/ToolHandlers.js";
import { TOOLS } from "./tools/ToolDefinitions.js";
import { getSQLiteManager } from "./storage/SQLiteManager.js";

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
        version: "0.1.0",
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
   * Setup MCP request handlers
   */
  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Object.values(TOOLS),
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        console.error(`[MCP] Executing tool: ${name}`);

        let result: unknown;

        switch (name) {
          case "index_conversations":
            result = await this.handlers.indexConversations(args as Record<string, unknown>);
            break;

          case "search_conversations":
            result = await this.handlers.searchConversations(args as Record<string, unknown>);
            break;

          case "get_decisions":
            result = await this.handlers.getDecisions(args as Record<string, unknown>);
            break;

          case "check_before_modify":
            result = await this.handlers.checkBeforeModify(args as Record<string, unknown>);
            break;

          case "get_file_evolution":
            result = await this.handlers.getFileEvolution(args as Record<string, unknown>);
            break;

          case "link_commits_to_conversations":
            result = await this.handlers.linkCommitsToConversations(args as Record<string, unknown>);
            break;

          case "search_mistakes":
            result = await this.handlers.searchMistakes(args as Record<string, unknown>);
            break;

          case "get_requirements":
            result = await this.handlers.getRequirements(args as Record<string, unknown>);
            break;

          case "get_tool_history":
            result = await this.handlers.getToolHistory(args as Record<string, unknown>);
            break;

          case "find_similar_sessions":
            result = await this.handlers.findSimilarSessions(args as Record<string, unknown>);
            break;

          case "generate_documentation":
            result = await this.handlers.generateDocumentation(args as Record<string, unknown>);
            break;

          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        const err = error as Error;
        console.error(`[MCP] Error executing tool ${name}:`, err);

        return {
          content: [
            {
              type: "text",
              text: `Error: ${err.message}\n\nStack: ${err.stack}`,
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
