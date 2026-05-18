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

export type LearningPlanTeachingPhase =
  | 'diagnostic'
  | 'prerequisite_bridge'
  | 'concept_model'
  | 'worked_example'
  | 'guided_practice'
  | 'independent_practice'
  | 'formative_assessment'
  | 'reflection'
  | 'resource_grounding'
  | 'project_application';

export type LearningPlanEvidenceType =
  | 'diagnostic_signal'
  | 'concept_explanation'
  | 'worked_solution'
  | 'practice_attempt'
  | 'quiz_result'
  | 'reflection_note'
  | 'project_artifact'
  | 'resource_trace';

export type ResourceGroundingStatus = 'grounded' | 'partial' | 'resource_gap';

export interface LearningPlanGroundingEvidence {
  fileId: string;
  fileName: string;
  path?: string;
  chunkId?: string;
  locator?: Record<string, unknown>;
  snippet: string;
  contextBefore?: string;
  contextAfter?: string;
  supportedClaims: string[];
  whySupports: string;
  confidence: number;
  retrievalQuery?: string;
}

export interface LearningPlanRejectedEvidence {
  fileId: string;
  fileName: string;
  chunkId?: string;
  locator?: Record<string, unknown>;
  snippet?: string;
  reason: string;
  claim?: string;
}

export interface LearningPlanGroundingClaim {
  id: string;
  text: string;
  query: string;
  queries?: string[];
  source?: 'goal' | 'skill' | 'prerequisite' | 'activity' | 'evidence' | 'rationale' | 'title';
  required: boolean;
  status: 'supported' | 'partial' | 'missing';
  evidenceChunkIds: string[];
  missingReason?: string;
}

export interface LearningPlanClaimEvidenceMatrixItem {
  claimId: string;
  claim: string;
  status: 'supported' | 'partial' | 'missing';
  evidence: LearningPlanGroundingEvidence[];
  rejectedEvidence: LearningPlanRejectedEvidence[];
  missingReason?: string;
}

export interface LearningPlanResourceMatch {
  resourceId: string;
  resourceTitle: string;
  resourceUnitId?: string;
  resourceUnitTitle?: string;
  resourceLocator?: Record<string, unknown>;
  resourceEntryPoint?: string;
  modality?: ResourceLearningUnit['modality'];
  difficulty?: number;
  estimatedMinutes?: number;
  matchScore: number;
  scoreBreakdown?: {
    relevance: number;
    difficultyFit: number;
    prerequisiteFit: number;
    learnerFit: number;
  };
  reason: string;
  evidenceSnippets?: string[];
  acceptedEvidence?: LearningPlanGroundingEvidence[];
  rejectedEvidence?: LearningPlanRejectedEvidence[];
  missingClaims?: string[];
  claimIds?: string[];
  groundingMethod?: 'evidence_search' | 'resource_profile' | 'fallback';
}

export interface LearningPlanCurriculumDecision {
  learningGoal: string;
  whyThisStage: string;
  idealActivities: string[];
  prerequisiteAssumptions: string[];
  difficultyRationale?: string;
}

export interface LearningPlanResourceGrounding {
  status: ResourceGroundingStatus;
  matches: LearningPlanResourceMatch[];
  gapReason?: string;
  neededResource?: string;
  warnings?: string[];
  coverageScore?: number;
  supportedClaims?: string[];
  missingClaims?: string[];
  rejectedEvidence?: LearningPlanRejectedEvidence[];
  claims?: LearningPlanGroundingClaim[];
  claimEvidenceMatrix?: LearningPlanClaimEvidenceMatrixItem[];
  groundingMethod?: 'evidence_search' | 'resource_profile' | 'fallback';
}

export type LearningPlanResourceDisplayType = 'document' | 'video' | 'exercise' | 'project';

export interface LearningPlanStepResourceRecommendation {
  id: string;
  type: LearningPlanResourceDisplayType;
  name: string;
  source?: string;
  location?: string;
  matchReason: string;
  usage: string;
}

