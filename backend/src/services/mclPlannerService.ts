import crypto from 'crypto';
import { aiModelProviderService } from './aiModelProviderService';
import { learningRunService } from './learningRunService';
import { BuiltMclLearningState } from './learningStateBuilder';
import { filterKnowledgeConcepts } from './learnerSignalSanitizer';
import { goalSkillMapperService } from './planning/goalSkillMapperService';
import { kgConstraintProviderService } from './planning/kgConstraintProviderService';
import { planningContextBundleService } from './planning/planningContextBundleService';
import { resourcePlanningProfileService } from './planning/resourcePlanningProfileService';
import { resourceLearningUnitService } from './planning/resourceLearningUnitService';
import { stepEvidenceGroundingService } from './planning/stepEvidenceGroundingService';
import { planStructurerService } from './planning/planStructurerService';
import {
  ConstraintScores,
  GoalSkillMap,
  KnowledgeGraphSnapshot,
  LearnerDiagnosticReport,
  LearningPlan,
  LearningPlanMilestone,
  LearningPlanResource,
  PlanningContextBundle,
  KgPlanningHints,
  LearningPlanStep,
  LearningPlanStepType,
  LearningPlanResourceMatch,
  LearningPlanResourceGrounding,
  LearningPlanCurriculumDecision,
  LearningPlanStepDetail,
  LearningPlanStepResourceRecommendation,
  LearningPlanResourceDisplayType,
  ResourcePlanningProfile,
  ResourceGroundingStatus,
  ResourceLearningUnit,
  ReflectionReview,
  ReflectionRevisionSuggestion
} from './planningTypes';

const MAX_REFLECTION_ROUNDS = Number(process.env.MCL_PLANNER_REFLECTION_ROUNDS || 2);
const PLANNER_STAGE_TIMEOUT_MS = Number(process.env.MCL_PLANNER_STAGE_TIMEOUT_MS || 90000);
const FINAL_COMPOSER_TIMEOUT_MS = Number(process.env.MCL_FINAL_COMPOSER_TIMEOUT_MS || 30000);
const FINAL_COMPOSER_MAX_STEPS = Number(process.env.MCL_FINAL_COMPOSER_MAX_STEPS || 8);
const LLM_ONLY_PLANNER_TIMEOUT_MS = Number(process.env.MCL_LLM_ONLY_PLANNER_TIMEOUT_MS || 120000);

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
  stepDetail?: LearningPlanStepDetail;
  learningGoal?: string;
  targetSkills: string[];
  prerequisites: string[];
  estimatedLoad: 'light' | 'medium' | 'heavy';
  expectedEvidence: string[];
  activities?: string[];
  suggestedCapability?: string;
  artifactType?: string;
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
  teachingPhase?: string;
  evidenceType?: string;
  successCriteria?: string[];
  unlockCondition?: string;
  qualitySignals?: string[];
  riskNotes?: string[];
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

type CurriculumSkeletonStage = {
  id: string;
  title: string;
  learningGoal: string;
  whyThisStage: string;
  targetSkills: string[];
  prerequisites: string[];
  recommendedOrder: number;
  estimatedDifficulty: number;
  estimatedLoad: 'light' | 'medium' | 'heavy';
  idealActivities: string[];
  checks: string[];
  riskNotes: string[];
  teachingPhase?: string;
};

type CurriculumSkeleton = {
  objective: string;
  learnerLevel: LearnerDiagnosticReport['learnerLevel'];
  rationale: string;
  broadConstraints: string[];
  targetSkills: string[];
  weakSignals: string[];
  stages: CurriculumSkeletonStage[];
  assumptions: string[];
};

type KgConstraintAudit = {
  verdict: 'pass' | 'revise';
  warnings: Array<{
    stageId?: string;
    type: 'prerequisite_jump' | 'missing_bridge' | 'order_risk' | 'low_confidence';
    message: string;
    prerequisite?: string;
    target?: string;
  }>;
  insertions: Array<{
    beforeStageId?: string;
    title: string;
    learningGoal: string;
    targetSkills: string[];
    prerequisites: string[];
    reason: string;
    estimatedDifficulty?: number;
  }>;
  reorderSuggestions: Array<{ stageId: string; beforeStageId?: string; afterStageId?: string; reason: string }>;
  summary: string;
};

type StageResourceGrounding = {
  stageId: string;
  status: ResourceGroundingStatus;
  matches: LearningPlanResourceMatch[];
  gapReason?: string;
  neededResource?: string;
  warnings: string[];
};

type ResourceGroundingResult = {
  stageGroundings: StageResourceGrounding[];
  gaps: StageResourceGrounding[];
  summary: string;
};

type ReflectionResponse = {
  verdict: 'pass' | 'revise';
  summary: string;
  cltAnalysis: string;
  zpdAnalysis: string;
  pedagogyAnalysis?: string;
  strengths: string[];
  risks: string[];
  suggestions: Array<{
    type: ReflectionRevisionSuggestion['type'];
    reason: string;
    targetStepId?: string;
    action: string;
  }>;
  constraintScores: ConstraintScores;
  rubric?: ReflectionReview['rubric'];
};

type CorePlannerSourceSummary = {
  id: string;
  title: string;
  kind: string;
  summary: string;
  locator?: Record<string, unknown>;
};

type CorePlannerResponse = {
  objective?: string;
  rationale?: string;
  targetSkills?: string[];
  assumptions?: string[];
  steps?: Array<{
    title?: string;
    type?: string;
    goal?: string;
    rationale?: string;
    targetSkills?: string[];
    prerequisites?: string[];
    activities?: string[];
    evidence?: string[];
    successCriteria?: string[];
    estimatedLoad?: string;
    estimatedMinutes?: number;
  }>;
};

type FinalTutorPlanComposerStepResponse = {
  title?: string;
  learningGoal?: string;
  whyThisStep?: string;
  learningTasks?: string[];
  recommendedResources?: {
    document?: Array<Partial<LearningPlanStepResourceRecommendation>>;
    video?: Array<Partial<LearningPlanStepResourceRecommendation>>;
    exercise?: Array<Partial<LearningPlanStepResourceRecommendation>>;
    project?: Array<Partial<LearningPlanStepResourceRecommendation>>;
  };
  resourceGaps?: Partial<Record<LearningPlanResourceDisplayType, string>>;
  masteryCriteria?: string[];
  dynamicAdjustment?: Partial<LearningPlanStepDetail['dynamicAdjustment']>;
  personalizationReason?: string;
};

type FinalTutorPlanComposerResponse = {
  steps?: FinalTutorPlanComposerStepResponse[];
};

const buildLlmOnlyPlannerPrompt = (objective: string, previousPlan?: LearningPlan | null) => [
  {
    role: 'user' as const,
    content: `请根据这个目标生成一份学习计划，使用 Markdown：\n\n${objective}`
  }
];

const asStringArray = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.map((item) => String(item || '').trim()).filter(Boolean);
  return normalized.length ? normalized : fallback;
};

const uniqueStrings = (items: Array<string | null | undefined>, limit = 12) =>
  Array.from(new Set(items.map((item) => clip(item, 140)).filter(Boolean))).slice(0, limit);

