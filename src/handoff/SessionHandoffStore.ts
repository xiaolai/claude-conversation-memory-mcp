/**
 * Session Handoff Store
 *
 * Manages session handoff documents for transferring context between
 * conversations when context fills up or when explicitly requested.
 */

import { nanoid } from "nanoid";
import type { Database } from "better-sqlite3";
import type {
  SessionHandoff,
  SessionHandoffRow,
  HandoffDecision,
  ActiveFile,
  PendingTask,
  WorkingMemoryItem,
} from "../memory/types.js";
import { WorkingMemoryStore } from "../memory/WorkingMemoryStore.js";

/**
 * Options for creating a handoff
 */
export interface PrepareHandoffOptions {
  sessionId?: string;
  projectPath: string;
  include?: Array<"decisions" | "files" | "tasks" | "memory">;
}

/**
 * Options for resuming from a handoff
 */
export interface ResumeHandoffOptions {
  handoffId?: string;
  projectPath: string;
  newSessionId?: string;
  injectContext?: boolean;
}

/**
 * Handoff data stored as JSON
 */
interface HandoffData {
  decisions: HandoffDecision[];
  activeFiles: ActiveFile[];
  pendingTasks: PendingTask[];
  workingMemory: WorkingMemoryItem[];
  contextSummary: string;
}

