/**
 * MCP Tool Definitions
 */

export const TOOLS = {
  index_conversations: {
    name: "index_conversations",
    description: "Index conversation history for the current project. This parses conversation files, extracts decisions, mistakes, and links to git commits. Can index all sessions or a specific session.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the project (defaults to current working directory)",
        },
        session_id: {
          type: "string",
          description: "Optional: specific session ID to index (e.g., 'a1172af3-ca62-41be-9b90-701cef39daae'). If not provided, indexes all sessions in the project.",
        },
        include_thinking: {
          type: "boolean",
          description: "Include thinking blocks in indexing (default: false, can be large)",
          default: false,
        },
        enable_git: {
          type: "boolean",
          description: "Enable git integration to link commits to conversations (default: true)",
          default: true,
        },
        exclude_mcp_conversations: {
          type: ["boolean", "string"],
          description: "Exclude MCP tool conversations from indexing. Options: 'self-only' (exclude only conversation-memory MCP to prevent self-referential loops, DEFAULT), false (index all MCP conversations), 'all-mcp' or true (exclude all MCP tool conversations)",
          default: "self-only",
        },
        exclude_mcp_servers: {
          type: "array",
          description: "List of specific MCP server names to exclude (e.g., ['conversation-memory', 'code-graph-rag']). More granular than exclude_mcp_conversations.",
          items: { type: "string" },
        },
      },
    },
  },

  search_conversations: {
    name: "search_conversations",
    description: "Search conversation history using natural language queries. Returns relevant messages with context.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10)",
          default: 10,
        },
        date_range: {
          type: "array",
          description: "Optional date range filter [start_timestamp, end_timestamp]",
          items: { type: "number" },
        },
      },
      required: ["query"],
    },
  },

  get_decisions: {
    name: "get_decisions",
    description: "Find decisions made about a specific topic, file, or component. Shows rationale, alternatives considered, and rejected approaches.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Topic or keyword to search for (e.g., 'authentication', 'database')",
        },
        file_path: {
          type: "string",
          description: "Optional: filter decisions related to a specific file",
        },
        limit: {
          type: "number",
          description: "Maximum number of decisions to return (default: 10)",
          default: 10,
        },
      },
      required: ["query"],
    },
  },

  check_before_modify: {
    name: "check_before_modify",
    description: "Check important context before modifying a file. Shows recent changes, related decisions, commits, and past mistakes to avoid.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file you want to modify",
        },
      },
      required: ["file_path"],
    },
  },

  get_file_evolution: {
    name: "get_file_evolution",
    description: "Show complete timeline of changes to a file across conversations and commits.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file",
        },
        include_decisions: {
          type: "boolean",
          description: "Include related decisions (default: true)",
          default: true,
        },
        include_commits: {
          type: "boolean",
          description: "Include git commits (default: true)",
          default: true,
        },
      },
      required: ["file_path"],
    },
  },

  link_commits_to_conversations: {
    name: "link_commits_to_conversations",
    description: "Link git commits to the conversation sessions where they were made or discussed. Creates associations between code changes and their conversation context, enabling you to see WHY changes were made.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for commits",
        },
        conversation_id: {
          type: "string",
          description: "Optional: filter by specific conversation ID",
        },
        limit: {
          type: "number",
          description: "Maximum number of commits (default: 20)",
          default: 20,
        },
      },
    },
  },

  search_mistakes: {
    name: "search_mistakes",
    description: "Find past mistakes to avoid repeating them. Shows what went wrong and how it was corrected.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for mistakes",
        },
        mistake_type: {
          type: "string",
          description: "Optional: filter by type (logic_error, wrong_approach, misunderstanding, tool_error, syntax_error)",
          enum: ["logic_error", "wrong_approach", "misunderstanding", "tool_error", "syntax_error"],
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10)",
          default: 10,
        },
      },
      required: ["query"],
    },
  },

  get_requirements: {
    name: "get_requirements",
    description: "Look up requirements and constraints for a component or feature.",
    inputSchema: {
      type: "object",
      properties: {
        component: {
          type: "string",
          description: "Component or feature name",
        },
        type: {
          type: "string",
          description: "Optional: filter by requirement type",
          enum: ["dependency", "performance", "compatibility", "business"],
        },
      },
      required: ["component"],
    },
  },

  get_tool_history: {
    name: "get_tool_history",
    description: "Query history of tool uses (bash commands, file edits, reads, etc.) with pagination, filtering, and content control. Returns metadata about tool uses with optional content truncation to stay within token limits. Use include_content=false for quick overview of many tools, or enable with max_content_length to control response size.",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: {
          type: "string",
          description: "Optional: filter by tool name (Bash, Edit, Write, Read)",
        },
        file_path: {
          type: "string",
          description: "Optional: filter by file path (searches in tool parameters)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results per page (default: 20)",
          default: 20,
        },
        offset: {
          type: "number",
          description: "Skip N results for pagination (default: 0). Use with limit to fetch subsequent pages.",
          default: 0,
        },
        include_content: {
          type: "boolean",
          description: "Include tool result content, stdout, stderr (default: true). Set false for metadata-only response (tool names, timestamps, success/failure status).",
          default: true,
        },
        max_content_length: {
          type: "number",
          description: "Maximum characters per content field before truncation (default: 500). Truncated fields are marked with content_truncated flag.",
          default: 500,
        },
        date_range: {
          type: "array",
          description: "Optional: filter by timestamp range [start_timestamp, end_timestamp]. Use Date.now() for current time.",
          items: {
            type: "number",
          },
          minItems: 2,
          maxItems: 2,
        },
        conversation_id: {
          type: "string",
          description: "Optional: filter by specific conversation session ID",
        },
        errors_only: {
          type: "boolean",
          description: "Optional: show only tool uses that resulted in errors (default: false)",
          default: false,
        },
      },
    },
  },

  find_similar_sessions: {
    name: "find_similar_sessions",
    description: "Find conversations that dealt with similar topics or problems.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Description of the topic or problem",
        },
        limit: {
          type: "number",
          description: "Maximum number of sessions (default: 5)",
          default: 5,
        },
      },
      required: ["query"],
    },
  },

  recall_and_apply: {
    name: "recall_and_apply",
    description: "Recall relevant past context (conversations, decisions, mistakes, file changes) and format it for applying to current work. Use this when you need to 'remember when we did X' and 'now do Y based on that'. Returns structured context optimized for context transfer workflows.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to recall (e.g., 'how we implemented authentication', 'the bug we fixed in parser', 'decisions about database schema')",
        },
        context_types: {
          type: "array",
          description: "Types of context to include: 'conversations', 'decisions', 'mistakes', 'file_changes', 'commits'. Default: all types",
          items: {
            type: "string",
            enum: ["conversations", "decisions", "mistakes", "file_changes", "commits"]
          },
          default: ["conversations", "decisions", "mistakes", "file_changes", "commits"],
        },
        file_path: {
          type: "string",
          description: "Optional: focus on a specific file",
        },
        date_range: {
          type: "array",
          description: "Optional: limit to time range [start_timestamp, end_timestamp]",
          items: { type: "number" },
        },
        limit: {
          type: "number",
          description: "Maximum results per context type (default: 5)",
          default: 5,
        },
      },
      required: ["query"],
    },
  },

  generate_documentation: {
    name: "generate_documentation",
    description: "Generate comprehensive project documentation by combining codebase analysis (CODE-GRAPH-RAG-MCP) with conversation history. Shows WHAT exists in code and WHY it was built that way.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the project (defaults to current working directory)",
        },
        session_id: {
          type: "string",
          description: "Optional: specific session ID to include. If not provided, includes all sessions.",
        },
        scope: {
          type: "string",
          enum: ["full", "architecture", "decisions", "quality"],
          description: "Documentation scope: full (everything), architecture (modules), decisions (decision log), quality (code quality insights)",
          default: "full",
        },
        module_filter: {
          type: "string",
          description: "Optional: filter to specific module path (e.g., 'src/auth')",
        },
      },
    },
  },

  discover_old_conversations: {
    name: "discover_old_conversations",
    description: "Discover old conversation folders when project directories are renamed or moved. Scans ~/.claude/projects to find folders that match the current project based on database contents and folder similarity.",
    inputSchema: {
      type: "object",
      properties: {
        current_project_path: {
          type: "string",
          description: "Current project path (defaults to current working directory). Used to find matching old folders.",
        },
      },
    },
  },

  migrate_project: {
    name: "migrate_project",
    description: "Migrate or merge conversation history from different project folders. Use 'migrate' mode (default) to replace target folder when renaming projects. Use 'merge' mode to combine conversations from different projects into one folder. Creates backups automatically.",
    inputSchema: {
      type: "object",
      properties: {
        source_folder: {
          type: "string",
          description: "Path to the source conversation folder (e.g., /Users/name/.claude/projects/-old-project)",
        },
        old_project_path: {
          type: "string",
          description: "Old project path stored in database (e.g., /Users/name/old-project)",
        },
        new_project_path: {
          type: "string",
          description: "New project path to update to (e.g., /Users/name/new-project)",
        },
        dry_run: {
          type: "boolean",
          description: "If true, shows what would be migrated without making changes (default: false)",
          default: false,
        },
        mode: {
          type: "string",
          enum: ["migrate", "merge"],
          description: "Operation mode: 'migrate' (default) replaces target folder, 'merge' combines conversations from source into existing target. In merge mode, duplicate conversation IDs are skipped (target kept). Use 'merge' to combine history from different projects.",
          default: "migrate",
        },
      },
      required: ["source_folder", "old_project_path", "new_project_path"],
    },
  },

  forget_by_topic: {
    name: "forget_by_topic",
    description: "Forget conversations about specific topics or keywords. Searches for matching conversations and optionally deletes them with automatic backup. Use confirm=false to preview what would be deleted, then set confirm=true to actually delete.",
    inputSchema: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          description: "Topics or keywords to search for (e.g., ['authentication', 'redesign'])",
          items: { type: "string" },
        },
        project_path: {
          type: "string",
          description: "Path to the project (defaults to current working directory)",
        },
        confirm: {
          type: "boolean",
          description: "Set to true to actually delete conversations. If false (default), only shows preview of what would be deleted",
          default: false,
        },
      },
      required: ["keywords"],
    },
  },

  // ==================== Global Cross-Project Tools ====================

  index_all_projects: {
    name: "index_all_projects",
    description: "Index all projects from both Claude Code and Codex. Discovers and indexes conversations from all sources, registering them in a global index for cross-project search. This enables searching across all your work globally.",
    inputSchema: {
      type: "object",
      properties: {
        include_codex: {
          type: "boolean",
          description: "Include Codex conversations (default: true)",
          default: true,
        },
        include_claude_code: {
          type: "boolean",
          description: "Include Claude Code conversations (default: true)",
          default: true,
        },
        codex_path: {
          type: "string",
          description: "Path to Codex home directory (default: ~/.codex)",
        },
        claude_projects_path: {
          type: "string",
          description: "Path to Claude Code projects directory (default: ~/.claude/projects)",
        },
      },
    },
  },

  search_all_conversations: {
    name: "search_all_conversations",
    description: "Search conversations across all indexed projects (Claude Code + Codex). Returns results from all projects with source type and project path for context.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
          default: 20,
        },
        date_range: {
          type: "array",
          description: "Optional date range filter [start_timestamp, end_timestamp]",
          items: { type: "number" },
        },
        source_type: {
          type: "string",
          description: "Filter by source: 'claude-code', 'codex', or 'all' (default: 'all')",
          enum: ["claude-code", "codex", "all"],
          default: "all",
        },
      },
      required: ["query"],
    },
  },

  get_all_decisions: {
    name: "get_all_decisions",
    description: "Find decisions made across all indexed projects. Shows rationale, alternatives, and rejected approaches from all your work globally.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Topic or keyword to search for (e.g., 'authentication', 'database')",
        },
        file_path: {
          type: "string",
          description: "Optional: filter decisions related to a specific file",
        },
        limit: {
          type: "number",
          description: "Maximum number of decisions to return (default: 20)",
          default: 20,
        },
        source_type: {
          type: "string",
          description: "Filter by source: 'claude-code', 'codex', or 'all' (default: 'all')",
          enum: ["claude-code", "codex", "all"],
          default: "all",
        },
      },
      required: ["query"],
    },
  },

  search_all_mistakes: {
    name: "search_all_mistakes",
    description: "Find past mistakes across all indexed projects to avoid repeating them. Shows what went wrong and how it was corrected across all your work.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for mistakes",
        },
        mistake_type: {
          type: "string",
          description: "Optional: filter by type (logic_error, wrong_approach, misunderstanding, tool_error, syntax_error)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
          default: 20,
        },
        source_type: {
          type: "string",
          description: "Filter by source: 'claude-code', 'codex', or 'all' (default: 'all')",
          enum: ["claude-code", "codex", "all"],
          default: "all",
        },
      },
      required: ["query"],
    },
  },
};
