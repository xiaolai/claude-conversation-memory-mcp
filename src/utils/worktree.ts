import { execFileSync } from "child_process";
import { basename, dirname, isAbsolute, resolve } from "path";
import { realpathSync } from "fs";

export interface WorktreeInfo {
  canonicalPath: string;
  worktreePaths: string[];
  isGitRepo: boolean;
  commonDir?: string;
}

function normalizePath(inputPath: string): string {
  const resolved = resolve(inputPath);
  try {
    return realpathSync(resolved);
  } catch (_error) {
    return resolved;
  }
}

function runGit(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_error) {
    return null;
  }
}

function resolveGitPath(rawPath: string, cwd: string): string {
  const resolved = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
  return normalizePath(resolved);
}

export function getGitCommonDir(projectPath: string): string | null {
  const normalizedProjectPath = normalizePath(projectPath);
  const output = runGit(["rev-parse", "--git-common-dir"], normalizedProjectPath);
  if (!output) {
    return null;
  }
  return resolveGitPath(output, normalizedProjectPath);
}

export function getCanonicalProjectPath(projectPath: string): {
  canonicalPath: string;
  commonDir?: string;
  isGitRepo: boolean;
} {
  const normalizedProjectPath = normalizePath(projectPath);
  const commonDir = getGitCommonDir(normalizedProjectPath);
  if (!commonDir) {
    return { canonicalPath: normalizedProjectPath, isGitRepo: false };
  }

  const commonBase = basename(commonDir);
  const canonicalPath =
    commonBase === ".git" ? normalizePath(dirname(commonDir)) : commonDir;

  return { canonicalPath, commonDir, isGitRepo: true };
}

export function listWorktreePaths(projectPath: string): string[] {
  const normalizedProjectPath = normalizePath(projectPath);
  const output = runGit(["worktree", "list", "--porcelain"], normalizedProjectPath);
  if (!output) {
    return [];
  }

  const worktrees: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith("worktree ")) {
      continue;
    }
    const rawPath = line.slice("worktree ".length).trim();
    if (!rawPath) {
      continue;
    }
    const resolved = resolveGitPath(rawPath, normalizedProjectPath);
    if (!worktrees.includes(resolved)) {
      worktrees.push(resolved);
    }
  }

  return worktrees;
}

export function getWorktreeInfo(projectPath: string): WorktreeInfo {
  const normalizedProjectPath = normalizePath(projectPath);
  const { canonicalPath, commonDir, isGitRepo } = getCanonicalProjectPath(normalizedProjectPath);
  let worktreePaths = listWorktreePaths(normalizedProjectPath);

  if (worktreePaths.length === 0) {
    worktreePaths = [normalizedProjectPath];
  } else if (!worktreePaths.includes(normalizedProjectPath)) {
    worktreePaths.push(normalizedProjectPath);
  }

  return {
    canonicalPath,
    worktreePaths,
    isGitRepo,
    commonDir,
  };
}
