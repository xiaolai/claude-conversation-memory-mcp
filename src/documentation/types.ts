/**
 * Type definitions for documentation generation
 */

// ==================== Code Analysis Types ====================

export interface CodeEntity {
  id: string;
  name: string;
  type: 'class' | 'function' | 'interface' | 'module' | 'component';
  filePath: string;
  lineNumber?: number;
  complexity?: number;
  description?: string;
}

export interface Relationship {
  from: string;
  to: string;
  type: string;
  description?: string;
}

export interface FileInfo {
  path: string;
  size: number;
  entities: CodeEntity[];
}

export interface Hotspot {
  filePath: string;
  complexity: number;
  changeCount: number;
  metric: string;
}

export interface CodeClone {
  files: string[];
  similarity: number;
  description: string;
}

export interface CodeData {
  entities: CodeEntity[];
  relationships: Relationship[];
  files: FileInfo[];
  hotspots: Hotspot[];
  clones: CodeClone[];
}

// Raw data types from CODE-GRAPH-RAG-MCP
export interface RawEntity {
  id?: string;
  name?: string;
  type?: string;
  filePath?: string;
  file?: string;
  lineNumber?: number;
  line?: number;
  complexity?: number;
  description?: string;
}

export interface RawHotspot {
  filePath?: string;
  file?: string;
  path?: string;
  complexity?: number;
  score?: number;
  changeCount?: number;
  changes?: number;
  metric?: string;
}

export interface RawClone {
  files?: string[];
  similarity?: number;
  score?: number;
  description?: string;
}

// ==================== Conversation Analysis Types ====================

export interface Decision {
  id: string;
  conversation_id: string;
  message_id: string;
  decision_text: string;
  rationale: string;
  alternatives_considered: string[];
  rejected_reasons: Record<string, string>;
  context?: string;
  related_files: string[];
  related_commits: string[];
  timestamp: number;
}

export interface Mistake {
  id: string;
  conversation_id: string;
  what_went_wrong: string;
  why_it_happened: string;
  how_it_was_fixed: string;
  lesson_learned: string;
  related_files: string[];
  severity: string;
  timestamp: number;
}

export interface Requirement {
  id: string;
  requirement_type: string;
  description: string;
  rationale?: string;
  related_files: string[];
  timestamp: number;
}

export interface FileEdit {
  id: string;
  conversation_id: string;
  file_path: string;
  edit_type: string;
  timestamp: number;
}

export interface GitCommit {
  hash: string;
  conversation_id?: string;
  message: string;
  author: string;
  timestamp: number;
  files_changed: string[];
}

export interface ConversationData {
  decisions: Decision[];
  mistakes: Mistake[];
  requirements: Requirement[];
  fileEdits: FileEdit[];
  commits: GitCommit[];
}

// ==================== Cross-Referenced Types ====================

export interface LinkedModule {
  path: string;
  name: string;
  entities: CodeEntity[];
  decisions: Decision[];
  mistakes: Mistake[];
  requirements: Requirement[];
  complexity: number;
  changeFrequency: number;
  description?: string;
}

export interface TimelineEvent {
  timestamp: number;
  type: 'decision' | 'mistake' | 'commit' | 'edit';
  description: string;
  files: string[];
  details: unknown;
}

export interface QualityReport {
  hotspots: HotspotWithContext[];
  clones: CodeClone[];
  mistakeSummary: MistakeSummary;
}

export interface HotspotWithContext extends Hotspot {
  relatedMistakes: Mistake[];
  relatedDecisions: Decision[];
}

export interface MistakeSummary {
  total: number;
  byCategory: Record<string, number>;
  topLessons: string[];
  criticalIssues: Mistake[];
}

export interface LinkedData {
  modules: LinkedModule[];
  timeline: TimelineEvent[];
  qualityReport: QualityReport;
  statistics: DocumentationStatistics;
}

export interface DocumentationStatistics {
  totalFiles: number;
  totalEntities: number;
  totalDecisions: number;
  totalMistakes: number;
  totalCommits: number;
  averageComplexity: number;
}

// ==================== Options ====================

export interface DocumentationOptions {
  projectPath: string;
  sessionId?: string;
  scope: 'full' | 'architecture' | 'decisions' | 'quality';
  moduleFilter?: string;
}
