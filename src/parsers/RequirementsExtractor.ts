/**
 * Requirements and Validations Extractor - Tracks constraints, dependencies, and testing context.
 *
 * This extractor analyzes conversation messages and tool executions to identify:
 * - Requirements (dependencies, performance, compatibility, business constraints)
 * - Validations (test runs, results, and performance data)
 *
 * Helps document:
 * - What dependencies are required and why
 * - Performance requirements and constraints
 * - Compatibility requirements (versions, platforms)
 * - Business rules and limitations
 * - Test executions and their results
 *
 * @example
 * ```typescript
 * const extractor = new RequirementsExtractor();
 * const requirements = extractor.extractRequirements(messages);
 * const validations = extractor.extractValidations(toolUses, toolResults, messages);
 *
 * console.log(`Found ${requirements.length} requirements`);
 * console.log(`Found ${validations.length} test validations`);
 * ```
 */

import { nanoid } from "nanoid";
import type { Message, ToolUse, ToolResult } from "./ConversationParser.js";

/**
 * Represents a requirement or constraint for the system.
 */
export interface Requirement {
  /** Unique requirement identifier */
  id: string;
  /** Category of requirement */
  type: "dependency" | "performance" | "compatibility" | "business";
  /** Description of the requirement */
  description: string;
  /** Why this requirement exists */
  rationale?: string;
  /** Components affected by this requirement */
  affects_components: string[];
  /** Conversation where requirement was discussed */
  conversation_id: string;
  /** Message containing the requirement */
  message_id: string;
  /** When the requirement was documented */
  timestamp: number;
}

/**
 * Represents a test validation or verification.
 */
export interface Validation {
  /** Unique validation identifier */
  id: string;
  /** Conversation where test was run */
  conversation_id: string;
  /** Description of what was tested */
  what_was_tested: string;
  /** Command used to run the test */
  test_command?: string;
  /** Test result status */
  result: "passed" | "failed" | "error";
  /** Performance metrics from the test */
  performance_data?: Record<string, unknown>;
  /** Files that were tested */
  files_tested: string[];
  /** When the test was run */
  timestamp: number;
}

/**
 * Extracts requirements and validations from conversation history.
 *
 * Analyzes messages for requirement patterns and tool executions for test results.
 */
