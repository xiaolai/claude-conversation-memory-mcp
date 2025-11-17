# Claude Conversation Memory

A Model Context Protocol (MCP) server that gives AI assistants long-term memory by indexing conversation history from **Claude Code CLI** and **Codex** with semantic search, decision tracking, mistake prevention, and **global cross-project search**.

## 💡 What It Does

### Core Memory Features
- **Remembers past conversations** - Search your chat history with natural language
- **Tracks decisions** - Never forget why you made technical choices
- **Prevents mistakes** - Learn from past errors and avoid repeating them
- **Links to git commits** - Connect conversations to code changes
- **Analyzes file history** - See the complete evolution of files with context
- **Context transfer** - Recall past work and apply it to current tasks ("remember X, now do Y based on that")

### Global Cross-Project Search ✨ NEW
- **Search across ALL projects** - Find conversations across your entire work history
- **Dual-source support** - Index from both Claude Code CLI AND Codex
- **Unified interface** - Search conversations from any source in one query
- **Project filtering** - Filter by source type (claude-code, codex, or all)
- **Hybrid architecture** - Per-project databases + global registry for fast, isolated access

### Project Management
- **Migrates conversation history** - Keep your history when renaming or moving projects
- **Forget selectively** - Delete conversations by topic/keyword with automatic backups
- **Cross-project insights** - Discover decisions and mistakes across all your work

## 🎯 Dual Source Support

This MCP server works with **TWO** AI coding assistant platforms:

### ✅ Claude Code CLI
- **Official support**: Primary platform
- **Storage location**: `~/.claude/projects/`
- **Per-project databases**: Each project gets its own isolated database
- **Website**: https://github.com/anthropics/claude-code

### ✅ Codex
- **Full integration**: NEW in v1.5.0
- **Storage location**: `~/.codex/sessions/`
- **Date-hierarchical**: Sessions organized by `YYYY/MM/DD/`
- **Dedicated database**: Separate database at `~/.codex/.codex-conversations-memory.db`

### ❌ Not Supported
- Claude Desktop (different conversation format)
- Claude Web (no local storage)
- Other Claude integrations

## 🌐 Global Cross-Project Search

The hybrid architecture enables powerful cross-project search capabilities:

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Global Architecture                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ~/.claude/.claude-global-index.db (Central Registry)        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Tracks all indexed projects:                         │    │
│  │ • Project paths and source types                     │    │
│  │ • Database locations                                 │    │
│  │ • Aggregate statistics                               │    │
│  │ • Last indexed timestamps                            │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                    │
│            ┌─────────────┼─────────────┐                     │
│            ▼             ▼             ▼                     │
│   ┌────────────┐ ┌────────────┐ ┌────────────┐             │
│   │ Project A  │ │ Project B  │ │   Codex    │             │
│   │ Database   │ │ Database   │ │  Database  │             │
│   │            │ │            │ │            │             │
│   │ • Convos   │ │ • Convos   │ │ • Sessions │             │
│   │ • Messages │ │ • Messages │ │ • Messages │             │
│   │ • Decisions│ │ • Decisions│ │ • Tools    │             │
│   │ • Mistakes │ │ • Mistakes │ │ • Commits  │             │
│   └────────────┘ └────────────┘ └────────────┘             │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Benefits

**Isolation**: Each project has its own database - no cross-contamination
**Speed**: Direct database access - no central bottleneck
**Privacy**: Projects stay separate until you explicitly search globally
**Scalability**: Add unlimited projects without performance degradation

### Global Search Tools

Four new MCP tools enable cross-project search:

1. **`index_all_projects`** - Index all Claude Code projects + Codex in one command
2. **`search_all_conversations`** - Search messages across all indexed projects
3. **`get_all_decisions`** - Find decisions from any project (coming soon)
4. **`search_all_mistakes`** - Learn from mistakes across all work (coming soon)

## 📦 Installation

### Prerequisites

**Required:**
1. **Node.js**: Version 18 or higher
2. **Claude Code CLI** OR **Codex**: At least one AI assistant platform
   - Claude Code: https://github.com/anthropics/claude-code
   - Codex: Your Codex installation
