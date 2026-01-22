/**
 * CCCMemory - MCP Server
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

// Read version from package.json with fallback
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, "..", "package.json");

let VERSION = "0.0.0";
try {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version?: string };
  VERSION = packageJson.version ?? "0.0.0";
} catch (err) {
  console.error(`[MCP] Warning: Could not read package.json version: ${(err as Error).message}`);
}

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
        name: "cccmemory",
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
      search_project_conversations: (args) => this.handlers.searchProjectConversations(args),
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
      get_latest_session_summary: (args) => this.handlers.getLatestSessionSummary(args),
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
      // Phase 1: Tag Management
      list_tags: (args) => this.handlers.listTags(args),
      search_by_tags: (args) => this.handlers.searchByTags(args),
      rename_tag: (args) => this.handlers.renameTag(args),
      merge_tags: (args) => this.handlers.mergeTags(args),
      delete_tag: (args) => this.handlers.deleteTag(args),
      tag_item: (args) => this.handlers.tagItem(args),
      untag_item: (args) => this.handlers.untagItem(args),
      // Phase 1: Memory Confidence
      set_memory_confidence: (args) => this.handlers.setMemoryConfidence(args),
      set_memory_importance: (args) => this.handlers.setMemoryImportance(args),
      pin_memory: (args) => this.handlers.pinMemory(args),
      archive_memory: (args) => this.handlers.archiveMemory(args),
      unarchive_memory: (args) => this.handlers.unarchiveMemory(args),
      search_memory_by_quality: (args) => this.handlers.searchMemoryByQuality(args),
      get_memory_stats: (args) => this.handlers.getMemoryStats(args),
      // Phase 1: Cleanup/Maintenance
      get_storage_stats: (args) => this.handlers.getStorageStats(args),
      find_stale_items: (args) => this.handlers.findStaleItems(args),
      find_duplicates: (args) => this.handlers.findDuplicates(args),
      merge_duplicates: (args) => this.handlers.mergeDuplicates(args),
      cleanup_stale: (args) => this.handlers.cleanupStale(args),
      vacuum_database: (args) => this.handlers.vacuumDatabase(args),
      cleanup_orphans: (args) => this.handlers.cleanupOrphans(args),
      get_health_report: (args) => this.handlers.getHealthReport(args),
      run_maintenance: (args) => this.handlers.runMaintenance(args),
      get_maintenance_history: (args) => this.handlers.getMaintenanceHistory(args),
    };
  }

  /**
   * Validate that tool definitions match handler implementations
   * Fails fast at startup if there's a drift between TOOLS and handlers
   */
  private validateToolHandlers(toolHandlers: Record<string, unknown>): void {
    const definedTools = new Set(Object.keys(TOOLS));
    const implementedTools = new Set(Object.keys(toolHandlers));

    // Find tools defined but not implemented
    const missingHandlers = [...definedTools].filter(t => !implementedTools.has(t));
    if (missingHandlers.length > 0) {
      throw new Error(
        `Tool definition/handler drift: Tools defined but not implemented: ${missingHandlers.join(', ')}`
      );
    }

    // Find handlers without tool definitions
    const extraHandlers = [...implementedTools].filter(t => !definedTools.has(t));
    if (extraHandlers.length > 0) {
      throw new Error(
        `Tool definition/handler drift: Handlers without tool definitions: ${extraHandlers.join(', ')}`
      );
    }
  }

  /**
   * Setup MCP request handlers
   */
  private setupHandlers() {
    const toolHandlers = this.getToolHandlerMap();

    // Validate tool definitions match handlers at startup
    this.validateToolHandlers(toolHandlers);

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Object.values(TOOLS),
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      // Track tool name for error reporting (may be undefined if params is malformed)
      let toolName: string | undefined;

      try {
        // Validate and extract params inside try block to catch malformed requests
        const params = request.params;
        if (!params || typeof params.name !== "string") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Invalid request: missing or invalid tool name" }),
              },
            ],
            isError: true,
          };
        }

        toolName = params.name;
        // Ensure args is always an object, defaulting to empty
        const argsObj = (params.arguments ?? {}) as Record<string, unknown>;

        console.error(`[MCP] Executing tool: ${toolName}`);

        // Guard against prototype pollution: only allow own properties
        if (!Object.hasOwn(toolHandlers, toolName)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
              },
            ],
            isError: true,
          };
        }

        const handler = toolHandlers[toolName];
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
        console.error(`[MCP] Error executing tool ${toolName ?? "unknown"}:`, err.message);
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

    console.error("[MCP] CCCMemory Server starting...");
    console.error(`[MCP] Database: ${getSQLiteManager().getStats().dbPath}`);

    await this.server.connect(transport);

    console.error("[MCP] Server ready - listening on stdio");
  }
}
