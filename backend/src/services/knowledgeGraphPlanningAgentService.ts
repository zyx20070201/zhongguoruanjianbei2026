import crypto from 'crypto';
import prisma from '../config/db';
import { conceptKeyFor, courseKnowledgeGraphService } from './courseKnowledgeGraphService';
import { courseKnowledgeReasoningService } from './courseKnowledgeReasoningService';
import { graphConstrainedPlannerService } from './graphConstrainedPlannerService';
import { learningPathOptimizationService } from './learningPathOptimizationService';
import { filterKnowledgeConcepts, isProbablyKnowledgeConcept } from './learnerSignalSanitizer';
import { learnerStateService } from './learnerStateService';
import {
  ConstraintScores,
  KnowledgeGraphSnapshot,
  LearnerDiagnosticReport,
  LearningPlan,
  LearningPlanResource,
  LearningPlanStep,
  LearningPlanStepType
} from './planningTypes';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const clip = (value: unknown, maxLength = 220) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const normalize = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
const unique = (items: Array<string | null | undefined>) => Array.from(new Set(items.map(normalize).filter((item) => item.length >= 2)));
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

type ConceptNode = {
  id: string;
  title: string;
  difficulty: number;
  activationScore: number;
  learnerState: {
    masteryEstimate: number;
    weaknessEstimate: number;
    readinessEstimate: number;
  };
  bindings: Array<{
    bindingType: string;
    targetType: string;
    targetId: string;
    role: string;
    strength: number;
    confidence: number;
    evidence: Record<string, unknown>;
  }>;
};

type RelationEdge = {
  id: string;
  fromConceptId: string;
  toConceptId: string;
  relationType: string;
  weight: number;
  confidence: number;
};

type PathNode = ConceptNode & {
  role: 'source_mastered' | 'prerequisite_gap' | 'weak_target' | 'goal_target' | 'bridge';
  priority: number;
  reasons: string[];
  pathDistance?: number;
  pathPredecessor?: string | null;
};

const stepCapability = (type: LearningPlanStepType) => {
  if (type === 'diagnose') return 'diagnosis';
  if (type === 'retrieve') return 'knowledge_retrieval';
  if (type === 'quiz') return 'quiz_generation';
  if (type === 'reflect') return 'reflection';
  return 'content_generation';
};

