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
  targetSkills?: string[];
  prerequisites?: string[];
  estimatedLoad?: 'light' | 'medium' | 'heavy' | string;
  expectedEvidence?: string[];
  suggestedCapability?: string;
  artifactType?: string;
  status: string;
}

export interface MclLearningPlan {
  id: string;
  version: number;
  status: string;
  objective: string;
  rationale: string;
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

export const mclApi = {
  execute: async (payload: MclExecutePayload): Promise<MclExecuteResult> => {
    const response = await client.post('/mcl/execute', payload, {
      timeout: payload.intent === 'planning' || payload.intent === 'goal_planning' ? 180000 : 60000,
    });
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