export class RequirementsExtractor {
  // Requirement indicators
  private readonly REQUIREMENT_PATTERNS = {
    dependency: [
      /(?:need|require|must use|depends on)\s+(.+?)\s+(?:library|package|module|dependency)/gi,
      /(?:install|add)\s+(.+?)\s+(?:for|to)/gi,
    ],
    performance: [
      /(?:must|should|need to)\s+(?:be|run)\s+(?:faster|slower|within|under)\s+(.+)/gi,
      /response time\s+(?:must|should)\s+(?:be\s+)?(?:under|less than|within)\s+(.+)/gi,
      /(?:latency|throughput|performance)\s+requirement:\s*(.+)/gi,
    ],
    compatibility: [
      /(?:must|should|need to)\s+(?:support|work with|be compatible with)\s+(.+)/gi,
      /(?:requires?|needs?)\s+(.+?)\s+(?:version|or higher|or later)/gi,
    ],
    business: [
      /business requirement:\s*(.+)/gi,
      /(?:must|cannot|can't)\s+(?:exceed|violate|break)\s+(.+)/gi,
      /(?:constraint|limitation):\s*(.+)/gi,
    ],
  };

  // Test/validation indicators
  private readonly TEST_PATTERNS = [
    /(?:npm|yarn|pnpm)\s+test/,
    /(?:npm|yarn|pnpm)\s+run\s+test/,
    /pytest/,
    /jest/,
    /mocha/,
    /cargo\s+test/,
    /go\s+test/,
  ];

  /**
   * Get combined output from tool result (stdout + stderr + content)
   * Test output may go to either stdout or stderr depending on the tool
   */
  private getToolOutput(result: ToolResult): string {
    const parts: string[] = [];
    if (result.stdout) {parts.push(result.stdout);}
    if (result.stderr) {parts.push(result.stderr);}
    if (result.content) {parts.push(result.content);}
    return parts.join("\n");
  }

  /**
   * Extract requirements from conversation messages.
   *
   * Analyzes messages using pattern matching to identify four types of requirements:
   * - Dependency: Required libraries, packages, modules
   * - Performance: Speed, latency, throughput constraints
   * - Compatibility: Version requirements, platform support
   * - Business: Business rules, limitations, constraints
   *
   * @param messages - Array of conversation messages to analyze
   * @returns Array of extracted Requirement objects
   *
   * @example
   * ```typescript
   * const extractor = new RequirementsExtractor();
   * const requirements = extractor.extractRequirements(messages);
   *
   * // Find all dependency requirements
   * const deps = requirements.filter(r => r.type === 'dependency');
   * deps.forEach(d => console.log(`${d.description} - ${d.rationale}`));
   * ```
   */
  extractRequirements(messages: Message[]): Requirement[] {
    const requirements: Requirement[] = [];

    for (const message of messages) {
      if (!message.content) {continue;}

      // Check each requirement type
      for (const [type, patterns] of Object.entries(
        this.REQUIREMENT_PATTERNS
      )) {
        for (const pattern of patterns) {
          const matches = Array.from(message.content.matchAll(pattern));

          for (const match of matches) {
            const requirement = this.parseRequirement(
              type as Requirement["type"],
              match,
              message
            );
            if (requirement) {
              requirements.push(requirement);
            }
          }
        }
      }
    }

    return this.deduplicateRequirements(requirements);
  }

  /**
   * Extract validations from tool executions.
   *
   * Analyzes Bash tool uses to identify test command executions and their results.
   * Captures test runs including pass/fail status, performance data, and files tested.
   *
   * Recognized test commands:
   * - npm/yarn/pnpm test
   * - pytest
   * - jest/mocha
   * - cargo test (Rust)
   * - go test (Go)
   *
   * @param toolUses - Array of tool invocations
   * @param toolResults - Array of tool execution results
   * @param messages - Array of conversation messages for context
   * @returns Array of extracted Validation objects
   *
   * @example
   * ```typescript
   * const extractor = new RequirementsExtractor();
   * const validations = extractor.extractValidations(toolUses, toolResults, messages);
   *
   * // Find failed tests
   * const failures = validations.filter(v => v.result === 'failed');
   * console.log(`${failures.length} test failures found`);
   * ```
   */
  extractValidations(
    toolUses: ToolUse[],
    toolResults: ToolResult[],
    messages: Message[]
  ): Validation[] {
    const validations: Validation[] = [];

    for (const toolUse of toolUses) {
      // Check if this is a test command
      if (toolUse.tool_name === "Bash") {
        const command = toolUse.tool_input.command;
        if (!command || typeof command !== "string") {
          continue;
        }

        const isTest = this.TEST_PATTERNS.some((pattern) =>
          pattern.test(command)
        );

        if (isTest) {
          // Find corresponding result
          const result = toolResults.find((r) => r.tool_use_id === toolUse.id);
          const message = messages.find((m) => m.id === toolUse.message_id);

          if (result && message) {
            validations.push({
              id: nanoid(),
              conversation_id: message.conversation_id,
              what_was_tested: this.extractWhatWasTested(command, result),
              test_command: command,
              result: this.determineTestResult(result),
              performance_data: this.extractPerformanceData(result),
              files_tested: this.extractTestedFiles(result),
              timestamp: toolUse.timestamp,
            });
          }
        }
      }
    }

    return validations;
  }

  /**
   * Parse a requirement from pattern match
   */
  private parseRequirement(
    type: Requirement["type"],
    match: RegExpMatchArray,
    message: Message
  ): Requirement | null {
    const description = match[1]?.trim();
    if (!description) {
      return null;
    }

    if (!message.content) {
      return null;
    }

    // Extract rationale from message context
    const rationale = this.extractRationale(match[0], message.content);

    // Extract affected components
    const components = this.extractAffectedComponents(message);

    return {
      id: nanoid(),
      type,
      description,
      rationale,
      affects_components: components,
      conversation_id: message.conversation_id,
      message_id: message.id,
      timestamp: message.timestamp,
    };
  }

  /**
   * Extract rationale from requirement text
   */
  private extractRationale(
    requirementText: string,
    fullContent: string
  ): string | undefined {
    // Look for "because", "since", "for" explanations
    const rationaleMatch = requirementText.match(
      /(?:because|since|for|due to)\s+(.+?)(?:\.|$)/i
    );
    if (rationaleMatch) {
      return rationaleMatch[1].trim();
    }

    // Look in surrounding context
    const contextMatch = fullContent.match(
      new RegExp(
        `${requirementText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^.]*?(?:because|since|for|due to)\\s+(.+?)(?:\\.|$)`,
        "i"
      )
    );

    return contextMatch?.[1]?.trim();
  }

  /**
   * Extract affected components from message metadata
   */
  private extractAffectedComponents(message: Message): string[] {
    const components: string[] = [];

    // Common component keywords
    const componentKeywords = [
      "frontend",
      "backend",
      "api",
      "database",
      "auth",
      "ui",
      "server",
      "client",
    ];

    const content = message.content?.toLowerCase() || "";

    for (const keyword of componentKeywords) {
      if (content.includes(keyword)) {
        components.push(keyword);
      }
    }

    return [...new Set(components)];
  }

  /**
   * Extract what was tested from command and result
   */
  private extractWhatWasTested(
    command: string,
    result: ToolResult
  ): string {
    // Try to extract test file/suite name
    const fileMatch = command.match(/test[/\\](.+?)(?:\s|$)/);
    if (fileMatch) {
      return fileMatch[1];
    }

    // Try to extract from result (check all output sources)
    const resultContent = this.getToolOutput(result);
    const suiteMatch = resultContent.match(/(?:Test Suite|Describe):\s*(.+)/i);
    if (suiteMatch) {
      return suiteMatch[1].trim();
    }

    // Fallback to command
    return command;
  }

  /**
   * Determine test result from tool result
   */
  private determineTestResult(
    result: ToolResult
  ): "passed" | "failed" | "error" {
    if (result.is_error) {
      return "error";
    }

    const output = this.getToolOutput(result).toLowerCase();

    // Check for pass indicators
    if (
      /(?:all tests? passed|✓|✔|success)/i.test(output) ||
      /(?:\d+\s+passed,\s+0\s+failed)/i.test(output)
    ) {
      return "passed";
    }

    // Check for fail indicators
    if (
      /(?:test failed|✗|✘|failure|failed)/i.test(output) ||
      /(?:\d+\s+failed)/i.test(output)
    ) {
      return "failed";
    }

    // Default to passed if no errors
    return result.is_error ? "error" : "passed";
  }

  /**
   * Extract performance data from test results
   */
  private extractPerformanceData(
    result: ToolResult
  ): Record<string, unknown> | undefined {
    const output = this.getToolOutput(result);

    const data: Record<string, unknown> = {};

    // Extract timing information
    const timeMatch = output.match(/(\d+(?:\.\d+)?)\s*(ms|s|seconds?|milliseconds?)/i);
    if (timeMatch) {
      const value = parseFloat(timeMatch[1]);
      const unit = timeMatch[2].toLowerCase();
      data.duration_ms = unit.startsWith("s") ? value * 1000 : value;
    }

    // Extract test counts
    const passedMatch = output.match(/(\d+)\s+passed/i);
    if (passedMatch) {
      data.tests_passed = parseInt(passedMatch[1]);
    }

    const failedMatch = output.match(/(\d+)\s+failed/i);
    if (failedMatch) {
      data.tests_failed = parseInt(failedMatch[1]);
    }

    return Object.keys(data).length > 0 ? data : undefined;
  }

  /**
   * Extract files that were tested
   */
  private extractTestedFiles(result: ToolResult): string[] {
    const output = this.getToolOutput(result);
    const files: string[] = [];

    // Look for file paths
    const filePattern = /(?:PASS|FAIL|ERROR)\s+([\w/.-]+\.(?:test|spec)\.[\w]+)/gi;
    const matches = Array.from(output.matchAll(filePattern));

    for (const match of matches) {
      files.push(match[1]);
    }

    return [...new Set(files)];
  }

  /**
   * Deduplicate similar requirements
   */
  private deduplicateRequirements(requirements: Requirement[]): Requirement[] {
    const unique: Requirement[] = [];
    const seen = new Set<string>();

    for (const req of requirements) {
      const signature = `${req.type}_${req.description.substring(0, 50)}`;
      if (!seen.has(signature)) {
        seen.add(signature);
        unique.push(req);
      }
    }

    return unique;
  }
}
