import { BuiltMclLearningState } from '../learningStateBuilder';
import {
  KgPlanningHints,
  LearningPlanResource,
  PlanningContextBundle,
  ResourceLearningUnit
} from '../planningTypes';

const clip = (value: unknown, maxLength = 420) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const unique = (items: Array<string | null | undefined>, limit = 12) =>
  Array.from(new Set(items.map((item) => clip(item, 120)).filter(Boolean))).slice(0, limit);

const asNumber = (value: unknown, fallback: number, min = 0, max = 1) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
};

const inferResourceType = (value: string | undefined): LearningPlanResource['type'] => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'video') return 'video';
  if (normalized === 'quiz') return 'quiz';
  if (normalized === 'exercise' || normalized === 'task') return 'exercise';
  if (normalized === 'flashcards') return 'flashcards';
  if (normalized === 'mind_map') return 'mind_map';
  if (normalized === 'project') return 'project';
  if (normalized === 'context') return 'context';
  return 'document';
};

const modalityFor = (type: LearningPlanResource['type']): ResourceLearningUnit['modality'] => {
  if (type === 'video') return 'watch';
  if (type === 'quiz') return 'quiz';
  if (type === 'exercise') return 'practice';
  if (type === 'flashcards') return 'review';
  if (type === 'project') return 'project';
  if (type === 'context') return 'mixed';
  return 'read';
};

export class PlanningContextBundleService {
  build(input: {
    stateBundle: BuiltMclLearningState;
    objective: string;
    resources: LearningPlanResource[];
    resourceLearningUnits?: ResourceLearningUnit[];
    kgHints?: KgPlanningHints;
  }): PlanningContextBundle {
    const { stateBundle, objective, resources } = input;
    const units = input.resourceLearningUnits?.length
      ? this.mergeResourceLearningUnits(input.resourceLearningUnits, this.buildResourceLearningUnits(stateBundle, resources))
      : this.buildResourceLearningUnits(stateBundle, resources);
    const kgHints = input.kgHints || this.buildKgHints(stateBundle);
    const recentEvidence = this.buildRecentEvidence(stateBundle);
    const learnerAgentContext = stateBundle.state.learnerAgentContext as any;

    return {
      schema: 'planning_context_bundle.v1',
      objective: clip(objective || stateBundle.state.activeGoal?.goalText || '生成个性化学习路径', 260),
      workspace: {
        id: stateBundle.state.workspace.id,
        name: stateBundle.state.workspace.name,
        major: stateBundle.state.workspace.major
      },
      workbench: stateBundle.state.workbench
        ? {
            id: stateBundle.state.workbench.id,
            title: stateBundle.state.workbench.title,
            description: stateBundle.state.workbench.description
          }
        : null,
      learner: {
        profileSummary: stateBundle.state.learnerProfile.summary,
        preferences: stateBundle.state.learnerProfile.preferences || {},
        centralStateSummary: clip(stateBundle.state.centralLearnerState.summary, 700),
        agentHints: unique([
          ...(Array.isArray(learnerAgentContext?.hints) ? learnerAgentContext.hints : []),
          ...(Array.isArray(learnerAgentContext?.planningHints) ? learnerAgentContext.planningHints : []),
          ...(Array.isArray(learnerAgentContext?.recommendations) ? learnerAgentContext.recommendations : [])
        ], 10)
      },
      activeGoal: stateBundle.state.activeGoal
        ? {
            id: stateBundle.state.activeGoal.id,
            title: stateBundle.state.activeGoal.title,
            goalText: stateBundle.state.activeGoal.goalText,
            skills: stateBundle.state.activeGoal.skills,
            weaknesses: stateBundle.state.activeGoal.weaknesses
          }
        : null,
      resourceInventory: resources,
      resourceLearningUnits: units,
      kgHints,
      recentEvidence,
      readiness: {
        ready: stateBundle.state.readiness.ready,
        checks: stateBundle.state.readiness.checks,
        stats: stateBundle.state.readiness.stats
      },
      contextPolicy: {
        intent: stateBundle.contextPolicy.intent,
        ragScope: stateBundle.contextPolicy.ragScope,
        maxRetrievedChunks: stateBundle.contextPolicy.maxRetrievedChunks,
        reasons: stateBundle.contextPolicy.reasons || []
      }
    };
  }

