export type LearningPlanStatus = 'active' | 'paused' | 'completed' | 'superseded';

export type LearningPlanStepType =
  | 'diagnose'
  | 'retrieve'
  | 'explain'
  | 'practice'
  | 'quiz'
  | 'flashcards'
  | 'mind_map'
  | 'project'
  | 'reflect'
  | 'create_workbench';

export type LearningPlanStepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'blocked';

export interface LearningPlanStep {
  id: string;
  type: LearningPlanStepType;
  title: string;
  rationale: string;
  targetSkills: string[];
  prerequisites: string[];
  estimatedLoad: 'light' | 'medium' | 'heavy';
  expectedEvidence: string[];
  suggestedCapability?: string;
  artifactType?: string;
  status: LearningPlanStepStatus;
}

export interface LearningPlanMilestone {
  id: string;
  title: string;
  description: string;
  successCriteria: string[];
  status: 'pending' | 'active' | 'done';
}

export interface LearnerDiagnosticReport {
  learnerLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced' | 'unknown';
  targetGoal: string;
  currentStateSummary: string;
  strengths: string[];
  weakSkills: string[];
  prerequisiteGaps: string[];
  preferredResourceForms: string[];
  timeBudget: {
    sessionMinutes: number;
    weeklySessions: number;
  };
  cognitiveLoadTolerance: 'low' | 'medium' | 'high';
  recommendedDifficultyBand: {
    min: number;
    max: number;
  };
  evidence: string[];
}

export interface LearningPlanResource {
  id: string;
  title: string;
  type: 'document' | 'video' | 'exercise' | 'quiz' | 'flashcards' | 'mind_map' | 'project' | 'context';
  sourceId?: string;
  citationLabel?: string;
  summary: string;
  difficulty: number;
  estimatedMinutes: number;
  relevanceScore: number;
}

export interface KnowledgeGraphSnapshot {
  nodes: Array<{
    id: string;
    label: string;
    mastery?: number;
    importance?: number;
    kind?: 'concept' | 'skill' | 'resource';
  }>;
  edges: Array<{
    source: string;
    target: string;
    relation: 'prerequisite' | 'supports' | 'applies_to' | 'related_to';
    weight?: number;
  }>;
}

export interface ConstraintScores {
  cltScore: number;
  zpdScore: number;
  alignmentScore: number;
  confidence: number;
  summary: string;
}

export interface ReflectionRevisionSuggestion {
  type:
    | 'reduce_load'
    | 'increase_challenge'
    | 'insert_prerequisite'
    | 'reorder_steps'
    | 'replace_resource'
    | 'add_assessment'
    | 'narrow_scope';
  reason: string;
  targetStepId?: string;
  action: string;
}

export interface ReflectionReview {
  round: number;
  verdict: 'pass' | 'revise';
  summary: string;
  cltAnalysis: string;
  zpdAnalysis: string;
  strengths: string[];
  risks: string[];
  suggestions: ReflectionRevisionSuggestion[];
  constraintScores: ConstraintScores;
}

export interface LearningPlan {
  id: string;
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  scope: 'workspace' | 'workbench' | 'goal';
  version: number;
  status: LearningPlanStatus;
  objective: string;
  rationale: string;
  assumptions: string[];
  constraints: string[];
  targetSkills: string[];
  weakSkills: string[];
  milestones: LearningPlanMilestone[];
  steps: LearningPlanStep[];
  adaptationPolicy: {
    replanTriggers: string[];
    progressionSignals: string[];
    fallbackActions: string[];
  };
  evidence: {
    citations: string[];
    activeGoalTitle?: string | null;
    currentTaskIntent: string;
    readinessSummary: string;
  };
  diagnosticReport: LearnerDiagnosticReport;
  candidateResources: LearningPlanResource[];
  knowledgeGraphSnapshot: KnowledgeGraphSnapshot;
  reflectionHistory: ReflectionReview[];
  constraintScores: ConstraintScores;
  revisionCount: number;
  nextStepId?: string | null;
  previousPlanId?: string | null;
  createdAt: string;
  updatedAt: string;
}
