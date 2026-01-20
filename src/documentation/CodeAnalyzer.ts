/**
 * CodeAnalyzer - Lightweight codebase analyzer for documentation.
 *
 * Scans the local filesystem to build a basic code index without
 * relying on external MCP services.
 */

import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import type {
  CodeData,
  CodeEntity,
  FileInfo,
  Hotspot,
  CodeClone,
} from './types.js';

export class CodeAnalyzer {
  /**
   * Scan a project directory and return lightweight code metadata.
   */
  async analyze(projectPath: string, moduleFilter?: string): Promise<CodeData> {
    console.error('🔍 Scanning codebase structure...');

    const files = this.collectFiles(projectPath, moduleFilter);
    const fileInfos: FileInfo[] = files.map((file) => ({
      path: file.relativePath,
      size: file.size,
      entities: [],
    }));

    const entities: CodeEntity[] = [];
    const hotspots: Hotspot[] = [];
    const clones: CodeClone[] = [];

    console.error(`  Found ${fileInfos.length} files`);

    return {
      entities,
      relationships: [],
      files: fileInfos,
      hotspots,
      clones,
    };
  }

  private collectFiles(projectPath: string, moduleFilter?: string): Array<{ relativePath: string; size: number }> {
    const ignoreDirs = new Set([
      'node_modules',
      '.git',
      '.turbo',
      '.next',
      'dist',
      'build',
      'coverage',
      '.cache',
      '.cccmemory',
    ]);

    const includeExts = new Set([
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.py', '.go', '.rs', '.java', '.kt', '.swift',
      '.c', '.cpp', '.h', '.hpp', '.cs', '.json', '.md'
    ]);

    const results: Array<{ relativePath: string; size: number }> = [];

    const walk = (dir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch (_error) {
        return;
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry);
        let stats;
        try {
          stats = statSync(fullPath);
        } catch (_error) {
          continue;
        }

        if (stats.isDirectory()) {
          if (ignoreDirs.has(entry)) {
            continue;
          }
          walk(fullPath);
          continue;
        }

        const relativePath = relative(projectPath, fullPath).replace(/\\/g, '/');
        if (moduleFilter && !relativePath.includes(moduleFilter)) {
          continue;
        }

        const extIndex = entry.lastIndexOf('.');
        const ext = extIndex >= 0 ? entry.slice(extIndex) : '';
        if (!includeExts.has(ext)) {
          continue;
        }

        results.push({ relativePath, size: stats.size });
      }
    };

    walk(projectPath);
    return results;
  }

  /**
   * Extract file paths from code data for cross-referencing
   */
  extractFilePaths(codeData: CodeData): string[] {
    const paths = new Set<string>();

    for (const entity of codeData.entities) {
      if (entity.filePath) {paths.add(entity.filePath);}
    }

    for (const file of codeData.files) {
      paths.add(file.path);
    }

    for (const hotspot of codeData.hotspots) {
      paths.add(hotspot.filePath);
    }

    for (const clone of codeData.clones) {
      clone.files.forEach(f => paths.add(f));
    }

    return Array.from(paths);
  }
}
