import prisma from '../config/db';
import { isProbablyKnowledgeConcept } from './learnerSignalSanitizer';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

type OptimizerNode = {
  id: string;
  title: string;
  difficulty: number;
  activationScore: number;
  masteryEstimate: number;
  weaknessEstimate: number;
  readinessEstimate: number;
  resourceCoverage: number;
  assessmentCoverage: number;
  misconceptionCoverage: number;
  evidenceQuality: number;
};

type OptimizerEdge = {
  from: string;
  to: string;
  relationType: string;
  weight: number;
  confidence: number;
};

type CandidatePath = {
  conceptIds: string[];
  cost: number;
  reward: number;
  scores: {
    prerequisiteFit: number;
    zpdFit: number;
    evidenceFit: number;
    noveltyFit: number;
    remediationFit: number;
    loadFit: number;
    confidence: number;
  };
  explanation: string[];
};

export class LearningPathOptimizationService {
  async optimize(input: {
    workspaceId: string;
    sourceConceptIds?: string[];
    targetConceptIds?: string[];
    candidateConceptIds?: string[];
    maxConcepts?: number;
    beamWidth?: number;
  }) {
    const maxConcepts = Math.min(Math.max(input.maxConcepts || 10, 3), 18);
    const beamWidth = Math.min(Math.max(input.beamWidth || 8, 3), 20);
    const { nodes, edges } = await this.loadOptimizationGraph(input.workspaceId, input.candidateConceptIds || [], maxConcepts);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const sourceIds = (input.sourceConceptIds?.length ? input.sourceConceptIds : nodes.filter((node) => node.masteryEstimate >= 0.72).map((node) => node.id))
      .filter((id) => nodeById.has(id));
    const targetIds = (input.targetConceptIds?.length ? input.targetConceptIds : nodes
      .filter((node) => node.weaknessEstimate >= 0.5 || node.readinessEstimate <= 0.58)
      .sort((a, b) => (b.weaknessEstimate + (1 - b.readinessEstimate)) - (a.weaknessEstimate + (1 - a.readinessEstimate)))
      .map((node) => node.id))
      .filter((id) => nodeById.has(id))
      .slice(0, maxConcepts);

    const adjacency = this.buildAdjacency(edges);
    const seeds = sourceIds.length ? sourceIds : targetIds.slice(0, 2);
    let beam: CandidatePath[] = seeds.map((id) => this.scorePath([id], nodeById, edges, targetIds));
    const completed: CandidatePath[] = [];

    for (let depth = 1; depth < maxConcepts; depth += 1) {
      const expanded: CandidatePath[] = [];
      for (const path of beam) {
        const last = path.conceptIds[path.conceptIds.length - 1];
        const nextIds = (adjacency.get(last) || [])
          .filter((edge) => !path.conceptIds.includes(edge.to))
          .sort((a, b) => this.transitionReward(b, nodeById) - this.transitionReward(a, nodeById))
          .slice(0, beamWidth);
        if (!nextIds.length) {
          completed.push(path);
          continue;
        }
        nextIds.forEach((edge) => expanded.push(this.scorePath([...path.conceptIds, edge.to], nodeById, edges, targetIds)));
      }
      beam = this.paretoSelect([...expanded, ...beam], beamWidth);
      completed.push(...beam.filter((path) => targetIds.some((id) => path.conceptIds.includes(id))));
      if (completed.length >= beamWidth * 2 && this.coverageOf(this.bestPath(completed), targetIds) >= 0.78) break;
    }

    const candidates = this.paretoSelect([...completed, ...beam], beamWidth);
    const best = this.bestPath(candidates);
    const orderedConcepts = best.conceptIds
      .map((id) => nodeById.get(id))
      .filter((node): node is OptimizerNode => Boolean(node));

    return {
      schema: 'learning_path_multi_objective_optimizer.v1',
      method: {
        search: 'beam-search with Pareto selection over KG paths',
        inspiration: [
          'multi-granularity learning path optimization / ACO-style path reward',
          'KG-aware explainable learning path recommendation',
          'RL-style reward shaping without pretending to train a policy online'
        ],
        objectives: ['prerequisite fit', 'ZPD fit', 'evidence closure', 'remediation value', 'cognitive load', 'path confidence']
      },
      workspaceId: input.workspaceId,
      sourceConceptIds: sourceIds,
      targetConceptIds: targetIds,
      selectedConceptIds: best.conceptIds,
      selectedConcepts: orderedConcepts.map((node, index) => ({
        rank: index + 1,
        id: node.id,
        title: node.title,
        masteryEstimate: node.masteryEstimate,
        weaknessEstimate: node.weaknessEstimate,
        readinessEstimate: node.readinessEstimate,
        resourceCoverage: node.resourceCoverage,
        assessmentCoverage: node.assessmentCoverage
      })),
      scores: best.scores,
      objectiveValue: Number((best.reward - best.cost).toFixed(3)),
      candidateCount: candidates.length,
      paretoCandidates: candidates.slice(0, 6).map((path) => ({
        conceptIds: path.conceptIds,
        objectiveValue: Number((path.reward - path.cost).toFixed(3)),
        scores: path.scores,
        explanation: path.explanation
      })),
      explanation: best.explanation
    };
  }