export interface LearningPlanStepDetail {
  learningGoal: string;
  whyThisStep: string;
  learningTasks: string[];
  recommendedResources: Record<LearningPlanResourceDisplayType, LearningPlanStepResourceRecommendation[]>;
  resourceGaps: Record<LearningPlanResourceDisplayType, string>;
  masteryCriteria: string[];
  dynamicAdjustment: {
    passCondition: string;
    remedialAction: string;
    fallbackStep?: string;
    nextStep?: string;
  };
  learnerProfile?: Record<string, unknown>;
  personalizationReason?: string;
}

export interface LearningPlanStep {
  id: string;
  type: LearningPlanStepType;
  title: string;
  rationale: string;
  stepDetail?: LearningPlanStepDetail;
  learningGoal?: string;
  whyThisStage?: string;
  targetSkills: string[];
  prerequisites: string[];
  estimatedLoad: 'light' | 'medium' | 'heavy';
  expectedEvidence: string[];
  activities?: string[];
  suggestedCapability?: string;
  artifactType?: string;
  teachingPhase?: LearningPlanTeachingPhase;
  concept?: string;
  resourceId?: string;
  resourceTitle?: string;
  resourceUnitId?: string;
  resourceUnitTitle?: string;
  resourceLocator?: Record<string, unknown>;
  resourceEntryPoint?: string;
  resourceReason?: string;
  resourceOptions?: LearningPlanResourceMatch[];
  curriculumDecision?: LearningPlanCurriculumDecision;
  resourceGrounding?: LearningPlanResourceGrounding;
  groundingStatus?: ResourceGroundingStatus;
  resourceMatchScore?: number;
  resourceGapReason?: string;
  difficulty?: number;
  estimatedMinutes?: number;
  evidenceType?: LearningPlanEvidenceType;
  successCriteria?: string[];
  unlockCondition?: string;
  qualitySignals?: string[];
  riskNotes?: string[];
  status: LearningPlanStepStatus;
}

export type StructuredLearningPlanType = 'normal' | 'time_limited' | 'exam' | 'project' | 'weakness_focused' | 'mixed';

export interface StructuredLearningPlanStage {
  order: number;
  title: string;
  display: {
    narrative: string;
    tags: string[];
    shortHint?: string;
    summary?: string;
    focusTags?: string[];
    primaryTask?: string;
    completionHint?: string;
  };
  detail: {
    narrative: string;
    practiceTasks: string[];
    completionCriteria: string[];
    rawFields: {
      learningGoal: string;
      coreContent: string[];
      howToLearn: string;
      practiceTasks: string[];
      completionCriteria: string[];
    };
    learningGoal?: string;
    coreContent?: string[];
    howToLearn?: string;
  };
}

