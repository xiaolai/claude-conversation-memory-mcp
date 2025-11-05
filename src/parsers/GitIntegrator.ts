/**
 * Git Integrator
 * Links git commits to conversations based on temporal and contextual analysis
 */

import simpleGit, { SimpleGit, DefaultLogFields, LogResult } from "simple-git";
import type { Conversation, FileEdit } from "./ConversationParser.js";
import type { Decision } from "./DecisionExtractor.js";

export interface GitCommit {
  hash: string;
  message: string;
  author?: string;
  timestamp: number;
  branch?: string;
  files_changed: string[];
  conversation_id?: string;
  related_message_id?: string;
  metadata: Record<string, unknown>;
}

export interface CommitLinkage {
  commit: GitCommit;
  conversation: Conversation;
  confidence: number; // 0-1 score
  reasons: string[];
}

export class GitIntegrator {
  private git: SimpleGit;

  constructor(projectPath: string) {
    this.git = simpleGit(projectPath);
  }

  /**
   * Parse git history and link to conversations
   */
  async linkCommitsToConversations(
    conversations: Conversation[],
    fileEdits: FileEdit[],
    decisions: Decision[]
  ): Promise<GitCommit[]> {
    console.log("Parsing git history...");

    // Get git log
    const commits = await this.parseGitHistory();

    console.log(`Found ${commits.length} commits`);

    // Link commits to conversations
    const linkedCommits: GitCommit[] = [];

    for (const commit of commits) {
      const linkage = this.findBestConversationMatch(
        commit,
        conversations,
        fileEdits,
        decisions
      );

      if (linkage && linkage.confidence > 0.3) {
        commit.conversation_id = linkage.conversation.id;
        console.log(
          `Linked commit ${commit.hash.substring(0, 7)} to conversation (confidence: ${(linkage.confidence * 100).toFixed(0)}%)`
        );
        console.log(`  Reasons: ${linkage.reasons.join(", ")}`);
      }

      linkedCommits.push(commit);
    }

    console.log(
      `Linked ${linkedCommits.filter((c) => c.conversation_id).length} commits to conversations`
    );

    return linkedCommits;
  }

  /**
   * Parse git history
   */
  private async parseGitHistory(): Promise<GitCommit[]> {
    try {
      const log: LogResult<DefaultLogFields> = await this.git.log({
        "--all": null,
        "--name-only": null,
      });

      const commits: GitCommit[] = [];

      for (const entry of log.all) {
        // Get current branch (if available)
        let branch: string | undefined;
        try {
          const branches = await this.git.branch(["--contains", entry.hash]);
          branch = branches.current || branches.all[0];
        } catch (_e) {
          // Branch info not available
        }

        // Parse changed files from diff
        const files = await this.getChangedFiles(entry.hash);

        commits.push({
          hash: entry.hash,
          message: entry.message,
          author: entry.author_name,
          timestamp: new Date(entry.date).getTime(),
          branch,
          files_changed: files,
          metadata: {
            author_email: entry.author_email,
            refs: entry.refs,
            body: entry.body,
          },
        });
      }

      return commits;
    } catch (error) {
      console.error("Error parsing git history:", error);
      return [];
    }
  }

  /**
   * Get files changed in a commit
   */
  private async getChangedFiles(commitHash: string): Promise<string[]> {
    try {
      const diff = await this.git.show([
        "--name-only",
        "--format=",
        commitHash,
      ]);
      return diff
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    } catch (_error) {
      return [];
    }
  }

  /**
   * Find best conversation match for a commit
   */
  private findBestConversationMatch(
    commit: GitCommit,
    conversations: Conversation[],
    fileEdits: FileEdit[],
    decisions: Decision[]
  ): CommitLinkage | null {
    let bestMatch: CommitLinkage | null = null;
    let highestConfidence = 0;

    for (const conversation of conversations) {
      const linkage = this.scoreCommitConversationMatch(
        commit,
        conversation,
        fileEdits,
        decisions
      );

      if (linkage.confidence > highestConfidence) {
        highestConfidence = linkage.confidence;
        bestMatch = linkage;
      }
    }

    return bestMatch;
  }

  /**
   * Score how well a commit matches a conversation
   */
  private scoreCommitConversationMatch(
    commit: GitCommit,
    conversation: Conversation,
    fileEdits: FileEdit[],
    decisions: Decision[]
  ): CommitLinkage {
    let score = 0;
    const reasons: string[] = [];
    const maxScore = 10; // Total possible points

    // 1. Timestamp proximity (3 points max)
    const timestampScore = this.scoreTimestampProximity(commit, conversation);
    score += timestampScore;
    if (timestampScore > 0) {
      reasons.push(`timestamp proximity (${timestampScore.toFixed(1)}/3)`);
    }

    // 2. File overlap (4 points max)
    const fileScore = this.scoreFileOverlap(commit, conversation, fileEdits);
    score += fileScore;
    if (fileScore > 0) {
      reasons.push(`file overlap (${fileScore.toFixed(1)}/4)`);
    }

    // 3. Branch match (1 point)
    if (commit.branch && commit.branch === conversation.git_branch) {
      score += 1;
      reasons.push("branch match");
    }

    // 4. Commit message keywords (2 points max)
    const keywordScore = this.scoreCommitMessageKeywords(
      commit,
      conversation,
      decisions
    );
    score += keywordScore;
    if (keywordScore > 0) {
      reasons.push(`message keywords (${keywordScore.toFixed(1)}/2)`);
    }

    return {
      commit,
      conversation,
      confidence: score / maxScore,
      reasons,
    };
  }

