/**
 * Type definitions for MCP Tool arguments and responses
 * Replaces 'any' types with proper interfaces for type safety
 */

// ==================== Tool Arguments ====================

export interface IndexConversationsArgs {
  project_path?: string;
  session_id?: string;
  include_thinking?: boolean;
  enable_git?: boolean;
  exclude_mcp_conversations?: boolean | 'self-only' | 'all-mcp';
  exclude_mcp_servers?: string[];
}

export interface SearchConversationsArgs {
  query: string;
  limit?: number;
  offset?: number;
  date_range?: [number, number];
  scope?: 'current' | 'all' | 'global';
  conversation_id?: string; // For scope='current'
}

export interface GetDecisionsArgs {
  query: string;
  file_path?: string;
  limit?: number;
  offset?: number;
  scope?: 'current' | 'all' | 'global';
  conversation_id?: string; // For scope='current'
}

export interface CheckBeforeModifyArgs {
  file_path: string;
}

export interface GetFileEvolutionArgs {
  file_path: string;
  include_decisions?: boolean;
  include_commits?: boolean;
  limit?: number;
  offset?: number;
}

export interface LinkCommitsToConversationsArgs {
  query?: string;
  conversation_id?: string;
  limit?: number;
  offset?: number;
  scope?: 'current' | 'all' | 'global';
}

export interface SearchMistakesArgs {
  query: string;
  mistake_type?: string;
  limit?: number;
  offset?: number;
  scope?: 'current' | 'all' | 'global';
  conversation_id?: string; // For scope='current'
}

export interface GetRequirementsArgs {
  component: string;
  type?: string;
}

export interface GetToolHistoryArgs {
  tool_name?: string;
  file_path?: string;
  limit?: number;
  offset?: number;
  include_content?: boolean;
  max_content_length?: number;
  date_range?: [number, number];
  conversation_id?: string;
  errors_only?: boolean;
}

export interface FindSimilarSessionsArgs {
  query: string;
  limit?: number;
  offset?: number;
  scope?: 'current' | 'all' | 'global';
  conversation_id?: string; // For scope='current'
}

export interface GenerateDocumentationArgs {
  project_path?: string;
  session_id?: string;
  scope?: 'full' | 'architecture' | 'decisions' | 'quality';
  module_filter?: string;
}

// ==================== Tool Responses ====================

export interface IndexConversationsResponse {
  success: boolean;
  project_path: string;
  indexed_folders?: string[];
  database_path?: string;
  stats: {
    conversations: { count: number };
    messages: { count: number };
    decisions: { count: number };
    mistakes: { count: number };
    git_commits: { count: number };
  };
  embeddings_generated?: boolean;
  embedding_error?: string;
  message: string;
}

export interface SearchResult {
  conversation_id: string;
  message_id: string;
  timestamp: string;
  similarity: number;
  snippet: string;
  git_branch?: string;
  message_type: string;
  role?: string;
}

export interface SearchConversationsResponse {
  query: string;
  results: SearchResult[];
  total_found: number;
  has_more: boolean;
  offset: number;
  scope: 'current' | 'all' | 'global';
}

export interface DecisionResult {
  decision_id: string;
  decision_text: string;
  rationale?: string;
  alternatives_considered: string[];
  rejected_reasons: Record<string, string>;
  context?: string;
  related_files: string[];
  related_commits: string[];
  timestamp: string;
  similarity: number;
}

export interface GetDecisionsResponse {
  query: string;
  file_path?: string;
  decisions: DecisionResult[];
  total_found: number;
  has_more: boolean;
  offset: number;
  scope: 'current' | 'all' | 'global';
}

export interface EditInfo {
  timestamp: string;
  conversation_id: string;
}

export interface CommitInfo {
  hash: string;
  message: string;
  timestamp: string;
}

export interface DecisionInfo {
  decision_text: string;
  rationale?: string;
  timestamp: string;
}

export interface MistakeInfo {
  what_went_wrong: string;
  correction?: string;
  mistake_type: string;
}

export interface CheckBeforeModifyResponse {
  file_path: string;
  warning: string;
  recent_changes: {
    edits: EditInfo[];
    commits: CommitInfo[];
  };
  related_decisions: DecisionInfo[];
  mistakes_to_avoid: MistakeInfo[];
}

export interface TimelineEvent {
  type: 'edit' | 'commit' | 'decision';
  timestamp: string;
  data: Record<string, unknown>;
}

export interface GetFileEvolutionResponse {
  file_path: string;
  total_edits: number;
  timeline: TimelineEvent[];
  has_more: boolean;
}

export interface CommitResult {
  hash: string;
  full_hash: string;
  message: string;
  author?: string;
  timestamp: string;
  branch?: string;
  files_changed: string[];
  conversation_id?: string;
}