3. **sqlite-vec extension**: Automatically loaded (bundled with package)

**Recommended for better semantic search:**
4. **Ollama**: For high-quality local embeddings
   ```bash
   # macOS/Linux
   curl -fsSL https://ollama.com/install.sh | sh

   # Or download from: https://ollama.com
   ```

5. **Default embedding model** (if using Ollama):
   ```bash
   # Pull the recommended model
   ollama pull mxbai-embed-large

   # Start Ollama service
   ollama serve
   ```

**Note**: Without Ollama, the MCP automatically falls back to Transformers.js (slower but works offline with no setup).

### Install the MCP Server

```bash
npm install -g claude-conversation-memory-mcp
```

**🎉 Automatic Configuration**: The global installation will automatically configure the MCP server in Claude Code's `~/.claude.json` file. You'll see a success message when it's done!

**Manual Configuration** (if needed): If automatic configuration doesn't work, see the [Configure Claude Code CLI](#configure-claude-code-cli) section below.

**Discover Available Models:**
After installation, you can see all available embedding models and their dimensions:
- Run the CLI: `claude-conversation-memory-mcp`
- Type: `config` to see all available models organized by provider
- Or check the example config file: `.claude-memory-config.example.jsonc`

### Configure Claude Code CLI

**MCP Configuration File Priority:**

Claude Code checks for MCP server configurations in this order (highest to lowest priority):

1. **`.mcp.json`** - Project-level (in your project root) - **Highest Priority**
2. **`~/.claude.json`** - User-level global (in your home directory) - **Lower Priority**

**Note**: The file `~/.claude/settings.json` is NOT used for MCP server configuration (it's only for permissions). Always use `~/.claude.json` for global MCP server configuration.

#### Option 1: Global Configuration (Recommended)

Create or edit `~/.claude.json`:

```json
{
  "mcpServers": {
    "conversation-memory": {
      "command": "claude-conversation-memory-mcp"
    }
  }
}
```

#### Option 2: Project-Level Configuration

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "conversation-memory": {
      "command": "claude-conversation-memory-mcp"
    }
  }
}
```

**Alternative: Use npx without global install**

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

### Verify Installation

Start Claude Code CLI and ask:

```
"Index my conversation history"
```

If you see a response like "Indexed 3 conversations with 1247 messages", it's working!

### Important: Restarting After Updates

**When you upgrade to a new version**, you MUST restart Claude Code CLI to reload the MCP server:

1. Exit Claude Code CLI completely
2. Start it again
3. The new version will be loaded

**Why?** Claude Code caches MCP servers. Without restarting, it will continue using the old cached version even after you've upgraded the npm package globally.

**Quick check**: After restart, you can verify the version with:
```bash
claude-conversation-memory-mcp --version
```

## 🖥️ Standalone CLI / REPL Mode

Beyond the MCP server, this package includes a powerful **standalone CLI** for managing your conversation memory directly from the terminal.

### Three Modes of Operation

**1. Interactive REPL Mode** (Default)
```bash
claude-conversation-memory-mcp
# Starts interactive shell with 40+ commands
```

**2. Single Command Mode**
```bash
claude-conversation-memory-mcp status
claude-conversation-memory-mcp "search authentication"
claude-conversation-memory-mcp mistakes --limit 5
```

**3. MCP Server Mode** (Used by Claude Code CLI)
```bash
claude-conversation-memory-mcp --server
# Or automatically via stdio from Claude Code CLI
```

### Quick CLI Examples

```bash
# View database status
claude-conversation-memory-mcp status

# Index conversations (current project)
claude-conversation-memory-mcp index --include-mcp

# Index ALL projects + Codex (NEW)
claude-conversation-memory-mcp index-all --codex --claude-code

# Search for topics
claude-conversation-memory-mcp "search database migration" --limit 3

# Search across ALL projects (NEW)
claude-conversation-memory-mcp "search-all authentication" --limit 10

# Find past mistakes
claude-conversation-memory-mcp mistakes "async" --type logic_error

# Check file context before editing
claude-conversation-memory-mcp check src/auth.ts

