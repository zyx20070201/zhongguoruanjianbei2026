import { aiModelProviderService } from '../aiModelProviderService';
import {
  GoalSkillMap,
  GoalSkillNode,
  PlanningContextBundle
} from '../planningTypes';

const GOAL_SKILL_TIMEOUT_MS = Number(process.env.GOAL_SKILL_MAPPER_TIMEOUT_MS || 45000);

type RawGoalSkillNode = Partial<GoalSkillNode> & {
  title?: string;
  skill?: string;
  name?: string;
};

const clip = (value: unknown, maxLength = 320) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const unique = (items: Array<string | null | undefined>, limit = 12) =>
  Array.from(new Set(items.map((item) => clip(item, 140)).filter(Boolean))).slice(0, limit);

const slug = (value: string, fallback: string) => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
};

const statusFor = (
  skill: string,
  context: PlanningContextBundle
): GoalSkillNode['currentStatus'] => {
  const normalized = skill.toLowerCase();
  if (context.kgHints.masteredConcepts.some((item) => item.toLowerCase().includes(normalized) || normalized.includes(item.toLowerCase()))) {
    return 'mastered';
  }
  if (context.kgHints.weakConcepts.some((item) => item.toLowerCase().includes(normalized) || normalized.includes(item.toLowerCase()))) {
    return 'weak';
  }
  if (context.activeGoal?.weaknesses.some((item) => item.toLowerCase().includes(normalized) || normalized.includes(item.toLowerCase()))) {
    return 'weak';
  }
  return 'unknown';
};

const normalizeNode = (
  raw: RawGoalSkillNode,
  context: PlanningContextBundle,
  index: number,
  fallbackTitle?: string
): GoalSkillNode | null => {
  const title = clip(raw.title || raw.skill || raw.name || fallbackTitle, 120);
  if (!title) return null;
  const currentStatus =
    raw.currentStatus === 'mastered' ||
    raw.currentStatus === 'partial' ||
    raw.currentStatus === 'weak' ||
    raw.currentStatus === 'unknown'
      ? raw.currentStatus
      : statusFor(title, context);
  return {
    id: clip(raw.id, 80) || `skill-${index + 1}-${slug(title, String(index + 1))}`,
    title,
    description: clip(raw.description, 260) || `围绕「${title}」形成可解释、可练习、可检测的能力。`,
    priority: Math.max(0, Math.min(1, Number(raw.priority ?? (index < 3 ? 0.85 - index * 0.08 : 0.55)))),
    currentStatus,
    prerequisites: unique(raw.prerequisites || [], 8),
    evidence: unique(raw.evidence || [], 8),
    suggestedResourceUnitIds: unique(raw.suggestedResourceUnitIds || [], 6)
  };
};

const normalizeNodes = (
  raw: unknown,
  context: PlanningContextBundle,
  fallback: string[],
  prefix: string
) => {
  const values = Array.isArray(raw) ? raw : [];
  const nodes = values
    .map((item, index) =>
      typeof item === 'string'
        ? normalizeNode({ title: item, id: `${prefix}-${index + 1}` }, context, index)
        : normalizeNode((item || {}) as RawGoalSkillNode, context, index)
    )
    .filter((item): item is GoalSkillNode => Boolean(item));
  if (nodes.length) return dedupeNodes(nodes);
  return fallback
    .map((title, index) => normalizeNode({ title, id: `${prefix}-${index + 1}` }, context, index))
    .filter((item): item is GoalSkillNode => Boolean(item));
};

const dedupeNodes = (nodes: GoalSkillNode[]) => {
  const byTitle = new Map<string, GoalSkillNode>();
  nodes.forEach((node) => {
    const key = node.title.toLowerCase();
    const existing = byTitle.get(key);
    if (!existing || node.priority > existing.priority) byTitle.set(key, node);
  });
  return Array.from(byTitle.values());
};

const fallbackSkillTitles = (context: PlanningContextBundle) => {
  const fromGoal = unique([...(context.activeGoal?.skills || []), ...(context.kgHints.targetConcepts || [])], 8);
  if (fromGoal.length) return fromGoal;
  const objective = context.objective.replace(/我想|我要|学习|掌握|计划|路径|给我|一份/g, '').trim();
  return unique([objective, '核心概念理解', '例题推演', '针对练习', '掌握度检测'], 5);
};