export interface LinkCommitsToConversationsResponse {
  query?: string;
  conversation_id?: string;
  commits: CommitResult[];
  total_found: number;
  has_more: boolean;
  offset: number;
  scope: 'current' | 'all' | 'global';
}

export interface MistakeResult {
  mistake_id: string;
  mistake_type: string;
  what_went_wrong: string;
  correction?: string;
  user_correction_message?: string;
  files_affected: string[];
  timestamp: string;
}

export interface SearchMistakesResponse {
  query: string;
  mistake_type?: string;
  mistakes: MistakeResult[];
  total_found: number;
  has_more: boolean;
  offset: number;
  scope: 'current' | 'all' | 'global';
}

export interface RequirementResult {
  requirement_id: string;
  type: string;
  description: string;
  rationale?: string;
  affects_components: string[];
  timestamp: string;
}

export interface GetRequirementsResponse {
  component: string;
  type?: string;
  requirements: RequirementResult[];
  total_found: number;
}

export interface ToolUseResult {
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  result: {
    content?: string;
    is_error: boolean;
    stdout?: string;
    stderr?: string;
    content_truncated?: boolean;
    stdout_truncated?: boolean;
    stderr_truncated?: boolean;
  };
  timestamp: string;
}

export interface GetToolHistoryResponse {
  tool_name?: string;
  file_path?: string;
  tool_uses: ToolUseResult[];
  total_found: number; // Number of results returned in this page
  total_in_database: number; // Total matching records in database
  has_more: boolean; // Whether more results exist beyond current page
  offset: number; // Current offset position
}

export interface RelevantMessage {
  message_id: string;
  snippet: string;
  similarity: number;
}

export interface SessionResult {
  conversation_id: string;
  project_path: string;
  first_message_at: string;
  message_count: number;
  git_branch?: string;
  relevance_score: number;
  relevant_messages: RelevantMessage[];
}

export interface FindSimilarSessionsResponse {
  query: string;
  sessions: SessionResult[];
  total_found: number;
  has_more: boolean;
  offset: number;
  scope: 'current' | 'all' | 'global';
}

export interface RecallAndApplyArgs {
  query: string;
  context_types?: Array<"conversations" | "decisions" | "mistakes" | "file_changes" | "commits">;
  file_path?: string;
  date_range?: [number, number];
  limit?: number;
  offset?: number;
  scope?: 'current' | 'all' | 'global';
  conversation_id?: string; // For scope='current'
}

export interface RecalledContext {
  conversations?: Array<{
    session_id: string;
    timestamp: string;
    snippet: string;
    relevance_score?: number;
  }>;
  decisions?: Array<{
    decision_id: string;
    type: string;
    description: string;
    rationale?: string;
    alternatives?: string[];
    rejected_approaches?: string[];
    affects_components: string[];
    timestamp: string;
  }>;
  mistakes?: Array<{
    mistake_id: string;
    type: string;
    description: string;
    what_happened: string;
    how_fixed?: string;
    lesson_learned?: string;
    files_affected: string[];
    timestamp: string;
  }>;
  file_changes?: Array<{
    file_path: string;
    change_count: number;
    last_modified: string;
    related_conversations: string[];
  }>;
  commits?: Array<{
    commit_hash: string;
    message: string;
    timestamp: string;
    files_affected: string[];
  }>;
}

export interface RecallAndApplyResponse {
  query: string;
  context_summary: string; // High-level summary of what was recalled
  recalled_context: RecalledContext;
  application_suggestions: string[]; // Suggested ways to apply this context
  total_items_found: number;
}

export interface GenerateDocumentationResponse {
  success: boolean;
  project_path: string;
  scope: string;
  documentation: string; // Markdown formatted documentation
  statistics: {
    modules: number;
    decisions: number;
    mistakes: number;
    commits: number;
  };
}

// ==================== Database Row Types ====================

export interface ConversationRow {
  id: string;
  project_path: string;
  first_message_at: number;
  last_message_at: number;
  message_count: number;
  git_branch?: string;
  claude_version?: string;
  metadata: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  parent_id?: string;
  message_type: string;
  role?: string;
  content?: string;
  timestamp: number;
  is_sidechain: number;
  agent_id?: string;
  request_id?: string;
  git_branch?: string;
  cwd?: string;
  metadata: string;
}

export interface DecisionRow {
  id: string;
  conversation_id: string;
  message_id: string;
  decision_text: string;
  rationale?: string;
  alternatives_considered: string;
  rejected_reasons: string;
  context?: string;
  related_files: string;
  related_commits: string;
  timestamp: number;
}

