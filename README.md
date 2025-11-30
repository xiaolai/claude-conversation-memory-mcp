# Claude Conversation Memory MCP

An MCP server that gives Claude Code and Codex long-term memory by indexing conversation history with semantic search, decision tracking, and cross-project search.

## Features

- **Search conversations** - Natural language search across your chat history
- **Track decisions** - Remember why you made technical choices
- **Prevent mistakes** - Learn from past errors
- **Git integration** - Link conversations to commits
- **Cross-project search** - Search across all your projects globally
- **Project migration** - Keep history when renaming/moving projects

## Installation

```bash
npm install -g claude-conversation-memory-mcp
```

The installer automatically configures Claude Code. To verify:

```bash
claude-conversation-memory-mcp --version
```

### Embedding Providers (Optional)

For semantic search, install one of:

**Ollama** (recommended - fast, local):
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull mxbai-embed-large
ollama serve
```

**Transformers.js** (no setup, slower):
```bash
npm install @xenova/transformers
```

Without either, the MCP falls back to full-text search.

## Configuration

The MCP auto-configures on install. Manual setup if needed:

**~/.claude/config.json** (Claude Code):
```json
{
  "mcpServers": {
    "conversation-memory": {
      "command": "claude-conversation-memory-mcp"
    }
  }
}
```

**Embedding config** (optional) - create `.claude-memory-config.json`:
```json
{
  "embedding": {
    "provider": "ollama",
    "model": "mxbai-embed-large",
    "dimensions": 1024
  }
}
```

## MCP Tools

### Indexing
| Tool | Description |
|------|-------------|
| `index_conversations` | Index current project's conversations |
| `index_all_projects` | Index all Claude Code + Codex projects |

### Search
| Tool | Description |
|------|-------------|
| `search_conversations` | Search messages in current project |
| `search_all_conversations` | Search across all indexed projects |
| `get_decisions` | Find architectural decisions |
| `get_all_decisions` | Decisions across all projects |
| `search_mistakes` | Find past errors and fixes |
| `search_all_mistakes` | Mistakes across all projects |
| `find_similar_sessions` | Find related conversations |

### Context
| Tool | Description |
|------|-------------|
| `check_before_modify` | Get context before editing a file |
| `get_file_evolution` | See file history with commits |
| `recall_and_apply` | Recall past work for current task |
| `get_requirements` | Look up component requirements |
| `get_tool_history` | Query tool usage history |
| `link_commits_to_conversations` | Connect git commits to sessions |

### Project Management
| Tool | Description |
|------|-------------|
| `discover_old_conversations` | Find folders from renamed projects |
| `migrate_project` | Migrate/merge conversation history |
| `forget_by_topic` | Delete conversations by keyword |
| `generate_documentation` | Generate docs from conversations |

## CLI Usage

The package includes a standalone CLI:

```bash
# Interactive mode
claude-conversation-memory-mcp

# Single commands
claude-conversation-memory-mcp status
claude-conversation-memory-mcp index
claude-conversation-memory-mcp "search authentication"
claude-conversation-memory-mcp help
```

## Supported Platforms

| Platform | Status | Location |
|----------|--------|----------|
| Claude Code | Supported | `~/.claude/projects/` |
| Codex | Supported | `~/.codex/sessions/` |
| Claude Desktop | Not supported | Different format |

## Architecture

```
Per-Project Databases (isolation)
├── ~/.claude/projects/{project}/.claude-conversations-memory.db
└── ~/.codex/.codex-conversations-memory.db

Global Registry (cross-project search)
└── ~/.claude/.claude-global-index.db
```

## License

MIT
