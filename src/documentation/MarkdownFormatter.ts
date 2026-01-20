/**
 * MarkdownFormatter - Generates comprehensive markdown documentation
 */

import type {
  LinkedData,
  LinkedModule,
  TimelineEvent,
  DocumentationOptions,
  Decision,
  Mistake,
  Requirement,
  CodeEntity,
  QualityReport,
  HotspotWithContext
} from './types.js';

export class MarkdownFormatter {
  /**
   * Format linked data as markdown
   */
  format(data: LinkedData, options: DocumentationOptions): string {
    let doc = '';

    doc += this.renderHeader(data, options);
    doc += this.renderStatistics(data);

    const { scope, moduleFilter } = options;

    if (scope === 'full' || scope === 'architecture') {
      doc += this.renderArchitecture(data.modules, moduleFilter);
    }

    if (scope === 'full' || scope === 'decisions') {
      doc += this.renderDecisions(data);
    }

    if (scope === 'full' || scope === 'quality') {
      doc += this.renderQuality(data.qualityReport);
    }

    if (scope === 'full') {
      doc += this.renderTimeline(data.timeline);
    }

    doc += this.renderFooter();

    return doc;
  }

  private renderHeader(data: LinkedData, options: DocumentationOptions): string {
    const projectName = options.projectPath.split('/').pop() || 'Project';
    const sessionInfo = options.sessionId ? ` (Session: ${options.sessionId.substring(0, 8)}...)` : ' (All Sessions)';

    return `# ${projectName} - Comprehensive Documentation

**Generated**: ${new Date().toLocaleString()}
**Scope**: ${options.scope}${sessionInfo}
**Modules**: ${data.modules.length}

---

`;
  }

  private renderStatistics(data: LinkedData): string {
    const stats = data.statistics;

    return `## 📊 Project Statistics

| Metric | Count |
|--------|-------|
| Files | ${stats.totalFiles} |
| Code Entities | ${stats.totalEntities} |
| Decisions | ${stats.totalDecisions} |
| Mistakes | ${stats.totalMistakes} |
| Git Commits | ${stats.totalCommits} |
| Avg Complexity | ${stats.averageComplexity}/10 |

---

`;
  }

  private renderArchitecture(modules: LinkedModule[], moduleFilter?: string): string {
    let filtered = modules;
    if (moduleFilter) {
      filtered = modules.filter(m => m.path.includes(moduleFilter));
    }

    if (filtered.length === 0) {
      return `## 🏗️ Architecture Overview

No modules found${moduleFilter ? ` matching filter: ${moduleFilter}` : ''}.

---

`;
    }

    return `## 🏗️ Architecture Overview

${filtered.map(m => this.renderModule(m)).join('\n')}

---

`;
  }

  private renderModule(module: LinkedModule): string {
    const hasDecisions = module.decisions.length > 0;
    const hasMistakes = module.mistakes.length > 0;
    const hasRequirements = module.requirements.length > 0;

    return `### ${module.name}

**Location**: \`${module.path}\`
**Complexity**: ${module.complexity}/10
**Changes**: ${module.changeFrequency} edits
**Entities**: ${module.entities.length}

${module.description ? `**Purpose**: ${module.description}\n` : ''}

${hasDecisions ? this.renderModuleDecisions(module.decisions) : ''}

${hasMistakes ? this.renderModuleMistakes(module.mistakes) : ''}

${hasRequirements ? this.renderModuleRequirements(module.requirements) : ''}

${this.renderModuleEntities(module.entities)}

`;
  }

  private renderModuleDecisions(decisions: Decision[]): string {
    if (decisions.length === 0) {
      return '';
    }

    const recent = decisions.slice(0, 5); // Show top 5 decisions

    return `**Key Decisions** (${decisions.length} total):
${recent.map(d => `- ${d.decision_text} (${this.formatDate(d.timestamp)})
  - *Rationale*: ${d.rationale || 'Not specified'}${d.alternatives_considered.length > 0 ? `
  - *Alternatives*: ${d.alternatives_considered.join(', ')}` : ''}`).join('\n')}

`;
  }

  private renderModuleMistakes(mistakes: Mistake[]): string {
    if (mistakes.length === 0) {
      return '';
    }

    return `**Past Issues** (${mistakes.length} total):
${mistakes.map(m => `- ⚠️ ${m.what_went_wrong} (${this.formatDate(m.timestamp)})
  - *Fix*: ${m.how_it_was_fixed || 'Not documented'}
  - *Lesson*: ${m.lesson_learned || 'Not documented'}`).join('\n')}

`;
  }

  private renderModuleRequirements(requirements: Requirement[]): string {
    if (requirements.length === 0) {
      return '';
    }

    return `**Requirements**:
${requirements.map(r => `- ${r.requirement_type}: ${r.description}`).join('\n')}

`;
  }

