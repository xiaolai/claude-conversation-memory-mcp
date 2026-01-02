/**
 * Working Memory Types
 *
 * Types for the working memory store that allows Claude to remember
 * facts, decisions, and context across conversation boundaries.
 */

/**
 * A single item stored in working memory
 */
export interface WorkingMemoryItem {
  id: string;
  key: string;
  value: string;
  context?: string;
  tags: string[];
  sessionId?: string;
  projectPath: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

/**
 * Database row representation of a working memory item
 */
export interface WorkingMemoryRow {
  id: string;
  key: string;
  value: string;
  context: string | null;
  tags: string | null; // JSON array
  session_id: string | null;
  project_path: string;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  embedding: Buffer | null;
}

/**
 * Options for storing a memory item
 */
export interface RememberOptions {
  key: string;
  value: string;
  context?: string;
  tags?: string[];
  sessionId?: string;
  projectPath: string;
  ttl?: number; // Time-to-live in seconds
}

/**
 * Options for recalling memory items
 */
export interface RecallOptions {
  key?: string;
  tags?: string[];
  sessionId?: string;
  projectPath?: string;
  includeExpired?: boolean;
}

/**
 * Options for semantic recall
 */
export interface SemanticRecallOptions {
  query: string;
  projectPath: string;
  limit?: number;
  threshold?: number;
}

/**
 * Result from semantic recall with similarity score
 */
export interface SemanticRecallResult extends WorkingMemoryItem {
  similarity: number;
}

/**
 * Session handoff document for transferring context between conversations
 */
export interface SessionHandoff {
  id: string;
  fromSessionId: string;
  projectPath: string;
  createdAt: number;

  // Extracted content
  decisions: HandoffDecision[];
  activeFiles: ActiveFile[];
  pendingTasks: PendingTask[];
  workingMemory: WorkingMemoryItem[];

  // Summary for quick injection
  contextSummary: string;

  // Tracking
  resumedBy?: string;
  resumedAt?: number;
}

/**
 * Decision included in a handoff
 */
export interface HandoffDecision {
  id: string;
  text: string;
  rationale?: string;
  context?: string;
  timestamp: number;
}

/**
 * File that was actively worked on
 */
export interface ActiveFile {
  path: string;
  lastAction: "read" | "edit" | "create" | "delete";
  summary?: string;
  timestamp: number;
}

/**
 * Task that was in progress
 */
export interface PendingTask {
  description: string;
  status: "in_progress" | "blocked" | "pending";
  context?: string;
}

/**
 * Database row for session handoff
 */
export interface SessionHandoffRow {
  id: string;
  from_session_id: string;
  project_path: string;
  created_at: number;
  handoff_data: string; // JSON
  resumed_by_session_id: string | null;
  resumed_at: number | null;
}

/**
 * Live checkpoint for real-time session tracking
 */
export interface SessionCheckpoint {
  id: string;
  sessionId: string;
  projectPath: string;
  checkpointNumber: number;
  createdAt: number;
  decisions: HandoffDecision[];
  activeFiles: ActiveFile[];
  taskState?: Record<string, unknown>;
  contextSummary: string;
}

/**
 * Database row for session checkpoint
 */
export interface SessionCheckpointRow {
  id: string;
  session_id: string;
  project_path: string;
  checkpoint_number: number;
  created_at: number;
  decisions: string; // JSON array
  active_files: string; // JSON array
  task_state: string | null; // JSON
  context_summary: string;
}

/**
 * Configuration for real-time watching
 */
export interface RealtimeConfig {
  enabled: boolean;
  watchPaths: string[];
  extractionInterval: number; // ms between extractions
  checkpointInterval: number; // ms between auto-checkpoints
  autoRemember: {
    decisions: boolean;
    fileEdits: boolean;
    errors: boolean;
  };
}

/**
 * Context injection result
 */
export interface InjectedContext {
  handoff?: SessionHandoff;
  decisions: HandoffDecision[];
  memory: WorkingMemoryItem[];
  recentFiles: ActiveFile[];
  summary: string;
  tokenEstimate: number;
}

/**
 * Options for context injection
 */
export interface ContextInjectionOptions {
  query?: string;
  projectPath: string;
  maxTokens?: number;
  sources?: Array<"history" | "decisions" | "memory" | "handoffs">;
}