const buildFallbackSkillMap = (context: PlanningContextBundle): GoalSkillMap => {
  const targetTitles = fallbackSkillTitles(context);
  const prerequisiteTitles = unique([
    ...context.kgHints.recommendedOrderHints.slice(0, 6),
    ...context.kgHints.riskJumps.map((item) => item.split('->')[0]?.trim())
  ], 8).filter((title) => !targetTitles.includes(title));
  const activeGoalWeaknesses = context.activeGoal?.weaknesses || [];
  const weakTitles = unique([
    ...activeGoalWeaknesses,
    ...context.kgHints.weakConcepts,
    ...targetTitles.filter((title) => statusFor(title, context) !== 'mastered')
  ], 8);
  const targetSkills = normalizeNodes(targetTitles, context, targetTitles, 'target').slice(0, 10);
  const prerequisiteSkills = normalizeNodes(prerequisiteTitles, context, prerequisiteTitles, 'prereq').slice(0, 8);
  const skillGaps = normalizeNodes(weakTitles, context, weakTitles, 'gap').slice(0, 10);

  return {
    objective: context.activeGoal?.goalText || context.objective,
    targetSkills,
    prerequisiteSkills,
    skillGaps,
    recommendedSequence: unique([
      ...prerequisiteSkills.map((node) => node.id),
      ...skillGaps.map((node) => node.id),
      ...targetSkills.map((node) => node.id)
    ], 18),
    assumptions: [
      '技能映射基于学习目标、学习者信号与 KG 约束；资源匹配将在后续 Resource Grounding Pass 单独完成。',
      context.kgHints.evidence.join('; ')
    ].filter(Boolean),
    evidence: [
      `recentEvidence=${context.recentEvidence.length}`,
      `weakConcepts=${context.kgHints.weakConcepts.length}`
    ],
    source: 'fallback'
  };
};

const buildPrompt = (context: PlanningContextBundle) => ({
  instruction: [
    'You are the GoalSkillMapperAgent in a curriculum-first tutor planning system.',
    'Map the learner objective into teachable skills, prerequisite skills, and skill gaps.',
    'Use only learner state, active goal, recent learning evidence, and KG hints as constraint evidence.',
    'Do not derive target skills from available workspace resources. Resource matching happens in a later pass.',
    'Do not write the final learning plan. Return a compact skill map that downstream tutor planning can use.',
    'Leave suggestedResourceUnitIds empty unless the input explicitly provides trustworthy resource bindings.',
    'Return JSON only.'
  ].join('\n'),
  schema: {
    objective: 'string',
    targetSkills: [
      {
        id: 'string',
        title: 'string',
        description: 'string',
        priority: 0.8,
        currentStatus: 'mastered | partial | weak | unknown',
        prerequisites: ['string'],
        evidence: ['string'],
        suggestedResourceUnitIds: ['string']
      }
    ],
    prerequisiteSkills: ['same object shape as targetSkills'],
    skillGaps: ['same object shape as targetSkills'],
    recommendedSequence: ['skill id in recommended learning order'],
    assumptions: ['string'],
    evidence: ['string']
  },
  input: {
    objective: context.objective,
    workspace: context.workspace,
    workbench: context.workbench,
    learner: context.learner,
    activeGoal: context.activeGoal,
    kgHints: context.kgHints,
    recentEvidence: context.recentEvidence,
    readiness: context.readiness
  },
  context: {
    workspaceId: context.workspace.id,
    workbenchId: context.workbench?.id
  }
});

export class GoalSkillMapperService {
  async map(input: { planningContext: PlanningContextBundle }): Promise<GoalSkillMap> {
    const fallback = buildFallbackSkillMap(input.planningContext);

    if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) {
      return fallback;
    }

    try {
      const response = await aiModelProviderService.json<Partial<GoalSkillMap>>({
        ...buildPrompt(input.planningContext),
        useCase: 'planner',
        timeoutMs: GOAL_SKILL_TIMEOUT_MS
      });
      return this.normalize(response.data, input.planningContext, fallback, 'ai');
    } catch (error) {
      console.warn('GoalSkillMapperAgent fallback:', error instanceof Error ? error.message : error);
      return fallback;
    }
  }

  private normalize(
    raw: Partial<GoalSkillMap> | null | undefined,
    context: PlanningContextBundle,
    fallback: GoalSkillMap,
    source: GoalSkillMap['source']
  ): GoalSkillMap {
    const targetSkills = normalizeNodes(raw?.targetSkills, context, fallback.targetSkills.map((node) => node.title), 'target').slice(0, 12);
    const prerequisiteSkills = normalizeNodes(
      raw?.prerequisiteSkills,
      context,
      fallback.prerequisiteSkills.map((node) => node.title),
      'prereq'
    ).slice(0, 10);
    const skillGaps = normalizeNodes(raw?.skillGaps, context, fallback.skillGaps.map((node) => node.title), 'gap').slice(0, 12);
    const knownIds = new Set([...targetSkills, ...prerequisiteSkills, ...skillGaps].map((node) => node.id));
    const sequence = unique(raw?.recommendedSequence || [], 20).filter((id) => knownIds.has(id));

    return {
      objective: clip(raw?.objective, 260) || fallback.objective,
      targetSkills: targetSkills.length ? targetSkills : fallback.targetSkills,
      prerequisiteSkills,
      skillGaps: skillGaps.length ? skillGaps : fallback.skillGaps,
      recommendedSequence: sequence.length ? sequence : fallback.recommendedSequence,
      assumptions: unique(raw?.assumptions || fallback.assumptions, 8),
      evidence: unique(raw?.evidence || fallback.evidence, 10),
      source
    };
  }
}

export const goalSkillMapperService = new GoalSkillMapperService();
