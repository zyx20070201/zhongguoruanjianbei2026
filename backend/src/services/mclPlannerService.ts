import crypto from 'crypto';
import { deepseekService } from './deepseekService';
import { learningRunService } from './learningRunService';
import { BuiltMclLearningState } from './learningStateBuilder';
import {
  ConstraintScores,
  KnowledgeGraphSnapshot,
  LearnerDiagnosticReport,
  LearningPlan,
  LearningPlanMilestone,
  LearningPlanResource,
  LearningPlanStep,
  LearningPlanStepType,
  ReflectionReview,
  ReflectionRevisionSuggestion
} from './planningTypes';

const MAX_REFLECTION_ROUNDS = 1;
const PLANNER_STAGE_TIMEOUT_MS = Number(process.env.MCL_PLANNER_STAGE_TIMEOUT_MS || 45000);

export interface MclPlannerStageEvent {
  name: string;
  status: 'started' | 'completed' | 'failed' | 'fallback';
  durationMs?: number;
  summary?: string;
  error?: string;
}

export interface MclPlannerRunOptions {
  runId?: string;
  onStage?: (event: MclPlannerStageEvent) => void | Promise<void>;
}

type DraftPlannerStep = {
  type: LearningPlanStepType;
  title: string;
  rationale: string;
  targetSkills: string[];
  prerequisites: string[];
  estimatedLoad: 'light' | 'medium' | 'heavy';
  expectedEvidence: string[];
  suggestedCapability?: string;
  artifactType?: string;
  concept?: string;
  resourceId?: string;
  resourceReason?: string;
  difficulty?: number;
  estimatedMinutes?: number;
};

type DraftPlannerMilestone = {
  title: string;
  description: string;
  successCriteria: string[];
};

type PlannerPathDraft = {
  objective: string;
  rationale: string;
  assumptions: string[];
  constraints: string[];
  targetSkills: string[];
  weakSkills: string[];
  milestones: DraftPlannerMilestone[];
  steps: DraftPlannerStep[];
  adaptationPolicy: {
    replanTriggers: string[];
    progressionSignals: string[];
    fallbackActions: string[];
  };
};

type ReflectionResponse = {
  verdict: 'pass' | 'revise';
  summary: string;
  cltAnalysis: string;
  zpdAnalysis: string;
  strengths: string[];
  risks: string[];
  suggestions: Array<{
    type: ReflectionRevisionSuggestion['type'];
    reason: string;
    targetStepId?: string;
    action: string;
  }>;
  constraintScores: ConstraintScores;
};

const asStringArray = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.map((item) => String(item || '').trim()).filter(Boolean);
  return normalized.length ? normalized : fallback;
};

const asNumber = (value: unknown, fallback: number, min?: number, max?: number) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (typeof min === 'number' && num < min) return min;
  if (typeof max === 'number' && num > max) return max;
  return num;
};

const clip = (value: string | null | undefined, maxLength = 280) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const nowIso = () => new Date().toISOString();

const inferStepType = (value: string): LearningPlanStepType => {
  const normalized = String(value || '').trim();
  const allowed: LearningPlanStepType[] = [
    'diagnose',
    'retrieve',
    'explain',
    'practice',
    'quiz',
    'flashcards',
    'mind_map',
    'project',
    'reflect',
    'create_workbench'
  ];
  return allowed.includes(normalized as LearningPlanStepType) ? (normalized as LearningPlanStepType) : 'practice';
};

const mapStepTypeToCapability = (type: LearningPlanStepType) => {
  if (type === 'diagnose') return 'diagnosis';
  if (type === 'retrieve') return 'knowledge_retrieval';
  if (type === 'explain' || type === 'reflect') return 'reflection';
  if (type === 'quiz') return 'quiz_generation';
  if (type === 'practice' || type === 'project') return 'content_generation';
  return undefined;
};

const mapStepTypeToArtifact = (type: LearningPlanStepType) => {
  if (type === 'quiz') return 'quiz';
  if (type === 'flashcards') return 'flashcards';
  if (type === 'mind_map') return 'mind_map';
  return undefined;
};

const inferLearnerLevel = (stateBundle: BuiltMclLearningState): LearnerDiagnosticReport['learnerLevel'] => {
  const preferences = stateBundle.state.learnerProfile.preferences || {};
  const explicit = String(preferences.knowledgeLevel || '').toLowerCase();
  if (['novice', 'beginner', 'intermediate', 'advanced'].includes(explicit)) {
    return explicit as LearnerDiagnosticReport['learnerLevel'];
  }

  const traceCount = stateBundle.state.recentTraces.length;
  const chunkCount = stateBundle.state.readiness.stats.chunkCount;
  if (traceCount === 0 && chunkCount < 5) return 'novice';
  if (traceCount <= 1) return 'beginner';
  if (traceCount <= 4) return 'intermediate';
  return 'advanced';
};

const inferLoadTolerance = (stateBundle: BuiltMclLearningState): LearnerDiagnosticReport['cognitiveLoadTolerance'] => {
  const preferences = stateBundle.state.learnerProfile.preferences || {};
  const style = String(preferences.cognitiveStyle || '').toLowerCase();
  if (/gradual|step|slow|careful/.test(style)) return 'low';
  if (/fast|dense|challenge|abstract/.test(style)) return 'high';
  if (stateBundle.state.recentTraces.length >= 3) return 'medium';
  return 'low';
};

const buildCandidateResources = (stateBundle: BuiltMclLearningState): LearningPlanResource[] => {
  const citationResources = stateBundle.capsule.citations.slice(0, 8).map((citation, index) => ({
    id: citation.sourceId || `citation-${index + 1}`,
    title: clip(citation.label, 120) || `资源 ${index + 1}`,
    type: 'document' as const,
    sourceId: citation.sourceId,
    citationLabel: citation.label,
    summary: clip(citation.preview || citation.supportSnippets?.[0]?.text || '上下文中检索到的相关资料片段。', 200),
    difficulty: 3,
    estimatedMinutes: 15,
    relevanceScore: asNumber(citation.confidence, 0.7, 0, 1)
  }));

  const chunkResources = (stateBundle.capsule.retrievedChunks || []).slice(0, 6).map((chunk, index) => ({
    id: `${chunk.fileId || chunk.fileName || 'chunk'}-${chunk.chunkId || index}`,
    title: clip(chunk.fileName || `片段 ${index + 1}`, 120),
    type: 'context' as const,
    sourceId: chunk.fileId || undefined,
    citationLabel: chunk.fileName || undefined,
    summary: clip(chunk.content, 200),
    difficulty: 2,
    estimatedMinutes: 10,
    relevanceScore: 0.65
  }));

  const merged = [...citationResources, ...chunkResources];
  const deduped = new Map<string, LearningPlanResource>();
  merged.forEach((resource) => {
    if (!deduped.has(resource.id)) deduped.set(resource.id, resource);
  });
  return Array.from(deduped.values()).slice(0, 10);
};

