/**
 * Context Injector
 *
 * Intelligently selects and formats context for injection into new conversations.
 * Combines working memory, handoffs, decisions, and file history.
 */

import type { Database } from "better-sqlite3";
import type {
  InjectedContext,
  ContextInjectionOptions,
  SessionHandoff,
  HandoffDecision,
  ActiveFile,
  WorkingMemoryItem,
} from "../memory/types.js";
import { WorkingMemoryStore } from "../memory/WorkingMemoryStore.js";
import { SessionHandoffStore } from "../handoff/SessionHandoffStore.js";

/**
 * Priority levels for context items
 */
type Priority = "critical" | "high" | "medium" | "low";

/**
 * Weighted context item for sorting
 */
interface WeightedItem {
  type: "handoff" | "decision" | "memory" | "file";
  content: string;
  priority: Priority;
  timestamp: number;
  tokenEstimate: number;
}

export class ContextInjector {
  private memoryStore: WorkingMemoryStore;
  private handoffStore: SessionHandoffStore;

  constructor(db: Database) {
    this.memoryStore = new WorkingMemoryStore(db);
    this.handoffStore = new SessionHandoffStore(db);
  }

  /**
   * Get relevant context for a new conversation
   */
  async getRelevantContext(options: ContextInjectionOptions): Promise<InjectedContext> {
    const {
      query,
      projectPath,
      maxTokens = 2000,
      sources = ["history", "decisions", "memory", "handoffs"],
    } = options;

    const items: WeightedItem[] = [];

    // 1. Get most recent handoff
    let handoff: SessionHandoff | undefined;
    if (sources.includes("handoffs")) {
      const handoffs = this.handoffStore.listHandoffs(projectPath, {
        limit: 1,
        includeResumed: false,
      });

      if (handoffs.length > 0) {
        handoff = this.handoffStore.getHandoff(handoffs[0].id) || undefined;
        if (handoff) {
          items.push({
            type: "handoff",
            content: `Previous session context: ${handoff.contextSummary}`,
            priority: "critical",
            timestamp: handoff.createdAt,
            tokenEstimate: this.estimateTokens(handoff.contextSummary) + 20,
          });
        }
      }
    }

    // 2. Get relevant working memory items
    const memory: WorkingMemoryItem[] = [];
    if (sources.includes("memory")) {
      if (query) {
        // Semantic search for relevant items
        const relevant = this.memoryStore.recallRelevant({
          query,
          projectPath,
          limit: 10,
        });
        memory.push(...relevant);
      } else {
        // Get recent items
        const recent = this.memoryStore.list(projectPath, { limit: 10 });
        memory.push(...recent);
      }

      for (const item of memory) {
        items.push({
          type: "memory",
          content: `${item.key}: ${item.value}`,
          priority: this.getMemoryPriority(item),
          timestamp: item.updatedAt,
          tokenEstimate: this.estimateTokens(`${item.key}: ${item.value}`),
        });
      }
    }

    // 3. Get decisions from handoff
    const decisions: HandoffDecision[] = [];
    if (sources.includes("decisions") && handoff) {
      decisions.push(...handoff.decisions.slice(0, 10));

      for (const decision of decisions) {
        items.push({
          type: "decision",
          content: decision.text,
          priority: "high",
          timestamp: decision.timestamp,
          tokenEstimate: this.estimateTokens(decision.text),
        });
      }
    }

    // 4. Get recent files from handoff
    const recentFiles: ActiveFile[] = [];
    if (sources.includes("history") && handoff) {
      recentFiles.push(...handoff.activeFiles.slice(0, 10));

      for (const file of recentFiles) {
        items.push({
          type: "file",
          content: `${file.lastAction}: ${file.path}`,
          priority: "medium",
          timestamp: file.timestamp,
          tokenEstimate: this.estimateTokens(`${file.lastAction}: ${file.path}`),
        });
      }
    }

    // 5. Select items within token budget
    const selectedItems = this.selectWithinBudget(items, maxTokens);

    // 6. Generate summary
    const summary = this.generateSummary(selectedItems, projectPath);

    // 7. Calculate total token estimate
    const tokenEstimate = selectedItems.reduce((sum, item) => sum + item.tokenEstimate, 0);

    return {
      handoff,
      decisions,
      memory,
      recentFiles,
      summary,
      tokenEstimate,
    };
  }

  /**
   * Format context for direct injection into conversation
   */
  formatForInjection(context: InjectedContext): string {
    const parts: string[] = [];

    // Add handoff summary if available
    if (context.handoff) {
      parts.push("## Previous Session Context");
      parts.push(context.handoff.contextSummary);
      parts.push("");
    }

    // Add key decisions
    if (context.decisions.length > 0) {
      parts.push("## Recent Decisions");
      for (const decision of context.decisions.slice(0, 5)) {
        parts.push(`- ${decision.text}`);
      }
      parts.push("");
    }

    // Add working memory items
    if (context.memory.length > 0) {
      parts.push("## Remembered Context");
      for (const item of context.memory.slice(0, 5)) {
        parts.push(`- **${item.key}**: ${item.value}`);
      }
      parts.push("");
    }

    // Add recent file activity
    if (context.recentFiles.length > 0) {
      parts.push("## Recent Files");
      for (const file of context.recentFiles.slice(0, 5)) {
        parts.push(`- [${file.lastAction}] ${file.path}`);
      }
      parts.push("");
    }

    return parts.join("\n");
  }

  /**
   * Get priority for a memory item based on tags and recency
   */
  private getMemoryPriority(item: WorkingMemoryItem): Priority {
    const tags = item.tags;

    if (tags.includes("critical") || tags.includes("important")) {
      return "critical";
    }
    if (tags.includes("decision") || tags.includes("error")) {
      return "high";
    }
    if (tags.includes("task") || tags.includes("file")) {
      return "medium";
    }
    return "low";
  }

  /**
   * Estimate token count for a string (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token for English
    return Math.ceil(text.length / 4);
  }

  /**
   * Select items within token budget, prioritizing by importance
   */
  private selectWithinBudget(
    items: WeightedItem[],
    maxTokens: number
  ): WeightedItem[] {
    // Sort by priority (critical first) then by recency
    const priorityOrder: Record<Priority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    const sorted = [...items].sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      // More recent first
      return b.timestamp - a.timestamp;
    });

    // Select within budget
    const selected: WeightedItem[] = [];
    let usedTokens = 0;

    for (const item of sorted) {
      if (usedTokens + item.tokenEstimate <= maxTokens) {
        selected.push(item);
        usedTokens += item.tokenEstimate;
      } else {
        // Stop if we can't fit any more
        break;
      }
    }

    return selected;
  }

  /**
   * Generate a summary of the injected context
   */
  private generateSummary(items: WeightedItem[], projectPath: string): string {
    const counts = {
      handoff: 0,
      decision: 0,
      memory: 0,
      file: 0,
    };

    for (const item of items) {
      counts[item.type]++;
    }

    const parts: string[] = [`Context for ${projectPath}:`];

    if (counts.handoff > 0) {
      parts.push("Previous session available");
    }
    if (counts.decision > 0) {
      parts.push(`${counts.decision} decision(s)`);
    }
    if (counts.memory > 0) {
      parts.push(`${counts.memory} memory item(s)`);
    }
    if (counts.file > 0) {
      parts.push(`${counts.file} file(s)`);
    }

    return parts.join(", ");
  }
}
