# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2025-01-06

### Added

- **Project Migration Feature** - Recover conversation history when project directories are renamed or moved
  - `discover_old_conversations` tool - Automatically finds old conversation folders by scanning `~/.claude/projects/`
  - `migrate_project` tool - Safely migrates JSONL files and updates database paths
  - Combined discovery approach using database inspection, folder similarity scoring, and JSONL analysis
  - Dry-run mode for testing migrations without making changes
  - Automatic backups (`.claude-conversations-memory.db.bak`) before migration
  - Transaction-based database updates with rollback on error
  - Comprehensive error handling and validation

### Documentation

- Added migration section to README with step-by-step examples
- Created MIGRATION-TESTING.md with 6 test scenarios and troubleshooting guide
- Updated tool definitions with clear descriptions and parameter documentation

### Testing

- Added 39 new tests (24 unit + 5 integration + 10 tool handler tests)
- All 113 tests passing with 100% coverage for migration logic
- Test isolation ensures no interference with real conversation folders

### Technical Details

- New `ProjectMigration` class in `src/utils/ProjectMigration.ts`
- Scoring algorithm ranks folder matches: database path (100 pts) + folder similarity (50%) + JSONL count (30 pts max)
- Safe copy-based migration preserves original data
- Injectable `projectsDir` parameter for test isolation

## [0.2.5] - 2025-01-05

### Fixed

- Fixed MCP filtering to exclude messages instead of entire conversations
- Improved conversation filtering to prevent self-referential loops

### Changed

- Show indexed folders and database path in index response
- Better visibility into which folders were scanned

## [0.2.4] - 2025-01-04

### Fixed

- MCP conversation filtering improvements
- Removed debug logging

## [Previous Versions]

See git history for changes before v0.2.4.

---

## Migration Guide from 0.2.x to 0.3.0

No breaking changes. The migration feature is additive - all existing functionality remains unchanged.

To use the new migration feature:

1. Update to v0.3.0: `npm install -g claude-conversation-memory-mcp@0.3.0`
2. Restart Claude Code to load new tools
3. Use "Discover old conversations" when you rename a project
4. Use "Migrate from..." to copy history to new location

See README.md for detailed usage examples.