const buildKnowledgeGraphSnapshot = (stateBundle: BuiltMclLearningState, resources: LearningPlanResource[]): KnowledgeGraphSnapshot => {
  const skillNodes = (stateBundle.state.activeGoal?.skills || []).slice(0, 8).map((skill, index) => ({
    id: `skill-${index + 1}`,
    label: clip(skill, 80),
    mastery: stateBundle.state.activeGoal?.weaknesses.includes(skill) ? 0.35 : 0.6,
    importance: 0.8,
    kind: 'skill' as const
  }));

  const weaknessNodes = (stateBundle.state.activeGoal?.weaknesses || []).slice(0, 6).map((skill, index) => ({
    id: `weak-${index + 1}`,
    label: clip(skill, 80),
    mastery: 0.25,
    importance: 0.9,
    kind: 'concept' as const
  }));

  const resourceNodes = resources.slice(0, 5).map((resource) => ({
    id: `resource-${resource.id}`,
    label: clip(resource.title, 80),
    importance: resource.relevanceScore,
    kind: 'resource' as const
  }));

  const nodes = [...skillNodes, ...weaknessNodes, ...resourceNodes];
  const edges: KnowledgeGraphSnapshot['edges'] = [];

  skillNodes.forEach((skillNode, index) => {
    if (index > 0) {
      edges.push({
        source: skillNodes[index - 1].id,
        target: skillNode.id,
        relation: 'prerequisite',
        weight: 0.7
      });
    }
  });

  weaknessNodes.forEach((weakNode, index) => {
    const skillNode = skillNodes[index % Math.max(skillNodes.length, 1)];
    if (skillNode) {
      edges.push({
        source: weakNode.id,
        target: skillNode.id,
        relation: 'supports',
        weight: 0.8
      });
    }
  });

  resourceNodes.forEach((resourceNode, index) => {
    const target = skillNodes[index % Math.max(skillNodes.length, 1)] || weaknessNodes[0];
    if (target) {
      edges.push({
        source: resourceNode.id,
        target: target.id,
        relation: 'applies_to',
        weight: 0.6
      });
    }
  });

  return { nodes, edges };
};

const buildFallbackDiagnosticReport = (
  stateBundle: BuiltMclLearningState,
  userInput: string,
  resources: LearningPlanResource[]
): LearnerDiagnosticReport => {
  const level = inferLearnerLevel(stateBundle);
  const tolerance = inferLoadTolerance(stateBundle);
  const goal = stateBundle.state.activeGoal;
  const preferences = stateBundle.state.learnerProfile.preferences || {};

  return {
    learnerLevel: level,
    targetGoal: goal?.goalText || userInput,
    currentStateSummary: stateBundle.state.recentTraces.length
      ? '已有部分学习轨迹，可据此进行增量规划。'
      : '当前缺少稳定学习轨迹，需要先以诊断和轻量任务建立状态画像。',
    strengths: asStringArray(preferences.recentFocus, goal?.skills?.slice(0, 2) || ['学习目标已初步明确']).slice(0, 4),
    weakSkills: (goal?.weaknesses || ['当前短板尚未完全识别']).slice(0, 5),
    prerequisiteGaps: goal?.weaknesses?.length ? goal.weaknesses.slice(0, 3) : ['需要先确认前置知识是否稳固'],
    preferredResourceForms: ['explain', 'practice', 'quiz'],
    timeBudget: {
      sessionMinutes: 30,
      weeklySessions: 4
    },
    cognitiveLoadTolerance: tolerance,
    recommendedDifficultyBand: {
      min: level === 'novice' ? 1 : 2,
      max: tolerance === 'high' ? 5 : 4
    },
    evidence: [
      `目标技能数=${goal?.skills?.length || 0}`,
      `近期轨迹数=${stateBundle.state.recentTraces.length}`,
      `候选资源数=${resources.length}`
    ]
  };
};

