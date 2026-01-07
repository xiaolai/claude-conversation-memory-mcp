# CCCMemory MCP

An MCP server that gives Claude long-term memory by indexing conversation history with semantic search, decision tracking, and cross-project search.

---

## ⚠️ Breaking Changes in v1.8.0

**This package has been renamed from `claude-conversation-memory-mcp` to `cccmemory`.**

If you were using the old package, follow these migration steps:

### 1. Uninstall the old package

```bash
npm uninstall -g claude-conversation-memory-mcp
```

### 2. Install the new package

```bash
npm install -g cccmemory
```

### 3. Update your MCP configuration

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "cccmemory": {
      "command": "npx",
      "args": ["-y", "cccmemory"]
    }
  }
}
```

**Claude Code** (`~/.claude.json`):
```json
{
  "mcpServers": {
    "cccmemory": {
      "command": "npx",
      "args": ["-y", "cccmemory"]
    }
  }
}
```

**Codex** (`~/.codex/config.toml`):
```toml
[mcp_servers.cccmemory]
command = "npx"
args = ["-y", "cccmemory"]
```

### 4. Database migration (automatic)

Your conversation history is preserved. The database files are automatically migrated:
- `.claude-conversations-memory.db` → `.cccmemory.db`
- `.codex-conversations-memory.db` → `.cccmemory.db`

No manual action required - the migration happens on first run.

---

## Features

- **Search conversations** - Natural language search across your chat history
- **Track decisions** - Remember why you made technical choices
- **Prevent mistakes** - Learn from past errors
- **Git integration** - Link conversations to commits
- **Cross-project search** - Search across all your projects globally
- **Project migration** - Keep history when renaming/moving projects
- **Semantic search** - Uses Transformers.js embeddings (bundled, works offline)

## Installation

### Node.js version

CCCMemory supports **Node.js 20 or 22 LTS**. Using other versions can break native
modules (like `better-sqlite3`). If you switch Node versions, reinstall the
package (or run `npm rebuild better-sqlite3` in a local clone).

```bash
npm install -g cccmemory
```

Verify installation:

```bash
cccmemory --version
```

## Configuration

### For Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "cccmemory": {
      "command": "npx",
      "args": ["-y", "cccmemory"]
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
    "cccmemory": {
      "command": "npx",
      "args": ["-y", "cccmemory"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "cccmemory": {
      "command": "cccmemory"
    }
  }
}
```

### For Codex CLI

Codex stores MCP settings in `~/.codex/config.toml` (shared by the CLI and the IDE extension).

**Recommended (CLI):**
```bash
codex mcp add cccmemory -- npx -y cccmemory
```

**Manual config (`~/.codex/config.toml`):**
```toml
[mcp_servers.cccmemory]
command = "npx"
args = ["-y", "cccmemory"]
```

If you installed globally, you can use:
```toml
[mcp_servers.cccmemory]
command = "cccmemory"
```

Open Codex and run `/mcp` in the TUI to verify the server is active.

### Storage Paths

By default, CCCMemory stores per-project databases in:

- `~/.claude/projects/<project>/.cccmemory.db`
- Global index: `~/.claude/.cccmemory-global.db`

If your home directory is not writable (common in sandboxed Codex/Claude setups where
`~/.claude` and `~/.codex` are locked), the server will exit with a clear error.
Set explicit paths to a writable location:

```bash
export CCCMEMORY_DB_PATH="/path/to/cccmemory.db"
export CCCMEMORY_GLOBAL_INDEX_PATH="/path/to/cccmemory-global.db"
```

For MCP configs, add these env vars in your server definition. CCCMemory will not
silently create new databases outside `~/.claude`; it only uses an existing
project-local DB if one already exists and logs a warning.

### Embedding Configuration (Optional)

The MCP uses **Transformers.js** by default for semantic search (bundled, works offline, no setup required).

**Model download & cache behavior (Transformers.js):**  
On first use, `@xenova/transformers` downloads the model weights and caches them in its own default cache directory. CCCMemory does not manage or relocate that cache. Subsequent runs reuse the cached model and work fully offline.

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
cccmemory

# Single commands
cccmemory status
cccmemory index
cccmemory "search authentication"
cccmemory help
```

## Supported Platforms

| Platform | Status | Conversation Location |
|----------|--------|----------------------|
| Claude Code | ✅ Supported | `~/.claude/projects/` |
| Claude Desktop | ✅ Supported | (indexes Claude Code history) |
| Codex | ✅ Supported | `~/.codex/sessions/` |

**Why only Claude Code and Codex CLI today?**
CCCMemory indexes local session history from stable, parseable on-disk formats. Claude Code and Codex CLI both store full conversation logs locally with consistent schemas. Other tools either do not expose full local history, only support partial/manual saves, or do not provide a stable file format to parse reliably. Without deterministic local storage, there is nothing safe to index or resume.

## Architecture

```
Per-Project Databases (isolation)
├── ~/.claude/projects/{project}/.cccmemory.db (Claude Code default)
├── ~/.codex/.cccmemory.db (Codex default)
└── {project}/.cccmemory/.cccmemory.db (fallback in restricted sandboxes)

Global Registry (cross-project search)
├── ~/.claude/.cccmemory-global.db (default)
└── {project}/.cccmemory/global-index.db (fallback in restricted sandboxes)
```

## Troubleshooting

### Claude Desktop shows JSON parse errors

Upgrade to v1.7.3+:
```bash
npm update -g cccmemory
```

### MCP not loading in Claude Code

1. Check config location is `~/.claude.json` (not `~/.claude/config.json`)
2. Verify JSON syntax is valid
3. Restart Claude Code

### Embeddings not working

Check provider status:
```bash
cccmemory status
```

Default Transformers.js should work out of the box. If you opt into Ollama, ensure it's running (`ollama serve`).

## License

MIT
