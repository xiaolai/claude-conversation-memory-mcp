# Codex Plan Template

---
title: "Single-DB Redesign for CCCMemory"
created_at: "2026-01-20 06:55 local"
mode: "full-plan"
---

## Outcomes

- Desired behavior:
  - Store all Claude + Codex conversations in a **single SQLite database** while preserving per-project isolation via schema-level scoping (project + source).
  - Eliminate multi-DB fan-out for global search; single DB queries should handle both project-scoped and global searches.
  - Maintain incremental indexing per project/source; support two-agent workflows without ID collisions.
  - Preserve existing tool semantics or provide explicit backward-compatible shims.
- Constraints:
  - Single-user environment (no multi-tenant requirements).
  - Must remain compatible with read-only environments (search should still work).
  - Must keep migrations safe; allow “reindex-from-source” fallback if DB merge is risky.
- Non-goals:
  - Multi-user permissions, ACLs, or per-user data segregation.
  - Rewriting the parsers’ JSONL formats.

## Constraints & Dependencies

- Runtime/toolchain versions: Node >= 20; SQLite via better-sqlite3; sqlite-vec optional.
- OS/platform assumptions: macOS (paths under `~/.claude/projects` and `~/.codex`).
- External services: optional embeddings (Transformers.js / OpenAI / Ollama).
- Required environment variables / secrets:
  - `CCCMEMORY_DB_PATH` (single DB path override).
  - Optional new `CCCMEMORY_DB_MODE=single|per-project` for compatibility.
- Feature flags:
  - New mode flag to keep per-project DBs during transition.

## Current Behavior Inventory

- Entry points:
  - `src/tools/ToolHandlers.ts` (MCP tools, indexing, search, cross-project aggregation)
  - `src/ConversationMemory.ts` (high-level API)
  - `src/cli/commands.ts` (CLI status/reset/vacuum)
- Data flow:
  - Parse JSONL → `ConversationStorage` inserts → `SemanticSearch` generates embeddings → `GlobalIndex` registers project DBs.
- Persistence:
  - Per-project DBs in `~/.claude/projects/<sanitized>/.cccmemory.db`.
  - Global registry DB at `~/.claude/.cccmemory-global.db`.
- Known invariants:
  - IDs (sessionId, message uuid, tool ids) are only unique within a project DB.
  - Cross-project search opens many read-only DBs and merges results.

## Target Rules

1. **Single DB authority**: All persisted data lives in one SQLite DB; no per-project DBs used in single mode.
2. **Project scoping**: Every conversation/message/tool/decision/mistake is scoped by `project_id` + `source_type` (or equivalent), preventing ID collisions.
3. **Stable external IDs**: External IDs from JSONL are stored as `external_id` fields; internal PKs used for joins.
4. **Search semantics**:
   - Project-scoped searches filter by `project_id` (and `source_type` when requested).
   - Global search runs single DB queries and includes `project_path` + `source_type` in results.
5. **Incremental indexing**: Track `last_indexed` per `(project_id, source_type)` to support incremental parse.
6. **Read-only safety**: In read-only mode, search still works with FTS fallback; no writes or schema changes.
7. **Embeddings model stability**:
   - If embedding dimensions change, the system must either create model-specific vec tables or fallback to BLOB+FTS for incompatible dims.
8. **Project rename**: Renames update `projects.canonical_path` and preserve prior path in `project_aliases` (or equivalent) to avoid broken references.

## Decision Log

- D1:
  - Options:
    - A) Keep per-project DBs + global index (status quo)
    - B) Single DB with **namespaced string IDs** (prefix project/source to IDs)
    - C) Single DB with **internal integer PKs** + external IDs
  - Decision: C) Single DB with internal PKs and explicit project scoping.
  - Rationale: Most robust against ID collisions, enables smaller indexes, and avoids accidental external ID reuse.
  - Rejected alternatives:
    - A keeps multi-DB complexity and read-only vec warnings.
    - B minimizes schema changes but still leaks collision risk if prefixing is inconsistent and complicates external ID handling.
- D2:
  - Options:
    - A) Return internal PKs in tool responses
    - B) Return external IDs with `project_path` + `source_type` (no internal PKs)
  - Decision: B) Keep external IDs in responses and disambiguate with `project_path` + `source_type`.
  - Rationale: Preserves existing API expectations while remaining unambiguous in a single DB.
  - Rejected alternatives:
    - A exposes internal IDs to clients and complicates backwards compatibility.

## Open Questions

- None (decided D2).

## Data Model (if applicable)

Proposed **single DB schema** (delta from current):

- `projects`
  - `id INTEGER PRIMARY KEY`
  - `canonical_path TEXT UNIQUE NOT NULL`
  - `display_path TEXT` (optional)
  - `git_root TEXT` (optional)
  - `metadata TEXT` (JSON)
  - `created_at INTEGER`, `updated_at INTEGER`
