import client from '../api/client';
import { AiChatContext, AiChatMessage, AiStudioResourceType } from './aiApi';

export type MclIntent =
  | 'state'
  | 'chat'
  | 'planning'
  | 'goal_planning'
  | 'diagnosis'
  | 'knowledge_retrieval'
  | 'reflection'
  | 'content_generation'
  | 'quiz_generation'
  | 'studio_generate'
  | 'auto';

export interface MclExecutePayload {
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  intent?: MclIntent | string;
  userInput?: string;
  messages?: AiChatMessage[];
  resourceType?: AiStudioResourceType;
  options?: Record<string, unknown>;
  capability?: string;
  capabilityInput?: Record<string, unknown>;
  context?: Partial<AiChatContext>;
  previousPlan?: Record<string, unknown> | null;
  sync?: boolean;
}

export interface MclTimelineItem {
  agentName: string;
  inputSummary: string;
  outputSummary: string;
  status: 'completed' | 'running' | 'failed' | string;
}

export interface MclLearningPlanStep {
  id: string;
  type: string;
  title: string;
  rationale: string;
  stepDetail?: {
    learningGoal?: string;
    whyThisStep?: string;
    learningTasks?: string[];
    recommendedResources?: Record<string, Array<{
      id?: string;
      type?: string;
      name?: string;
      source?: string;
      location?: string;
      matchReason?: string;
      usage?: string;
    }>>;
    resourceGaps?: Record<string, string>;
    masteryCriteria?: string[];
    dynamicAdjustment?: {
      passCondition?: string;
      remedialAction?: string;
      fallbackStep?: string;
      nextStep?: string;
    };
    learnerProfile?: Record<string, unknown>;
    personalizationReason?: string;
  };
  learningGoal?: string;
  whyThisStage?: string;
  targetSkills?: string[];
  prerequisites?: string[];
  estimatedLoad?: 'light' | 'medium' | 'heavy' | string;
  expectedEvidence?: string[];
  suggestedCapability?: string;
  artifactType?: string;
  teachingPhase?: string;
  concept?: string;
  resourceId?: string;
  resourceTitle?: string;
  resourceUnitId?: string;
  resourceUnitTitle?: string;
  resourceLocator?: Record<string, unknown>;
  resourceEntryPoint?: string;
  resourceReason?: string;
  resourceGapReason?: string;
  groundingStatus?: string;
  resourceGrounding?: {
    status?: string;
    matches?: Array<{
      resourceId?: string;
      resourceTitle?: string;
      resourceUnitId?: string;
      resourceUnitTitle?: string;
      resourceLocator?: Record<string, unknown>;
      resourceEntryPoint?: string;
      reason?: string;
      matchScore?: number;
      evidenceSnippets?: string[];
      acceptedEvidence?: Array<{
        fileId?: string;
        fileName?: string;
        path?: string;
        chunkId?: string;
        locator?: Record<string, unknown>;
        snippet?: string;
        contextBefore?: string;
        contextAfter?: string;
        supportedClaims?: string[];
        whySupports?: string;
        confidence?: number;
        retrievalQuery?: string;
      }>;
      rejectedEvidence?: Array<{
        fileId?: string;
        fileName?: string;
        chunkId?: string;
        locator?: Record<string, unknown>;
        snippet?: string;
        reason?: string;
        claim?: string;
      }>;
      missingClaims?: string[];
      claimIds?: string[];
      groundingMethod?: string;
    }>;
    gapReason?: string;
    neededResource?: string;
    warnings?: string[];
    coverageScore?: number;
    supportedClaims?: string[];
    missingClaims?: string[];
    rejectedEvidence?: Array<Record<string, unknown>>;
    claims?: Array<{
      id?: string;
      text?: string;
      query?: string;
      queries?: string[];
      source?: string;
      required?: boolean;
      status?: string;
      evidenceChunkIds?: string[];
      missingReason?: string;
    }>;
    claimEvidenceMatrix?: Array<{
      claimId?: string;
      claim?: string;
      status?: string;
      evidence?: Array<Record<string, unknown>>;
      rejectedEvidence?: Array<Record<string, unknown>>;
      missingReason?: string;
    }>;
    groundingMethod?: string;
  };
  resourceOptions?: Array<{
    resourceTitle?: string;
    resourceUnitTitle?: string;
    resourceEntryPoint?: string;
    reason?: string;
    matchScore?: number;
  }>;
  difficulty?: number;
  estimatedMinutes?: number;
  evidenceType?: string;
  successCriteria?: string[];
  unlockCondition?: string;
  qualitySignals?: string[];
  status: string;
}

