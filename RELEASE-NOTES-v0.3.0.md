# Release Notes - Version 0.3.0

**Release Date:** January 6, 2025

## 🎉 Major New Feature: Project Migration

Recover your conversation history when you rename or move project directories!

### Problem Solved

When you rename a project directory (e.g., `my-app` → `awesome-app`), Claude Code creates a new conversation folder, making your old history inaccessible. You lose all context about:
- Past decisions and their rationale
- Mistakes you learned from
- File evolution history
- Git commit associations

### Solution

Two new MCP tools automatically discover and migrate your conversation history:

#### 1. **discover_old_conversations**
Scans `~/.claude/projects/` to find folders matching your current project.

**Usage:**
```
You: "Discover old conversations for this project"
```

**Features:**
- Database path matching (checks stored project paths)
- Folder name similarity scoring
- JSONL file analysis
- Ranked results with confidence scores
- Shows conversation counts, file counts, and last activity

#### 2. **migrate_project**
Safely copies conversation history to the new location.

**Usage:**
```
You: "Migrate from [SOURCE_FOLDER], old path [OLD_PATH], new path [NEW_PATH]"
```

**Features:**
- Copy-based (preserves originals)
- Automatic backups (.db.bak)
- Transaction-based database updates
- Dry-run mode for testing
- Conflict detection
- Comprehensive validation

### Example Workflow

```bash
# 1. You renamed your project
Old: /Users/alice/projects/my-app
New: /Users/alice/projects/awesome-app

# 2. In Claude Code, discover old conversations
You: "Discover old conversations for this project"

Claude: Found 1 potential old conversation folder:
  - Folder: -Users-alice-projects-my-app
  - Original path: /Users/alice/projects/my-app
  - Conversations: 15
  - Files: 47
  - Score: 95.3

# 3. Migrate the history
You: "Migrate from /Users/alice/.claude/projects/-Users-alice-projects-my-app,
     old path /Users/alice/projects/my-app,
     new path /Users/alice/projects/awesome-app"

Claude: Successfully migrated 47 conversation files.
        Backup created at: .claude-conversations-memory.db.bak
        Now you can index and search your full history!

# 4. Index and use your history
You: "Index conversations for this project"
You: "What decisions did we make about the authentication system?"
```

## 📊 Technical Details

### Architecture

- **ProjectMigration class** - Core migration logic with discovery, validation, execution
- **Combined scoring** - Database paths (100 pts) + folder similarity (50%) + JSONL count (30 pts)
- **Safe operations** - Copy-based with automatic backups and rollback on error
- **Test isolation** - Injectable dependencies for clean unit testing

### Quality Metrics

- ✅ **113/113 tests passing** (100% pass rate)
- ✅ **39 new tests** (24 unit + 5 integration + 10 tool handler)
- ✅ **0 TypeScript errors**
- ✅ **0 ESLint warnings**
- ✅ **1,807 lines of code** added
- ✅ **100% test coverage** for migration logic

### Safety Features

1. **Validation before execution**
   - Source folder exists and has data
   - Target folder doesn't have conflicting data
   - Database is readable and valid

2. **Automatic backups**
   - Creates `.claude-conversations-memory.db.bak` in source folder
   - Original files never deleted (copy, not move)

3. **Transaction-based updates**
   - Database changes wrapped in transactions
   - Automatic rollback on error
   - Atomic operations

4. **Dry-run mode**
   - Test migrations without making changes
   - Shows exactly what would happen

## 📚 Documentation

- **README.md** - Migration section with examples
- **MIGRATION-TESTING.md** - 6 test scenarios with verification steps
- **CHANGELOG.md** - Full version history
- **Tool definitions** - Clear parameter documentation

## 🔄 Upgrade Guide

### From v0.2.x to v0.3.0

**No breaking changes!** The migration feature is additive.

**Update steps:**
```bash
# If installed globally
npm install -g claude-conversation-memory-mcp@0.3.0

# If using npx
# No action needed - will auto-update on next run

# Restart Claude Code to load new tools
```

**New capabilities:**
- Two new MCP tools available
- All existing tools work exactly as before
- No configuration changes needed

## 🐛 Known Limitations

1. **Manual path entry** - Currently requires copy-pasting folder paths from discovery results
2. **Single source migration** - Doesn't merge from multiple old folders (can run multiple migrations)
3. **No auto-discovery on index** - Must explicitly discover and migrate (intentional for safety)

## 🎯 Next Steps

After updating:

1. **Test with a renamed project**
   - See MIGRATION-TESTING.md for step-by-step scenarios
   - Start with dry-run mode to verify behavior

2. **Migrate critical projects**
   - Identify projects you've renamed
   - Use discover → migrate workflow
   - Verify history accessible after migration

3. **Provide feedback**
   - Report any issues on GitHub
   - Suggest UX improvements
   - Share success stories

## 💡 Tips

- **Always start with dry-run** to verify what will be migrated
- **Check discovery score** - higher scores (>80) are usually correct matches
- **Verify paths match** - Ensure old_project_path exactly matches database
- **Keep backups** - Original files preserved, but backups add extra safety
- **Test thoroughly** - Use test project first before migrating important history

## 🙏 Acknowledgments

Built following Test-Driven Development (TDD):
- Tests written first (RED)
- Implementation to pass tests (GREEN)
- Refactoring for quality (BLUE)

This ensures:
- Reliable behavior
- Comprehensive edge case handling
- Maintainable codebase
- Clear requirements documentation

---

**Full Changelog:** See [CHANGELOG.md](./CHANGELOG.md)
**Testing Guide:** See [MIGRATION-TESTING.md](./MIGRATION-TESTING.md)
**Issues:** https://github.com/xiaolai/claude-conversation-memory-mcp/issues