# Configure embedding model
claude-conversation-memory-mcp config
claude-conversation-memory-mcp set model mxbai-embed-large
claude-conversation-memory-mcp set dimensions 1024

# View help
claude-conversation-memory-mcp help
claude-conversation-memory-mcp "help search"
```

### Configuration Management

The CLI includes built-in commands for managing embedding models and dimensions:

```bash
# View current configuration
claude-conversation-memory-mcp config

# Switch to Ollama with mxbai-embed-large (1024 dimensions)
claude-conversation-memory-mcp set provider ollama
claude-conversation-memory-mcp set model mxbai-embed-large
claude-conversation-memory-mcp set dimensions 1024

# Switch to Transformers.js (offline, no setup)
claude-conversation-memory-mcp set provider transformers
claude-conversation-memory-mcp set model Xenova/all-MiniLM-L6-v2
claude-conversation-memory-mcp set dimensions 384

# Get specific config value
claude-conversation-memory-mcp get provider
```

### Available Commands

- **📥 Indexing**: `index`, `reindex`, `index-all` (NEW)
- **🔍 Search**: `search`, `search-all` (NEW), `decisions`, `mistakes`, `similar`
- **📋 Files**: `check`, `history`
- **🔗 Git**: `commits`
- **📝 Other**: `requirements`, `tools`, `docs`
- **ℹ️ Info**: `status`, `version`, `help`
- **⚙️ Config**: `config`, `get`, `set`
- **🧹 Maintenance**: `vacuum`, `reset`

**👉 See [Complete CLI Guide](docs/CLI-USAGE.md) for all commands, examples, and workflows**

## 🎯 Usage Examples

### First Time Setup - Single Project

```
You: "Index my conversation history for this project"

Claude: I'll index all conversations for this project...
✓ Indexed 5 conversations with 2,341 messages
✓ Semantic search enabled (embeddings generated)
```

### First Time Setup - All Projects + Codex ✨ NEW

```
You: "Index all my projects including Codex conversations"

Claude: I'll index all projects from both Claude Code and Codex...
✓ Indexed 3 Claude Code projects (47 conversations)
✓ Indexed Codex sessions (128 conversations)
✓ Global index created at ~/.claude/.claude-global-index.db
✓ Total: 175 conversations across 4 projects
```

### Search Across All Projects ✨ NEW

```
You: "Search all my conversations about authentication"

Claude: Searching across 4 indexed projects...
Found 12 results:
• Project: my-api (claude-code) - 5 conversations
• Project: mobile-app (claude-code) - 3 conversations
• Project: Codex (codex) - 4 conversations
[Returns relevant messages with project context]
```

### Search Within Current Project

```
You: "What did we discuss about the authentication system?"

Claude: Let me search our conversation history for this project...
[Returns relevant messages with context and timestamps]
```

### Before Modifying Files

```
You: "Before I change database.ts, what should I know?"

Claude: Let me check the context for database.ts...
[Shows recent changes, related decisions, and past mistakes]
```

### Track Decisions

```
You: "Why did we choose SQLite over PostgreSQL?"

Claude: Let me check our decision history...
[Returns the decision with rationale and alternatives considered]
```

### Learn from Mistakes

```
You: "Have we had issues with async/await before?"

Claude: Let me search past mistakes...
[Shows previous errors and how they were fixed]
```

### Find Related Work Across Projects ✨ NEW

```
You: "Search all projects for similar API endpoint implementations"

Claude: Searching across all indexed projects...
Found similar work in:
• Project A: REST API design patterns
• Project B: GraphQL endpoint structure
• Codex: API versioning approach
[Returns relevant sessions from multiple projects]
```

### View File History

```
You: "Show me how auth.ts evolved over time"

Claude: Let me trace the file evolution...
[Shows complete timeline with conversations, commits, and decisions]
```

### Recall and Apply Context

```
You: "Recall how we implemented authentication, now add OAuth support using that same pattern"

