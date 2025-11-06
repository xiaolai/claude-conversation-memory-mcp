# Migration Feature Testing Guide

This guide helps you test the new migration feature in real-world scenarios.

## Test Scenario 1: Discover Old Conversations

**Setup:** Use the current project (claude-conversation-memory-mcp) which already has conversation history.

**Steps:**

1. In Claude Code, navigate to this project directory
2. Say: "Discover old conversations for this project"
3. **Expected:** Should find `-Users-joker-github-xiaolai-claude-conversation-memory-mcp` folder with conversations

**Verify:**
- Shows folder name and path
- Shows stored project path matches current directory
- Shows conversation count and file count
- Shows similarity score

## Test Scenario 2: Simulate Project Rename

**Setup:** Create a test project and rename it.

**Steps:**

```bash
# 1. Create a test project
mkdir -p ~/test-migration/my-app
cd ~/test-migration/my-app
echo "# Test App" > README.md

# 2. Start Claude Code and have a conversation
# This will create ~/.claude/projects/-Users-YOUR-NAME-test-migration-my-app

# 3. Rename the project directory
cd ~/test-migration
mv my-app awesome-app
cd awesome-app

# 4. In Claude Code, discover old conversations
# Say: "Discover old conversations for this project"

# 5. Migrate the conversations
# Copy the source folder path from discover results
# Say: "Migrate from [SOURCE_FOLDER], old path [OLD_PATH], new path [NEW_PATH]"
# Example:
# "Migrate from /Users/joker/.claude/projects/-Users-joker-test-migration-my-app,
#  old path /Users/joker/test-migration/my-app,
#  new path /Users/joker/test-migration/awesome-app"

# 6. Verify migration
# Say: "Index conversations for this project"
# Say: "What did we discuss in previous conversations?"
```

**Verify:**
- Old folder remains intact (original files preserved)
- New folder created with copied files
- Database `project_path` updated to new path
- Backup file `.claude-conversations-memory.db.bak` created in old folder
- Can search and access old conversation history

## Test Scenario 3: Dry Run

**Steps:**

1. Follow Scenario 2 setup
2. Instead of migrating, do a dry run first:
   - "Dry run: migrate from [SOURCE], old path [OLD], new path [NEW]"

**Verify:**
- Shows what would be migrated (file count)
- Shows target folder path
- Message indicates "Dry run: Would migrate X conversation files"
- **No actual files copied** (check `~/.claude/projects/` - new folder should NOT exist)
- Original folder unchanged

## Test Scenario 4: Conflict Detection

**Setup:** Try to migrate when target already has data.

**Steps:**

```bash
# 1. After a successful migration from Scenario 2
# 2. Try migrating the same source again
# Say: "Migrate from [SAME_SOURCE], old path [OLD], new path [NEW]"
```

**Verify:**
- Migration should be rejected
- Error message mentions "already has conversation data" or similar
- No files overwritten

## Test Scenario 5: Multiple Candidates

**Setup:** Have multiple projects with similar names.

**Steps:**

```bash
# Create multiple similar projects
mkdir -p ~/test-migration/project-v1
mkdir -p ~/test-migration/project-v2
mkdir -p ~/test-migration/project-v3

# Have conversations in each (start Claude Code in each directory)

# Rename one
mv ~/test-migration/project-v1 ~/test-migration/project-production

# Discover from production directory
cd ~/test-migration/project-production
# Say: "Discover old conversations for this project"
```

**Verify:**
- Shows all matching candidates
- Ranked by similarity score (exact matches should score higher)
- Can distinguish between v1, v2, v3 based on paths stored in databases

## Test Scenario 6: Missing Database

**Setup:** Test discovery when database doesn't exist.

**Steps:**

```bash
# Create folder structure but remove database
mkdir -p ~/.claude/projects/test-no-db
echo '{"test": "data"}' > ~/.claude/projects/test-no-db/session.jsonl
# No database file

# In a project directory
# Say: "Discover old conversations for this project"
```

**Verify:**
- Folder with JSONL files but no database should still be discovered (lower score)
- Shows statistics as available (files counted, conversations = 0)

## Verification Checklist

After each test:

- [ ] Original source folder still exists and is unchanged
- [ ] New target folder created (if not dry run)
- [ ] All `.jsonl` files copied correctly
- [ ] Database `.db` file copied
- [ ] Backup `.db.bak` created in source folder
- [ ] `project_path` updated in target database
- [ ] Can index and search conversations from new location
- [ ] No data loss (compare file counts and conversation counts)

## Troubleshooting Common Issues

### Issue: "No old conversation folders found"

**Causes:**
- Current directory has never been used with Claude Code
- Folder naming has changed significantly (dots, special characters)
- Database doesn't exist in old folders

**Solutions:**
- Check `~/.claude/projects/` manually for matching folders
- Look for folders with similar path components
- Use folder name patterns to identify candidates

### Issue: "Migration validation failed"

**Causes:**
- Source folder doesn't exist
- Source has no `.jsonl` files
- Target already has data
- Database is corrupted

**Solutions:**
- Verify source path is correct
- Check if source folder has conversation files
- Clear target folder or choose different new path
- Check if database can be opened with SQLite

### Issue: "No conversations updated - path mismatch"

**Causes:**
- `old_project_path` doesn't match what's stored in database
- Database has different path format

**Solutions:**
- Check database: `sqlite3 path/to/.claude-conversations-memory.db "SELECT DISTINCT project_path FROM conversations"`
- Use the exact path from database as `old_project_path`

## Manual Verification Commands

```bash
# Check folder contents
ls -la ~/.claude/projects/-Your-Folder-Name/

# Count JSONL files
ls ~/.claude/projects/-Your-Folder-Name/*.jsonl | wc -l

# Check database project_path
sqlite3 ~/.claude/projects/-Your-Folder-Name/.claude-conversations-memory.db \
  "SELECT DISTINCT project_path FROM conversations"

# Count conversations
sqlite3 ~/.claude/projects/-Your-Folder-Name/.claude-conversations-memory.db \
  "SELECT COUNT(*) FROM conversations"

# Check backup exists
ls -la ~/.claude/projects/-Old-Folder-Name/.claude-conversations-memory.db.bak
```

## Success Criteria

A successful migration means:

1. ✅ All conversation files copied to new location
2. ✅ Database paths updated correctly
3. ✅ Original files preserved (backup created)
4. ✅ Can index and search conversations from new location
5. ✅ No data loss or corruption
6. ✅ All metadata (timestamps, git info) preserved

## Reporting Issues

If you encounter issues:

1. Note which scenario failed
2. Check troubleshooting section
3. Run manual verification commands
4. Report with:
   - Test scenario number
   - Error message received
   - Database query results
   - File counts before/after

---

**Last Updated:** 2025-01-06
**Feature Version:** 0.3.0
