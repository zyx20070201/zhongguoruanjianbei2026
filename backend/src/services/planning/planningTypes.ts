import { MclLearningState } from '../learningStateBuilder';

export type PlanStatus = 'active' | 'paused' | 'completed' | 'superseded';
export type PlanStepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'blocked';
export type PlanStepType =
  | 'diagnose'
  | 'retrieve'
  | 'explain'
  | 'practice'
  | 'quiz'
  | 'flashcards'
  | 'mind_map'
  | 'project'
  | 'reflect'
  | 'create_workbench'
  | 'content_generation';

export interface LearningPlanStep {
  id: string;
  type: PlanStepType;
  title: string;
  rationale: string;
  targetSkills: string[];
  prerequisites: string[];
  estimatedLoad: 'low' | 'medium' | 'high';
  expectedEvidence: string;
  suggestedCapability?: string;
  artifactType?: string;
  status: PlanStepStatus;
  successCriteria: string[];
  fallback?: string;
}

export interface LearningPlanMilestone {
  id: string;
  title: string;
  description: string;
  evidence: string;
  targetSkills: string[];
}

export interface LearningPlan {
  id: string;
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  status: PlanStatus;
  objective: string;
  assumptions: string[];
  constraints: string[];
  targetSkills: string[];
  weakSkills: string[];
  milestones: LearningPlanMilestone[];
  steps: LearningPlanStep[];
  evidence: Array<{ sourceId?: string; label: string; reason: string }>;
  adaptationPolicy: {
    replanTriggers: string[];
    nextReviewAfter: string;
    strategy: string;
  };
  version: number;
  previousPlanId?: string | null;
  createdAt: string;
  updatedAt: string;
  source: 'deepseek' | 'fallback';
}

export interface PlannerInput {
  state: MclLearningState;
  userInput: string;
  previousPlan?: LearningPlan | null;
  mode?: 'plan' | 'revise';
}

export interface PlannerOutput {
  plan: LearningPlan;
  summary: string;
  revisionReason?: string;
}
