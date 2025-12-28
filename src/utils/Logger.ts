/**
 * Logging Abstraction
 *
 * Centralized logging with configurable levels and formatting.
 * Replaces scattered console.log/warn/error calls throughout codebase.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

export interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
  timestamp?: boolean;
}

export class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level ?? LogLevel.INFO,
      prefix: config.prefix ?? '',
      timestamp: config.timestamp ?? false,
    };
  }

  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.config.level;
  }

  /**
   * Format log message with optional timestamp and prefix
   */
  private format(level: string, message: string): string {
    const parts: string[] = [];

    if (this.config.timestamp) {
      parts.push(new Date().toISOString());
    }

    if (this.config.prefix) {
      parts.push(`[${this.config.prefix}]`);
    }

    parts.push(`[${level}]`);
    parts.push(message);

    return parts.join(' ');
  }

  /**
   * Debug level logging (most verbose)
   * All logging goes to stderr to avoid interfering with MCP JSON-RPC on stdout
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.config.level <= LogLevel.DEBUG) {
      console.error(this.format('DEBUG', message), ...args);
    }
  }

  /**
   * Info level logging (normal operations)
   * All logging goes to stderr to avoid interfering with MCP JSON-RPC on stdout
   */
  info(message: string, ...args: unknown[]): void {
    if (this.config.level <= LogLevel.INFO) {
      console.error(this.format('INFO', message), ...args);
    }
  }

  /**
   * Warning level logging (potential issues)
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.config.level <= LogLevel.WARN) {
      console.error(this.format('WARN', message), ...args);
    }
  }

  /**
   * Error level logging (failures)
   */
  error(message: string, ...args: unknown[]): void {
    if (this.config.level <= LogLevel.ERROR) {
      console.error(this.format('ERROR', message), ...args);
    }
  }

  /**
   * Success message (convenience wrapper for info)
   * All logging goes to stderr to avoid interfering with MCP JSON-RPC on stdout
   */
  success(message: string, ...args: unknown[]): void {
    if (this.config.level <= LogLevel.INFO) {
      console.error(this.format('✓', message), ...args);
    }
  }

  /**
   * Create a child logger with a specific prefix
   */
  child(prefix: string): Logger {
    return new Logger({
      level: this.config.level,
      prefix: this.config.prefix
        ? `${this.config.prefix}:${prefix}`
        : prefix,
      timestamp: this.config.timestamp,
    });
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger({
  level: process.env.LOG_LEVEL
    ? (LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel] ?? LogLevel.INFO)
    : LogLevel.INFO,
  timestamp: false,
});

/**
 * Create a logger for a specific module
 */
export function createLogger(module: string): Logger {
  return logger.child(module);
}