export class SessionHandoffStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Prepare a handoff document from the current session
   */
  prepareHandoff(options: PrepareHandoffOptions): SessionHandoff {
    const {
      sessionId = "current",
      projectPath,
      include = ["decisions", "files", "tasks", "memory"],
    } = options;

    const id = nanoid();
    const now = Date.now();

    // Collect data based on include options
    const handoffData: HandoffData = {
      decisions: [],
      activeFiles: [],
      pendingTasks: [],
      workingMemory: [],
      contextSummary: "",
    };

    // Get recent decisions from the database
    if (include.includes("decisions")) {
      handoffData.decisions = this.getRecentDecisions(projectPath, sessionId);
    }

    // Get recent file activity
    if (include.includes("files")) {
      handoffData.activeFiles = this.getActiveFiles(projectPath, sessionId);
    }

    // Get pending tasks (from working memory tagged as "task")
    if (include.includes("tasks")) {
      handoffData.pendingTasks = this.getPendingTasks(projectPath);
    }

    // Get working memory items
    if (include.includes("memory")) {
      const memoryStore = new WorkingMemoryStore(this.db);
      handoffData.workingMemory = memoryStore.list(projectPath);
    }

    // Generate context summary
    handoffData.contextSummary = this.generateContextSummary(handoffData);

    // Store the handoff
    this.db
      .prepare(
        `INSERT INTO session_handoffs
         (id, from_session_id, project_path, created_at, handoff_data, resumed_by_session_id, resumed_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(id, sessionId, projectPath, now, JSON.stringify(handoffData));

    return {
      id,
      fromSessionId: sessionId,
      projectPath,
      createdAt: now,
      ...handoffData,
    };
  }

  /**
   * Resume from a handoff in a new session
   */
  resumeFromHandoff(options: ResumeHandoffOptions): SessionHandoff | null {
    const { handoffId, projectPath, newSessionId, injectContext = true } = options;

    let row: SessionHandoffRow | undefined;

    if (handoffId) {
      // Get specific handoff
      row = this.db
        .prepare("SELECT * FROM session_handoffs WHERE id = ?")
        .get(handoffId) as SessionHandoffRow | undefined;
    } else {
      // Get most recent unresumed handoff for this project
      row = this.db
        .prepare(
          `SELECT * FROM session_handoffs
           WHERE project_path = ? AND resumed_by_session_id IS NULL
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get(projectPath) as SessionHandoffRow | undefined;
    }

    if (!row) {
      return null;
    }

    const handoffData = JSON.parse(row.handoff_data) as HandoffData;

    // Mark as resumed if newSessionId provided
    if (newSessionId) {
      this.db
        .prepare(
          `UPDATE session_handoffs
           SET resumed_by_session_id = ?, resumed_at = ?
           WHERE id = ?`
        )
        .run(newSessionId, Date.now(), row.id);
    }

    // Optionally inject working memory into new session
    if (injectContext && handoffData.workingMemory.length > 0) {
      const memoryStore = new WorkingMemoryStore(this.db);
      for (const item of handoffData.workingMemory) {
        // Re-remember each item in the new session
        memoryStore.remember({
          key: item.key,
          value: item.value,
          context: item.context,
          tags: item.tags,
          sessionId: newSessionId,
          projectPath: item.projectPath,
        });
      }
    }

    return {
      id: row.id,
      fromSessionId: row.from_session_id,
      projectPath: row.project_path,
      createdAt: row.created_at,
      ...handoffData,
      resumedBy: row.resumed_by_session_id || newSessionId,
      resumedAt: row.resumed_at || (newSessionId ? Date.now() : undefined),
    };
  }

  /**
   * List available handoffs for a project
   */
  listHandoffs(
    projectPath: string,
    options?: { limit?: number; includeResumed?: boolean }
  ): Array<{
    id: string;
    fromSessionId: string;
    createdAt: number;
    resumedBy?: string;
    resumedAt?: number;
    summary: string;
  }> {
    const limit = options?.limit || 10;
    const includeResumed = options?.includeResumed ?? false;

    let sql = `SELECT * FROM session_handoffs WHERE project_path = ?`;
    if (!includeResumed) {
      sql += " AND resumed_by_session_id IS NULL";
    }
    sql += " ORDER BY created_at DESC LIMIT ?";

    const rows = this.db.prepare(sql).all(projectPath, limit) as SessionHandoffRow[];

    return rows.map((row) => {
      const handoffData = JSON.parse(row.handoff_data) as HandoffData;
      return {
        id: row.id,
        fromSessionId: row.from_session_id,
        createdAt: row.created_at,
        resumedBy: row.resumed_by_session_id || undefined,
        resumedAt: row.resumed_at || undefined,
        summary: handoffData.contextSummary,
      };
    });
  }

  /**
   * Get a specific handoff by ID
   */
  getHandoff(handoffId: string): SessionHandoff | null {
    const row = this.db
      .prepare("SELECT * FROM session_handoffs WHERE id = ?")
      .get(handoffId) as SessionHandoffRow | undefined;

    if (!row) {
      return null;
    }

    const handoffData = JSON.parse(row.handoff_data) as HandoffData;

    return {
      id: row.id,
      fromSessionId: row.from_session_id,
      projectPath: row.project_path,
      createdAt: row.created_at,
      ...handoffData,
      resumedBy: row.resumed_by_session_id || undefined,
      resumedAt: row.resumed_at || undefined,
    };
  }

  /**
   * Delete a handoff by ID
   */
  deleteHandoff(handoffId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM session_handoffs WHERE id = ?")
      .run(handoffId);

    return result.changes > 0;
  }

  /**
   * Get recent decisions from the database
   */
  private getRecentDecisions(
    projectPath: string,
    _sessionId: string
  ): HandoffDecision[] {
    try {
      // Query recent decisions from the decisions table
      const rows = this.db
        .prepare(
          `SELECT d.id, d.decision_text, d.rationale, d.context, d.timestamp
           FROM decisions d
           JOIN messages m ON d.message_id = m.id
           JOIN conversations c ON m.conversation_id = c.id
           WHERE c.project_path = ?
           ORDER BY d.timestamp DESC
           LIMIT 20`
        )
        .all(projectPath) as Array<{
        id: string;
        decision_text: string;
        rationale: string | null;
        context: string | null;
        timestamp: number;
      }>;

      return rows.map((row) => ({
        id: row.id,
        text: row.decision_text,
        rationale: row.rationale || undefined,
        context: row.context || undefined,
        timestamp: row.timestamp,
      }));
    } catch (_error) {
      // Table may not exist yet
      return [];
    }
  }

  /**
   * Get recent file activity from tool uses
   */
  private getActiveFiles(
    projectPath: string,
    _sessionId: string
  ): ActiveFile[] {
    try {
      // Query recent file operations from tool_uses table
      const rows = this.db
        .prepare(
          `SELECT tu.tool_name, tu.parameters, tu.timestamp
           FROM tool_uses tu
           JOIN messages m ON tu.message_id = m.id
           JOIN conversations c ON m.conversation_id = c.id
           WHERE c.project_path = ?
           AND tu.tool_name IN ('Read', 'Edit', 'Write', 'Bash')
           ORDER BY tu.timestamp DESC
           LIMIT 50`
        )
        .all(projectPath) as Array<{
        tool_name: string;
        parameters: string;
        timestamp: number;
      }>;

      // Extract unique files from tool parameters
      const fileMap = new Map<string, ActiveFile>();

      for (const row of rows) {
        try {
          const params = JSON.parse(row.parameters || "{}") as Record<string, unknown>;
          let filePath: string | undefined;
          let action: ActiveFile["lastAction"] = "read";

          if (row.tool_name === "Read" && typeof params.file_path === "string") {
            filePath = params.file_path;
            action = "read";
          } else if (row.tool_name === "Edit" && typeof params.file_path === "string") {
            filePath = params.file_path;
            action = "edit";
          } else if (row.tool_name === "Write" && typeof params.file_path === "string") {
            filePath = params.file_path;
            action = "create";
          }

          if (filePath && !fileMap.has(filePath)) {
            fileMap.set(filePath, {
              path: filePath,
              lastAction: action,
              timestamp: row.timestamp,
            });
          }
        } catch (_e) {
          // Skip malformed parameters
        }
      }

      return Array.from(fileMap.values()).slice(0, 20);
    } catch (_error) {
      // Table may not exist yet
      return [];
    }
  }

  /**
   * Get pending tasks from working memory
   */
  private getPendingTasks(projectPath: string): PendingTask[] {
    try {
      const memoryStore = new WorkingMemoryStore(this.db);
      const items = memoryStore.recallMany({
        projectPath,
        tags: ["task", "pending", "in_progress", "blocked"],
      });

      return items.map((item) => ({
        description: item.value,
        status: this.inferTaskStatus(item.tags),
        context: item.context,
      }));
    } catch (_error) {
      return [];
    }
  }

  /**
   * Infer task status from tags
   */
  private inferTaskStatus(tags: string[]): PendingTask["status"] {
    if (tags.includes("blocked")) {
      return "blocked";
    }
    if (tags.includes("in_progress")) {
      return "in_progress";
    }
    return "pending";
  }

  /**
   * Generate a context summary from handoff data
   */
  private generateContextSummary(data: HandoffData): string {
    const parts: string[] = [];

    if (data.decisions.length > 0) {
      parts.push(
        `${data.decisions.length} decision(s): ${data.decisions
          .slice(0, 3)
          .map((d) => d.text.substring(0, 50))
          .join("; ")}`
      );
    }

    if (data.activeFiles.length > 0) {
      parts.push(
        `${data.activeFiles.length} file(s) active: ${data.activeFiles
          .slice(0, 3)
          .map((f) => f.path.split("/").pop())
          .join(", ")}`
      );
    }

    if (data.pendingTasks.length > 0) {
      parts.push(`${data.pendingTasks.length} pending task(s)`);
    }

    if (data.workingMemory.length > 0) {
      parts.push(`${data.workingMemory.length} memory item(s)`);
    }

    return parts.length > 0 ? parts.join(". ") + "." : "Empty handoff.";
  }
}
