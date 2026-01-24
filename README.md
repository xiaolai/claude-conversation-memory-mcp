# CCCMemory MCP

An MCP server that gives Claude long-term memory by indexing conversation history with semantic search, decision tracking, and cross-project search.

---

## What's New in v2.0

Version 2.0 brings major improvements to search quality and accuracy:

- **Smart Chunking** - Long messages are now split at sentence boundaries, ensuring full content is searchable (previously truncated at 512 tokens)
- **Hybrid Search** - Combines semantic search with full-text search using Reciprocal Rank Fusion (RRF) for better ranking
- **Dynamic Thresholds** - Similarity thresholds adjust based on query length for better precision
- **Improved Snippets** - Search results highlight matching terms in context
- **Extraction Validation** - Reduces false positives in decision/mistake detection
- **Query Expansion** - Optional synonym expansion for broader recall (disabled by default)

---

<details>
<summary><strong>⚠️ Breaking Changes in v1.8.0</strong> (click to expand)</summary>

**This package was renamed from `claude-conversation-memory-mcp` to `cccmemory`.**

If upgrading from the old package:

1. Uninstall old package: `npm uninstall -g claude-conversation-memory-mcp`
2. Install new package: `npm install -g cccmemory`
3. Update MCP config to use `cccmemory` command
4. Database migration is automatic (`.claude-conversations-memory.db` → `.cccmemory.db`)

</details>

---

## Features

- **Search conversations** - Natural language search across your chat history
- **Smart chunking** - Long messages fully indexed without truncation
- **Hybrid search** - Combines vector + keyword search with RRF re-ranking
- **Track decisions** - Remember why you made technical choices
- **Prevent mistakes** - Learn from past errors
- **Git integration** - Link conversations to commits
- **Cross-project search** - Search across all your projects globally
- **Project migration** - Keep history when renaming/moving projects
- **Semantic search** - Uses Transformers.js embeddings (bundled, works offline)
- **Working memory** - Store and recall facts, decisions, and context across sessions
- **Session handoff** - Seamless context transfer between conversations
- **Tag management** - Organize memories, decisions, and patterns with tags
- **Memory quality** - Track confidence, importance, and verification status
- **Database maintenance** - Find duplicates, clean stale data, health reports

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

By default, CCCMemory uses a **single database**:

- `~/.cccmemory.db`

If you want per-project isolation, set:

```bash
export CCCMEMORY_DB_MODE="per-project"
```

In per-project mode, CCCMemory stores:

- `~/.claude/projects/<project>/.cccmemory.db`
- Fallback (restricted sandboxes): `<project>/.cccmemory/.cccmemory.db`

If your home directory is not writable (common in sandboxed Codex/Claude setups where
`~/.claude` and `~/.codex` are locked), set an explicit writable path:

```bash
export CCCMEMORY_DB_PATH="/path/to/cccmemory.db"
```

For MCP configs, add these env vars in your server definition. CCCMemory stores the
global project registry **inside the same database** (projects + project_sources tables).

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

### Search Configuration (Optional)

Tune search behavior with environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CCCMEMORY_CHUNKING_ENABLED` | `true` | Enable smart chunking for long messages |
| `CCCMEMORY_CHUNK_SIZE` | `450` | Target chunk size in tokens |
| `CCCMEMORY_CHUNK_OVERLAP` | `0.1` | Overlap between chunks (0-1) |
| `CCCMEMORY_RERANK_ENABLED` | `true` | Enable hybrid re-ranking (vector + FTS) |
| `CCCMEMORY_RERANK_WEIGHT` | `0.7` | Vector weight in re-ranking (FTS gets 1-weight) |
| `CCCMEMORY_QUERY_EXPANSION` | `false` | Enable synonym expansion for queries |

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
| `search_project_conversations` | Search a project across Claude Code + Codex |
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
| `get_latest_session_summary` | Summarize the latest session (problem, actions, errors) |
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
| `generate_documentation` | Generate docs from local code scan + conversations |

### Working Memory
| Tool | Description |
|------|-------------|
| `remember` | Store a fact, decision, or context with optional TTL |
| `recall` | Retrieve a specific memory by key |
| `recall_relevant` | Semantic search across stored memories |
| `list_memory` | List all memories, optionally filtered by tags |
| `forget` | Remove a memory by key |

### Session Handoff
| Tool | Description |
|------|-------------|
| `prepare_handoff` | Create handoff document for session transition |
| `resume_from_handoff` | Resume work from a previous handoff |
| `list_handoffs` | List available handoff documents |

### Context Injection
| Tool | Description |
|------|-------------|
| `get_startup_context` | Get relevant context at conversation start |
| `inject_relevant_context` | Auto-inject context based on user message |

### Tag Management
| Tool | Description |
|------|-------------|
| `list_tags` | List all tags with usage statistics |
| `search_by_tags` | Find items by tag (memories, decisions, patterns) |
| `rename_tag` | Rename a tag across all items |
| `merge_tags` | Merge multiple tags into one |
| `delete_tag` | Delete a tag and unlink all items |
| `tag_item` | Add tags to an item |
| `untag_item` | Remove tags from an item |

### Memory Quality
| Tool | Description |
|------|-------------|
| `set_memory_confidence` | Set confidence level (uncertain/likely/confirmed/verified) |
| `set_memory_importance` | Set importance level (low/normal/high/critical) |
| `pin_memory` | Pin a memory to prevent cleanup |
| `archive_memory` | Archive a memory with optional reason |
| `unarchive_memory` | Restore an archived memory |
| `search_memory_by_quality` | Search memories by confidence/importance |
| `get_memory_stats` | Get memory statistics by confidence/importance |

### Maintenance
| Tool | Description |
|------|-------------|
| `get_storage_stats` | Database size and item counts |
| `find_stale_items` | Find items not accessed recently |
| `find_duplicates` | Find similar/duplicate items |
| `merge_duplicates` | Merge duplicate items |
| `cleanup_stale` | Archive or delete stale items |
| `vacuum_database` | Reclaim disk space |
| `cleanup_orphans` | Remove orphaned records |
| `get_health_report` | Overall database health check |
| `run_maintenance` | Run multiple maintenance tasks |
| `get_maintenance_history` | View past maintenance operations |

### Session IDs

`list_recent_sessions` returns **two identifiers**:

- `id`: internal conversation id (use for `scope="current"` filters, handoffs, and documentation filters)
- `session_id`: external session id (Claude JSONL filename / Codex rollout id). Use for `index_conversations` and CLI `index --session`.

`index_conversations` accepts either, but external `session_id` is preferred.

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
Single Database (default)
└── ~/.cccmemory.db
    ├── projects + project_aliases
    ├── project_sources (global index)
    └── conversations/messages/decisions/mistakes/...

Per-Project Databases (optional)
└── ~/.claude/projects/{project}/.cccmemory.db
    └── {project}/.cccmemory/.cccmemory.db (sandbox fallback)
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
