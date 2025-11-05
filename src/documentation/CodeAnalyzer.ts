/**
 * CodeAnalyzer - Processes code graph data from CODE-GRAPH-RAG-MCP
 *
 * Note: This class processes data that should be fetched from CODE-GRAPH-RAG-MCP
 * The actual MCP calls should be made by the tool handler and passed to this analyzer
 */

import type {
  CodeData,
  CodeEntity,
  FileInfo,
  Hotspot,
  CodeClone,
  RawEntity,
  RawHotspot,
  RawClone
} from './types.js';

export interface CodeGraphRagData {
  entities?: RawEntity[];
  hotspots?: RawHotspot[];
  clones?: RawClone[];
  graph?: Record<string, unknown>;
}

export class CodeAnalyzer {
  /**
   * Process code graph data from CODE-GRAPH-RAG-MCP
   */
  async analyze(codeGraphData: CodeGraphRagData): Promise<CodeData> {
    console.log('🔍 Processing codebase structure...');

    const entities = this.parseEntities(codeGraphData.entities || []);
    const files = this.groupEntitiesByFile(entities);
    const hotspots = this.parseHotspots(codeGraphData.hotspots || []);
    const clones = this.parseClones(codeGraphData.clones || []);

    console.log(`  Found ${entities.length} entities in ${files.length} files`);

    return {
      entities,
      relationships: [],
      files,
      hotspots,
      clones
    };
  }

  private parseEntities(rawEntities: RawEntity[]): CodeEntity[] {
    if (!Array.isArray(rawEntities)) {
      return [];
    }

    return rawEntities.map(entity => ({
      id: entity.id || entity.name || '',
      name: entity.name || '',
      type: this.normalizeEntityType(entity.type || ''),
      filePath: entity.filePath || entity.file || '',
      lineNumber: entity.lineNumber || entity.line,
      complexity: entity.complexity,
      description: entity.description
    })).filter(e => e.id && e.name);
  }

  private normalizeEntityType(type: string): CodeEntity['type'] {
    const normalized = (type || '').toLowerCase();
    if (normalized.includes('class')) {return 'class';}
    if (normalized.includes('function') || normalized.includes('method')) {return 'function';}
    if (normalized.includes('interface')) {return 'interface';}
    if (normalized.includes('module')) {return 'module';}
    if (normalized.includes('component')) {return 'component';}
    return 'function';
  }

  private groupEntitiesByFile(entities: CodeEntity[]): FileInfo[] {
    const fileMap = new Map<string, CodeEntity[]>();

    for (const entity of entities) {
      if (!entity.filePath) {
        continue;
      }

      if (!fileMap.has(entity.filePath)) {
        fileMap.set(entity.filePath, []);
      }
      const fileEntities = fileMap.get(entity.filePath);
      if (fileEntities) {
        fileEntities.push(entity);
      }
    }

    return Array.from(fileMap.entries()).map(([path, entities]) => ({
      path,
      size: 0, // Would need to read file to get actual size
      entities
    }));
  }

  private parseHotspots(rawHotspots: RawHotspot[]): Hotspot[] {
    if (!Array.isArray(rawHotspots)) {
      return [];
    }

    return rawHotspots.map(h => ({
      filePath: h.filePath || h.file || h.path || '',
      complexity: h.complexity || h.score || 0,
      changeCount: h.changeCount || h.changes || 0,
      metric: h.metric || 'complexity'
    })).filter(h => h.filePath);
  }

  private parseClones(rawClones: RawClone[]): CodeClone[] {
    if (!Array.isArray(rawClones)) {
      return [];
    }

    return rawClones.map(c => ({
      files: Array.isArray(c.files) ? c.files : [],
      similarity: c.similarity || c.score || 0,
      description: c.description || 'Code duplication detected'
    })).filter(c => c.files.length >= 2);
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
