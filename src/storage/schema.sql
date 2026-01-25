-- CCCMemory Database Schema
-- Single-DB layout (projects + sources + scoped entities)
-- Optimized for SQLite + sqlite-vec

-- ==================================================
-- PROJECT REGISTRY
-- ==================================================

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  canonical_path TEXT NOT NULL UNIQUE,
  display_path TEXT,
  git_root TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(canonical_path);

CREATE TABLE IF NOT EXISTS project_sources (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,              -- 'claude-code' or 'codex'
  source_root TEXT,                       -- ~/.claude/projects/... or ~/.codex/...
  last_indexed INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  conversation_count INTEGER DEFAULT 0,
  decision_count INTEGER DEFAULT 0,
  mistake_count INTEGER DEFAULT 0,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, source_type),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_proj_source_type ON project_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_proj_source_last_indexed ON project_sources(last_indexed);

CREATE TABLE IF NOT EXISTS project_aliases (
  alias_path TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ==================================================
-- CORE TABLES
-- ==================================================

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  project_path TEXT NOT NULL,             -- Denormalized for fast access
  source_type TEXT NOT NULL,
  external_id TEXT NOT NULL,              -- sessionId from JSONL
  first_message_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  git_branch TEXT,
  claude_version TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, source_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conv_project_path ON conversations(project_path);
CREATE INDEX IF NOT EXISTS idx_conv_source ON conversations(source_type);
CREATE INDEX IF NOT EXISTS idx_conv_time ON conversations(last_message_at);
CREATE INDEX IF NOT EXISTS idx_conv_branch ON conversations(git_branch);
CREATE INDEX IF NOT EXISTS idx_conv_created ON conversations(created_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  external_id TEXT NOT NULL,              -- uuid from JSONL
  parent_message_id INTEGER,              -- internal parent id
  parent_external_id TEXT,                -- external parent id (for import)
  message_type TEXT NOT NULL,
  role TEXT,
  content TEXT,
  timestamp INTEGER NOT NULL,
  is_sidechain INTEGER DEFAULT 0,
  agent_id TEXT,
  request_id TEXT,
  git_branch TEXT,
  cwd TEXT,
  metadata TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  UNIQUE(conversation_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_msg_parent ON messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_msg_type ON messages(message_type);
CREATE INDEX IF NOT EXISTS idx_msg_time ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_msg_conv_time ON messages(conversation_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_msg_role ON messages(role);

CREATE TABLE IF NOT EXISTS tool_uses (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  UNIQUE(message_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_tool_msg ON tool_uses(message_id);
CREATE INDEX IF NOT EXISTS idx_tool_name ON tool_uses(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_time ON tool_uses(timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_name_time ON tool_uses(tool_name, timestamp);

CREATE TABLE IF NOT EXISTS tool_results (
  id INTEGER PRIMARY KEY,
  tool_use_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  external_id TEXT,
  content TEXT,
  is_error INTEGER DEFAULT 0,
  stdout TEXT,
  stderr TEXT,
  is_image INTEGER DEFAULT 0,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (tool_use_id) REFERENCES tool_uses(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  UNIQUE(tool_use_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_result_tool ON tool_results(tool_use_id);
CREATE INDEX IF NOT EXISTS idx_result_msg ON tool_results(message_id);
CREATE INDEX IF NOT EXISTS idx_result_error ON tool_results(is_error);

CREATE TABLE IF NOT EXISTS file_edits (
  id INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL,
  conversation_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  backup_version INTEGER,
  backup_time INTEGER,
  snapshot_timestamp INTEGER NOT NULL,
  metadata TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  UNIQUE(conversation_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_edit_file ON file_edits(file_path);
CREATE INDEX IF NOT EXISTS idx_edit_conv ON file_edits(conversation_id);
CREATE INDEX IF NOT EXISTS idx_edit_time ON file_edits(snapshot_timestamp);
CREATE INDEX IF NOT EXISTS idx_edit_file_time ON file_edits(file_path, snapshot_timestamp);

CREATE TABLE IF NOT EXISTS thinking_blocks (
  id INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  thinking_content TEXT NOT NULL,
  signature TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  UNIQUE(message_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_think_msg ON thinking_blocks(message_id);

-- ==================================================
-- ENHANCED MEMORY TABLES
-- ==================================================

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL,
  conversation_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  decision_text TEXT NOT NULL,
  rationale TEXT,
  alternatives_considered TEXT,
  rejected_reasons TEXT,
  context TEXT,
  related_files TEXT,
  related_commits TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  UNIQUE(conversation_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_decision_conv ON decisions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_decision_time ON decisions(timestamp);
CREATE INDEX IF NOT EXISTS idx_decision_context ON decisions(context);

CREATE TABLE IF NOT EXISTS git_commits (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  hash TEXT NOT NULL,
  message TEXT NOT NULL,
  author TEXT,
  timestamp INTEGER NOT NULL,
  branch TEXT,
  files_changed TEXT,
  conversation_id INTEGER,
  related_message_id INTEGER,
  metadata TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  FOREIGN KEY (related_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  UNIQUE(project_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_commit_project ON git_commits(project_id);
CREATE INDEX IF NOT EXISTS idx_commit_conv ON git_commits(conversation_id);
CREATE INDEX IF NOT EXISTS idx_commit_time ON git_commits(timestamp);
CREATE INDEX IF NOT EXISTS idx_commit_branch ON git_commits(branch);

CREATE TABLE IF NOT EXISTS mistakes (
  id INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL,
  conversation_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  mistake_type TEXT NOT NULL,
  what_went_wrong TEXT NOT NULL,
  correction TEXT,
  user_correction_message TEXT,
  files_affected TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  UNIQUE(conversation_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_mistake_conv ON mistakes(conversation_id);
CREATE INDEX IF NOT EXISTS idx_mistake_type ON mistakes(mistake_type);
CREATE INDEX IF NOT EXISTS idx_mistake_time ON mistakes(timestamp);

CREATE TABLE IF NOT EXISTS file_evolution (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  conversation_id INTEGER NOT NULL,
  change_summary TEXT,
  decision_ids TEXT,
  commit_hash TEXT,
  fixes_mistake_id INTEGER,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (fixes_mistake_id) REFERENCES mistakes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_evolution_file ON file_evolution(file_path);
CREATE INDEX IF NOT EXISTS idx_evolution_time ON file_evolution(timestamp);
CREATE INDEX IF NOT EXISTS idx_evolution_file_time ON file_evolution(file_path, timestamp);

CREATE TABLE IF NOT EXISTS requirements (
  id INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  rationale TEXT,
  affects_components TEXT,
  conversation_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  UNIQUE(conversation_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_req_type ON requirements(type);
CREATE INDEX IF NOT EXISTS idx_req_conv ON requirements(conversation_id);

CREATE TABLE IF NOT EXISTS validations (
  id INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL,
  conversation_id INTEGER NOT NULL,
  what_was_tested TEXT NOT NULL,
  test_command TEXT,
  result TEXT NOT NULL,
  performance_data TEXT,
  files_tested TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  UNIQUE(conversation_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_valid_conv ON validations(conversation_id);
CREATE INDEX IF NOT EXISTS idx_valid_result ON validations(result);

CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  preference TEXT NOT NULL,
  rationale TEXT,
  examples TEXT,
  established_date INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pref_category ON user_preferences(category);

-- ==================================================
-- METHODOLOGY & RESEARCH TRACKING TABLES
-- ==================================================

CREATE TABLE IF NOT EXISTS methodologies (
  id TEXT PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  start_message_id INTEGER NOT NULL,
  end_message_id INTEGER NOT NULL,
  problem_statement TEXT NOT NULL,
  approach TEXT NOT NULL,
  steps_taken TEXT NOT NULL,
  tools_used TEXT NOT NULL,
  files_involved TEXT NOT NULL,
  outcome TEXT NOT NULL,
  what_worked TEXT,
  what_didnt_work TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (start_message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (end_message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_methodology_conv ON methodologies(conversation_id);
CREATE INDEX IF NOT EXISTS idx_methodology_approach ON methodologies(approach);
CREATE INDEX IF NOT EXISTS idx_methodology_outcome ON methodologies(outcome);
CREATE INDEX IF NOT EXISTS idx_methodology_started ON methodologies(started_at);

CREATE TABLE IF NOT EXISTS research_findings (
  id TEXT PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  topic TEXT NOT NULL,
  discovery TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_reference TEXT,
  relevance TEXT NOT NULL,
  confidence TEXT NOT NULL,
  related_to TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_conv ON research_findings(conversation_id);
CREATE INDEX IF NOT EXISTS idx_research_topic ON research_findings(topic);
CREATE INDEX IF NOT EXISTS idx_research_source ON research_findings(source_type);
CREATE INDEX IF NOT EXISTS idx_research_relevance ON research_findings(relevance);
CREATE INDEX IF NOT EXISTS idx_research_timestamp ON research_findings(timestamp);

CREATE TABLE IF NOT EXISTS solution_patterns (
  id TEXT PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  problem_category TEXT NOT NULL,
  problem_description TEXT NOT NULL,
  solution_summary TEXT NOT NULL,
  solution_steps TEXT NOT NULL,
  code_pattern TEXT,
  technology TEXT NOT NULL,
  prerequisites TEXT NOT NULL,
  applies_when TEXT NOT NULL,
  avoid_when TEXT,
  applied_to_files TEXT NOT NULL,
  effectiveness TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pattern_conv ON solution_patterns(conversation_id);
CREATE INDEX IF NOT EXISTS idx_pattern_category ON solution_patterns(problem_category);
CREATE INDEX IF NOT EXISTS idx_pattern_effectiveness ON solution_patterns(effectiveness);
CREATE INDEX IF NOT EXISTS idx_pattern_timestamp ON solution_patterns(timestamp);

-- ==================================================
-- VECTOR & SEARCH TABLES
-- ==================================================

CREATE TABLE IF NOT EXISTS message_embeddings (
  id TEXT PRIMARY KEY,
  message_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB NOT NULL,
  model_name TEXT DEFAULT 'all-MiniLM-L6-v2',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_embed_msg ON message_embeddings(message_id);

CREATE TABLE IF NOT EXISTS decision_embeddings (
  id TEXT PRIMARY KEY,
  decision_id INTEGER NOT NULL,
  embedding BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dec_embed ON decision_embeddings(decision_id);

CREATE TABLE IF NOT EXISTS mistake_embeddings (
  id TEXT PRIMARY KEY,
  mistake_id INTEGER NOT NULL,
  embedding BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mistake_embed ON mistake_embeddings(mistake_id);

CREATE TABLE IF NOT EXISTS methodology_embeddings (
  id TEXT PRIMARY KEY,
  methodology_id TEXT NOT NULL,
  embedding BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (methodology_id) REFERENCES methodologies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_methodology_embed ON methodology_embeddings(methodology_id);

CREATE TABLE IF NOT EXISTS research_embeddings (
  id TEXT PRIMARY KEY,
  research_id TEXT NOT NULL,
  embedding BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (research_id) REFERENCES research_findings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_embed ON research_embeddings(research_id);

CREATE TABLE IF NOT EXISTS pattern_embeddings (
  id TEXT PRIMARY KEY,
  pattern_id TEXT NOT NULL,
  embedding BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (pattern_id) REFERENCES solution_patterns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pattern_embed ON pattern_embeddings(pattern_id);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  id UNINDEXED,
  content,
  metadata,
  content=messages,
  content_rowid=rowid
);

CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
  id UNINDEXED,
  decision_text,
  rationale,
  context,
  content=decisions,
  content_rowid=rowid
);

CREATE VIRTUAL TABLE IF NOT EXISTS mistakes_fts USING fts5(
  id,
  what_went_wrong,
  correction,
  mistake_type
);

CREATE VIRTUAL TABLE IF NOT EXISTS methodologies_fts USING fts5(
  id UNINDEXED,
  problem_statement,
  what_worked,
  what_didnt_work
);

CREATE VIRTUAL TABLE IF NOT EXISTS research_fts USING fts5(
  id UNINDEXED,
  topic,
  discovery,
  source_reference
);

CREATE VIRTUAL TABLE IF NOT EXISTS patterns_fts USING fts5(
  id UNINDEXED,
  problem_description,
  solution_summary,
  applies_when
);

-- ==================================================
-- PERFORMANCE & CACHING
-- ==================================================

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

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT,
  checksum TEXT
);

-- ==================================================
-- LIVE CONTEXT LAYER TABLES
-- ==================================================

CREATE TABLE IF NOT EXISTS working_memory (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  context TEXT,
  tags TEXT,
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

CREATE TABLE IF NOT EXISTS session_handoffs (
  id TEXT PRIMARY KEY,
  from_session_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  handoff_data TEXT NOT NULL,
  resumed_by_session_id TEXT,
  resumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_handoff_session ON session_handoffs(from_session_id);
CREATE INDEX IF NOT EXISTS idx_handoff_project ON session_handoffs(project_path);
CREATE INDEX IF NOT EXISTS idx_handoff_created ON session_handoffs(created_at);
CREATE INDEX IF NOT EXISTS idx_handoff_resumed ON session_handoffs(resumed_by_session_id);

CREATE TABLE IF NOT EXISTS session_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  checkpoint_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  decisions TEXT,
  active_files TEXT,
  task_state TEXT,
  context_summary TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_session ON session_checkpoints(session_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_project ON session_checkpoints(project_path);
CREATE INDEX IF NOT EXISTS idx_checkpoint_created ON session_checkpoints(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkpoint_session_num ON session_checkpoints(session_id, checkpoint_number);

CREATE VIRTUAL TABLE IF NOT EXISTS working_memory_fts USING fts5(
  id UNINDEXED,
  key,
  value,
  context,
  content=working_memory,
  content_rowid=rowid
);