  private mergeResourceLearningUnits(primary: ResourceLearningUnit[], fallback: ResourceLearningUnit[]) {
    const byKey = new Map<string, ResourceLearningUnit>();
    [...primary, ...fallback].forEach((unit) => {
      const key = `${unit.resourceId}:${unit.title}:${JSON.stringify(unit.locator || {})}`;
      const existing = byKey.get(key);
      if (!existing || unit.relevanceScore > existing.relevanceScore) byKey.set(key, unit);
    });
    return Array.from(byKey.values())
      .sort((left, right) => right.relevanceScore - left.relevanceScore)
      .slice(0, 42);
  }

  private buildResourceLearningUnits(
    stateBundle: BuiltMclLearningState,
    resources: LearningPlanResource[]
  ): ResourceLearningUnit[] {
    const units: ResourceLearningUnit[] = [];
    const resourcesBySourceId = new Map(resources.map((resource) => [resource.sourceId || resource.id, resource] as const));

    (stateBundle.capsule.retrievedChunks || []).slice(0, 12).forEach((chunk, index) => {
      const resource = resourcesBySourceId.get(chunk.fileId || '') || resources.find((item) => item.title === chunk.fileName);
      const type = inferResourceType(resource?.type || (chunk.fileName?.match(/\.(mp4|mov|avi)$/i) ? 'video' : 'context'));
      units.push({
        id: `chunk-unit-${chunk.chunkId || index + 1}`,
        resourceId: resource?.id || chunk.fileId || `chunk-${index + 1}`,
        resourceTitle: clip(resource?.title || chunk.fileName || `资料片段 ${index + 1}`, 140),
        resourceType: type,
        title: this.titleForChunk(chunk, index),
        summary: clip(chunk.content, 520),
        locator: chunk.locator as Record<string, unknown> | undefined,
        teaches: unique([...(chunk.matchedTerms || []), ...(chunk.locator?.headingPath || [])], 5),
        prerequisites: [],
        difficulty: resource?.difficulty || 2,
        estimatedMinutes: resource?.estimatedMinutes || 10,
        modality: modalityFor(type),
        evidenceSnippets: [
          clip(chunk.supportSnippets?.[0]?.text || chunk.content, 260),
          chunk.retrievalReason ? clip(chunk.retrievalReason, 180) : ''
        ].filter(Boolean),
        relevanceScore: asNumber(resource?.relevanceScore ?? chunk.score, 0.65, 0, 100),
        source: 'capsule'
      });
    });

    resources.slice(0, 12).forEach((resource, index) => {
      if (units.some((unit) => unit.resourceId === resource.id || unit.resourceId === resource.sourceId)) return;
      units.push({
        id: `resource-unit-${resource.id || index + 1}`,
        resourceId: resource.id,
        resourceTitle: resource.title,
        resourceType: resource.type,
        title: resource.title,
        summary: clip(resource.summary, 520),
        teaches: unique([resource.citationLabel, resource.title], 4),
        prerequisites: [],
        difficulty: resource.difficulty,
        estimatedMinutes: resource.estimatedMinutes,
        modality: modalityFor(resource.type),
        evidenceSnippets: [clip(resource.summary, 260)].filter(Boolean),
        relevanceScore: resource.relevanceScore,
        source: 'fallback'
      });
    });

    const goal = stateBundle.state.activeGoal;
    if (goal && units.length < 4) {
      unique([...goal.skills, ...goal.weaknesses], 8).forEach((skill, index) => {
        units.push({
          id: `goal-unit-${index + 1}`,
          resourceId: `goal:${goal.id}`,
          resourceTitle: goal.title,
          resourceType: 'context',
          title: `围绕目标梳理：${skill}`,
          summary: `学习目标要求覆盖「${skill}」，但当前还缺少更具体的资源定位。`,
          teaches: [skill],
          prerequisites: [],
          difficulty: 2,
          estimatedMinutes: 8,
          modality: 'mixed',
          evidenceSnippets: [goal.goalText],
          relevanceScore: 0.5,
          source: 'goal'
        });
      });
    }

    return units
      .sort((left, right) => right.relevanceScore - left.relevanceScore)
      .slice(0, 18);
  }

