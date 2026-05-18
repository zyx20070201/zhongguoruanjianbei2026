import prisma from '../config/db';
import { courseKnowledgeReasoningService } from './courseKnowledgeReasoningService';
import { isProbablyKnowledgeConcept } from './learnerSignalSanitizer';
import { learnerStateService } from './learnerStateService';

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

export class LearningDiagnosisEngine {
  async diagnose(input: { workspaceId: string; conceptIds?: string[]; limit?: number }) {
    const rawConcepts = await prisma.courseKnowledgeConcept.findMany({
      where: {
        workspaceId: input.workspaceId,
        status: 'active',
        ...(input.conceptIds?.length ? { id: { in: input.conceptIds } } : {})
      },
      include: {
        learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 },
        misconceptions: { orderBy: { severity: 'desc' }, take: 5 },
        bindings: { take: 12 },
        incomingRelations: { where: { relationType: 'prerequisite' }, include: { fromConcept: true }, take: 12 },
        activations: { orderBy: { activatedAt: 'desc' }, take: 12 }
      },
      orderBy: [{ activationScore: 'desc' }, { updatedAt: 'desc' }],
      take: Math.min(Math.max((input.limit || 80) * 3, 20), 500)
    });
    const concepts = rawConcepts
      .filter((concept) => isProbablyKnowledgeConcept(concept.title))
      .slice(0, Math.min(Math.max(input.limit || 80, 1), 300));

    const conceptDiagnostics = [];
    for (const concept of concepts) {
      const state = concept.learnerStates[0];
      const readiness = await courseKnowledgeReasoningService.estimateConceptReadiness({
        workspaceId: input.workspaceId,
        conceptId: concept.id
      });
      const recentActivation = avg(concept.activations.map((item) => item.score));
      const assessmentBindings = concept.bindings.filter((binding) => binding.bindingType === 'quiz').length;
      const resourceBindings = concept.bindings.filter((binding) => binding.bindingType === 'resource').length;
      const weakness = state?.weaknessEstimate ?? 0.3;
      const mastery = state?.masteryEstimate ?? 0.5;
      const confidence = clamp01(
        0.25 +
          Math.min(0.22, concept.activations.length * 0.025) +
          Math.min(0.2, assessmentBindings * 0.04) +
          Math.min(0.16, resourceBindings * 0.025) +
          Math.min(0.17, concept.incomingRelations.length * 0.025)
      );
      conceptDiagnostics.push({
        concept: { id: concept.id, title: concept.title },
        masteryEstimate: Number(mastery.toFixed(3)),
        weaknessEstimate: Number(weakness.toFixed(3)),
        readinessEstimate: Number((readiness?.readiness ?? state?.readinessEstimate ?? 0.5).toFixed(3)),
        confidence: Number(confidence.toFixed(3)),
        diagnosis:
          weakness >= 0.62 ? 'weak'
            : mastery >= 0.72 && (readiness?.readiness ?? 0.5) >= 0.68 ? 'mastered'
              : (readiness?.readiness ?? 0.5) < 0.5 ? 'prerequisite_gap'
                : 'developing',
        misconceptions: concept.misconceptions.map((item) => ({
          title: item.title,
          severity: item.severity,
          repairHint: item.repairHint
        })),
        evidenceNeeds: [
          assessmentBindings === 0 ? 'needs_assessment_evidence' : '',
          resourceBindings === 0 ? 'needs_grounded_resource' : '',
          confidence < 0.5 ? 'needs_more_observations' : ''
        ].filter(Boolean),
        recentActivation: Number(recentActivation.toFixed(3))
      });
    }

    const gaps = await courseKnowledgeReasoningService.getPrerequisiteGaps({ workspaceId: input.workspaceId }).catch(() => []);
    return {
      schema: 'learning_diagnosis.v1',
      workspaceId: input.workspaceId,
      summary: {
        conceptCount: conceptDiagnostics.length,
        weakCount: conceptDiagnostics.filter((item) => item.diagnosis === 'weak').length,
        masteredCount: conceptDiagnostics.filter((item) => item.diagnosis === 'mastered').length,
        prerequisiteGapCount: gaps.length,
        averageConfidence: Number(avg(conceptDiagnostics.map((item) => item.confidence)).toFixed(3))
      },
      prerequisiteGaps: gaps.slice(0, 12),
      concepts: conceptDiagnostics.sort((a, b) => b.weaknessEstimate - a.weaknessEstimate)
    };
  }

  async diagnoseAndPersist(input: {
    workspaceId: string;
    conceptIds?: string[];
    limit?: number;
    workbenchId?: string | null;
    goalId?: string | null;
    applyStatePatches?: boolean;
  }) {
    const diagnosis = await this.diagnose(input);
    const evidence = await learnerStateService.recordEvidence({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      evidenceType: 'learning_diagnosis_snapshot',
      sourceType: 'learning_diagnosis_engine',
      actor: 'system',
      title: 'Concept-level learning diagnosis snapshot',
      summary: `Diagnosed ${diagnosis.summary.conceptCount} concepts; weak=${diagnosis.summary.weakCount}, gaps=${diagnosis.summary.prerequisiteGapCount}.`,
      payload: diagnosis,
      confidence: diagnosis.summary.averageConfidence || 0.55
    });

    const weakConcepts = diagnosis.concepts
      .filter((concept) => concept.diagnosis === 'weak' || concept.diagnosis === 'prerequisite_gap')
      .slice(0, 8);
    const masteredConcepts = diagnosis.concepts
      .filter((concept) => concept.diagnosis === 'mastered')
      .slice(0, 8);
    const misconceptionCandidates = diagnosis.concepts
      .flatMap((concept) => concept.misconceptions.map((item: any) => `${concept.concept.title}: ${item.title}`))
      .slice(0, 8);

    if (input.applyStatePatches) {
      if (weakConcepts.length || masteredConcepts.length) {
        await learnerStateService.proposePatch({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          targetDimension: 'knowledgeState',
          proposedBy: 'LearningDiagnosisEngine',
          evidenceId: evidence.id,
          confidence: Math.max(0.58, diagnosis.summary.averageConfidence || 0.55),
          rationale: 'Persisted concept-level diagnosis as governed learner-state update evidence.',
          payload: {
            candidateWeakSkills: weakConcepts.map((concept) => concept.concept.title),
            emergingStrengths: masteredConcepts.map((concept) => concept.concept.title),
            masterySignals: diagnosis.concepts.slice(0, 16).map((concept) => ({
              concept: concept.concept.title,
              score: concept.masteryEstimate,
              weakness: concept.weaknessEstimate,
              readiness: concept.readinessEstimate,
              confidence: concept.confidence,
              diagnosis: concept.diagnosis
            }))
          }
        });
      }
      if (misconceptionCandidates.length) {
        await learnerStateService.proposePatch({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          targetDimension: 'misconceptionState',
          proposedBy: 'LearningDiagnosisEngine',
          evidenceId: evidence.id,
          confidence: Math.max(0.55, diagnosis.summary.averageConfidence || 0.55),
          rationale: 'Persisted KG-linked misconception candidates from concept diagnosis.',
          payload: { candidateMisconceptions: misconceptionCandidates, candidates: misconceptionCandidates }
        });
      }
      await learnerStateService.applyPendingPatches(input.workspaceId, { changedBy: 'LearningDiagnosisEngine' });
    }

    return { diagnosis, evidenceId: evidence.id, appliedStatePatches: Boolean(input.applyStatePatches) };
  }
}

export const learningDiagnosisEngine = new LearningDiagnosisEngine();