const buildFallbackPathDraft = (
  stateBundle: BuiltMclLearningState,
  userInput: string,
  diagnostic: LearnerDiagnosticReport,
  resources: LearningPlanResource[],
  previousPlan?: LearningPlan | null
): PlannerPathDraft => {
  const activeGoal = stateBundle.state.activeGoal;
  const targetSkills = activeGoal?.skills?.length ? activeGoal.skills : ['核心概念理解', '例题推演', '练习巩固'];
  const weakSkills = diagnostic.weakSkills.length ? diagnostic.weakSkills : ['当前短板还不明确，需要先做诊断'];
  const primaryResource = resources[0];

  return {
    objective: activeGoal?.goalText || userInput,
    rationale: previousPlan
      ? '依据最新 learner analytics 与反思建议，对现有学习路径进行增量重规划。'
      : '依据 learner analytics、当前资源与近期轨迹，生成一条可反思、可修订的学习路径。',
    assumptions: [
      resources.length > 0 ? '当前已有可用学习资源，可先基于证据规划。' : '资源不足，需要先检索补充材料。',
      stateBundle.state.recentTraces.length > 0 ? '已有近期反馈，可用于排序路径。' : '缺少稳定反馈，前几步需以低风险探索为主。'
    ],
    constraints: [
      '路径必须在认知负荷可控范围内推进',
      '步骤顺序需要尽量符合前置依赖与最近发展区',
      '计划必须可以在新反馈出现后重规划'
    ],
    targetSkills,
    weakSkills,
    milestones: [
      {
        title: '建立诊断基线',
        description: '先确认当前真实掌握度与前置缺口。',
        successCriteria: ['形成 learner baseline', '明确 1-3 个优先技能']
      },
      {
        title: '完成一轮有支撑的学习闭环',
        description: '围绕最重要技能完成理解、练习和检测。',
        successCriteria: ['产出至少一个学习证据', '完成一次掌握度检查']
      },
      {
        title: '根据反馈调整路径',
        description: '使用反思结果优化下一阶段步骤。',
        successCriteria: ['识别保留/替换/插入步骤', '明确下一阶段节奏']
      }
    ],
    steps: [
      {
        type: 'diagnose',
        title: '确认当前掌握基线',
        rationale: '先建立 learner baseline，避免直接进入过难或过浅的资源。',
        targetSkills: weakSkills.slice(0, 3),
        prerequisites: [],
        estimatedLoad: 'light',
        expectedEvidence: ['得到诊断问题结果或短板线索'],
        suggestedCapability: 'diagnosis',
        concept: weakSkills[0] || targetSkills[0],
        difficulty: diagnostic.recommendedDifficultyBand.min,
        estimatedMinutes: 10
      },
      {
        type: 'retrieve',
        title: '绑定最相关学习资源',
        rationale: '后续解释与练习需要以当前知识上下文为 grounding。',
        targetSkills: targetSkills.slice(0, 2),
        prerequisites: ['已明确当前目标或完成诊断'],
        estimatedLoad: 'light',
        expectedEvidence: ['得到高相关资源或引用片段'],
        suggestedCapability: 'knowledge_retrieval',
        concept: targetSkills[0],
        resourceId: primaryResource?.id,
        resourceReason: primaryResource ? `优先使用 "${primaryResource.title}" 作为当前阶段支撑材料。` : '当前缺少明确资源，需要先检索。',
        difficulty: 2,
        estimatedMinutes: 10
      },
      {
        type: 'explain',
        title: '先理解核心概念',
        rationale: '在练习前先建立概念模型，降低后续练习时的无效负荷。',
        targetSkills: targetSkills.slice(0, 2),
        prerequisites: ['已有相关材料'],
        estimatedLoad: diagnostic.cognitiveLoadTolerance === 'low' ? 'light' : 'medium',
        expectedEvidence: ['形成概念解释、例子或讲解提纲'],
        suggestedCapability: 'reflection',
        concept: targetSkills[0],
        resourceId: primaryResource?.id,
        resourceReason: primaryResource ? '该资源可为概念解释提供 grounding。' : undefined,
        difficulty: 2,
        estimatedMinutes: 20
      },
      {
        type: 'practice',
        title: '进行针对性练习',
        rationale: '把概念理解转化为可操作技能，验证是否真正掌握。',
        targetSkills: targetSkills.slice(0, 3),
        prerequisites: ['完成核心概念解释'],
        estimatedLoad: 'medium',
        expectedEvidence: ['完成练习并得到错误模式'],
        suggestedCapability: 'content_generation',
        concept: targetSkills[1] || targetSkills[0],
        difficulty: 3,
        estimatedMinutes: 25
      },
      {
        type: 'quiz',
        title: '进行一次掌握度检测',
        rationale: '用小测结果判断当前路径是否有效，并为重规划提供信号。',
        targetSkills: targetSkills.slice(0, 3),
        prerequisites: ['完成解释或练习'],
        estimatedLoad: 'medium',
        expectedEvidence: ['得到测验结果、错因和掌握度信号'],
        suggestedCapability: 'quiz_generation',
        artifactType: 'quiz',
        concept: targetSkills[0],
        difficulty: 3,
        estimatedMinutes: 15
      },
      {
        type: 'reflect',
        title: '基于反馈重规划下一步',
        rationale: '根据结果决定是加深、补前置还是切换资源形式。',
        targetSkills: targetSkills.slice(0, 2),
        prerequisites: ['已有练习或检测反馈'],
        estimatedLoad: 'light',
        expectedEvidence: ['得到修订建议和新的 next step'],
        suggestedCapability: 'reflection',
        concept: targetSkills[0],
        difficulty: 2,
        estimatedMinutes: 10
      }
    ],
    adaptationPolicy: {
      replanTriggers: [
        '用户调整学习目标、时间预算或产出要求',
        '诊断/测验结果显示当前路径过难或过易',
        '出现新的高相关学习资源'
      ],
      progressionSignals: ['核心概念讲解更稳定', '练习错误率下降', '能主动迁移到新问题场景'],
      fallbackActions: ['缩小到单技能闭环', '插入前置讲解步骤', '替换为更低负荷的资源形式']
    }
  };
};

