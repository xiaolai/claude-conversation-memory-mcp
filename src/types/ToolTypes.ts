/**
 * Type definitions for MCP Tool arguments and responses
 * Replaces 'any' types with proper interfaces for type safety
 */

// ==================== Scope Type Helpers ====================

/**
 * Standard scope type used across multiple tools
 */
export type Scope = 'current' | 'all' | 'global';

/**
 * Helper type to create scope-aware discriminated unions.
 * When scope='current', conversation_id is required.
 */
export type WithScopeConversation<T> =
  | (T & { scope: 'current'; conversation_id: string })
  | (T & { scope?: 'all' | 'global'; conversation_id?: string })
  | (T & { scope?: undefined; conversation_id?: string });

// ==================== Tool Arguments ====================

export interface IndexConversationsArgs {
  project_path?: string;
  session_id?: string;
  include_thinking?: boolean;
  enable_git?: boolean;
  exclude_mcp_conversations?: boolean | 'self-only' | 'all-mcp';
  exclude_mcp_servers?: string[];
}

interface SearchConversationsBaseArgs {
  query: string;
  limit?: number;
  offset?: number;
  date_range?: [number, number];
}
export type SearchConversationsArgs = WithScopeConversation<SearchConversationsBaseArgs>;

export interface SearchProjectConversationsArgs {
  query: string;
  project_path?: string;
  limit?: number;
  offset?: number;
  date_range?: [number, number];
  include_claude_code?: boolean;
  include_codex?: boolean;
}

interface GetDecisionsBaseArgs {
  query: string;
  file_path?: string;
  limit?: number;
  offset?: number;
}
export type GetDecisionsArgs = WithScopeConversation<GetDecisionsBaseArgs>;

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

interface LinkCommitsToConversationsBaseArgs {
  query?: string;
  limit?: number;
  offset?: number;
}
export type LinkCommitsToConversationsArgs = WithScopeConversation<LinkCommitsToConversationsBaseArgs>;

interface SearchMistakesBaseArgs {
  query: string;
  mistake_type?: string;
  limit?: number;
  offset?: number;
}
export type SearchMistakesArgs = WithScopeConversation<SearchMistakesBaseArgs>;

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

interface FindSimilarSessionsBaseArgs {
  query: string;
  limit?: number;
  offset?: number;
}
export type FindSimilarSessionsArgs = WithScopeConversation<FindSimilarSessionsBaseArgs>;

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

export interface SearchProjectResult extends SearchResult {
  project_path: string;
  source_type: 'claude-code' | 'codex';
}

export interface SearchProjectConversationsResponse {
  query: string;
  project_path: string;
  results: SearchProjectResult[];
  total_found: number;
  has_more: boolean;
  offset: number;
  include_claude_code: boolean;
  include_codex: boolean;
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

interface RecallAndApplyBaseArgs {
  query: string;
  context_types?: Array<"conversations" | "decisions" | "mistakes" | "file_changes" | "commits">;
  file_path?: string;
  date_range?: [number, number];
  limit?: number;
  offset?: number;
}
export type RecallAndApplyArgs = WithScopeConversation<RecallAndApplyBaseArgs>;

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
  id: number;
  project_id: number;
  project_path: string;
  source_type: string;
  external_id: string;
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
  id: number;
  conversation_id: number;
  external_id: string;
  parent_message_id?: number | null;
  parent_external_id?: string | null;
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
  id: number;
  external_id: string;
  conversation_id: number;
  message_id: number;
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
  id: number;
  external_id: string;
  conversation_id: number;
  message_id: number;
  mistake_type: string;
  what_went_wrong: string;
  correction?: string;
  user_correction_message?: string;
  files_affected: string;
  timestamp: number;
}