Claude: Let me recall the authentication implementation context...
[Returns relevant conversations, decisions, mistakes, file changes, and commits]
[Provides suggestions for applying this context to OAuth implementation]
```

**More examples:**
- "Remember the bug we fixed in parser.ts, check if similar issue exists in lexer.ts"
- "Recall all decisions about database schema, now design the migration strategy"
- "Find mistakes we made with async/await, avoid them in this new async function"
- "Search all my projects for how I handled error boundaries" ✨ NEW

## 🔧 Advanced Usage

### Global Indexing Options ✨ NEW

#### Index All Projects

```
You: "Index all my projects from Claude Code and Codex"

# With options:
You: "Index all projects, include Codex at /custom/path/.codex, exclude MCP conversations"
```

Options:
- `include_codex` (default: true) - Index Codex sessions
- `include_claude_code` (default: true) - Index Claude Code projects
- `codex_path` - Custom Codex location (default: `~/.codex`)
- `claude_projects_path` - Custom Claude Code projects location (default: `~/.claude/projects`)

#### Filter Global Search by Source

```
You: "Search only Claude Code projects for authentication"
# source_type: "claude-code"

You: "Search only Codex sessions for database design"
# source_type: "codex"

You: "Search all sources for error handling"
# source_type: "all" (default)
```

### Index Specific Session

```
You: "Index conversation from session a1172af3-ca62-41be-9b90-701cef39daae"
```

### Exclude MCP Conversations

By default, conversations about the MCP itself are excluded to prevent self-referential loops. To include them:

```
You: "Index all conversations, including MCP conversations"
```

### Indexing Options

When indexing conversations, several options control what gets stored:

#### Include Thinking Blocks

**Default**: `false` (thinking blocks are excluded)

Thinking blocks contain Claude's internal reasoning process. They can be **very large** (3-5x more data) and are usually not needed for search.

```
# Default behavior (recommended)
You: "Index conversations"
# Thinking blocks are excluded

# Include thinking blocks (increases database size significantly)
You: "Index conversations with thinking blocks"
```

**When to enable**:
- ✅ You want to search Claude's reasoning process
- ✅ You're analyzing decision-making patterns
- ❌ Don't enable if you just want to search visible conversation content

#### Exclude MCP Conversations

**Default**: `"self-only"` (excludes only conversation-memory MCP calls)

Controls which MCP tool interactions are indexed:

- `"self-only"` (default): Excludes messages about this conversation-memory MCP to prevent self-referential loops
- `false`: Index all MCP tool calls from all servers
- `"all-mcp"` or `true`: Exclude all MCP tool calls from all servers
- `["server1", "server2"]`: Exclude specific MCP servers

```
# Default - exclude only conversation-memory MCP
You: "Index conversations"

# Include all MCP conversations (including this one)
You: "Index conversations, include all MCP tools"

# Exclude all MCP tool calls
You: "Index conversations, exclude all MCP interactions"
```

**What gets filtered**: Only the specific **messages** that invoke MCP tools are excluded, not entire conversations. This preserves conversation context while preventing self-referential loops.

#### Enable Git Integration

**Default**: `true` (git commits are linked)

Links git commits to conversations based on timestamps and file changes.

```
# Default behavior
You: "Index conversations"
# Git commits are automatically linked

# Disable git integration
You: "Index conversations without git integration"
```

#### Index Output

After indexing, you'll see:

```
📁 Indexed from: /path/to/modern-folder, /path/to/legacy-folder
💾 Database: /path/to/.claude-conversations-memory.db
```

For global indexing:

```
🌐 Global index: ~/.claude/.claude-global-index.db
📁 Indexed 4 projects:
  • 2 Claude Code projects
  • 1 Codex project
