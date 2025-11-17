# Quick Reference - Natural Language Commands

Simple phrases to trigger each MCP tool in Claude Code and Codex.

---

## 📖 Contents

- [Per-Project Tools](#-per-project-tools) (1-11) - Work within current project
- [Global Cross-Project Tools](#-global-cross-project-tools) (12-15) - Search across ALL projects (NEW in v1.5.0)
- [Common Workflows](#-common-workflows)
- [Pro Tips](#-pro-tips)
- [Quick Start](#-quick-start)

---

# 📁 Per-Project Tools

These tools work within the **current project only**.

---

## 1. 📥 index_conversations
```
"Index my conversation history"
"Scan and remember our conversations"
"Update the conversation index"
"Rebuild memory from conversations"
"Index all conversations, including MCP ones"
"Index conversations but exclude code-graph-rag"
```

**Scope**: Current project (Claude Code or Codex)

**Note**: By default, excludes conversations using conversation-memory MCP to prevent self-referential loops.

---

## 2. 🔍 search_conversations
```
"What did we discuss about [topic]?"
"When did we work on [feature]?"
"Find conversations about [keyword]"
"Search our chat history for [query]"
```

**Scope**: Current project only

**Note**: For global search, use [search_all_conversations](#13--search_all_conversations)

---

## 3. 🎯 get_decisions
```
"What decisions did we make about [topic]?"
"Why did we choose [approach]?"
"Show me the decision history for [component]"
"What were the alternatives we considered?"
```

**Scope**: Current project only

**Note**: For global decision search, use [get_all_decisions](#14--get_all_decisions)

---

## 4. 📋 check_before_modify
```
"Before I change [file], what should I know?"
"Show me the context for [file]"
"What's the history of [file]?"
"Check [file] for related decisions"
```

**Scope**: Current project only

---

## 5. 📜 get_file_evolution
```
"Show me the complete history of [file]"
"How did [file] evolve over time?"
"Track all changes to [file]"
"What's the timeline for [file]?"
```

**Scope**: Current project only

---

## 6. 🔗 link_commits_to_conversations
```
"Which commits were made in [session]?"
"Show me commits related to [topic]"
"What did we commit recently?"
"Find the conversation for commit [hash]"
```

**Scope**: Current project only

---

## 7. ⚠️ search_mistakes
```
"Have we made mistakes with [topic] before?"
"What bugs did we encounter with [component]?"
"Show me past errors related to [keyword]"
"What should I avoid when working on [feature]?"
```

**Scope**: Current project only

**Note**: For global mistake search, use [search_all_mistakes](#15--search_all_mistakes)

---

## 8. 📝 get_requirements
```
"What are the requirements for [component]?"
"Show me [type] requirements"
"What does [module] require?"
"List all dependencies we need"
```

**Scope**: Current project only

---

## 9. 🛠️ get_tool_history
```
"Show me files we edited recently"
"What bash commands did we run?"
"Which files have we been reading?"
"Show me the last [N] git commands"
```

**Scope**: Current project only

---

## 10. 🔄 find_similar_sessions
```
"Have we worked on similar [problems] before?"
"Find sessions where we did [activity]"
"Show me when we worked on [similar topic]"
"Have we dealt with this before?"
```

**Scope**: Current project only

---

## 11. 📚 generate_documentation
```
"Generate documentation for this project"
"Create architecture documentation"
"Generate a decision log"
"Document all mistakes and lessons learned"
```

**Scope**: Current project only

---

---

# 🌐 Global Cross-Project Tools

**NEW in v1.5.0**: These tools search across **ALL indexed projects** (Claude Code + Codex).

---

## 12. 🌐 index_all_projects
```
"Index all my projects globally"
"Scan all my Claude Code projects and Codex sessions"
"Create a global registry of all my work"
"Rebuild the global index"
"Index only my Claude Code projects"
"Index only my Codex sessions"
"Update my global index with recent work"
```

**Scope**: Global - creates registry of all projects

**Use Case**: First-time setup, periodic refresh

**How it works**:
- Scans `~/.claude/projects/` (Claude Code)
- Scans `~/.codex/sessions/` (Codex)
- Creates `~/.claude/.claude-global-index.db`

---

## 13. 🔎 search_all_conversations
```
"Search all my projects for [topic]"
"Have I ever worked on [feature] in ANY project?"
"Show me all conversations about [keyword] across everything"
"Find where I've discussed [topic] (Claude Code and Codex)"
"Search my entire history for [query]"
```

**Scope**: Global - searches all indexed projects

**Use Case**: Cross-project learning, finding past solutions

**Response includes**:
- `project_path` - Which project the conversation is from
- `source_type` - "claude-code" or "codex"
- `similarity` - Relevance score

**Example**:
```
User: "Have I implemented authentication before anywhere?"
→ Finds: OAuth2 in api-server (Claude Code) + JWT in mobile-backend (Codex)
```

---

## 14. 🎯🌐 get_all_decisions
```
"What decisions have I made about [topic] across all projects?"
"Show me all [type] decisions from any project"
"What have I decided about [approach] anywhere?"
"Find database decisions from all my work"
```

**Scope**: Global - searches decisions across all projects

**Status**: ⚠️ STUB (Coming Soon)

**Planned Use Case**: Informed decision-making based on complete history

**Example (Planned)**:
```
User: "What have I decided about state management in React?"
→ Finds: Redux (project A), Context API (project B), Zustand (project C)
```

---

## 15. ⚠️🌐 search_all_mistakes
```
"Have I made mistakes with [topic] in any project?"
"Show me all [type] errors from anywhere"
"What bugs have I encountered with [feature] globally?"
"Find [error] mistakes across all my work"
```

**Scope**: Global - searches mistakes across all projects

**Status**: ⚠️ STUB (Coming Soon)

**Planned Use Case**: Avoid repeating mistakes from other projects

**Example (Planned)**:
```
User: "Have I made async/await mistakes before?"
→ Finds: Forgot to await in api-server + nested transactions in e-commerce
```

---

---

# 🎯 Common Workflows

## Per-Project Workflows

### Before Writing Code
```
User: "I want to add [feature], what do I need to know?"
→ Claude checks: similar sessions, requirements, past mistakes, decisions
```

### Before Modifying Files
```
User: "Before I change [file], show me the context"
→ Claude shows: file history, related decisions, past mistakes
```

### During Debugging
```
User: "Have we seen [error] before?"
→ Claude searches: mistakes, conversations, file history
```

### Code Review
```
User: "Review these changes"
→ Claude checks: decisions, requirements, mistakes, file context
```

### Learning Project
```
User: "Explain how [component] works"
→ Claude generates: documentation with decisions and history
```

---

## Global Cross-Project Workflows (NEW)

### Starting New Feature (Global Learning)
```
User: "Have I ever implemented [feature] before? I'm starting a new project."
→ Claude searches: ALL projects (Claude Code + Codex)
→ Finds: Similar implementations, decisions, mistakes to avoid
→ Shows: Which projects, when, what approach worked
```

**Example**:
```
User: "Have I built authentication before anywhere?"
→ Finds: OAuth2 in api-server (3 months ago, Claude Code)
         JWT in mobile-backend (6 months ago, Codex)
→ Shows: Code patterns, decisions, lessons learned
```

---

### Cross-Platform Knowledge Transfer
```
User: "I'm working in Codex now. Did I solve [problem] in Claude Code?"
→ Claude searches: All Claude Code projects and Codex sessions
→ Transfers: Solution from Claude Code to current Codex session
```

**Example**:
```
User: "How did I handle pagination in past projects?"
→ Finds: Pagination in dashboard (Claude Code, 2 months ago)
→ Transfers: Implementation approach to current Codex work
```

---

### Avoiding Past Mistakes Globally
```
User: "I'm about to [action]. Have I made mistakes with this anywhere?"
→ Claude searches: ALL projects for similar mistakes
→ Warns: What went wrong, how it was fixed, which project
```

**Example**:
```
User: "About to use async/await with DB transactions. Any past mistakes?"
→ Finds: Race condition in api-server (Claude Code)
         Deadlock in e-commerce (Codex)
→ Shows: What went wrong, corrections applied
```

---

### Technology Decision Research
```
User: "Should I use [tech A] or [tech B]? What have I decided before?"
→ Claude searches: ALL decisions across all projects
→ Shows: When you chose A, when you chose B, why in each case
```

**Example**:
```
User: "PostgreSQL or MongoDB for this new project?"
→ Finds: Chose PostgreSQL in api-server (needed ACID)
         Chose MongoDB in content-platform (flexible schema)
→ Shows: Rationale, project characteristics, lessons learned
```

---

### First-Time Global Setup
```
User: "I just installed the MCP. Set up global search."
→ Claude: "Let me index all your work first"
→ Runs: index_all_projects (Claude Code + Codex)
→ Result: 8 Claude Code projects + 4 Codex sessions indexed
→ Ready: Can now search across all 12 projects
```

---

### Periodic Maintenance
```
User: "I've been working with Codex all week. Update global index."
→ Claude: Runs index_all_projects
→ Result: Adds new Codex sessions to global registry
→ Ready: Global search now includes this week's work
```

---

---

# 💡 Pro Tips

## Per-Project Tips

1. **Just ask naturally** - No need to remember commands
2. **Be specific** - "embedding system" > "that thing"
3. **Ask follow-ups** - "Tell me more" or "Show examples"
4. **Combine requests** - "Check history and related decisions"
5. **Let Claude choose** - Tools work automatically in background

---

## Global Tools Tips (NEW)

1. **Index first** - Run "Index all my projects globally" after installation
2. **Refresh periodically** - Re-index weekly/monthly to catch new work
3. **Check source_type** - Results show if from Claude Code or Codex
4. **Use specific queries** - "JWT token validation" > "authentication"
5. **Filter by date** - "from the last month" to focus on recent work
6. **Know your scope** - Per-project for speed, global for learning
7. **Expect moderate latency** - Global search queries multiple databases
8. **Index new projects** - After creating projects, update global index

---

## When to Use Which Scope

### Use Per-Project Tools (1-11) When:
- ✅ Working within a single project
- ✅ Need fast, focused results (milliseconds)
- ✅ File-specific context (check_before_modify, get_file_evolution)
- ✅ Project-specific requirements and decisions

### Use Global Tools (12-15) When:
- 🌐 Starting a new feature you might have built before
- 🌐 Learning from past work across multiple projects
- 🌐 Discovering patterns and best practices
- 🌐 Avoiding mistakes you made elsewhere
- 🌐 Making architectural decisions informed by past choices
- 🌐 Transferring knowledge from Claude Code to Codex (or vice versa)

---

---

# 🚀 Quick Start

## Per-Project Quick Start

**First time using?**

1. **Index conversations**: "Index my conversation history"
2. **Ask questions**: "What have we been working on?"
3. **Get context**: "Before I change X, what should I know?"
4. **Learn from past**: "Have we made mistakes with Y before?"

---

## Global Quick Start (NEW in v1.5.0)

**Want to search across ALL your projects?**

1. **Index globally**: "Index all my projects globally"
   - Scans all Claude Code projects
   - Scans all Codex sessions
   - Creates global registry

2. **Search globally**: "Have I ever implemented [feature] anywhere?"
   - Searches across all projects
   - Shows results from Claude Code AND Codex
   - Includes project_path and source_type

3. **Learn globally**: "What have I decided about [topic] across all work?"
   - Finds decisions from all projects
   - Shows patterns and choices
   - Informs current decisions

4. **Refresh periodically**: "Update my global index"
   - Re-scan for new projects
   - Add new Codex sessions
   - Keep global search current

---

## Hybrid Workflow

**Best of both worlds:**

1. **Start with global search** - "Have I done this before anywhere?"
2. **Learn from past work** - See solutions from other projects
3. **Switch to per-project** - "Now index THIS project and help me implement it"
4. **Use per-project tools** - Fast, focused assistance during coding
5. **Periodic global refresh** - "Update global index" weekly/monthly

---

**Remember**: You're just having a conversation with Claude. The tools automatically activate when needed - whether searching the current project or your entire work history across both Claude Code and Codex!

---

## Architecture Diagram

```
Your Work History:
┌─────────────────────────────────────────────────────┐
│  Per-Project Tools (Fast, Single Source)            │
│  ↓                                                   │
│  ~/.claude/projects/current-project/.db             │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Global Tools (Moderate, Multiple Sources)          │
│  ↓                                                   │
│  ~/.claude/.claude-global-index.db (Registry)       │
│      ↓                                               │
│      ├─→ ~/.claude/projects/project-1/.db           │
│      ├─→ ~/.claude/projects/project-2/.db           │
│      ├─→ ~/.claude/projects/project-3/.db           │
│      └─→ ~/.codex/.codex-conversations-memory.db    │
└─────────────────────────────────────────────────────┘
```

**Key Points**:
- Each project has its own database (isolation)
- Global index is a registry (links to all databases)
- Per-project tools = fast (single DB)
- Global tools = comprehensive (all DBs)

---

**Questions?** Check the [README](../README.md) for full documentation or [TOOL-EXAMPLES](./TOOL-EXAMPLES.md) for detailed usage examples.
