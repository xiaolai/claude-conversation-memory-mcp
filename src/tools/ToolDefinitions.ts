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
      if: {
        properties: { scope: { const: "current" } },
      },
      then: {
        required: ["conversation_id"],
      },
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
      if: {
        properties: { scope: { const: "current" } },
      },
      then: {
        required: ["conversation_id"],
      },
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
      if: {
        properties: { scope: { const: "current" } },
      },
      then: {
        required: ["conversation_id"],
      },
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
      if: {
        properties: { scope: { const: "current" } },
      },
      then: {
        required: ["conversation_id"],
      },
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
      if: {
        properties: { scope: { const: "current" } },
      },
      then: {
        required: ["conversation_id"],
      },
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
      "Store a fact, decision, or piece of context in working memory. Use this to remember important information that should persist across conversation boundaries. Items are stored per-project and can be recalled by key or searched semantically. Supports confidence levels, importance ratings, and source attribution.",
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
        confidence: {
          type: "string",
          enum: ["uncertain", "likely", "confirmed", "verified"],
          description:
            "Confidence level: uncertain (hypothesis), likely (probably correct, default), confirmed (tested), verified (proven in production)",
          default: "likely",
        },
        importance: {
          type: "string",
          enum: ["low", "normal", "high", "critical"],
          description:
            "Importance level: low (nice to know), normal (default), high (important), critical (must not forget)",
          default: "normal",
        },
        source: {
          type: "string",
          description:
            "Where this information came from (e.g., 'user stated', 'extracted from docs', 'confirmed in testing')",
        },
        pinned: {
          type: "boolean",
          description: "Pin this memory to prevent accidental deletion (default: false)",
          default: false,
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

  // ==================== Phase 1: Tag Management Tools ====================

  list_tags: {
    name: "list_tags",
    description:
      "List all tags with usage statistics. Shows how many items use each tag and what types of items they're applied to.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Filter to specific project (defaults to current)",
        },
        scope: {
          type: "string",
          enum: ["project", "global", "all"],
          description: "Tag scope filter: project (current project only), global (project-independent tags), all (both)",
          default: "all",
        },
        sort_by: {
          type: "string",
          enum: ["name", "usage_count", "last_used", "created"],
          description: "Sort order for tags",
          default: "usage_count",
        },
        include_unused: {
          type: "boolean",
          description: "Include tags with zero usage (default: false)",
          default: false,
        },
        limit: {
          type: "number",
          description: "Maximum number of tags to return (default: 50)",
          default: 50,
        },
        offset: {
          type: "number",
          description: "Skip N tags for pagination (default: 0)",
          default: 0,
        },
      },
    },
  },

  search_by_tags: {
    name: "search_by_tags",
    description:
      "Find items across all entity types (memories, decisions, patterns, sessions, mistakes) by tag. Supports AND/OR matching modes.",
    inputSchema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Tags to search for",
        },
        match_mode: {
          type: "string",
          enum: ["all", "any"],
          description: "Match mode: 'all' (AND - item must have all tags), 'any' (OR - item has at least one tag)",
          default: "any",
        },
        item_types: {
          type: "array",
          items: {
            type: "string",
            enum: ["memory", "decision", "pattern", "session", "mistake"],
          },
          description: "Filter to specific item types (default: all types)",
        },
        scope: {
          type: "string",
          enum: ["project", "global", "all"],
          description: "Search scope",
          default: "all",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
          default: 20,
        },
        offset: {
          type: "number",
          description: "Skip N results for pagination (default: 0)",
          default: 0,
        },
      },
      required: ["tags"],
    },
  },

  rename_tag: {
    name: "rename_tag",
    description:
      "Rename a tag across all usages. If the new name already exists, items will be merged into the existing tag.",
    inputSchema: {
      type: "object",
      properties: {
        old_name: {
          type: "string",
          description: "Current tag name",
        },
        new_name: {
          type: "string",
          description: "New tag name",
        },
        scope: {
          type: "string",
          enum: ["project", "global"],
          description: "Tag scope to rename within",
          default: "project",
        },
        project_path: {
          type: "string",
          description: "Project path (required for project scope)",
        },
      },
      required: ["old_name", "new_name"],
    },
  },

  merge_tags: {
    name: "merge_tags",
    description:
      "Combine multiple tags into one. Source tags will be deleted and all their items will be retagged with the target tag.",
    inputSchema: {
      type: "object",
      properties: {
        source_tags: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Tags to merge from (will be deleted)",
        },
        target_tag: {
          type: "string",
          description: "Tag to merge into (will be kept or created)",
        },
        scope: {
          type: "string",
          enum: ["project", "global"],
          description: "Tag scope",
          default: "project",
        },
        project_path: {
          type: "string",
          description: "Project path (required for project scope)",
        },
      },
      required: ["source_tags", "target_tag"],
    },
  },

  delete_tag: {
    name: "delete_tag",
    description:
      "Remove a tag entirely. By default, refuses to delete tags with usages unless force=true.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Tag name to delete",
        },
        scope: {
          type: "string",
          enum: ["project", "global"],
          description: "Tag scope",
          default: "project",
        },
        project_path: {
          type: "string",
          description: "Project path (required for project scope)",
        },
        force: {
          type: "boolean",
          description: "Delete even if tag has usages (default: false)",
          default: false,
        },
      },
      required: ["name"],
    },
  },

  tag_item: {
    name: "tag_item",
    description:
      "Add tags to any item type (memory, decision, pattern, session, mistake). Creates tags if they don't exist.",
    inputSchema: {
      type: "object",
      properties: {
        item_type: {
          type: "string",
          enum: ["memory", "decision", "pattern", "session", "mistake"],
          description: "Type of item to tag",
        },
        item_id: {
          type: ["number", "string"],
          description: "Item ID (number) or key (string for memory)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Tags to add",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
      required: ["item_type", "item_id", "tags"],
    },
  },

  untag_item: {
    name: "untag_item",
    description:
      "Remove tags from an item. If no tags specified, removes all tags from the item.",
    inputSchema: {
      type: "object",
      properties: {
        item_type: {
          type: "string",
          enum: ["memory", "decision", "pattern", "session", "mistake"],
          description: "Type of item to untag",
        },
        item_id: {
          type: ["number", "string"],
          description: "Item ID (number) or key (string for memory)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags to remove (omit to remove all tags)",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
      required: ["item_type", "item_id"],
    },
  },

  // ==================== Phase 1: Memory Confidence Tools ====================

  set_memory_confidence: {
    name: "set_memory_confidence",
    description:
      "Update the confidence level of a memory. Use this when you've validated or invalidated information.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Memory key to update",
        },
        confidence: {
          type: "string",
          enum: ["uncertain", "likely", "confirmed", "verified"],
          description: "New confidence level",
        },
        evidence: {
          type: "string",
          description: "Why this confidence level (e.g., 'tested in production', 'user confirmed')",
        },
        verified_by: {
          type: "string",
          description: "Who/what verified (for confirmed/verified levels)",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
      required: ["key", "confidence"],
    },
  },

  set_memory_importance: {
    name: "set_memory_importance",
    description:
      "Update the importance level of a memory. Critical memories are exempt from auto-cleanup.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Memory key to update",
        },
        importance: {
          type: "string",
          enum: ["low", "normal", "high", "critical"],
          description: "New importance level",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
      required: ["key", "importance"],
    },
  },

  pin_memory: {
    name: "pin_memory",
    description:
      "Pin or unpin a memory. Pinned memories are protected from accidental deletion.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Memory key to pin/unpin",
        },
        pinned: {
          type: "boolean",
          description: "Whether to pin (true) or unpin (false)",
          default: true,
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
      required: ["key"],
    },
  },

  archive_memory: {
    name: "archive_memory",
    description:
      "Archive a memory. Archived memories are hidden from normal searches but can be restored.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Memory key to archive",
        },
        reason: {
          type: "string",
          description: "Why archiving this memory (e.g., 'outdated', 'no longer relevant')",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
      required: ["key"],
    },
  },

  unarchive_memory: {
    name: "unarchive_memory",
    description: "Restore an archived memory back to active status.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Memory key to unarchive",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
      required: ["key"],
    },
  },

  search_memory_by_quality: {
    name: "search_memory_by_quality",
    description:
      "Find memories filtered by confidence level, importance, pinned status, and archive status. Useful for finding high-confidence facts or reviewing low-confidence items.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional text search within filtered memories",
        },
        confidence: {
          type: "array",
          items: {
            type: "string",
            enum: ["uncertain", "likely", "confirmed", "verified"],
          },
          description: "Filter by confidence levels (returns memories matching any level)",
        },
        importance: {
          type: "array",
          items: {
            type: "string",
            enum: ["low", "normal", "high", "critical"],
          },
          description: "Filter by importance levels (returns memories matching any level)",
        },
        pinned_only: {
          type: "boolean",
          description: "Only return pinned memories (default: false)",
          default: false,
        },
        include_archived: {
          type: "boolean",
          description: "Include archived memories (default: false)",
          default: false,
        },
        scope: {
          type: "string",
          enum: ["project", "global"],
          description: "Search scope",
          default: "project",
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
        sort_by: {
          type: "string",
          enum: ["relevance", "importance", "confidence", "recent"],
          description: "Sort order",
          default: "importance",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
          default: 20,
        },
        offset: {
          type: "number",
          description: "Skip N results for pagination (default: 0)",
          default: 0,
        },
      },
    },
  },

  get_memory_stats: {
    name: "get_memory_stats",
    description:
      "Get statistics about memories: counts by confidence level, importance, archived/pinned status, and tag distribution.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
        scope: {
          type: "string",
          enum: ["project", "global"],
          description: "Stats scope",
          default: "project",
        },
      },
    },
  },

  // ==================== Phase 1: Cleanup/Maintenance Tools ====================

  get_storage_stats: {
    name: "get_storage_stats",
    description:
      "Get storage statistics: database size, record counts by type, fragmentation level, and recommendations.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Specific project to analyze (omit for all projects)",
        },
        detailed: {
          type: "boolean",
          description: "Include per-table size breakdown (default: false)",
          default: false,
        },
      },
    },
  },

  find_stale_items: {
    name: "find_stale_items",
    description:
      "Find items that haven't been accessed or updated recently. Useful for cleanup planning.",
    inputSchema: {
      type: "object",
      properties: {
        item_types: {
          type: "array",
          items: {
            type: "string",
            enum: ["memory", "decision", "pattern", "session"],
          },
          description: "Types of items to check (default: memory, decision, pattern)",
          default: ["memory", "decision", "pattern"],
        },
        stale_threshold_days: {
          type: "number",
          description: "Days since last access/update to consider stale (default: 90)",
          default: 90,
        },
        exclude_pinned: {
          type: "boolean",
          description: "Exclude pinned items (default: true)",
          default: true,
        },
        exclude_important: {
          type: "boolean",
          description: "Exclude high/critical importance items (default: true)",
          default: true,
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
        limit: {
          type: "number",
          description: "Maximum items to return (default: 50)",
          default: 50,
        },
      },
    },
  },

  find_duplicates: {
    name: "find_duplicates",
    description:
      "Find similar or duplicate items using semantic similarity. Returns groups of duplicates with recommendations on which to keep.",
    inputSchema: {
      type: "object",
      properties: {
        item_types: {
          type: "array",
          items: {
            type: "string",
            enum: ["memory", "decision", "pattern"],
          },
          description: "Types of items to check (default: memory, decision)",
          default: ["memory", "decision"],
        },
        similarity_threshold: {
          type: "number",
          minimum: 0.5,
          maximum: 1.0,
          description: "Semantic similarity threshold (0.5-1.0, default: 0.85)",
          default: 0.85,
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
        limit: {
          type: "number",
          description: "Maximum duplicate groups to return (default: 20)",
          default: 20,
        },
      },
    },
  },

  merge_duplicates: {
    name: "merge_duplicates",
    description:
      "Merge duplicate items into one. Optionally combines content and tags from merged items.",
    inputSchema: {
      type: "object",
      properties: {
        item_type: {
          type: "string",
          enum: ["memory", "decision", "pattern"],
          description: "Type of items to merge",
        },
        keep_id: {
          type: "number",
          description: "ID of the item to keep",
        },
        merge_ids: {
          type: "array",
          items: { type: "number" },
          description: "IDs of items to merge into keep_id (will be deleted)",
        },
        merge_strategy: {
          type: "string",
          enum: ["keep_content", "combine_content", "keep_newest"],
          description: "How to handle content: keep_content (keep keep_id content), combine_content (merge all), keep_newest (use most recent)",
          default: "keep_content",
        },
        merge_tags: {
          type: "boolean",
          description: "Combine tags from all items (default: true)",
          default: true,
        },
      },
      required: ["item_type", "keep_id", "merge_ids"],
    },
  },

  cleanup_stale: {
    name: "cleanup_stale",
    description:
      "Remove or archive stale items. Use preview mode first to see what would be affected.",
    inputSchema: {
      type: "object",
      properties: {
        item_types: {
          type: "array",
          items: { type: "string" },
          description: "Types of items to clean up",
        },
        stale_threshold_days: {
          type: "number",
          description: "Days threshold (default: 90)",
          default: 90,
        },
        action: {
          type: "string",
          enum: ["archive", "delete", "preview"],
          description: "Action to take: preview (show what would happen), archive (soft remove), delete (permanent)",
          default: "preview",
        },
        exclude_pinned: {
          type: "boolean",
          description: "Exclude pinned items (default: true)",
          default: true,
        },
        exclude_important: {
          type: "boolean",
          description: "Exclude high/critical importance items (default: true)",
          default: true,
        },
        max_items: {
          type: "number",
          description: "Safety limit on items to process (default: 100)",
          default: 100,
        },
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
    },
  },

  vacuum_database: {
    name: "vacuum_database",
    description:
      "Reclaim disk space and optimize the database. Run after bulk deletions.",
    inputSchema: {
      type: "object",
      properties: {
        analyze: {
          type: "boolean",
          description: "Run ANALYZE after VACUUM to update query planner statistics (default: true)",
          default: true,
        },
        reindex: {
          type: "boolean",
          description: "Rebuild all indexes (default: false)",
          default: false,
        },
      },
    },
  },

  cleanup_orphans: {
    name: "cleanup_orphans",
    description:
      "Find and optionally remove orphaned records (tags without items, embeddings without sources, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        preview: {
          type: "boolean",
          description: "Only show what would be cleaned (default: true)",
          default: true,
        },
      },
    },
  },

  get_health_report: {
    name: "get_health_report",
    description:
      "Run comprehensive health checks on the database and memory system. Returns overall health score and recommendations.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Project path (defaults to current working directory)",
        },
      },
    },
  },

  run_maintenance: {
    name: "run_maintenance",
    description:
      "Run one or more maintenance tasks. Use preview mode to see what would happen.",
    inputSchema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "string",
            enum: ["cleanup_stale", "cleanup_orphans", "vacuum", "find_duplicates", "health_report", "cleanup_expired"],
          },
          description: "Tasks to run",
        },
        options: {
          type: "object",
          description: "Task-specific options (e.g., stale_threshold_days for cleanup_stale)",
        },
        preview: {
          type: "boolean",
          description: "Preview mode - show what would happen without making changes (default: true)",
          default: true,
        },
      },
      required: ["tasks"],
    },
  },

  get_maintenance_history: {
    name: "get_maintenance_history",
    description: "View history of past maintenance operations.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "number",
          description: "Only show operations since this timestamp",
        },
        task_type: {
          type: "string",
          description: "Filter by task type",
        },
        limit: {
          type: "number",
          description: "Maximum records to return (default: 20)",
          default: 20,
        },
      },
    },
  },
};