export class KnowledgeGraphPlanningAgentService {
  async plan(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    objective?: string;
    targetConcepts?: string[];
    maxConcepts?: number;
  }): Promise<LearningPlan & { planningTrace?: Record<string, unknown> }> {
    const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new Error('Workspace not found');

    const [centralState, activeGoal] = await Promise.all([
      learnerStateService.ensureState({ workspaceId: input.workspaceId, workbenchId: input.workbenchId || null, goalId: input.goalId || null }),
      input.goalId
        ? prisma.learningGoal.findFirst({ where: { id: input.goalId, workspaceId: input.workspaceId } })
        : prisma.learningGoal.findFirst({ where: { workspaceId: input.workspaceId, status: 'active' }, orderBy: { updatedAt: 'desc' } })
    ]);

    const masteredTitles = filterKnowledgeConcepts(unique([
      ...centralState.coreState.stableProfile.masteredKnowledge.map((signal) => signal.value),
      ...centralState.coreState.stableProfile.learningGoals.map((signal) => signal.value).filter((value) => /已掌握|mastered/i.test(value))
    ]), 20);
    const weakTitles = filterKnowledgeConcepts(unique([
      ...centralState.coreState.stableProfile.weakKnowledge.map((signal) => signal.value),
      ...centralState.coreState.workingState.currentCourseState.focusKnowledge.map((signal) => signal.value),
      ...(activeGoal ? parseJson<string[]>(activeGoal.weaknessesJson, []) : [])
    ]), 24);
    const targetTitles = filterKnowledgeConcepts(unique([
      ...(input.targetConcepts || []),
      ...(activeGoal ? parseJson<string[]>(activeGoal.skillsJson, []) : []),
      ...centralState.coreState.workingState.currentCourseState.activeGoals.map((signal) => signal.value)
    ]), 24);

    const [sourceConcepts, weakConcepts, targetConcepts] = await Promise.all([
      this.resolveConcepts(input.workspaceId, masteredTitles, 'learner_state_mastered'),
      this.resolveConcepts(input.workspaceId, weakTitles, 'learner_state_weak'),
      this.resolveConcepts(input.workspaceId, targetTitles, 'learner_state_target')
    ]);

    const sinkIds = Array.from(new Set([...weakConcepts, ...targetConcepts].map((concept) => concept.id)));
    const sourceIds = Array.from(new Set(sourceConcepts.map((concept) => concept.id)));
    const graph = await this.loadPlanningGraph(input.workspaceId, Array.from(new Set([...sourceIds, ...sinkIds])), input.maxConcepts || 12);
    const selectedNodes = this.selectMultiSourceMultiSinkPath({
      nodes: graph.nodes,
      edges: graph.edges,
      sourceIds,
      sinkIds,
      maxConcepts: input.maxConcepts || 12
    });
    const optimizer = await learningPathOptimizationService.optimize({
      workspaceId: input.workspaceId,
      sourceConceptIds: sourceIds,
      targetConceptIds: sinkIds,
      candidateConceptIds: Array.from(new Set([...selectedNodes.map((node) => node.id), ...sourceIds, ...sinkIds])),
      maxConcepts: input.maxConcepts || 12
    }).catch((error) => {
      console.warn('Learning path optimizer failed:', error);
      return null;
    });
    const optimizedOrder = optimizer?.selectedConceptIds?.length
      ? this.applyOptimizedOrder(selectedNodes, optimizer.selectedConceptIds)
      : selectedNodes;

    const prerequisiteGaps = await courseKnowledgeReasoningService.getPrerequisiteGaps({
      workspaceId: input.workspaceId,
      conceptIds: sinkIds
    }).catch(() => []);

    const graphCandidates = await graphConstrainedPlannerService.buildCandidatePath({
      workspaceId: input.workspaceId,
      objective: input.objective || activeGoal?.goalText || workspace.name,
      conceptIds: optimizedOrder.filter((node) => node.role !== 'source_mastered').map((node) => node.id),
      maxConcepts: Math.min(input.maxConcepts || 10, 12)
    }).catch(() => null);

    const resources = this.resourcesForNodes(optimizedOrder).slice(0, 12);
    const steps = this.stepsForPath(optimizedOrder, prerequisiteGaps, graphCandidates).slice(0, 12);
    const milestones = [
      {
        id: 'milestone-1',
        title: '补齐关键前置知识',
        description: '先处理 KG 中阻断目标知识的 prerequisite gaps。',
        successCriteria: ['完成前置概念诊断', '至少一个前置概念 readiness 提升'],
        status: 'active' as const
      },
      {
        id: 'milestone-2',
        title: '围绕薄弱知识形成学习证据',
        description: '通过解释、练习和测验把薄弱点转化为可观测证据。',
        successCriteria: ['完成针对性练习', '生成测验或任务反馈'],
        status: 'pending' as const
      },
      {
        id: 'milestone-3',
        title: '进入目标知识迁移',
        description: '在前置知识可用后推进到目标概念并进行反思调整。',
        successCriteria: ['目标概念 readiness 达到阈值', '形成下一轮重规划信号'],
        status: 'pending' as const
      }
    ];

    const constraintScores = this.scorePlan(optimizedOrder, steps, resources, optimizer || undefined);
    const diagnosticReport = this.buildDiagnosticReport({
      objective: input.objective || activeGoal?.goalText || workspace.name,
      weakTitles,
      targetTitles,
      sourceConcepts,
      selectedNodes: optimizedOrder,
      prerequisiteGaps,
      centralStateSummary: centralState.summary
    });
    const knowledgeGraphSnapshot = this.snapshotFor(optimizedOrder, graph.edges);
    const now = new Date().toISOString();
    const plan: LearningPlan & { planningTrace?: Record<string, unknown> } = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: activeGoal?.id || input.goalId || null,
      scope: activeGoal?.id || input.goalId ? 'goal' : input.workbenchId ? 'workbench' : 'workspace',
      version: 1,
      status: 'active',
      objective: input.objective || activeGoal?.goalText || `学习路径：${workspace.name}`,
      rationale: 'KG planning agent reads centralized learner state, then connects mastered sources to weak/target sinks through prerequisite-aware graph planning.',
      assumptions: [
        sourceConcepts.length ? '中心化 learner state 中存在可作为起点的已掌握知识。' : '已掌握知识证据不足，因此路径会从轻量诊断开始。',
        sinkIds.length ? '目标/薄弱知识已映射到课程知识图谱。' : '目标概念不足，需要先补充 KG 或学习目标。',
        prerequisiteGaps.length ? '存在需要先补齐的前置知识缺口。' : '当前未发现高优先级前置缺口。',
        optimizer ? `多目标优化器已选择 ${optimizer.selectedConceptIds.length} 个概念，objective=${optimizer.objectiveValue}。` : '多目标优化器未返回结果，使用 KG 约束候选顺序。'
      ],
      constraints: [
        'Planning must use centralized learner state as the learner profile source of truth.',
        'Prerequisite gaps must be diagnosed or remediated before target practice.',
        'Every high-priority target concept should bind to resource/task/quiz evidence when available.',
        'Steps should maintain ZPD and cognitive-load fit for the current learner state.',
        'Multi-objective path selection should balance prerequisite order, remediation value, evidence closure, and confidence.'
      ],
      targetSkills: unique([...targetTitles, ...selectedNodes.filter((node) => node.role === 'goal_target').map((node) => node.title)]).slice(0, 10),
      weakSkills: unique([...weakTitles, ...selectedNodes.filter((node) => node.role === 'weak_target' || node.role === 'prerequisite_gap').map((node) => node.title)]).slice(0, 10),
      milestones,
      steps,
      adaptationPolicy: {
        replanTriggers: [
          '新的测验或任务结果改变概念 mastery/readiness',
          '学生反复提示使用或重复困惑集中在同一概念',
          '目标知识或学习时间预算发生变化'
        ],
        progressionSignals: ['前置概念 readiness >= 0.62', '薄弱概念 weakness 连续下降', '目标概念测验正确率提高'],
        fallbackActions: ['缩小到单个 prerequisite gap', '替换为低负荷资源', '插入 diagnose + scaffolded practice']
      },
      evidence: {
        citations: resources.map((resource) => resource.citationLabel || resource.title).slice(0, 8),
        activeGoalTitle: activeGoal?.title || null,
        currentTaskIntent: 'kg_based_planning',
        readinessSummary: `sources=${sourceConcepts.length}, sinks=${sinkIds.length}, selectedConcepts=${optimizedOrder.length}, prerequisiteGaps=${prerequisiteGaps.length}, optimizer=${optimizer ? optimizer.objectiveValue : 'fallback'}`
      },
      diagnosticReport,
      candidateResources: resources,
      knowledgeGraphSnapshot,
      reflectionHistory: [],
      constraintScores,
      revisionCount: 0,
      nextStepId: steps[0]?.id || null,
      previousPlanId: null,
      createdAt: now,
      updatedAt: now,
      planningTrace: {
        schema: 'kg_planning_trace.v1',
        sourceConcepts: sourceConcepts.map((concept) => ({ id: concept.id, title: concept.title })),
        weakConcepts: weakConcepts.map((concept) => ({ id: concept.id, title: concept.title })),
        targetConcepts: targetConcepts.map((concept) => ({ id: concept.id, title: concept.title })),
        selectedNodes: optimizedOrder.map((node) => ({ id: node.id, title: node.title, role: node.role, priority: node.priority, reasons: node.reasons })),
        prerequisiteGaps: prerequisiteGaps.slice(0, 12),
        graphCandidateScores: graphCandidates?.scores || null,
        optimizer: optimizer
          ? {
              method: optimizer.method,
              scores: optimizer.scores,
              objectiveValue: optimizer.objectiveValue,
              paretoCandidates: optimizer.paretoCandidates
            }
          : null
      }
    };

    return plan;
  }

  private async resolveConcepts(workspaceId: string, titles: string[], source: string) {
    const concepts = [];
    for (const title of filterKnowledgeConcepts(titles, 20)) {
      const key = conceptKeyFor(workspaceId, title);
      const existing = await prisma.courseKnowledgeConcept.findUnique({
        where: { workspaceId_conceptKey: { workspaceId, conceptKey: key } }
      });
      if (existing && !isProbablyKnowledgeConcept(existing.title)) continue;
      concepts.push(existing || await courseKnowledgeGraphService.upsertConcept({ workspaceId, title, source, evidence: { source } }));
    }
    return concepts;
  }

  private async loadPlanningGraph(workspaceId: string, seedIds: string[], limit: number): Promise<{ nodes: ConceptNode[]; edges: RelationEdge[] }> {
    const seedConcepts = seedIds.length
      ? await prisma.courseKnowledgeConcept.findMany({
          where: { workspaceId, id: { in: seedIds }, status: 'active' },
          include: {
            learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 },
            bindings: { orderBy: [{ strength: 'desc' }, { confidence: 'desc' }], take: 8 }
          }
        })
      : [];
    const neighborRelations = seedIds.length
      ? await prisma.courseKnowledgeRelation.findMany({
          where: { workspaceId, OR: [{ fromConceptId: { in: seedIds } }, { toConceptId: { in: seedIds } }] },
          orderBy: [{ relationType: 'asc' }, { weight: 'desc' }],
          take: 400
        })
      : [];
    const neighborIds = Array.from(new Set(neighborRelations.flatMap((relation) => [relation.fromConceptId, relation.toConceptId])));
    const highPriority = await prisma.courseKnowledgeConcept.findMany({
      where: {
        workspaceId,
        status: 'active',
        OR: [
          { id: { in: neighborIds } },
          { learnerStates: { some: { OR: [{ weaknessEstimate: { gte: 0.5 } }, { readinessEstimate: { lte: 0.58 } }] } } }
        ]
      },
      orderBy: [{ activationScore: 'desc' }, { updatedAt: 'desc' }],
      include: {
        learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 },
        bindings: { orderBy: [{ strength: 'desc' }, { confidence: 'desc' }], take: 8 }
      },
      take: Math.min(Math.max(limit * 4, 24), 80)
    });
    const byId = new Map([...seedConcepts, ...highPriority].filter((concept) => isProbablyKnowledgeConcept(concept.title)).map((concept) => [concept.id, concept]));
    const ids = Array.from(byId.keys());
    const edges = await prisma.courseKnowledgeRelation.findMany({
      where: { workspaceId, fromConceptId: { in: ids }, toConceptId: { in: ids } },
      orderBy: [{ relationType: 'asc' }, { weight: 'desc' }],
      take: 800
    });
    const nodes: ConceptNode[] = Array.from(byId.values()).map((concept) => {
      const state = concept.learnerStates[0];
      return {
        id: concept.id,
        title: concept.title,
        difficulty: concept.difficulty,
        activationScore: concept.activationScore,
        learnerState: {
          masteryEstimate: state?.masteryEstimate ?? 0.5,
          weaknessEstimate: state?.weaknessEstimate ?? 0.3,
          readinessEstimate: state?.readinessEstimate ?? 0.5
        },
        bindings: concept.bindings.map((binding) => ({
          bindingType: binding.bindingType,
          targetType: binding.targetType,
          targetId: binding.targetId,
          role: binding.role,
          strength: binding.strength,
          confidence: binding.confidence,
          evidence: parseJson<Record<string, unknown>>(binding.evidenceJson, {})
        }))
      };
    });
    return { nodes, edges };
  }

  private selectMultiSourceMultiSinkPath(input: {
    nodes: ConceptNode[];
    edges: RelationEdge[];
    sourceIds: string[];
    sinkIds: string[];
    maxConcepts: number;
  }): PathNode[] {
    const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
    const sourceSet = new Set(input.sourceIds);
    const sinkSet = new Set(input.sinkIds);
    const shortest = this.multiSourceShortestPaths(input.nodes, input.edges, input.sourceIds);
    const prereqTargets = new Set(
      input.edges
        .filter((edge) => edge.relationType === 'prerequisite' && sinkSet.has(edge.toConceptId))
        .map((edge) => edge.fromConceptId)
    );
    const candidates = input.nodes.map((node): PathNode => {
      const state = node.learnerState;
      const isSource = sourceSet.has(node.id) || state.masteryEstimate >= 0.72;
      const isSink = sinkSet.has(node.id);
      const isGap = prereqTargets.has(node.id) && (state.readinessEstimate < 0.62 || state.weaknessEstimate >= 0.48);
      const pathInfo = shortest.get(node.id);
      const pathReachabilityBonus = pathInfo && Number.isFinite(pathInfo.distance) ? Math.max(0, 0.14 - pathInfo.distance * 0.025) : 0;
      const priority = clamp01(
        (isSink ? 0.28 : 0) +
          (isGap ? 0.26 : 0) +
          state.weaknessEstimate * 0.22 +
          (1 - state.readinessEstimate) * 0.16 +
          Math.min(0.08, node.bindings.length * 0.02) +
          pathReachabilityBonus
      );
      return {
        ...node,
        role: isSource ? 'source_mastered' : isGap ? 'prerequisite_gap' : isSink ? (state.weaknessEstimate >= 0.5 ? 'weak_target' : 'goal_target') : 'bridge',
        priority,
        pathDistance: pathInfo?.distance,
        pathPredecessor: pathInfo?.predecessor || null,
        reasons: [
          isSource ? 'centralized learner state or KG learner state marks this as mastered/source knowledge' : '',
          isGap ? 'prerequisite relation indicates this should be remediated before a sink concept' : '',
          isSink ? 'target or weak concept from learner state / active goal' : '',
          state.weaknessEstimate >= 0.5 ? `weakness=${state.weaknessEstimate.toFixed(2)}` : '',
          state.readinessEstimate < 0.62 ? `readiness=${state.readinessEstimate.toFixed(2)}` : '',
          pathInfo ? `sourceDistance=${pathInfo.distance.toFixed(2)}` : 'not_reached_from_mastered_source'
        ].filter(Boolean)
      };
    });
    const pathBackfillIds = new Set<string>();
    candidates
      .filter((node) => sinkSet.has(node.id) || node.role === 'prerequisite_gap')
      .forEach((node) => {
        let cursor: string | null | undefined = node.id;
        let guard = 0;
        while (cursor && guard < 8) {
          pathBackfillIds.add(cursor);
          cursor = shortest.get(cursor)?.predecessor || null;
          guard += 1;
        }
      });
    const selected = [
      ...candidates.filter((node) => node.role === 'source_mastered').sort((a, b) => b.learnerState.masteryEstimate - a.learnerState.masteryEstimate).slice(0, 3),
      ...candidates.filter((node) => pathBackfillIds.has(node.id) && node.role === 'bridge').sort((a, b) => (a.pathDistance || 99) - (b.pathDistance || 99)).slice(0, 5),
      ...candidates.filter((node) => node.role === 'prerequisite_gap').sort((a, b) => b.priority - a.priority),
      ...candidates.filter((node) => node.role === 'weak_target' || node.role === 'goal_target').sort((a, b) => b.priority - a.priority),
      ...candidates.filter((node) => node.role === 'bridge').sort((a, b) => b.priority - a.priority).slice(0, 4)
    ];
    const byId = new Map<string, PathNode>();
    selected.forEach((node) => {
      if (!byId.has(node.id)) byId.set(node.id, node);
    });
    return Array.from(byId.values()).filter((node) => nodesById.has(node.id)).slice(0, Math.min(Math.max(input.maxConcepts, 4), 16));
  }

  private applyOptimizedOrder(nodes: PathNode[], optimizedIds: string[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const ordered: PathNode[] = [];
    optimizedIds.forEach((id) => {
      const node = byId.get(id);
      if (node) ordered.push({ ...node, reasons: [...node.reasons, 'selected_by_multi_objective_optimizer'] });
    });
    nodes.forEach((node) => {
      if (!ordered.some((item) => item.id === node.id)) ordered.push(node);
    });
    return ordered;
  }

  private multiSourceShortestPaths(nodes: ConceptNode[], edges: RelationEdge[], sourceIds: string[]) {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const adjacency = new Map<string, Array<{ to: string; cost: number }>>();
    edges.forEach((edge) => {
      if (!nodeIds.has(edge.fromConceptId) || !nodeIds.has(edge.toConceptId)) return;
      const relationCost =
        edge.relationType === 'prerequisite'
          ? 0.55
          : edge.relationType === 'part_of'
            ? 0.72
            : edge.relationType === 'supports'
              ? 0.82
              : 1.05;
      const confidencePenalty = 1 - clamp01(edge.confidence || 0.5);
      const weightBonus = 1 - clamp01(edge.weight || 0.5);
      const cost = relationCost + confidencePenalty * 0.35 + weightBonus * 0.2;
      adjacency.set(edge.fromConceptId, [...(adjacency.get(edge.fromConceptId) || []), { to: edge.toConceptId, cost }]);
      if (edge.relationType !== 'prerequisite') {
        adjacency.set(edge.toConceptId, [...(adjacency.get(edge.toConceptId) || []), { to: edge.fromConceptId, cost: cost + 0.18 }]);
      }
    });
    const distances = new Map<string, { distance: number; predecessor: string | null }>();
    const queue: Array<{ id: string; distance: number }> = [];
    sourceIds.filter((id) => nodeIds.has(id)).forEach((id) => {
      distances.set(id, { distance: 0, predecessor: null });
      queue.push({ id, distance: 0 });
    });
    if (!queue.length) {
      nodes.filter((node) => node.learnerState.masteryEstimate >= 0.72).forEach((node) => {
        distances.set(node.id, { distance: 0, predecessor: null });
        queue.push({ id: node.id, distance: 0 });
      });
    }
    while (queue.length) {
      queue.sort((a, b) => a.distance - b.distance);
      const current = queue.shift()!;
      if (current.distance > (distances.get(current.id)?.distance ?? Infinity)) continue;
      for (const edge of adjacency.get(current.id) || []) {
        const nextDistance = current.distance + edge.cost;
        if (nextDistance < (distances.get(edge.to)?.distance ?? Infinity)) {
          distances.set(edge.to, { distance: nextDistance, predecessor: current.id });
          queue.push({ id: edge.to, distance: nextDistance });
        }
      }
    }
    return distances;
  }

  private resourcesForNodes(nodes: PathNode[]): LearningPlanResource[] {
    const resources = new Map<string, LearningPlanResource>();
    nodes.forEach((node) => {
      node.bindings.forEach((binding) => {
        if (!['resource', 'quiz', 'task'].includes(binding.bindingType)) return;
        const id = `${binding.targetType}:${binding.targetId}`;
        if (resources.has(id)) return;
        resources.set(id, {
          id,
          title: clip((binding.evidence as any).fileName || (binding.evidence as any).question?.question || `${node.title} ${binding.bindingType}`, 120),
          type: binding.bindingType === 'quiz' ? 'quiz' : binding.bindingType === 'task' ? 'exercise' : 'document',
          sourceId: binding.targetId,
          citationLabel: `${node.title} / ${binding.role}`,
          summary: clip(`KG binding for ${node.title}: ${binding.bindingType}/${binding.role}`, 220),
          difficulty: Math.max(1, Math.min(5, Math.round(1 + node.difficulty * 4))),
          estimatedMinutes: binding.bindingType === 'quiz' ? 12 : binding.bindingType === 'task' ? 20 : 15,
          relevanceScore: clamp01(binding.strength * 0.55 + binding.confidence * 0.45)
        });
      });
    });
    return Array.from(resources.values()).sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private stepsForPath(nodes: PathNode[], prerequisiteGaps: Array<any>, graphCandidates: any): LearningPlanStep[] {
    const graphStepByConcept = new Map<string, any>();
    (Array.isArray(graphCandidates?.steps) ? graphCandidates.steps : []).forEach((step: any) => {
      if (step.conceptId && !graphStepByConcept.has(step.conceptId)) graphStepByConcept.set(step.conceptId, step);
    });
    const steps: LearningPlanStep[] = [];
    const actionable = nodes.filter((node) => node.role !== 'source_mastered');
    actionable.forEach((node, index) => {
      const graphStep = graphStepByConcept.get(node.id);
      const gap = prerequisiteGaps.find((item) => item.prerequisite?.id === node.id || item.targetConcept?.id === node.id);
      const binding = node.bindings.find((item) => item.bindingType === 'resource') || node.bindings[0];
      const firstType: LearningPlanStepType = node.role === 'prerequisite_gap' || gap ? 'diagnose' : binding ? 'retrieve' : 'explain';
      steps.push({
        id: `kg-step-${steps.length + 1}`,
        type: firstType,
        title: node.role === 'prerequisite_gap' ? `先补前置知识：${node.title}` : `进入概念：${node.title}`,
        rationale: clip([
          node.reasons.join('；'),
          gap ? `gapScore=${Number(gap.gapScore || 0).toFixed(2)}` : '',
          graphStep?.resourceBinding ? '存在 KG 绑定资源/测验证据' : ''
        ].filter(Boolean).join('；'), 320),
        targetSkills: [node.title],
        prerequisites: prerequisiteGaps.filter((item) => item.targetConcept?.id === node.id).map((item) => item.prerequisite?.title).filter(Boolean).slice(0, 5),
        estimatedLoad: node.learnerState.readinessEstimate < 0.48 ? 'light' : 'medium',
        expectedEvidence: ['诊断回答、资源阅读证据或概念解释'],
        suggestedCapability: stepCapability(firstType),
        status: index === 0 ? 'active' : 'pending'
      });
      steps.push({
        id: `kg-step-${steps.length + 1}`,
        type: 'practice',
        title: `针对练习：${node.title}`,
        rationale: 'DeepTutor-style planning requires interaction evidence before updating mastery.',
        targetSkills: [node.title],
        prerequisites: [`完成 ${node.title} 的前置诊断或资源学习`],
        estimatedLoad: node.learnerState.weaknessEstimate >= 0.65 ? 'medium' : 'light',
        expectedEvidence: ['练习结果、提示使用、错误模式'],
        suggestedCapability: 'content_generation',
        status: 'pending'
      });
      steps.push({
        id: `kg-step-${steps.length + 1}`,
        type: 'quiz',
        title: `检测掌握：${node.title}`,
        rationale: 'Use assessment evidence to decide whether to progress, remediate, or replan.',
        targetSkills: [node.title],
        prerequisites: [`完成 ${node.title} 的针对性练习`],
        estimatedLoad: 'light',
        expectedEvidence: ['测验分数、错因、概念 readiness 更新'],
        suggestedCapability: 'quiz_generation',
        artifactType: 'quiz',
        status: 'pending'
      });
    });
    if (!steps.length) {
      steps.push({
        id: 'kg-step-1',
        type: 'diagnose',
        title: '建立 KG 规划基线',
        rationale: '缺少足够的 source/sink concept，需要先通过诊断和目标澄清建立规划入口。',
        targetSkills: ['当前学习目标'],
        prerequisites: [],
        estimatedLoad: 'light',
        expectedEvidence: ['目标知识、薄弱知识、已掌握知识'],
        suggestedCapability: 'diagnosis',
        status: 'active'
      });
    }
    steps.push({
      id: `kg-step-${steps.length + 1}`,
      type: 'reflect',
      title: '基于新证据重规划',
      rationale: 'After practice/quiz evidence, update centralized learner state and rerun KG planning.',
      targetSkills: actionable.slice(0, 3).map((node) => node.title),
      prerequisites: ['至少完成一个练习或测验步骤'],
      estimatedLoad: 'light',
      expectedEvidence: ['下一步补前置、推进目标或替换资源的决策'],
      suggestedCapability: 'reflection',
      status: 'pending'
    });
    return steps;
  }

  private scorePlan(nodes: PathNode[], steps: LearningPlanStep[], resources: LearningPlanResource[], optimizer?: any): ConstraintScores {
    const actionable = nodes.filter((node) => node.role !== 'source_mastered');
    const prerequisiteCoverage = actionable.length
      ? actionable.filter((node) => node.role === 'prerequisite_gap' || node.learnerState.readinessEstimate >= 0.58).length / actionable.length
      : 0.4;
    const resourceCoverage = actionable.length ? actionable.filter((node) => node.bindings.length).length / actionable.length : 0;
    const zpdFit = actionable.length
      ? avg(actionable.map((node) => clamp01(1 - Math.abs(node.learnerState.readinessEstimate - 0.62) - Math.max(0, node.learnerState.weaknessEstimate - 0.78) * 0.3)))
      : 0.45;
    const cltScore = steps.length > 10 ? 0.72 : steps.length > 6 ? 0.82 : 0.68;
    const optimizerAlignment = optimizer?.scores
      ? clamp01(optimizer.scores.prerequisiteFit * 0.28 + optimizer.scores.zpdFit * 0.24 + optimizer.scores.evidenceFit * 0.2 + optimizer.scores.remediationFit * 0.18 + optimizer.scores.loadFit * 0.1)
      : null;
    const alignmentScore = clamp01((prerequisiteCoverage * 0.38 + resourceCoverage * 0.22 + zpdFit * 0.4) * 0.7 + (optimizerAlignment ?? zpdFit) * 0.3);
    const confidence = clamp01(0.35 + nodes.length * 0.025 + resources.length * 0.025 + alignmentScore * 0.3 + (optimizer?.scores?.confidence || 0) * 0.18);
    return {
      cltScore: Number(cltScore.toFixed(2)),
      zpdScore: Number(zpdFit.toFixed(2)),
      alignmentScore: Number(alignmentScore.toFixed(2)),
      confidence: Number(confidence.toFixed(2)),
      summary: `KG planning: prerequisiteCoverage=${prerequisiteCoverage.toFixed(2)}, resourceCoverage=${resourceCoverage.toFixed(2)}, selectedConcepts=${nodes.length}, optimizer=${optimizer?.objectiveValue ?? 'fallback'}.`
    };
  }

  private buildDiagnosticReport(input: {
    objective: string;
    weakTitles: string[];
    targetTitles: string[];
    sourceConcepts: Array<{ title: string }>;
    selectedNodes: PathNode[];
    prerequisiteGaps: Array<any>;
    centralStateSummary: string;
  }): LearnerDiagnosticReport {
    return {
      learnerLevel: input.sourceConcepts.length >= 4 ? 'intermediate' : input.sourceConcepts.length ? 'beginner' : 'unknown',
      targetGoal: input.objective,
      currentStateSummary: clip(input.centralStateSummary || 'Planning reads centralized learner state and KG learner-state estimates.', 360),
      strengths: input.sourceConcepts.map((concept) => concept.title).slice(0, 6),
      weakSkills: unique([...input.weakTitles, ...input.selectedNodes.filter((node) => node.role === 'weak_target' || node.role === 'prerequisite_gap').map((node) => node.title)]).slice(0, 8),
      prerequisiteGaps: input.prerequisiteGaps.map((gap) => gap.prerequisite?.title || gap.targetConcept?.title).filter(Boolean).slice(0, 8),
      preferredResourceForms: ['resource', 'practice', 'quiz', 'reflection'],
      timeBudget: { sessionMinutes: 35, weeklySessions: 4 },
      cognitiveLoadTolerance: input.prerequisiteGaps.length >= 3 ? 'low' : 'medium',
      recommendedDifficultyBand: { min: 1, max: input.sourceConcepts.length >= 4 ? 4 : 3 },
      evidence: [
        `sourceConcepts=${input.sourceConcepts.length}`,
        `targetConcepts=${input.targetTitles.length}`,
        `weakConcepts=${input.weakTitles.length}`,
        `prerequisiteGaps=${input.prerequisiteGaps.length}`
      ]
    };
  }

  private snapshotFor(nodes: PathNode[], edges: RelationEdge[]): KnowledgeGraphSnapshot {
    const ids = new Set(nodes.map((node) => node.id));
    return {
      nodes: nodes.map((node) => ({
        id: node.id,
        label: node.title,
        mastery: node.learnerState.masteryEstimate,
        importance: node.priority,
        kind: 'concept'
      })),
      edges: edges
        .filter((edge) => ids.has(edge.fromConceptId) && ids.has(edge.toConceptId))
        .slice(0, 80)
        .map((edge) => ({
          source: edge.fromConceptId,
          target: edge.toConceptId,
          relation: edge.relationType === 'prerequisite' ? 'prerequisite' : edge.relationType === 'part_of' ? 'supports' : 'related_to',
          weight: edge.weight
        }))
    };
  }
}

export const knowledgeGraphPlanningAgentService = new KnowledgeGraphPlanningAgentService();
