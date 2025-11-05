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
npm install -g @xiaolai/claude-conversation-memory-mcp
```

### Configure Claude Code CLI

Create or edit `~/.claude/config.json`:

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
      "args": ["-y", "@xiaolai/claude-conversation-memory-mcp"]
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
