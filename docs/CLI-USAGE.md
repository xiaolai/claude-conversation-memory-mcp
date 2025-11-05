# CLI Usage Guide

Comprehensive guide for using the Claude Conversation Memory CLI.

## Table of Contents

- [Getting Started](#getting-started)
- [Interactive REPL Mode](#interactive-repl-mode)
- [Configuration](#configuration)
- [Common Workflows](#common-workflows)
- [All Commands](#all-commands)
- [Tips & Tricks](#tips--tricks)

---

## Getting Started

### Installation

```bash
npm install -g claude-conversation-memory-mcp
```

### First Run

```bash
# Check installation
claude-conversation-memory-mcp version

# View database status
claude-conversation-memory-mcp status

# Index your conversations
claude-conversation-memory-mcp index
```

---

## Interactive REPL Mode

Start the REPL by running the command without arguments:

```bash
claude-conversation-memory-mcp
```

You'll see:

```
┌─────────────────────────────────────────────────────────┐
│ Claude Conversation Memory v0.1.0                       │
│ Database: ~/.claude/projects/my-project/.claude-...db  │
│ Type 'help' for commands or 'exit' to quit             │
└─────────────────────────────────────────────────────────┘

ccm>
```

### REPL Commands

In REPL mode, just type commands without the program name:

```bash
ccm> status
ccm> search authentication
ccm> mistakes --limit 5
ccm> help search
ccm> exit
```

### REPL Features

- **Tab completion** - Press Tab to auto-complete commands
- **Command history** - Use Up/Down arrows to navigate history
- **Multi-line editing** - Edit complex queries easily
- **Ctrl+C** - Cancel current input (use `exit` to quit)
- **Ctrl+D** - Exit REPL
- **Ctrl+L** - Clear screen (or use `clear` command)

---

## Configuration

### View Current Configuration

```bash
claude-conversation-memory-mcp config
```

Output:
```
=== Embedding Configuration ===

Current (Effective) Configuration:
┌────────────────────┬──────────────────────────────────────┐
│ Key                │ Value                                │
├────────────────────┼──────────────────────────────────────┤
│ Provider           │ ollama                               │
│ Model              │ mxbai-embed-large                    │
│ Dimensions         │ 1024                                 │
│ Base URL           │ http://localhost:11434               │
└────────────────────┴──────────────────────────────────────┘

Configuration Sources:
✓ Home Config: ~/.claude-memory-config.json
  Provider: ollama
  Model: mxbai-embed-large
  Dimensions: 1024
```

### Change Embedding Provider

#### Option 1: Ollama (Best quality, requires local server)

```bash
# Start Ollama service first
ollama serve

# Pull embedding model
ollama pull mxbai-embed-large

# Configure CLI
claude-conversation-memory-mcp set provider ollama
claude-conversation-memory-mcp set model mxbai-embed-large
claude-conversation-memory-mcp set dimensions 1024
```

#### Option 2: Transformers.js (Offline, no setup required)

```bash
claude-conversation-memory-mcp set provider transformers
claude-conversation-memory-mcp set model Xenova/all-MiniLM-L6-v2
claude-conversation-memory-mcp set dimensions 384
```

#### Option 3: OpenAI (Best quality, requires API key)

```bash
export OPENAI_API_KEY=sk-...

claude-conversation-memory-mcp set provider openai
claude-conversation-memory-mcp set model text-embedding-3-small
claude-conversation-memory-mcp set dimensions 1536
```

### Model & Dimension Pairing

The CLI provides smart suggestions when you change models or dimensions:

```bash
$ claude-conversation-memory-mcp set model mxbai-embed-large
✓ Config updated: model = mxbai-embed-large

💡 Tip: This model uses 1024 dimensions
   Run: set dimensions 1024
```

```bash
$ claude-conversation-memory-mcp set dimensions 1024
✓ Config updated: dimensions = 1024

Models with matching dimensions:
  - mxbai-embed-large (ollama) ⭐ default
  - snowflake-arctic-embed (ollama)
```

### Get Individual Config Values

```bash
claude-conversation-memory-mcp get provider    # ollama
claude-conversation-memory-mcp get model       # mxbai-embed-large
claude-conversation-memory-mcp get dimensions  # 1024
```

---

## Common Workflows

### Workflow 1: Initial Setup

```bash
# 1. Check current status
claude-conversation-memory-mcp status

# 2. Configure embedding (optional, has good defaults)
claude-conversation-memory-mcp config

# 3. Index conversations (include MCP conversations for full history)
claude-conversation-memory-mcp index --include-mcp

# 4. Verify indexing worked
claude-conversation-memory-mcp status
# Should show: Conversations: 15, Messages: 4,523
```

### Workflow 2: Before Modifying a File

```bash
# Check what you need to know before editing
claude-conversation-memory-mcp check src/auth.ts

# Output shows:
# - Recent changes to this file
# - Related decisions
# - Past mistakes to avoid
# - Recommendations
```

### Workflow 3: Understanding Past Decisions

```bash
# Find all decisions about authentication
claude-conversation-memory-mcp decisions authentication

# Filter by specific file
claude-conversation-memory-mcp decisions database --file src/db.ts

# See why a specific approach was chosen
claude-conversation-memory-mcp "why did we use JWT?"
```

### Workflow 4: Learning from Mistakes

```bash
# Find all past mistakes
claude-conversation-memory-mcp mistakes async

# Filter by type
claude-conversation-memory-mcp mistakes "null pointer" --type logic_error

# See specific error patterns
claude-conversation-memory-mcp errors "race condition" --limit 3
```

### Workflow 5: Researching a Topic

```bash
# Search conversations
claude-conversation-memory-mcp "search database migration" --limit 5

# Find similar past sessions
claude-conversation-memory-mcp similar "implementing auth system"

# Check tool usage history
claude-conversation-memory-mcp tools --tool Bash --limit 10
```

### Workflow 6: Understanding File Evolution

```bash
# See complete history of a file
claude-conversation-memory-mcp history src/parser.ts

# Exclude git commits, show only conversation edits
claude-conversation-memory-mcp evolution src/index.ts --no-commits

# Check before modifying
claude-conversation-memory-mcp check src/critical-component.ts
```

### Workflow 7: Generating Documentation

```bash
# Generate full project documentation
claude-conversation-memory-mcp docs

# Generate only decision log
claude-conversation-memory-mcp docs --scope decisions

# Generate architecture overview
claude-conversation-memory-mcp generate --scope architecture

# Filter to specific module
claude-conversation-memory-mcp docs --module src/auth
```

### Workflow 8: Maintenance

```bash
# View database stats
claude-conversation-memory-mcp status

# Vacuum database to reclaim space
claude-conversation-memory-mcp vacuum
# Database vacuumed: 23.8MB → 23.6MB

# Re-index everything (clears old data)
claude-conversation-memory-mcp reindex --include-mcp

# Reset database (⚠️ destructive, prompts for confirmation)
claude-conversation-memory-mcp reset
```

---

## All Commands

### 📥 Indexing Commands

#### `index [options]`
Index conversation history for current project.

```bash
# Basic indexing (excludes MCP conversations by default)
claude-conversation-memory-mcp index

# Include all MCP conversations
claude-conversation-memory-mcp index --include-mcp

# Index specific session
claude-conversation-memory-mcp index --session abc123

# Index different project
claude-conversation-memory-mcp index --project /path/to/project

# Include thinking blocks (makes indexing slower)
claude-conversation-memory-mcp index --thinking

# Disable git integration
claude-conversation-memory-mcp index --no-git
```

#### `reindex [options]`
Clear database and re-index all conversations.

```bash
# Reindex everything
claude-conversation-memory-mcp reindex --include-mcp
```

### 🔍 Search Commands

#### `search <query> [options]`
Search conversation history with natural language.

**Alias**: `find`

```bash
# Basic search
claude-conversation-memory-mcp search "authentication implementation"

# Limit results
claude-conversation-memory-mcp search "database schema" --limit 3

# Search with date filter
claude-conversation-memory-mcp search error --after 2025-01-01

# Using alias
claude-conversation-memory-mcp find "API design"
```

#### `decisions <topic> [options]`
Find decisions made about a specific topic.

**Alias**: `why`

```bash
# Find decisions about a topic
claude-conversation-memory-mcp decisions "authentication method"

# Filter by file
claude-conversation-memory-mcp decisions database --file src/db.ts

# Limit results
claude-conversation-memory-mcp decisions API --limit 5

# Using alias
claude-conversation-memory-mcp why "use TypeScript"
```

#### `mistakes <query> [options]`
Search past mistakes to avoid repeating them.

**Alias**: `errors`

```bash
# Find mistakes related to async code
claude-conversation-memory-mcp mistakes async

# Filter by mistake type
claude-conversation-memory-mcp mistakes "type error" --type logic_error
claude-conversation-memory-mcp mistakes timeout --type wrong_approach

# Limit results
claude-conversation-memory-mcp mistakes race --limit 3

# Using alias
claude-conversation-memory-mcp errors "null pointer"
```

Mistake types:
- `logic_error` - Logical bugs and errors
- `wrong_approach` - Incorrect implementation approach
- `misunderstanding` - Misunderstood requirements
- `tool_error` - Tool usage errors
- `syntax_error` - Syntax mistakes

#### `similar <query> [options]`
Find similar conversation sessions.

**Alias**: `related`

```bash
# Find similar sessions
claude-conversation-memory-mcp similar "implementing authentication"

# Limit results
claude-conversation-memory-mcp similar "refactoring database" --limit 3

# Using alias
claude-conversation-memory-mcp related "bug fixing session"
```

### 📋 File Commands

#### `check <file>`
Show context before modifying a file.

```bash
# Check file context
claude-conversation-memory-mcp check src/auth.ts

# Check any file
claude-conversation-memory-mcp check database.ts
```

Shows:
- Recent changes to the file
- Related decisions
- Past mistakes affecting this file
- Recommendations

#### `history <file> [options]`
Show complete file evolution timeline.

**Alias**: `evolution`

```bash
# Full file history
claude-conversation-memory-mcp history src/parser.ts

# Exclude git commits
claude-conversation-memory-mcp history src/index.ts --no-commits

# Exclude decisions
claude-conversation-memory-mcp evolution src/auth.ts --no-decisions
```

### 🔗 Git Commands

#### `commits [query] [options]`
Link git commits to conversations.

**Alias**: `git`

```bash
# List all commits
claude-conversation-memory-mcp commits

# Search commits
claude-conversation-memory-mcp commits "fix parser"

# Filter by conversation
claude-conversation-memory-mcp commits --conversation abc123

# Limit results
claude-conversation-memory-mcp commits --limit 10

# Using alias
claude-conversation-memory-mcp git "add feature"
```

### 📝 Other Commands

#### `requirements <component> [options]`
Get requirements for a component.

**Alias**: `deps`

```bash
# Get all requirements
claude-conversation-memory-mcp requirements authentication

# Filter by type
claude-conversation-memory-mcp requirements database --type performance
claude-conversation-memory-mcp requirements API --type dependency

# Using alias
claude-conversation-memory-mcp deps "auth system" --type compatibility
```

Requirement types:
- `dependency` - Dependencies and libraries required
- `performance` - Performance requirements
- `compatibility` - Compatibility requirements
- `business` - Business requirements

#### `tools [options]`
Query tool usage history.

**Alias**: `history-tools`

```bash
# View all tool usage
claude-conversation-memory-mcp tools

# Filter by tool name
claude-conversation-memory-mcp tools --tool Bash
claude-conversation-memory-mcp tools --tool Edit

# Filter by file
claude-conversation-memory-mcp tools --file src/index.ts

# Limit results
claude-conversation-memory-mcp tools --limit 20
```

#### `docs [options]`
Generate project documentation.

**Alias**: `generate`

```bash
# Generate full documentation
claude-conversation-memory-mcp docs

# Different scopes
claude-conversation-memory-mcp docs --scope architecture
claude-conversation-memory-mcp docs --scope decisions
claude-conversation-memory-mcp docs --scope quality

# Filter to module
claude-conversation-memory-mcp docs --module src/auth

# Using alias
claude-conversation-memory-mcp generate --scope decisions
```

### ℹ️ Info Commands

#### `status`
Show database statistics.

**Alias**: `stats`

```bash
claude-conversation-memory-mcp status
```

#### `version`
Show version information.

```bash
claude-conversation-memory-mcp version
```

#### `info [topic]`
Show information about a topic.

```bash
claude-conversation-memory-mcp info
claude-conversation-memory-mcp info embeddings
claude-conversation-memory-mcp info database
```

#### `help [command]`
Show help information.

**Alias**: `?`

```bash
# Show all commands
claude-conversation-memory-mcp help

# Show command-specific help
claude-conversation-memory-mcp help search
claude-conversation-memory-mcp help index

# Show help for any command
claude-conversation-memory-mcp ? mistakes
```

#### `commands`
List all available commands.

```bash
claude-conversation-memory-mcp commands
```

### ⚙️ Config Commands

#### `config [key] [value]`
Get or set configuration.

```bash
# Show all configuration
claude-conversation-memory-mcp config

# Set a value (shorthand)
claude-conversation-memory-mcp config provider ollama
claude-conversation-memory-mcp config model mxbai-embed-large
```

#### `get <key>`
Get specific configuration value.

```bash
claude-conversation-memory-mcp get provider
claude-conversation-memory-mcp get model
claude-conversation-memory-mcp get dimensions
claude-conversation-memory-mcp get baseUrl
```

#### `set <key> <value>`
Set configuration value.

```bash
# Set provider
claude-conversation-memory-mcp set provider ollama
claude-conversation-memory-mcp set provider transformers
claude-conversation-memory-mcp set provider openai

# Set model
claude-conversation-memory-mcp set model mxbai-embed-large
claude-conversation-memory-mcp set model Xenova/all-MiniLM-L6-v2

# Set dimensions
claude-conversation-memory-mcp set dimensions 1024
claude-conversation-memory-mcp set dimensions 384

# Set Ollama base URL
claude-conversation-memory-mcp set baseUrl http://localhost:11434

# Set OpenAI API key (better to use env var)
claude-conversation-memory-mcp set apiKey sk-...
```

### 🧹 Maintenance Commands

#### `clear`
Clear screen (REPL only).

```bash
ccm> clear
```

#### `vacuum`
Vacuum database to reclaim space.

```bash
claude-conversation-memory-mcp vacuum
# Database vacuumed: 23.8MB → 23.6MB
```

#### `reset`
Reset database (⚠️ **destructive** - deletes all indexed data).

```bash
claude-conversation-memory-mcp reset
# Prompts for confirmation before proceeding
```

### 🚪 Exit Commands

#### `exit`
Exit REPL.

**Aliases**: `quit`, `q`

```bash
ccm> exit
Goodbye!
```

---

## Tips & Tricks

### 1. Use Quotes for Multi-Word Queries

```bash
# Good
claude-conversation-memory-mcp "search database migration strategy"
claude-conversation-memory-mcp decisions "authentication method"

# Also works
claude-conversation-memory-mcp search "API design patterns"
```

### 2. Combine Multiple Filters

```bash
# Search with date range and limit
claude-conversation-memory-mcp search error --after 2025-01-01 --limit 10

# Find mistakes by type
claude-conversation-memory-mcp mistakes async --type logic_error --limit 5

# Filter requirements by type
claude-conversation-memory-mcp requirements database --type performance
```

### 3. Use Shortcuts and Aliases

```bash
# These are equivalent
claude-conversation-memory-mcp search "bug fix"
claude-conversation-memory-mcp find "bug fix"

# These are equivalent
claude-conversation-memory-mcp decisions authentication
claude-conversation-memory-mcp why authentication

# These are equivalent
claude-conversation-memory-mcp mistakes async
claude-conversation-memory-mcp errors async
```

### 4. Check Config Before Indexing

```bash
# Verify your embedding config is optimal
claude-conversation-memory-mcp config

# If using Ollama, make sure it's running
ollama serve

# Then index
claude-conversation-memory-mcp index --include-mcp
```

### 5. Regularly Vacuum Database

```bash
# After heavy usage or re-indexing
claude-conversation-memory-mcp vacuum
```

### 6. Use REPL for Exploration

For interactive exploration, REPL mode is more efficient:

```bash
# Start REPL
claude-conversation-memory-mcp

# Then run multiple commands without prefix
ccm> status
ccm> search auth
ccm> decisions database
ccm> mistakes --limit 3
ccm> exit
```

### 7. Check Help for Any Command

```bash
# Forgot the syntax?
claude-conversation-memory-mcp help search
claude-conversation-memory-mcp help mistakes
claude-conversation-memory-mcp help config
```

### 8. Test Configuration Changes

```bash
# Change config
claude-conversation-memory-mcp set model mxbai-embed-large
claude-conversation-memory-mcp set dimensions 1024

# Verify
claude-conversation-memory-mcp config

# Re-index to use new embeddings
claude-conversation-memory-mcp reindex --include-mcp
```

### 9. Save Config for Different Projects

You can have project-specific configs by creating `.claude-memory-config.json` in your project directory:

```json
{
  "embedding": {
    "provider": "ollama",
    "model": "mxbai-embed-large",
    "dimensions": 1024
  }
}
```

Priority: Environment Variables > Project Config > Home Config > Defaults

### 10. Use Single-Command Mode for Scripting

```bash
#!/bin/bash
# index-all.sh - Index multiple projects

for project in ~/projects/*/; do
  echo "Indexing $project..."
  claude-conversation-memory-mcp index --project "$project" --include-mcp
done
```

---

## Getting More Help

- **CLI Reference**: See [CLI-REFERENCE.md](CLI-REFERENCE.md) for complete command documentation
- **GitHub Issues**: https://github.com/xiaolai/claude-conversation-memory-mcp/issues
- **Main README**: [../README.md](../README.md)

---

**Happy Exploring! 🚀**