  private async loadOptimizationGraph(workspaceId: string, seedIds: string[], maxConcepts: number) {
    const concepts = await prisma.courseKnowledgeConcept.findMany({
      where: {
        workspaceId,
        status: 'active',
        OR: seedIds.length
          ? [
              { id: { in: seedIds } },
              { incomingRelations: { some: { fromConceptId: { in: seedIds } } } },
              { outgoingRelations: { some: { toConceptId: { in: seedIds } } } },
              { learnerStates: { some: { OR: [{ weaknessEstimate: { gte: 0.48 } }, { readinessEstimate: { lte: 0.62 } }] } } }
            ]
          : [{ learnerStates: { some: {} } }, { bindings: { some: {} } }]
      },
      include: {
        learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 },
        bindings: true,
        misconceptions: true
      },
      orderBy: [{ activationScore: 'desc' }, { updatedAt: 'desc' }],
      take: Math.min(Math.max(maxConcepts * 8, 40), 180)
    });
    const cleanConcepts = concepts.filter((concept) => isProbablyKnowledgeConcept(concept.title));
    const ids = cleanConcepts.map((concept) => concept.id);
    const relations = await prisma.courseKnowledgeRelation.findMany({
      where: { workspaceId, fromConceptId: { in: ids }, toConceptId: { in: ids } },
      orderBy: [{ confidence: 'desc' }, { weight: 'desc' }],
      take: 1200
    });
    const nodes: OptimizerNode[] = cleanConcepts.map((concept) => {
      const state = concept.learnerStates[0];
      const evidence = parseJson<Record<string, unknown>>(concept.evidenceJson, {});
      const resourceBindings = concept.bindings.filter((binding) => binding.bindingType === 'resource');
      const assessmentBindings = concept.bindings.filter((binding) => binding.bindingType === 'quiz' || binding.bindingType === 'task');
      return {
        id: concept.id,
        title: concept.title,
        difficulty: concept.difficulty,
        activationScore: concept.activationScore,
        masteryEstimate: state?.masteryEstimate ?? 0.5,
        weaknessEstimate: state?.weaknessEstimate ?? 0.3,
        readinessEstimate: state?.readinessEstimate ?? 0.5,
        resourceCoverage: clamp01(resourceBindings.length / 2),
        assessmentCoverage: clamp01(assessmentBindings.length / 2),
        misconceptionCoverage: clamp01(concept.misconceptions.length / 2),
        evidenceQuality: clamp01(
          (Object.keys(evidence).length ? 0.28 : 0) +
          Math.min(0.32, concept.bindings.length * 0.08) +
          avg(concept.bindings.map((binding) => binding.confidence)) * 0.4
        )
      };
    });
    const edges: OptimizerEdge[] = relations.map((relation) => ({
      from: relation.fromConceptId,
      to: relation.toConceptId,
      relationType: relation.relationType,
      weight: relation.weight,
      confidence: relation.confidence
    }));
    return { nodes, edges };
  }

  private buildAdjacency(edges: OptimizerEdge[]) {
    const adjacency = new Map<string, OptimizerEdge[]>();
    edges.forEach((edge) => {
      adjacency.set(edge.from, [...(adjacency.get(edge.from) || []), edge]);
      if (edge.relationType !== 'prerequisite') {
        adjacency.set(edge.to, [...(adjacency.get(edge.to) || []), { ...edge, from: edge.to, to: edge.from, confidence: edge.confidence * 0.9 }]);
      }
    });
    return adjacency;
  }

  private scorePath(path: string[], nodeById: Map<string, OptimizerNode>, edges: OptimizerEdge[], targetIds: string[]): CandidatePath {
    const nodes = path.map((id) => nodeById.get(id)).filter((node): node is OptimizerNode => Boolean(node));
    const edgeLookup = new Map(edges.map((edge) => [`${edge.from}:${edge.to}`, edge]));
    const usedEdges = path.slice(1).map((id, index) => edgeLookup.get(`${path[index]}:${id}`)).filter((edge): edge is OptimizerEdge => Boolean(edge));
    const targetCoverage = this.coverageOf({ conceptIds: path } as CandidatePath, targetIds);
    const prerequisiteFit = usedEdges.length
      ? avg(usedEdges.map((edge) => edge.relationType === 'prerequisite' ? edge.confidence : edge.confidence * 0.76))
      : 0.46;
    const zpdFit = avg(nodes.map((node) => clamp01(1 - Math.abs(node.readinessEstimate - 0.62) - Math.max(0, node.difficulty - 0.78) * 0.12)));
    const evidenceFit = avg(nodes.map((node) => clamp01(node.evidenceQuality * 0.45 + node.resourceCoverage * 0.25 + node.assessmentCoverage * 0.3)));
    const remediationFit = avg(nodes.map((node) => clamp01(node.weaknessEstimate * 0.58 + (1 - node.readinessEstimate) * 0.32 + node.misconceptionCoverage * 0.1)));
    const noveltyFit = avg(nodes.map((node) => clamp01(1 - node.masteryEstimate * 0.72 + node.activationScore * 0.02)));
    const loadFit = clamp01(1 - Math.max(0, nodes.length - 8) * 0.04 - avg(nodes.map((node) => Math.max(0, node.difficulty - node.readinessEstimate))) * 0.3);
    const confidence = clamp01(avg(usedEdges.map((edge) => edge.confidence)) * 0.42 + evidenceFit * 0.32 + Math.min(0.26, nodes.length * 0.026));
    const reward = targetCoverage * 1.2 + prerequisiteFit * 0.8 + zpdFit * 0.9 + evidenceFit * 0.65 + remediationFit * 0.72 + noveltyFit * 0.35 + confidence * 0.55;
    const cost = nodes.length * 0.12 + (1 - loadFit) * 0.55 + (1 - prerequisiteFit) * 0.45 + Math.max(0, 0.62 - evidenceFit) * 0.4;
    return {
      conceptIds: path,
      cost,
      reward,
      scores: {
        prerequisiteFit: Number(prerequisiteFit.toFixed(3)),
        zpdFit: Number(zpdFit.toFixed(3)),
        evidenceFit: Number(evidenceFit.toFixed(3)),
        noveltyFit: Number(noveltyFit.toFixed(3)),
        remediationFit: Number(remediationFit.toFixed(3)),
        loadFit: Number(loadFit.toFixed(3)),
        confidence: Number(confidence.toFixed(3))
      },
      explanation: [
        `targetCoverage=${targetCoverage.toFixed(2)}`,
        `prerequisiteFit=${prerequisiteFit.toFixed(2)}`,
        `zpdFit=${zpdFit.toFixed(2)}`,
        `evidenceFit=${evidenceFit.toFixed(2)}`,
        `remediationFit=${remediationFit.toFixed(2)}`
      ]
    };
  }

  private transitionReward(edge: OptimizerEdge, nodeById: Map<string, OptimizerNode>) {
    const node = nodeById.get(edge.to);
    if (!node) return 0;
    return edge.confidence * 0.28 + edge.weight * 0.18 + node.weaknessEstimate * 0.22 + (1 - node.readinessEstimate) * 0.18 + node.evidenceQuality * 0.14;
  }

  private paretoSelect(paths: CandidatePath[], limit: number) {
    const unique = new Map<string, CandidatePath>();
    paths.forEach((path) => {
      const key = path.conceptIds.join('>');
      const old = unique.get(key);
      if (!old || path.reward - path.cost > old.reward - old.cost) unique.set(key, path);
    });
    const candidates = Array.from(unique.values());
    const nonDominated = candidates.filter((candidate) => !candidates.some((other) => {
      if (other === candidate) return false;
      const otherValue = other.reward - other.cost;
      const candidateValue = candidate.reward - candidate.cost;
      return otherValue >= candidateValue &&
        other.scores.zpdFit >= candidate.scores.zpdFit &&
        other.scores.evidenceFit >= candidate.scores.evidenceFit &&
        other.scores.prerequisiteFit >= candidate.scores.prerequisiteFit &&
        (otherValue > candidateValue || other.scores.confidence > candidate.scores.confidence);
    }));
    return nonDominated
      .sort((a, b) => (b.reward - b.cost) - (a.reward - a.cost))
      .slice(0, limit);
  }

  private bestPath(paths: CandidatePath[]) {
    return [...paths].sort((a, b) => (b.reward - b.cost) - (a.reward - a.cost))[0] || {
      conceptIds: [],
      cost: 1,
      reward: 0,
      scores: { prerequisiteFit: 0, zpdFit: 0, evidenceFit: 0, noveltyFit: 0, remediationFit: 0, loadFit: 0, confidence: 0 },
      explanation: []
    };
  }

  private coverageOf(path: CandidatePath, targetIds: string[]) {
    if (!targetIds.length) return 0.5;
    const selected = new Set(path.conceptIds);
    return targetIds.filter((id) => selected.has(id)).length / targetIds.length;
  }
}

export const learningPathOptimizationService = new LearningPathOptimizationService();
