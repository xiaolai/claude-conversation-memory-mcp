# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - 2025-01-12

### Fixed
- **Token Limit Issue**: Fixed `get_tool_history` returning 45K+ tokens (exceeding Claude Code's 25K limit)
  - Implemented smart content truncation (default: 500 characters)
  - Added pagination support with `offset` and `limit` parameters
  - Created summary mode (`include_content=false`) for metadata-only responses

### Added
- **Pagination**: Full pagination support for `get_tool_history` with `has_more` indicator
- **Content Control**: Configurable `max_content_length` parameter for truncation
- **Advanced Filtering**: New filters for `get_tool_history`:
  - `date_range`: Filter by timestamp range
  - `conversation_id`: Filter by specific conversation session
  - `errors_only`: Show only failed tool uses
- **Response Metadata**: Enhanced response with `total_in_database`, `has_more`, and `offset` fields
- **Truncation Indicators**: Added flags (`content_truncated`, `stdout_truncated`, `stderr_truncated`)

### Changed
- Default `get_tool_history` response reduced from ~45,000 tokens to ~5,000 tokens
- Summary mode can fetch 50+ tool uses in ~500 tokens
- All 10 new `getToolHistory` tests passing

### Documentation
- Updated TOOL-EXAMPLES.md with pagination patterns and usage examples
- Added pro tips for optimal token usage

## [1.3.0] - 2025-01-12

### Added
- **MCP CLI Commands**: Three new commands for managing MCP server configuration
  - `init-mcp`: Auto-configure MCP server in `~/.claude.json`
  - `remove-mcp`: Safely remove MCP configuration with confirmation
  - `mcp-status`: Check MCP configuration status and health
- **McpConfig Utility**: New utility module for MCP server management (184 lines)
- **Help Documentation**: Comprehensive help text for all MCP commands

### Fixed
- **Critical Bug**: Fixed SQL query in `recall_and_apply` using wrong column names
  - `mistake_id` → `id`
  - `type` → `mistake_type`
  - `description` → `what_went_wrong`
  - Aligned SQL with actual database schema

### Changed
- All 400 tests passing with zero TypeScript errors and ESLint warnings

## [1.2.0] - 2025-01-12

### Added
- **Automatic MCP Configuration**: Global npm install now auto-configures Claude Code
  - Post-install script detects global installation
  - Automatically adds MCP server to `~/.claude.json`
  - Creates backup before modifying configuration
  - Provides helpful success/error messages

### Changed
- Updated README with automatic installation instructions
- Added `scripts/` folder to npm package files
- Improved first-time user experience

### Technical
- New `scripts/postinstall.js` handles automatic configuration
- Gracefully handles missing Claude Code installation
- Prevents duplicate configurations

## [1.1.1] - 2025-01-12

### Fixed
- **CI Reliability**: Fixed GitHub Actions compatibility issues
  - Added CI environment detection for test skipping
  - Skip TransformersEmbeddings tests in CI (environment incompatibility)
  - Included package-lock.json for reproducible builds

### Changed
- All 387 tests passing in CI
- All 400 tests passing locally
- No functional changes to the package
- Improved test reliability across Node 20 and 22

## [1.1.0] - 2025-01-11

### Added
- **forget_by_topic Tool**: Selectively delete conversations by keywords/topics
  - Automatic backup before deletion to `~/.claude/backups/`
  - Preview mode to see what would be deleted
  - Hybrid search (semantic + FTS5) for finding conversations
  - Two-step workflow: preview first, then confirm
  - Preserves original .jsonl conversation files

### Safety
- Complete backup of all related data before deletion
- Non-destructive preview mode

## [1.0.0] - 2025-01-07

### 🎉 Production Release

This is the first stable production release of claude-conversation-memory-mcp. The codebase has reached maturity with comprehensive testing, performance optimization, and production-ready features.

### Added

- **Query Caching Layer**: LRU cache with TTL for database query results
  - New `QueryCache` class (358 lines) with LRU eviction and TTL expiration
  - Caching enabled by default (100 entries, 5 minute TTL)
  - Smart cache invalidation on data updates
  - Cache statistics tracking (hits, misses, evictions, hit rate)
  - Configurable cache size and TTL
  - O(1) cache operations for optimal performance

- **Cached Query Methods**: 5 frequently-used queries now cached:
  - `getConversation()` - Single conversation lookup
  - `getFileTimeline()` - Complete file history
  - `getFileEdits()` - File edit history
  - `getDecisionsForFile()` - Decisions related to a file
  - `getCommitsForFile()` - Git commits for a file

- **Cache Management API**: Public methods for cache control:
  - `enableCache(config)` - Configure and enable caching
  - `disableCache()` - Turn off caching
  - `clearCache()` - Clear all cached data
  - `isCacheEnabled()` - Check cache status
  - `getCacheStats()` - Get performance metrics

### Performance Improvements

- **~80% cache hit rate** on repeated queries after warmup
- **O(1) cache lookups** using Map-based LRU implementation
- **Automatic cache invalidation** prevents stale data
- **Reduced database load** through intelligent caching
- **Default enabled** for better out-of-box performance

### Testing

- Comprehensive JSDoc documentation for all public APIs
- 47 new tests (29 QueryCache + 18 CachedConversationStorage)
- All 400 tests passing with 0 warnings
- Test-Driven Development (TDD) workflow
- Edge case handling (size 1 cache, null values, rapid operations)
- Configuration validation for cache parameters

### Quality Metrics

- **0 errors, 0 warnings** across entire codebase
- **400 tests passing** (147 original + 47 new + 206 existing)
- **100% type safety** with strict TypeScript checking
- **Comprehensive documentation** for all new features
- **Production-ready** code quality standards

### Breaking Changes

None - This is a backward compatible release. Caching is enabled by default but can be disabled if needed.

### Migration from Earlier Versions

No code changes required. Caching is automatically enabled with sensible defaults (100 entries, 5 minutes).

To customize cache settings:

```typescript
const memory = new ConversationMemory();
memory.getStorage().enableCache({ maxSize: 200, ttlMs: 600000 }); // 200 entries, 10 minutes
```

To disable caching:

```typescript
memory.getStorage().disableCache();
```

## [0.2.5] - 2025-01-05

### Changed
- Show indexed folders and database path in index response
- Better visibility into which folders were scanned

### Fixed
- Fixed MCP filtering to exclude messages instead of entire conversations
- Improved conversation filtering to prevent self-referential loops

## [0.2.4] - 2025-01-04

### Fixed
- MCP conversation filtering improvements
- Removed debug logging

## [0.2.3] - Earlier

### Added
- Index conversations from BOTH modern and legacy folders

## [0.2.2] - Earlier

### Added
- `--version` flag to CLI

## [0.2.1] - Earlier

### Fixed
- Bug fixes and improvements

## [0.2.0] - Earlier

### Added
- Initial public release

---

## Version History Summary

- **1.4.0**: Fix token limit issue in `get_tool_history` (pagination, truncation, filtering)
- **1.3.0**: MCP CLI commands + critical SQL bug fix
- **1.2.0**: Automatic MCP configuration on install
- **1.1.1**: CI reliability improvements
- **1.1.0**: Add `forget_by_topic` tool
- **1.0.0**: 🎉 Production release with query caching
- **0.2.x**: Early development releases

---

## Maintaining This Changelog

This changelog is maintained manually and should be updated with each release. When making significant changes:

1. Add entry under `[Unreleased]` section during development
2. Move to versioned section when releasing
3. Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format
4. Use semantic versioning: MAJOR.MINOR.PATCH
5. Run `npm run changelog:check` before committing major changes

### Categories to Use

- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** for vulnerability fixes

[Unreleased]: https://github.com/xiaolai/claude-conversation-memory-mcp/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/xiaolai/claude-conversation-memory-mcp/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/xiaolai/claude-conversation-memory-mcp/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/xiaolai/claude-conversation-memory-mcp/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/xiaolai/claude-conversation-memory-mcp/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/xiaolai/claude-conversation-memory-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/xiaolai/claude-conversation-memory-mcp/compare/v0.2.5...v1.0.0
[0.2.5]: https://github.com/xiaolai/claude-conversation-memory-mcp/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/xiaolai/claude-conversation-memory-mcp/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/xiaolai/claude-conversation-memory-mcp/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/xiaolai/claude-conversation-memory-mcp/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/xiaolai/claude-conversation-memory-mcp/releases/tag/v0.2.1
[0.2.0]: https://github.com/xiaolai/claude-conversation-memory-mcp/releases/tag/v0.2.0