- `project_sources` (indexing state)
  - `id INTEGER PRIMARY KEY`
  - `project_id INTEGER NOT NULL`
  - `source_type TEXT NOT NULL` (claude-code|codex)
  - `source_root TEXT` (e.g. `~/.claude/projects/<sanitized>`)
  - `last_indexed INTEGER NOT NULL`
  - `message_count INTEGER`, `conversation_count INTEGER`, `decision_count INTEGER`, `mistake_count INTEGER`
  - `metadata TEXT` (JSON)
  - `UNIQUE(project_id, source_type)`
- `project_aliases`
  - `alias_path TEXT PRIMARY KEY`
  - `project_id INTEGER NOT NULL`
  - `created_at INTEGER`

- `conversations`
  - `id INTEGER PRIMARY KEY`
  - `project_id INTEGER NOT NULL`
  - `source_type TEXT NOT NULL`
  - `external_id TEXT NOT NULL` (sessionId)
  - `UNIQUE(project_id, source_type, external_id)`

- `messages`
  - `id INTEGER PRIMARY KEY`
  - `conversation_id INTEGER NOT NULL`
  - `external_id TEXT NOT NULL` (uuid)
  - `parent_message_id INTEGER` (FK)
  - `parent_external_id TEXT` (transient for import)
  - `UNIQUE(conversation_id, external_id)`

- `tool_uses`/`tool_results`
  - Internal `id INTEGER` PK
  - `external_id TEXT` + `UNIQUE(message_id, external_id)` for `tool_uses`

- `git_commits`
  - `id INTEGER PRIMARY KEY`
  - `project_id INTEGER NOT NULL`
  - `hash TEXT NOT NULL`
  - `UNIQUE(project_id, hash)`

- `working_memory`, `session_handoffs`, `session_checkpoints`
  - Replace `project_path` with `project_id` + join for path.

- FTS + vec tables:
  - Keep content=messages with rowid = `messages.id`.
  - Vec tables keyed by `messages.id` / `decisions.id` / `mistakes.id`.

## Migration Plan

-- Strategy A (recommended): **Reindex from JSONL** into the single DB (only)
  - Remove reliance on per-project DBs.
  - Guarantees clean schema with new PKs.

### Roll-forward steps

1. Create single DB schema + migrations.
2. Build `projects` + `project_sources` from:
   - canonical project paths (from JSONL metadata or cwd)
   - source type (claude-code or codex)
3. Reindex JSONL into single DB, storing external IDs.
4. Build vec tables and embeddings.

### Rollback

- If single DB fails, revert to per-project DB mode (`CCCMEMORY_DB_MODE=per-project`).
- Keep old DB files until migration is verified.

### Invariants + validation queries

- No duplicate `(project_id, source_type, external_id)` in conversations.
- No messages without parent conversation.
- `project_sources.last_indexed` monotonic per source.
- FTS row counts match `messages` count.

## API / Contract Changes (if applicable)

- Tool responses should include `project_path` + `source_type` on all results.
- For tools that accept `conversation_id` or `message_id`, add optional `project_path` (and `source_type`) to disambiguate.
- Optional: return `conversation_ref` (composite) for future stability.

## Observability (if applicable)

- Metrics:
  - Indexing throughput (messages/sec)
  - Global DB size (bytes)
  - Search latency (P50/P95)
- Logs:
  - Per project/source indexing summary
  - Migration summary
- Debug toggles:
  - `CCCMEMORY_VERBOSE_DB=1` for query logging

## Work Items

### WI-001: Single-DB schema + path resolution

- Goal: Add new schema tables and ensure SQLiteManager defaults to a single DB path.
- Acceptance (measurable):
  - Single DB path resolved deterministically; schema includes new tables; migrations succeed.
- Tests (first):
  - File(s): `src/__tests__/integration/migration.test.ts`
  - Intent: Create new DB, assert tables exist and migrations apply.
- Touched areas:
  - File(s): `src/storage/schema.sql`, `src/storage/migrations.ts`, `src/storage/SQLiteManager.ts`
  - Symbols: `resolveDbPath`, migration runner
- Dependencies: none
- Risks + mitigations:
  - Risk: Breaking default path for existing users → Mitigate with `CCCMEMORY_DB_MODE` flag.
- Rollback: revert path resolution to per-project mode.
- Estimate: M

### WI-002: Project registry inside single DB

- Goal: Replace `GlobalIndex` with in-DB project registry (`projects` + `project_sources`).
- Acceptance (measurable):
  - `indexConversations` updates `project_sources` in single DB; no `.cccmemory-global.db` created.
- Tests (first):
  - File(s): `src/__tests__/unit/GlobalIndex.test.ts` (replace) or new `ProjectRegistry.test.ts`
  - Intent: register project, update counts, read back.
- Touched areas:
  - File(s): `src/storage/GlobalIndex.ts`, `src/tools/ToolHandlers.ts`, `src/types/ToolTypes.ts`
- Dependencies: WI-001
- Risks + mitigations:
  - Risk: Breaking cross-project search → Mitigate by updating search to use single DB with filters.
- Rollback: keep old GlobalIndex behind feature flag.
- Estimate: M