💾 Total: 175 conversations, 8,432 messages
```

This shows:
- **Indexed folders**: Which conversation folders were used (including legacy if it exists)
- **Database locations**: Where your indexed data is stored (per-project + global)
- **Statistics**: Total counts across all sources

### Search with Date Filters

```
You: "What were we working on last week?"
You: "Search all projects for discussions from January 2025"
```

### Generate Documentation

```
You: "Generate project documentation from our conversations"
```

Claude will create comprehensive docs combining code analysis with conversation history.

### Migrate Conversation History

When you rename or move a project directory, your conversation history becomes inaccessible because Claude Code creates a new folder for the new path. Use the migration tools to recover your history:

**Step 1: Discover old conversation folders**

```
You: "Discover old conversations for this project"
```

Claude will scan `~/.claude/projects/` and show you folders that match your current project, ranked by similarity score. The output includes:
- Folder name and path
- Original project path stored in the database
- Number of conversations and files
- Last activity timestamp
- Similarity score (higher = better match)

**Step 2: Migrate the history**

```
You: "Migrate conversations from /Users/name/.claude/projects/-old-project-name, old path was /Users/name/old-project, new path is /Users/name/new-project"
```

Claude will:
- Copy all conversation JSONL files to the new location
- Update the `project_path` in the database
- Create automatic backups (`.claude-conversations-memory.db.bak`)
- Preserve all original data (copy, not move)

**Example workflow:**

```markdown
# You renamed your project directory
# Old: /Users/alice/code/my-app
# New: /Users/alice/code/my-awesome-app

You: "Discover old conversations for this project"

Claude: Found 1 potential old conversation folder:
- Folder: -Users-alice-code-my-app
- Original path: /Users/alice/code/my-app
- Conversations: 15
- Files: 47
- Score: 95.3

You: "Migrate from /Users/alice/.claude/projects/-Users-alice-code-my-app, old path /Users/alice/code/my-app, new path /Users/alice/code/my-awesome-app"

Claude: Successfully migrated 47 conversation files.
Now you can index and search your full history!
```

**Dry run mode:**

Test the migration without making changes:

```
You: "Dry run: migrate from [source] old path [old] new path [new]"
```

This shows what would be migrated without actually copying files.

### Merge Conversations from Different Projects

Combine conversation history from different projects into one folder using merge mode.

**Use case**: You want to merge conversations from `/project-a/drafts/2025-01-05` into your current project `/project-b`.

**Step 1: Discover the source folder**

```
You: "Discover old conversations for project path /Users/name/project-a/drafts/2025-01-05"
```

**Step 2: Merge into current project**

```
You: "Merge conversations from /Users/name/.claude/projects/-project-a-drafts-2025-01-05, old path /Users/name/project-a/drafts/2025-01-05, new path /Users/name/project-b, mode merge"
```

Claude will:
- Copy only **new** conversation files (skip duplicates)
- Keep target conversations when IDs collide (no data loss)
- Merge all database entries using INSERT OR IGNORE
- Create backup of target database before merge
- Preserve all original source data

**Example workflow:**

```markdown
# Scenario: You have conversations from different projects to combine

Current project: /Users/alice/main-project (already has 20 conversations)
Source project: /Users/alice/drafts/experiment (has 10 conversations, 3 overlap with main)

You: "Discover old conversations for /Users/alice/drafts/experiment"

Claude: Found 1 folder:
- Folder: -Users-alice-drafts-experiment
- Original path: /Users/alice/drafts/experiment
- Conversations: 10
- Files: 10

You: "Merge from /Users/alice/.claude/projects/-Users-alice-drafts-experiment, old path /Users/alice/drafts/experiment, new path /Users/alice/main-project, mode merge"

Claude: Successfully merged 7 new conversation files into /Users/alice/.claude/projects/-Users-alice-main-project
(3 duplicate conversations were skipped to preserve target data)
Backup created at: .claude-conversations-memory.db.bak

# Result: main-project now has 27 conversations (20 original + 7 new from experiment)
```

**Key differences between migrate and merge:**

| Feature | Migrate Mode (default) | Merge Mode |
|---------|----------------------|------------|
| Target has data | ❌ Rejected (conflict) | ✅ Allowed |
| Duplicate IDs | Overwrites target | Skips source (keeps target) |
| Use case | Renamed project | Combine different projects |
| Backup location | Source folder | Target folder |

### Forget Conversations by Topic

You can selectively delete conversations about specific topics or keywords. The tool automatically creates a backup before deletion.

**Step 1: Preview what would be deleted**

```
You: "Show me conversations about authentication redesign"
```

Claude will use `forget_by_topic` with `confirm=false` to preview:
```
Found 3 conversations (45 messages, 8 decisions, 2 mistakes) matching: authentication, redesign

