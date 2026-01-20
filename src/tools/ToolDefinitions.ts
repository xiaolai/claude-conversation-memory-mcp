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
          description: "Optional: specific session ID to index. Use the external session id (JSONL filename / Codex rollout id), e.g. 'a1172af3-ca62-41be-9b90-701cef39daae'. Internal DB ids are accepted but prefer list_recent_sessions.session_id.",
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
          description: "Exclude MCP tool conversations from indexing. Options: 'self-only' (exclude only cccmemory MCP to prevent self-referential loops, DEFAULT), false (index all MCP conversations), 'all-mcp' or true (exclude all MCP tool conversations)",
          default: "self-only",
        },
        exclude_mcp_servers: {
          type: "array",
          description: "List of specific MCP server names to exclude (e.g., ['cccmemory', 'filesystem']). More granular than exclude_mcp_conversations.",
          items: { type: "string" },
        },
      },
    },
  },

  search_conversations: {
    name: "search_conversations",
    description: "Search conversation history using natural language queries. Returns relevant messages with context. Supports pagination and scope filtering (current session, all sessions in project, or global across projects).",
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
        offset: {
          type: "number",
          description: "Skip N results for pagination (default: 0). Use with limit to fetch subsequent pages.",
          default: 0,
        },
        date_range: {
          type: "array",
          description: "Optional date range filter [start_timestamp, end_timestamp]",
          items: { type: "number" },
        },
        scope: {
          type: "string",
          enum: ["current", "all", "global"],
          description: "Search scope: 'current' (current session only), 'all' (all sessions in current project), 'global' (all indexed projects including Codex). Default: 'all'",
          default: "all",
        },
        conversation_id: {
          type: "string",
          description: "Required when scope='current': internal conversation id from list_recent_sessions.id",
        },
      },
      required: ["query"],
    },
  },

  search_project_conversations: {
    name: "search_project_conversations",
    description: "Search conversations scoped to a project path, optionally including both Claude Code and Codex sessions that match the same project root.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10)",
          default: 10,
        },
        offset: {
          type: "number",
          description: "Skip N results for pagination (default: 0). Use with limit to fetch subsequent pages.",
          default: 0,
        },
        date_range: {
          type: "array",
          description: "Optional date range filter [start_timestamp, end_timestamp]",
          items: { type: "number" },
        },
        include_claude_code: {
          type: "boolean",
          description: "Include Claude Code conversations (default: true)",
          default: true,
        },
        include_codex: {
          type: "boolean",
          description: "Include Codex conversations (default: true)",
          default: true,
        },
      },
      required: ["query"],
    },
  },

  get_decisions: {
    name: "get_decisions",
    description: "Find decisions made about a specific topic, file, or component. Shows rationale, alternatives considered, and rejected approaches. Supports pagination and scope filtering.",
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
        offset: {
          type: "number",
          description: "Skip N results for pagination (default: 0). Use with limit to fetch subsequent pages.",
          default: 0,
        },
        scope: {
          type: "string",
          enum: ["current", "all", "global"],
          description: "Search scope: 'current' (current session only), 'all' (all sessions in current project), 'global' (all indexed projects including Codex). Default: 'all'",
          default: "all",
        },
        conversation_id: {
          type: "string",
          description: "Required when scope='current': internal conversation id from list_recent_sessions.id",
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
    description: "Show complete timeline of changes to a file across conversations and commits. Supports pagination for files with long history.",
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
        limit: {
          type: "number",
          description: "Maximum number of timeline events to return (default: 50)",
          default: 50,
        },
        offset: {
          type: "number",
          description: "Skip N events for pagination (default: 0). Use with limit to fetch subsequent pages.",
          default: 0,
        },
      },
      required: ["file_path"],
    },
  },

  link_commits_to_conversations: {
    name: "link_commits_to_conversations",
    description: "Link git commits to the conversation sessions where they were made or discussed. Creates associations between code changes and their conversation context, enabling you to see WHY changes were made. Supports pagination and scope filtering.",
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
        offset: {
          type: "number",
          description: "Skip N results for pagination (default: 0). Use with limit to fetch subsequent pages.",
          default: 0,
        },
        scope: {
          type: "string",
          enum: ["current", "all", "global"],
          description: "Search scope: 'current' (current session only), 'all' (all sessions in current project), 'global' (all indexed projects including Codex). Default: 'all'",
          default: "all",
        },
      },
    },
  },

  search_mistakes: {
    name: "search_mistakes",
    description: "Find past mistakes to avoid repeating them. Shows what went wrong and how it was corrected. Supports pagination and scope filtering.",
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
        offset: {
          type: "number",
          description: "Skip N results for pagination (default: 0). Use with limit to fetch subsequent pages.",
          default: 0,
        },
        scope: {
          type: "string",
          enum: ["current", "all", "global"],
          description: "Search scope: 'current' (current session only), 'all' (all sessions in current project), 'global' (all indexed projects including Codex). Default: 'all'",
          default: "all",
        },
        conversation_id: {
          type: "string",
          description: "Required when scope='current': internal conversation id from list_recent_sessions.id",
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
          description: "Include tool result content, stdout, stderr (default: false for security). Set true to include content (tool names, timestamps, success/failure status).",
          default: false,
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
          description: "Optional: filter by internal conversation id (list_recent_sessions.id)",
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
    description: "Find conversations that dealt with similar topics or problems. Supports pagination and scope filtering.",
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
        offset: {
          type: "number",
          description: "Skip N results for pagination (default: 0). Use with limit to fetch subsequent pages.",
          default: 0,
        },
        scope: {
          type: "string",
          enum: ["current", "all", "global"],
          description: "Search scope: 'current' (current session only), 'all' (all sessions in current project), 'global' (all indexed projects including Codex). Default: 'all'",
          default: "all",
        },
        conversation_id: {
          type: "string",
          description: "Required when scope='current': internal conversation id from list_recent_sessions.id",
        },
      },
      required: ["query"],
    },
  },

  recall_and_apply: {
    name: "recall_and_apply",
    description: "Recall relevant past context (conversations, decisions, mistakes, file changes) and format it for applying to current work. Use this when you need to 'remember when we did X' and 'now do Y based on that'. Returns structured context optimized for context transfer workflows. Supports pagination and scope filtering.",
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
        offset: {
          type: "number",
          description: "Skip N results for pagination (default: 0). Use with limit to fetch subsequent pages.",
          default: 0,
        },
        scope: {
          type: "string",
          enum: ["current", "all", "global"],
          description: "Search scope: 'current' (current session only), 'all' (all sessions in current project), 'global' (all indexed projects including Codex). Default: 'all'",
          default: "all",
        },
        conversation_id: {
          type: "string",
          description: "Required when scope='current': internal conversation id from list_recent_sessions.id",
        },
      },
      required: ["query"],
    },
  },

  generate_documentation: {
    name: "generate_documentation",
    description: "Generate comprehensive project documentation by combining local codebase analysis with conversation history. Shows WHAT exists in code and WHY it was built that way.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the project (defaults to current working directory)",
        },
        session_id: {
          type: "string",
          description: "Optional: internal conversation id (list_recent_sessions.id) to include. If not provided, includes all sessions.",
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
          minItems: 1,
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

  // ==================== High-Value Utility Tools ====================

  search_by_file: {
    name: "search_by_file",
    description: "Find all conversation context related to a specific file: discussions, decisions, mistakes, and changes. Essential for understanding file history before modifications.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file (can be relative or absolute)",
        },
        limit: {
          type: "number",
          description: "Maximum results per category (default: 5)",
          default: 5,
        },
      },
      required: ["file_path"],
    },
  },

  list_recent_sessions: {
    name: "list_recent_sessions",
    description: "List recent conversation sessions with summary info (date, message count, topics). Returns both internal id and external session_id. Useful for understanding conversation history at a glance.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum sessions to return (default: 10)",
          default: 10,
        },
        offset: {
          type: "number",
          description: "Skip N sessions for pagination (default: 0)",
          default: 0,
        },
        project_path: {
          type: "string",
          description: "Optional: filter to specific project path",
        },
      },
    },
  },

  get_latest_session_summary: {
    name: "get_latest_session_summary",
    description: "Summarize the latest session for a project: what the agent is trying to solve, recent actions, and current errors.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
        source_type: {
          type: "string",
          enum: ["claude-code", "codex", "all"],
          description: "Filter by source type (default: all)",
          default: "all",
        },
        limit_messages: {
          type: "number",
          description: "How many recent messages to consider (default: 20)",
          default: 20,
        },
        include_tools: {
          type: "boolean",
          description: "Include recent tool actions (default: true)",
          default: true,
        },
        include_errors: {
          type: "boolean",
          description: "Include recent tool errors (default: true)",
          default: true,
        },
      },
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
        incremental: {
          type: "boolean",
          description: "Perform incremental indexing - only index files modified since last indexing (default: true). Set to false for full re-indexing.",
          default: true,
        },
      },
    },
  },

  search_all_conversations: {
    name: "search_all_conversations",
    description: "Search conversations across all indexed projects (Claude Code + Codex). Returns results from all projects with source type and project path for context. Supports full pagination.",
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
        offset: {
          type: "number",
          description: "Skip N results for pagination (default: 0). Use with limit to fetch subsequent pages.",
          default: 0,
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
    description: "Find decisions made across all indexed projects. Shows rationale, alternatives, and rejected approaches from all your work globally. Supports full pagination.",
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
        offset: {
          type: "number",
          description: "Skip N results for pagination (default: 0). Use with limit to fetch subsequent pages.",
          default: 0,
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
    description: "Find past mistakes across all indexed projects to avoid repeating them. Shows what went wrong and how it was corrected across all your work. Supports full pagination.",
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
        offset: {
          type: "number",
          description: "Skip N results for pagination (default: 0). Use with limit to fetch subsequent pages.",
          default: 0,
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

  // ==================== Live Context Layer Tools ====================

  remember: {
    name: "remember",
    description:
      "Store a fact, decision, or piece of context in working memory. Use this to remember important information that should persist across conversation boundaries. Items are stored per-project and can be recalled by key or searched semantically.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "A unique key to identify this memory (e.g., 'storage_decision', 'auth_approach', 'current_task')",
        },
        value: {
          type: "string",
          description:
            "The value to remember (e.g., 'Using SQLite for simplicity and portability')",
        },
        context: {
          type: "string",
          description:
            "Optional additional context or rationale for this memory",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional tags for categorization (e.g., ['architecture', 'decision'])",
        },
        ttl: {
          type: "number",
          description:
            "Optional time-to-live in seconds. Memory will auto-expire after this time.",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
      required: ["key", "value"],
    },
  },

  recall: {
    name: "recall",
    description:
      "Retrieve a specific memory item by its key. Use this when you need to recall a specific fact or decision that was previously stored.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The key of the memory to recall",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
      required: ["key"],
    },
  },

  recall_relevant: {
    name: "recall_relevant",
    description:
      "Search working memory semantically to find relevant memories based on a query. Use this when you need to find memories related to a topic but don't know the exact key.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural language query to search for (e.g., 'database decisions', 'authentication setup')",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10)",
          default: 10,
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
      required: ["query"],
    },
  },

  list_memory: {
    name: "list_memory",
    description:
      "List all items in working memory for the current project. Optionally filter by tags.",
    inputSchema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional: filter by tags (returns items matching any tag)",
        },
        limit: {
          type: "number",
          description: "Maximum number of items to return (default: 100)",
          default: 100,
        },
        offset: {
          type: "number",
          description: "Skip N items for pagination (default: 0)",
          default: 0,
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
    },
  },

  forget: {
    name: "forget",
    description:
      "Remove a memory item by its key. Use this to clean up memories that are no longer relevant.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The key of the memory to forget",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
      required: ["key"],
    },
  },

  // ==================== Session Handoff Tools ====================

  prepare_handoff: {
    name: "prepare_handoff",
    description:
      "Prepare a handoff document for transitioning to a new conversation. Extracts key decisions, active files, pending tasks, and working memory to enable seamless continuation in a new session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description:
            "Internal conversation id (list_recent_sessions.id) to prepare handoff for (defaults to most recent session)",
        },
        include: {
          type: "array",
          items: {
            type: "string",
            enum: ["decisions", "files", "tasks", "memory"],
          },
          description:
            "What to include in handoff (default: all). Options: decisions, files, tasks, memory",
        },
        context_summary: {
          type: "string",
          description:
            "Optional summary of current context/task to include in handoff",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
    },
  },

  resume_from_handoff: {
    name: "resume_from_handoff",
    description:
      "Resume work from a previous handoff document. Loads the context from the handoff and provides a summary of what was being worked on.",
    inputSchema: {
      type: "object",
      properties: {
        handoff_id: {
          type: "string",
          description:
            "ID of the handoff to resume from (defaults to most recent)",
        },
        inject_context: {
          type: "boolean",
          description:
            "Whether to inject the handoff context into the response (default: true)",
          default: true,
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
    },
  },

  list_handoffs: {
    name: "list_handoffs",
    description:
      "List available handoff documents for the current project. Shows when each was created and whether it has been resumed.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of handoffs to return (default: 10)",
          default: 10,
        },
        include_resumed: {
          type: "boolean",
          description: "Include handoffs that have already been resumed (default: true)",
          default: true,
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
    },
  },

  // ==================== Context Injection Tools ====================

  get_startup_context: {
    name: "get_startup_context",
    description:
      "Get relevant context to inject at the start of a new conversation. Combines recent handoffs, decisions, working memory, and file history based on the query or task description.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Description of what you're about to work on (e.g., 'authentication system', 'database optimization')",
        },
        max_tokens: {
          type: "number",
          description:
            "Maximum tokens for context response (default: 2000). Helps stay within context limits.",
          default: 2000,
        },
        sources: {
          type: "array",
          items: {
            type: "string",
            enum: ["history", "decisions", "memory", "handoffs"],
          },
          description:
            "Which sources to include (default: all). Options: history, decisions, memory, handoffs",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
    },
  },

  inject_relevant_context: {
    name: "inject_relevant_context",
    description:
      "Analyze a message and automatically inject relevant historical context. Use at the start of a conversation to bring in context from past sessions.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description:
            "The user's first message or task description to analyze for context injection",
        },
        max_tokens: {
          type: "number",
          description: "Maximum tokens for injected context (default: 1500)",
          default: 1500,
        },
        sources: {
          type: "array",
          items: {
            type: "string",
            enum: ["history", "decisions", "memory", "handoffs"],
          },
          description: "Which sources to search (default: all)",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
      required: ["message"],
    },
  },
};
