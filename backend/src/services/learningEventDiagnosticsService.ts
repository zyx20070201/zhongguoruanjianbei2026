import prisma from '../config/db';

type JsonRecord = Record<string, any>;

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

const topCounts = (items: string[], limit = 8) => {
  const counts = new Map<string, number>();
  items.filter(Boolean).forEach((item) => counts.set(item, (counts.get(item) || 0) + 1));
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
};

export class LearningEventDiagnosticsService {
  async summarize(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    days?: number;
    limit?: number;
  }) {
    const since = new Date(Date.now() - (input.days || 30) * 24 * 60 * 60 * 1000);
    const events = await prisma.learningEvent.findMany({
      where: {
        workspaceId: input.workspaceId,
        observedAt: { gte: since },
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
        ...(input.goalId ? { goalId: input.goalId } : {})
      },
      orderBy: { observedAt: 'desc' },
      take: Math.min(Math.max(input.limit || 120, 1), 500)
    });
    const sequencePatterns = await prisma.learningEventSequencePattern.findMany({
      where: {
        workspaceId: input.workspaceId,
        status: 'active',
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
        ...(input.goalId ? { goalId: input.goalId } : {})
      },
      orderBy: { updatedAt: 'desc' },
      take: 12
    }).catch(() => []);

    const features = events.map((event) => parseJson<JsonRecord>(event.diagnosticFeaturesJson, {}));
    const qualities = events.map((event) => parseJson<JsonRecord>(event.qualityJson, {}));
    const signalRows = events.flatMap((event) => parseJson<JsonRecord[]>(event.cognitiveSignalsJson, []));
    const conceptCandidates = features.flatMap((feature) =>
      Array.isArray(feature.conceptCandidates) ? feature.conceptCandidates.map((item: unknown) => String(item || '').trim()) : []
    );
    const familyCounts = topCounts(events.map((event) => event.eventFamily), 12);
    const signalCounts = topCounts(signalRows.map((signal) => String(signal.key || '')), 16);

    const metric = (key: string) => avg(features.map((feature) => Number(feature[key]) || 0));
    const qualityScore = avg(qualities.map((quality) => Number(quality.score) || 0));
    const acceptedRatio = events.length
      ? qualities.filter((quality) => quality.status === 'accepted').length / events.length
      : 0;

    const riskScores = {
      helpSeeking: metric('helpSeekingLevel'),
      confusion: metric('confusionLevel'),
      errorEvidence: metric('errorEvidenceLevel'),
      reviewPressure: metric('reviewPressureLevel')
    };
    const strengthScores = {
      masteryEvidence: metric('masteryEvidenceLevel'),
      engagement: metric('engagementLevel'),
      planningIntent: metric('planningIntentLevel'),
      artifactProduction: metric('artifactProductionLevel')
    };

    return {
      schema: 'learning_event_diagnostic_summary.v1',
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      windowDays: input.days || 30,
      eventCount: events.length,
      quality: {
        averageScore: Number(qualityScore.toFixed(3)),
        acceptedRatio: Number(acceptedRatio.toFixed(3)),
        lowQualityCount: qualities.filter((quality) => quality.status && quality.status !== 'accepted').length
      },
      eventFamilies: familyCounts,
      cognitiveSignals: signalCounts,
      conceptCandidates: topCounts(conceptCandidates, 10),
      sequencePatterns: sequencePatterns.map((pattern) => ({
        patternType: pattern.patternType,
        confidence: pattern.confidence,
        involvedConcepts: parseJson<string[]>(pattern.involvedConceptsJson, []),
        signalSummary: parseJson<JsonRecord>(pattern.signalSummaryJson, {}),
        windowStart: pattern.windowStart.toISOString(),
        windowEnd: pattern.windowEnd.toISOString()
      })),
      riskScores: Object.fromEntries(Object.entries(riskScores).map(([key, value]) => [key, Number(clamp01(value).toFixed(3))])),
      strengthScores: Object.fromEntries(Object.entries(strengthScores).map(([key, value]) => [key, Number(clamp01(value).toFixed(3))])),
      diagnosticHints: [
        riskScores.confusion >= 0.45 ? 'recent_confusion_high' : '',
        riskScores.helpSeeking >= 0.45 ? 'help_seeking_high' : '',
        riskScores.errorEvidence >= 0.4 ? 'assessment_error_evidence' : '',
        riskScores.reviewPressure >= 0.4 ? 'review_pressure_high' : '',
        sequencePatterns.some((pattern) => pattern.patternType === 'repeated_confusion_or_repair') ? 'sequence_repeated_confusion' : '',
        sequencePatterns.some((pattern) => pattern.patternType === 'hint_dependency_cluster') ? 'sequence_hint_dependency' : '',
        sequencePatterns.some((pattern) => pattern.patternType === 'error_then_repair') ? 'sequence_error_repaired' : '',
        strengthScores.masteryEvidence >= 0.45 ? 'mastery_evidence_present' : '',
        qualityScore < 0.5 ? 'event_quality_needs_attention' : ''
      ].filter(Boolean)
    };
  }
}

export const learningEventDiagnosticsService = new LearningEventDiagnosticsService();