  /**
   * Score based on timestamp proximity
   * Returns 0-3 points
   */
  private scoreTimestampProximity(
    commit: GitCommit,
    conversation: Conversation
  ): number {
    const { first_message_at, last_message_at } = conversation;

    // Check if commit is within conversation timespan
    if (
      commit.timestamp >= first_message_at &&
      commit.timestamp <= last_message_at
    ) {
      return 3; // Perfect match
    }

    // Check if commit is within 5 minutes before/after conversation
    const fiveMinutes = 5 * 60 * 1000;
    const timeDelta = Math.min(
      Math.abs(commit.timestamp - first_message_at),
      Math.abs(commit.timestamp - last_message_at)
    );

    if (timeDelta < fiveMinutes) {
      return 2; // Very close
    }

    // Check if commit is within 1 hour
    const oneHour = 60 * 60 * 1000;
    if (timeDelta < oneHour) {
      return 1; // Somewhat close
    }

    return 0; // Too far away
  }

  /**
   * Score based on file overlap
   * Returns 0-4 points
   */
  private scoreFileOverlap(
    commit: GitCommit,
    conversation: Conversation,
    fileEdits: FileEdit[]
  ): number {
    // Get files discussed in conversation
    const conversationFiles = fileEdits
      .filter((edit) => edit.conversation_id === conversation.id)
      .map((edit) => edit.file_path);

    if (conversationFiles.length === 0) {return 0;}

    // Calculate overlap
    const commitFilesSet = new Set(commit.files_changed);
    const overlappingFiles = conversationFiles.filter((file) =>
      commitFilesSet.has(file)
    );

    const overlapRatio =
      overlappingFiles.length /
      Math.max(commit.files_changed.length, conversationFiles.length);

    // 4 points for 100% overlap, scaling down
    return overlapRatio * 4;
  }

  /**
   * Score based on commit message keywords
   * Returns 0-2 points
   */
  private scoreCommitMessageKeywords(
    commit: GitCommit,
    conversation: Conversation,
    decisions: Decision[]
  ): number {
    const commitMessage = commit.message.toLowerCase();

    // Get keywords from conversation decisions
    const conversationDecisions = decisions.filter(
      (d) => d.conversation_id === conversation.id
    );

    if (conversationDecisions.length === 0) {return 0;}

    // Extract keywords from decisions
    const keywords = new Set<string>();
    for (const decision of conversationDecisions) {
      // Extract significant words (3+ characters)
      const words = decision.decision_text
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      words.forEach((w) => keywords.add(w));

      if (decision.context) {
        keywords.add(decision.context.toLowerCase());
      }
    }

    // Count keyword matches
    let matches = 0;
    for (const keyword of keywords) {
      if (commitMessage.includes(keyword)) {
        matches++;
      }
    }

    // 2 points for 3+ matches, scaling down
    return Math.min(matches / 3, 1) * 2;
  }

  /**
   * Get recent commits (last N days)
   */
  async getRecentCommits(days: number = 30): Promise<GitCommit[]> {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    try {
      const log = await this.git.log({
        "--since": sinceDate.toISOString(),
      });

      const commits: GitCommit[] = [];

      for (const entry of log.all) {
        const files = await this.getChangedFiles(entry.hash);

        commits.push({
          hash: entry.hash,
          message: entry.message,
          author: entry.author_name,
          timestamp: new Date(entry.date).getTime(),
          files_changed: files,
          metadata: {
            author_email: entry.author_email,
            refs: entry.refs,
          },
        });
      }

      return commits;
    } catch (error) {
      console.error("Error getting recent commits:", error);
      return [];
    }
  }

  /**
   * Get commits affecting a specific file
   */
  async getCommitsForFile(filePath: string): Promise<GitCommit[]> {
    try {
      const log = await this.git.log({
        file: filePath,
      });

      return log.all.map((entry) => ({
        hash: entry.hash,
        message: entry.message,
        author: entry.author_name,
        timestamp: new Date(entry.date).getTime(),
        files_changed: [filePath],
        metadata: {
          author_email: entry.author_email,
          refs: entry.refs,
        },
      }));
    } catch (error) {
      console.error(`Error getting commits for ${filePath}:`, error);
      return [];
    }
  }
}
