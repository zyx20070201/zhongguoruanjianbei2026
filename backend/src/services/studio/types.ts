import { ClientWorkbenchContext } from '../contextSystemService';
import { LearnerStateAgentContext } from '../learnerStateContextAdapter';
import { ContextCapsule, ContextPolicyDecision } from '../../types/contextSystem';

export type StudioGoalCategory =
  | 'understand'
  | 'map'
  | 'practice'
  | 'review'
  | 'lab'
  | 'visualize'
  | 'plan';

export type StudioGeneratorKind =
  | 'text'
  | 'structure'
  | 'assessment'
  | 'memory'
  | 'code_lab'
  | 'multimodal'
  | 'planning'
  | 'review';

export type StudioRendererKind =
  | 'markdown'
  | 'csv'
  | 'json'
  | 'quiz'
  | 'flashcards'
  | 'mermaid'
  | 'concept_graph'
  | 'slides'
  | 'code_lab'
  | 'visual_explainer'
  | 'interactive_html'
  | 'manim_script'
  | 'remotion_source';

export type StudioArtifactFormat = 'md' | 'json' | 'csv';

export interface StudioTemplateOption {
  id: string;
  label: string;
  type: 'text' | 'select' | 'multiselect' | 'number' | 'boolean';
  defaultValue?: unknown;
  choices?: Array<{ value: string; label: string }>;
}

export interface StudioRecommendationRule {
  id: string;
  reason: string;
  priority: number;
  when?: Array<
    | 'no_diagnostic'
    | 'weak_knowledge'
    | 'review_pressure'
    | 'has_sources'
    | 'code_context'
    | 'visual_preference'
    | 'thin_evidence'
  >;
}

export interface StudioResourceTemplate {
  id: string;
  version?: string;
  goal: StudioGoalCategory;
  title: string;
  shortTitle?: string;
  description: string;
  generator: StudioGeneratorKind;
  renderer: StudioRendererKind;
  format: StudioArtifactFormat;
  filename: string;
  outputLabel: string;
  promptFrame: string;
  systemInstruction: string;
  defaultOptions?: Record<string, unknown>;
  options?: StudioTemplateOption[];
  tags?: string[];
  recommendedUse?: string;
  recommendationRules?: StudioRecommendationRule[];
  legacyResourceType?: 'report' | 'slide_deck' | 'mind_map' | 'flashcards' | 'quiz' | 'data_table';
}

export type StudioArtifactKind =
  | 'text'
  | 'mind_map'
  | 'quiz'
  | 'flashcards'
  | 'code_lab'
  | 'slides'
  | 'visual_explainer'
  | 'video_script'
  | 'interactive_demo'
  | 'animation_script'
  | 'ui_video'
  | 'study_plan';

