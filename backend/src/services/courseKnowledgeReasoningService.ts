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

export class CourseKnowledgeReasoningService {
  async getPrerequisiteGaps(input: {
    workspaceId: string;
    conceptIds?: string[];
    weaknessThreshold?: number;
    readinessThreshold?: number;
  }) {
    const targetConceptsRaw = input.conceptIds?.length
      ? await prisma.courseKnowledgeConcept.findMany({ where: { workspaceId: input.workspaceId, id: { in: input.conceptIds } } })
      : await prisma.courseKnowledgeConcept.findMany({
          where: {
            workspaceId: input.workspaceId,
            learnerStates: { some: { weaknessEstimate: { gte: input.weaknessThreshold || 0.55 } } }
          },
          take: 90
        });
    const targetConcepts = targetConceptsRaw.filter((concept) => isProbablyKnowledgeConcept(concept.title)).slice(0, 30);
    const targetIds = targetConcepts.map((concept) => concept.id);
    if (!targetIds.length) return [];

    const relations = await prisma.courseKnowledgeRelation.findMany({
      where: {
        workspaceId: input.workspaceId,
        source: 'ai_kg_extraction',
        relationType: 'prerequisite',
        toConceptId: { in: targetIds }
      },
      include: {
        fromConcept: { include: { learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 } } },
        toConcept: true
      }
    });
    return relations
      .map((relation) => {
        if (!isProbablyKnowledgeConcept(relation.fromConcept.title) || !isProbablyKnowledgeConcept(relation.toConcept.title)) return null;
        const state = relation.fromConcept.learnerStates[0];
        const readiness = state?.readinessEstimate ?? 0.45;
        const weakness = state?.weaknessEstimate ?? 0.35;
        return {
          targetConcept: { id: relation.toConcept.id, title: relation.toConcept.title },
          prerequisite: { id: relation.fromConcept.id, title: relation.fromConcept.title },
          readiness,
          weakness,
          relationWeight: relation.weight,
          gapScore: clamp01((1 - readiness) * 0.65 + weakness * 0.35)
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => item.readiness < (input.readinessThreshold || 0.58) || item.weakness >= (input.weaknessThreshold || 0.55))
      .sort((a, b) => b.gapScore - a.gapScore);
  }

  async expandWeakNeighborhood(input: {
    workspaceId: string;
    conceptIds?: string[];
    limit?: number;
  }) {
    const weakConceptsRaw = input.conceptIds?.length
      ? await prisma.courseKnowledgeConcept.findMany({ where: { workspaceId: input.workspaceId, id: { in: input.conceptIds } } })
      : await prisma.courseKnowledgeConcept.findMany({
          where: {
            workspaceId: input.workspaceId,
            learnerStates: { some: { weaknessEstimate: { gte: 0.55 } } }
          },
          orderBy: { activationScore: 'desc' },
          take: 60
        });
    const weakConcepts = weakConceptsRaw.filter((concept) => isProbablyKnowledgeConcept(concept.title)).slice(0, 20);
    const ids = weakConcepts.map((concept) => concept.id);
    if (!ids.length) return { seeds: [], neighbors: [] };
    const relations = await prisma.courseKnowledgeRelation.findMany({
      where: {
        workspaceId: input.workspaceId,
        source: 'ai_kg_extraction',
        OR: [{ fromConceptId: { in: ids } }, { toConceptId: { in: ids } }]
      },
      include: {
        fromConcept: { include: { learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 } } },
        toConcept: { include: { learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 } } }
      },
      take: Math.min(Math.max(input.limit || 60, 1), 200)
    });
    const neighbors = relations.flatMap((relation) => {
      const other = ids.includes(relation.fromConceptId) ? relation.toConcept : relation.fromConcept;
      if (!isProbablyKnowledgeConcept(other.title)) return [];
      const state = other.learnerStates[0];
      return [{
        id: other.id,
        title: other.title,
        relationType: relation.relationType,
        relationWeight: relation.weight,
        weaknessEstimate: state?.weaknessEstimate ?? 0.3,
        readinessEstimate: state?.readinessEstimate ?? 0.5,
        priority: clamp01(relation.weight * 0.45 + (state?.weaknessEstimate ?? 0.3) * 0.35 + (1 - (state?.readinessEstimate ?? 0.5)) * 0.2)
      }];
    });
    return {
      seeds: weakConcepts.map((concept) => ({ id: concept.id, title: concept.title })),
      neighbors: neighbors.sort((a, b) => b.priority - a.priority).slice(0, input.limit || 30)
    };
  }

  async recommendRemediationPath(input: {
    workspaceId: string;
    targetConceptId: string;
    maxDepth?: number;
  }) {
    const maxDepth = input.maxDepth || 3;
    const visited = new Set<string>();
    const path: Array<Record<string, unknown>> = [];
    const walk = async (conceptId: string, depth: number): Promise<void> => {
      if (depth > maxDepth || visited.has(conceptId)) return;
      visited.add(conceptId);
      const prereqs = await prisma.courseKnowledgeRelation.findMany({
        where: { workspaceId: input.workspaceId, toConceptId: conceptId, relationType: 'prerequisite', source: 'ai_kg_extraction' },
        include: {
          fromConcept: { include: { learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 }, bindings: { take: 3 } } }
        },
        orderBy: { weight: 'desc' },
        take: 6
      });
      for (const relation of prereqs) {
        if (!isProbablyKnowledgeConcept(relation.fromConcept.title)) continue;
        const state = relation.fromConcept.learnerStates[0];
        if ((state?.readinessEstimate ?? 0.45) < 0.62 || (state?.weaknessEstimate ?? 0.3) > 0.5) {
          await walk(relation.fromConceptId, depth + 1);
          path.push({
            conceptId: relation.fromConcept.id,
            title: relation.fromConcept.title,
            reason: 'prerequisite_gap',
            readinessEstimate: state?.readinessEstimate ?? 0.45,
            weaknessEstimate: state?.weaknessEstimate ?? 0.3,
            resourceBindings: relation.fromConcept.bindings.map((binding) => ({
              targetType: binding.targetType,
              targetId: binding.targetId,
              role: binding.role,
              strength: binding.strength
            }))
          });
        }
      }
    };
    await walk(input.targetConceptId, 0);
    const target = await prisma.courseKnowledgeConcept.findUnique({ where: { id: input.targetConceptId } });
    if (target && isProbablyKnowledgeConcept(target.title)) path.push({ conceptId: target.id, title: target.title, reason: 'target_concept' });
    return path;
  }

  async estimateConceptReadiness(input: {
    workspaceId: string;
    conceptId: string;
  }) {
    const concept = await prisma.courseKnowledgeConcept.findFirst({
      where: { id: input.conceptId, workspaceId: input.workspaceId },
      include: {
        learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 },
        incomingRelations: {
          where: { relationType: 'prerequisite', source: 'ai_kg_extraction' },
          include: { fromConcept: { include: { learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 } } } }
        },
        bindings: true,
        misconceptions: true
      }
    });
    if (!concept || !isProbablyKnowledgeConcept(concept.title)) return null;
    const state = concept.learnerStates[0];
    const prereqReadiness = concept.incomingRelations
      .filter((relation) => isProbablyKnowledgeConcept(relation.fromConcept.title))
      .map((relation) => relation.fromConcept.learnerStates[0]?.readinessEstimate ?? 0.45);
    const prereqAvg = prereqReadiness.length ? prereqReadiness.reduce((sum, value) => sum + value, 0) / prereqReadiness.length : 0.55;
    const misconceptionPenalty = Math.min(0.24, concept.misconceptions.length * 0.04);
    const resourceSupport = Math.min(0.18, concept.bindings.filter((binding) => binding.bindingType === 'resource').length * 0.03);
    const readiness = clamp01((state?.masteryEstimate ?? 0.5) * 0.34 + (state?.readinessEstimate ?? 0.5) * 0.28 + prereqAvg * 0.28 + resourceSupport - misconceptionPenalty);
    return {
      concept: { id: concept.id, title: concept.title },
      readiness,
      masteryEstimate: state?.masteryEstimate ?? 0.5,
      weaknessEstimate: state?.weaknessEstimate ?? 0.3,
      prerequisiteReadiness: prereqAvg,
      misconceptionPenalty,
      resourceSupport,
      evidence: parseJson<Record<string, unknown>>(state?.evidenceJson, {})
    };
  }
}

export const courseKnowledgeReasoningService = new CourseKnowledgeReasoningService();
