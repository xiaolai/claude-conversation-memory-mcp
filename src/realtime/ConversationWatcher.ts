/**
 * Conversation Watcher
 *
 * Watches Claude conversation JSONL files for changes using chokidar.
 * Triggers incremental parsing and extraction when files are modified.
 */

import { watch, type FSWatcher } from "chokidar";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";
import { IncrementalParser, type ParsedMessage } from "./IncrementalParser.js";
import { LiveExtractor, type ExtractionResult } from "./LiveExtractor.js";
import type { Database } from "better-sqlite3";
import type { RealtimeConfig } from "../memory/types.js";

/**
 * Events emitted by the watcher
 */
export interface WatcherEvents {
  message: (filePath: string, message: ParsedMessage) => void;
  extraction: (filePath: string, result: ExtractionResult) => void;
  error: (error: Error) => void;
  started: () => void;
  stopped: () => void;
}

/**
 * Watcher status
 */
export interface WatcherStatus {
  isRunning: boolean;
  watchedPaths: string[];
  trackedFiles: number;
  extractionsPending: number;
  lastExtraction?: number;
}

export class ConversationWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private parser: IncrementalParser;
  private extractor: LiveExtractor;
  private config: RealtimeConfig;
  private isRunning = false;
  private extractionQueue: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private pendingExtractions = 0;
  private lastExtractionTime?: number;

  constructor(db: Database, config?: Partial<RealtimeConfig>) {
    super();

    this.config = {
      enabled: true,
      watchPaths: this.getDefaultWatchPaths(),
      extractionInterval: 1000, // Debounce interval
      checkpointInterval: 60000,
      autoRemember: {
        decisions: true,
        fileEdits: true,
        errors: true,
      },
      ...config,
    };

    this.parser = new IncrementalParser();
    this.extractor = new LiveExtractor(db, this.config);
  }

  /**
   * Get default watch paths for Claude conversations
   */
  private getDefaultWatchPaths(): string[] {
    const claudeProjectsPath = join(homedir(), ".claude", "projects");
    return [claudeProjectsPath];
  }

  /**
   * Start watching for conversation changes
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    // Initialize chokidar watcher
    this.watcher = watch(this.config.watchPaths, {
      persistent: true,
      ignoreInitial: true, // Don't process existing files on start
      followSymlinks: false,
      depth: 10, // Limit depth for performance
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
      // Only watch JSONL files
      ignored: (path: string) => {
        // Only watch .jsonl files in expected locations
        if (path.endsWith(".jsonl")) {
          return false;
        }
        // Allow directories to be traversed
        return !path.includes("projects");
      },
    });

    // Set up event handlers
    this.watcher.on("change", (path) => this.handleFileChange(path));
    this.watcher.on("add", (path) => this.handleFileChange(path));
    this.watcher.on("error", (error) => this.emit("error", error));

    this.isRunning = true;
    this.emit("started");

    console.error(
      `[Watcher] Started watching ${this.config.watchPaths.length} path(s)`
    );
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.watcher) {
      return;
    }

    // Clear pending extractions
    for (const timeout of this.extractionQueue.values()) {
      clearTimeout(timeout);
    }
    this.extractionQueue.clear();

    await this.watcher.close();
    this.watcher = null;
    this.isRunning = false;

    this.emit("stopped");
    console.error("[Watcher] Stopped");
  }

  /**
   * Handle file change event
   */
  private handleFileChange(filePath: string): void {
    // Debounce extraction for the same file
    const existingTimeout = this.extractionQueue.get(filePath);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      this.processFileChange(filePath);
      this.extractionQueue.delete(filePath);
    }, this.config.extractionInterval);

    this.extractionQueue.set(filePath, timeout);
  }

  /**
   * Process file change after debounce
   */
  private async processFileChange(filePath: string): Promise<void> {
    try {
      // Parse new messages
      const messages = this.parser.parseNewContent(filePath);

      if (messages.length === 0) {
        return;
      }

      // Emit message events
      for (const message of messages) {
        this.emit("message", filePath, message);
      }

      // Extract decisions, file edits, etc.
      this.pendingExtractions++;
      const result = await this.extractor.processMessages(filePath, messages);
      this.pendingExtractions--;
      this.lastExtractionTime = Date.now();

      if (result.decisionsExtracted > 0 || result.filesTracked > 0 || result.errorsDetected > 0) {
        this.emit("extraction", filePath, result);
        console.error(
          `[Watcher] Extracted from ${filePath}: ` +
            `${result.decisionsExtracted} decisions, ` +
            `${result.filesTracked} files, ` +
            `${result.errorsDetected} errors`
        );
      }
    } catch (error) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get current watcher status
   */
  getStatus(): WatcherStatus {
    return {
      isRunning: this.isRunning,
      watchedPaths: this.config.watchPaths,
      trackedFiles: this.parser.getTrackedFiles().length,
      extractionsPending: this.pendingExtractions,
      lastExtraction: this.lastExtractionTime,
    };
  }

  /**
   * Add a path to watch
   */
  addPath(path: string): void {
    if (!this.config.watchPaths.includes(path)) {
      this.config.watchPaths.push(path);
      if (this.watcher) {
        this.watcher.add(path);
      }
    }
  }

  /**
   * Remove a path from watching
   */
  removePath(path: string): void {
    const index = this.config.watchPaths.indexOf(path);
    if (index !== -1) {
      this.config.watchPaths.splice(index, 1);
      if (this.watcher) {
        this.watcher.unwatch(path);
      }
    }
  }

  /**
   * Force re-process a specific file
   */
  async reprocessFile(filePath: string): Promise<ExtractionResult> {
    // Reset parser tracking for this file
    this.parser.resetFile(filePath);

    // Parse all content
    const messages = this.parser.parseNewContent(filePath);

    // Extract
    return this.extractor.processMessages(filePath, messages);
  }

  /**
   * Get parser for testing
   */
  getParser(): IncrementalParser {
    return this.parser;
  }

  /**
   * Get extractor for testing
   */
  getExtractor(): LiveExtractor {
    return this.extractor;
  }
}
