/**
 * CrossReferencer - Links code entities with conversation data
 */

import { basename, dirname } from 'path';
import type {
  CodeData,
  ConversationData,
  LinkedData,
  LinkedModule,
  TimelineEvent,
  QualityReport,
  HotspotWithContext,
  MistakeSummary,
  DocumentationStatistics,
  CodeEntity,
  Hotspot,
  Decision,
  Mistake,
  Requirement,
  FileEdit
} from './types.js';

export class CrossReferencer {
  /**
   * Link code and conversation data
   */
  async link(codeData: CodeData, conversationData: ConversationData): Promise<LinkedData> {
    console.error('🔗 Cross-referencing code and conversations...');

    const modules = this.groupIntoModules(codeData, conversationData);
    const timeline = this.buildTimeline(conversationData);
    const qualityReport = this.buildQualityReport(codeData, conversationData);
    const statistics = this.calculateStatistics(codeData, conversationData);

    console.error(`  Created ${modules.length} module summaries`);

    return {
      modules,
      timeline,
      qualityReport,
      statistics
    };
  }

  /**
   * Group files into logical modules and link with conversation data
   */
  private groupIntoModules(codeData: CodeData, conversationData: ConversationData): LinkedModule[] {
    // Group files by directory
    const moduleMap = new Map<string, LinkedModule>();

    for (const file of codeData.files) {
      const modulePath = this.extractModulePath(file.path);
      const moduleName = this.pathToModuleName(modulePath);

      if (!moduleMap.has(modulePath)) {
        moduleMap.set(modulePath, {
          path: modulePath,
          name: moduleName,
          entities: [],
          decisions: [],
          mistakes: [],
          requirements: [],
          complexity: 0,
          changeFrequency: 0,
          description: undefined
        });
      }

      const module = moduleMap.get(modulePath);
      if (module) {
        module.entities.push(...file.entities);
      }
    }

    // Link decisions, mistakes, and requirements to modules
    for (const module of moduleMap.values()) {
      module.decisions = this.findRelatedDecisions(module.path, conversationData.decisions);
      module.mistakes = this.findRelatedMistakes(module.path, conversationData.mistakes);
      module.requirements = this.findRelatedRequirements(module.path, conversationData.requirements);
      module.complexity = this.calculateModuleComplexity(module.entities, codeData.hotspots);
      module.changeFrequency = this.calculateChangeFrequency(module.path, conversationData.fileEdits);
      module.description = this.extractModuleDescription(module.decisions, module.requirements);
    }

    return Array.from(moduleMap.values())
      .sort((a, b) => b.decisions.length + b.mistakes.length - (a.decisions.length + a.mistakes.length));
  }

  /**
   * Extract module path from file path (e.g., src/auth/token.ts → src/auth)
   */
  private extractModulePath(filePath: string): string {
    const dir = dirname(filePath);

    // If it's a top-level file, use the filename without extension
    if (dir === '.' || dir === 'src') {
      return basename(filePath, '.ts').replace(/\./g, '/');
    }

    return dir;
  }

