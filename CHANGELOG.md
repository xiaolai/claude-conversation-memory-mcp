# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2025-01-06

### Added

- **New `recall_and_apply` Tool** - Context transfer for "remember X, now do Y based on that" workflows
  - Recalls multiple context types in one call: conversations, decisions, mistakes, file_changes, commits
  - Filters by query, file_path, date_range, and context_types
  - Returns structured recalled context with application suggestions
  - Provides context_summary showing what was found
  - Generates actionable suggestions for applying recalled context
  - Optimized for AI workflows requiring historical context

### Use Cases

- "Recall how we implemented authentication, now add OAuth support using that same pattern"
- "Remember the bug we fixed in parser.ts, check if similar issue exists in lexer.ts"
- "Recall all decisions about database schema, now design the migration strategy"
- "Find mistakes we made with async/await, avoid them in this new async function"

### Technical Details

- 220+ lines of new handler logic
- Integrates with existing search, decisions, mistakes, commits infrastructure
- Supports selective context types for performance
- Backward compatible with all existing tools
- 0 errors, 0 warnings, 147 tests passing

## [0.5.0] - 2025-01-06

### Added

- **New `models` CLI Command** - Power user features for exploring embedding models
  - `models` - List all 11 models in a formatted table (name, provider, dimensions, quality, description)
  - `models <provider>` - Filter by provider (ollama, transformers, openai) with recommended model highlighted
  - `models quality <tier>` - Filter by quality tier (low, medium, high, highest)
  - `models recommend` - Show recommended model for each provider with installation/cost info

- **Interactive Model Selection** - User-friendly guided setup
  - New `select-model` (alias: `select`) command with step-by-step prompts
  - Choose provider → Choose model → Confirm and save
  - Recommended models highlighted with ⭐
  - Shows setup instructions (Ollama pull commands, API key requirements, costs)
  - Automatically sets provider, model, and dimensions in one go

- **Model Validation** - Prevent configuration mistakes
  - `set model <name>` now validates against ModelRegistry
  - Warns if model not found, suggests using `models` command
  - Allows custom models with warning to set dimensions manually

### Changed

- Enhanced `set dimensions` command - Now dynamically suggests matching models from ModelRegistry (was hardcoded)
- All CLI model references now powered by ModelRegistry for consistency

### Technical Details

- Interactive prompts powered by existing `prompts` package
- Zero new dependencies added
- All new CLI features fully tested (manual testing)
- 0 errors, 0 warnings, all tests passing

## [0.4.1] - 2025-01-06

### Added

- **Model Registry Architecture** - Centralized single source of truth for all embedding models
  - New `ModelRegistry.ts` with complete model metadata (name, dimensions, provider, quality, description, installation, cost)
  - 38 comprehensive unit tests for ModelRegistry (all passing)
  - Helper functions: `getModelsByProvider()`, `getModelInfo()`, `getModelDimensions()`, `getAllModels()`, `modelExists()`, `getModelsByQuality()`, `getRecommendedModel()`
  - Partial string matching support for flexible model lookup (Ollama-style)

- **Enhanced Model Discoverability**
  - CLI `config` command now displays all 11 models organized by provider with dimensions and descriptions
  - Created `.claude-memory-config.example.json` - clean, copy-paste ready config example
  - Created `.claude-memory-config.example.jsonc` - comprehensive commented guide with inline model documentation
  - Both example files included in npm package distribution

- **Comprehensive Documentation**
  - New `docs/MODELS.md` - Complete guide to all embedding models
    - Decision matrix for choosing models
    - Quality tiers and performance benchmarks
    - Configuration examples for each provider
    - Migration guide for switching models
    - Advanced topics: custom models, multi-language support, performance considerations
  - Updated README with model discovery instructions

### Changed

- Refactored `OllamaEmbeddings.ts` to use ModelRegistry (eliminated hardcoded dimensions map)
- Refactored `TransformersEmbeddings.ts` to use ModelRegistry (eliminated hardcoded dimensions map)
- Refactored `OpenAIEmbeddings.ts` to use ModelRegistry (eliminated hardcoded dimensions map)
- Updated CLI `commands.ts` to dynamically generate model list from ModelRegistry (no more hardcoded output)

### Technical Details

- **DRY Principle Applied**: Eliminated 4 duplicate model dimension definitions across codebase
- **Improved `getRecommendedModel()` logic**: Now properly cascades through quality levels (highest → high → medium → low)
- **Empty string validation**: `getModelInfo()` now returns null for empty/whitespace-only model names
- **Quality-based filtering**: New `getModelsByQuality()` for finding models by quality tier
- All 147 tests passing (9 skipped), 0 warnings, 0 errors

## [0.4.0] - 2025-01-06

### Added

- **Merge Mode for Project Migration** - Combine conversations from different projects into one folder
  - `migrate_project` tool now supports `mode` parameter: "migrate" (default) or "merge"
  - "merge" mode combines conversations from source into existing target folder
  - Duplicate conversation IDs are skipped (target kept) - no data loss
  - Safely merge history from different projects or development branches
  - Automatic target database backup before merge
  - Transaction-based merge with rollback on error

### Changed

- `migrate_project` tool description updated to document both modes
- Tool handler generates mode-specific success messages

### Technical Details

- New `executeMerge()` method in `ProjectMigration` class
- New `mergeDatabase()` method uses `INSERT OR IGNORE` strategy
- Defensive table existence checking for schema compatibility
- 5 new comprehensive tests for merge mode (all passing)

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