export interface GitCommitRow {
  id: number;
  project_id: number;
  hash: string;
  message: string;
  author?: string;
  timestamp: number;
  branch?: string;
  files_changed: string;
  conversation_id?: number | null;
  related_message_id?: number | null;
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

// ==================== High-Value Utility Tools ====================

export interface SearchByFileArgs {
  file_path: string;
  limit?: number;
}

export interface SearchByFileResponse {
  file_path: string;
  discussions: Array<{
    id: string;
    conversation_id: string;
    content: string;
    timestamp: number;
    role: string;
  }>;
  decisions: Array<{
    id: string;
    decision_text: string;
    rationale?: string;
    context?: string;
    timestamp: number;
  }>;
  mistakes: Array<{
    id: string;
    mistake_type: string;
    what_went_wrong: string;
    correction?: string;
    timestamp: number;
  }>;
  total_mentions: number;
  message: string;
}

export interface ListRecentSessionsArgs {
  limit?: number;
  offset?: number;
  project_path?: string;
}

export interface ListRecentSessionsResponse {
  sessions: Array<{
    id: string;
    session_id: string;
    project_path: string;
    created_at: number;
    message_count: number;
    first_message_preview?: string;
  }>;
  total_sessions: number;
  has_more: boolean;
  message: string;
}

export interface GetLatestSessionSummaryArgs {
  project_path?: string;
  source_type?: 'claude-code' | 'codex' | 'all';
  limit_messages?: number;
  include_tools?: boolean;
  include_errors?: boolean;
}

export interface GetLatestSessionSummaryResponse {
  success: boolean;
  found: boolean;
  session?: {
    id: string;
    session_id: string;
    project_path: string;
    source_type: 'claude-code' | 'codex';
    created_at: number;
    last_message_at: number;
    message_count: number;
  };
  summary?: {
    problem_statement?: string;
    recent_user_messages: Array<{ timestamp: number; content: string }>;
    recent_assistant_messages: Array<{ timestamp: number; content: string }>;
    recent_actions?: Array<{
      tool_name: string;
      timestamp: number;
      tool_input: Record<string, unknown>;
    }>;
    errors?: Array<{
      tool_name: string;
      timestamp: number;
      message: string;
    }>;
  };
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
  projects_succeeded?: number;
  failed_projects?: string[];
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

// ==================== Live Context Layer Tools ====================

// Working Memory Types

export interface MemoryItem {
  id: string;
  key: string;
  value: string;
  context?: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  expires_at?: string;
  // Phase 1: Memory Confidence fields
  confidence?: string;
  importance?: string;
  pinned?: boolean;
  archived?: boolean;
  archive_reason?: string;
  source?: string;
  source_session_id?: string;
  verified_at?: string;
  verified_by?: string;
}

export interface MemoryItemWithSimilarity extends MemoryItem {
  similarity: number;
}

export type ConfidenceLevel = "uncertain" | "likely" | "confirmed" | "verified";
export type ImportanceLevel = "low" | "normal" | "high" | "critical";

export interface RememberArgs {
  key: string;
  value: string;
  context?: string;
  tags?: string[];
  ttl?: number;
  confidence?: ConfidenceLevel;
  importance?: ImportanceLevel;
  source?: string;
  pinned?: boolean;
  project_path?: string;
}

export interface RememberResponse {
  success: boolean;
  item?: MemoryItem;
  message: string;
}

export interface RecallArgs {
  key: string;
  project_path?: string;
}

export interface RecallResponse {
  success: boolean;
  found: boolean;
  item?: MemoryItem;
  message: string;
}

export interface RecallRelevantArgs {
  query: string;
  limit?: number;
  project_path?: string;
}

export interface RecallRelevantResponse {
  success: boolean;
  items: MemoryItemWithSimilarity[];
  total_found?: number;
  message: string;
}

export interface ListMemoryArgs {
  tags?: string[];
  limit?: number;
  offset?: number;
  project_path?: string;
}

export interface ListMemoryResponse {
  success: boolean;
  items: MemoryItem[];
  total_count: number;
  has_more: boolean;
  offset: number;
  message: string;
}

export interface ForgetArgs {
  key: string;
  project_path?: string;
}

export interface ForgetResponse {
  success: boolean;
  message: string;
}

// Session Handoff Types

export interface PrepareHandoffArgs {
  session_id?: string;
  include?: Array<"decisions" | "files" | "tasks" | "memory">;
  context_summary?: string;
  project_path?: string;
}

export interface HandoffSummary {
  id: string;
  from_session_id: string;
  project_path: string;
  created_at: string;
  summary: string;
  decisions_count: number;
  files_count: number;
  tasks_count: number;
  memory_count: number;
}

export interface HandoffDocument {
  id: string;
  from_session_id: string;
  project_path: string;
  created_at: string;
  summary: string;
  decisions: Array<{
    text: string;
    rationale?: string;
    timestamp: string;
  }>;
  active_files: Array<{
    path: string;
    last_action: string;
  }>;
  pending_tasks: Array<{
    description: string;
    status: string;
  }>;
  memory_items: Array<{
    key: string;
    value: string;
  }>;
}

export interface PrepareHandoffResponse {
  success: boolean;
  handoff?: HandoffSummary;
  message: string;
}

export interface ResumeFromHandoffArgs {
  handoff_id?: string;
  new_session_id?: string;
  inject_context?: boolean;
  project_path?: string;
}

export interface ResumeFromHandoffResponse {
  success: boolean;
  found: boolean;
  handoff?: HandoffDocument;
  message: string;
}

export interface ListHandoffsArgs {
  limit?: number;
  include_resumed?: boolean;
  project_path?: string;
}

export interface ListHandoffsResponse {
  success: boolean;
  handoffs: Array<{
    id: string;
    from_session_id: string;
    created_at: string;
    resumed_by?: string;
    resumed_at?: string;
    summary: string;
  }>;
  total_count: number;
  message: string;
}

// Context Injection Types

export interface GetStartupContextArgs {
  query?: string;
  max_tokens?: number;
  sources?: Array<"history" | "decisions" | "memory" | "handoffs">;
  project_path?: string;
}

export interface GetStartupContextResponse {
  success: boolean;
  context: {
    handoff?: HandoffDocument;
    decisions: Array<{
      id: string;
      text: string;
      rationale?: string;
      timestamp: string;
    }>;
    memory: MemoryItem[];
    recent_files: Array<{
      path: string;
      last_action: string;
      timestamp: string;
    }>;
    summary: string;
  };
  token_estimate: number;
  message: string;
}

export interface InjectRelevantContextArgs {
  message: string;
  max_tokens?: number;
  sources?: Array<"history" | "decisions" | "memory" | "handoffs">;
  project_path?: string;
}

export interface InjectRelevantContextResponse {
  success: boolean;
  injected_context: string;
  sources_used: string[];
  token_count: number;
  message: string;
}

// ==================== Phase 1: Tag Management Types ====================

export type TagItemType = "memory" | "decision" | "pattern" | "session" | "mistake";
export type TagScope = "project" | "global" | "all";
export type TagSortBy = "name" | "usage_count" | "last_used" | "created";

export interface TagInfo {
  id: number;
  name: string;
  project_path: string | null;
  description: string | null;
  color: string | null;
  usage_count: number;
  last_used_at: number | null;
  used_in_types: string[];
  created_at: number;
  updated_at: number;
}

export interface ListTagsArgs {
  project_path?: string;
  scope?: TagScope;
  sort_by?: TagSortBy;
  include_unused?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListTagsResponse {
  success: boolean;
  tags: TagInfo[];
  total: number;
  hasMore: boolean;
  message: string;
}

export interface SearchByTagsArgs {
  tags: string[];
  match_mode?: "all" | "any";
  item_types?: TagItemType[];
  scope?: TagScope;
  project_path?: string;
  limit?: number;
  offset?: number;
}

export interface TaggedItem {
  item_type: TagItemType;
  item_id: number;
  item_summary: string;
  matched_tags: string[];
  all_tags: string[];
  created_at: number;
}

export interface SearchByTagsResponse {
  success: boolean;
  items: TaggedItem[];
  total: number;
  hasMore: boolean;
  tag_breakdown: Record<string, number>;
  message: string;
}

export interface RenameTagArgs {
  old_name: string;
  new_name: string;
  scope?: "project" | "global";
  project_path?: string;
}

export interface RenameTagResponse {
  success: boolean;
  old_name: string;
  new_name: string;
  items_affected: number;
  merged: boolean;
  message: string;
}

export interface MergeTagsArgs {
  source_tags: string[];
  target_tag: string;
  scope?: "project" | "global";
  project_path?: string;
}

export interface MergeTagsResponse {
  success: boolean;
  merged_tags: string[];
  target_tag: string;
  items_retagged: number;
  duplicates_removed: number;
  message: string;
}

export interface DeleteTagArgs {
  name: string;
  scope?: "project" | "global";
  project_path?: string;
  force?: boolean;
}

export interface DeleteTagResponse {
  success: boolean;
  deleted: boolean;
  items_untagged: number;
  message: string;
}

export interface TagItemArgs {
  item_type: TagItemType;
  item_id: number | string;
  tags: string[];
  project_path?: string;
}

export interface TagItemResponse {
  success: boolean;
  item_type: TagItemType;
  item_id: number | string;
  tags_added: string[];
  tags_existed: string[];
  message: string;
}

export interface UntagItemArgs {
  item_type: TagItemType;
  item_id: number | string;
  tags?: string[];
  project_path?: string;
}

export interface UntagItemResponse {
  success: boolean;
  item_type: TagItemType;
  item_id: number | string;
  tags_removed: string[];
  message: string;
}

// ==================== Phase 1: Memory Confidence Types ====================

export interface SetMemoryConfidenceArgs {
  key: string;
  confidence: ConfidenceLevel;
  evidence?: string;
  verified_by?: string;
  project_path?: string;
}

export interface SetMemoryConfidenceResponse {
  success: boolean;
  key: string;
  previous_confidence: string | null;
  new_confidence: string;
  verified_at: number | null;
  message: string;
}

export interface SetMemoryImportanceArgs {
  key: string;
  importance: ImportanceLevel;
  project_path?: string;
}

export interface SetMemoryImportanceResponse {
  success: boolean;
  key: string;
  previous_importance: string | null;
  new_importance: string;
  message: string;
}

export interface PinMemoryArgs {
  key: string;
  pinned?: boolean;
  project_path?: string;
}

export interface PinMemoryResponse {
  success: boolean;
  key: string;
  pinned: boolean;
  message: string;
}

export interface ArchiveMemoryArgs {
  key: string;
  reason?: string;
  project_path?: string;
}

export interface ArchiveMemoryResponse {
  success: boolean;
  key: string;
  archived: boolean;
  reason: string | null;
  message: string;
}

export interface UnarchiveMemoryArgs {
  key: string;
  project_path?: string;
}

export interface UnarchiveMemoryResponse {
  success: boolean;
  key: string;
  message: string;
}

export interface SearchMemoryByQualityArgs {
  query?: string;
  confidence?: ConfidenceLevel[];
  importance?: ImportanceLevel[];
  pinned_only?: boolean;
  include_archived?: boolean;
  scope?: "project" | "global";
  project_path?: string;
  sort_by?: "relevance" | "importance" | "confidence" | "recent";
  limit?: number;
  offset?: number;
}

export interface SearchMemoryByQualityResponse {
  success: boolean;
  items: MemoryItem[];
  total: number;
  hasMore: boolean;
  message: string;
}

export interface GetMemoryStatsArgs {
  project_path?: string;
  scope?: "project" | "global";
}

export interface GetMemoryStatsResponse {
  success: boolean;
  total: number;
  active: number;
  archived: number;
  pinned: number;
  by_confidence: {
    uncertain: number;
    likely: number;
    confirmed: number;
    verified: number;
  };
  by_importance: {
    low: number;
    normal: number;
    high: number;
    critical: number;
  };
  expired: number;
  expiring_soon: number;
  top_tags: Array<{ tag: string; count: number }>;
  message: string;
}

// ==================== Phase 1: Cleanup/Maintenance Types ====================

export interface GetStorageStatsArgs {
  project_path?: string;
  detailed?: boolean;
}

export interface StorageTypeStats {
  count: number;
  size_bytes: number;
}

export interface GetStorageStatsResponse {
  success: boolean;
  database_path: string;
  total_size_bytes: number;
  total_size_human: string;
  by_type: {
    conversations: StorageTypeStats;
    messages: StorageTypeStats;
    decisions: StorageTypeStats;
    mistakes: StorageTypeStats;
    patterns: StorageTypeStats;
    memories: StorageTypeStats;
    learnings: StorageTypeStats;
    embeddings: StorageTypeStats;
    history: StorageTypeStats;
  };
  by_project?: Array<{
    project_path: string;
    size_bytes: number;
    item_count: number;
  }>;
  oldest_item: number;
  newest_item: number;
  fragmentation_percent: number;
  recommendations: string[];
  message: string;
}

export interface FindStaleItemsArgs {
  item_types?: Array<"memory" | "decision" | "pattern" | "session">;
  stale_threshold_days?: number;
  exclude_pinned?: boolean;
  exclude_important?: boolean;
  project_path?: string;
  limit?: number;
}

export interface StaleItem {
  item_type: string;
  item_id: number;
  identifier: string;
  last_accessed: number;
  days_stale: number;
  importance: string;
  size_estimate: number;
}

export interface FindStaleItemsResponse {
  success: boolean;
  stale_items: StaleItem[];
  total_stale: number;
  total_size_bytes: number;
  by_type: Record<string, number>;
  message: string;
}

export interface FindDuplicatesArgs {
  item_types?: Array<"memory" | "decision" | "pattern">;
  similarity_threshold?: number;
  project_path?: string;
  limit?: number;
}

export interface DuplicateItem {
  id: number;
  identifier: string;
  content_preview: string;
  created_at: number;
  importance: string;
}

export interface DuplicateGroup {
  group_id: number;
  item_type: string;
  items: DuplicateItem[];
  similarity_score: number;
  recommended_keep: number;
  recommendation_reason: string;
}

export interface FindDuplicatesResponse {
  success: boolean;
  duplicate_groups: DuplicateGroup[];
  total_groups: number;
  potential_savings: number;
  message: string;
}

export interface MergeDuplicatesArgs {
  item_type: "memory" | "decision" | "pattern";
  keep_id: number;
  merge_ids: number[];
  merge_strategy?: "keep_content" | "combine_content" | "keep_newest";
  merge_tags?: boolean;
}

export interface MergeDuplicatesResponse {
  success: boolean;
  kept_id: number;
  merged_count: number;
  tags_merged: string[];
  references_updated: number;
  message: string;
}

export interface CleanupStaleArgs {
  item_types?: string[];
  stale_threshold_days?: number;
  action?: "archive" | "delete" | "preview";
  exclude_pinned?: boolean;
  exclude_important?: boolean;
  max_items?: number;
  project_path?: string;
}

export interface CleanupStaleResponse {
  success: boolean;
  action: string;
  preview_only: boolean;
  items_affected: number;
  by_type: Record<string, number>;
  space_freed_bytes: number;
  items: Array<{
    type: string;
    id: number;
    identifier: string;
  }>;
  message: string;
}

export interface VacuumDatabaseArgs {
  analyze?: boolean;
  reindex?: boolean;
}

export interface VacuumDatabaseResponse {
  success: boolean;
  size_before: number;
  size_after: number;
  space_freed: number;
  duration_ms: number;
  message: string;
}

export interface CleanupOrphansArgs {
  preview?: boolean;
}

export interface CleanupOrphansResponse {
  success: boolean;
  preview_only: boolean;
  orphans_found: {
    tags_without_items: number;
    embeddings_without_items: number;
    history_without_items: number;
    links_without_targets: number;
  };
  total_orphans: number;
  cleaned: number;
  message: string;
}

export interface HealthCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  details: string;
  recommendation: string | null;
}

export interface GetHealthReportArgs {
  project_path?: string;
}

export interface GetHealthReportResponse {
  success: boolean;
  overall_health: "good" | "needs_attention" | "critical";
  score: number;
  checks: HealthCheck[];
  summary: {
    passed: number;
    warnings: number;
    failures: number;
  };
  recommendations: string[];
  last_maintenance: number | null;
  message: string;
}

export interface RunMaintenanceArgs {
  tasks: Array<"cleanup_stale" | "cleanup_orphans" | "vacuum" | "find_duplicates" | "health_report" | "cleanup_expired">;
  options?: Record<string, unknown>;
  preview?: boolean;
}

export interface MaintenanceTaskResult {
  task: string;
  status: "success" | "failed" | "skipped";
  duration_ms: number;
  result_summary: string;
}

export interface RunMaintenanceResponse {
  success: boolean;
  tasks_run: MaintenanceTaskResult[];
  total_duration_ms: number;
  overall_status: "success" | "partial" | "failed";
  log_id: number;
  message: string;
}

export interface GetMaintenanceHistoryArgs {
  since?: number;
  task_type?: string;
  limit?: number;
}

export interface MaintenanceLogEntry {
  id: number;
  task_type: string;
  started_at: number;
  completed_at: number | null;
  status: "running" | "completed" | "failed";
  items_processed: number;
  items_affected: number;
  details: string | null;
  error_message: string | null;
}

export interface GetMaintenanceHistoryResponse {
  success: boolean;
  entries: MaintenanceLogEntry[];
  total: number;
  message: string;
}