  private titleForChunk(chunk: NonNullable<BuiltMclLearningState['capsule']['retrievedChunks']>[number], index: number) {
    const heading = chunk.locator?.headingPath?.slice(-1)[0];
    if (heading) return clip(`${chunk.fileName || '资料'}：${heading}`, 160);
    if (typeof chunk.locator?.timestampStart === 'number') return clip(`${chunk.fileName || '视频'} 时间片段`, 160);
    if (chunk.locator?.page || chunk.locator?.pageStart) return clip(`${chunk.fileName || '文档'} 第 ${chunk.locator.page || chunk.locator.pageStart} 页`, 160);
    return clip(`${chunk.fileName || '资料片段'} #${index + 1}`, 160);
  }

  private buildKgHints(stateBundle: BuiltMclLearningState): KgPlanningHints {
    const graph = stateBundle.state.courseKnowledgeGraph as any;
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph?.edges) ? graph.edges : [];
    const reasoning = graph?.reasoning || {};
    const prerequisiteGaps = Array.isArray(reasoning.prerequisiteGaps) ? reasoning.prerequisiteGaps : [];
    const weakNeighbors = Array.isArray(reasoning.weakNeighborhood?.neighbors) ? reasoning.weakNeighborhood.neighbors : [];

    const masteredConcepts = unique(
      nodes
        .filter((node: any) => Number(node.masteryEstimate || node.mastery || 0) >= 0.7)
        .map((node: any) => node.title || node.label),
      16
    );
    const activeGoalWeaknesses = stateBundle.state.activeGoal?.weaknesses || [];
    const activeGoalSkills = stateBundle.state.activeGoal?.skills || [];
    const weakConcepts = unique([
      ...activeGoalWeaknesses,
      ...weakNeighbors.map((item: any) => item.title),
      ...prerequisiteGaps.map((gap: any) => gap.prerequisite?.title || gap.targetConcept?.title)
    ], 18);
    const targetConcepts = unique([
      ...activeGoalSkills,
      ...nodes
        .filter((node: any) => Number(node.activationScore || 0) > 0.4)
        .map((node: any) => node.title || node.label)
    ], 18);

    return {
      masteredConcepts,
      weakConcepts,
      targetConcepts,
      prerequisiteEdges: edges
        .filter((edge: any) => edge.relationType === 'prerequisite' || edge.relation === 'prerequisite')
        .slice(0, 40)
        .map((edge: any) => ({
          from: String(edge.fromTitle || edge.from || edge.fromConceptId || ''),
          to: String(edge.toTitle || edge.to || edge.toConceptId || ''),
          relation: 'prerequisite',
          weight: typeof edge.weight === 'number' ? edge.weight : undefined
        }))
        .filter((edge: any) => edge.from && edge.to),
      riskJumps: prerequisiteGaps
        .map((gap: any) => `${gap.prerequisite?.title || '前置知识'} -> ${gap.targetConcept?.title || '目标知识'}`)
        .slice(0, 10),
      recommendedOrderHints: unique([
        ...prerequisiteGaps.map((gap: any) => gap.prerequisite?.title).filter(Boolean),
        ...weakConcepts,
        ...targetConcepts
      ], 20),
      evidence: [
        `kgNodes=${nodes.length}`,
        `kgEdges=${edges.length}`,
        `prerequisiteGaps=${prerequisiteGaps.length}`,
        `weakNeighbors=${weakNeighbors.length}`
      ]
    };
  }

  private buildRecentEvidence(stateBundle: BuiltMclLearningState): PlanningContextBundle['recentEvidence'] {
    const traces = stateBundle.state.recentTraces.map((trace) => ({
      type: 'trace',
      summary: clip(trace.summary, 260),
      evidence: trace.nextActions.slice(0, 4),
      updatedAt: trace.updatedAt
    }));
    const events = stateBundle.state.recentEvents.slice(0, 6).map((event) => ({
      type: event.eventType,
      summary: clip(String((event.payload as any).summary || (event.payload as any).userInput || event.eventType), 240),
      evidence: unique([
        event.eventFamily,
        ...((Array.isArray(event.cognitiveSignals) ? event.cognitiveSignals : []) as any[]).map((signal) =>
          typeof signal === 'string' ? signal : signal?.taxonomy || signal?.type || signal?.value
        )
      ], 5),
      updatedAt: event.createdAt
    }));
    return [...traces, ...events].slice(0, 10);
  }
}

export const planningContextBundleService = new PlanningContextBundleService();