const buildFallbackConstraintScores = (
  diagnostic: LearnerDiagnosticReport,
  steps: DraftPlannerStep[],
  suggestions: ReflectionRevisionSuggestion[] = []
): ConstraintScores => {
  const loadWeight = steps.reduce((sum, step) => {
    if (step.estimatedLoad === 'heavy') return sum + 3;
    if (step.estimatedLoad === 'medium') return sum + 2;
    return sum + 1;
  }, 0);
  const avgLoad = steps.length ? loadWeight / steps.length : 1;
  const toleranceTarget =
    diagnostic.cognitiveLoadTolerance === 'high' ? 2.6 : diagnostic.cognitiveLoadTolerance === 'medium' ? 2.1 : 1.7;

  const cltScore = Math.max(0, Math.min(1, 1 - Math.abs(avgLoad - toleranceTarget) / 2));
  const hasDiagnose = steps.some((step) => step.type === 'diagnose');
  const hasAssess = steps.some((step) => step.type === 'quiz' || step.type === 'reflect');
  const zpdScore = Math.max(0, Math.min(1, (hasDiagnose ? 0.4 : 0.15) + (hasAssess ? 0.35 : 0.15) + (steps.length >= 4 ? 0.2 : 0.1)));
  const alignmentScore = Math.max(0, Math.min(1, (steps.filter((step) => step.targetSkills.length > 0).length / Math.max(steps.length, 1)) * 0.8));
  const confidence = Math.max(0.3, Math.min(0.95, 0.55 + (suggestions.length === 0 ? 0.2 : -0.1)));

  return {
    cltScore: Number(cltScore.toFixed(2)),
    zpdScore: Number(zpdScore.toFixed(2)),
    alignmentScore: Number(alignmentScore.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    summary:
      cltScore >= 0.65 && zpdScore >= 0.65
        ? '当前路径与认知负荷和最近发展区约束基本匹配。'
        : '当前路径仍存在负荷或能力阶梯上的调整空间。'
  };
};

const buildFallbackReflection = (
  round: number,
  diagnostic: LearnerDiagnosticReport,
  draft: PlannerPathDraft
): ReflectionResponse => {
  const suggestions: ReflectionRevisionSuggestion[] = [];
  const heavyCount = draft.steps.filter((step) => step.estimatedLoad === 'heavy').length;
  if (diagnostic.cognitiveLoadTolerance === 'low' && heavyCount > 0) {
    suggestions.push({
      type: 'reduce_load',
      reason: '当前学习者负荷耐受较低，路径中不宜出现高密度重负荷步骤。',
      action: '将 heavy 步骤拆分为 explain + practice 的轻量两段。'
    });
  }

  if (!draft.steps.some((step) => step.type === 'diagnose')) {
    suggestions.push({
      type: 'insert_prerequisite',
      reason: '缺少显式诊断步骤，不利于确认最近发展区边界。',
      action: '在路径开头插入 diagnose 步骤。'
    });
  }

  if (!draft.steps.some((step) => step.type === 'quiz' || step.type === 'reflect')) {
    suggestions.push({
      type: 'add_assessment',
      reason: '缺少反馈闭环，无法支持动态重规划。',
      action: '在主学习阶段后加入 quiz 或 reflect 步骤。'
    });
  }

  const constraintScores = buildFallbackConstraintScores(diagnostic, draft.steps, suggestions);
  const needsRevise = suggestions.length > 0 || constraintScores.cltScore < 0.6 || constraintScores.zpdScore < 0.6;

  return {
    verdict: needsRevise ? 'revise' : 'pass',
    summary: needsRevise ? '当前路径需要进一步修订后再采纳。' : '当前路径满足基本教学约束，可以进入执行。',
    cltAnalysis:
      diagnostic.cognitiveLoadTolerance === 'low'
        ? '学习者当前更适合轻量、渐进式步骤。'
        : '学习者当前可承受中等强度路径，但仍需避免跳跃式堆叠。',
    zpdAnalysis: draft.steps.some((step) => step.type === 'diagnose')
      ? '路径包含基线识别与后续推进，具备最近发展区导向。'
      : '路径缺少明确的基线识别，最近发展区约束不足。',
    strengths: ['路径具备阶段性里程碑', '步骤与目标技能存在显式对应'],
    risks: suggestions.map((item) => item.reason).slice(0, 4),
    suggestions,
    constraintScores
  };
};

const applyRevisionSuggestions = (
  draft: PlannerPathDraft,
  suggestions: ReflectionRevisionSuggestion[],
  diagnostic: LearnerDiagnosticReport,
  resources: LearningPlanResource[]
): PlannerPathDraft => {
  const revisedSteps = [...draft.steps];

  suggestions.forEach((suggestion) => {
    if (suggestion.type === 'reduce_load') {
      revisedSteps.forEach((step) => {
        if (step.estimatedLoad === 'heavy') step.estimatedLoad = 'medium';
        if (step.type === 'project') step.type = 'practice';
      });
    }

    if (suggestion.type === 'insert_prerequisite' && !revisedSteps.some((step) => step.type === 'diagnose')) {
      revisedSteps.unshift({
        type: 'diagnose',
        title: '补充前置诊断',
        rationale: '先确认前置掌握与当前水平，再进入主路径。',
        targetSkills: diagnostic.weakSkills.slice(0, 3),
        prerequisites: [],
        estimatedLoad: 'light',
        expectedEvidence: ['得到前置缺口和当前水平判断'],
        suggestedCapability: 'diagnosis',
        difficulty: diagnostic.recommendedDifficultyBand.min,
        estimatedMinutes: 10
      });
    }

    if (suggestion.type === 'add_assessment' && !revisedSteps.some((step) => step.type === 'quiz')) {
      revisedSteps.push({
        type: 'quiz',
        title: '补充掌握度检测',
        rationale: '增加反馈信号，以支持后续动态重规划。',
        targetSkills: draft.targetSkills.slice(0, 3),
        prerequisites: ['完成主要学习步骤'],
        estimatedLoad: 'light',
        expectedEvidence: ['得到错因和掌握度结果'],
        suggestedCapability: 'quiz_generation',
        artifactType: 'quiz',
        resourceId: resources[0]?.id,
        difficulty: Math.max(diagnostic.recommendedDifficultyBand.min, 2),
        estimatedMinutes: 12
      });
    }

    if (suggestion.type === 'replace_resource') {
      const alternative = resources[1] || resources[0];
      revisedSteps.forEach((step) => {
        if (!suggestion.targetStepId || step.title.includes(suggestion.targetStepId)) {
          if (alternative) {
            step.resourceId = alternative.id;
            step.resourceReason = `根据反思建议切换到资源 "${alternative.title}"。`;
          }
        }
      });
    }

    if (suggestion.type === 'reorder_steps') {
      revisedSteps.sort((a, b) => {
        const weight = (step: DraftPlannerStep) => {
          if (step.type === 'diagnose') return 0;
          if (step.type === 'retrieve') return 1;
          if (step.type === 'explain') return 2;
          if (step.type === 'practice') return 3;
          if (step.type === 'quiz') return 4;
          if (step.type === 'reflect') return 5;
          return 6;
        };
        return weight(a) - weight(b);
      });
    }
  });

  return {
    ...draft,
    rationale: `${draft.rationale} 已根据 reflection suggestions 进行修订。`,
    steps: revisedSteps.slice(0, 10)
  };
};

const buildDiagnosticPrompt = (
  stateBundle: BuiltMclLearningState,
  userInput: string,
  resources: LearningPlanResource[]
) => ({
  instruction: [
    'You are the Learner Analytics Agent in a MALPP-style adaptive learning system.',
    'Produce a learner diagnostic report that summarizes current level, prerequisite gaps, weak skills, preferred resource forms, time budget, cognitive load tolerance, and recommended difficulty band.',
    'Use the available learner profile, traces, goal, and resources.',
    'The report must support downstream path planning with CLT and ZPD awareness.',
    'Return JSON only.'
  ].join('\n'),
  schema: {
    learnerLevel: 'novice | beginner | intermediate | advanced | unknown',
    targetGoal: 'string',
    currentStateSummary: 'string',
    strengths: ['string'],
    weakSkills: ['string'],
    prerequisiteGaps: ['string'],
    preferredResourceForms: ['string'],
    timeBudget: { sessionMinutes: 30, weeklySessions: 4 },
    cognitiveLoadTolerance: 'low | medium | high',
    recommendedDifficultyBand: { min: 1, max: 5 },
    evidence: ['string']
  },
  input: {
    userInput,
    learnerProfile: stateBundle.state.learnerProfile,
    activeGoal: stateBundle.state.activeGoal,
    recentTraces: stateBundle.state.recentTraces,
    recentEvents: stateBundle.state.recentEvents.slice(0, 5),
    readiness: stateBundle.state.readiness,
    candidateResources: resources
  },
  context: {
    workspaceId: stateBundle.state.workspace.id,
    workbenchId: stateBundle.state.workbench?.id || undefined,
    learningContext: {
      goal: stateBundle.state.activeGoal
        ? {
            title: stateBundle.state.activeGoal.title,
            goalText: stateBundle.state.activeGoal.goalText,
            skills: stateBundle.state.activeGoal.skills,
            weaknesses: stateBundle.state.activeGoal.weaknesses
          }
        : null,
      traces: stateBundle.state.recentTraces.map((trace) => ({
        summary: trace.summary,
        nextActions: trace.nextActions
      })),
      knowledge: (stateBundle.capsule.retrievedChunks || []).slice(0, 5).map((chunk) => ({
        fileName: chunk.fileName,
        path: '',
        chunkText: chunk.content
      }))
    }
  }
});

const buildPathPlanningPrompt = (
  stateBundle: BuiltMclLearningState,
  userInput: string,
  diagnostic: LearnerDiagnosticReport,
  resources: LearningPlanResource[],
  knowledgeGraph: KnowledgeGraphSnapshot,
  previousPlan?: LearningPlan | null,
  revisionContext?: ReflectionReview[]
) => ({
  instruction: [
    'You are the Path Planning Agent in a MALPP-style adaptive learning system.',
    'Generate a personalized learning path using the learner diagnostic report, candidate resources, and knowledge graph snapshot.',
    'The path must be adaptive, not a fixed workflow.',
    'Respect CLT and ZPD: keep difficulty progression gradual, insert prerequisite support when needed, and provide a reason for each step.',
    'Each step must specify concept, resource binding, reason, difficulty, estimated time, and expected evidence.',
    'Return JSON only.'
  ].join('\n'),
  schema: {
    objective: 'string',
    rationale: 'string',
    assumptions: ['string'],
    constraints: ['string'],
    targetSkills: ['string'],
    weakSkills: ['string'],
    milestones: [{ title: 'string', description: 'string', successCriteria: ['string'] }],
    steps: [
      {
        type: 'diagnose | retrieve | explain | practice | quiz | flashcards | mind_map | project | reflect | create_workbench',
        title: 'string',
        rationale: 'string',
        targetSkills: ['string'],
        prerequisites: ['string'],
        estimatedLoad: 'light | medium | heavy',
        expectedEvidence: ['string'],
        suggestedCapability: 'string',
        artifactType: 'string',
        concept: 'string',
        resourceId: 'string',
        resourceReason: 'string',
        difficulty: 1,
        estimatedMinutes: 20
      }
    ],
    adaptationPolicy: {
      replanTriggers: ['string'],
      progressionSignals: ['string'],
      fallbackActions: ['string']
    }
  },
  input: {
    userInput,
    previousPlan,
    revisionContext,
    diagnostic,
    candidateResources: resources,
    knowledgeGraph,
    activeGoal: stateBundle.state.activeGoal,
    readiness: stateBundle.state.readiness
  },
  context: {
    workspaceId: stateBundle.state.workspace.id,
    workbenchId: stateBundle.state.workbench?.id || undefined,
    learningContext: {
      goal: stateBundle.state.activeGoal
        ? {
            title: stateBundle.state.activeGoal.title,
            goalText: stateBundle.state.activeGoal.goalText,
            skills: stateBundle.state.activeGoal.skills,
            weaknesses: stateBundle.state.activeGoal.weaknesses
          }
        : null,
      traces: stateBundle.state.recentTraces.map((trace) => ({
        summary: trace.summary,
        nextActions: trace.nextActions
      })),
      knowledge: (stateBundle.capsule.retrievedChunks || []).slice(0, 5).map((chunk) => ({
        fileName: chunk.fileName,
        path: '',
        chunkText: chunk.content
      }))
    }
  }
});

const buildReflectionPrompt = (
  round: number,
  stateBundle: BuiltMclLearningState,
  diagnostic: LearnerDiagnosticReport,
  draft: PlannerPathDraft,
  resources: LearningPlanResource[],
  knowledgeGraph: KnowledgeGraphSnapshot
) => ({
  instruction: [
    'You are the Reflection Agent in a MALPP-style adaptive learning system.',
    'Review the proposed learning path and decide whether it passes or must be revised.',
    'Evaluate the path using Cognitive Load Theory (CLT) and Zone of Proximal Development (ZPD).',
    'CLT: detect overload, overly dense sequencing, or steps that are too demanding for the learner profile.',
    'ZPD: check whether the path starts from the learner current ability and progresses with suitable challenge and prerequisite support.',
    'If revision is needed, provide concrete suggestions.',
    'Return JSON only.'
  ].join('\n'),
  schema: {
    verdict: 'pass | revise',
    summary: 'string',
    cltAnalysis: 'string',
    zpdAnalysis: 'string',
    strengths: ['string'],
    risks: ['string'],
    suggestions: [
      {
        type: 'reduce_load | increase_challenge | insert_prerequisite | reorder_steps | replace_resource | add_assessment | narrow_scope',
        reason: 'string',
        targetStepId: 'string',
        action: 'string'
      }
    ],
    constraintScores: {
      cltScore: 0.8,
      zpdScore: 0.7,
      alignmentScore: 0.8,
      confidence: 0.8,
      summary: 'string'
    }
  },
  input: {
    round,
    learnerDiagnostic: diagnostic,
    draftPlan: draft,
    candidateResources: resources,
    knowledgeGraph
  },
  context: {
    workspaceId: stateBundle.state.workspace.id,
    workbenchId: stateBundle.state.workbench?.id || undefined,
    learningContext: {
      goal: stateBundle.state.activeGoal
        ? {
            title: stateBundle.state.activeGoal.title,
            goalText: stateBundle.state.activeGoal.goalText,
            skills: stateBundle.state.activeGoal.skills,
            weaknesses: stateBundle.state.activeGoal.weaknesses
          }
        : null,
      traces: stateBundle.state.recentTraces.map((trace) => ({
        summary: trace.summary,
        nextActions: trace.nextActions
      })),
      knowledge: (stateBundle.capsule.retrievedChunks || []).slice(0, 5).map((chunk) => ({
        fileName: chunk.fileName,
        path: '',
        chunkText: chunk.content
      }))
    }
  }
});

const normalizeDiagnosticReport = (
  raw: Partial<LearnerDiagnosticReport> | null | undefined,
  fallback: LearnerDiagnosticReport
): LearnerDiagnosticReport => ({
  learnerLevel:
    raw?.learnerLevel === 'novice' ||
    raw?.learnerLevel === 'beginner' ||
    raw?.learnerLevel === 'intermediate' ||
    raw?.learnerLevel === 'advanced' ||
    raw?.learnerLevel === 'unknown'
      ? raw.learnerLevel
      : fallback.learnerLevel,
  targetGoal: clip(raw?.targetGoal, 280) || fallback.targetGoal,
  currentStateSummary: clip(raw?.currentStateSummary, 360) || fallback.currentStateSummary,
  strengths: asStringArray(raw?.strengths, fallback.strengths).slice(0, 6),
  weakSkills: asStringArray(raw?.weakSkills, fallback.weakSkills).slice(0, 6),
  prerequisiteGaps: asStringArray(raw?.prerequisiteGaps, fallback.prerequisiteGaps).slice(0, 6),
  preferredResourceForms: asStringArray(raw?.preferredResourceForms, fallback.preferredResourceForms).slice(0, 5),
  timeBudget: {
    sessionMinutes: asNumber(raw?.timeBudget?.sessionMinutes, fallback.timeBudget.sessionMinutes, 10, 180),
    weeklySessions: asNumber(raw?.timeBudget?.weeklySessions, fallback.timeBudget.weeklySessions, 1, 14)
  },
  cognitiveLoadTolerance:
    raw?.cognitiveLoadTolerance === 'low' ||
    raw?.cognitiveLoadTolerance === 'medium' ||
    raw?.cognitiveLoadTolerance === 'high'
      ? raw.cognitiveLoadTolerance
      : fallback.cognitiveLoadTolerance,
  recommendedDifficultyBand: {
    min: asNumber(raw?.recommendedDifficultyBand?.min, fallback.recommendedDifficultyBand.min, 1, 5),
    max: asNumber(raw?.recommendedDifficultyBand?.max, fallback.recommendedDifficultyBand.max, 1, 5)
  },
  evidence: asStringArray(raw?.evidence, fallback.evidence).slice(0, 8)
});

const normalizeMilestones = (milestones: DraftPlannerMilestone[]) =>
  milestones.slice(0, 6).map(
    (item, index): LearningPlanMilestone => ({
      id: `milestone-${index + 1}`,
      title: clip(item.title, 120) || `里程碑 ${index + 1}`,
      description: clip(item.description, 280),
      successCriteria: asStringArray(item.successCriteria, ['完成该阶段的核心学习目标']).slice(0, 5),
      status: index === 0 ? 'active' : 'pending'
    })
  );

const normalizeSteps = (steps: DraftPlannerStep[]) =>
  steps.slice(0, 10).map(
    (item, index): LearningPlanStep => {
      const type = inferStepType(item.type);
      const metadataBits = [
        item.concept ? `概念: ${clip(item.concept, 80)}` : '',
        item.resourceReason ? `资源理由: ${clip(item.resourceReason, 120)}` : '',
        typeof item.difficulty === 'number' ? `难度: ${item.difficulty}/5` : '',
        typeof item.estimatedMinutes === 'number' ? `预计时长: ${item.estimatedMinutes} 分钟` : ''
      ].filter(Boolean);

      return {
        id: `step-${index + 1}`,
        type,
        title: clip(item.title, 120) || `步骤 ${index + 1}`,
        rationale: clip([item.rationale, ...metadataBits].join('；'), 320),
        targetSkills: asStringArray(item.targetSkills, ['核心理解']).slice(0, 5),
        prerequisites: asStringArray(item.prerequisites, []).slice(0, 5),
        estimatedLoad: item.estimatedLoad === 'light' || item.estimatedLoad === 'heavy' ? item.estimatedLoad : 'medium',
        expectedEvidence: asStringArray(item.expectedEvidence, ['得到可用于后续判断的学习证据']).slice(0, 5),
        suggestedCapability: clip(item.suggestedCapability || mapStepTypeToCapability(type), 80),
        artifactType: clip(item.artifactType || mapStepTypeToArtifact(type), 80),
        status: index === 0 ? 'active' : 'pending'
      };
    }
  );

const normalizePathDraft = (raw: Partial<PlannerPathDraft> | null | undefined, fallback: PlannerPathDraft): PlannerPathDraft => ({
  objective: clip(raw?.objective, 280) || fallback.objective,
  rationale: clip(raw?.rationale, 400) || fallback.rationale,
  assumptions: asStringArray(raw?.assumptions, fallback.assumptions).slice(0, 8),
  constraints: asStringArray(raw?.constraints, fallback.constraints).slice(0, 8),
  targetSkills: asStringArray(raw?.targetSkills, fallback.targetSkills).slice(0, 8),
  weakSkills: asStringArray(raw?.weakSkills, fallback.weakSkills).slice(0, 8),
  milestones: Array.isArray(raw?.milestones) && raw?.milestones.length ? raw.milestones.slice(0, 6) : fallback.milestones,
  steps:
    Array.isArray(raw?.steps) && raw?.steps.length
      ? raw.steps.slice(0, 10).map((step) => ({
          type: inferStepType(step.type || 'practice'),
          title: clip(step.title, 120) || '学习步骤',
          rationale: clip(step.rationale, 220) || '围绕当前目标执行该学习动作。',
          targetSkills: asStringArray(step.targetSkills, ['核心理解']).slice(0, 5),
          prerequisites: asStringArray(step.prerequisites, []).slice(0, 5),
          estimatedLoad: step.estimatedLoad === 'light' || step.estimatedLoad === 'heavy' ? step.estimatedLoad : 'medium',
          expectedEvidence: asStringArray(step.expectedEvidence, ['得到阶段性证据']).slice(0, 5),
          suggestedCapability: clip(step.suggestedCapability, 80),
          artifactType: clip(step.artifactType, 80),
          concept: clip(step.concept, 80),
          resourceId: clip(step.resourceId, 80),
          resourceReason: clip(step.resourceReason, 120),
          difficulty: asNumber(step.difficulty, 3, 1, 5),
          estimatedMinutes: asNumber(step.estimatedMinutes, 15, 5, 120)
        }))
      : fallback.steps,
  adaptationPolicy: {
    replanTriggers: asStringArray(raw?.adaptationPolicy?.replanTriggers, fallback.adaptationPolicy.replanTriggers).slice(0, 8),
    progressionSignals: asStringArray(
      raw?.adaptationPolicy?.progressionSignals,
      fallback.adaptationPolicy.progressionSignals
    ).slice(0, 8),
    fallbackActions: asStringArray(raw?.adaptationPolicy?.fallbackActions, fallback.adaptationPolicy.fallbackActions).slice(0, 8)
  }
});

const normalizeConstraintScores = (raw: Partial<ConstraintScores> | null | undefined, fallback: ConstraintScores): ConstraintScores => ({
  cltScore: asNumber(raw?.cltScore, fallback.cltScore, 0, 1),
  zpdScore: asNumber(raw?.zpdScore, fallback.zpdScore, 0, 1),
  alignmentScore: asNumber(raw?.alignmentScore, fallback.alignmentScore, 0, 1),
  confidence: asNumber(raw?.confidence, fallback.confidence, 0, 1),
  summary: clip(raw?.summary, 240) || fallback.summary
});

const normalizeReflection = (
  round: number,
  raw: Partial<ReflectionResponse> | null | undefined,
  fallback: ReflectionResponse
): ReflectionReview => {
  const scores = normalizeConstraintScores(raw?.constraintScores, fallback.constraintScores);
  return {
    round,
    verdict: raw?.verdict === 'pass' || raw?.verdict === 'revise' ? raw.verdict : fallback.verdict,
    summary: clip(raw?.summary, 280) || fallback.summary,
    cltAnalysis: clip(raw?.cltAnalysis, 280) || fallback.cltAnalysis,
    zpdAnalysis: clip(raw?.zpdAnalysis, 280) || fallback.zpdAnalysis,
    strengths: asStringArray(raw?.strengths, fallback.strengths).slice(0, 5),
    risks: asStringArray(raw?.risks, fallback.risks).slice(0, 5),
    suggestions: (Array.isArray(raw?.suggestions) ? raw?.suggestions : fallback.suggestions).slice(0, 6).map((suggestion) => ({
      type: suggestion.type,
      reason: clip(suggestion.reason, 200),
      targetStepId: clip(suggestion.targetStepId, 80),
      action: clip(suggestion.action, 200)
    })),
    constraintScores: scores
  };
};

export class MclPlannerService {
  private async runStage<T>(
    name: string,
    input: Record<string, unknown>,
    options: MclPlannerRunOptions | undefined,
    work: () => Promise<{ value: T; summary?: string; fallback?: boolean }>
  ): Promise<T> {
    const startedAt = Date.now();
    let stepId: string | null = null;

    console.info(`[MCL Planner] ${name} started`, input);
    await options?.onStage?.({ name, status: 'started', summary: String(input.summary || '') });

    if (options?.runId) {
      const step = await learningRunService.startStep(options.runId, name, input);
      stepId = step.id;
    }

    try {
      const result = await work();
      const durationMs = Date.now() - startedAt;
      const status = result.fallback ? 'fallback' : 'completed';
      const output = {
        summary: result.summary || (result.fallback ? 'Used fallback result.' : 'Completed.'),
        durationMs,
        fallback: Boolean(result.fallback)
      };

      console.info(`[MCL Planner] ${name} ${status} in ${durationMs}ms`, output);
      await options?.onStage?.({ name, status, durationMs, summary: output.summary });

      if (stepId) {
        await learningRunService.completeStep(stepId, output);
      }

      return result.value;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);

      console.warn(`[MCL Planner] ${name} failed in ${durationMs}ms`, message);
      await options?.onStage?.({ name, status: 'failed', durationMs, error: message });

      if (stepId) {
        await learningRunService.failStep(stepId, error);
      }

      throw error;
    }
  }

  private async runLearnerAnalytics(input: {
    stateBundle: BuiltMclLearningState;
    userInput: string;
    resources: LearningPlanResource[];
  }, options?: MclPlannerRunOptions) {
    const fallback = buildFallbackDiagnosticReport(input.stateBundle, input.userInput, input.resources);

    return this.runStage('LearnerAnalyticsAgent', {
      summary: 'Diagnose learner state and prerequisite gaps.',
      resourceCount: input.resources.length,
      timeoutMs: PLANNER_STAGE_TIMEOUT_MS
    }, options, async () => {
      if (!deepseekService.isConfigured()) {
        return { value: fallback, fallback: true, summary: 'DeepSeek is not configured; used local diagnostic fallback.' };
      }

      try {
        const response = await deepseekService.json<LearnerDiagnosticReport>({
          ...buildDiagnosticPrompt(input.stateBundle, input.userInput, input.resources),
          timeoutMs: PLANNER_STAGE_TIMEOUT_MS
        });
        const value = normalizeDiagnosticReport(response.data, fallback);
        return { value, summary: `learnerLevel=${value.learnerLevel}, weakSkills=${value.weakSkills.length}` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { value: fallback, fallback: true, summary: `Diagnostic fallback after model error: ${message}` };
      }
    });
  }

  private async runPathPlanning(input: {
    stateBundle: BuiltMclLearningState;
    userInput: string;
    diagnostic: LearnerDiagnosticReport;
    resources: LearningPlanResource[];
    knowledgeGraph: KnowledgeGraphSnapshot;
    previousPlan?: LearningPlan | null;
    reflectionHistory?: ReflectionReview[];
  }, options?: MclPlannerRunOptions) {
    const fallback = buildFallbackPathDraft(
      input.stateBundle,
      input.userInput,
      input.diagnostic,
      input.resources,
      input.previousPlan
    );

    return this.runStage('PathPlanningAgent', {
      summary: 'Generate executable learning path.',
      resourceCount: input.resources.length,
      previousPlanVersion: input.previousPlan?.version || null,
      timeoutMs: PLANNER_STAGE_TIMEOUT_MS
    }, options, async () => {
      if (!deepseekService.isConfigured()) {
        return { value: fallback, fallback: true, summary: 'DeepSeek is not configured; used local path fallback.' };
      }

      try {
        const response = await deepseekService.json<PlannerPathDraft>({
          ...buildPathPlanningPrompt(
            input.stateBundle,
            input.userInput,
            input.diagnostic,
            input.resources,
            input.knowledgeGraph,
            input.previousPlan,
            input.reflectionHistory
          ),
          timeoutMs: PLANNER_STAGE_TIMEOUT_MS
        });
        const value = normalizePathDraft(response.data, fallback);
        return { value, summary: `steps=${value.steps.length}, milestones=${value.milestones.length}` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { value: fallback, fallback: true, summary: `Path planning fallback after model error: ${message}` };
      }
    });
  }

  private async runReflection(input: {
    round: number;
    stateBundle: BuiltMclLearningState;
    diagnostic: LearnerDiagnosticReport;
    draft: PlannerPathDraft;
    resources: LearningPlanResource[];
    knowledgeGraph: KnowledgeGraphSnapshot;
  }, options?: MclPlannerRunOptions) {
    const fallback = buildFallbackReflection(input.round, input.diagnostic, input.draft);

    return this.runStage(`ReflectionAgent:${input.round}`, {
      summary: 'Check CLT, ZPD and alignment constraints.',
      round: input.round,
      stepCount: input.draft.steps.length,
      timeoutMs: PLANNER_STAGE_TIMEOUT_MS
    }, options, async () => {
      if (!deepseekService.isConfigured()) {
        return {
          value: normalizeReflection(input.round, fallback, fallback),
          fallback: true,
          summary: 'DeepSeek is not configured; used local reflection fallback.'
        };
      }

      try {
        const response = await deepseekService.json<ReflectionResponse>({
          ...buildReflectionPrompt(
            input.round,
            input.stateBundle,
            input.diagnostic,
            input.draft,
            input.resources,
            input.knowledgeGraph
          ),
          timeoutMs: PLANNER_STAGE_TIMEOUT_MS
        });
        const value = normalizeReflection(input.round, response.data, fallback);
        return { value, summary: `verdict=${value.verdict}, suggestions=${value.suggestions.length}` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          value: normalizeReflection(input.round, fallback, fallback),
          fallback: true,
          summary: `Reflection fallback after model error: ${message}`
        };
      }
    });
  }

  async planOrRevise(input: {
    stateBundle: BuiltMclLearningState;
    userInput: string;
    previousPlan?: LearningPlan | null;
    options?: MclPlannerRunOptions;
  }): Promise<LearningPlan> {
    const resources = buildCandidateResources(input.stateBundle);
    const knowledgeGraph = buildKnowledgeGraphSnapshot(input.stateBundle, resources);
    const diagnostic = await this.runLearnerAnalytics({
      stateBundle: input.stateBundle,
      userInput: input.userInput,
      resources
    }, input.options);

    let draft = await this.runPathPlanning({
      stateBundle: input.stateBundle,
      userInput: input.userInput,
      diagnostic,
      resources,
      knowledgeGraph,
      previousPlan: input.previousPlan
    }, input.options);

    const reflectionHistory: ReflectionReview[] = [];
    let finalScores = buildFallbackConstraintScores(diagnostic, draft.steps);

    for (let round = 1; round <= MAX_REFLECTION_ROUNDS; round += 1) {
      const reflection = await this.runReflection({
        round,
        stateBundle: input.stateBundle,
        diagnostic,
        draft,
        resources,
        knowledgeGraph
      }, input.options);

      reflectionHistory.push(reflection);
      finalScores = reflection.constraintScores;

      if (reflection.verdict === 'pass' || round === MAX_REFLECTION_ROUNDS) {
        break;
      }

      draft = applyRevisionSuggestions(draft, reflection.suggestions, diagnostic, resources);
    }

    const version = (input.previousPlan?.version || 0) + 1;
    const milestones = normalizeMilestones(draft.milestones);
    const steps = normalizeSteps(draft.steps);

    return {
      id: crypto.randomUUID(),
      workspaceId: input.stateBundle.state.workspace.id,
      workbenchId: input.stateBundle.state.workbench?.id || null,
      goalId: input.stateBundle.state.activeGoal?.id || null,
      scope: input.stateBundle.state.activeGoal?.id
        ? 'goal'
        : input.stateBundle.state.workbench?.id
          ? 'workbench'
          : 'workspace',
      version,
      status: 'active',
      objective: draft.objective,
      rationale: draft.rationale,
      assumptions: draft.assumptions,
      constraints: draft.constraints,
      targetSkills: draft.targetSkills,
      weakSkills: draft.weakSkills,
      milestones,
      steps,
      adaptationPolicy: draft.adaptationPolicy,
      evidence: {
        citations: input.stateBundle.capsule.citations.slice(0, 8).map((citation) => citation.label),
        activeGoalTitle: input.stateBundle.state.activeGoal?.title || null,
        currentTaskIntent: input.stateBundle.state.currentTask.intent,
        readinessSummary: `chunks=${input.stateBundle.state.readiness.stats.chunkCount}, goals=${input.stateBundle.state.readiness.stats.goalCount}, traces=${input.stateBundle.state.readiness.stats.traceCount}`
      },
      diagnosticReport: diagnostic,
      candidateResources: resources,
      knowledgeGraphSnapshot: knowledgeGraph,
      reflectionHistory,
      constraintScores: finalScores,
      revisionCount: reflectionHistory.filter((item) => item.verdict === 'revise').length,
      nextStepId: steps[0]?.id || null,
      previousPlanId: input.previousPlan?.id || null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }
}

export const mclPlannerService = new MclPlannerService();
