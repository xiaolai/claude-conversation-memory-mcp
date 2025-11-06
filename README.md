# Claude Conversation Memory

A Model Context Protocol (MCP) server that gives Claude Code long-term memory by indexing your conversation history with semantic search, decision tracking, and mistake prevention.

## 💡 What It Does

- **Remembers past conversations** - Search your chat history with natural language
- **Tracks decisions** - Never forget why you made technical choices
- **Prevents mistakes** - Learn from past errors and avoid repeating them
- **Links to git commits** - Connect conversations to code changes
- **Analyzes file history** - See the complete evolution of files with context

## ⚠️ Important: Claude Code CLI Only

**This MCP server works ONLY with [Claude Code CLI](https://github.com/anthropics/claude-code).**

It does NOT work with:
- ❌ Claude Desktop
- ❌ Claude Web
- ❌ Other Claude integrations

Claude Code CLI is required because it stores conversation history in `~/.claude/projects/` which this MCP indexes.

## 📦 Installation

### Prerequisites

**Required:**
1. **Claude Code CLI**: https://github.com/anthropics/claude-code
2. **Node.js**: Version 18 or higher
3. **sqlite-vec extension**: Automatically loaded (bundled with the package)

**Recommended for better semantic search quality:**
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

# Index conversations
claude-conversation-memory-mcp index --include-mcp

# Search for topics
claude-conversation-memory-mcp "search database migration" --limit 3

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

- **📥 Indexing**: `index`, `reindex`
- **🔍 Search**: `search`, `decisions`, `mistakes`, `similar`
- **📋 Files**: `check`, `history`
- **🔗 Git**: `commits`
- **📝 Other**: `requirements`, `tools`, `docs`
- **ℹ️ Info**: `status`, `version`, `help`
- **⚙️ Config**: `config`, `get`, `set`
- **🧹 Maintenance**: `vacuum`, `reset`

**👉 See [Complete CLI Guide](docs/CLI-USAGE.md) for all commands, examples, and workflows**

## 🎯 Usage Examples

### First Time Setup

```
You: "Index my conversation history for this project"

Claude: I'll index all conversations for this project...
✓ Indexed 5 conversations with 2,341 messages
✓ Semantic search enabled (embeddings generated)
```

### Search Past Conversations

```
You: "What did we discuss about the authentication system?"

Claude: Let me search our conversation history...
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

### Find Related Work

```
You: "Have we worked on similar API endpoints before?"

Claude: Let me find similar sessions...
[Returns past conversations about similar work]
```

### View File History

```
You: "Show me how auth.ts evolved over time"

Claude: Let me trace the file evolution...
[Shows complete timeline with conversations, commits, and decisions]
```

## 🔧 Advanced Usage

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

This shows:
- **Indexed folders**: Which conversation folders were used (including legacy if it exists)
- **Database location**: Where your indexed data is stored

### Search with Date Filters

```
You: "What were we working on last week?"
```

### Generate Documentation

```
You: "Generate project documentation from our conversations"
```

Claude will create comprehensive docs combining code analysis with conversation history.

## 📚 Learn More

- **[Tool Examples](docs/TOOL-EXAMPLES.md)** - 50+ natural language examples for each tool
- **[Quick Reference](docs/QUICK-REFERENCE.md)** - Common phrases cheat sheet
- **[Embeddings FAQ](docs/EMBEDDINGS-FAQ.md)** - How semantic search works


## 🐛 Troubleshooting

### "No conversations found"

Make sure you're running this in a directory where you've had Claude Code CLI conversations. Check `~/.claude/projects/` to verify conversation files exist.

### "Embeddings failed"

The MCP falls back to full-text search if embeddings fail. Everything still works, just without semantic search.

### "MCP not responding"

Restart Claude Code CLI to reload the MCP server.

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Inspired by [code-graph-rag-mcp](https://github.com/er77/code-graph-rag-mcp).

---

**Made with ❤️ for the Claude Code CLI community**
