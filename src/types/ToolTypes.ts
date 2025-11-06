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
  date_range?: [number, number];
}

export interface GetDecisionsArgs {
  query: string;
  file_path?: string;
  limit?: number;
}

export interface CheckBeforeModifyArgs {
  file_path: string;
}

export interface GetFileEvolutionArgs {
  file_path: string;
  include_decisions?: boolean;
  include_commits?: boolean;
}

export interface LinkCommitsToConversationsArgs {
  query?: string;
  conversation_id?: string;
  limit?: number;
}

export interface SearchMistakesArgs {
  query: string;
  mistake_type?: string;
  limit?: number;
}

export interface GetRequirementsArgs {
  component: string;
  type?: string;
}

export interface GetToolHistoryArgs {
  tool_name?: string;
  file_path?: string;
  limit?: number;
}

export interface FindSimilarSessionsArgs {
  query: string;
  limit?: number;
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
  };
  timestamp: string;
}

export interface GetToolHistoryResponse {
  tool_name?: string;
  file_path?: string;
  tool_uses: ToolUseResult[];
  total_found: number;
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