  /**
   * Convert path to human-readable module name
   */
  private pathToModuleName(path: string): string {
    const parts = path.split('/');
    const lastPart = parts[parts.length - 1];

    // Convert snake_case or kebab-case to Title Case
    return lastPart
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Find decisions related to a module
   */
  private findRelatedDecisions(modulePath: string, decisions: Decision[]): Decision[] {
    return decisions.filter(decision =>
      decision.related_files.some((file: string) =>
        file.startsWith(modulePath) || this.isRelatedPath(file, modulePath)
      )
    );
  }

  /**
   * Find mistakes related to a module
   */
  private findRelatedMistakes(modulePath: string, mistakes: Mistake[]): Mistake[] {
    return mistakes.filter(mistake =>
      mistake.related_files.some((file: string) =>
        file.startsWith(modulePath) || this.isRelatedPath(file, modulePath)
      )
    );
  }

  /**
   * Find requirements related to a module
   */
  private findRelatedRequirements(modulePath: string, requirements: Requirement[]): Requirement[] {
    return requirements.filter(req =>
      req.related_files.some((file: string) =>
        file.startsWith(modulePath) || this.isRelatedPath(file, modulePath)
      )
    );
  }

  /**
   * Check if two paths are related (flexible matching)
   */
  private isRelatedPath(filePath: string, modulePath: string): boolean {
    return filePath.includes(modulePath) || modulePath.includes(filePath);
  }

  /**
   * Calculate module complexity
   */
  private calculateModuleComplexity(entities: CodeEntity[], hotspots: Hotspot[]): number {
    if (entities.length === 0) {
      return 0;
    }

    const entityComplexity = entities
      .filter(e => e.complexity)
      .reduce((sum, e) => sum + (e.complexity || 0), 0);

    const hotspotComplexity = hotspots
      .filter(h => entities.some(e => e.filePath === h.filePath))
      .reduce((sum, h) => sum + h.complexity, 0);

    const avgComplexity = (entityComplexity + hotspotComplexity) / (entities.length || 1);
    return Math.min(10, Math.round(avgComplexity));
  }

  /**
   * Calculate how frequently a module changes
   */
  private calculateChangeFrequency(modulePath: string, fileEdits: FileEdit[]): number {
    return fileEdits.filter(edit => edit.file_path.startsWith(modulePath)).length;
  }

  /**
   * Extract module description from decisions and requirements
   */
  private extractModuleDescription(decisions: Decision[], requirements: Requirement[]): string | undefined {
    // Use the first decision's context or rationale as description
    if (decisions.length > 0 && decisions[0].context) {
      return decisions[0].context;
    }
    if (decisions.length > 0 && decisions[0].rationale) {
      return decisions[0].rationale;
    }
    if (requirements.length > 0) {
      return requirements[0].description;
    }
    return undefined;
  }

  /**
   * Build chronological timeline of events
   */
  private buildTimeline(conversationData: ConversationData): TimelineEvent[] {
    const events: TimelineEvent[] = [];

    // Add decisions
    for (const decision of conversationData.decisions) {
      events.push({
        timestamp: decision.timestamp,
        type: 'decision',
        description: decision.decision_text,
        files: decision.related_files,
        details: decision
      });
    }

    // Add mistakes
    for (const mistake of conversationData.mistakes) {
      events.push({
        timestamp: mistake.timestamp,
        type: 'mistake',
        description: mistake.what_went_wrong,
        files: mistake.related_files,
        details: mistake
      });
    }

    // Add commits
    for (const commit of conversationData.commits) {
      events.push({
        timestamp: commit.timestamp,
        type: 'commit',
        description: commit.message,
        files: commit.files_changed,
        details: commit
      });
    }

    // Sort by timestamp (newest first)
    return events.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Build quality report with context
   */
  private buildQualityReport(codeData: CodeData, conversationData: ConversationData): QualityReport {
    const hotspotsWithContext: HotspotWithContext[] = codeData.hotspots.map(hotspot => ({
      ...hotspot,
      relatedMistakes: conversationData.mistakes.filter(m =>
        m.related_files.some(f => f === hotspot.filePath)
      ),
      relatedDecisions: conversationData.decisions.filter(d =>
        d.related_files.some(f => f === hotspot.filePath)
      )
    }));

    const mistakeSummary = this.summarizeMistakes(conversationData.mistakes);

    return {
      hotspots: hotspotsWithContext,
      clones: codeData.clones,
      mistakeSummary
    };
  }

  /**
   * Summarize mistakes for learning
   */
  private summarizeMistakes(mistakes: Mistake[]): MistakeSummary {
    const byCategory: Record<string, number> = {};
    const topLessons: string[] = [];
    const criticalIssues: Mistake[] = [];

    for (const mistake of mistakes) {
      // Categorize by severity
      const category = mistake.severity || 'medium';
      byCategory[category] = (byCategory[category] || 0) + 1;

      // Collect lessons
      if (mistake.lesson_learned && !topLessons.includes(mistake.lesson_learned)) {
        topLessons.push(mistake.lesson_learned);
      }

      // Identify critical issues
      if (mistake.severity === 'critical' || mistake.severity === 'high') {
        criticalIssues.push(mistake);
      }
    }

    return {
      total: mistakes.length,
      byCategory,
      topLessons: topLessons.slice(0, 10), // Top 10 lessons
      criticalIssues
    };
  }

  /**
   * Calculate overall statistics
   */
  private calculateStatistics(codeData: CodeData, conversationData: ConversationData): DocumentationStatistics {
    const totalComplexity = codeData.entities
      .filter(e => e.complexity)
      .reduce((sum, e) => sum + (e.complexity || 0), 0);

    return {
      totalFiles: codeData.files.length,
      totalEntities: codeData.entities.length,
      totalDecisions: conversationData.decisions.length,
      totalMistakes: conversationData.mistakes.length,
      totalCommits: conversationData.commits.length,
      averageComplexity: codeData.entities.length > 0
        ? Math.round((totalComplexity / codeData.entities.length) * 10) / 10
        : 0
    };
  }
}
