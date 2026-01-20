#!/usr/bin/env node
/**
 * Smoke test the local MCP server via stdio using the SDK client.
 *
 * Usage:
 *   node scripts/mcp-smoke-test.js [--full] [--dangerous] [--all] [--project /path]
 */
import process from "node:process";
import { resolve, join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const args = process.argv.slice(2);
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.CCCMEMORY_DISABLE_AUTO_INDEX =
  process.env.CCCMEMORY_DISABLE_AUTO_INDEX || "1";
const full = args.includes("--full");
const dangerous = args.includes("--dangerous");
const all = args.includes("--all");
const projectFlagIndex = args.indexOf("--project");
const projectPath = projectFlagIndex >= 0 ? args[projectFlagIndex + 1] : process.cwd();

const entryPoint = resolve(process.cwd(), "dist", "index.js");

const transport = new StdioClientTransport({
  command: "node",
  args: [entryPoint, "--server"],
  stderr: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
    CCCMEMORY_DISABLE_AUTO_INDEX: "1",
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER || "transformers",
  },
});

const client = new Client({ name: "cccmemory-smoke", version: "1.0.0" }, { capabilities: {} });

const results = [];

function parseToolResult(result) {
  const text = result?.content?.[0]?.text;
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function runTool(name, params = {}) {
  try {
    const result = await client.callTool({ name, arguments: params });
    const parsed = parseToolResult(result);
    results.push({ name, ok: !result.isError });
    if (result.isError) {
      console.error(`✗ ${name}:`, result.content ?? result.error ?? "Unknown error");
    } else {
      console.error(`✓ ${name}`);
    }
    return { ok: !result.isError, parsed };
  } catch (error) {
    results.push({ name, ok: false });
    console.error(`✗ ${name}:`, error instanceof Error ? error.message : String(error));
    return { ok: false, parsed: null };
  }
}

function findSourceFolderWithJsonl() {
  const projectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsDir)) {
    return null;
  }
  const entries = readdirSync(projectsDir);
  for (const entry of entries) {
    const folderPath = join(projectsDir, entry);
    let stats;
    try {
      stats = statSync(folderPath);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) {
      continue;
    }
    let files;
    try {
      files = readdirSync(folderPath);
    } catch {
      continue;
    }
    if (files.some((file) => file.endsWith(".jsonl"))) {
      return folderPath;
    }
  }
  return null;
}

async function main() {
  await client.connect(transport);

  const toolList = await client.listTools();
  const toolNames = toolList.tools.map((tool) => tool.name);
  console.error(`Found ${toolNames.length} tools`);

  const listResult = await runTool("list_recent_sessions", { limit: 3, project_path: projectPath });
  const recentSessionId = listResult.parsed?.sessions?.[0]?.session_id;
  const memoryKey = `__mcp_smoke_${Date.now()}`;
  const sourceFolder = findSourceFolderWithJsonl();
  const migrationTarget = sourceFolder ? `${sourceFolder}-migrate-test` : null;

  const toolParams = {
    index_conversations: {
      project_path: projectPath,
      session_id: recentSessionId,
      include_thinking: false,
      enable_git: false,
      exclude_mcp_conversations: "self-only"
    },
    search_conversations: { query: "memory", limit: 3 },
    search_project_conversations: {
      query: "memory",
      project_path: projectPath,
      limit: 3,
      include_claude_code: true,
      include_codex: true,
    },
    get_decisions: { query: "decision", limit: 3 },
    check_before_modify: { file_path: "README.md" },
    get_file_evolution: { file_path: "README.md", limit: 3 },
    link_commits_to_conversations: { query: "merge", limit: 3 },
    search_mistakes: { query: "error", limit: 3 },
    get_requirements: { component: "database" },
    get_tool_history: { limit: 1, include_content: false },
    find_similar_sessions: { query: "indexing", limit: 3 },
    recall_and_apply: { query: "indexing", limit: 2 },
    generate_documentation: { project_path: projectPath, scope: "architecture" },
    discover_old_conversations: { current_project_path: projectPath },
    migrate_project: sourceFolder && migrationTarget ? {
      source_folder: sourceFolder,
      old_project_path: projectPath,
      new_project_path: `${projectPath}-migrate-test`,
      dry_run: true,
      mode: "migrate"
    } : null,
    forget_by_topic: { keywords: ["__mcp_smoke__"], confirm: false, project_path: projectPath },
    search_by_file: { file_path: "README.md", limit: 2 },
    list_recent_sessions: { limit: 3, project_path: projectPath },
    get_latest_session_summary: {
      project_path: projectPath,
      source_type: "all",
      limit_messages: 10,
      include_tools: true,
      include_errors: true,
    },
    index_all_projects: {
      include_codex: true,
      include_claude_code: true,
      incremental: true
    },
    search_all_conversations: { query: "memory", limit: 3 },
    get_all_decisions: { query: "decision", limit: 3 },
    search_all_mistakes: { query: "error", limit: 3 },
    remember: {
      key: memoryKey,
      value: "smoke-test-value",
      context: "mcp smoke test",
      tags: ["smoke-test"],
      project_path: projectPath,
    },
    recall: { key: memoryKey, project_path: projectPath },
    recall_relevant: { query: "smoke test", limit: 3, project_path: projectPath },
    list_memory: { tags: ["smoke-test"], limit: 5, project_path: projectPath },
    forget: { key: memoryKey, project_path: projectPath },
    prepare_handoff: { project_path: projectPath },
    resume_from_handoff: null,
    list_handoffs: { limit: 3, project_path: projectPath },
    get_startup_context: { query: "indexing", max_tokens: 500, project_path: projectPath },
    inject_relevant_context: { message: "working on indexing", max_tokens: 500, project_path: projectPath },
  };

  const shouldRunAll = all || full || dangerous;
  const defaultTools = [
    "search_project_conversations",
    "search_conversations",
    "list_recent_sessions",
    "get_tool_history",
    "get_decisions",
    "search_mistakes",
    "check_before_modify",
    "get_file_evolution",
  ];
  const toolsToRun = shouldRunAll ? toolNames : defaultTools;

  let handoffId = null;
  for (const toolName of toolsToRun) {
    if (!toolNames.includes(toolName)) {
      console.error(`✗ ${toolName} not registered in MCP server`);
      results.push({ name: toolName, ok: false });
      continue;
    }

    if (toolName === "resume_from_handoff") {
      if (!handoffId) {
        console.error("✗ resume_from_handoff skipped (no handoff id)");
        results.push({ name: toolName, ok: false });
        continue;
      }
      await runTool(toolName, { handoff_id: handoffId, project_path: projectPath });
      continue;
    }

    const params = toolParams[toolName];
    if (!params) {
      console.error(`✗ ${toolName} has no test params`);
      results.push({ name: toolName, ok: false });
      continue;
    }

    if (params === null) {
      console.error(`✗ ${toolName} skipped (missing prerequisites)`);
      results.push({ name: toolName, ok: false });
      continue;
    }

    const result = await runTool(toolName, params);
    if (toolName === "prepare_handoff") {
      handoffId = result.parsed?.handoff?.id ?? null;
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\nSmoke test finished with ${failed.length} failure(s).`);
    process.exit(1);
  }

  console.error("\nSmoke test passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Smoke test failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