export interface MistakeRow {
  id: string;
  conversation_id: string;
  message_id: string;
  mistake_type: string;
  what_went_wrong: string;
  correction?: string;
  user_correction_message?: string;
  files_affected: string;
  timestamp: number;
}

export interface GitCommitRow {
  hash: string;
  message: string;
  author?: string;
  timestamp: number;
  branch?: string;
  files_changed: string;
  conversation_id?: string;
  related_message_id?: string;
  metadata: string;
}

export interface RequirementRow {
  id: string;
  type: string;
  description: string;
  rationale?: string;
  affects_components: string;
  conversation_id: string;
  message_id: string;
  timestamp: number;
}

export interface ToolUseRow {
  id: string;
  message_id: string;
  tool_name: string;
  tool_input: string;
  timestamp: number;
  result_content?: string;
  is_error: number;
  stdout?: string;
  stderr?: string;
}

// Migration Tool Types

export interface DiscoverOldConversationsArgs {
  current_project_path?: string;
}

export interface OldConversationCandidate {
  folder_name: string;
  folder_path: string;
  stored_project_path: string | null;
  score: number;
  stats: {
    conversations: number;
    messages: number;
    files: number;
    last_activity: number | null;
  };
}

export interface DiscoverOldConversationsResponse {
  success: boolean;
  current_project_path: string;
  candidates: OldConversationCandidate[];
  message: string;
}

export interface MigrateProjectArgs {
  source_folder: string;
  old_project_path: string;
  new_project_path: string;
  dry_run?: boolean;
  mode?: "migrate" | "merge";
}

export interface MigrateProjectResponse {
  success: boolean;
  source_folder: string;
  target_folder: string;
  files_copied: number;
  database_updated: boolean;
  backup_created: boolean;
  message: string;
}

// ============================================================================
// Forget By Topic Tool
// ============================================================================

export interface ForgetByTopicArgs {
  keywords: string[];
  project_path?: string;
  confirm?: boolean;
}

export interface ForgetByTopicResponse {
  success: boolean;
  preview_mode: boolean;
  conversations_found: number;
  conversations_deleted: number;
  messages_deleted: number;
  decisions_deleted: number;
  mistakes_deleted: number;
  backup_path: string | null;
  conversation_summaries: Array<{
    id: string;
    session_id: string;
    created_at: string;
    message_count: number;
  }>;
  message: string;
}

// ==================== Global Cross-Project Tools ====================

export interface IndexAllProjectsArgs {
  include_codex?: boolean;
  include_claude_code?: boolean;
  codex_path?: string;
  claude_projects_path?: string;
  /** If true, only index files modified since last indexing */
  incremental?: boolean;
}

export interface IndexAllProjectsResponse {
  success: boolean;
  global_index_path: string;
  projects_indexed: number;
  claude_code_projects: number;
  codex_projects: number;
  total_messages: number;
  total_conversations: number;
  total_decisions: number;
  total_mistakes: number;
  projects: Array<{
    project_path: string;
    source_type: 'claude-code' | 'codex';
    message_count: number;
    conversation_count: number;
  }>;
  errors: Array<{
    project_path: string;
    error: string;
  }>;
  message: string;
}

export interface SearchAllConversationsArgs {
  query: string;
  limit?: number;
  offset?: number;
  date_range?: [number, number];
  source_type?: 'claude-code' | 'codex' | 'all';
}

export interface GlobalSearchResult extends SearchResult {
  project_path: string;
  source_type: 'claude-code' | 'codex';
}

export interface SearchAllConversationsResponse {
  query: string;
  results: GlobalSearchResult[];
  total_found: number;
  has_more: boolean;
  offset: number;
  projects_searched: number;
  search_stats: {
    claude_code_results: number;
    codex_results: number;
  };
  message: string;
}

export interface GetAllDecisionsArgs {
  query: string;
  file_path?: string;
  limit?: number;
  offset?: number;
  source_type?: 'claude-code' | 'codex' | 'all';
}

export interface GlobalDecision extends DecisionResult {
  project_path: string;
  source_type: 'claude-code' | 'codex';
}

export interface GetAllDecisionsResponse {
  query: string;
  decisions: GlobalDecision[];
  total_found: number;
  has_more: boolean;
  offset: number;
  projects_searched: number;
  message: string;
}

export interface SearchAllMistakesArgs {
  query: string;
  mistake_type?: string;
  limit?: number;
  offset?: number;
  source_type?: 'claude-code' | 'codex' | 'all';
}

export interface GlobalMistake extends MistakeResult {
  project_path: string;
  source_type: 'claude-code' | 'codex';
}

export interface SearchAllMistakesResponse {
  query: string;
  mistakes: GlobalMistake[];
  total_found: number;
  has_more: boolean;
  offset: number;
  projects_searched: number;
  message: string;
}