const asConceptArray = (value: unknown, fallback: string[], limit = 8) => {
  const source = Array.isArray(value) ? value.map((item) => String(item || '')) : fallback;
  const cleaned = filterKnowledgeConcepts(source, limit);
  return cleaned.length ? cleaned : filterKnowledgeConcepts(fallback, limit);
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

const titleFromMarkdown = (markdown: string, fallback: string) => {
  const heading = markdown.match(/^\s*#{1,3}\s+(.+)$/m)?.[1]?.trim();
  return clip(heading || fallback, 180);
};

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

const inferCoreStepType = (title: string, value?: string): LearningPlanStepType => {
  const explicit = inferStepType(String(value || ''));
  if (value && explicit !== 'practice') return explicit;
  if (/诊断|baseline|起点|水平/i.test(title)) return 'diagnose';
  if (/资源|资料|阅读|定位|source|material/i.test(title)) return 'retrieve';
  if (/练习|practice|实操|应用|题/i.test(title)) return 'practice';
  if (/测验|检测|quiz|assessment|检查/i.test(title)) return 'quiz';
  if (/项目|project|案例|综合/i.test(title)) return 'project';
  if (/复盘|反思|调整|reflect/i.test(title)) return 'reflect';
  return 'explain';
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

const mapStepTypeToTeachingPhase = (type: LearningPlanStepType, index: number, hasResourceUnit: boolean) => {
  if (type === 'diagnose') return 'diagnostic';
  if (type === 'retrieve') return 'resource_grounding';
  if (type === 'explain') return index === 1 ? 'concept_model' : 'worked_example';
  if (type === 'practice') return index <= 3 ? 'guided_practice' : 'independent_practice';
  if (type === 'quiz') return 'formative_assessment';
  if (type === 'reflect') return 'reflection';
  if (type === 'project') return 'project_application';
  if (type === 'create_workbench') return 'project_application';
  if (hasResourceUnit) return 'resource_grounding';
  return 'concept_model';
};

const mapStepTypeToEvidenceType = (type: LearningPlanStepType): string => {
  if (type === 'diagnose') return 'diagnostic_signal';
  if (type === 'retrieve') return 'resource_trace';
  if (type === 'explain') return 'concept_explanation';
  if (type === 'practice') return 'practice_attempt';
  if (type === 'quiz') return 'quiz_result';
  if (type === 'reflect') return 'reflection_note';
  if (type === 'project') return 'project_artifact';
  if (type === 'create_workbench') return 'project_artifact';
  return 'resource_trace';
};

const successCriteriaForStep = (type: LearningPlanStepType, targetSkills: string[], resourceTitle?: string) => {
  const firstSkill = targetSkills[0] || '核心能力';
  if (type === 'diagnose') return [`确认 ${firstSkill} 的当前基线`, '识别一个最优先的前置缺口'];
  if (type === 'retrieve') return resourceTitle ? [`定位到 "${resourceTitle}" 的关键片段`, '提取与目标技能相关的证据'] : ['定位到最相关资源片段', '提取与目标技能相关的证据'];
  if (type === 'explain') return [`用自己的话解释 ${firstSkill}`, '给出一个例子或类比'];
  if (type === 'practice') return [`独立完成 ${firstSkill} 的一次练习`, '暴露主要错误模式并修正'];
  if (type === 'quiz') return [`在 ${firstSkill} 上获得可判定的掌握度信号`, '形成下一步是否加深或补前置的依据'];
  if (type === 'reflect') return ['形成反思结论', '明确下一轮重规划动作'];
  if (type === 'project') return [`完成一个围绕 ${firstSkill} 的应用产出`, '能解释产出如何对应目标'];
  return [`推进 ${firstSkill} 的学习闭环`, '产出可用于后续判断的学习证据'];
};

const buildCoreSourceCatalog = (stateBundle: BuiltMclLearningState): CorePlannerSourceSummary[] => {
  const byId = new Map<string, CorePlannerSourceSummary>();
  const add = (source: CorePlannerSourceSummary) => {
    const id = clip(source.id, 80);
    const title = clip(source.title, 140);
    const summary = clip(source.summary, 520);
    if (!id || !title) return;
    const existing = byId.get(id);
    if (!existing || summary.length > existing.summary.length) {
      byId.set(id, {
        id,
        title,
        kind: clip(source.kind, 80) || 'source',
        summary: summary || title,
        locator: source.locator
      });
    }
  };

  (stateBundle.capsule.resources || []).slice(0, 12).forEach((resource, index) => {
    add({
      id: resource.fileId || `resource-${index + 1}`,
      title: resource.fileName || `Source ${index + 1}`,
      kind: resource.type || 'source',
      summary: resource.summary || `${resource.fileName || 'Source'} (${resource.type || 'file'})`
    });
  });

  (stateBundle.capsule.sourceMap || []).slice(0, 16).forEach((source, index) => {
    add({
      id: source.fileId || source.sourceId || `source-map-${index + 1}`,
      title: source.fileName || source.label || `Source ${index + 1}`,
      kind: source.sourceType || 'source',
      summary: source.preview || source.supportSnippets?.[0]?.text || source.label || source.fileName,
      locator: source.locator as Record<string, unknown> | undefined
    });
  });

  (stateBundle.capsule.retrievedChunks || []).slice(0, 10).forEach((chunk, index) => {
    add({
      id: chunk.fileId || chunk.sourceId || `chunk-${index + 1}`,
      title: chunk.fileName || `Evidence ${index + 1}`,
      kind: chunk.source || 'retrieval',
      summary: chunk.content,
      locator: chunk.locator as Record<string, unknown> | undefined
    });
  });

  (stateBundle.capsule.citations || []).slice(0, 12).forEach((citation, index) => {
    add({
      id: citation.fileId || citation.sourceId || `citation-${index + 1}`,
      title: citation.fileName || citation.label || `Source ${index + 1}`,
      kind: citation.sourceType || 'citation',
      summary: citation.preview || citation.supportSnippets?.[0]?.text || citation.label || citation.fileName,
      locator: citation.locator as Record<string, unknown> | undefined
    });
  });

  return Array.from(byId.values()).slice(0, 18);
};

const sourceCatalogToResources = (sources: CorePlannerSourceSummary[]): LearningPlanResource[] =>
  sources.slice(0, 10).map((source, index) => ({
    id: source.id || `source-${index + 1}`,
    title: source.title,
    type: source.kind === 'video' ? 'video' : source.kind === 'retrieval' ? 'context' : 'document',
    sourceId: source.id,
    citationLabel: source.title,
    summary: source.summary,
    difficulty: 2,
    estimatedMinutes: 12,
    relevanceScore: Math.max(0.45, 0.78 - index * 0.04)
  }));

const profilesToResources = (profiles: ResourcePlanningProfile[]): LearningPlanResource[] =>
  profiles.slice(0, 12).map((profile, index) => ({
    id: `${profile.resourceId}:${profile.unitId}`.slice(0, 120) || `profile-${index + 1}`,
    title: profile.title,
    type: profile.teachingRole === 'practice'
      ? 'exercise'
      : profile.teachingRole === 'project'
        ? 'project'
        : profile.teachingRole === 'reference'
          ? 'context'
          : profile.teachingRole === 'advanced_extension'
            ? 'document'
            : 'document',
    sourceId: profile.resourceId,
    citationLabel: profile.entryPoint || profile.title,
    summary: profile.summary,
    difficulty: profile.difficulty,
    estimatedMinutes: profile.teachingRole === 'project' ? 40 : profile.teachingRole === 'practice' ? 25 : 15,
    relevanceScore: Math.max(0.45, 0.82 - index * 0.03)
  }));

const buildCorePlannerPrompt = (objective: string) => ({
  instruction: [
    'You are an expert curriculum planner and tutor.',
    'Create a high-quality learning plan. Your own domain knowledge should lead the curriculum sequence.',
    'Do not use uploaded resources, files, workspace notes, KG data, learner memory, or source snippets to decide the curriculum skeleton.',
    'Design the ideal curriculum first. Resource grounding happens later in a separate pass.',
    'Make the plan concrete enough to execute: each step should have a learning goal, activities, evidence, and success criteria.',
    'Prefer Simplified Chinese for user-facing text unless the objective clearly asks otherwise.',
    'Return JSON only.'
  ].join('\n'),
  schema: {
    objective: 'string',
    rationale: 'string',
    targetSkills: ['string'],
    assumptions: ['string'],
    steps: [
      {
        title: 'string',
        type: 'explain | practice | quiz | project | reflect | retrieve | diagnose',
        goal: 'string',
        rationale: 'string',
        targetSkills: ['string'],
        prerequisites: ['string'],
        activities: ['string'],
        evidence: ['string'],
        successCriteria: ['string'],
        estimatedLoad: 'light | medium | heavy',
        estimatedMinutes: 20
      }
    ]
  },
  input: {
    userObjective: objective
  }
});

const buildCoreFallbackDraft = (objective: string): PlannerPathDraft => {
  const targetSkills = filterKnowledgeConcepts([objective, '核心概念理解', '示例推演', '针对练习', '形成性检测', '综合应用'], 8);
  const makeStep = (
    title: string,
    type: LearningPlanStepType,
    skillIndex: number,
    activities: string[],
    load: 'light' | 'medium' | 'heavy' = 'medium'
  ): DraftPlannerStep => {
    const skill = targetSkills[skillIndex] || targetSkills[0];
    return {
      title,
      type,
      rationale: `这一步先解决「${skill}」的学习任务，避免还没建立理解就直接跳到后面的练习。`,
      learningGoal: `掌握 ${skill}`,
      targetSkills: [skill],
      prerequisites: skillIndex > 0 ? [targetSkills[Math.max(0, skillIndex - 1)]] : [],
      estimatedLoad: load,
      expectedEvidence: [`能用自己的话说明 ${skill}`, '完成一个可检查的小任务'],
      activities,
      difficulty: Math.min(5, Math.max(1, skillIndex + 1 > 7 ? 4 : Math.ceil((skillIndex + 1) / 2))),
      estimatedMinutes: type === 'quiz' || type === 'reflect' ? 15 : type === 'project' ? 45 : 25,
      teachingPhase: mapStepTypeToTeachingPhase(type, skillIndex, false),
      evidenceType: mapStepTypeToEvidenceType(type),
      successCriteria: successCriteriaForStep(type, [skill]),
      unlockCondition: skillIndex > 0 ? `先完成 ${targetSkills[Math.max(0, skillIndex - 1)]}` : '可以直接开始。'
    };
  };

  const steps = [
    makeStep(`建立学习地图：${targetSkills[0]}`, 'explain', 0, ['梳理核心概念、用途和边界', '列出最重要的 3 个问题'], 'light'),
    makeStep(`核心概念讲解与例子：${targetSkills[1] || targetSkills[0]}`, 'explain', 1, ['用例子解释概念', '标注容易混淆的点']),
    makeStep(`针对练习：${targetSkills[2] || targetSkills[0]}`, 'practice', 2, ['完成一组由浅入深的练习', '记录错误模式']),
    makeStep('形成性检测与查漏补缺', 'quiz', 3, ['做一次短测', '按错因决定回看或前进'], 'light'),
    makeStep('综合应用与下一轮计划', 'project', 4, ['完成一个小产出', '把学习结论迁移到新任务'])
  ];

  return {
    objective,
    rationale: '先由学科知识决定课程顺序，再用 workbench 资料做轻量落地；资料不足时明确标记缺口。',
    assumptions: [
      '学习画像不明确时不强行推断，默认给出通用但可执行的学习路径。',
      'source 只作为支撑材料，不决定课程骨架。'
    ],
    constraints: ['课程顺序由领域知识主导', '不为了匹配 source 扭曲学习路径', '每步必须有可检查产出'],
    targetSkills,
    weakSkills: [],
    milestones: [
      {
        title: '建立基础理解',
        description: '先掌握核心概念和最小可用语法/方法。',
        successCriteria: ['能解释基础概念', '能完成低难度任务']
      },
      {
        title: '完成核心技能闭环',
        description: '通过练习和检测确认是否真正会用。',
        successCriteria: ['完成核心练习', '能解释错因']
      },
      {
        title: '完成综合应用',
        description: '用项目或综合题把知识串起来。',
        successCriteria: ['完成一个可展示产出', '明确下一轮学习重点']
      }
    ],
    steps,
    adaptationPolicy: {
      replanTriggers: ['用户给出明确水平或时间预算', 'source gap 阻塞关键阶段', '练习或测验暴露新的薄弱点'],
      progressionSignals: ['能独立解释概念', '能完成核心练习', '能迁移到综合任务'],
      fallbackActions: ['缩小到单个核心技能', '补充缺失 source', '降低难度并加入更多例题']
    }
  };
};

const normalizeCoreDraft = (
  raw: CorePlannerResponse | null | undefined,
  fallback: PlannerPathDraft
): PlannerPathDraft => {
  const rawSteps = Array.isArray(raw?.steps) && raw.steps.length ? raw.steps : [];
  const steps = rawSteps.length
    ? rawSteps.slice(0, 10).map((step, index): DraftPlannerStep => {
        const title = clip(step.title, 140) || fallback.steps[index]?.title || `学习步骤 ${index + 1}`;
        const type = inferCoreStepType(title, step.type);
        const targetSkills = asConceptArray(step.targetSkills, fallback.steps[index]?.targetSkills || fallback.targetSkills.slice(index, index + 1), 4);
        return {
          type,
          title,
          rationale: clip(step.rationale, 360) || fallback.steps[index]?.rationale || `按领域知识推进 ${targetSkills[0] || fallback.objective}。`,
          learningGoal: clip(step.goal, 280) || fallback.steps[index]?.learningGoal,
          targetSkills,
          prerequisites: asConceptArray(step.prerequisites, fallback.steps[index]?.prerequisites || [], 4),
          estimatedLoad: step.estimatedLoad === 'light' || step.estimatedLoad === 'heavy' ? step.estimatedLoad : 'medium',
          expectedEvidence: asStringArray(step.evidence, fallback.steps[index]?.expectedEvidence || successCriteriaForStep(type, targetSkills)).slice(0, 4),
          activities: asStringArray(step.activities, fallback.steps[index]?.activities || []).slice(0, 5),
          difficulty: asNumber(fallback.steps[index]?.difficulty, Math.min(5, index + 1), 1, 5),
          estimatedMinutes: asNumber(step.estimatedMinutes, fallback.steps[index]?.estimatedMinutes || 20, 5, 180),
          teachingPhase: mapStepTypeToTeachingPhase(type, index, false),
          evidenceType: mapStepTypeToEvidenceType(type),
          successCriteria: asStringArray(step.successCriteria, fallback.steps[index]?.successCriteria || successCriteriaForStep(type, targetSkills)).slice(0, 4),
          unlockCondition: fallback.steps[index]?.unlockCondition,
          qualitySignals: ['core_planner_phase1']
        };
      })
    : fallback.steps;

  return {
    objective: clip(raw?.objective, 280) || fallback.objective,
    rationale: clip(raw?.rationale, 520) || fallback.rationale,
    assumptions: asStringArray(raw?.assumptions, fallback.assumptions).slice(0, 6),
    constraints: fallback.constraints,
    targetSkills: asConceptArray(raw?.targetSkills, fallback.targetSkills, 10),
    weakSkills: [],
    milestones: fallback.milestones,
    steps,
    adaptationPolicy: fallback.adaptationPolicy
  };
};

const buildFinalTutorPlanComposerPrompt = (
  objective: string,
  step: DraftPlannerStep,
  index: number,
  totalSteps: number
) => ({
  instruction: [
    'You are the Final Tutor Plan Composer.',
    'All user-visible text must be written by you in a natural tutor voice.',
    'Use the curriculum skeleton as the source of learning sequence.',
    'Resource Grounding only supplies recommendation candidates. It must not change the curriculum order.',
    'Use only the provided resource candidates. Do not invent uploaded resources.',
    'Group resources by document, video, exercise, and project. If a group has no useful candidate, keep it empty and provide a gap message.',
    'Do not mention internal fields, scores, JSON, groundingStatus, profile, or implementation details.',
    'Avoid repeating the title as the learning goal or mastery criteria.',
    'Keep concise: learningGoal and whyThisStep each 1 sentence; learningTasks and masteryCriteria each 2-4 concrete items.',
    'Prefer Simplified Chinese for user-facing text unless the objective clearly asks otherwise.',
    'Return JSON only.'
  ].join('\n'),
  schema: {
    steps: [
      {
        title: 'string',
        learningGoal: 'string',
        whyThisStep: 'string',
        learningTasks: ['string'],
        recommendedResources: {
          document: [{ name: 'string', source: 'string', location: 'string', matchReason: 'string', usage: 'string' }],
          video: [{ name: 'string', source: 'string', location: 'string', matchReason: 'string', usage: 'string' }],
          exercise: [{ name: 'string', source: 'string', location: 'string', matchReason: 'string', usage: 'string' }],
          project: [{ name: 'string', source: 'string', location: 'string', matchReason: 'string', usage: 'string' }]
        },
        resourceGaps: {
          document: 'string',
          video: 'string',
          exercise: 'string',
          project: 'string'
        },
        masteryCriteria: ['string'],
        dynamicAdjustment: {
          passCondition: 'string',
          remedialAction: 'string',
          fallbackStep: 'string',
          nextStep: 'string'
        },
        personalizationReason: 'string'
      }
    ]
  },
  input: {
    objective,
    step: {
      index,
      totalSteps,
      title: step.title,
      type: step.type,
      learningGoal: step.learningGoal || step.rationale,
      whyThisStage: step.curriculumDecision?.whyThisStage || step.unlockCondition,
      targetSkills: step.targetSkills,
      prerequisites: step.prerequisites,
      learningTasks: step.activities?.slice(0, 4) || [],
      successCriteria: step.successCriteria?.slice(0, 2) || step.expectedEvidence.slice(0, 2),
      resourceCandidates: groupResourceCandidatesForComposer(step),
      resourceGapReason: step.resourceGapReason
    }
  }
});

const resourceDisplayTypes: LearningPlanResourceDisplayType[] = ['document', 'video', 'exercise', 'project'];

const resourceDisplayTypeFor = (resource: LearningPlanResourceMatch): LearningPlanResourceDisplayType => {
  if (resource.modality === 'watch') return 'video';
  if (resource.modality === 'practice' || resource.modality === 'quiz' || /练习|题|quiz|exercise/i.test(`${resource.resourceTitle} ${resource.resourceUnitTitle}`)) return 'exercise';
  if (resource.modality === 'project' || /项目|案例|project|case/i.test(`${resource.resourceTitle} ${resource.resourceUnitTitle}`)) return 'project';
  return 'document';
};

const groupResourceCandidatesForComposer = (step: DraftPlannerStep) => {
  const grouped: Record<LearningPlanResourceDisplayType, Array<Record<string, unknown>>> = {
    document: [],
    video: [],
    exercise: [],
    project: []
  };
  (step.resourceOptions || []).slice(0, 6).forEach((resource) => {
    const type = resourceDisplayTypeFor(resource);
    if (grouped[type].length >= 2) return;
    grouped[type].push({
      id: resource.resourceUnitId || resource.resourceId,
      name: resource.resourceUnitTitle || resource.resourceTitle,
      source: resource.resourceTitle,
      location: resource.resourceEntryPoint,
      matchReason: resource.reason,
      modality: resource.modality
    });
  });
  return grouped;
};

const emptyRecommendedResources = (): Record<LearningPlanResourceDisplayType, LearningPlanStepResourceRecommendation[]> => ({
  document: [],
  video: [],
  exercise: [],
  project: []
});

const defaultResourceGaps = (): Record<LearningPlanResourceDisplayType, string> => ({
  document: '暂无合适资源，建议系统生成。',
  video: '暂无合适资源，建议系统生成。',
  exercise: '暂无合适资源，建议系统生成。',
  project: '暂无合适资源，建议系统生成。'
});

const normalizeResourceRecommendation = (
  raw: Partial<LearningPlanStepResourceRecommendation> | null | undefined,
  type: LearningPlanResourceDisplayType,
  index: number
): LearningPlanStepResourceRecommendation | null => {
  const name = clip(raw?.name, 120);
  if (!name) return null;
  return {
    id: clip(raw?.id, 120) || `${type}-${index + 1}`,
    type,
    name,
    source: clip(raw?.source, 120),
    location: clip(raw?.location, 120),
    matchReason: clip(raw?.matchReason, 180) || '与当前学习目标匹配。',
    usage: clip(raw?.usage, 180) || '用于完成本阶段任务。'
  };
};

const normalizeStepDetail = (
  step: DraftPlannerStep,
  raw: FinalTutorPlanComposerStepResponse,
  index: number,
  totalSteps: number
): LearningPlanStepDetail => {
  const resources = emptyRecommendedResources();
  resourceDisplayTypes.forEach((type) => {
    const rawItems = Array.isArray(raw?.recommendedResources?.[type]) ? raw.recommendedResources[type] : [];
    resources[type] = rawItems
      .slice(0, 2)
      .map((item, itemIndex) => normalizeResourceRecommendation(item, type, itemIndex))
      .filter((item): item is LearningPlanStepResourceRecommendation => Boolean(item));
  });
  const gaps = defaultResourceGaps();
  resourceDisplayTypes.forEach((type) => {
    gaps[type] = clip(raw?.resourceGaps?.[type], 160) || gaps[type];
  });
  const masteryCriteria = asStringArray(raw?.masteryCriteria, step.successCriteria || step.expectedEvidence).slice(0, 4);
  const tasks = asStringArray(raw?.learningTasks, step.activities || step.expectedEvidence).slice(0, 4);
  return {
    learningGoal: clip(raw?.learningGoal, 240) || step.learningGoal || step.rationale,
    whyThisStep: clip(raw?.whyThisStep, 260) || step.curriculumDecision?.whyThisStage || step.unlockCondition || '该步骤承接前一阶段，并为后续练习降低跳跃难度。',
    learningTasks: tasks.length ? tasks : ['阅读或观看推荐资源', '完成一个可检查的小任务'],
    recommendedResources: resources,
    resourceGaps: gaps,
    masteryCriteria: masteryCriteria.length ? masteryCriteria : successCriteriaForStep(step.type, step.targetSkills),
    dynamicAdjustment: {
      passCondition: clip(raw?.dynamicAdjustment?.passCondition, 180) || '达到本阶段掌握标准后进入下一步。',
      remedialAction: clip(raw?.dynamicAdjustment?.remedialAction, 220) || '未通过时先回看推荐资源，并让系统生成补充讲解或练习。',
      fallbackStep: clip(raw?.dynamicAdjustment?.fallbackStep, 160) || (index > 0 ? `回到第 ${index} 步补前置。` : '回到基础概念解释。'),
      nextStep: clip(raw?.dynamicAdjustment?.nextStep, 160) || (index + 1 < totalSteps ? `进入第 ${index + 2} 步。` : '进入复盘与下一轮计划。')
    },
    learnerProfile: {},
    personalizationReason: clip(raw?.personalizationReason, 200) || '暂未接入明确学习画像，当前按目标和资源可用性进行规划。'
  };
};

const fallbackStepDetailFromGrounding = (
  step: DraftPlannerStep,
  index: number,
  totalSteps: number
): LearningPlanStepDetail => {
  const resources = emptyRecommendedResources();
  (step.resourceOptions || []).slice(0, 6).forEach((resource, resourceIndex) => {
    const type = resourceDisplayTypeFor(resource);
    if (resources[type].length >= 2) return;
    resources[type].push({
      id: resource.resourceUnitId || resource.resourceId || `${type}-${resourceIndex + 1}`,
      type,
      name: humanizeResourceTitle(resource.resourceUnitTitle || resource.resourceTitle),
      source: humanizeResourceTitle(resource.resourceTitle),
      location: clip(resource.resourceEntryPoint, 120),
      matchReason: clip(resource.reason, 180) || '与当前阶段目标匹配。',
      usage: type === 'exercise'
        ? '用于完成本阶段练习并暴露错误模式。'
        : type === 'video'
          ? '先观看关键片段，再整理步骤或概念。'
          : type === 'project'
            ? '用于把本阶段知识迁移到小型实操任务。'
            : '用于阅读核心概念和例子。'
    });
  });
  const gaps = defaultResourceGaps();
  resourceDisplayTypes.forEach((type) => {
    if (!resources[type].length && step.resourceGapReason) gaps[type] = step.resourceGapReason;
  });
  const masteryCriteria = asStringArray(step.successCriteria, step.expectedEvidence).slice(0, 4);
  const tasks = asStringArray(step.activities, [
    step.learningGoal || step.rationale,
    '完成一个可检查的小任务',
    '记录不确定点或错误模式'
  ]).slice(0, 4);
  return {
    learningGoal: step.learningGoal || step.rationale,
    whyThisStep: step.curriculumDecision?.whyThisStage || step.unlockCondition || step.rationale,
    learningTasks: tasks,
    recommendedResources: resources,
    resourceGaps: gaps,
    masteryCriteria: masteryCriteria.length ? masteryCriteria : successCriteriaForStep(step.type, step.targetSkills),
    dynamicAdjustment: {
      passCondition: '达到本阶段掌握标准后进入下一步。',
      remedialAction: '未通过时优先回看推荐资源；资源不足时建议系统生成补充讲解或练习。',
      fallbackStep: index > 0 ? `回到第 ${index} 步补前置。` : '回到基础概念解释。',
      nextStep: index + 1 < totalSteps ? `进入第 ${index + 2} 步。` : '进入复盘与下一轮计划。'
    },
    learnerProfile: {},
    personalizationReason: '暂未接入明确学习画像，当前按目标和资源可用性进行规划。'
  };
};

const applyStepDetailToDraftStep = (
  step: DraftPlannerStep,
  stepDetail: LearningPlanStepDetail,
  title?: string
): DraftPlannerStep => {
  const firstResource = resourceDisplayTypes
    .flatMap((type) => stepDetail.recommendedResources[type])
    .find(Boolean);
  return {
    ...step,
    title: clip(title, 120) || step.title,
    stepDetail,
    rationale: stepDetail.whyThisStep || step.rationale,
    learningGoal: stepDetail.learningGoal || step.learningGoal,
    activities: stepDetail.learningTasks,
    resourceReason: firstResource?.matchReason || step.resourceReason,
    successCriteria: stepDetail.masteryCriteria,
    expectedEvidence: stepDetail.masteryCriteria.length ? stepDetail.masteryCriteria : step.expectedEvidence,
    qualitySignals: uniqueStrings([...(step.qualitySignals || []), 'final_tutor_composer_detail'], 8)
  };
};

const applyFinalTutorComposition = (
  draft: PlannerPathDraft,
  raw: FinalTutorPlanComposerResponse | null | undefined
): PlannerPathDraft => {
  const composed = Array.isArray(raw?.steps) ? raw.steps : [];
  if (!composed.length) return draft;

  return {
    ...draft,
    steps: draft.steps.map((step, index) => {
      const item = composed[index];
      if (!item) return step;
      const stepDetail = normalizeStepDetail(step, item, index, draft.steps.length);
      return applyStepDetailToDraftStep(step, stepDetail, item.title);
    })
  };
};

type ResourceProfileGrounding = {
  status: ResourceGroundingStatus;
  matches: Array<{
    profile: ResourcePlanningProfile;
    score: number;
    reasons: string[];
  }>;
  gapReason?: string;
};

const scoreProfileMatch = (step: DraftPlannerStep, profile: ResourcePlanningProfile, learnerLevel: LearnerDiagnosticReport['learnerLevel']) => {
  const stepText = [
    step.title,
    step.rationale,
    step.learningGoal,
    ...(step.targetSkills || []),
    ...(step.prerequisites || []),
    ...(step.activities || []),
    ...(step.successCriteria || [])
  ].join(' ').toLowerCase();
  const profileText = [
    profile.title,
    profile.summary,
    ...(profile.coveredSkills || []),
    ...(profile.prerequisiteSkills || []),
    ...(profile.suitableStages || []),
    ...(profile.riskFlags || [])
  ].join(' ').toLowerCase();
  const stepSkills = [...new Set((step.targetSkills || []).concat(step.prerequisites || []).map((item) => item.toLowerCase()))];
  const coveredHits = stepSkills.filter((skill) => profile.coveredSkills.some((covered) => covered.toLowerCase().includes(skill) || skill.includes(covered.toLowerCase()))).length;
  const prereqHits = (step.prerequisites || []).filter((skill) => profile.prerequisiteSkills.some((covered) => covered.toLowerCase().includes(skill.toLowerCase()) || skill.toLowerCase().includes(covered.toLowerCase()))).length;
  const stageBonus = profile.suitableStages.includes(step.teachingPhase as any) ? 0.16 : 0;
  const roleBonus =
    step.type === 'explain' && profile.teachingRole === 'concept_explanation'
      ? 0.18
      : step.type === 'retrieve' && profile.teachingRole === 'reference'
        ? 0.18
        : step.type === 'practice' && profile.teachingRole === 'practice'
          ? 0.2
          : step.type === 'project' && profile.teachingRole === 'project'
            ? 0.22
            : step.type === 'quiz' && (profile.teachingRole === 'practice' || profile.teachingRole === 'reference')
              ? 0.08
              : step.type === 'explain' && profile.teachingRole === 'worked_example'
                ? 0.16
                : 0;
  const levelFit =
    profile.targetLearnerLevel === learnerLevel || profile.targetLearnerLevel === 'unknown' || learnerLevel === 'unknown'
      ? 0.16
      : Math.abs(levelRank(profile.targetLearnerLevel) - levelRank(learnerLevel)) <= 1
        ? 0.1
        : -0.08;
  const difficultyFit = Math.max(0, 1 - Math.abs((step.difficulty || 3) - profile.difficulty) / 5);
  const lexicalFit = (coveredHits * 0.18 + prereqHits * 0.12) + (stepText.includes(profile.title.toLowerCase()) ? 0.08 : 0) + (profileText.includes(step.title.toLowerCase()) ? 0.08 : 0);
  const riskPenalty = profile.riskFlags.length ? Math.min(0.18, profile.riskFlags.length * 0.04) : 0;
  const score = Math.max(0, Math.min(1, lexicalFit + roleBonus + stageBonus + levelFit + difficultyFit * 0.2 - riskPenalty));
  const reasons = [
    coveredHits ? `coveredSkills=${coveredHits}` : '',
    prereqHits ? `prerequisiteSkills=${prereqHits}` : '',
    roleBonus ? `teachingRole=${profile.teachingRole}` : '',
    stageBonus ? `suitableStage=${step.teachingPhase || 'unknown'}` : '',
    levelFit ? `learnerLevel=${profile.targetLearnerLevel}` : '',
    riskPenalty ? `riskFlags=${profile.riskFlags.join(',')}` : ''
  ].filter(Boolean);
  return { score, reasons };
};

const levelRank = (level: LearnerDiagnosticReport['learnerLevel']) => {
  if (level === 'novice') return 1;
  if (level === 'beginner') return 2;
  if (level === 'intermediate') return 3;
  if (level === 'advanced') return 4;
  return 2;
};

const buildResourceProfileGrounding = (
  step: DraftPlannerStep,
  profiles: ResourcePlanningProfile[],
  learnerLevel: LearnerDiagnosticReport['learnerLevel'],
  limit = 3
): ResourceProfileGrounding => {
  const scored = profiles
    .map((profile) => {
      const match = scoreProfileMatch(step, profile, learnerLevel);
      return { profile, score: match.score, reasons: match.reasons };
    })
    .filter((item) => item.score >= 0.38)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  const best = scored[0];
  if (!best) {
    return {
      status: 'resource_gap',
      matches: [],
      gapReason: `没有找到与「${step.title}」足够匹配的上传资料，不能硬塞不相关资源。`
    };
  }

  return {
    status: best.score >= 0.64 ? 'grounded' : 'partial',
    matches: scored,
    gapReason: best.score < 0.64 ? `现有上传资料只能部分支撑「${step.title}」，仍需补充或等待更合适的资源。` : undefined
  };
};

const humanizeResourceTitle = (title: unknown) => {
  const text = String(title || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const cleaned = text
    .replace(/^[•\-\*\u2022]+\s*/g, '')
    .replace(/\s*[:：]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (/^[A-Z][a-zA-Z\s]{0,24}books?$/i.test(cleaned)) return '参考资料';
  return cleaned;
};

const profileGroundingToResourceMatch = (profile: ResourcePlanningProfile, score: number, reasons: string[]): LearningPlanResourceMatch => ({
  resourceId: profile.resourceId,
  resourceTitle: humanizeResourceTitle(profile.sourceFileName || profile.title),
  resourceUnitId: profile.unitId,
  resourceUnitTitle: humanizeResourceTitle(profile.title),
  resourceLocator: profile.locator,
  resourceEntryPoint: profile.entryPoint,
  modality: profile.teachingRole === 'practice'
    ? 'practice'
    : profile.teachingRole === 'project'
      ? 'project'
      : profile.teachingRole === 'reference'
        ? 'mixed'
        : profile.teachingRole === 'advanced_extension'
          ? 'read'
          : 'read',
  difficulty: profile.difficulty,
  estimatedMinutes: profile.teachingRole === 'project' ? 40 : profile.teachingRole === 'practice' ? 25 : 15,
  matchScore: Number(score.toFixed(2)),
  scoreBreakdown: {
    relevance: Number(Math.min(1, score).toFixed(2)),
    difficultyFit: Number((1 - Math.min(1, Math.abs(profile.difficulty - 3) / 4)).toFixed(2)),
    prerequisiteFit: Number(Math.min(1, profile.prerequisiteSkills.length ? 0.8 : 0.55).toFixed(2)),
    learnerFit: Number(Math.min(1, profile.targetLearnerLevel === 'unknown' ? 0.7 : 0.85).toFixed(2))
  },
  reason: buildReadableResourceReason(profile, reasons)
});

const buildReadableResourceReason = (profile: ResourcePlanningProfile, reasons: string[]) => {
  const reasonText = reasons.join(' ');
  const parts = [
    /coveredSkills|prerequisiteSkills/.test(reasonText) ? '覆盖当前知识点' : '',
    /teachingRole=concept_explanation/.test(reasonText) ? '适合先建立概念理解' : '',
    /teachingRole=worked_example/.test(reasonText) ? '适合看示例拆解' : '',
    /teachingRole=practice/.test(reasonText) ? '适合做针对练习' : '',
    /teachingRole=project/.test(reasonText) ? '适合做综合应用' : '',
    /suitableStage/.test(reasonText) ? '教学阶段匹配' : '',
    /learnerLevel/.test(reasonText) ? '难度接近当前水平' : ''
  ].filter(Boolean);
  const summary = parts.length ? parts.slice(0, 3).join('，') : '与当前阶段目标较匹配';
  const resourceName = humanizeResourceTitle(profile.sourceFileName || profile.title);
  const unitName = humanizeResourceTitle(profile.title);
  return unitName && unitName !== resourceName ? `${unitName}（${resourceName}）：${summary}。` : `${resourceName || unitName}：${summary}。`;
};

const enrichDraftStepWithProfiles = (
  step: DraftPlannerStep,
  profiles: ResourcePlanningProfile[],
  learnerLevel: LearnerDiagnosticReport['learnerLevel']
): DraftPlannerStep => {
  const grounding = buildResourceProfileGrounding(step, profiles, learnerLevel);
  const matches = grounding.matches.map((item) => profileGroundingToResourceMatch(item.profile, item.score, item.reasons));
  const primary = grounding.matches[0];
  const matchedProfile = primary?.profile;
  return {
    ...step,
    resourceGrounding: {
      status: grounding.status,
      matches,
      gapReason: grounding.gapReason,
      neededResource: grounding.gapReason || (matchedProfile ? `需要与 ${humanizeResourceTitle(matchedProfile.title)} 类似的资源。` : undefined),
      warnings: matchedProfile?.riskFlags || []
    },
    groundingStatus: grounding.status,
    resourceOptions: matches,
    resourceId: grounding.status === 'resource_gap' ? undefined : matchedProfile?.resourceId,
    resourceTitle: grounding.status === 'resource_gap' ? undefined : humanizeResourceTitle(matchedProfile?.sourceFileName || matchedProfile?.title),
    resourceUnitId: grounding.status === 'resource_gap' ? undefined : matchedProfile?.unitId,
    resourceUnitTitle: grounding.status === 'resource_gap' ? undefined : humanizeResourceTitle(matchedProfile?.title),
    resourceLocator: grounding.status === 'resource_gap' ? undefined : matchedProfile?.locator,
    resourceEntryPoint: grounding.status === 'resource_gap' ? undefined : matchedProfile?.entryPoint,
    resourceReason: grounding.status === 'resource_gap'
      ? grounding.gapReason
      : matchedProfile
        ? matches[0]?.reason || `${humanizeResourceTitle(matchedProfile.sourceFileName || matchedProfile.title)}：与当前阶段目标较匹配。`
        : undefined,
    resourceGapReason: grounding.status === 'resource_gap' ? grounding.gapReason : undefined,
    riskNotes: uniqueStrings([
      ...(step.riskNotes || []),
      ...(matchedProfile?.riskFlags || []),
      grounding.gapReason || ''
    ], 8)
  };
};

const applyEvidenceGroundingToStep = (
  step: DraftPlannerStep,
  grounding: LearningPlanResourceGrounding,
  _fallbackProfiles: ResourcePlanningProfile[],
  _learnerLevel: LearnerDiagnosticReport['learnerLevel']
): DraftPlannerStep => {
  const hasAcceptedEvidence = grounding.matches.some((match) => (match.acceptedEvidence || []).length > 0);
  if (!hasAcceptedEvidence && grounding.status === 'resource_gap') {
    return {
      ...step,
      resourceGrounding: grounding,
      groundingStatus: grounding.status,
      resourceOptions: [],
      resourceId: undefined,
      resourceTitle: undefined,
      resourceUnitId: undefined,
      resourceUnitTitle: undefined,
      resourceLocator: undefined,
      resourceEntryPoint: undefined,
      resourceMatchScore: undefined,
      resourceReason: grounding.gapReason,
      resourceGapReason: grounding.gapReason,
      qualitySignals: uniqueStrings([...(step.qualitySignals || []), 'evidence_grounding_gap'], 8),
      riskNotes: uniqueStrings([...(step.riskNotes || []), grounding.gapReason || '资料证据不足'], 8)
    };
  }

  const primary = grounding.matches[0];
  return {
    ...step,
    resourceGrounding: grounding,
    groundingStatus: grounding.status,
    resourceOptions: grounding.matches,
    resourceId: primary?.resourceId,
    resourceTitle: primary?.resourceTitle,
    resourceUnitId: primary?.resourceUnitId,
    resourceUnitTitle: primary?.resourceUnitTitle,
    resourceLocator: primary?.resourceLocator,
    resourceEntryPoint: primary?.resourceEntryPoint,
    resourceMatchScore: primary?.matchScore,
    resourceReason: primary?.reason || grounding.gapReason,
    resourceGapReason: grounding.status === 'resource_gap' ? grounding.gapReason : undefined,
    qualitySignals: uniqueStrings([
      ...(step.qualitySignals || []),
      `evidenceGrounding:${grounding.status}`,
      `coverage:${grounding.coverageScore ?? 0}`
    ], 8),
    riskNotes: uniqueStrings([
      ...(step.riskNotes || []),
      ...(grounding.warnings || []),
      grounding.gapReason || ''
    ], 8)
  };
};

const buildPhaseOneDiagnostic = (objective: string, sourceCatalog: CorePlannerSourceSummary[]): LearnerDiagnosticReport => ({
  learnerLevel: 'unknown',
  targetGoal: objective,
  currentStateSummary: '阶段一瘦身 planner 未强行使用学习画像；当学习画像不明确时保持静默。',
  strengths: [],
  weakSkills: [],
  prerequisiteGaps: [],
  preferredResourceForms: sourceCatalog.length ? ['workspace_source', 'llm_explanation', 'practice'] : ['llm_explanation', 'practice'],
  timeBudget: { sessionMinutes: 30, weeklySessions: 4 },
  cognitiveLoadTolerance: 'medium',
  recommendedDifficultyBand: { min: 1, max: 4 },
  evidence: [
    'plannerMode=phase1_core_planner',
    `sourceCatalog=${sourceCatalog.length}`,
    'learnerProfile=omitted_when_unclear'
  ]
});

const buildQualitySignals = (step: DraftPlannerStep, resourceUnitTitle?: string) => {
  const signals = [
    step.teachingPhase ? `phase:${step.teachingPhase}` : '',
    step.evidenceType ? `evidence:${step.evidenceType}` : '',
    step.resourceUnitId ? 'resource_unit_bound' : '',
    step.resourceId ? 'resource_bound' : '',
    step.unlockCondition ? 'has_unlock_condition' : '',
    step.successCriteria?.length ? 'has_success_criteria' : '',
    resourceUnitTitle ? `unit:${resourceUnitTitle}` : ''
  ];
  return signals.filter(Boolean);
};

const inferLearnerLevel = (stateBundle: BuiltMclLearningState): LearnerDiagnosticReport['learnerLevel'] => {
  const preferences = stateBundle.state.learnerProfile.preferences || {};
  const explicit = String(preferences.knowledgeLevel || '').toLowerCase();
  if (['novice', 'beginner', 'intermediate', 'advanced'].includes(explicit)) {
    return explicit as LearnerDiagnosticReport['learnerLevel'];
  }

  const diagnostics = (stateBundle.state.eventDiagnostics || {}) as Record<string, any>;
  const strength = diagnostics.strengthScores || {};
  const risk = diagnostics.riskScores || {};
  if (Number(strength.masteryEvidence) >= 0.55 && Number(risk.errorEvidence) < 0.3) return 'advanced';
  if (Number(strength.masteryEvidence) >= 0.35 && Number(risk.confusion) < 0.45) return 'intermediate';
  if (Number(risk.confusion) >= 0.5 || Number(risk.helpSeeking) >= 0.55) return 'beginner';

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
  const diagnostics = (stateBundle.state.eventDiagnostics || {}) as Record<string, any>;
  const risk = diagnostics.riskScores || {};
  if (Number(risk.confusion) >= 0.45 || Number(risk.helpSeeking) >= 0.5 || Number(risk.reviewPressure) >= 0.5) return 'low';
  if (Number((diagnostics.strengthScores || {}).engagement) >= 0.55 && Number(risk.errorEvidence) < 0.3) return 'medium';
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
  const courseGraph = stateBundle.state.courseKnowledgeGraph as any;
  if (courseGraph?.nodes?.length) {
    const nodes = courseGraph.nodes.slice(0, 24).map((node: any) => ({
      id: node.id,
      label: clip(node.title || node.label, 80),
      mastery: undefined,
      importance: asNumber(node.activationScore, 0.5, 0, 10) / 10,
      kind: 'concept' as const
    }));
    const nodeIds = new Set(nodes.map((node: any) => node.id));
    const edges = (courseGraph.edges || [])
      .filter((edge: any) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
      .slice(0, 80)
      .map((edge: any) => ({
        source: edge.from,
        target: edge.to,
        relation: edge.relationType === 'prerequisite'
          ? 'prerequisite'
          : edge.relationType === 'part_of'
            ? 'supports'
            : 'related_to',
        weight: asNumber(edge.weight, 0.55, 0, 1)
      })) as KnowledgeGraphSnapshot['edges'];
    return { nodes, edges };
  }

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

const buildKnowledgeGraphSnapshotFromHints = (hints: KgPlanningHints, fallback: KnowledgeGraphSnapshot): KnowledgeGraphSnapshot => {
  const labels = Array.from(new Set([
    ...hints.masteredConcepts,
    ...hints.weakConcepts,
    ...hints.targetConcepts,
    ...hints.prerequisiteEdges.flatMap((edge) => [edge.from, edge.to])
  ].map((label) => clip(label, 80)).filter(Boolean)));
  if (!labels.length) return fallback;
  const idByLabel = new Map(labels.map((label, index) => [label, `kg-hint-${index + 1}`] as const));
  return {
    nodes: labels.slice(0, 40).map((label) => ({
      id: idByLabel.get(label)!,
      label,
      mastery: hints.masteredConcepts.includes(label) ? 0.78 : hints.weakConcepts.includes(label) ? 0.35 : undefined,
      importance: hints.targetConcepts.includes(label) || hints.weakConcepts.includes(label) ? 0.85 : 0.55,
      kind: 'concept'
    })),
    edges: hints.prerequisiteEdges
      .filter((edge) => idByLabel.has(edge.from) && idByLabel.has(edge.to))
      .slice(0, 80)
      .map((edge) => ({
        source: idByLabel.get(edge.from)!,
        target: idByLabel.get(edge.to)!,
        relation: 'prerequisite',
        weight: asNumber(edge.weight, 0.65, 0, 1)
      }))
  };
};

const buildFallbackDiagnosticReport = (
  stateBundle: BuiltMclLearningState,
  userInput: string,
  resources: LearningPlanResource[],
  planningContext?: PlanningContextBundle,
  goalSkillMap?: GoalSkillMap
): LearnerDiagnosticReport => {
  const level = inferLearnerLevel(stateBundle);
  const tolerance = inferLoadTolerance(stateBundle);
  const goal = stateBundle.state.activeGoal;
  const objective = planningContext?.objective || goalSkillMap?.objective || goal?.goalText || userInput;
  const preferences = stateBundle.state.learnerProfile.preferences || {};
  const courseGraph = stateBundle.state.courseKnowledgeGraph as any;
  const graphGaps = Array.isArray(courseGraph?.reasoning?.prerequisiteGaps)
    ? courseGraph.reasoning.prerequisiteGaps.map((gap: any) => gap.prerequisite?.title || gap.targetConcept?.title).filter(Boolean)
    : [];
  const graphWeak = Array.isArray(courseGraph?.reasoning?.weakNeighborhood?.neighbors)
    ? courseGraph.reasoning.weakNeighborhood.neighbors.map((item: any) => item.title).filter(Boolean)
    : [];
  const masteredTargets = goalSkillMap?.targetSkills
    ? goalSkillMap.targetSkills.filter((item) => item.currentStatus === 'mastered').map((item) => item.title).slice(0, 2)
    : [];
  const skillGapTitles = goalSkillMap?.skillGaps ? goalSkillMap.skillGaps.map((item) => item.title) : [];
  const prerequisiteTitles = goalSkillMap?.prerequisiteSkills ? goalSkillMap.prerequisiteSkills.map((item) => item.title) : [];

  return {
    learnerLevel: level,
    targetGoal: objective,
    currentStateSummary: stateBundle.state.recentTraces.length
      ? '已有部分学习轨迹，可据此进行增量规划。'
      : '当前缺少稳定学习轨迹，需要先以诊断和轻量任务建立状态画像。',
    strengths: asStringArray(preferences.recentFocus, masteredTargets.length ? masteredTargets : goal?.skills?.slice(0, 2) || ['学习目标已初步明确']).slice(0, 4),
    weakSkills: asConceptArray(
      [
        ...new Set([
          ...skillGapTitles,
          ...(graphWeak.slice(0, 4)),
          ...(goal?.weaknesses || [])
        ])
      ],
      ['当前短板尚未完全识别'],
      5
    ),
    prerequisiteGaps: prerequisiteTitles.length
      ? asConceptArray(prerequisiteTitles, [], 5)
      : graphGaps.length
        ? asConceptArray(graphGaps, [], 5)
        : goal?.weaknesses?.length
          ? asConceptArray(goal.weaknesses, [], 3)
          : [],
    preferredResourceForms: ['explain', 'practice', 'quiz'],
    timeBudget: {
      sessionMinutes: 30,
      weeklySessions: 4
    },
    cognitiveLoadTolerance: tolerance,
    recommendedDifficultyBand: {
      min: level === 'novice' ? 1 : 2,
      max: tolerance === 'high' ? 5 : goalSkillMap?.targetSkills?.length && goalSkillMap.targetSkills.length > 4 ? 4 : 3
    },
    evidence: [
      `目标技能数=${goalSkillMap?.targetSkills?.length || goal?.skills?.length || 0}`,
      `近期轨迹数=${stateBundle.state.recentTraces.length}`,
      `候选资源数=${resources.length}`,
      `资源单元数=${planningContext?.resourceLearningUnits.length || 0}`,
      graphGaps.length ? `KG前置缺口=${graphGaps.slice(0, 3).join('、')}` : ''
    ].filter(Boolean)
  };
};

const buildFallbackPathDraft = (
  stateBundle: BuiltMclLearningState,
  userInput: string,
  diagnostic: LearnerDiagnosticReport,
  resources: LearningPlanResource[],
  previousPlan?: LearningPlan | null,
  planningContext?: PlanningContextBundle,
  goalSkillMap?: GoalSkillMap
): PlannerPathDraft => {
  const activeGoal = stateBundle.state.activeGoal;
  const targetSkills = asConceptArray(
    goalSkillMap?.targetSkills?.map((item) => item.title) || activeGoal?.skills,
    ['核心概念理解', '例题推演', '练习巩固'],
    8
  );
  const weakSkills = asConceptArray(goalSkillMap?.skillGaps?.map((item) => item.title) || diagnostic.weakSkills, [], 8);
  const primaryResource = resources[0];
  const primaryUnit = planningContext?.resourceLearningUnits[0];
  const secondaryUnit = planningContext?.resourceLearningUnits.find((unit) => unit.id !== primaryUnit?.id);
  const assessmentUnit = planningContext?.resourceLearningUnits.find((unit) => unit.modality === 'quiz' || unit.modality === 'practice');

  return {
    objective: planningContext?.objective || goalSkillMap?.objective || activeGoal?.goalText || userInput,
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
        title: `确认当前掌握基线：${weakSkills[0] || targetSkills[0]}`,
        rationale: '先建立 learner baseline，避免直接进入过难或过浅的资源。',
        targetSkills: weakSkills.slice(0, 3),
        prerequisites: [],
        estimatedLoad: 'light',
        expectedEvidence: ['得到诊断问题结果或短板线索'],
        suggestedCapability: 'diagnosis',
        concept: weakSkills[0] || targetSkills[0],
        difficulty: diagnostic.recommendedDifficultyBand.min,
        estimatedMinutes: 10,
        teachingPhase: 'diagnostic',
        evidenceType: 'diagnostic_signal',
        successCriteria: successCriteriaForStep('diagnose', weakSkills.length ? weakSkills : targetSkills),
        unlockCondition: '完成后才能决定是否先补前置知识。'
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
        resourceId: primaryUnit?.resourceId || primaryResource?.id,
        resourceTitle: primaryUnit?.resourceTitle || primaryResource?.title,
        resourceUnitId: primaryUnit?.id,
        resourceUnitTitle: primaryUnit?.title,
        resourceLocator: primaryUnit?.locator,
        resourceEntryPoint: primaryUnit?.entryPoint,
        resourceReason: primaryUnit
          ? `优先使用 "${primaryUnit.resourceTitle}" 的学习单元 "${primaryUnit.title}" 作为当前阶段支撑材料。`
          : primaryResource
            ? `优先使用 "${primaryResource.title}" 作为当前阶段支撑材料。`
            : '当前缺少明确资源，需要先检索。',
        difficulty: 2,
        estimatedMinutes: primaryUnit?.estimatedMinutes || 10,
        teachingPhase: 'resource_grounding',
        evidenceType: 'resource_trace',
        successCriteria: successCriteriaForStep('retrieve', targetSkills, primaryUnit?.title || primaryResource?.title),
        unlockCondition: '确认资源单元与目标技能相关后进入概念建模。'
      },
      {
        type: 'explain',
        title: `先理解核心概念：${targetSkills[0]}`,
        rationale: '在练习前先建立概念模型，降低后续练习时的无效负荷。',
        targetSkills: targetSkills.slice(0, 2),
        prerequisites: ['已有相关材料'],
        estimatedLoad: diagnostic.cognitiveLoadTolerance === 'low' ? 'light' : 'medium',
        expectedEvidence: ['形成概念解释、例子或讲解提纲'],
        suggestedCapability: 'reflection',
        concept: targetSkills[0],
        resourceId: primaryUnit?.resourceId || primaryResource?.id,
        resourceTitle: primaryUnit?.resourceTitle || primaryResource?.title,
        resourceUnitId: primaryUnit?.id,
        resourceUnitTitle: primaryUnit?.title,
        resourceLocator: primaryUnit?.locator,
        resourceEntryPoint: primaryUnit?.entryPoint,
        resourceReason: primaryUnit
          ? `该学习单元 "${primaryUnit.title}" 可为概念解释提供 grounding。`
          : primaryResource
            ? '该资源可为概念解释提供 grounding。'
            : undefined,
        difficulty: 2,
        estimatedMinutes: primaryUnit?.estimatedMinutes || 20,
        teachingPhase: 'concept_model',
        evidenceType: 'concept_explanation',
        successCriteria: successCriteriaForStep('explain', targetSkills, primaryUnit?.title),
        unlockCondition: '能讲清核心概念并指出一个例子后，再进入练习。'
      },
      {
        type: 'practice',
        title: `进行针对性练习：${targetSkills[1] || targetSkills[0]}`,
        rationale: '把概念理解转化为可操作技能，验证是否真正掌握。',
        targetSkills: targetSkills.slice(0, 3),
        prerequisites: ['完成核心概念解释'],
        estimatedLoad: 'medium',
        expectedEvidence: ['完成练习并得到错误模式'],
        suggestedCapability: 'content_generation',
        concept: targetSkills[1] || targetSkills[0],
        resourceId: secondaryUnit?.resourceId || primaryUnit?.resourceId || primaryResource?.id,
        resourceTitle: secondaryUnit?.resourceTitle || primaryUnit?.resourceTitle || primaryResource?.title,
        resourceUnitId: secondaryUnit?.id || primaryUnit?.id,
        resourceUnitTitle: secondaryUnit?.title || primaryUnit?.title,
        resourceLocator: secondaryUnit?.locator || primaryUnit?.locator,
        resourceEntryPoint: secondaryUnit?.entryPoint || primaryUnit?.entryPoint,
        resourceReason: secondaryUnit
          ? `使用 "${secondaryUnit.title}" 做 guided practice，避免练习脱离材料。`
          : primaryUnit
            ? `沿用 "${primaryUnit.title}" 生成针对性练习。`
            : undefined,
        difficulty: 3,
        estimatedMinutes: secondaryUnit?.modality === 'practice' ? secondaryUnit.estimatedMinutes : 25,
        teachingPhase: 'guided_practice',
        evidenceType: 'practice_attempt',
        successCriteria: successCriteriaForStep('practice', targetSkills.slice(1).length ? targetSkills.slice(1) : targetSkills),
        unlockCondition: '完成一次练习并记录错因后进入测验。'
      },
      {
        type: 'quiz',
        title: `进行一次掌握度检测：${targetSkills[0]}`,
        rationale: '用小测结果判断当前路径是否有效，并为重规划提供信号。',
        targetSkills: targetSkills.slice(0, 3),
        prerequisites: ['完成解释或练习'],
        estimatedLoad: 'medium',
        expectedEvidence: ['得到测验结果、错因和掌握度信号'],
        suggestedCapability: 'quiz_generation',
        artifactType: 'quiz',
        concept: targetSkills[0],
        resourceId: assessmentUnit?.resourceId || primaryUnit?.resourceId || primaryResource?.id,
        resourceTitle: assessmentUnit?.resourceTitle || primaryUnit?.resourceTitle || primaryResource?.title,
        resourceUnitId: assessmentUnit?.id || primaryUnit?.id,
        resourceUnitTitle: assessmentUnit?.title || primaryUnit?.title,
        resourceLocator: assessmentUnit?.locator || primaryUnit?.locator,
        resourceEntryPoint: assessmentUnit?.entryPoint || primaryUnit?.entryPoint,
        resourceReason: assessmentUnit
          ? `使用 "${assessmentUnit.title}" 形成 formative assessment。`
          : primaryUnit
            ? `基于 "${primaryUnit.title}" 生成掌握度检测。`
            : undefined,
        difficulty: 3,
        estimatedMinutes: assessmentUnit?.estimatedMinutes || 15,
        teachingPhase: 'formative_assessment',
        evidenceType: 'quiz_result',
        successCriteria: successCriteriaForStep('quiz', targetSkills),
        unlockCondition: '根据测验结果决定加深、复习还是切换资源。'
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
        estimatedMinutes: 10,
        teachingPhase: 'reflection',
        evidenceType: 'reflection_note',
        successCriteria: successCriteriaForStep('reflect', targetSkills),
        unlockCondition: '已有诊断、练习或测验反馈。'
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

const stageIdFor = (title: string, index: number) =>
  `stage-${index + 1}-${title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'curriculum'}`;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const stageDifficultyBand = (stage: CurriculumSkeletonStage) =>
  stage.estimatedDifficulty <= 2 ? 'low' : stage.estimatedDifficulty >= 4 ? 'high' : 'medium';

const inferLearnerFit = (diagnostic: LearnerDiagnosticReport, unit: ResourceLearningUnit, stage: CurriculumSkeletonStage) => {
  const learnerBand = diagnostic.recommendedDifficultyBand;
  const targetDifficulty = Math.max(1, Math.min(5, stage.estimatedDifficulty));
  const difficultyFit = 1 - Math.min(1, Math.abs((unit.difficulty || 3) - targetDifficulty) / 4);
  const learnerFit = clamp01(
    diagnostic.cognitiveLoadTolerance === 'low'
      ? unit.modality === 'read' || unit.modality === 'review' || unit.modality === 'quiz'
        ? 0.82
        : 0.58
      : diagnostic.cognitiveLoadTolerance === 'high'
        ? 0.9
        : 0.75
  );
  const prerequisiteFit = stage.prerequisites.length
    ? clamp01(
        stage.prerequisites.some((skill) => {
          const haystack = [unit.title, unit.summary, unit.resourceTitle, ...unit.teaches, ...unit.evidenceSnippets].join(' ').toLowerCase();
          const normalized = skill.toLowerCase();
          return haystack.includes(normalized) || normalized.split(/\s+|、|，|,|\/|-/).some((part) => part.length >= 2 && haystack.includes(part));
        })
          ? 0.95
          : 0.45
      )
    : 0.7;
  const relevance = clamp01(unit.relevanceScore > 1 ? unit.relevanceScore / 100 : unit.relevanceScore);
  const matchScore = clamp01(relevance * 0.4 + difficultyFit * 0.22 + prerequisiteFit * 0.2 + learnerFit * 0.18);
  return {
    relevance,
    difficultyFit,
    prerequisiteFit,
    learnerFit,
    matchScore,
    learnerBand
  };
};

const buildFallbackCurriculumSkeleton = (
  stateBundle: BuiltMclLearningState,
  userInput: string,
  diagnostic: LearnerDiagnosticReport,
  planningContext: PlanningContextBundle,
  goalSkillMap: GoalSkillMap,
  previousPlan?: LearningPlan | null
): CurriculumSkeleton => {
  const objective = planningContext.objective || goalSkillMap.objective || stateBundle.state.activeGoal?.goalText || userInput;
  const targetSkills = asConceptArray(
    goalSkillMap.targetSkills.map((item) => item.title),
    stateBundle.state.activeGoal?.skills || ['核心概念理解', '例题推演', '独立练习'],
    8
  );
  const weakSignals = asConceptArray(
    [...diagnostic.weakSkills, ...goalSkillMap.skillGaps.map((item) => item.title)],
    ['当前短板待诊断'],
    8
  );
  const prerequisiteSkills = asConceptArray(
    [...diagnostic.prerequisiteGaps, ...goalSkillMap.prerequisiteSkills.map((item) => item.title)],
    [],
    6
  );
  const difficultyMin = diagnostic.recommendedDifficultyBand.min;
  const difficultyMax = diagnostic.recommendedDifficultyBand.max;
  const load = diagnostic.cognitiveLoadTolerance === 'low' ? 'light' : 'medium';
  const stages: CurriculumSkeletonStage[] = [];
  const addStage = (stage: Omit<CurriculumSkeletonStage, 'id' | 'recommendedOrder'>) => {
    stages.push({
      ...stage,
      id: stageIdFor(stage.title, stages.length),
      recommendedOrder: stages.length + 1
    });
  };

  addStage({
    title: `建立学习基线：${weakSignals[0] || targetSkills[0]}`,
    learningGoal: '确认当前掌握水平、短板优先级和可承受的学习负荷。',
    whyThisStage: '课程路径应先确定起点，避免直接被资料目录或过难任务牵引。',
    targetSkills: weakSignals.slice(0, 3),
    prerequisites: [],
    estimatedDifficulty: difficultyMin,
    estimatedLoad: 'light',
    idealActivities: ['短诊断', '口头解释一个核心概念', '标记最不确定的问题'],
    checks: ['能说清当前最弱的 1-2 个点', '能判断下一步是否需要前置桥接'],
    riskNotes: ['学习者信号不足时，第一阶段必须保持轻量。'],
    teachingPhase: 'diagnostic'
  });

  if (prerequisiteSkills.length) {
    addStage({
      title: `补齐前置桥接：${prerequisiteSkills[0]}`,
      learningGoal: `先补齐 ${prerequisiteSkills.slice(0, 3).join('、')}，为目标技能降低跳跃风险。`,
      whyThisStage: '前置缺口会让后续解释和练习变成机械跟做，必须在主目标前处理。',
      targetSkills: prerequisiteSkills.slice(0, 4),
      prerequisites: [],
      estimatedDifficulty: Math.max(1, difficultyMin),
      estimatedLoad: load,
      idealActivities: ['前置概念讲解', '最小例题拆解', '快速确认题'],
      checks: ['能解释前置概念与目标技能的关系', '能完成一个低难度前置任务'],
      riskNotes: ['若该阶段失败，不应进入目标技能练习。'],
      teachingPhase: 'prerequisite_bridge'
    });
  }

  addStage({
    title: `建立概念模型：${targetSkills[0]}`,
    learningGoal: `理解 ${targetSkills.slice(0, 2).join('、')} 的核心结构、条件和边界。`,
    whyThisStage: '先形成概念模型，再进入 worked example 和练习，能减少无效认知负荷。',
    targetSkills: targetSkills.slice(0, 3),
    prerequisites: prerequisiteSkills.slice(0, 3),
    estimatedDifficulty: Math.max(difficultyMin, 2),
    estimatedLoad: load,
    idealActivities: ['导师式讲解', '概念图或步骤图', '反例/边界条件辨析'],
    checks: ['能用自己的话解释核心概念', '能指出一个适用条件和一个常见误区'],
    riskNotes: ['如果只引用资料标题而没有概念解释，说明资源 grounding 压过了课程设计。'],
    teachingPhase: 'concept_model'
  });

  addStage({
    title: `例题拆解与示范迁移：${targetSkills[1] || targetSkills[0]}`,
    learningGoal: '通过 worked example 把抽象概念转成可执行步骤。',
    whyThisStage: '示范阶段连接理解和练习，是防止直接刷题的重要脚手架。',
    targetSkills: targetSkills.slice(0, 3),
    prerequisites: targetSkills.slice(0, 1),
    estimatedDifficulty: Math.min(difficultyMax, Math.max(2, difficultyMin + 1)),
    estimatedLoad: 'medium',
    idealActivities: ['逐步拆解例题', '标注关键决策点', '让学习者复述解题路径'],
    checks: ['能解释每一步为什么这样做', '能改写一个相似例子'],
    riskNotes: ['若学习者负荷低，需要把 worked example 拆成更小步骤。'],
    teachingPhase: 'worked_example'
  });

  addStage({
    title: `引导练习：${targetSkills[2] || targetSkills[0]}`,
    learningGoal: '在提示逐渐减少的条件下完成目标技能练习。',
    whyThisStage: '练习应服务于目标技能掌握，而不是服务于现有资料覆盖范围。',
    targetSkills: targetSkills.slice(0, 4),
    prerequisites: targetSkills.slice(0, 2),
    estimatedDifficulty: Math.min(difficultyMax, Math.max(3, difficultyMin + 1)),
    estimatedLoad: 'medium',
    idealActivities: ['分层练习', '错因标注', '一次有反馈的重做'],
    checks: ['能独立完成至少一个核心任务', '能说出主要错误模式和修正方法'],
    riskNotes: ['若出现连续错误，应回退到概念模型或前置桥接。'],
    teachingPhase: 'guided_practice'
  });

  addStage({
    title: '形成性检测与路径调整',
    learningGoal: '用小测或任务证据判断是否进入加深、复习或重规划。',
    whyThisStage: '课程路径必须闭环，否则无法判断下一步是否仍处于最近发展区。',
    targetSkills: targetSkills.slice(0, 4),
    prerequisites: targetSkills.slice(0, 2),
    estimatedDifficulty: Math.min(difficultyMax, Math.max(3, difficultyMin + 1)),
    estimatedLoad: 'light',
    idealActivities: ['短测', '错因复盘', '下一步路径决策'],
    checks: ['得到可判定的掌握度信号', '明确下一轮保留/替换/加深动作'],
    riskNotes: ['检测结果低于预期时，应承认路径假设错误并重规划。'],
    teachingPhase: 'formative_assessment'
  });

  return {
    objective,
    learnerLevel: diagnostic.learnerLevel,
    rationale: previousPlan
      ? '先按理想课程顺序重建路径骨架，再把旧计划和资源作为后续约束处理。'
      : '先按学习目标和学习者状态生成理想课程骨架，再进行 KG 审计和资源 grounding。',
    broadConstraints: [
      `learnerLevel=${diagnostic.learnerLevel}`,
      `cognitiveLoadTolerance=${diagnostic.cognitiveLoadTolerance}`,
      `difficultyBand=${difficultyMin}-${difficultyMax}`,
      diagnostic.timeBudget.sessionMinutes ? `sessionMinutes=${diagnostic.timeBudget.sessionMinutes}` : ''
    ].filter(Boolean),
    targetSkills,
    weakSignals,
    stages,
    assumptions: [
      '本骨架不读取 workspace 资源，因此代表 curriculum-first decision。',
      stateBundle.state.recentTraces.length ? '已有近期学习轨迹，可用于判断起点和反馈闭环。' : '近期学习轨迹不足，需要保留诊断阶段。',
      previousPlan ? `存在上一版计划 ${previousPlan.id}，但不直接继承其资源顺序。` : ''
    ].filter(Boolean)
  };
};

const buildCurriculumSkeletonPrompt = (
  stateBundle: BuiltMclLearningState,
  userInput: string,
  diagnostic: LearnerDiagnosticReport,
  planningContext: PlanningContextBundle,
  goalSkillMap: GoalSkillMap,
  previousPlan?: LearningPlan | null
) => ({
  instruction: [
    'You are the Curriculum Skeleton Agent in a curriculum-first tutor planning system.',
    'Design the ideal learning path skeleton before seeing any workspace resources.',
    'Use only the user objective, learner level, mastered/weak signals, goal skill map, recent learner evidence summaries, and broad constraints.',
    'Do not mention, infer from, or bind to ResourceLearningUnits, candidateResources, files, chunks, citations, KG nodes, or workspace materials.',
    'The output must be goal-driven and curriculum-first: stages should reflect how a good human tutor would sequence learning.',
    'Return JSON only.'
  ].join('\n'),
  schema: {
    objective: 'string',
    learnerLevel: 'novice | beginner | intermediate | advanced | unknown',
    rationale: 'string',
    broadConstraints: ['string'],
    targetSkills: ['string'],
    weakSignals: ['string'],
    stages: [
      {
        id: 'string',
        title: 'string',
        learningGoal: 'string',
        whyThisStage: 'string',
        targetSkills: ['string'],
        prerequisites: ['string'],
        recommendedOrder: 1,
        estimatedDifficulty: 2,
        estimatedLoad: 'light | medium | heavy',
        idealActivities: ['string'],
        checks: ['string'],
        riskNotes: ['string'],
        teachingPhase: 'diagnostic | prerequisite_bridge | concept_model | worked_example | guided_practice | independent_practice | formative_assessment | reflection | project_application'
      }
    ],
    assumptions: ['string']
  },
  input: {
    userInput,
    objective: planningContext.objective,
    learner: {
      learnerLevel: diagnostic.learnerLevel,
      currentStateSummary: diagnostic.currentStateSummary,
      masteredSignals: diagnostic.strengths,
      weakSignals: diagnostic.weakSkills,
      prerequisiteGaps: diagnostic.prerequisiteGaps,
      cognitiveLoadTolerance: diagnostic.cognitiveLoadTolerance,
      recommendedDifficultyBand: diagnostic.recommendedDifficultyBand,
      timeBudget: diagnostic.timeBudget
    },
    activeGoal: planningContext.activeGoal,
    goalSkillMap: {
      objective: goalSkillMap.objective,
      targetSkills: goalSkillMap.targetSkills.map((skill) => ({
        title: skill.title,
        description: skill.description,
        priority: skill.priority,
        currentStatus: skill.currentStatus,
        prerequisites: skill.prerequisites
      })),
      prerequisiteSkills: goalSkillMap.prerequisiteSkills.map((skill) => ({
        title: skill.title,
        description: skill.description,
        priority: skill.priority,
        currentStatus: skill.currentStatus,
        prerequisites: skill.prerequisites
      })),
      skillGaps: goalSkillMap.skillGaps.map((skill) => ({
        title: skill.title,
        description: skill.description,
        priority: skill.priority,
        currentStatus: skill.currentStatus,
        prerequisites: skill.prerequisites
      }))
    },
    recentEvidence: planningContext.recentEvidence.slice(0, 6),
    broadConstraints: {
      readiness: planningContext.readiness,
      previousPlanSummary: previousPlan
        ? {
            objective: previousPlan.objective,
            targetSkills: previousPlan.targetSkills,
            weakSkills: previousPlan.weakSkills,
            revisionCount: previousPlan.revisionCount
          }
        : null
    }
  },
  context: {
    workspaceId: stateBundle.state.workspace.id,
    workbenchId: stateBundle.state.workbench?.id || undefined
  }
});

const normalizeCurriculumSkeleton = (
  raw: Partial<CurriculumSkeleton> | null | undefined,
  fallback: CurriculumSkeleton
): CurriculumSkeleton => {
  const stages = Array.isArray(raw?.stages) && raw?.stages.length ? raw.stages : fallback.stages;
  const normalizedStages = stages.slice(0, 8).map((stage, index): CurriculumSkeletonStage => ({
    id: clip(stage.id, 80) || stageIdFor(stage.title || fallback.stages[index]?.title || 'stage', index),
    title: clip(stage.title, 140) || fallback.stages[index]?.title || `学习阶段 ${index + 1}`,
    learningGoal: clip(stage.learningGoal, 280) || fallback.stages[index]?.learningGoal || '推进当前学习目标。',
    whyThisStage: clip(stage.whyThisStage, 360) || fallback.stages[index]?.whyThisStage || '该阶段符合目标技能的合理学习顺序。',
    targetSkills: asConceptArray(stage.targetSkills, fallback.stages[index]?.targetSkills || fallback.targetSkills, 5),
    prerequisites: asConceptArray(stage.prerequisites, fallback.stages[index]?.prerequisites || [], 5),
    recommendedOrder: asNumber(stage.recommendedOrder, index + 1, 1, 12),
    estimatedDifficulty: asNumber(stage.estimatedDifficulty, fallback.stages[index]?.estimatedDifficulty || 2, 1, 5),
    estimatedLoad: stage.estimatedLoad === 'light' || stage.estimatedLoad === 'heavy' ? stage.estimatedLoad : 'medium',
    idealActivities: asStringArray(stage.idealActivities, fallback.stages[index]?.idealActivities || ['导师讲解', '练习', '检查']).slice(0, 5),
    checks: asStringArray(stage.checks, fallback.stages[index]?.checks || ['完成阶段检查']).slice(0, 5),
    riskNotes: asStringArray(stage.riskNotes, fallback.stages[index]?.riskNotes || []).slice(0, 5),
    teachingPhase: clip(stage.teachingPhase || fallback.stages[index]?.teachingPhase, 80)
  }));

  return {
    objective: clip(raw?.objective, 280) || fallback.objective,
    learnerLevel:
      raw?.learnerLevel === 'novice' ||
      raw?.learnerLevel === 'beginner' ||
      raw?.learnerLevel === 'intermediate' ||
      raw?.learnerLevel === 'advanced' ||
      raw?.learnerLevel === 'unknown'
        ? raw.learnerLevel
        : fallback.learnerLevel,
    rationale: clip(raw?.rationale, 420) || fallback.rationale,
    broadConstraints: asStringArray(raw?.broadConstraints, fallback.broadConstraints).slice(0, 8),
    targetSkills: asConceptArray(raw?.targetSkills, fallback.targetSkills, 10),
    weakSignals: asConceptArray(raw?.weakSignals, fallback.weakSignals, 10),
    stages: normalizedStages.sort((left, right) => left.recommendedOrder - right.recommendedOrder),
    assumptions: asStringArray(raw?.assumptions, fallback.assumptions).slice(0, 8)
  };
};

const buildFallbackKgAudit = (skeleton: CurriculumSkeleton, kgHints: KgPlanningHints): KgConstraintAudit => {
  const warnings: KgConstraintAudit['warnings'] = [];
  const insertions: KgConstraintAudit['insertions'] = [];
  const stageTextById = new Map(
    skeleton.stages.map((stage) => [
      stage.id,
      [stage.title, stage.learningGoal, ...stage.targetSkills, ...stage.prerequisites].join(' ').toLowerCase()
    ] as const)
  );

  kgHints.riskJumps.slice(0, 8).forEach((jump) => {
    const [prerequisiteRaw, targetRaw] = jump.split('->').map((part) => clip(part, 120));
    const prerequisite = prerequisiteRaw || '';
    const target = targetRaw || '';
    if (!prerequisite && !target) return;
    const targetStage = skeleton.stages.find((stage) => {
      const text = stageTextById.get(stage.id) || '';
      return target ? text.includes(target.toLowerCase()) : stage.targetSkills.some((skill) => jump.includes(skill));
    }) || skeleton.stages.find((stage) => stage.teachingPhase !== 'diagnostic');
    const hasPrerequisiteStage = skeleton.stages.some((stage) => {
      const text = stageTextById.get(stage.id) || '';
      return prerequisite && text.includes(prerequisite.toLowerCase());
    });
    if (!hasPrerequisiteStage && targetStage) {
      warnings.push({
        stageId: targetStage.id,
        type: 'prerequisite_jump',
        message: `KG 提示可能存在前置跳跃：${jump}`,
        prerequisite,
        target
      });
      insertions.push({
        beforeStageId: targetStage.id,
        title: `KG 前置桥接：${prerequisite || target}`,
        learningGoal: prerequisite ? `先补齐 ${prerequisite}，再进入 ${target || '目标阶段'}。` : `先处理 ${jump} 的前置风险。`,
        targetSkills: [prerequisite || target].filter(Boolean),
        prerequisites: [],
        reason: `KG constraint audit detected ${jump}.`,
        estimatedDifficulty: Math.max(1, targetStage.estimatedDifficulty - 1)
      });
    }
  });

  kgHints.prerequisiteEdges.slice(0, 24).forEach((edge) => {
    const fromIndex = skeleton.stages.findIndex((stage) => {
      const text = stageTextById.get(stage.id) || '';
      return text.includes(edge.from.toLowerCase());
    });
    const toIndex = skeleton.stages.findIndex((stage) => {
      const text = stageTextById.get(stage.id) || '';
      return text.includes(edge.to.toLowerCase());
    });
    if (fromIndex >= 0 && toIndex >= 0 && fromIndex > toIndex) {
      warnings.push({
        stageId: skeleton.stages[toIndex].id,
        type: 'order_risk',
        message: `KG prerequisite order risk: ${edge.from} should come before ${edge.to}.`,
        prerequisite: edge.from,
        target: edge.to
      });
    }
  });

  return {
    verdict: warnings.length || insertions.length ? 'revise' : 'pass',
    warnings: warnings.slice(0, 10),
    insertions: insertions.slice(0, 4),
    reorderSuggestions: [],
    summary: warnings.length
      ? `KG audit found ${warnings.length} prerequisite/order warning(s); ${insertions.length} bridge stage(s) suggested.`
      : 'KG audit did not find high-confidence prerequisite jumps.'
  };
};

const buildKgAuditPrompt = (
  skeleton: CurriculumSkeleton,
  knowledgeGraph: KnowledgeGraphSnapshot,
  kgHints: KgPlanningHints
) => ({
  instruction: [
    'You are the KG Constraint Auditor in a curriculum-first tutor planning system.',
    'Audit the curriculum skeleton for prerequisite jumps and ordering risks using KG evidence.',
    'KG is a constraint and audit source only. Do not rewrite the whole learning path and do not make resources decide the path.',
    'If a jump exists, output small bridge insertions or reorder suggestions with reasons.',
    'Return JSON only.'
  ].join('\n'),
  schema: {
    verdict: 'pass | revise',
    warnings: [
      {
        stageId: 'string',
        type: 'prerequisite_jump | missing_bridge | order_risk | low_confidence',
        message: 'string',
        prerequisite: 'string',
        target: 'string'
      }
    ],
    insertions: [
      {
        beforeStageId: 'string',
        title: 'string',
        learningGoal: 'string',
        targetSkills: ['string'],
        prerequisites: ['string'],
        reason: 'string',
        estimatedDifficulty: 2
      }
    ],
    reorderSuggestions: [{ stageId: 'string', beforeStageId: 'string', afterStageId: 'string', reason: 'string' }],
    summary: 'string'
  },
  input: {
    skeleton,
    kgHints,
    knowledgeGraph: {
      nodes: knowledgeGraph.nodes.slice(0, 36),
      edges: knowledgeGraph.edges.filter((edge) => edge.relation === 'prerequisite').slice(0, 80)
    }
  }
});

const normalizeKgAudit = (
  raw: Partial<KgConstraintAudit> | null | undefined,
  fallback: KgConstraintAudit
): KgConstraintAudit => ({
  verdict: raw?.verdict === 'revise' || raw?.verdict === 'pass' ? raw.verdict : fallback.verdict,
  warnings: (Array.isArray(raw?.warnings) ? raw.warnings : fallback.warnings).slice(0, 12).map((warning) => ({
    stageId: clip(warning.stageId, 80),
    type:
      warning.type === 'missing_bridge' ||
      warning.type === 'order_risk' ||
      warning.type === 'low_confidence' ||
      warning.type === 'prerequisite_jump'
        ? warning.type
        : 'low_confidence',
    message: clip(warning.message, 240) || 'KG warning',
    prerequisite: clip(warning.prerequisite, 120),
    target: clip(warning.target, 120)
  })),
  insertions: (Array.isArray(raw?.insertions) ? raw.insertions : fallback.insertions).slice(0, 5).map((insertion) => ({
    beforeStageId: clip(insertion.beforeStageId, 80),
    title: clip(insertion.title, 140) || '补充前置桥接',
    learningGoal: clip(insertion.learningGoal, 280) || '补齐进入后续阶段所需的前置知识。',
    targetSkills: asConceptArray(insertion.targetSkills, [], 5),
    prerequisites: asConceptArray(insertion.prerequisites, [], 5),
    reason: clip(insertion.reason, 240) || 'KG prerequisite audit suggested a bridge stage.',
    estimatedDifficulty: asNumber(insertion.estimatedDifficulty, 2, 1, 5)
  })),
  reorderSuggestions: (Array.isArray(raw?.reorderSuggestions) ? raw.reorderSuggestions : fallback.reorderSuggestions).slice(0, 5).map((item) => ({
    stageId: clip(item.stageId, 80),
    beforeStageId: clip(item.beforeStageId, 80),
    afterStageId: clip(item.afterStageId, 80),
    reason: clip(item.reason, 220)
  })),
  summary: clip(raw?.summary, 300) || fallback.summary
});

const applyKgAuditToSkeleton = (skeleton: CurriculumSkeleton, audit: KgConstraintAudit): CurriculumSkeleton => {
  if (!audit.insertions.length && !audit.reorderSuggestions.length) return skeleton;
  const stages = [...skeleton.stages];
  audit.insertions.forEach((insertion, insertionIndex) => {
    const beforeIndex = insertion.beforeStageId
      ? stages.findIndex((stage) => stage.id === insertion.beforeStageId)
      : -1;
    const stage: CurriculumSkeletonStage = {
      id: stageIdFor(insertion.title, stages.length + insertionIndex),
      title: insertion.title,
      learningGoal: insertion.learningGoal,
      whyThisStage: `KG 只作为约束审计：${insertion.reason}`,
      targetSkills: insertion.targetSkills.length ? insertion.targetSkills : ['前置桥接'],
      prerequisites: insertion.prerequisites,
      recommendedOrder: beforeIndex >= 0 ? stages[beforeIndex].recommendedOrder - 0.5 : stages.length + 1,
      estimatedDifficulty: insertion.estimatedDifficulty || 2,
      estimatedLoad: 'light',
      idealActivities: ['前置概念讲解', '最小确认练习', '进入下一阶段前的口头复述'],
      checks: ['能说明该前置知识为什么支持后续目标', '完成一个低风险确认题'],
      riskNotes: [`KG warning: ${insertion.reason}`],
      teachingPhase: 'prerequisite_bridge'
    };
    if (beforeIndex >= 0) stages.splice(beforeIndex, 0, stage);
    else stages.push(stage);
  });
  return {
    ...skeleton,
    stages: stages.map((stage, index) => ({ ...stage, recommendedOrder: index + 1 })),
    assumptions: [...skeleton.assumptions, audit.summary].slice(0, 10)
  };
};

const scoreStageResourceMatch = (
  stage: CurriculumSkeletonStage,
  unit: ResourceLearningUnit,
  diagnostic: LearnerDiagnosticReport
): LearningPlanResourceMatch => {
  const haystack = [unit.title, unit.summary, unit.resourceTitle, ...unit.teaches, ...unit.prerequisites, ...unit.evidenceSnippets]
    .join(' ')
    .toLowerCase();
  const skillTerms = [...stage.targetSkills, ...stage.prerequisites].flatMap((skill) =>
    skill
      .toLowerCase()
      .split(/\s+|、|，|,|\/|-|：|:/)
      .filter((part) => part.length >= 2)
  );
  const exactHits = [...stage.targetSkills, ...stage.prerequisites].filter((skill) => haystack.includes(skill.toLowerCase())).length;
  const tokenHits = skillTerms.filter((term) => haystack.includes(term)).length;
  const lexicalRelevance = clamp01((exactHits * 0.25 + tokenHits * 0.08) / Math.max(stage.targetSkills.length + stage.prerequisites.length, 1));
  const fit = inferLearnerFit(diagnostic, unit, stage);
  const phaseBonus =
    stage.teachingPhase === 'formative_assessment' && (unit.modality === 'quiz' || unit.modality === 'practice')
      ? 0.12
      : stage.teachingPhase === 'guided_practice' && unit.modality === 'practice'
        ? 0.12
        : stage.teachingPhase === 'concept_model' && (unit.modality === 'read' || unit.modality === 'watch' || unit.modality === 'mixed')
          ? 0.08
          : 0;
  const relevance = clamp01(fit.relevance * 0.55 + lexicalRelevance * 0.45 + phaseBonus);
  const matchScore = clamp01(relevance * 0.42 + fit.difficultyFit * 0.2 + fit.prerequisiteFit * 0.18 + fit.learnerFit * 0.2);

  return {
    resourceId: unit.resourceId,
    resourceTitle: unit.resourceTitle,
    resourceUnitId: unit.id,
    resourceUnitTitle: unit.title,
    resourceLocator: unit.locator,
    resourceEntryPoint: unit.entryPoint,
    modality: unit.modality,
    difficulty: unit.difficulty,
    estimatedMinutes: unit.estimatedMinutes,
    matchScore: Number(matchScore.toFixed(2)),
    scoreBreakdown: {
      relevance: Number(relevance.toFixed(2)),
      difficultyFit: Number(fit.difficultyFit.toFixed(2)),
      prerequisiteFit: Number(fit.prerequisiteFit.toFixed(2)),
      learnerFit: Number(fit.learnerFit.toFixed(2))
    },
    reason: `匹配 ${stage.title}：relevance=${relevance.toFixed(2)}, difficultyFit=${fit.difficultyFit.toFixed(2)}, learnerFit=${fit.learnerFit.toFixed(2)}。`
  };
};

const buildResourceGroundingResult = (
  skeleton: CurriculumSkeleton,
  units: ResourceLearningUnit[],
  resources: LearningPlanResource[],
  diagnostic: LearnerDiagnosticReport
): ResourceGroundingResult => {
  const candidateUnits = units.length
    ? units
    : resources.map((resource, index): ResourceLearningUnit => ({
        id: `candidate-resource-${resource.id || index + 1}`,
        resourceId: resource.id,
        resourceTitle: resource.title,
        resourceType: resource.type,
        title: resource.title,
        summary: resource.summary,
        teaches: [resource.title, resource.citationLabel].filter(Boolean) as string[],
        prerequisites: [],
        difficulty: resource.difficulty,
        estimatedMinutes: resource.estimatedMinutes,
        modality: resource.type === 'quiz' ? 'quiz' : resource.type === 'exercise' ? 'practice' : 'mixed',
        evidenceSnippets: [resource.summary].filter(Boolean),
        relevanceScore: resource.relevanceScore,
        source: 'fallback'
      }));

  const stageGroundings = skeleton.stages.map((stage): StageResourceGrounding => {
    const scored = candidateUnits
      .map((unit) => scoreStageResourceMatch(stage, unit, diagnostic))
      .filter((match) => match.matchScore >= 0.48)
      .sort((left, right) => right.matchScore - left.matchScore)
      .slice(0, 3);
    const topScore = scored[0]?.matchScore || 0;
    const status: ResourceGroundingStatus = topScore >= 0.68 ? 'grounded' : topScore >= 0.56 ? 'partial' : 'resource_gap';
    if (status === 'resource_gap') {
      return {
        stageId: stage.id,
        status,
        matches: [],
        gapReason: `没有找到与「${stage.learningGoal}」足够相关且难度适配的 workspace 资源。`,
        neededResource: `${stageDifficultyBand(stage)} difficulty material for ${stage.targetSkills.slice(0, 3).join(', ') || stage.title}`,
        warnings: ['resource_gap_marked_instead_of_forcing_irrelevant_resource']
      };
    }
    return {
      stageId: stage.id,
      status,
      matches: scored,
      gapReason: status === 'partial' ? '只有部分匹配资源，需要导师补充讲解或生成临时材料。' : undefined,
      neededResource: status === 'partial' ? `${stage.targetSkills.slice(0, 3).join(', ')} 的更精确材料或练习` : undefined,
      warnings: status === 'partial' ? ['partial_resource_grounding'] : []
    };
  });

  const gaps = stageGroundings.filter((grounding) => grounding.status === 'resource_gap');
  return {
    stageGroundings,
    gaps,
    summary: `grounded=${stageGroundings.filter((item) => item.status === 'grounded').length}, partial=${stageGroundings.filter((item) => item.status === 'partial').length}, gaps=${gaps.length}`
  };
};

const stageTypeFor = (stage: CurriculumSkeletonStage, index: number): LearningPlanStepType => {
  const phase = String(stage.teachingPhase || '').toLowerCase();
  if (phase === 'diagnostic') return 'diagnose';
  if (phase === 'formative_assessment') return 'quiz';
  if (phase === 'reflection') return 'reflect';
  if (phase === 'guided_practice' || phase === 'independent_practice') return 'practice';
  if (phase === 'worked_example' || phase === 'concept_model' || phase === 'prerequisite_bridge') return 'explain';
  if (index === 0) return 'diagnose';
  if (/测|检测|quiz|assessment/i.test(stage.title)) return 'quiz';
  if (/练习|practice/i.test(stage.title)) return 'practice';
  return 'explain';
};

const composeDraftFromCurriculum = (
  skeleton: CurriculumSkeleton,
  grounding: ResourceGroundingResult,
  audit: KgConstraintAudit,
  diagnostic: LearnerDiagnosticReport
): PlannerPathDraft => {
  const groundingByStage = new Map(grounding.stageGroundings.map((item) => [item.stageId, item] as const));
  const steps = skeleton.stages.map((stage, index): DraftPlannerStep => {
    const stageGrounding = groundingByStage.get(stage.id);
    const primary = stageGrounding?.matches[0];
    const groundingStatus = stageGrounding?.status || 'resource_gap';
    const curriculumDecision: LearningPlanCurriculumDecision = {
      learningGoal: stage.learningGoal,
      whyThisStage: stage.whyThisStage,
      idealActivities: stage.idealActivities,
      prerequisiteAssumptions: stage.prerequisites,
      difficultyRationale: `Ideal curriculum difficulty ${stage.estimatedDifficulty}/5 before resource grounding.`
    };
    const resourceGrounding: LearningPlanResourceGrounding = {
      status: groundingStatus,
      matches: stageGrounding?.matches || [],
      gapReason: stageGrounding?.gapReason,
      neededResource: stageGrounding?.neededResource,
      warnings: stageGrounding?.warnings
    };
    return {
      type: stageTypeFor(stage, index),
      title: stage.title,
      rationale: [
        `课程决策：${stage.whyThisStage}`,
        primary ? `资源落地：${primary.reason}` : `资源落地：${stageGrounding?.gapReason || '未找到可靠资源，标记 resource_gap。'}`
      ].join(' '),
      targetSkills: stage.targetSkills,
      prerequisites: stage.prerequisites,
      estimatedLoad: stage.estimatedLoad,
      expectedEvidence: stage.checks,
      activities: stage.idealActivities,
      suggestedCapability: mapStepTypeToCapability(stageTypeFor(stage, index)),
      artifactType: mapStepTypeToArtifact(stageTypeFor(stage, index)),
      concept: stage.targetSkills[0],
      resourceId: primary?.resourceId,
      resourceTitle: primary?.resourceTitle,
      resourceUnitId: primary?.resourceUnitId,
      resourceUnitTitle: primary?.resourceUnitTitle,
      resourceLocator: primary?.resourceLocator,
      resourceEntryPoint: primary?.resourceEntryPoint,
      resourceReason: primary?.reason || stageGrounding?.gapReason,
      resourceOptions: stageGrounding?.matches || [],
      curriculumDecision,
      resourceGrounding,
      groundingStatus,
      resourceMatchScore: primary?.matchScore,
      resourceGapReason: stageGrounding?.gapReason,
      difficulty: stage.estimatedDifficulty,
      estimatedMinutes: primary?.estimatedMinutes || (stage.estimatedLoad === 'heavy' ? 35 : stage.estimatedLoad === 'medium' ? 22 : 12),
      teachingPhase: stage.teachingPhase || mapStepTypeToTeachingPhase(stageTypeFor(stage, index), index, Boolean(primary)),
      evidenceType: mapStepTypeToEvidenceType(stageTypeFor(stage, index)),
      successCriteria: stage.checks,
      unlockCondition: stage.prerequisites.length ? `先确认：${stage.prerequisites.slice(0, 3).join('、')}` : '完成上一阶段检查后进入。',
      qualitySignals: [
        'curriculum_first_decision',
        `grounding:${groundingStatus}`,
        primary ? `matchScore:${primary.matchScore}` : 'resource_gap',
        ...audit.warnings.filter((warning) => warning.stageId === stage.id).map((warning) => `kg:${warning.type}`)
      ].slice(0, 8),
      riskNotes: [
        ...stage.riskNotes,
        ...(stageGrounding?.warnings || []),
        ...audit.warnings.filter((warning) => warning.stageId === stage.id).map((warning) => warning.message)
      ].slice(0, 6)
    };
  });

  if (!steps.some((step) => step.type === 'reflect')) {
    steps.push({
      type: 'reflect',
      title: '复盘资源落地与下一轮路径',
      rationale: '区分理想课程决策和 workspace resource grounding 后，必须根据学习证据决定下一轮是否补资源、降难度或加深。',
      targetSkills: skeleton.targetSkills.slice(0, 4),
      prerequisites: ['完成形成性检测或至少一个阶段检查'],
      estimatedLoad: 'light',
      expectedEvidence: ['形成下一轮路径调整依据'],
      activities: ['复盘掌握证据', '检查 resource_gap 是否需要补材料', '决定下一步加深/回退/换资源'],
      suggestedCapability: 'reflection',
      concept: skeleton.targetSkills[0],
      difficulty: Math.max(1, diagnostic.recommendedDifficultyBand.min),
      estimatedMinutes: 10,
      teachingPhase: 'reflection',
      evidenceType: 'reflection_note',
      successCriteria: ['明确下一轮路径动作', '记录至少一个保留或调整理由'],
      unlockCondition: '已有阶段检查或学习反馈。',
      qualitySignals: ['curriculum_first_decision', 'reflection_loop']
    });
  }

  return {
    objective: skeleton.objective,
    rationale: `${skeleton.rationale} Final composition keeps ideal curriculum decisions separate from workspace resource grounding. ${grounding.summary}`,
    assumptions: [
      ...skeleton.assumptions,
      'Final Tutor Plan Composition explicitly separates curriculum decisions from resource matches and resource gaps.',
      audit.summary
    ].filter(Boolean).slice(0, 10),
    constraints: [
      ...skeleton.broadConstraints,
      'Resource Grounding Pass may mark resource_gap rather than force an unrelated resource.',
      'KG warnings audit prerequisite risks but do not author the full path.'
    ].slice(0, 10),
    targetSkills: skeleton.targetSkills,
    weakSkills: skeleton.weakSignals,
    milestones: skeleton.stages.slice(0, 5).map((stage) => ({
      title: stage.title,
      description: stage.learningGoal,
      successCriteria: stage.checks
    })),
    steps: steps.slice(0, 10),
    adaptationPolicy: {
      replanTriggers: [
        'resource_gap blocks a key curriculum stage',
        'diagnostic or quiz evidence contradicts learner level assumptions',
        'new high-relevance workspace resource appears',
        'KG audit finds new prerequisite jump'
      ],
      progressionSignals: ['stage checks pass', 'resource match score remains adequate', 'weak skill evidence improves'],
      fallbackActions: ['mark resource_gap and generate support material', 'insert prerequisite bridge', 'reduce difficulty and split stage']
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
  const teachableSteps = steps.filter((step) => !['diagnose', 'reflect'].includes(step.type));
  const groundedSteps = teachableSteps.filter((step) => step.resourceUnitId || step.resourceId);
  const resourceGroundingScore = teachableSteps.length ? groundedSteps.length / teachableSteps.length : 0.65;
  const phaseOrder = ['diagnostic', 'prerequisite_bridge', 'resource_grounding', 'concept_model', 'worked_example', 'guided_practice', 'independent_practice', 'formative_assessment', 'reflection'];
  const phaseIndexes = steps.map((step, index) => {
    const phase = step.teachingPhase || mapStepTypeToTeachingPhase(step.type, index, Boolean(step.resourceUnitId || step.resourceId));
    const phaseIndex = phaseOrder.indexOf(phase);
    return phaseIndex >= 0 ? phaseIndex : index;
  });
  const inversions = phaseIndexes.filter((value, index) => index > 0 && value < phaseIndexes[index - 1]).length;
  const sequencingScore = Math.max(0, Math.min(1, 1 - inversions * 0.18 - (!hasDiagnose ? 0.18 : 0)));
  const assessmentScore = Math.max(0, Math.min(1, (hasDiagnose ? 0.28 : 0) + (steps.some((step) => step.type === 'quiz') ? 0.36 : 0) + (steps.some((step) => step.type === 'reflect') ? 0.26 : 0) + 0.1));
  const successCriteriaScore = steps.length
    ? steps.filter((step) => Array.isArray(step.successCriteria) && step.successCriteria.length > 0).length / steps.length
    : 0.5;
  const pedagogyScore = Math.max(0, Math.min(1, (
    cltScore * 0.18 +
    zpdScore * 0.18 +
    alignmentScore * 0.16 +
    resourceGroundingScore * 0.18 +
    sequencingScore * 0.16 +
    assessmentScore * 0.1 +
    successCriteriaScore * 0.04
  )));
  const confidence = Math.max(0.3, Math.min(0.95, 0.48 + pedagogyScore * 0.35 + (suggestions.length === 0 ? 0.12 : -0.08)));

  return {
    cltScore: Number(cltScore.toFixed(2)),
    zpdScore: Number(zpdScore.toFixed(2)),
    alignmentScore: Number(alignmentScore.toFixed(2)),
    pedagogyScore: Number(pedagogyScore.toFixed(2)),
    resourceGroundingScore: Number(resourceGroundingScore.toFixed(2)),
    sequencingScore: Number(sequencingScore.toFixed(2)),
    assessmentScore: Number(assessmentScore.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    summary:
      pedagogyScore >= 0.72
        ? '当前路径具备较好的教学顺序、资源 grounding 与反馈闭环。'
        : '当前路径仍存在教学顺序、资源 grounding 或反馈闭环上的调整空间。'
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

  const teachableSteps = draft.steps.filter((step) => !['diagnose', 'reflect'].includes(step.type));
  const ungroundedSteps = teachableSteps.filter((step) => !step.resourceUnitId && !step.resourceId && step.groundingStatus !== 'resource_gap');
  if (teachableSteps.length && ungroundedSteps.length / teachableSteps.length > 0.45) {
    suggestions.push({
      type: 'strengthen_resource_grounding',
      reason: '过多学习步骤既没有绑定具体资源，也没有诚实标记 resource_gap。',
      action: '为 explain/practice/quiz 步骤绑定最相关 ResourceLearningUnit；没有可靠资源时必须标记 resource_gap。'
    });
  }

  const hasConceptBeforePractice = draft.steps.findIndex((step) => step.type === 'explain') >= 0
    && draft.steps.findIndex((step) => step.type === 'practice') >= 0
    && draft.steps.findIndex((step) => step.type === 'explain') < draft.steps.findIndex((step) => step.type === 'practice');
  if (!hasConceptBeforePractice && draft.steps.some((step) => step.type === 'practice')) {
    suggestions.push({
      type: 'add_scaffold',
      reason: '练习前缺少明确概念建模或 worked example，可能让学习者直接跳到操作层。',
      action: '在 practice 之前插入 concept_model 或 worked_example 步骤。'
    });
  }

  if (draft.steps.some((step) => !step.successCriteria?.length)) {
    suggestions.push({
      type: 'tighten_success_criteria',
      reason: '部分步骤缺少可判定成功标准，后续无法稳定评估和重规划。',
      action: '为每个步骤补充 1-3 条可观察 successCriteria。'
    });
  }

  const constraintScores = buildFallbackConstraintScores(diagnostic, draft.steps, suggestions);
  const needsRevise = suggestions.length > 0 || constraintScores.cltScore < 0.6 || constraintScores.zpdScore < 0.6 || Number(constraintScores.pedagogyScore || 0) < 0.68;

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
    pedagogyAnalysis: '从资源 grounding、前置顺序、技能覆盖和反馈闭环四个维度检查路径是否像导师规划。',
    strengths: ['路径具备阶段性里程碑', '步骤与目标技能存在显式对应'],
    risks: suggestions.map((item) => item.reason).slice(0, 4),
    suggestions,
    constraintScores,
    rubric: {
      resourceGrounding: ungroundedSteps.length ? '部分步骤缺少具体资源学习单元。' : '关键步骤已绑定资源或资源单元。',
      prerequisiteSequencing: hasConceptBeforePractice ? '概念建模位于练习之前。' : '需要增强练习前的 scaffold。',
      skillCoverage: draft.targetSkills.length ? '路径覆盖了主要目标技能。' : '目标技能覆盖不足。',
      assessmentLoop: draft.steps.some((step) => step.type === 'quiz' || step.type === 'reflect') ? '存在形成性评估或反思闭环。' : '缺少评估闭环。',
      personalization: diagnostic.learnerLevel !== 'unknown' ? '路径考虑了学习者层级和负荷。' : '学习者画像仍不足。'
    }
  };
};

const buildFallbackReflectionForCurriculum = (
  round: number,
  diagnostic: LearnerDiagnosticReport,
  draft: PlannerPathDraft
): ReflectionResponse => {
  const response = buildFallbackReflection(round, diagnostic, draft);
  return {
    ...response,
    pedagogyAnalysis: 'Reflection now audits curriculum-first sequencing, KG warnings, and honesty of resource gaps rather than forcing resource coverage.'
  };
};

const applyRevisionSuggestions = (
  draft: PlannerPathDraft,
  suggestions: ReflectionRevisionSuggestion[],
  diagnostic: LearnerDiagnosticReport,
  resources: LearningPlanResource[],
  planningContext?: PlanningContextBundle
): PlannerPathDraft => {
  const revisedSteps = [...draft.steps];
  const resourceUnits = planningContext?.resourceLearningUnits || [];
  const firstUnit = resourceUnits[0];
  const bindUnit = (step: DraftPlannerStep, preferredIndex = 0) => {
    const unit = resourceUnits.find((candidate) =>
      step.targetSkills.some((skill) => {
        const haystack = [candidate.title, candidate.summary, candidate.resourceTitle, ...candidate.teaches].join(' ').toLowerCase();
        const normalized = skill.toLowerCase();
        return haystack.includes(normalized) || normalized.split(/\s+|、|，|,|\/|-/).some((part) => part.length >= 2 && haystack.includes(part));
      })
    ) || resourceUnits[preferredIndex] || firstUnit;
    if (!unit) return;
    step.resourceId = step.resourceId || unit.resourceId;
    step.resourceTitle = step.resourceTitle || unit.resourceTitle;
    step.resourceUnitId = step.resourceUnitId || unit.id;
    step.resourceUnitTitle = step.resourceUnitTitle || unit.title;
    step.resourceLocator = step.resourceLocator || unit.locator;
    step.resourceEntryPoint = step.resourceEntryPoint || unit.entryPoint;
    step.resourceReason = step.resourceReason || `根据 Pedagogy Critic 建议，绑定到学习单元 "${unit.title}"。`;
    step.difficulty = step.difficulty || unit.difficulty;
    step.estimatedMinutes = step.estimatedMinutes || unit.estimatedMinutes;
  };

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
        estimatedMinutes: 10,
        teachingPhase: 'diagnostic',
        evidenceType: 'diagnostic_signal',
        successCriteria: successCriteriaForStep('diagnose', diagnostic.weakSkills),
        unlockCondition: '确认当前基线后再进入资源学习。'
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
        resourceTitle: resources[0]?.title,
        difficulty: Math.max(diagnostic.recommendedDifficultyBand.min, 2),
        estimatedMinutes: 12,
        teachingPhase: 'formative_assessment',
        evidenceType: 'quiz_result',
        successCriteria: successCriteriaForStep('quiz', draft.targetSkills),
        unlockCondition: '完成主学习步骤后执行。'
      });
      bindUnit(revisedSteps[revisedSteps.length - 1], 0);
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

    if (suggestion.type === 'strengthen_resource_grounding') {
      revisedSteps.forEach((step, index) => {
        if (!['diagnose', 'reflect'].includes(step.type) && !step.resourceUnitId && !step.resourceId) bindUnit(step, index);
      });
    }

    if (suggestion.type === 'add_scaffold' && revisedSteps.some((step) => step.type === 'practice') && !revisedSteps.some((step) => step.type === 'explain')) {
      const practiceIndex = revisedSteps.findIndex((step) => step.type === 'practice');
      const scaffold: DraftPlannerStep = {
        type: 'explain',
        title: '补充概念建模与例题拆解',
        rationale: '在练习前先建立概念模型和 worked example，避免直接跳到操作。',
        targetSkills: draft.targetSkills.slice(0, 2),
        prerequisites: diagnostic.prerequisiteGaps.slice(0, 2),
        estimatedLoad: 'light',
        expectedEvidence: ['形成概念解释和一个例题拆解'],
        suggestedCapability: 'reflection',
        concept: draft.targetSkills[0],
        difficulty: Math.max(diagnostic.recommendedDifficultyBand.min, 2),
        estimatedMinutes: 15,
        teachingPhase: 'concept_model',
        evidenceType: 'concept_explanation',
        successCriteria: successCriteriaForStep('explain', draft.targetSkills),
        unlockCondition: '讲清概念并完成例题拆解后进入练习。'
      };
      bindUnit(scaffold, 0);
      revisedSteps.splice(Math.max(0, practiceIndex), 0, scaffold);
    }

    if (suggestion.type === 'tighten_success_criteria') {
      revisedSteps.forEach((step) => {
        if (!step.successCriteria?.length) {
          step.successCriteria = successCriteriaForStep(step.type, step.targetSkills, step.resourceUnitTitle || step.resourceTitle);
        }
        step.evidenceType = step.evidenceType || mapStepTypeToEvidenceType(step.type);
        step.teachingPhase = step.teachingPhase || mapStepTypeToTeachingPhase(step.type, 0, Boolean(step.resourceUnitId || step.resourceId));
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
  resources: LearningPlanResource[],
  planningContext: PlanningContextBundle,
  goalSkillMap: GoalSkillMap
) => ({
  instruction: [
    'You are the Learner Analytics Agent in a MALPP-style adaptive learning system.',
    'Produce a learner diagnostic report that summarizes current level, prerequisite gaps, weak skills, preferred resource forms, time budget, cognitive load tolerance, and recommended difficulty band.',
    'Use the available learner profile, traces, goal, resources, planning context, and goal skill map.',
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
    eventDiagnostics: stateBundle.state.eventDiagnostics,
    readiness: stateBundle.state.readiness,
    candidateResources: resources,
    planningContext,
    goalSkillMap
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
  planningContext: PlanningContextBundle,
  goalSkillMap: GoalSkillMap,
  previousPlan?: LearningPlan | null,
  revisionContext?: ReflectionReview[]
) => ({
  instruction: [
    'You are the Tutor Path Composer in a MALPP-style adaptive learning system.',
    'Generate a human-tutor-style personalized learning path, not a generic checklist.',
    'Use this reasoning order: learner state -> objective -> target/prerequisite skills -> resource learning units -> step sequence -> evidence loop.',
    'Prefer the following tutor sequence when applicable: diagnostic -> prerequisite_bridge -> resource_grounding -> concept_model -> worked_example -> guided_practice -> formative_assessment -> reflection.',
    'Every non-diagnostic learning step should bind to the most concrete ResourceLearningUnit possible, using resourceUnitId/resourceUnitTitle/resourceLocator/resourceEntryPoint.',
    'KG is only a constraint provider: use kgHints for prerequisite warnings and order hints, but do not let KG write the final plan.',
    'Respect CLT and ZPD: keep difficulty progression gradual, insert prerequisite support when needed, and explain why each step comes now.',
    'Each step must specify concept, teachingPhase, evidenceType, successCriteria, unlockCondition, concrete resource binding when possible, why-now reason, difficulty, and estimated time.',
    'Do not output a pure concept checklist. Prefer tutor-like phases grounded in workbench resource learning units.',
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
        resourceTitle: 'string',
        resourceUnitId: 'string',
        resourceUnitTitle: 'string',
        resourceLocator: {},
        resourceEntryPoint: 'string',
        resourceReason: 'string',
        difficulty: 1,
        estimatedMinutes: 20,
        teachingPhase: 'diagnostic | prerequisite_bridge | resource_grounding | concept_model | worked_example | guided_practice | independent_practice | formative_assessment | reflection | project_application',
        evidenceType: 'diagnostic_signal | concept_explanation | worked_solution | practice_attempt | quiz_result | reflection_note | project_artifact | resource_trace',
        successCriteria: ['string'],
        unlockCondition: 'string',
        qualitySignals: ['string']
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
    planningContext: {
      ...planningContext,
      resourceLearningUnits: planningContext.resourceLearningUnits.slice(0, 24)
    },
    goalSkillMap,
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
  knowledgeGraph: KnowledgeGraphSnapshot,
  planningContext: PlanningContextBundle,
  goalSkillMap: GoalSkillMap
) => ({
  instruction: [
    'You are the Pedagogy Critic in a MALPP-style adaptive learning system.',
    'Review the proposed learning path and decide whether it passes or must be revised.',
    'Evaluate the path using CLT, ZPD, resource grounding, prerequisite sequencing, skill coverage, assessment loop quality, and personalization quality.',
    'CLT: detect overload, overly dense sequencing, or steps that are too demanding for the learner profile.',
    'ZPD: check whether the path starts from the learner current ability and progresses with suitable challenge and prerequisite support.',
    'Resource grounding: verify that key steps bind to concrete ResourceLearningUnits rather than vague files.',
    'Sequencing: verify the path has a tutor-like progression and does not skip prerequisite bridges.',
    'Assessment loop: verify there is a diagnostic or formative assessment step and a reflection step.',
    'If revision is needed, provide concrete suggestions that improve teaching quality, not just compliance.',
    'Return JSON only.'
  ].join('\n'),
  schema: {
    verdict: 'pass | revise',
    summary: 'string',
    cltAnalysis: 'string',
    zpdAnalysis: 'string',
    pedagogyAnalysis: 'string',
    strengths: ['string'],
    risks: ['string'],
    suggestions: [
      {
        type: 'reduce_load | increase_challenge | insert_prerequisite | reorder_steps | replace_resource | add_assessment | narrow_scope | strengthen_resource_grounding | add_scaffold | tighten_success_criteria',
        reason: 'string',
        targetStepId: 'string',
        action: 'string'
      }
    ],
    constraintScores: {
      cltScore: 0.8,
      zpdScore: 0.7,
      alignmentScore: 0.8,
      pedagogyScore: 0.75,
      resourceGroundingScore: 0.75,
      sequencingScore: 0.75,
      assessmentScore: 0.75,
      confidence: 0.8,
      summary: 'string'
    },
    rubric: {
      resourceGrounding: 'string',
      prerequisiteSequencing: 'string',
      skillCoverage: 'string',
      assessmentLoop: 'string',
      personalization: 'string'
    }
  },
  input: {
    round,
    learnerDiagnostic: diagnostic,
    draftPlan: draft,
    candidateResources: resources,
    knowledgeGraph,
    planningContext: {
      objective: planningContext.objective,
      learner: planningContext.learner,
      activeGoal: planningContext.activeGoal,
      resourceLearningUnits: planningContext.resourceLearningUnits.slice(0, 18),
      kgHints: planningContext.kgHints,
      recentEvidence: planningContext.recentEvidence.slice(0, 8)
    },
    goalSkillMap
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
      const resourceTitle = clip(item.resourceTitle, 120);
      const resourceUnitTitle = clip(item.resourceUnitTitle, 120);
      const teachingPhase = clip(item.teachingPhase, 80) as any;
      const evidenceType = clip(item.evidenceType, 80) as any;
      const successCriteria = asStringArray(item.successCriteria, []).slice(0, 5);
      const qualitySignals = asStringArray(item.qualitySignals, []);
      const resourceGroundingSignals = buildQualitySignals(item, resourceUnitTitle || resourceTitle);
      const readableRationale =
        clip(item.rationale, 280) ||
        clip(item.curriculumDecision?.whyThisStage, 280) ||
        `这一步聚焦 ${asConceptArray(item.targetSkills, ['当前目标'], 2).join('、')}，完成后再进入下一段学习。`;

        return {
          id: `step-${index + 1}`,
          type,
          title: clip(item.title, 120) || `步骤 ${index + 1}`,
          rationale: readableRationale,
          stepDetail: item.stepDetail,
          learningGoal: clip(item.curriculumDecision?.learningGoal, 280),
          whyThisStage: clip(item.curriculumDecision?.whyThisStage, 280),
        targetSkills: asConceptArray(item.targetSkills, ['核心理解'], 5),
        prerequisites: asConceptArray(item.prerequisites, [], 5),
        estimatedLoad: item.estimatedLoad === 'light' || item.estimatedLoad === 'heavy' ? item.estimatedLoad : 'medium',
        expectedEvidence: asStringArray(item.expectedEvidence, ['得到可用于后续判断的学习证据']).slice(0, 5),
        activities: asStringArray(item.activities, []).slice(0, 6),
        suggestedCapability: clip(item.suggestedCapability || mapStepTypeToCapability(type), 80),
        artifactType: clip(item.artifactType || mapStepTypeToArtifact(type), 80),
        teachingPhase: teachingPhase || mapStepTypeToTeachingPhase(type, index, Boolean(item.resourceUnitId || item.resourceId)),
        concept: clip(item.concept, 80),
        resourceId: clip(item.resourceId, 80),
        resourceTitle,
        resourceUnitId: clip(item.resourceUnitId, 80),
        resourceUnitTitle,
        resourceLocator: item.resourceLocator && typeof item.resourceLocator === 'object' ? item.resourceLocator : undefined,
        resourceEntryPoint: clip(item.resourceEntryPoint, 120),
        resourceReason: clip(item.resourceReason, 180),
        resourceOptions: Array.isArray(item.resourceOptions) ? item.resourceOptions.slice(0, 3) : undefined,
        curriculumDecision: item.curriculumDecision,
        resourceGrounding: item.resourceGrounding,
        groundingStatus: item.groundingStatus,
        resourceMatchScore: typeof item.resourceMatchScore === 'number' ? Number(item.resourceMatchScore.toFixed(2)) : undefined,
        resourceGapReason: clip(item.resourceGapReason, 220),
        difficulty: asNumber(item.difficulty, type === 'diagnose' ? 1 : 3, 1, 5),
        estimatedMinutes: asNumber(item.estimatedMinutes, type === 'diagnose' ? 10 : 15, 5, 180),
        evidenceType: evidenceType || mapStepTypeToEvidenceType(type),
        successCriteria: successCriteria.length ? successCriteria : successCriteriaForStep(type, asConceptArray(item.targetSkills, ['核心理解'], 5), resourceUnitTitle || resourceTitle),
        unlockCondition: clip(item.unlockCondition, 160),
        qualitySignals: [...resourceGroundingSignals, ...qualitySignals].slice(0, 8),
        riskNotes: asStringArray(item.riskNotes, []).slice(0, 6),
        status: index === 0 ? 'active' : 'pending'
      };
    }
  );

const normalizePathDraft = (raw: Partial<PlannerPathDraft> | null | undefined, fallback: PlannerPathDraft): PlannerPathDraft => ({
  objective: clip(raw?.objective, 280) || fallback.objective,
  rationale: clip(raw?.rationale, 400) || fallback.rationale,
  assumptions: asStringArray(raw?.assumptions, fallback.assumptions).slice(0, 8),
  constraints: asStringArray(raw?.constraints, fallback.constraints).slice(0, 8),
  targetSkills: asConceptArray(raw?.targetSkills, fallback.targetSkills, 8),
  weakSkills: asConceptArray(raw?.weakSkills, fallback.weakSkills, 8),
  milestones: Array.isArray(raw?.milestones) && raw?.milestones.length ? raw.milestones.slice(0, 6) : fallback.milestones,
  steps:
    Array.isArray(raw?.steps) && raw?.steps.length
      ? raw.steps.slice(0, 10).map((step) => ({
          type: inferStepType(step.type || 'practice'),
          title: clip(step.title, 120) || '学习步骤',
          rationale: clip(step.rationale, 220) || '围绕当前目标执行该学习动作。',
          targetSkills: asConceptArray(step.targetSkills, ['核心理解'], 5),
          prerequisites: asConceptArray(step.prerequisites, [], 5),
          estimatedLoad: step.estimatedLoad === 'light' || step.estimatedLoad === 'heavy' ? step.estimatedLoad : 'medium',
          expectedEvidence: asStringArray(step.expectedEvidence, ['得到阶段性证据']).slice(0, 5),
          suggestedCapability: clip(step.suggestedCapability, 80),
          artifactType: clip(step.artifactType, 80),
          concept: clip(step.concept, 80),
        resourceId: clip(step.resourceId, 80),
        resourceTitle: clip(step.resourceTitle, 120),
        resourceUnitId: clip(step.resourceUnitId, 80),
        resourceUnitTitle: clip(step.resourceUnitTitle, 120),
        resourceLocator: step.resourceLocator && typeof step.resourceLocator === 'object' ? step.resourceLocator : undefined,
        resourceEntryPoint: clip(step.resourceEntryPoint, 120),
        resourceReason: clip(step.resourceReason, 120),
        difficulty: asNumber(step.difficulty, 3, 1, 5),
        estimatedMinutes: asNumber(step.estimatedMinutes, 15, 5, 120),
        teachingPhase: clip(step.teachingPhase, 80),
        evidenceType: clip(step.evidenceType, 80),
        successCriteria: asStringArray(step.successCriteria, []).slice(0, 5),
        unlockCondition: clip(step.unlockCondition, 160),
        qualitySignals: asStringArray(step.qualitySignals, []).slice(0, 8)
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
  pedagogyScore: asNumber(raw?.pedagogyScore, fallback.pedagogyScore || fallback.alignmentScore, 0, 1),
  resourceGroundingScore: asNumber(raw?.resourceGroundingScore, fallback.resourceGroundingScore || fallback.alignmentScore, 0, 1),
  sequencingScore: asNumber(raw?.sequencingScore, fallback.sequencingScore || fallback.zpdScore, 0, 1),
  assessmentScore: asNumber(raw?.assessmentScore, fallback.assessmentScore || fallback.zpdScore, 0, 1),
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
    pedagogyAnalysis: clip(raw?.pedagogyAnalysis, 280) || fallback.pedagogyAnalysis,
    strengths: asStringArray(raw?.strengths, fallback.strengths).slice(0, 5),
    risks: asStringArray(raw?.risks, fallback.risks).slice(0, 5),
    suggestions: (Array.isArray(raw?.suggestions) ? raw?.suggestions : fallback.suggestions).slice(0, 6).map((suggestion) => ({
      type: suggestion.type,
      reason: clip(suggestion.reason, 200),
      targetStepId: clip(suggestion.targetStepId, 80),
      action: clip(suggestion.action, 200)
    })),
    constraintScores: scores,
    rubric: raw?.rubric || fallback.rubric
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
    planningContext: PlanningContextBundle;
    goalSkillMap: GoalSkillMap;
  }, options?: MclPlannerRunOptions) {
    const fallback = buildFallbackDiagnosticReport(
      input.stateBundle,
      input.userInput,
      input.resources,
      input.planningContext,
      input.goalSkillMap
    );

    return this.runStage('LearnerAnalyticsAgent', {
      summary: 'Diagnose learner state and prerequisite gaps.',
      provider: aiModelProviderService.provider({ useCase: 'planner' }),
      model: aiModelProviderService.model(aiModelProviderService.provider({ useCase: 'planner' }), undefined, 'planner'),
      resourceCount: input.resources.length,
      skillCount: input.goalSkillMap.targetSkills.length,
      timeoutMs: PLANNER_STAGE_TIMEOUT_MS
    }, options, async () => {
      if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) {
        return { value: fallback, fallback: true, summary: 'AI planner provider is not configured; used local diagnostic fallback.' };
      }

      try {
        const response = await aiModelProviderService.json<LearnerDiagnosticReport>({
          ...buildDiagnosticPrompt(input.stateBundle, input.userInput, input.resources, input.planningContext, input.goalSkillMap),
          useCase: 'planner',
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

  private async runCurriculumSkeleton(input: {
    stateBundle: BuiltMclLearningState;
    userInput: string;
    diagnostic: LearnerDiagnosticReport;
    planningContext: PlanningContextBundle;
    goalSkillMap: GoalSkillMap;
    previousPlan?: LearningPlan | null;
  }, options?: MclPlannerRunOptions) {
    const fallback = buildFallbackCurriculumSkeleton(
      input.stateBundle,
      input.userInput,
      input.diagnostic,
      input.planningContext,
      input.goalSkillMap,
      input.previousPlan
    );

    return this.runStage('CurriculumSkeletonAgent', {
      summary: 'Build ideal curriculum skeleton without resource or KG inputs.',
      provider: aiModelProviderService.provider({ useCase: 'planner' }),
      model: aiModelProviderService.model(aiModelProviderService.provider({ useCase: 'planner' }), undefined, 'planner'),
      targetSkillCount: input.goalSkillMap.targetSkills.length,
      weakSkillCount: input.diagnostic.weakSkills.length,
      timeoutMs: PLANNER_STAGE_TIMEOUT_MS
    }, options, async () => {
      if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) {
        return { value: fallback, fallback: true, summary: 'AI planner provider is not configured; used curriculum skeleton fallback.' };
      }

      try {
        const response = await aiModelProviderService.json<CurriculumSkeleton>({
          ...buildCurriculumSkeletonPrompt(
            input.stateBundle,
            input.userInput,
            input.diagnostic,
            input.planningContext,
            input.goalSkillMap,
            input.previousPlan
          ),
          useCase: 'planner',
          timeoutMs: PLANNER_STAGE_TIMEOUT_MS
        });
        const value = normalizeCurriculumSkeleton(response.data, fallback);
        return { value, summary: `stages=${value.stages.length}, targetSkills=${value.targetSkills.length}` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { value: fallback, fallback: true, summary: `Curriculum skeleton fallback after model error: ${message}` };
      }
    });
  }

  private async runKgConstraintAudit(input: {
    skeleton: CurriculumSkeleton;
    knowledgeGraph: KnowledgeGraphSnapshot;
    planningContext: PlanningContextBundle;
  }, options?: MclPlannerRunOptions) {
    const fallback = buildFallbackKgAudit(input.skeleton, input.planningContext.kgHints);

    return this.runStage('KgConstraintAudit', {
      summary: 'Audit curriculum skeleton for prerequisite jumps.',
      provider: aiModelProviderService.provider({ useCase: 'planner' }),
      model: aiModelProviderService.model(aiModelProviderService.provider({ useCase: 'planner' }), undefined, 'planner'),
      stageCount: input.skeleton.stages.length,
      prerequisiteEdgeCount: input.planningContext.kgHints.prerequisiteEdges.length,
      riskJumpCount: input.planningContext.kgHints.riskJumps.length,
      timeoutMs: PLANNER_STAGE_TIMEOUT_MS
    }, options, async () => {
      if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) {
        return { value: fallback, fallback: true, summary: 'AI planner provider is not configured; used local KG audit fallback.' };
      }

      try {
        const response = await aiModelProviderService.json<KgConstraintAudit>({
          ...buildKgAuditPrompt(input.skeleton, input.knowledgeGraph, input.planningContext.kgHints),
          useCase: 'planner',
          timeoutMs: PLANNER_STAGE_TIMEOUT_MS
        });
        const value = normalizeKgAudit(response.data, fallback);
        return { value, summary: `verdict=${value.verdict}, warnings=${value.warnings.length}, insertions=${value.insertions.length}` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { value: fallback, fallback: true, summary: `KG audit fallback after model error: ${message}` };
      }
    });
  }

  private async runResourceGrounding(input: {
    skeleton: CurriculumSkeleton;
    diagnostic: LearnerDiagnosticReport;
    resources: LearningPlanResource[];
    planningContext: PlanningContextBundle;
  }, options?: MclPlannerRunOptions) {
    return this.runStage('ResourceGroundingPass', {
      summary: 'Match curriculum stages to resource units and mark resource gaps.',
      stageCount: input.skeleton.stages.length,
      resourceUnitCount: input.planningContext.resourceLearningUnits.length,
      resourceCount: input.resources.length
    }, options, async () => {
      const value = buildResourceGroundingResult(
        input.skeleton,
        input.planningContext.resourceLearningUnits,
        input.resources,
        input.diagnostic
      );
      return { value, summary: value.summary };
    });
  }

  private async runTutorPlanComposition(input: {
    skeleton: CurriculumSkeleton;
    kgAudit: KgConstraintAudit;
    grounding: ResourceGroundingResult;
    diagnostic: LearnerDiagnosticReport;
    resources: LearningPlanResource[];
    planningContext: PlanningContextBundle;
  }, options?: MclPlannerRunOptions) {
    return this.runStage('FinalTutorPlanComposition', {
      summary: 'Compose final tutor plan from refined skeleton, resource matches, gaps and KG warnings.',
      stageCount: input.skeleton.stages.length,
      gapCount: input.grounding.gaps.length,
      kgWarningCount: input.kgAudit.warnings.length
    }, options, async () => {
      const grounding = buildResourceGroundingResult(
        input.skeleton,
        input.planningContext.resourceLearningUnits,
        input.resources,
        input.diagnostic
      );
      const value = composeDraftFromCurriculum(input.skeleton, grounding, input.kgAudit, input.diagnostic);
      return { value, summary: `steps=${value.steps.length}, gaps=${grounding.gaps.length}` };
    });
  }

  private async runReflection(input: {
    round: number;
    stateBundle: BuiltMclLearningState;
    diagnostic: LearnerDiagnosticReport;
    draft: PlannerPathDraft;
    resources: LearningPlanResource[];
    knowledgeGraph: KnowledgeGraphSnapshot;
    planningContext: PlanningContextBundle;
    goalSkillMap: GoalSkillMap;
  }, options?: MclPlannerRunOptions) {
    const fallback = buildFallbackReflectionForCurriculum(input.round, input.diagnostic, input.draft);

    return this.runStage(`PedagogyCritic:${input.round}`, {
      summary: 'Review tutor path with pedagogy, CLT, ZPD and resource grounding rubrics.',
      provider: aiModelProviderService.provider({ useCase: 'planner' }),
      model: aiModelProviderService.model(aiModelProviderService.provider({ useCase: 'planner' }), undefined, 'planner'),
      round: input.round,
      stepCount: input.draft.steps.length,
      resourceUnitCount: input.planningContext.resourceLearningUnits.length,
      timeoutMs: PLANNER_STAGE_TIMEOUT_MS
    }, options, async () => {
      if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) {
        return {
          value: normalizeReflection(input.round, fallback, fallback),
          fallback: true,
          summary: 'AI planner provider is not configured; used curriculum-first reflection fallback.'
        };
      }

      try {
        const response = await aiModelProviderService.json<ReflectionResponse>({
          ...buildReflectionPrompt(
            input.round,
            input.stateBundle,
            input.diagnostic,
            input.draft,
            input.resources,
            input.knowledgeGraph,
            input.planningContext,
            input.goalSkillMap
          ),
          useCase: 'planner',
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
    const previousVersion = input.previousPlan?.version || 0;
    const scope = input.stateBundle.state.activeGoal?.id
      ? 'goal'
      : input.stateBundle.state.workbench?.id
        ? 'workbench'
        : 'workspace';
    const markdown = await this.runStage('LlmOnlyPlanner', {
      summary: 'Generate one natural-language learning plan from the user objective only.',
      provider: aiModelProviderService.provider({ useCase: 'planner' }),
      model: aiModelProviderService.model(aiModelProviderService.provider({ useCase: 'planner' }), undefined, 'planner'),
      timeoutMs: LLM_ONLY_PLANNER_TIMEOUT_MS,
      legacyPipelinePaused: true
    }, input.options, async () => {
      if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) {
        throw new Error('AI planner provider is not configured; LLM-only planner cannot generate a plan.');
      }

      try {
        const response = await aiModelProviderService.chat(buildLlmOnlyPlannerPrompt(input.userInput, input.previousPlan), {
          useCase: 'planner',
          timeoutMs: LLM_ONLY_PLANNER_TIMEOUT_MS
        });
        const value = clip(response.reply, 20000);
        if (!value) throw new Error('AI planner returned an empty response.');
        return {
          value,
          summary: `Generated natural plan with ${value.length} characters.`
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`LLM-only planner failed: ${message}`);
      }
    });

    const objective = clip(input.userInput || titleFromMarkdown(markdown, input.userInput), 180);
    const structuredPlan = await this.runStage('PlanStructurer', {
      summary: 'Structure the natural Markdown plan for card display without replanning.',
      provider: aiModelProviderService.provider({ useCase: 'planner' }),
      model: aiModelProviderService.model(aiModelProviderService.provider({ useCase: 'planner' }), undefined, 'planner'),
      timeoutMs: Number(process.env.MCL_PLAN_STRUCTURER_TIMEOUT_MS || 90000)
    }, input.options, async () => {
      const value = await planStructurerService.structure({
        objective,
        planMarkdown: markdown
      });
      return {
        value,
        fallback: Boolean(value.parseFailed),
        summary: value.parseFailed
          ? `PlanStructurer parse failed; raw Markdown preserved. ${value.parseError || ''}`.trim()
          : `Structured ${value.stages.length} stages for display.`
      };
    });
    const diagnostic = buildPhaseOneDiagnostic(objective, []);
    const steps: LearningPlanStep[] = [];
    const milestones: LearningPlanMilestone[] = [];
    const constraintScores = {
      cltScore: 0.8,
      zpdScore: 0.8,
      alignmentScore: 0.9,
      pedagogyScore: 0.85,
      resourceGroundingScore: 0,
      sequencingScore: 0.85,
      assessmentScore: 0.75,
      confidence: 0.78,
      summary: 'LLM-only planner: natural-language plan generated from user objective; legacy grounding and profile stages are paused.'
    };
    const knowledgeGraphSnapshot = { nodes: [], edges: [] as KnowledgeGraphSnapshot['edges'] };

    return {
      id: crypto.randomUUID(),
      workspaceId: input.stateBundle.state.workspace.id,
      workbenchId: input.stateBundle.state.workbench?.id || null,
      goalId: input.stateBundle.state.activeGoal?.id || null,
      scope,
      version: previousVersion + 1,
      status: 'active',
      objective,
      rationale: markdown,
      assumptions: ['该计划仅基于用户当前输入的学习目标生成。'],
      constraints: ['暂不接入 grounding、上传资料、知识图谱、学习画像、资源推荐、revision agent 或 fallback domain template。'],
      targetSkills: filterKnowledgeConcepts([objective], 6),
      weakSkills: [],
      milestones,
      steps,
      adaptationPolicy: {
        replanTriggers: ['用户补充时间预算、当前水平或学习反馈', '计划执行后发现范围过大或过小'],
        progressionSignals: ['完成计划中的阶段任务', '能解释核心概念并完成对应练习', '能明确下一步学习行动'],
        fallbackActions: ['缩小目标范围', '把当前阶段拆成更小任务', '要求 LLM 重新生成更短或更具体的计划']
      },
      evidence: {
        citations: [],
        activeGoalTitle: input.stateBundle.state.activeGoal?.title || null,
        currentTaskIntent: input.stateBundle.state.currentTask.intent,
        readinessSummary: 'LLM-only planner; external context stages paused.'
      },
      diagnosticReport: {
        ...diagnostic,
        targetGoal: objective,
        currentStateSummary: '当前计划由 LLM 直接根据用户目标生成，未使用学习画像、资料 grounding 或知识图谱。',
        evidence: ['plannerMode=llm_only']
      } as unknown as LearnerDiagnosticReport,
      candidateResources: [],
      knowledgeGraphSnapshot,
      reflectionHistory: [],
      constraintScores,
      revisionCount: 0,
      nextStepId: null,
      previousPlanId: input.previousPlan?.id || null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      naturalPlanMarkdown: markdown,
      structuredPlan,
      skipPlanningSideEffects: true
    } as LearningPlan & { naturalPlanMarkdown: string; skipPlanningSideEffects: boolean };
  }
}

export const mclPlannerService = new MclPlannerService();