  private renderModuleEntities(entities: CodeEntity[]): string {
    if (entities.length === 0) {
      return '';
    }

    const byType: Record<string, number> = {};
    for (const entity of entities) {
      byType[entity.type] = (byType[entity.type] || 0) + 1;
    }

    const summary = Object.entries(byType)
      .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
      .join(', ');

    return `**Code Structure**: ${summary}

`;
  }

  private renderDecisions(data: LinkedData): string {
    const allDecisions = data.modules
      .flatMap(m => m.decisions)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (allDecisions.length === 0) {
      return `## 💡 Decision Log

No decisions documented.

---

`;
    }

    return `## 💡 Decision Log

${allDecisions.map((d, i) => `### ${i + 1}. ${d.decision_text}

**Date**: ${this.formatDate(d.timestamp)}
**Context**: ${d.context || 'Not specified'}

**Rationale**: ${d.rationale}

${d.alternatives_considered.length > 0 ? `**Alternatives Considered**:
${d.alternatives_considered.map(alt => `- ${alt}${d.rejected_reasons[alt] ? `: ${d.rejected_reasons[alt]}` : ''}`).join('\n')}
` : ''}

**Affected Files**: ${d.related_files.length > 0 ? d.related_files.map(f => `\`${f}\``).join(', ') : 'None specified'}

${d.related_commits.length > 0 ? `**Related Commits**: ${d.related_commits.join(', ')}\n` : ''}
`).join('\n---\n\n')}

---

`;
  }

  private renderQuality(report: QualityReport): string {
    return `## 🔍 Quality Insights

### Code Hotspots

${report.hotspots.length > 0 ? report.hotspots.map((h: HotspotWithContext) => `
**\`${h.filePath}\`**
Complexity: ${h.complexity}/10 | Changes: ${h.changeCount}

${h.relatedMistakes.length > 0 ? `Past Issues:
${h.relatedMistakes.map((m: Mistake) => `- ${m.what_went_wrong}`).join('\n')}
` : ''}
${h.relatedDecisions.length > 0 ? `Related Decisions:
${h.relatedDecisions.map((d: Decision) => `- ${d.decision_text}`).join('\n')}
` : ''}
`).join('\n') : 'No hotspots identified.\n'}

### Code Duplication

${report.clones.length > 0 ? report.clones.map(c => `
- **Similarity**: ${Math.round(c.similarity * 100)}%
  - Files: ${c.files.map((f: string) => `\`${f}\``).join(', ')}
  - ${c.description}
`).join('\n') : 'No code duplication detected.\n'}

### Lessons Learned

${report.mistakeSummary.topLessons.length > 0 ? report.mistakeSummary.topLessons.map((lesson: string) => `- ${lesson}`).join('\n') : 'No lessons documented yet.\n'}

### Mistake Summary

**Total**: ${report.mistakeSummary.total} mistakes documented

${Object.keys(report.mistakeSummary.byCategory).length > 0 ? `**By Severity**:
${Object.entries(report.mistakeSummary.byCategory).map(([cat, count]) => `- ${cat}: ${count}`).join('\n')}
` : ''}

${report.mistakeSummary.criticalIssues.length > 0 ? `**Critical Issues**:
${report.mistakeSummary.criticalIssues.map((m: Mistake) => `- ${m.what_went_wrong}`).join('\n')}
` : ''}

---

`;
  }

  private renderTimeline(timeline: TimelineEvent[]): string {
    if (timeline.length === 0) {
      return `## 📅 Development Timeline

No timeline events found.

---

`;
    }

    // Group by month
    const byMonth: Record<string, TimelineEvent[]> = {};
    for (const event of timeline) {
      const monthKey = this.formatMonth(event.timestamp);
      if (!byMonth[monthKey]) {byMonth[monthKey] = [];}
      byMonth[monthKey].push(event);
    }

    return `## 📅 Development Timeline

${Object.entries(byMonth).map(([month, events]) => `
### ${month}

${events.map(e => this.renderTimelineEvent(e)).join('\n')}
`).join('\n')}

---

`;
  }

  private renderTimelineEvent(event: TimelineEvent): string {
    const icon = {
      decision: '💡',
      mistake: '⚠️',
      commit: '📝',
      edit: '✏️'
    }[event.type] || '•';

    const date = new Date(event.timestamp).toLocaleDateString();
    const files = event.files.length > 0 ? ` (${event.files.length} files)` : '';

    return `- **${date}** ${icon} ${event.description}${files}`;
  }

  private renderFooter(): string {
    return `## 📚 About This Documentation

This documentation was automatically generated by combining:
- **Codebase analysis** from local filesystem scanning
- **Development conversations** from Claude Code conversation history
- **Git history** and commit linkage

The documentation shows not just **what** exists in the code, but **why** it was built that way.

---

*Generated by CCCMemory MCP Server*
`;
  }

  private formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  private formatMonth(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long'
    });
  }
}
