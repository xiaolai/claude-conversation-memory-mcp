/**
 * Requirements and Validations Extractor
 * Tracks constraints, dependencies, and testing context
 */

import { nanoid } from "nanoid";
import type { Message, ToolUse, ToolResult } from "./ConversationParser.js";

export interface Requirement {
  id: string;
  type: "dependency" | "performance" | "compatibility" | "business";
  description: string;
  rationale?: string;
  affects_components: string[];
  conversation_id: string;
  message_id: string;
  timestamp: number;
}

export interface Validation {
  id: string;
  conversation_id: string;
  what_was_tested: string;
  test_command?: string;
  result: "passed" | "failed" | "error";
  performance_data?: Record<string, unknown>;
  files_tested: string[];
  timestamp: number;
}

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
   * Extract requirements from messages
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
   * Extract validations from tool uses
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

    // Try to extract from result
    const resultContent = result.stdout || result.content || "";
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

    const output = (result.stdout || result.content || "").toLowerCase();

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
    const output = result.stdout || result.content || "";

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
    const output = result.stdout || result.content || "";
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