### WI-003: ID scoping + storage layer updates

- Goal: Introduce internal PKs and map external IDs for all entities.
- Acceptance (measurable):
  - Insertions succeed even when external IDs collide across projects.
- Tests (first):
  - File(s): `src/__tests__/unit/ConversationStorage.test.ts`
  - Intent: insert two projects with same session/message IDs; ensure both persist.
- Touched areas:
  - File(s): `src/storage/ConversationStorage.ts`, `src/parsers/ConversationParser.ts`, `src/parsers/CodexConversationParser.ts`
- Dependencies: WI-001
- Risks + mitigations:
  - Risk: Parent message linking fails → Mitigate with post-insert fix-up pass.
- Rollback: revert schema and mapping layer.
- Estimate: L

### WI-004: Search + embeddings on single DB

- Goal: Update semantic search + vector store to use internal IDs and single DB.
- Acceptance (measurable):
  - FTS + vector search return results with correct project scoping.
- Tests (first):
  - File(s): `src/__tests__/unit/SemanticSearch.test.ts`, `src/__tests__/unit/VectorStore.test.ts`
  - Intent: search across two projects; ensure results segregated.
- Touched areas:
  - File(s): `src/search/SemanticSearch.ts`, `src/embeddings/VectorStore.ts`
- Dependencies: WI-003
- Risks + mitigations:
  - Risk: embedding dimension mismatch → Mitigate with model-specific vec tables or BLOB fallback.
- Rollback: disable vec tables and use FTS only.
- Estimate: M

### WI-005: ToolHandlers + CLI single-DB behavior

- Goal: Remove multi-DB fan-out and simplify tools to single DB queries.
- Acceptance (measurable):
  - `search_all_*` functions operate in one DB; no per-project DB opens.
- Tests (first):
  - File(s): `src/__tests__/unit/ToolHandlers.test.ts`
  - Intent: verify `search_all_conversations` uses single DB and returns mixed project results.
- Touched areas:
  - File(s): `src/tools/ToolHandlers.ts`, `src/cli/commands.ts`, `src/cli/help.ts`
- Dependencies: WI-002, WI-003
- Risks + mitigations:
  - Risk: breaking existing command output → Mitigate with compatibility fields.
- Rollback: retain old tool paths under feature flag.
- Estimate: M

### WI-006: Project migration/rename under single DB

- Goal: Replace filesystem DB copy/merge with project-path updates and aliasing.
- Acceptance (measurable):
  - Renamed projects still resolve and old paths are mapped.
- Tests (first):
  - File(s): `src/__tests__/unit/ProjectMigration.test.ts`
  - Intent: rename project path and ensure queries still find data.
- Touched areas:
  - File(s): `src/utils/ProjectMigration.ts`
- Dependencies: WI-002
- Risks + mitigations:
  - Risk: orphaned data after rename → Mitigate via alias table.
- Rollback: keep legacy behavior for per-project mode.
- Estimate: M

### WI-007: Migration tooling (reindex vs import)

- Goal: Provide a safe migration path to single DB.
- Acceptance (measurable):
  - A command/tool migrates data into single DB via reindex-from-JSONL.
- Tests (first):
  - File(s): `src/__tests__/integration/end-to-end.test.ts`
  - Intent: create JSONL fixtures, run migration, verify counts.
- Touched areas:
  - File(s): `src/tools/ToolHandlers.ts`, `src/types/ToolTypes.ts`, `src/cli/commands.ts`
- Dependencies: WI-001–WI-005
- Risks + mitigations:
  - Risk: slow migration on large datasets → Mitigate by incremental import and progress logging.
- Rollback: keep per-project DBs and disable migration.
- Estimate: L

## Testing Procedures

- Fast checks:
  - `npm test -- src/__tests__/unit/ConversationStorage.test.ts`
  - `npm test -- src/__tests__/unit/SemanticSearch.test.ts`
- Full gate:
  - `npm test`
  - `npm run build`
- When to run each:
  - Fast checks per WI, full gate before rollout.

## Rollout Plan (if applicable)

- Feature flags:
  - `CCCMEMORY_DB_MODE=single|per-project`.
- Staging steps:
  1. Default to `per-project` but allow opt-in `single`.
  2. Add migration tool and verify on sample data.
  3. Switch default to `single` after stable release.
- Kill switch / revert steps:
  - Flip mode back to `per-project` and keep old DBs.

## Manual Test Checklist

- [ ] Index two projects with colliding session IDs; verify both searchable.
- [ ] Search global and project-scoped queries; validate `project_path` filtering.
- [ ] Verify rename migration updates project path.
- [ ] Confirm embeddings generated and vec tables usable.

## Plan → Verify Handoff

- Evidence to collect per WI:
  - WI-001: migration logs + table existence queries.
  - WI-002: project registry records in DB.
  - WI-003: collision test output + row counts.
  - WI-004: search result samples + embedding logs.
  - WI-005: tool output comparisons before/after.
  - WI-006: rename test results.
  - WI-007: migration command output + counts.
