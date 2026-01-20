# Codex Plan Template

Use this template for `full-plan` mode unless a repo provides `docs/codex-plans/TEMPLATE.md`.

---
title: "cccmemory indexing robustness + migrations + CI fixes"
created_at: "2026-01-19 20:07 local"
mode: "full-plan"
---

## Outcomes

- Desired behavior:
  - Indexing succeeds without FK failures even when tool_result/tool_use data are incomplete or sidechain-only.
  - New DBs record the latest schema version; existing DBs can migrate to include working_memory/session_* tables.
  - Incremental parser reliably returns newly appended lines even when mtime granularity is coarse.
  - CI passes (Security Scan + Node 20/22 tests).
- Constraints:
  - Keep existing public APIs/tools stable.
  - No data loss on existing DBs; migrations must be additive.
- Non-goals:
  - Rewriting the entire parsing pipeline or switching storage engine.
  - Reworking embedding providers or model selection.

## Constraints & Dependencies

- Runtime/toolchain versions: Node.js 20/22 LTS, npm.
- OS/platform assumptions: macOS + Linux (CI on ubuntu-latest).
- External services: none required; optional OpenAI/Ollama embeddings.
- Required environment variables / secrets: none for core; OPENAI_API_KEY optional.
- Feature flags: none.

## Current Behavior Inventory

- Entry points:
  - `ConversationMemory.indexConversations` orchestrates parse/store/extract/search indexing.
  - `ToolHandlers.indexConversations` and `index_all_projects` trigger indexing.
- Data flow:
  - `ConversationParser` parses JSONL → conversations/messages/tool calls/file edits/thinking.
  - `ConversationStorage` stores entities with FK constraints.
- Persistence:
  - per-project SQLite DBs with schema.sql; global index in `~/.claude/.cccmemory-global.db`.
- Known invariants:
  - `tool_results.tool_use_id` must reference `tool_uses.id`.
  - `tool_uses.message_id` / `tool_results.message_id` must reference `messages.id`.
  - `file_edits.message_id` must reference `messages.id`.
  - `schema_version` should reflect latest schema.

## Target Rules

- Only store tool uses/results for messages that are actually stored in `messages`.
- Never insert `tool_use` without a non-empty id.
- Never insert `tool_result` unless its `tool_use_id` exists in the same parse result or DB.
- Incremental parsing must detect new data using size/offset even when mtime is unchanged.
- New DBs should be stamped with latest schema version; existing DBs should apply all pending migrations.

## Decision Log

- D1:
  - Options:
    - Keep custom migration logic in `SQLiteManager` and add v5 manually.
    - Use `MigrationManager` as the single migration path.
  - Decision: Use `MigrationManager` as the primary migration path, and stamp new DBs with latest version.
  - Rationale: Avoids drift between schema.sql and SQLiteManager, and centralizes versioning.
  - Rejected alternatives: Continuing manual migrations (risk of drift, already happening).

## Open Questions

- Q1:
  - Why it matters: Whether to add DB-level FK softening (skip orphans) in storage layer for tool_results.
  - Who decides: Xiaolai.
  - Default if unresolved: Add parser-level filtering only (no DB-level relaxation).

## Data Model (if applicable)

- Tables/keys/columns:
  - Ensure schema_version reflects v5 when schema.sql already creates working_memory/session_* tables.
- Versions:
  - Latest is v5 in migrations list.
- Compatibility:
  - Additive only; no drops or destructive changes.

## API / Contract Changes (if applicable)

- Tool/schema changes: none.
- Backward compatibility: preserved.
- Versioning strategy: update schema version in db and apply migrations.

## Observability (if applicable)

- Metrics: none.
- Logs: retain existing console.error logging; add warnings on skipped tool rows if needed.
- Debug toggles: none.

## Work Items

### WI-001: Fix parser FK safety for tool calls

- Goal: Avoid FK failures by only emitting tool rows for stored messages and valid tool ids.
- Acceptance (measurable): Indexing with sidechain-only tool_result/tool_use does not throw FK errors; tool results only stored when tool_use exists.
- Tests (first):
  - File(s): `src/__tests__/unit/ConversationParser.test.ts` (new)
  - Intent: parser skips tool results without matching tool_use; skips tool_uses with missing id; skips tool calls for messages lacking sessionId.
- Touched areas:
  - File(s): `src/parsers/ConversationParser.ts`
  - Symbols: `extractToolCalls`
- Dependencies: none.
- Risks + mitigations: risk of dropping useful tool results; mitigate via logging or future DB-side checks.
- Rollback: revert parser changes.
- Estimate: S

### WI-002: Make IncrementalParser robust to mtime granularity and truncation

- Goal: Detect appended lines even when file mtime is unchanged; handle truncation resets safely.
- Acceptance (measurable): `IncrementalParser.test.ts` passes consistently on CI; second read returns new lines.
- Tests (first):
  - File(s): `src/__tests__/unit/IncrementalParser.test.ts`
  - Intent: existing test passes; add case for truncation if needed.
- Touched areas:
  - File(s): `src/realtime/IncrementalParser.ts`
  - Symbols: `parseNewContent`.
- Dependencies: none.
- Risks + mitigations: performance regressions if always reading full file; mitigate by using size/offset.
- Rollback: revert to mtime-only logic.
- Estimate: S

### WI-003: Align migrations and schema versioning

- Goal: Ensure new DBs are stamped with latest schema version; existing DBs apply v5 migrations.
- Acceptance (measurable): `working_memory` table exists after migrate; `schema_version` max equals latest migration.
- Tests (first):
  - File(s): `src/__tests__/unit/ProjectMigration.test.ts` or new migration tests
  - Intent: fresh DB has schema_version at latest; migrating DB adds working_memory table.
- Touched areas:
  - File(s): `src/storage/SQLiteManager.ts`, `src/storage/migrations.ts`
  - Symbols: `initializeSchema`, `applyMigrations`.
- Dependencies: none.
- Risks + mitigations: double-apply migrations; mitigate by using schema_version and MigrationManager.
- Rollback: restore previous applyMigrations logic.
- Estimate: M

### WI-004: CI Security Scan fix

- Goal: Pass Security Scan by addressing vulnerable dependency.
- Acceptance (measurable): `npm audit --audit-level=high` succeeds in CI.
- Tests (first):
  - File(s): none; run `npm audit`.
  - Intent: audit clean for high severity.
- Touched areas:
  - File(s): `package.json`, `package-lock.json`
- Dependencies: none.
- Risks + mitigations: potential API changes in SDK; mitigate by pinning to compatible patch version.
- Rollback: revert dependency update.
- Estimate: S

## Testing Procedures

- Fast checks:
  - `npm test -- IncrementalParser.test.ts`
  - `npm test -- ConversationParser.test.ts` (if added)
- Full gate:
  - `npm test`
  - `npm run lint`
  - `npm run build`
  - `npm audit --audit-level=high`
- When to run each:
  - After each WI and before pushing.

## Rollout Plan (if applicable)

- Feature flags: none.
- Staging steps: merge to main, publish package.
- Kill switch / revert steps: revert commit; re-publish previous version.

## Manual Test Checklist

- [ ] Index a project with sidechain tool calls → no FK failures.
- [ ] Incremental watch on a JSONL file detects new appended line even with rapid writes.
- [ ] DB shows working_memory table after migration.
- [ ] CI Security Scan passes.
