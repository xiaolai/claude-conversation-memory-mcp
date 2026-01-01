# Claude Conversation Memory MCP

An MCP server that gives Claude long-term memory by indexing conversation history with semantic search, decision tracking, and cross-project search.

## Features

- **Search conversations** - Natural language search across your chat history
- **Track decisions** - Remember why you made technical choices
- **Prevent mistakes** - Learn from past errors
- **Git integration** - Link conversations to commits
- **Cross-project search** - Search across all your projects globally
- **Project migration** - Keep history when renaming/moving projects
- **Semantic search** - Uses Transformers.js embeddings (bundled, works offline)

## Installation

```bash
npm install -g claude-conversation-memory-mcp
```

Verify installation:

```bash
claude-conversation-memory-mcp --version
```

## Configuration

### For Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "conversation-memory": {
      "command": "npx",
      "args": ["-y", "claude-conversation-memory-mcp"]
    }
  }
}
```

Then restart Claude Desktop.

### For Claude Code

Edit `~/.claude.json` (note: this file is in your home directory, not inside `~/.claude/`):

```json
{
  "mcpServers": {
    "conversation-memory": {
      "command": "npx",
      "args": ["-y", "claude-conversation-memory-mcp"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "conversation-memory": {
      "command": "claude-conversation-memory-mcp"
    }
  }
}
```

### Embedding Configuration (Optional)

The MCP uses **Transformers.js** by default for semantic search (bundled, works offline, no setup required).

To customize, create `~/.claude-memory-config.json`:

```json
{
  "embedding": {
    "provider": "transformers",
    "model": "Xenova/all-MiniLM-L6-v2",
    "dimensions": 384
  }
}
```

**Alternative providers:**

<details>
<summary>Ollama (faster, requires Ollama running)</summary>

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh
ollama pull mxbai-embed-large
ollama serve
```

Config:
```json
{
  "embedding": {
    "provider": "ollama",
    "model": "mxbai-embed-large",
    "dimensions": 1024
  }
}
```
</details>

<details>
<summary>OpenAI (requires API key)</summary>

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
```

Set `OPENAI_API_KEY` environment variable.
</details>

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
| `search_by_file` | Find all context related to a file |
| `list_recent_sessions` | List recent sessions with summaries |
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

| Platform | Status | Conversation Location |
|----------|--------|----------------------|
| Claude Code | ✅ Supported | `~/.claude/projects/` |
| Claude Desktop | ✅ Supported | (indexes Claude Code history) |
| Codex | ✅ Supported | `~/.codex/sessions/` |

## Architecture

```
Per-Project Databases (isolation)
├── ~/.claude/projects/{project}/.claude-conversations-memory.db
└── ~/.codex/.codex-conversations-memory.db

Global Registry (cross-project search)
└── ~/.claude/.claude-global-index.db
```

## Troubleshooting

### Claude Desktop shows JSON parse errors

Upgrade to v1.7.3+:
```bash
npm update -g claude-conversation-memory-mcp
```

### MCP not loading in Claude Code

1. Check config location is `~/.claude.json` (not `~/.claude/config.json`)
2. Verify JSON syntax is valid
3. Restart Claude Code

### Embeddings not working

Check provider status:
```bash
claude-conversation-memory-mcp status
```

Default Transformers.js should work out of the box. If using Ollama, ensure it's running (`ollama serve`).

## License

MIT