export interface StudioSourceRef {
  sourceId?: string;
  title: string;
  fileId?: string | null;
  fileName?: string | null;
  locator?: Record<string, unknown>;
  snippet?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export interface StudioStructuredArtifact<TPayload = Record<string, unknown>> {
  schemaVersion: 'studio_artifact.v1';
  artifactKind: StudioArtifactKind;
  title: string;
  summary: string;
  goal: StudioGoalCategory;
  templateId: string;
  templateVersion: string;
  generatorKind: StudioGeneratorKind;
  generatorVersion: string;
  renderer: StudioRendererKind;
  payload: TPayload;
  sourceRefs: StudioSourceRef[];
  personalization: {
    learnerHints: string[];
    targetDifficulty?: string;
    weakConcepts: string[];
    recommendationReason?: string;
  };
  nextActions: string[];
}

export interface StudioGenerateV2Input {
  workspaceId: string;
  workbenchId?: string | null;
  goal?: StudioGoalCategory;
  templateId: string;
  prompt?: string;
  options?: Record<string, unknown>;
  context: ClientWorkbenchContext;
}

export interface StudioWorkflowTraceItem {
  id: string;
  agent: string;
  title: string;
  status: 'completed' | 'failed';
  summary: string;
  details?: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface StudioGenerationContext {
  input: StudioGenerateV2Input;
  template: StudioResourceTemplate;
  runId: string;
  goalId?: string | null;
  capsule: ContextCapsule;
  contextPolicy?: ContextPolicyDecision;
  learnerContext?: LearnerStateAgentContext;
  recommendation?: StudioRecommendation | null;
  enrichment?: {
    resourceDiscovery?: {
      provider: string;
      query: string;
      results: Array<{
        id: string;
        title: string;
        url: string;
        snippet: string;
        summary?: string;
        score?: number;
        source?: string;
        provider: string;
        publishedAt?: string;
        author?: string;
        contentPreview?: string;
      }>;
      warning?: string;
    };
    parentPlan?: Record<string, unknown> | null;
  };
  trace: StudioWorkflowTraceItem[];
}

export interface StudioGeneratorResult {
  content: string;
  structured?: StudioStructuredArtifact | null;
  source: string;
  warnings?: string[];
  metadata?: Record<string, unknown>;
}

export interface StudioReviewResult {
  score: number;
  warnings: string[];
  checks: Array<{ id: string; label: string; passed: boolean; severity: 'info' | 'warning' | 'error'; message: string }>;
  metrics: {
    grounding: number;
    schema: number;
    personalization: number;
    pedagogicalFit: number;
    usability: number;
  };
  passed: boolean;
  summary: string;
  revisedContent?: string;
}

export interface StudioGenerateV2Result {
  file: any;
  content: string;
  template: StudioResourceTemplate;
  goal: StudioGoalCategory;
  generator: StudioGeneratorKind;
  renderer: StudioRendererKind;
  runId: string;
  source: string;
  metadata?: Record<string, unknown>;
  contextCapsule: ContextCapsule;
  contextPolicy?: ContextPolicyDecision;
  usedContextSummary: {
    mode: string;
    selection: boolean;
    viewport: boolean;
    activeFile: string | null;
    resources: number;
    retrievedChunks: number;
    estimatedTokens: number;
    citations: string[];
  };
  workflowTrace: StudioWorkflowTraceItem[];
  review: StudioReviewResult;
  qualityReport?: {
    score: number;
    keptCount: number;
    removedCount: number;
    warnings: string[];
    issues: Array<{ questionId: string; severity: string; code: string; message: string }>;
  } | null;
  practiceNext?: StudioPracticeNextRecommendation | null;
  recommendation?: StudioRecommendation | null;
  structured?: StudioStructuredArtifact | null;
  artifact?: {
    id: string;
    artifactKey: string;
    title: string;
    templateId: string;
    templateVersion: string;
    schemaVersion: string;
  } | null;
  renderJob?: {
    id: string;
    status: string;
    stage: string;
    progress: number;
    kind: string;
    framework?: string | null;
    outputFileObjectId?: string | null;
    error?: string | null;
    logs?: string[];
  } | null;
  delivery?: {
    kind: 'markdown' | 'pptx' | 'html' | 'python' | 'tsx';
    filename: string;
    mimeType: string;
    fileObjectId: string;
    path: string;
    framework?: string;
    previewContent?: string;
  } | null;
}

export interface StudioRecommendation {
  id: string;
  goal: StudioGoalCategory;
  templateId: string;
  title: string;
  reason: string;
  priority: number;
  evidence: string[];
  actions: Array<{ id: string; label: string; templateId: string; goal: StudioGoalCategory }>;
}

export interface StudioPracticeMasterySummary {
  averageScore: number;
  attemptedCount: number;
  correctCount: number;
  weakConcepts: string[];
  masteredConcepts: string[];
  needsRemediation: boolean;
}

export interface StudioPracticeNextRecommendation {
  templateId: string;
  goal: 'practice';
  title: string;
  reason: string;
  priority: number;
  evidence: string[];
  focusConcepts: string[];
  preferredDifficulty: 'easy' | 'medium' | 'hard' | 'adaptive';
  mastery?: StudioPracticeMasterySummary;
}

export interface StudioRecommendInput {
  workspaceId: string;
  workbenchId?: string | null;
  goal?: StudioGoalCategory;
  context: ClientWorkbenchContext;
}

export interface StudioRecommendationFeatures {
  evidenceCount: number;
  eventCount: number;
  quizRunCount: number;
  generatedArtifactCount: number;
  sourceCount: number;
  retrievedChunkCount: number;
  weakConceptCount: number;
  reviewPressureCount: number;
  codeSignalCount: number;
  visualSignalCount: number;
  recentLowScoreCount: number;
  thinEvidence: boolean;
  lastQuizAverageScore?: number;
  lastQuizWeakConcepts?: string[];
  lastQuizMasteredConcepts?: string[];
}
