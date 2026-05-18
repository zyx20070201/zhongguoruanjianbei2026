import prisma from '../../config/db';
import { conceptKeyFor } from '../courseKnowledgeGraphService';
import { courseKnowledgeReasoningService } from '../courseKnowledgeReasoningService';
import { graphConstrainedPlannerService } from '../graphConstrainedPlannerService';
import { filterKnowledgeConcepts } from '../learnerSignalSanitizer';
import { learnerStateService } from '../learnerStateService';
import { KgPlanningHints } from '../planningTypes';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const normalize = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
const unique = (items: Array<string | null | undefined>, limit = 24) =>
  Array.from(new Set(items.map(normalize).filter((item) => item.length >= 2))).slice(0, limit);

const bindingEvidenceLabel = (binding: {
  bindingType: string;
  targetType: string;
  targetId: string;
  role: string;
  evidenceJson: string;
}) => {
  const evidence = parseJson<Record<string, any>>(binding.evidenceJson, {});
  const source = evidence.fileName || evidence.title || evidence.question?.question || binding.targetId;
  return `${binding.bindingType}:${binding.role}:${source}`;
};

export class KgConstraintProviderService {
  async build(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    objective?: string;
    targetConcepts?: string[];
    maxConcepts?: number;
  }): Promise<KgPlanningHints> {
    const [centralState, activeGoal] = await Promise.all([
      learnerStateService.ensureState({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null
      }),
      input.goalId
        ? prisma.learningGoal.findFirst({ where: { id: input.goalId, workspaceId: input.workspaceId } })
        : prisma.learningGoal.findFirst({ where: { workspaceId: input.workspaceId, status: 'active' }, orderBy: { updatedAt: 'desc' } })
    ]);

    const masteredTitles = filterKnowledgeConcepts(unique([
      ...centralState.coreState.stableProfile.masteredKnowledge.map((signal) => signal.value),
      ...centralState.coreState.stableProfile.learningGoals.map((signal) => signal.value).filter((value) => /已掌握|mastered/i.test(value))
    ], 24), 20);
    const weakTitles = filterKnowledgeConcepts(unique([
      ...centralState.coreState.stableProfile.weakKnowledge.map((signal) => signal.value),
      ...centralState.coreState.workingState.currentCourseState.focusKnowledge.map((signal) => signal.value),
      ...(activeGoal ? parseJson<string[]>(activeGoal.weaknessesJson, []) : [])
    ], 28), 24);
    const targetTitles = filterKnowledgeConcepts(unique([
      ...(input.targetConcepts || []),
      ...(activeGoal ? parseJson<string[]>(activeGoal.skillsJson, []) : []),
      ...centralState.coreState.workingState.currentCourseState.activeGoals.map((signal) => signal.value)
    ], 28), 24);

    const titleSeeds = unique([...masteredTitles, ...weakTitles, ...targetTitles], 48);
    const conceptKeys = titleSeeds.map((title) => conceptKeyFor(input.workspaceId, title));
    const seedConcepts = conceptKeys.length
      ? await prisma.courseKnowledgeConcept.findMany({
          where: { workspaceId: input.workspaceId, conceptKey: { in: conceptKeys }, status: 'active' },
          include: {
            learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 },
            bindings: {
              where: input.workbenchId ? { OR: [{ workbenchId: input.workbenchId }, { workbenchId: null }] } : undefined,
              orderBy: [{ strength: 'desc' }, { confidence: 'desc' }],
              take: 8
            }
          }
        })
      : [];
    const seedIds = seedConcepts.map((concept) => concept.id);
    const neighborRelations = seedIds.length
      ? await prisma.courseKnowledgeRelation.findMany({
          where: {
            workspaceId: input.workspaceId,
            OR: [{ fromConceptId: { in: seedIds } }, { toConceptId: { in: seedIds } }]
          },
          include: { fromConcept: true, toConcept: true },
          orderBy: [{ relationType: 'asc' }, { weight: 'desc' }],
          take: 240
        })
      : [];

    const prerequisiteGaps = await courseKnowledgeReasoningService.getPrerequisiteGaps({
      workspaceId: input.workspaceId,
      conceptIds: seedIds.length ? seedIds : undefined
    }).catch(() => []);
    const graphCandidates = await graphConstrainedPlannerService.buildCandidatePath({
      workspaceId: input.workspaceId,
      objective: input.objective,
      conceptIds: seedIds.length ? seedIds : undefined,
      maxConcepts: Math.min(input.maxConcepts || 8, 12)
    }).catch(() => null);

    const conceptById = new Map(seedConcepts.map((concept) => [concept.id, concept] as const));
    const relationConceptTitles = neighborRelations.flatMap((relation) => [relation.fromConcept.title, relation.toConcept.title]);
    const graphTargetTitles = Array.isArray(graphCandidates?.targetConcepts)
      ? graphCandidates.targetConcepts.map((concept: any) => concept.title).filter(Boolean)
      : [];
    const weakConcepts = filterKnowledgeConcepts(unique([
      ...weakTitles,
      ...graphTargetTitles,
      ...prerequisiteGaps.map((gap: any) => gap.prerequisite?.title || gap.targetConcept?.title)
    ], 28), 24);
    const targetConcepts = filterKnowledgeConcepts(unique([...targetTitles, ...relationConceptTitles, ...graphTargetTitles], 28), 24);
    const masteredConcepts = filterKnowledgeConcepts(unique([
      ...masteredTitles,
      ...seedConcepts
        .filter((concept) => Number(concept.learnerStates[0]?.masteryEstimate || 0) >= 0.72)
        .map((concept) => concept.title)
    ], 24), 20);

    const bindingEvidence = seedConcepts.flatMap((concept) =>
      concept.bindings.map((binding) => `${concept.title} -> ${bindingEvidenceLabel(binding)}`)
    );

    return {
      masteredConcepts,
      weakConcepts,
      targetConcepts,
      prerequisiteEdges: neighborRelations
        .filter((relation) => relation.relationType === 'prerequisite')
        .slice(0, 80)
        .map((relation) => ({
          from: relation.fromConcept.title,
          to: relation.toConcept.title,
          relation: relation.relationType,
          weight: relation.weight
        })),
      riskJumps: unique([
        ...prerequisiteGaps.map((gap: any) => `${gap.prerequisite?.title || '前置知识'} -> ${gap.targetConcept?.title || '目标知识'}`),
        ...(Array.isArray(graphCandidates?.steps)
          ? graphCandidates.steps
              .filter((step: any) => Array.isArray(step.prerequisites) && step.prerequisites.length)
              .map((step: any) => `${step.prerequisites.slice(0, 2).join(' + ')} -> ${step.conceptTitle}`)
          : [])
      ], 14),
      recommendedOrderHints: filterKnowledgeConcepts(unique([
        ...prerequisiteGaps.map((gap: any) => gap.prerequisite?.title),
        ...(Array.isArray(graphCandidates?.targetConcepts) ? graphCandidates.targetConcepts.map((concept: any) => concept.title) : []),
        ...weakConcepts,
        ...targetConcepts
      ], 28), 24),
      evidence: [
        `kgConstraintProvider=v1`,
        `seedConcepts=${seedConcepts.length}`,
        `relations=${neighborRelations.length}`,
        `prerequisiteGaps=${prerequisiteGaps.length}`,
        `graphCandidateConcepts=${Array.isArray(graphCandidates?.targetConcepts) ? graphCandidates.targetConcepts.length : 0}`,
        `resourceBindings=${bindingEvidence.length}`,
        ...bindingEvidence.slice(0, 8),
        ...Array.from(conceptById.values()).slice(0, 4).map((concept) => `concept:${concept.title}`)
      ]
    };
  }
}

export const kgConstraintProviderService = new KgConstraintProviderService();
