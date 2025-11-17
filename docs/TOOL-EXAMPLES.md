# MCP Tool Usage Examples

Natural language examples showing how users interact with each tool in Claude Code and Codex.

---

## 📖 Table of Contents

### Per-Project Tools
1. [📥 index_conversations](#1--index_conversations) - Index current project's conversation history
2. [🔍 search_conversations](#2--search_conversations) - Search current project's conversations
3. [🎯 get_decisions](#3--get_decisions) - Get decisions from current project
4. [📋 check_before_modify](#4--check_before_modify) - Check file context before editing
5. [📜 get_file_evolution](#5--get_file_evolution) - Track file changes over time
6. [🔗 link_commits_to_conversations](#6--link_commits_to_conversations) - Link git commits to conversations
7. [⚠️ search_mistakes](#7--search_mistakes) - Find past mistakes in current project
8. [📝 get_requirements](#8--get_requirements) - Get requirements for components
9. [🛠️ get_tool_history](#9--get_tool_history) - Query tool usage history
10. [🔄 find_similar_sessions](#10--find_similar_sessions) - Find similar conversation sessions
11. [📚 generate_documentation](#11--generate_documentation) - Generate comprehensive docs

### Global Cross-Project Tools (NEW in v1.5.0)
12. [🌐 index_all_projects](#12--index_all_projects) - Index all Claude Code + Codex projects
13. [🔎 search_all_conversations](#13--search_all_conversations) - Search across ALL indexed projects
14. [🎯🌐 get_all_decisions](#14--get_all_decisions) - Get decisions from all projects
15. [⚠️🌐 search_all_mistakes](#15--search_all_mistakes) - Search mistakes across all projects

---

# Per-Project Tools

These tools work within the **current project** only. They search and analyze conversation history for the project you're currently working in.

---

## 1. 📥 index_conversations

**What it does**: Indexes your conversation history for the current project

**Scope**: Current project only (Claude Code or Codex)

### Example Conversations:

**User**: "Index my conversation history for this project"
**Claude**: *Uses tool to index all conversations, extracts decisions, mistakes, requirements*

**User**: "Scan my conversations and remember the important stuff"
**Claude**: *Indexes conversations with git integration enabled*

**User**: "Index conversation from session a1172af3-ca62-41be-9b90-701cef39daae"
**Claude**: *Indexes specific conversation session*

**User**: "Rebuild the memory index from scratch"
**Claude**: *Re-indexes all conversations, updating embeddings*

**User**: "Index all conversations, including MCP conversations"
**Claude**: *Indexes with exclude_mcp_conversations=false to include meta-conversations*

**User**: "Index conversations but exclude all MCP tool usage"
**Claude**: *Uses exclude_mcp_conversations='all-mcp' to get only pure conversations*

**User**: "Index conversations but exclude code-graph-rag"
**Claude**: *Uses exclude_mcp_servers=['code-graph-rag'] for granular filtering*

**Note**: By default, conversations using the conversation-memory MCP are automatically excluded to prevent self-referential loops. Use `exclude_mcp_conversations=false` to override.

---

## 2. 🔍 search_conversations

**What it does**: Semantic search through the current project's conversation history

**Scope**: Current project only

### Example Conversations:

**User**: "What did we discuss about the embedding system?"
**Claude**: "Let me search our conversation history..."
*Searches for 'embedding system', finds 5 relevant conversations*

**User**: "When did we fix that authentication bug?"
**Claude**: *Searches 'authentication bug', returns conversations with snippets*

**User**: "Find conversations where we talked about database optimization"
**Claude**: *Semantic search finds related discussions even without exact keywords*

**User**: "What were we working on last week?"
**Claude**: *Searches with date range filter for recent conversations*

**User**: "Show me all conversations about TypeScript linting errors"
**Claude**: *Returns relevant conversations with context snippets*

**Note**: To search across ALL your projects (not just this one), use [search_all_conversations](#13--search_all_conversations) instead.

---

## 3. 🎯 get_decisions

**What it does**: Retrieves architectural and technical decisions from current project

**Scope**: Current project only

### Example Conversations:

**User**: "What decisions did we make about the embedding system?"
**Claude**: "Let me check the decision history..."
*Returns: "Use Ollama as primary provider with Transformers.js fallback. Rationale: Balance between quality and ease of use"*

**User**: "Why did we choose SQLite over PostgreSQL?"
**Claude**: *Retrieves decision with alternatives considered and rejected reasons*

**User**: "What did we decide about the API authentication approach?"
**Claude**: *Finds decisions related to authentication, shows full context*

**User**: "Show me all decisions made in the last 3 conversations"
**Claude**: *Filters decisions by recent sessions*

**User**: "What were the rejected alternatives for vector storage?"
**Claude**: *Shows decision with alternatives_considered and why they were rejected*

**Note**: To search decisions across ALL projects, use [get_all_decisions](#14--get_all_decisions) instead.

---

## 4. 📋 check_before_modify

**What it does**: Shows context before modifying a file - recent changes, decisions, mistakes

**Scope**: Current project only

### Example Conversations:

**User**: "I want to refactor src/embeddings/EmbeddingGenerator.ts"
**Claude**: "Let me check the context for this file first..."
*Shows: 3 recent changes, 2 related decisions, 1 past mistake to avoid*

**User**: "Before I change the database schema, what should I know?"
**Claude**: *Retrieves file history, related decisions, warns about previous mistakes*

**User**: "I'm going to modify the authentication middleware"
**Claude**: "Let me check what we learned about this file..."
*Shows recent commits, related requirements, past bugs*

**User**: "What's the history on package.json?"
**Claude**: *Shows evolution: dependencies added, version bumps, related decisions*

**User**: "Should I be careful about anything in this file?"
**Claude**: *Highlights past mistakes and important decisions about the file*

---

## 5. 📜 get_file_evolution

**What it does**: Complete timeline of how a file changed - edits, commits, decisions

**Scope**: Current project only

### Example Conversations:

**User**: "Show me the complete history of README.md"
**Claude**: *Returns timeline with 12 events: commits, edits, related decisions*

**User**: "How did package.json evolve over time?"
**Claude**: *Shows chronological timeline: dependency additions, version changes*

**User**: "What's the story behind this configuration file?"
**Claude**: *Timeline shows: creation, modifications, why changes were made*

**User**: "When did we last change the database schema?"
**Claude**: *Shows most recent events for schema.sql with timestamps*

**User**: "Track all changes to the authentication module"
**Claude**: *Complete evolution including related commits and decisions*

---

## 6. 🔗 link_commits_to_conversations

**What it does**: Shows git commits and which conversations they came from

**Scope**: Current project only

### Example Conversations:

**User**: "Which commits were made during our bug fixing session?"
**Claude**: *Links commits to conversations, shows 8 commits with confidence scores*

**User**: "Show me all commits related to the embedding system"
**Claude**: *Searches commits for 'embedding', returns linked conversations*

**User**: "What did we commit in the last 5 commits?"
**Claude**: *Shows recent commits with their conversation context*

**User**: "Which conversation led to commit abc123?"
**Claude**: *Finds conversation that produced that specific commit*

**User**: "Show me commits from yesterday's work session"
**Claude**: *Filters by date, shows commits with conversation links*

---

## 7. ⚠️ search_mistakes

**What it does**: Finds past mistakes to help you avoid repeating them

**Scope**: Current project only

### Example Conversations:

**User**: "Have we made any mistakes with path handling before?"
**Claude**: "Yes, let me check our mistake history..."
*Returns: "Path sanitization bug - used double dash instead of single dash"*

**User**: "What bugs did we encounter with the database?"
**Claude**: *Shows 3 past mistakes: foreign key constraint errors, schema mismatches*

**User**: "Show me all TypeScript type errors we've made"
**Claude**: *Filters mistakes by type: syntax_error, shows what went wrong and how it was fixed*

**User**: "What should I avoid when working with embeddings?"
**Claude**: *Retrieves embedding-related mistakes and their corrections*

**User**: "Have we seen this error before?"
**Claude**: *Searches mistake history for similar error patterns*

**Note**: To search mistakes across ALL your projects, use [search_all_mistakes](#15--search_all_mistakes) instead.

---

## 8. 📝 get_requirements

**What it does**: Retrieves documented requirements for components and features

**Scope**: Current project only

### Example Conversations:

**User**: "What are the requirements for the embedding system?"
**Claude**: *Returns: dependency requirements, performance targets, compatibility needs*

**User**: "Show me all performance requirements"
**Claude**: *Filters by type: performance, lists all documented performance goals*

**User**: "What does the authentication module require?"
**Claude**: *Shows: security requirements, API dependencies, business rules*

**User**: "What are the constraints for the vector store?"
**Claude**: *Returns: sqlite-vec dependency, dimension limits, storage requirements*

**User**: "Show me all dependencies we need to install"
**Claude**: *Filters by type: dependency, lists required packages*

---

## 9. 🛠️ get_tool_history

**What it does**: Shows history of tool usage (Edit, Bash, Read, etc.) with pagination, filtering, and content control

**Scope**: Current project only

### New Features:
- **Pagination**: Use `offset` + `limit` to fetch results in pages
- **Content Control**: Use `include_content=false` for metadata-only, or set `max_content_length` to truncate large outputs
- **Smart Filtering**: Filter by date range, conversation, or errors only
- **Response Size Management**: Keeps responses under token limits for AI consumption

### Example Conversations:

**User**: "Show me all the files we edited recently"
**Claude**: *Queries tool_history for Edit operations, shows 10 recent edits*
```typescript
await get_tool_history({ tool_name: 'Edit', limit: 10 })
```

**User**: "What bash commands did we run in the last session?"
**Claude**: *Filters by tool_name: Bash, shows command history with outputs*
```typescript
await get_tool_history({
  tool_name: 'Bash',
  conversation_id: 'current-session-id',
  limit: 20
})
```

**User**: "Show me just the names of the last 50 tools we used, no content"
**Claude**: *Uses summary mode for quick overview*
```typescript
await get_tool_history({
  limit: 50,
  include_content: false  // Metadata only - tool names, timestamps, success/failure
})
```

**User**: "Find all errors from the last 24 hours"
**Claude**: *Filters by errors and date range*
```typescript
const oneDayAgo = Date.now() - 86400000;
await get_tool_history({
  errors_only: true,
  date_range: [oneDayAgo, Date.now()],
  limit: 20
})
```

**User**: "Show me the next page of results"
**Claude**: *Uses pagination to get second page*
```typescript
// First page
const page1 = await get_tool_history({ limit: 20, offset: 0 });
// Second page
const page2 = await get_tool_history({ limit: 20, offset: 20 });
// Check if more pages exist
if (page1.has_more) {
  console.log(`${page1.total_in_database} total results available`);
}
```

**User**: "What changes did we make to the database schema?"
**Claude**: *Shows Edit operations on schema.sql file with truncated content*
```typescript
await get_tool_history({
  tool_name: 'Edit',
  file_path: 'schema.sql',
  max_content_length: 500,  // Truncate large file contents
  limit: 10
})
```

### Response Format:
```json
{
  "tool_uses": [...],
  "total_found": 20,           // Results in this page
  "total_in_database": 156,    // Total matching records
  "has_more": true,            // More pages available
  "offset": 0                  // Current page offset
}
```

### Pro Tips:
- Use `include_content=false` when you need to scan many tools quickly (e.g., finding which files were edited)
- Set `max_content_length` to control response size (default: 500 characters)
- Use `date_range` to limit scope before fetching (reduces noise)
- Check `has_more` and `total_in_database` to know if you need pagination
- Combine filters for precise queries (e.g., errors in specific conversation from yesterday)

---

## 10. 🔄 find_similar_sessions

**What it does**: Finds past conversation sessions that dealt with similar topics

**Scope**: Current project only

### Example Conversations:

**User**: "Have we worked on similar bug fixes before?"
**Claude**: "Let me find similar sessions..."
*Returns: 3 sessions about debugging and fixing errors*

**User**: "Find sessions where we set up configuration systems"
**Claude**: *Semantic search finds related sessions about config management*

**User**: "Show me when we did refactoring work like this"
**Claude**: *Finds sessions with similar refactoring patterns*

**User**: "Have we dealt with this type of problem before?"
**Claude**: *Searches for sessions with similar challenges*

**User**: "Find conversations about implementing new features"
**Claude**: *Returns sessions tagged with feature development*

---

## 11. 📚 generate_documentation

**What it does**: Generates comprehensive documentation combining code structure + conversation context

**Scope**: Current project only

### Example Conversations:

**User**: "Generate documentation for this project"
**Claude**: "Creating comprehensive documentation..."
*Combines codebase analysis with conversation decisions and lessons learned*

**User**: "Create architecture documentation"
**Claude**: *Scope: architecture, documents modules, relationships, design decisions*

**User**: "Generate a decision log for this project"
**Claude**: *Scope: decisions, creates chronological list of all technical decisions*

**User**: "Document all the mistakes and lessons learned"
**Claude**: *Scope: quality, generates report of issues found and how they were fixed*

**User**: "Create full documentation for the embedding module"
**Claude**: *Filters by module: src/embeddings, documents that subsystem*

---

---

# 🌐 Global Cross-Project Tools

**NEW in v1.5.0**: These tools search across **ALL your indexed projects**, including both Claude Code CLI and Codex conversations.

### What's Different?

| Feature | Per-Project Tools | Global Tools |
|---------|------------------|--------------|
| **Scope** | Current project only | All indexed projects |
| **Sources** | Claude Code OR Codex | Claude Code AND Codex |
| **Use Case** | "What did we decide in THIS project?" | "Have I solved this before ANYWHERE?" |
| **Performance** | Fast (single database) | Moderate (queries multiple databases) |

---

## 12. 🌐 index_all_projects

**What it does**: Index all Claude Code projects and Codex sessions in one operation

**Scope**: Global - creates a registry of all projects

### How It Works:

1. **Scans** `~/.claude/projects/` for all Claude Code projects
2. **Scans** `~/.codex/sessions/` for all Codex sessions
3. **Creates** a global registry at `~/.claude/.claude-global-index.db`
4. **Tracks** metadata: project paths, database locations, message counts, source types

### Example Conversations:

**User**: "Index all my projects globally"
**Claude**: *Scans both Claude Code and Codex, creates global registry*
```typescript
await index_all_projects({
  include_claude_code: true,
  include_codex: true
})
```

**Response**:
```json
{
  "success": true,
  "global_index_path": "/Users/you/.claude/.claude-global-index.db",
  "projects_indexed": 12,
  "claude_code_projects": 8,
  "codex_projects": 4,
  "total_messages": 3456,
  "total_conversations": 234,
  "errors": []
}
```

**User**: "Index only my Claude Code projects"
**Claude**: *Skips Codex, indexes Claude Code projects only*
```typescript
await index_all_projects({
  include_claude_code: true,
  include_codex: false
})
```

**User**: "Index only my Codex sessions"
**Claude**: *Skips Claude Code, indexes Codex only*
```typescript
await index_all_projects({
  include_claude_code: false,
  include_codex: true
})
```

**User**: "Rebuild my global index from scratch"
**Claude**: *Re-scans all projects and updates global registry*

### When to Use:

✅ **First time setup** - After installing the MCP
✅ **After creating new projects** - Update the global registry
✅ **After working with Codex** - Ensure Codex sessions are indexed
✅ **Periodic refresh** - Weekly/monthly to keep registry fresh

### Notes:

- Each project keeps its own database (per-project isolation)
- Global index is just a **registry** that links to project databases
- Re-running is safe - it updates existing entries
- Projects without conversations are still registered (message_count: 0)

---

## 13. 🔎 search_all_conversations

**What it does**: Semantic search across ALL indexed projects (Claude Code + Codex)

**Scope**: Global - searches every project in the registry

### How It Works:

1. **Queries** the global registry for all indexed projects
2. **Opens** each project's database (read-only)
3. **Searches** each project's conversations using semantic search
4. **Merges** results from all projects with similarity scores
5. **Enriches** results with project metadata (project_path, source_type)

### Example Conversations:

**User**: "Search all my conversations for 'authentication bug fixes'"
**Claude**: *Searches across 12 projects, finds 8 relevant conversations*
```typescript
await search_all_conversations({
  query: "authentication bug fixes",
  limit: 10
})
```

**Response**:
```json
{
  "query": "authentication bug fixes",
  "results": [
    {
      "conversation_id": "abc123",
      "message_id": "msg456",
      "timestamp": "2025-01-15T10:30:00.000Z",
      "similarity": 0.89,
      "snippet": "Fixed JWT token validation bug...",
      "git_branch": "main",
      "message_type": "assistant",
      "role": "assistant",
      "project_path": "/Users/you/projects/api-server",
      "source_type": "claude-code"
    },
    {
      "conversation_id": "xyz789",
      "message_id": "msg012",
      "timestamp": "2025-01-10T14:20:00.000Z",
      "similarity": 0.85,
      "snippet": "Implemented OAuth2 authentication...",
      "git_branch": "feature/oauth",
      "message_type": "user",
      "role": "user",
      "project_path": "/Users/you/.codex",
      "source_type": "codex"
    }
  ],
  "total_found": 8,
  "projects_searched": 12,
  "claude_code_projects": 8,
  "codex_projects": 4
}
```

**User**: "Find all conversations about React hooks from the last month"
**Claude**: *Searches with date range filter*
```typescript
const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
await search_all_conversations({
  query: "React hooks",
  limit: 20,
  date_range: [oneMonthAgo, Date.now()]
})
```

**User**: "Have I ever worked with WebSockets before?"
**Claude**: *Semantic search across all projects finds WebSocket-related conversations*
```typescript
await search_all_conversations({
  query: "WebSocket implementation real-time communication",
  limit: 10
})
```

**User**: "Show me all conversations where I discussed database migrations"
**Claude**: *Searches all projects, returns top 15 matches*
```typescript
await search_all_conversations({
  query: "database migrations schema changes",
  limit: 15
})
```

### When to Use:

✅ **Cross-project learning** - "Have I solved this before?"
✅ **Finding past solutions** - "How did I implement X last time?"
✅ **Discovering patterns** - "Where have I used this approach?"
✅ **Knowledge transfer** - "Did I learn about this in another project?"
✅ **Historical context** - "When did I last work on similar features?"

### Pro Tips:

- Results include `source_type` - see if it's from Claude Code or Codex
- Results include `project_path` - know which project the conversation is from
- Use specific queries - "JWT token validation" vs "authentication"
- Filter by date to focus on recent work
- Similarity scores help rank relevance (higher = more relevant)

---

## 14. 🎯🌐 get_all_decisions

**What it does**: Retrieves architectural and technical decisions from ALL indexed projects

**Scope**: Global - searches decisions across all projects

**Status**: ⚠️ **STUB IMPLEMENTATION** (Coming Soon)

### Planned Functionality:

When fully implemented, this tool will:

1. **Query** all project databases for decision records
2. **Filter** by topic, file path, or decision type
3. **Merge** decisions from Claude Code and Codex projects
4. **Rank** by relevance to your query
5. **Show** full decision context (rationale, alternatives, rejected approaches)

### Example Use Cases (Planned):

**User**: "What decisions have I made about database design across all projects?"
**Claude**: *Would search all projects for database-related decisions*
```typescript
// Planned API
await get_all_decisions({
  query: "database design schema architecture",
  limit: 15
})
```

**Expected Response**:
```json
{
  "query": "database design schema architecture",
  "decisions": [
    {
      "decision_id": "dec123",
      "conversation_id": "abc456",
      "timestamp": "2025-01-10T10:00:00.000Z",
      "decision_type": "architecture",
      "topic": "Database schema design",
      "decision": "Use PostgreSQL with JSONB for flexible data",
      "rationale": "Need flexible schema with relational guarantees",
      "alternatives_considered": ["MongoDB", "DynamoDB"],
      "rejected_reasons": "MongoDB lacks transactions, DynamoDB vendor lock-in",
      "project_path": "/Users/you/projects/api-server",
      "source_type": "claude-code"
    }
  ],
  "total_found": 8,
  "projects_searched": 12
}
```

**User**: "Show me all decisions about authentication from any project"
**Claude**: *Would search all projects for authentication decisions*

**User**: "What have I decided about testing strategies?"
**Claude**: *Would find test-related decisions across all work*

### Current Behavior:

Returns a stub response:
```json
{
  "query": "your query",
  "decisions": [],
  "total_found": 0,
  "projects_searched": 12,
  "message": "Cross-project decision search not yet implemented. Currently shows decisions from current project only. Use get_decisions() for per-project decision retrieval."
}
```

### Implementation Status:

- ✅ Global index system (completed)
- ✅ Cross-project search infrastructure (completed)
- ⏳ Decision extraction across projects (planned)
- ⏳ Decision merging and ranking (planned)

---

## 15. ⚠️🌐 search_all_mistakes

**What it does**: Search for past mistakes across ALL indexed projects

**Scope**: Global - finds mistakes from all projects to avoid repeating them

**Status**: ⚠️ **STUB IMPLEMENTATION** (Coming Soon)

### Planned Functionality:

When fully implemented, this tool will:

1. **Query** all project databases for mistake records
2. **Search** semantically for similar error patterns
3. **Filter** by mistake type (logic_error, wrong_approach, etc.)
4. **Show** what went wrong and how it was corrected
5. **Prevent** repeating mistakes from other projects

### Example Use Cases (Planned):

**User**: "Have I made mistakes with async/await in any project?"
**Claude**: *Would search all projects for async-related mistakes*
```typescript
// Planned API
await search_all_mistakes({
  query: "async await promise handling",
  limit: 10
})
```

**Expected Response**:
```json
{
  "query": "async await promise handling",
  "mistakes": [
    {
      "mistake_id": "mst123",
      "conversation_id": "abc456",
      "timestamp": "2024-12-15T14:30:00.000Z",
      "mistake_type": "logic_error",
      "description": "Forgot to await database query in transaction",
      "what_went_wrong": "Transaction committed before query completed",
      "correction": "Added await keyword before query execution",
      "file_path": "src/db/transactions.ts",
      "project_path": "/Users/you/projects/api-server",
      "source_type": "claude-code"
    }
  ],
  "total_found": 5,
  "projects_searched": 12
}
```

**User**: "Show me all TypeScript type errors I've made anywhere"
**Claude**: *Would search all projects, filter by mistake_type: syntax_error*
```typescript
await search_all_mistakes({
  query: "TypeScript type errors",
  mistake_type: "syntax_error",
  limit: 15
})
```

**User**: "What mistakes have I made with React hooks?"
**Claude**: *Would find React hook mistakes across all projects*

**User**: "Have I encountered this error message before in any project?"
**Claude**: *Would search mistake descriptions semantically*

### Current Behavior:

Returns a stub response:
```json
{
  "query": "your query",
  "mistakes": [],
  "total_found": 0,
  "projects_searched": 12,
  "message": "Cross-project mistake search not yet implemented. Currently shows mistakes from current project only. Use search_mistakes() for per-project mistake retrieval."
}
```

### Implementation Status:

- ✅ Global index system (completed)
- ✅ Cross-project search infrastructure (completed)
- ⏳ Mistake extraction across projects (planned)
- ⏳ Mistake similarity search (planned)

---

---

# Combined Usage Examples

## Per-Project Scenarios

### Scenario 1: Starting New Feature (Single Project)

**User**: "I want to add a new caching layer. Have we done anything similar before?"

**Claude**:
1. *Uses find_similar_sessions* - "We worked on Redis integration 3 weeks ago"
2. *Uses get_decisions* - "Decided against in-memory cache due to multi-process requirements"
3. *Uses search_mistakes* - "Watch out: we had cache invalidation bugs before"

---

### Scenario 2: Debugging (Single Project)

**User**: "The vector search is failing. What do I need to know?"

**Claude**:
1. *Uses check_before_modify* on VectorStore.ts - Shows recent changes
2. *Uses search_mistakes* - "We had dimension mismatch errors before"
3. *Uses get_decisions* - "We use dynamic dimensions - ensure tables match"
4. *Uses get_file_evolution* - Shows when vector search was last working

---

### Scenario 3: Code Review (Single Project)

**User**: "Review the changes I'm about to commit"

**Claude**:
1. *Uses check_before_modify* - Checks all modified files for context
2. *Uses get_requirements* - Verifies requirements are met
3. *Uses search_mistakes* - Checks for similar past errors
4. *Uses get_decisions* - Ensures changes align with architectural decisions

---

### Scenario 4: Onboarding (Single Project)

**User**: "Explain how this project works"

**Claude**:
1. *Uses generate_documentation* - Creates full architecture overview
2. *Uses get_decisions* - Shows key technical choices and why
3. *Uses get_file_evolution* - Highlights important files and their history
4. *Uses search_mistakes* - Documents lessons learned

---

## Global Cross-Project Scenarios

### Scenario 5: Global Learning (Multi-Project)

**User**: "Have I ever implemented authentication before? I need to add it to this new project."

**Claude**:
1. *Uses search_all_conversations* - Searches all projects for "authentication implementation"
2. **Finds**:
   - OAuth2 implementation in api-server (Claude Code, 3 months ago)
   - JWT authentication in mobile-backend (Codex, 6 months ago)
3. *Uses get_all_decisions* (when implemented) - "Decided on JWT for stateless auth in mobile-backend"
4. *Uses search_all_mistakes* (when implemented) - "Watch out: forgot to validate token expiry in api-server"

**Result**: User learns from 2 previous projects across both Claude Code and Codex

---

### Scenario 6: Cross-Project Pattern Discovery (Multi-Project)

**User**: "I'm implementing WebSocket real-time updates. How have I done this before?"

**Claude**:
1. *Uses search_all_conversations*:
   ```typescript
   await search_all_conversations({
     query: "WebSocket real-time updates socket.io",
     limit: 10
   })
   ```
2. **Finds**:
   - Chat application (Claude Code, chat-app project, 2 months ago)
   - Live dashboard (Codex, dashboard project, 4 months ago)
3. **Shows**: Code snippets, architectural decisions, performance optimizations

**Result**: User discovers patterns from 2 different implementations

---

### Scenario 7: Avoiding Past Mistakes Globally (Multi-Project)

**User**: "I'm about to use async/await with database transactions. Have I made mistakes with this before?"

**Claude**:
1. *Uses search_all_mistakes* (when implemented):
   ```typescript
   await search_all_mistakes({
     query: "async await database transaction",
     mistake_type: "logic_error",
     limit: 5
   })
   ```
2. **Finds**:
   - api-server: Forgot to await in transaction (caused race condition)
   - e-commerce: Used nested transactions incorrectly (deadlock)
3. **Shows**: What went wrong, how it was corrected

**Result**: User avoids repeating mistakes from 2 previous projects

---

### Scenario 8: Technology Decision Research (Multi-Project)

**User**: "Should I use PostgreSQL or MongoDB for this new project? What have I decided before?"

**Claude**:
1. *Uses get_all_decisions* (when implemented):
   ```typescript
   await get_all_decisions({
     query: "database choice PostgreSQL MongoDB",
     limit: 10
   })
   ```
2. **Finds**:
   - api-server: Chose PostgreSQL (needed ACID, complex queries)
   - content-platform: Chose MongoDB (flexible schema, rapid iteration)
3. **Shows**: Rationale, alternatives considered, rejected reasons

**Result**: User makes informed decision based on past experience

---

### Scenario 9: First-Time Setup (Hybrid Workflow)

**User**: "I just installed the MCP. What do I need to do?"

**Claude**:
1. *Suggests*: "Let me index all your existing work first"
2. *Uses index_all_projects*:
   ```typescript
   await index_all_projects({
     include_claude_code: true,
     include_codex: true
   })
   ```
3. **Result**:
   - 8 Claude Code projects indexed
   - 4 Codex sessions indexed
   - Global registry created at `~/.claude/.claude-global-index.db`
   - Ready for cross-project search

**User**: "Now search all my work for 'database migrations'"

**Claude**:
4. *Uses search_all_conversations*:
   ```typescript
   await search_all_conversations({
     query: "database migration schema changes",
     limit: 10
   })
   ```
5. **Finds**: 6 conversations across 3 projects (2 Claude Code, 1 Codex)

**Result**: User can now leverage ALL their past work across both platforms

---

### Scenario 10: Periodic Refresh (Maintenance)

**User**: "I've been working with Codex all week. Update my global index."

**Claude**:
1. *Uses index_all_projects*:
   ```typescript
   await index_all_projects({
     include_claude_code: true,
     include_codex: true
   })
   ```
2. **Result**:
   - 8 Claude Code projects (unchanged)
   - 4 Codex sessions → **6 Codex sessions** (2 new sessions added)
   - Total messages: 3456 → 3678 (+222 new messages)

**Result**: Global index now includes this week's Codex work

---

## Hybrid Workflow Examples

### Example 1: Claude Code → Codex Knowledge Transfer

**Scenario**: You implemented a feature in Claude Code 2 months ago. Now you're working in Codex on a similar feature.

**Workflow**:
1. Working in Codex on new project
2. Ask: "Have I built a pagination system before?"
3. Claude uses `search_all_conversations`
4. **Finds**: Pagination implementation in Claude Code project from 2 months ago
5. **Transfers knowledge**: Shows code approach, decisions, mistakes to avoid

**Result**: Codex session benefits from Claude Code history

---

### Example 2: Codex → Claude Code Knowledge Transfer

**Scenario**: You solved a tricky bug in Codex last month. Now you encounter similar bug in Claude Code.

**Workflow**:
1. Working in Claude Code, encounter bug
2. Ask: "Have I seen this error message before?"
3. Claude uses `search_all_mistakes` (when implemented)
4. **Finds**: Similar bug in Codex session from last month
5. **Shows**: How it was debugged and fixed

**Result**: Claude Code session benefits from Codex history

---

### Example 3: Unified Decision Making

**Scenario**: You need to make an architectural decision. Want to see what you've decided in ALL past projects.

**Workflow**:
1. Ask: "What have I decided about state management in React?"
2. Claude uses `get_all_decisions` (when implemented)
3. **Finds**:
   - Claude Code project A: Chose Redux (large app, complex state)
   - Codex session B: Chose Context API (small app, simple state)
   - Claude Code project C: Chose Zustand (medium app, good DX)
4. **Shows**: Rationale for each choice, project characteristics

**Result**: Make informed decision based on complete history across both platforms

---

---

# Tips for Users

## Best Practices

### Per-Project Tools

✅ **Do**: Use natural language - "What did we decide about X?"
✅ **Do**: Ask follow-up questions - "Show me more details"
✅ **Do**: Combine tools - "Check file history and related decisions"
✅ **Do**: Be specific - "Mistakes with SQL schema" vs just "mistakes"

❌ **Don't**: Try to use tool names directly (Claude handles that)
❌ **Don't**: Worry about exact keywords (semantic search works)
❌ **Don't**: Repeat indexing unnecessarily (auto-indexed on changes)

### Global Tools (NEW)

✅ **Do**: Use global search when starting new work - "Have I done this before?"
✅ **Do**: Index all projects first - Run `index_all_projects` after installation
✅ **Do**: Refresh periodically - Re-run `index_all_projects` weekly/monthly
✅ **Do**: Check `source_type` in results - Know if it's Claude Code or Codex
✅ **Do**: Use date filters for recent work - `date_range` parameter

❌ **Don't**: Expect instant results - Global search queries multiple databases
❌ **Don't**: Forget to index new projects - Run `index_all_projects` after creating projects
❌ **Don't**: Mix per-project and global - Know which scope you need

---

## Common Patterns

### Before Modifying Code (Per-Project)
```
"Before I change [file], what should I know?"
→ Claude uses: check_before_modify, get_decisions, search_mistakes
```

### Understanding History (Per-Project)
```
"How did we get here with [feature]?"
→ Claude uses: get_file_evolution, link_commits_to_conversations, search_conversations
```

### Avoiding Mistakes (Per-Project)
```
"Have we seen [error] before?"
→ Claude uses: search_mistakes, search_conversations, get_file_evolution
```

### Starting New Work (Per-Project)
```
"I want to implement [feature], what do I need to know?"
→ Claude uses: find_similar_sessions, get_requirements, get_decisions
```

### Global Learning (Multi-Project) 🌐 NEW
```
"Have I ever implemented [feature] in ANY project?"
→ Claude uses: search_all_conversations, get_all_decisions, search_all_mistakes
```

### Cross-Platform Knowledge Transfer (Multi-Project) 🌐 NEW
```
"Show me how I've solved [problem] across all my work"
→ Claude uses: search_all_conversations (searches both Claude Code and Codex)
```

### Global Setup (First-Time) 🌐 NEW
```
"Index all my projects"
→ Claude uses: index_all_projects (creates global registry)
```

### Periodic Maintenance (Multi-Project) 🌐 NEW
```
"Update my global index with recent work"
→ Claude uses: index_all_projects (refreshes registry)
```

---

## When to Use Which Scope

### Use Per-Project Tools When:
- ✅ Working within a single project
- ✅ Need fast, focused results
- ✅ File-specific context (check_before_modify, get_file_evolution)
- ✅ Project-specific requirements and decisions

### Use Global Tools When:
- 🌐 Starting a new feature you might have built before
- 🌐 Learning from past work across multiple projects
- 🌐 Discovering patterns and best practices
- 🌐 Avoiding mistakes you made elsewhere
- 🌐 Making architectural decisions informed by past choices
- 🌐 Transferring knowledge from Claude Code to Codex (or vice versa)

---

## Performance Tips

### Per-Project Search
- ⚡ **Fast** - Single database query
- ⚡ **Low latency** - Milliseconds
- ⚡ **Use for**: Real-time assistance during coding

### Global Search
- 🐢 **Moderate** - Queries multiple databases
- 🐢 **Higher latency** - Seconds (depends on number of projects)
- 🐢 **Use for**: Research, learning, decision-making

### Optimization Tips
- Index only what you need (set `include_claude_code` / `include_codex` appropriately)
- Use date filters to narrow scope (`date_range` parameter)
- Limit results (`limit` parameter) - don't fetch more than you need
- Run `index_all_projects` during downtime (not mid-coding session)

---

## Architecture Understanding

### Hybrid Database Design

```
Per-Project Databases:
~/.claude/projects/my-project/.db              ← Claude Code project
~/.claude/projects/another-project/.db         ← Another Claude Code project
~/.codex/.codex-conversations-memory.db        ← All Codex sessions

Global Registry:
~/.claude/.claude-global-index.db              ← Links to all project databases
```

### Data Flow

**Per-Project Search** (`search_conversations`):
```
User Query
    ↓
Current Project DB
    ↓
Results (single source)
```

**Global Search** (`search_all_conversations`):
```
User Query
    ↓
Global Registry (gets list of all projects)
    ↓
Open each project DB (read-only)
    ↓
Query each DB in parallel
    ↓
Merge results from all projects
    ↓
Enriched results (multiple sources with metadata)
```

---

**Pro Tip**: Just talk naturally to Claude! The MCP tools work automatically in the background to provide context-aware assistance using your conversation history - from your current project, or from ALL your projects across both Claude Code and Codex.

---

**Questions?** Check the [README](../README.md) for installation and setup, or the [QUICK-REFERENCE](./QUICK-REFERENCE.md) for a concise tool list.
