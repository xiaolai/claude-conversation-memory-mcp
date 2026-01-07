-- CCCMemory Database Schema
-- Version: 1.0.0
-- Optimized for SQLite + sqlite-vec

-- ==================================================
-- CORE TABLES
-- ==================================================

-- Table 1: Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,                    -- sessionId from JSONL
  project_path TEXT NOT NULL,             -- Derived from directory name
  source_type TEXT DEFAULT 'claude-code', -- 'claude-code' or 'codex'
  first_message_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  git_branch TEXT,                        -- Most recent branch
  claude_version TEXT,                    -- Most recent version
  metadata TEXT,                          -- JSON: {cwd, tags}
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conv_project ON conversations(project_path);
CREATE INDEX IF NOT EXISTS idx_conv_source ON conversations(source_type);
CREATE INDEX IF NOT EXISTS idx_conv_time ON conversations(last_message_at);
CREATE INDEX IF NOT EXISTS idx_conv_branch ON conversations(git_branch);
CREATE INDEX IF NOT EXISTS idx_conv_created ON conversations(created_at);

-- Table 2: Messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,                    -- uuid from JSONL
  conversation_id TEXT NOT NULL,
  parent_id TEXT,                         -- parentUuid (threading)
  message_type TEXT NOT NULL,             -- user/assistant/system/summary/file-history-snapshot
  role TEXT,                              -- user/assistant (for user/assistant types)
  content TEXT,                           -- Main message content
  timestamp INTEGER NOT NULL,
  is_sidechain INTEGER DEFAULT 0,         -- Agent messages (boolean as integer)
  agent_id TEXT,                          -- For agent messages
  request_id TEXT,                        -- API request ID
  git_branch TEXT,
  cwd TEXT,
  metadata TEXT,                          -- JSON: full message metadata
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_msg_parent ON messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_msg_type ON messages(message_type);
CREATE INDEX IF NOT EXISTS idx_msg_time ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_msg_conv_time ON messages(conversation_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_msg_role ON messages(role);

-- Table 3: Tool Uses
CREATE TABLE IF NOT EXISTS tool_uses (
  id TEXT PRIMARY KEY,                    -- tool_use_id (toolu_xxx)
  message_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,                -- Bash, Read, Write, Edit, etc.
  tool_input TEXT NOT NULL,               -- JSON parameters
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tool_msg ON tool_uses(message_id);
CREATE INDEX IF NOT EXISTS idx_tool_name ON tool_uses(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_time ON tool_uses(timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_name_time ON tool_uses(tool_name, timestamp);

-- Table 4: Tool Results
CREATE TABLE IF NOT EXISTS tool_results (
  id TEXT PRIMARY KEY,
  tool_use_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  content TEXT,
  is_error INTEGER DEFAULT 0,             -- Boolean as integer
  stdout TEXT,
  stderr TEXT,
  is_image INTEGER DEFAULT 0,             -- Boolean as integer
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (tool_use_id) REFERENCES tool_uses(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_result_tool ON tool_results(tool_use_id);
CREATE INDEX IF NOT EXISTS idx_result_msg ON tool_results(message_id);
CREATE INDEX IF NOT EXISTS idx_result_error ON tool_results(is_error);

-- Table 5: File Edits
CREATE TABLE IF NOT EXISTS file_edits (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  message_id TEXT NOT NULL,
  backup_version INTEGER,
  backup_time INTEGER,
  snapshot_timestamp INTEGER NOT NULL,
  metadata TEXT,                          -- JSON from trackedFileBackups
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edit_file ON file_edits(file_path);
CREATE INDEX IF NOT EXISTS idx_edit_conv ON file_edits(conversation_id);
CREATE INDEX IF NOT EXISTS idx_edit_time ON file_edits(snapshot_timestamp);
CREATE INDEX IF NOT EXISTS idx_edit_file_time ON file_edits(file_path, snapshot_timestamp);

-- Table 6: Thinking Blocks
CREATE TABLE IF NOT EXISTS thinking_blocks (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  thinking_content TEXT NOT NULL,
  signature TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_think_msg ON thinking_blocks(message_id);

-- ==================================================
-- ENHANCED MEMORY TABLES
-- ==================================================

-- Table 7: Decisions (Critical for preventing regressions)
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  decision_text TEXT NOT NULL,
  rationale TEXT,
  alternatives_considered TEXT,           -- JSON array
  rejected_reasons TEXT,                  -- JSON object
  context TEXT,                           -- What feature/area
  related_files TEXT,                     -- JSON array
  related_commits TEXT,                   -- JSON array (git hashes)
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decision_conv ON decisions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_decision_time ON decisions(timestamp);
CREATE INDEX IF NOT EXISTS idx_decision_context ON decisions(context);

-- Table 8: Git Commits (Essential for linking code to conversations)
CREATE TABLE IF NOT EXISTS git_commits (
  hash TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  author TEXT,
  timestamp INTEGER NOT NULL,
  branch TEXT,
  files_changed TEXT,                     -- JSON array
  conversation_id TEXT,                   -- Linked conversation
  related_message_id TEXT,                -- Message that led to commit
  metadata TEXT,                          -- JSON: stats, etc.
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  FOREIGN KEY (related_message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_commit_conv ON git_commits(conversation_id);
CREATE INDEX IF NOT EXISTS idx_commit_time ON git_commits(timestamp);
CREATE INDEX IF NOT EXISTS idx_commit_branch ON git_commits(branch);

-- Table 9: Mistakes (Learning from errors)
CREATE TABLE IF NOT EXISTS mistakes (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  mistake_type TEXT NOT NULL,             -- logic_error, wrong_approach, misunderstanding
  what_went_wrong TEXT NOT NULL,
  correction TEXT,
  user_correction_message TEXT,
  files_affected TEXT,                    -- JSON array
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mistake_conv ON mistakes(conversation_id);
CREATE INDEX IF NOT EXISTS idx_mistake_type ON mistakes(mistake_type);
CREATE INDEX IF NOT EXISTS idx_mistake_time ON mistakes(timestamp);

-- Table 10: File Evolution (Timeline tracking)
CREATE TABLE IF NOT EXISTS file_evolution (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  change_summary TEXT,
  decision_ids TEXT,                      -- JSON array
  commit_hash TEXT,
  fixes_mistake_id TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (commit_hash) REFERENCES git_commits(hash) ON DELETE SET NULL,
  FOREIGN KEY (fixes_mistake_id) REFERENCES mistakes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_evolution_file ON file_evolution(file_path);
CREATE INDEX IF NOT EXISTS idx_evolution_time ON file_evolution(timestamp);
CREATE INDEX IF NOT EXISTS idx_evolution_file_time ON file_evolution(file_path, timestamp);

-- Table 11: Requirements (Constraints tracking)
CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                     -- dependency, performance, compatibility, business
  description TEXT NOT NULL,
  rationale TEXT,
  affects_components TEXT,                -- JSON array
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_req_type ON requirements(type);
CREATE INDEX IF NOT EXISTS idx_req_conv ON requirements(conversation_id);

-- Table 12: Validations (Testing context)
CREATE TABLE IF NOT EXISTS validations (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  what_was_tested TEXT NOT NULL,
  test_command TEXT,
  result TEXT NOT NULL,                   -- passed, failed, error
  performance_data TEXT,                  -- JSON
  files_tested TEXT,                      -- JSON array
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_valid_conv ON validations(conversation_id);
CREATE INDEX IF NOT EXISTS idx_valid_result ON validations(result);

-- Table 13: User Preferences (Pattern learning)
CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,                 -- coding_style, architecture, tooling
  preference TEXT NOT NULL,
  rationale TEXT,
  examples TEXT,                          -- JSON array of conversation_ids
  established_date INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pref_category ON user_preferences(category);

-- ==================================================
-- VECTOR & SEARCH TABLES
-- ==================================================

-- Table 14: Message Embeddings (for semantic search)
CREATE TABLE IF NOT EXISTS message_embeddings (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB NOT NULL,
  model_name TEXT DEFAULT 'all-MiniLM-L6-v2',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_embed_msg ON message_embeddings(message_id);

-- Table 15: Decision Embeddings
CREATE TABLE IF NOT EXISTS decision_embeddings (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  embedding BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dec_embed ON decision_embeddings(decision_id);

-- Table 16: Mistake Embeddings (for semantic search of mistakes)
CREATE TABLE IF NOT EXISTS mistake_embeddings (
  id TEXT PRIMARY KEY,
  mistake_id TEXT NOT NULL,
  embedding BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mistake_embed ON mistake_embeddings(mistake_id);

-- Table 17: Full-Text Search Index for Messages
-- NOTE: Column names must match the messages table exactly for external content mode
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  id UNINDEXED,
  content,
  metadata,
  content=messages,
  content_rowid=rowid
);

-- Table 18: Full-Text Search Index for Decisions
CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
  id UNINDEXED,
  decision_text,
  rationale,
  context,
  content=decisions,
  content_rowid=rowid
);

-- Table 19: Full-Text Search Index for Mistakes (standalone, not content-synced)
CREATE VIRTUAL TABLE IF NOT EXISTS mistakes_fts USING fts5(
  id,
  what_went_wrong,
  correction,
  mistake_type
);

-- ==================================================
-- PERFORMANCE & CACHING
-- ==================================================

-- Query Cache (Performance optimization)
CREATE TABLE IF NOT EXISTS query_cache (
  cache_key TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  hit_count INTEGER DEFAULT 0,
  last_accessed INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cache_expires ON query_cache(expires_at);

-- ==================================================
-- METADATA TABLE
-- ==================================================

-- Schema Version Tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT,
  checksum TEXT
);

-- ==================================================
-- GLOBAL INDEX TABLE (for cross-project search)
-- ==================================================

-- Table 18: Project Metadata (Global registry of all indexed projects)
CREATE TABLE IF NOT EXISTS project_metadata (
  id TEXT PRIMARY KEY,                    -- UUID for project entry
  project_path TEXT NOT NULL UNIQUE,      -- Absolute path to project
  source_type TEXT NOT NULL,              -- 'claude-code' or 'codex'
  db_path TEXT NOT NULL,                  -- Path to project's database
  last_indexed INTEGER NOT NULL,          -- Last indexing timestamp
  message_count INTEGER DEFAULT 0,        -- Total messages indexed
  conversation_count INTEGER DEFAULT 0,   -- Total conversations indexed
  decision_count INTEGER DEFAULT 0,       -- Total decisions indexed
  mistake_count INTEGER DEFAULT 0,        -- Total mistakes indexed
  metadata TEXT,                          -- JSON: {git_repo, last_commit, etc}
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proj_source ON project_metadata(source_type);
CREATE INDEX IF NOT EXISTS idx_proj_last_indexed ON project_metadata(last_indexed);
CREATE INDEX IF NOT EXISTS idx_proj_path ON project_metadata(project_path);

-- ==================================================
-- LIVE CONTEXT LAYER TABLES
-- ==================================================

-- Table 19: Working Memory (Key-value store for facts/context)
CREATE TABLE IF NOT EXISTS working_memory (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  context TEXT,
  tags TEXT,                          -- JSON array
  session_id TEXT,
  project_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  embedding BLOB,
  UNIQUE(project_path, key)
);

CREATE INDEX IF NOT EXISTS idx_wm_session ON working_memory(session_id);
CREATE INDEX IF NOT EXISTS idx_wm_project ON working_memory(project_path);
CREATE INDEX IF NOT EXISTS idx_wm_expires ON working_memory(expires_at);
CREATE INDEX IF NOT EXISTS idx_wm_key ON working_memory(key);
CREATE INDEX IF NOT EXISTS idx_wm_project_key ON working_memory(project_path, key);

-- Table 20: Session Handoffs (Context transfer between conversations)
CREATE TABLE IF NOT EXISTS session_handoffs (
  id TEXT PRIMARY KEY,
  from_session_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  handoff_data TEXT NOT NULL,         -- JSON with decisions, files, tasks, memory
  resumed_by_session_id TEXT,
  resumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_handoff_session ON session_handoffs(from_session_id);
CREATE INDEX IF NOT EXISTS idx_handoff_project ON session_handoffs(project_path);
CREATE INDEX IF NOT EXISTS idx_handoff_created ON session_handoffs(created_at);
CREATE INDEX IF NOT EXISTS idx_handoff_resumed ON session_handoffs(resumed_by_session_id);

-- Table 21: Session Checkpoints (Real-time progress tracking)
CREATE TABLE IF NOT EXISTS session_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  checkpoint_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  decisions TEXT,                     -- JSON array
  active_files TEXT,                  -- JSON array
  task_state TEXT,                    -- JSON
  context_summary TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_session ON session_checkpoints(session_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_project ON session_checkpoints(project_path);
CREATE INDEX IF NOT EXISTS idx_checkpoint_created ON session_checkpoints(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkpoint_session_num ON session_checkpoints(session_id, checkpoint_number);

-- Table 22: Full-Text Search Index for Working Memory
CREATE VIRTUAL TABLE IF NOT EXISTS working_memory_fts USING fts5(
  id UNINDEXED,
  key,
  value,
  context,
  content=working_memory,
  content_rowid=rowid
);