Conversations:
- 2024-01-15: Session abc123 (15 messages)
- 2024-01-18: Session def456 (20 messages)
- 2024-01-20: Session ghi789 (10 messages)

Set confirm=true to delete these conversations.
```

**Step 2: Confirm deletion**

```
You: "Yes, forget all conversations about authentication redesign"
```

Claude will use `forget_by_topic` with `confirm=true`:
```
✓ Backup created: ~/.claude/backups/my-project/backup-20250107-143022.json
✓ Deleted 3 conversations (45 messages, 8 decisions, 2 mistakes)
✓ Git commits preserved (only unlinked)
```

**Safety features:**
- **Automatic backup** - Data exported to JSON before deletion
- **Preview mode** - Always shows what would be deleted first
- **Cascading deletion** - Automatically removes messages, decisions, mistakes, embeddings
- **Git preservation** - Git commits are unlinked but not deleted

**⚠️ Important Notes:**
- Deletion is irreversible (even with backups, restoration requires manual work)
- Backups are stored in `~/.claude/backups/{project-name}/`
- Keywords are matched using semantic + full-text search
- All related data (messages, decisions, mistakes) is deleted

**Example keywords:**
- "authentication", "redesign" - Broad topics
- "bug in parser" - Specific issues
- "refactoring", "cleanup" - Development phases

## 🏗️ Architecture

### Hybrid Database Design

The MCP uses a **hybrid architecture** combining per-project isolation with global search capability:

```
Per-Project Databases (Isolation & Speed)
├── ~/.claude/projects/{project}/.claude-conversations-memory.db
├── ~/.claude/projects/{another-project}/.claude-conversations-memory.db
└── ~/.codex/.codex-conversations-memory.db

Global Registry (Cross-Project Search)
└── ~/.claude/.claude-global-index.db
    ├── Tracks all indexed projects
    ├── Stores project metadata
    └── Enables global search coordination
```

**Benefits:**
- **Privacy**: Projects remain isolated unless you explicitly search globally
- **Performance**: Direct database access per project - no central bottleneck
- **Scalability**: Add unlimited projects without performance degradation
- **Flexibility**: Search single project OR all projects as needed

### Database Schema

Each project database contains:
- **conversations**: Session metadata with source_type ('claude-code' or 'codex')
- **messages**: Chat messages with semantic embeddings
- **decisions**: Extracted architectural decisions
- **mistakes**: Tracked errors and corrections
- **git_commits**: Linked git history
- **file_edits**: File modification tracking
- **thinking_blocks**: Claude's reasoning (optional)

The global index contains:
- **project_metadata**: Registry of all indexed projects
- **source_type**: Distinguishes claude-code vs codex
- **aggregate stats**: Total conversations, messages, decisions, mistakes

## 📚 Learn More

- **[Tool Examples](docs/TOOL-EXAMPLES.md)** - 50+ natural language examples for each tool (including new global search tools)
- **[Quick Reference](docs/QUICK-REFERENCE.md)** - Common phrases cheat sheet
- **[Embeddings FAQ](docs/EMBEDDINGS-FAQ.md)** - How semantic search works
- **[Functional Matrix](docs/FUNCTIONAL-MATRIX.md)** - Complete feature coverage

## 🐛 Troubleshooting

### "No conversations found"

Make sure you're running this in a directory where you've had Claude Code CLI conversations. Check `~/.claude/projects/` to verify conversation files exist.

For Codex: Check `~/.codex/sessions/` for session files.

### "Embeddings failed"

The MCP falls back to full-text search if embeddings fail. Everything still works, just without semantic search.

### "MCP not responding"

Restart Claude Code CLI to reload the MCP server.

### "Global index not found"

Run `index_all_projects` first to create the global registry before using cross-project search.

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Inspired by [code-graph-rag-mcp](https://github.com/er77/code-graph-rag-mcp).

---

**Made with ❤️ for the Claude Code CLI and Codex communities**
