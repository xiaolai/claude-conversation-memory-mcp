# MCP Tool Usage Examples

Natural language examples showing how users interact with each tool in Claude Code.

---

## 1. 📥 index_conversations

**What it does**: Indexes your conversation history for searching and analysis

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

**What it does**: Semantic search through your conversation history

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

---

## 3. 🎯 get_decisions

**What it does**: Retrieves architectural and technical decisions with rationale

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

---

## 4. 📋 check_before_modify

**What it does**: Shows context before modifying a file - recent changes, decisions, mistakes

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

---

## 8. 📝 get_requirements

**What it does**: Retrieves documented requirements for components and features

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

**What it does**: Shows history of tool usage (Edit, Bash, Read, etc.)

### Example Conversations:

**User**: "Show me all the files we edited recently"
**Claude**: *Queries tool_history for Edit operations, shows 10 recent edits*

**User**: "What bash commands did we run in the last session?"
**Claude**: *Filters by tool_name: Bash, shows command history with outputs*

**User**: "Which files have we been reading the most?"
**Claude**: *Analyzes Read tool usage, shows most-accessed files*

**User**: "Show me the last 20 git commands we ran"
**Claude**: *Filters Bash history for git commands*

**User**: "What changes did we make to the database schema?"
**Claude**: *Shows Edit operations on schema.sql file*

---

## 10. 🔄 find_similar_sessions

**What it does**: Finds past conversation sessions that dealt with similar topics

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

## Combined Usage Examples

### Scenario 1: Starting New Feature

**User**: "I want to add a new caching layer. Have we done anything similar before?"

**Claude**:
1. *Uses find_similar_sessions* - "We worked on Redis integration 3 weeks ago"
2. *Uses get_decisions* - "Decided against in-memory cache due to multi-process requirements"
3. *Uses search_mistakes* - "Watch out: we had cache invalidation bugs before"

---

### Scenario 2: Debugging

**User**: "The vector search is failing. What do I need to know?"

**Claude**:
1. *Uses check_before_modify* on VectorStore.ts - Shows recent changes
2. *Uses search_mistakes* - "We had dimension mismatch errors before"
3. *Uses get_decisions* - "We use dynamic dimensions - ensure tables match"
4. *Uses get_file_evolution* - Shows when vector search was last working

---

### Scenario 3: Code Review

**User**: "Review the changes I'm about to commit"

**Claude**:
1. *Uses check_before_modify* - Checks all modified files for context
2. *Uses get_requirements* - Verifies requirements are met
3. *Uses search_mistakes* - Checks for similar past errors
4. *Uses get_decisions* - Ensures changes align with architectural decisions

---

### Scenario 4: Onboarding

**User**: "Explain how this project works"

**Claude**:
1. *Uses generate_documentation* - Creates full architecture overview
2. *Uses get_decisions* - Shows key technical choices and why
3. *Uses get_file_evolution* - Highlights important files and their history
4. *Uses search_mistakes* - Documents lessons learned

---

## Tips for Users

### Best Practices

✅ **Do**: Use natural language - "What did we decide about X?"
✅ **Do**: Ask follow-up questions - "Show me more details"
✅ **Do**: Combine tools - "Check file history and related decisions"
✅ **Do**: Be specific - "Mistakes with SQL schema" vs just "mistakes"

❌ **Don't**: Try to use tool names directly (Claude handles that)
❌ **Don't**: Worry about exact keywords (semantic search works)
❌ **Don't**: Repeat indexing unnecessarily (auto-indexed on changes)

### Common Patterns

**Before Modifying Code**:
```
"Before I change [file], what should I know?"
→ Claude uses: check_before_modify, get_decisions, search_mistakes
```

**Understanding History**:
```
"How did we get here with [feature]?"
→ Claude uses: get_file_evolution, link_commits_to_conversations, search_conversations
```

**Avoiding Mistakes**:
```
"Have we seen [error] before?"
→ Claude uses: search_mistakes, search_conversations, get_file_evolution
```

**Starting New Work**:
```
"I want to implement [feature], what do I need to know?"
→ Claude uses: find_similar_sessions, get_requirements, get_decisions
```

---

**Pro Tip**: Just talk naturally to Claude! The MCP tools work automatically in the background to provide context-aware assistance using your conversation history.
