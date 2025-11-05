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
    description: "Query history of tool uses (bash commands, file edits, reads, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: {
          type: "string",
          description: "Optional: filter by tool name (Bash, Edit, Write, Read)",
        },
        file_path: {
          type: "string",
          description: "Optional: filter by file path",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
          default: 20,
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
};
