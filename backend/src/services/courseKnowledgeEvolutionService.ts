import prisma from '../config/db';
import { isPollutedLearningSignal } from './learnerSignalSanitizer';

const stringify = (value: unknown, fallback: unknown = {}) => {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
};

const parseEvidence = (value: string | null | undefined) => {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export class CourseKnowledgeEvolutionService {
  private async log(input: {
    workspaceId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    before?: unknown;
    after?: unknown;
    rationale: string;
    confidence?: number;
  }) {
    return prisma.courseKnowledgeGovernanceLog.create({
      data: {
        workspaceId: input.workspaceId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId || null,
        beforeJson: stringify(input.before || {}),
        afterJson: stringify(input.after || {}),
        rationale: input.rationale,
        confidence: input.confidence ?? 0.55
      }
    });
  }

  async applyActivationDecay(input: { workspaceId: string; decayRate?: number; staleDays?: number }) {
    const decayRate = input.decayRate ?? 0.88;
    const staleBefore = new Date(Date.now() - (input.staleDays || 14) * 24 * 60 * 60 * 1000);
    const concepts = await prisma.courseKnowledgeConcept.findMany({
      where: {
        workspaceId: input.workspaceId,
        activationScore: { gt: 0 },
        OR: [{ lastActivatedAt: null }, { lastActivatedAt: { lt: staleBefore } }]
      },
      take: 200
    });
    for (const concept of concepts) {
      const next = Number((concept.activationScore * decayRate).toFixed(4));
      await prisma.courseKnowledgeConcept.update({
        where: { id: concept.id },
        data: { activationScore: next }
      });
      await this.log({
        workspaceId: input.workspaceId,
        action: 'activation_decay',
        targetType: 'concept',
        targetId: concept.id,
        before: { activationScore: concept.activationScore },
        after: { activationScore: next },
        rationale: 'CogEvo-style knowledge activation decay keeps stale concepts from dominating planning.',
        confidence: 0.72
      });
    }
    return { decayed: concepts.length };
  }

  async markDuplicateConcepts(input: { workspaceId: string }) {
    const concepts = await prisma.courseKnowledgeConcept.findMany({
      where: { workspaceId: input.workspaceId, status: 'active' },
      orderBy: [{ activationScore: 'desc' }, { updatedAt: 'desc' }]
    });
    const groups = new Map<string, typeof concepts>();
    for (const concept of concepts) {
      const key = normalize(concept.title);
      groups.set(key, [...(groups.get(key) || []), concept]);
    }
    let merged = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [primary, ...duplicates] = group;
      for (const duplicate of duplicates) {
        await prisma.courseKnowledgeConcept.update({
          where: { id: duplicate.id },
          data: {
            status: 'merged',
            evidenceJson: stringify({
              mergedIntoConceptId: primary.id,
              mergedIntoTitle: primary.title,
              reason: 'normalized_title_duplicate'
            })
          }
        });
        await this.log({
          workspaceId: input.workspaceId,
          action: 'concept_merge_marked',
          targetType: 'concept',
          targetId: duplicate.id,
          before: { title: duplicate.title, status: duplicate.status },
          after: { status: 'merged', mergedIntoConceptId: primary.id },
          rationale: 'Duplicate normalized concept marked for graph governance.',
          confidence: 0.62
        });
        merged += 1;
      }
    }
    return { merged };
  }

  async archivePollutedConcepts(input: { workspaceId: string }) {
    const concepts = await prisma.courseKnowledgeConcept.findMany({
      where: { workspaceId: input.workspaceId, status: 'active' },
      include: {
        outgoingRelations: true,
        incomingRelations: true
      },
      take: 1000
    });
    let archived = 0;
    let relationsDownranked = 0;
    for (const concept of concepts.filter((item) => isPollutedLearningSignal(item.title))) {
      const before = { title: concept.title, source: concept.source, status: concept.status, activationScore: concept.activationScore };
      const relationIds = [...concept.outgoingRelations, ...concept.incomingRelations].map((relation) => relation.id);
      if (relationIds.length) {
        await prisma.courseKnowledgeRelation.updateMany({
          where: { id: { in: relationIds } },
          data: {
            confidence: 0.05,
            weight: 0.05,
            evidenceJson: stringify({ governance: 'downranked because endpoint concept was classified as polluted_internal_prompt' })
          }
        });
        relationsDownranked += relationIds.length;
      }
      await prisma.courseKnowledgeConcept.update({
        where: { id: concept.id },
        data: {
          status: 'archived_polluted',
          activationScore: 0,
          evidenceJson: stringify({
            ...parseEvidence(concept.evidenceJson),
            archivedReason: 'polluted_internal_prompt_or_non_concept_signal',
            archivedAt: new Date().toISOString()
          })
        }
      });
      await this.log({
        workspaceId: input.workspaceId,
        action: 'concept_archived_polluted',
        targetType: 'concept',
        targetId: concept.id,
        before,
        after: { status: 'archived_polluted', activationScore: 0, relationIds },
        rationale: 'Graph governance archived a concept title that matches internal tool prompt / non-concept signal filters.',
        confidence: 0.86
      });
      archived += 1;
    }
    return { archived, relationsDownranked };
  }

  async updateRelationWeightsFromLearnerState(input: { workspaceId: string }) {
    const relations = await prisma.courseKnowledgeRelation.findMany({
      where: { workspaceId: input.workspaceId, relationType: 'prerequisite' },
      include: {
        fromConcept: { include: { learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 } } },
        toConcept: { include: { learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 } } }
      },
      take: 300
    });
    let updated = 0;
    for (const relation of relations) {
      if (isPollutedLearningSignal(relation.fromConcept.title) || isPollutedLearningSignal(relation.toConcept.title)) continue;
      const fromState = relation.fromConcept.learnerStates[0];
      const toState = relation.toConcept.learnerStates[0];
      if (!fromState || !toState) continue;
      const coWeak = fromState.weaknessEstimate >= 0.55 && toState.weaknessEstimate >= 0.55;
      const coReady = fromState.readinessEstimate >= 0.72 && toState.readinessEstimate >= 0.72;
      if (!coWeak && !coReady) continue;
      const nextWeight = clamp01(relation.weight + (coWeak ? 0.06 : 0.02));
      const nextConfidence = clamp01(relation.confidence + (coWeak ? 0.05 : 0.03));
      await prisma.courseKnowledgeRelation.update({
        where: { id: relation.id },
        data: {
          weight: nextWeight,
          confidence: nextConfidence,
          evidenceJson: stringify({
            learnerStateCoEvidence: coWeak ? 'co_weak_prerequisite_chain' : 'co_ready_prerequisite_chain',
            from: { weakness: fromState.weaknessEstimate, readiness: fromState.readinessEstimate },
            to: { weakness: toState.weaknessEstimate, readiness: toState.readinessEstimate }
          })
        }
      });
      await this.log({
        workspaceId: input.workspaceId,
        action: 'relation_weight_update',
        targetType: 'relation',
        targetId: relation.id,
        before: { weight: relation.weight, confidence: relation.confidence },
        after: { weight: nextWeight, confidence: nextConfidence },
        rationale: 'Learner-state co-evidence adjusted prerequisite relation strength.',
        confidence: nextConfidence
      });
      updated += 1;
    }
    return { updated };
  }

  async govern(input: { workspaceId: string }) {
    const [polluted, decay, duplicates, relations] = await Promise.all([
      this.archivePollutedConcepts({ workspaceId: input.workspaceId }),
      this.applyActivationDecay({ workspaceId: input.workspaceId }),
      this.markDuplicateConcepts({ workspaceId: input.workspaceId }),
      this.updateRelationWeightsFromLearnerState({ workspaceId: input.workspaceId })
    ]);
    return { polluted, decay, duplicates, relations };
  }
}

export const courseKnowledgeEvolutionService = new CourseKnowledgeEvolutionService();