export interface MclLearningPlan {
  id: string;
  version: number;
  status: string;
  objective: string;
  rationale: string;
  naturalPlanMarkdown?: string;
  structuredPlan?: {
    title: string;
    objective: string;
    overview: {
      goalUnderstanding: string;
      learnerContext: string;
      overallPath: string;
      planType: 'normal' | 'time_limited' | 'exam' | 'project' | 'weakness_focused' | 'mixed' | string;
    };
    stages: Array<{
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
    }>;
    actionPlan: Array<{ label: string; task: string; estimatedMinutes?: number }>;
    commonProblems: Array<{ problem: string; adjustment: string }>;
    masteryCriteria: string[];
    rawMarkdown: string;
    parseFailed?: boolean;
    parseError?: string;
  } | null;
  assumptions?: string[];
  constraints?: string[];
  targetSkills?: string[];
  weakSkills?: string[];
  steps: MclLearningPlanStep[];
  nextStepId?: string | null;
  constraintScores?: {
    cltScore?: number;
    zpdScore?: number;
    alignmentScore?: number;
    pedagogyScore?: number;
    resourceGroundingScore?: number;
    sequencingScore?: number;
    assessmentScore?: number;
    confidence?: number;
    summary?: string;
  };
  adaptationPolicy?: {
    replanTriggers?: string[];
    progressionSignals?: string[];
    fallbackActions?: string[];
  };
  evidence?: {
    citations?: string[];
    readinessSummary?: string;
    currentTaskIntent?: string;
    activeGoalTitle?: string | null;
  };
  diagnosticReport?: {
    learnerLevel?: string;
    currentStateSummary?: string;
    strengths?: string[];
    weakSkills?: string[];
    prerequisiteGaps?: string[];
    cognitiveLoadTolerance?: string;
    pedagogyAnalysis?: string;
  };
  updatedAt?: string;
}

export interface MclExecuteResult {
  intent: string;
  runId?: string;
  status?: string;
  plan?: MclLearningPlan;
  learningState?: any;
  contextCapsule?: any;
  contextPolicy?: any;
  timeline?: MclTimelineItem[];
  actions?: Array<Record<string, unknown>>;
  error?: string;
}

export interface MclRunRecord {
  id: string;
  status: 'running' | 'completed' | 'failed' | string;
  resultJson?: string | null;
  errorMessage?: string | null;
  steps?: Array<{
    capability: string;
    status: string;
    outputJson?: string | null;
    errorMessage?: string | null;
  }>;
}

export const mclApi = {
  execute: async (payload: MclExecutePayload): Promise<MclExecuteResult> => {
    const response = await client.post('/mcl/execute', payload, {
      timeout: payload.intent === 'planning' || payload.intent === 'goal_planning' ? 300000 : 60000,
    });
    return response.data;
  },

  getRun: async (id: string): Promise<{ run: MclRunRecord }> => {
    const response = await client.get(`/learning/runs/${id}`);
    return response.data;
  },

  buildState: async (payload: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    intent?: string;
    userInput?: string;
    resourceType?: string;
    context?: Partial<AiChatContext>;
  }) => {
    const response = await client.post('/mcl/state', payload, { timeout: 60000 });
    return response.data;
  }
};
