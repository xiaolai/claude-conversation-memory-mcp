# Quick Reference - Natural Language Commands

Simple phrases to trigger each MCP tool in Claude Code.

---

## 📥 index_conversations
```
"Index my conversation history"
"Scan and remember our conversations"
"Update the conversation index"
"Rebuild memory from conversations"
"Index all conversations, including MCP ones"
"Index conversations but exclude code-graph-rag"
```

**Note**: By default, excludes conversations using conversation-memory MCP to prevent self-referential loops.

---

## 🔍 search_conversations
```
"What did we discuss about [topic]?"
"When did we work on [feature]?"
"Find conversations about [keyword]"
"Search our chat history for [query]"
```

---

## 🎯 get_decisions
```
"What decisions did we make about [topic]?"
"Why did we choose [approach]?"
"Show me the decision history for [component]"
"What were the alternatives we considered?"
```

---

## 📋 check_before_modify
```
"Before I change [file], what should I know?"
"Show me the context for [file]"
"What's the history of [file]?"
"Check [file] for related decisions"
```

---

## 📜 get_file_evolution
```
"Show me the complete history of [file]"
"How did [file] evolve over time?"
"Track all changes to [file]"
"What's the timeline for [file]?"
```

---

## 🔗 link_commits_to_conversations
```
"Which commits were made in [session]?"
"Show me commits related to [topic]"
"What did we commit recently?"
"Find the conversation for commit [hash]"
```

---

## ⚠️ search_mistakes
```
"Have we made mistakes with [topic] before?"
"What bugs did we encounter with [component]?"
"Show me past errors related to [keyword]"
"What should I avoid when working on [feature]?"
```

---

## 📝 get_requirements
```
"What are the requirements for [component]?"
"Show me [type] requirements"
"What does [module] require?"
"List all dependencies we need"
```

---

## 🛠️ get_tool_history
```
"Show me files we edited recently"
"What bash commands did we run?"
"Which files have we been reading?"
"Show me the last [N] git commands"
```

---

## 🔄 find_similar_sessions
```
"Have we worked on similar [problems] before?"
"Find sessions where we did [activity]"
"Show me when we worked on [similar topic]"
"Have we dealt with this before?"
```

---

## 📚 generate_documentation
```
"Generate documentation for this project"
"Create architecture documentation"
"Generate a decision log"
"Document all mistakes and lessons learned"
```

---

## 🎯 Common Workflows

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

## 💡 Pro Tips

1. **Just ask naturally** - No need to remember commands
2. **Be specific** - "embedding system" > "that thing"
3. **Ask follow-ups** - "Tell me more" or "Show examples"
4. **Combine requests** - "Check history and related decisions"
5. **Let Claude choose** - Tools work automatically in background

---

## 🚀 Quick Start

**First time using?**

1. **Index conversations**: "Index my conversation history"
2. **Ask questions**: "What have we been working on?"
3. **Get context**: "Before I change X, what should I know?"
4. **Learn from past**: "Have we made mistakes with Y before?"

That's it! The MCP tools work invisibly to provide context-aware assistance.

---

**Remember**: You're just having a conversation with Claude. The tools automatically activate when needed!
