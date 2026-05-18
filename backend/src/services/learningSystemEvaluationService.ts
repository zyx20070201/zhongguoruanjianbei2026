import prisma from '../config/db';
import { courseKnowledgeExtractionValidationService } from './courseKnowledgeExtractionValidationService';
import { courseKnowledgeQualityEnhancementService } from './courseKnowledgeQualityEnhancementService';
import { graphConstrainedPlannerService } from './graphConstrainedPlannerService';
import { learningDiagnosisEngine } from './learningDiagnosisEngine';
import { learningPathOptimizationService } from './learningPathOptimizationService';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export class LearningSystemEvaluationService {
  async evaluate(input: { workspaceId: string; persist?: boolean }) {
    const [events, learnerEvidenceCount, diagnosisUpdateEvidenceCount, knowledgeTracingEvidenceCount, transitions, signals, diagnosis, kgValidation, kgQuality, graphPlan, optimizedPlan] = await Promise.all([
      prisma.learningEvent.findMany({ where: { workspaceId: input.workspaceId }, orderBy: { observedAt: 'desc' }, take: 250 }),
      prisma.learnerEvidence.count({ where: { workspaceId: input.workspaceId } }),
      prisma.learnerEvidence.count({ where: { workspaceId: input.workspaceId, evidenceType: 'learner_diagnosis_state_update' } }),
      prisma.learnerEvidence.count({ where: { workspaceId: input.workspaceId, evidenceType: 'knowledge_tracing_model_update' } }),
      prisma.learnerStateTransition.findMany({ where: { workspaceId: input.workspaceId }, orderBy: { createdAt: 'desc' }, take: 250 }),
      prisma.learnerStateSignal.findMany({ where: { workspaceId: input.workspaceId }, orderBy: { updatedAt: 'desc' }, take: 250 }),
      learningDiagnosisEngine.diagnose({ workspaceId: input.workspaceId, limit: 80 }).catch(() => null),
      courseKnowledgeExtractionValidationService.validate({ workspaceId: input.workspaceId }).catch(() => null),
      courseKnowledgeQualityEnhancementService.enhance({ workspaceId: input.workspaceId, apply: false }).catch(() => null),
      graphConstrainedPlannerService.buildCandidatePath({ workspaceId: input.workspaceId, maxConcepts: 6 }).catch(() => null),
      learningPathOptimizationService.optimize({ workspaceId: input.workspaceId, maxConcepts: 8 }).catch(() => null)
    ]);

    const eventQualityScores = events.map((event) => Number(parseJson<Record<string, unknown>>(event.qualityJson, {}).score || 0.5));
    const cognitiveSignalCoverage = events.filter((event) => parseJson<unknown[]>(event.cognitiveSignalsJson, []).length > 0).length / Math.max(events.length, 1);
    const diagnosticFeatureCoverage = events.filter((event) => Object.keys(parseJson<Record<string, unknown>>(event.diagnosticFeaturesJson, {})).length > 0).length / Math.max(events.length, 1);
    const appliedTransitions = transitions.filter((transition) => transition.status === 'applied').length;
    const pendingTransitions = transitions.filter((transition) => transition.status === 'pending').length;
    const stableSignalRatio = signals.filter((signal) => signal.layer === 'stable_profile' && signal.status === 'active').length / Math.max(signals.length, 1);

    const pillars = {
      eventCollection: Number((avg(eventQualityScores) * 0.45 + cognitiveSignalCoverage * 0.3 + diagnosticFeatureCoverage * 0.25).toFixed(3)),
      learnerState: Number(((Math.min(1, learnerEvidenceCount / 30) * 0.35) + (stableSignalRatio * 0.35) + (appliedTransitions / Math.max(transitions.length, 1)) * 0.3).toFixed(3)),
      knowledgeGraph: Number((((kgValidation?.summary.qualityScore ?? 0.35) * 0.62 + (kgQuality?.summary.graphQualityScore ?? 0.35) * 0.38)).toFixed(3)),
      diagnosis: Number((diagnosis?.summary.averageConfidence ?? 0.35).toFixed(3)),
      graphPlanning: Number((graphPlan
        ? (graphPlan.scores.graphConstraintCoverage * 0.24 + graphPlan.scores.zpdFit * 0.22 + graphPlan.scores.evidenceClosure * 0.24 + (optimizedPlan?.scores.confidence ?? 0.35) * 0.16 + (optimizedPlan?.scores.evidenceFit ?? 0.35) * 0.14)
        : 0.25).toFixed(3))
    };
    const diagnosisUpdateLoop = Number(Math.min(1, diagnosisUpdateEvidenceCount / 6).toFixed(3));
    const knowledgeTracingLoop = Number(Math.min(1, knowledgeTracingEvidenceCount / 4).toFixed(3));
    pillars.diagnosis = Number(Math.min(1, pillars.diagnosis * 0.68 + diagnosisUpdateLoop * 0.2 + knowledgeTracingLoop * 0.12).toFixed(3));
    const overall = Number(avg(Object.values(pillars)).toFixed(3));

    const report = {
      schema: 'learning_system_evaluation.v1',
      workspaceId: input.workspaceId,
      overall,
      targetCompletion: {
        estimatedEnterpriseReadiness: Number(Math.min(0.82, overall * 0.9 + 0.12).toFixed(3)),
        paperFrameworkAlignment: Number(Math.min(0.84, (pillars.learnerState + pillars.knowledgeGraph + pillars.diagnosis + pillars.graphPlanning) / 4 * 0.92 + 0.08).toFixed(3)),
        eightyPercentGate: overall >= 0.72 && pillars.learnerState >= 0.65 && pillars.knowledgeGraph >= 0.62 && pillars.graphPlanning >= 0.62
      },
      pillars,
      metrics: {
        eventCount: events.length,
        averageEventQuality: Number(avg(eventQualityScores).toFixed(3)),
        cognitiveSignalCoverage: Number(cognitiveSignalCoverage.toFixed(3)),
        diagnosticFeatureCoverage: Number(diagnosticFeatureCoverage.toFixed(3)),
        learnerEvidenceCount,
        diagnosisUpdateEvidenceCount,
        knowledgeTracingEvidenceCount,
        appliedTransitions,
        pendingTransitions,
        stableSignalRatio: Number(stableSignalRatio.toFixed(3)),
        diagnosisSummary: diagnosis?.summary || null,
        kgSummary: kgValidation?.summary || null,
        kgQualitySummary: kgQuality?.summary || null,
        graphPlanScores: graphPlan?.scores || null,
        optimizedPlanScores: optimizedPlan?.scores || null
      },
      recommendations: [
        cognitiveSignalCoverage < 0.65 ? 'Increase event taxonomy coverage for dialogue acts, hint use, repeated repair, and assessment outcomes.' : '',
        pendingTransitions > appliedTransitions ? 'Run learner-state governance more frequently to consolidate evidence-backed transitions.' : '',
        (kgValidation?.summary.qualityScore ?? 0) < 0.7 ? 'Improve KG extraction provenance, prerequisite edges, and concept-resource-assessment bindings.' : '',
        (kgQuality?.summary.graphQualityScore ?? 0) < 0.72 ? 'Run KG quality enhancement to canonicalize aliases, rescore edges, and identify missing evidence or assessment bindings.' : '',
        (diagnosis?.summary.averageConfidence ?? 0) < 0.6 ? 'Collect more assessment and interaction evidence before making high-stakes diagnosis decisions.' : '',
        knowledgeTracingEvidenceCount < 1 ? 'Run hybrid knowledge tracing so BKT/IRT/PFA estimates can calibrate concept mastery beyond heuristic deltas.' : '',
        graphPlan && graphPlan.scores.graphConstraintCoverage < 0.7 ? 'Bind more plan steps to KG prerequisites and resource/quiz evidence.' : '',
        optimizedPlan && optimizedPlan.scores.evidenceFit < 0.62 ? 'Improve planning optimizer evidence fit by adding resource/task/quiz bindings for selected path concepts.' : ''
        , diagnosisUpdateEvidenceCount < 2 ? 'Run event-based learner diagnosis updates so interaction evidence is consolidated into learner state.' : ''
      ].filter(Boolean)
    };
    if (input.persist) {
      await prisma.learnerEvidence.create({
        data: {
          workspaceId: input.workspaceId,
          evidenceType: 'learning_system_evaluation_snapshot',
          sourceType: 'learning_system_evaluation_service',
          actor: 'system',
          title: 'Learning system capability evaluation snapshot',
          summary: `Overall=${report.overall}, enterpriseReadiness=${report.targetCompletion.estimatedEnterpriseReadiness}, gate=${report.targetCompletion.eightyPercentGate}.`,
          payloadJson: JSON.stringify(report),
          confidence: report.overall
        }
      });
    }
    return report;
  }
}

export const learningSystemEvaluationService = new LearningSystemEvaluationService();