export interface StructuredLearningPlan {
  title: string;
  objective: string;
  overview: {
    goalUnderstanding: string;
    learnerContext: string;
    overallPath: string;
    planType: StructuredLearningPlanType;
  };
  stages: StructuredLearningPlanStage[];
  actionPlan: Array<{
    label: string;
    task: string;
    estimatedMinutes?: number;
  }>;
  commonProblems: Array<{
    problem: string;
    adjustment: string;
  }>;
  masteryCriteria: string[];
  rawMarkdown: string;
  parseFailed?: boolean;
  parseError?: string;
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

export interface ResourceLearningUnit {
  id: string;
  resourceId: string;
  resourceTitle: string;
  resourceType: LearningPlanResource['type'];
  sourceFileName?: string;
  sourceFilePath?: string;
  workbenchRole?: string;
  title: string;
  summary: string;
  locator?: Record<string, unknown>;
  entryPoint?: string;
  teaches: string[];
  prerequisites: string[];
  difficulty: number;
  estimatedMinutes: number;
  modality: 'read' | 'watch' | 'practice' | 'quiz' | 'review' | 'project' | 'mixed';
  coverage?: 'overview' | 'section' | 'chunk' | 'chapter' | 'page_range' | 'timestamp_range' | 'binding' | 'mixed';
  evidenceSnippets: string[];
  resourceSignals?: string[];
  relevanceScore: number;
  source: 'capsule' | 'knowledge_chunk' | 'kg_binding' | 'goal' | 'fallback';
}

export type ResourcePlanningTeachingRole =
  | 'concept_explanation'
  | 'worked_example'
  | 'practice'
  | 'project'
  | 'reference'
  | 'advanced_extension';

export interface ResourcePlanningProfile {
  resourceId: string;
  unitId: string;
  title: string;
  summary: string;
  coveredSkills: string[];
  prerequisiteSkills: string[];
  targetLearnerLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced' | 'unknown';
  teachingRole: ResourcePlanningTeachingRole;
  difficulty: number;
  suitableStages: LearningPlanTeachingPhase[];
  riskFlags: string[];
  locator?: Record<string, unknown>;
  entryPoint?: string;
  evidenceSnippets: string[];
  sourceFileName?: string;
  sourceFilePath?: string;
}

export interface GoalSkillNode {
  id: string;
  title: string;
  description: string;
  priority: number;
  currentStatus: 'mastered' | 'partial' | 'weak' | 'unknown';
  prerequisites: string[];
  evidence: string[];
  suggestedResourceUnitIds: string[];
}

export interface GoalSkillMap {
  objective: string;
  targetSkills: GoalSkillNode[];
  prerequisiteSkills: GoalSkillNode[];
  skillGaps: GoalSkillNode[];
  recommendedSequence: string[];
  assumptions: string[];
  evidence: string[];
  source: 'ai' | 'fallback';
}

export interface KgPlanningHints {
  masteredConcepts: string[];
  weakConcepts: string[];
  targetConcepts: string[];
  prerequisiteEdges: Array<{ from: string; to: string; relation: string; weight?: number }>;
  riskJumps: string[];
  recommendedOrderHints: string[];
  evidence: string[];
}

export interface PlanningContextBundle {
  schema: 'planning_context_bundle.v1';
  objective: string;
  workspace: {
    id: string;
    name: string;
    major?: string | null;
  };
  workbench?: {
    id: string;
    title: string;
    description?: string;
  } | null;
  learner: {
    profileSummary: string;
    preferences: Record<string, unknown>;
    centralStateSummary: string;
    agentHints: string[];
  };
  activeGoal?: {
    id: string;
    title: string;
    goalText: string;
    skills: string[];
    weaknesses: string[];
  } | null;
  resourceInventory: LearningPlanResource[];
  resourceLearningUnits: ResourceLearningUnit[];
  kgHints: KgPlanningHints;
  recentEvidence: Array<{ type: string; summary: string; evidence: string[]; updatedAt?: string }>;
  readiness: {
    ready: boolean;
    checks: Array<{ id: string; ok: boolean; message: string }>;
    stats: Record<string, number>;
  };
  contextPolicy: {
    intent?: string;
    ragScope?: string;
    maxRetrievedChunks?: number;
    reasons: string[];
  };
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
  pedagogyScore?: number;
  resourceGroundingScore?: number;
  sequencingScore?: number;
  assessmentScore?: number;
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
    | 'narrow_scope'
    | 'strengthen_resource_grounding'
    | 'add_scaffold'
    | 'tighten_success_criteria';
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
  pedagogyAnalysis?: string;
  strengths: string[];
  risks: string[];
  suggestions: ReflectionRevisionSuggestion[];
  constraintScores: ConstraintScores;
  rubric?: {
    resourceGrounding: string;
    prerequisiteSequencing: string;
    skillCoverage: string;
    assessmentLoop: string;
    personalization: string;
  };
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
  naturalPlanMarkdown?: string;
  structuredPlan?: StructuredLearningPlan | null;
  skipPlanningSideEffects?: boolean;
  createdAt: string;
  updatedAt: string;
}
