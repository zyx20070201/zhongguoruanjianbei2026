import crypto from 'crypto';
import prisma from '../config/db';

type EventRow = Awaited<ReturnType<typeof prisma.learningEvent.findMany>>[number];
type JsonRecord = Record<string, any>;

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);

const unique = (items: string[]) => Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean)));

const signalKeys = (event: EventRow) => parseJson<JsonRecord[]>(event.cognitiveSignalsJson, []).map((signal) => String(signal.key || ''));

const features = (event: EventRow) => parseJson<JsonRecord>(event.diagnosticFeaturesJson, {});

const concepts = (events: EventRow[]) =>
  unique(events.flatMap((event) => {
    const feature = features(event);
    return Array.isArray(feature.conceptCandidates) ? feature.conceptCandidates.map((item: unknown) => String(item || '')) : [];
  })).slice(0, 8);

const patternKey = (workspaceId: string, type: string, events: EventRow[]) =>
  `${type}:${hash([workspaceId, type, events.map((event) => event.id).join('|')].join('|'))}`;

const patternPayload = (type: string, events: EventRow[], confidence: number) => ({
  patternKey: patternKey(events[0].workspaceId, type, events),
  patternType: type,
  eventIdsJson: JSON.stringify(events.map((event) => event.id)),
  involvedConceptsJson: JSON.stringify(concepts(events)),
  signalSummaryJson: JSON.stringify({
    eventTypes: events.map((event) => event.eventType),
    eventFamilies: events.map((event) => event.eventFamily),
    dialogueActs: events.map((event) => features(event).dialogueAct).filter(Boolean),
    cognitiveSignals: unique(events.flatMap(signalKeys)),
    featureAverages: {
      confusion: average(events.map((event) => Number(features(event).confusionLevel) || 0)),
      helpSeeking: average(events.map((event) => Number(features(event).helpSeekingLevel) || 0)),
      mastery: average(events.map((event) => Number(features(event).masteryEvidenceLevel) || 0)),
      errorEvidence: average(events.map((event) => Number(features(event).errorEvidenceLevel) || 0))
    }
  }),
  windowStart: events[events.length - 1].observedAt,
  windowEnd: events[0].observedAt,
  confidence
});

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const hasSignal = (event: EventRow, key: string) => signalKeys(event).includes(key);

const hasDialogueAct = (event: EventRow, acts: string[]) => acts.includes(String(features(event).dialogueAct || ''));

export class LearningEventSequenceService {
  async detectAndStore(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    windowMinutes?: number;
    limit?: number;
  }) {
    const since = new Date(Date.now() - (input.windowMinutes || 180) * 60 * 1000);
    const events = await prisma.learningEvent.findMany({
      where: {
        workspaceId: input.workspaceId,
        observedAt: { gte: since },
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
        ...(input.goalId ? { goalId: input.goalId } : {})
      },
      orderBy: { observedAt: 'desc' },
      take: Math.min(Math.max(input.limit || 80, 8), 200)
    });
    if (events.length < 2) return [];

    const detected: ReturnType<typeof patternPayload>[] = [];
    const latest = events.slice(0, 12);

    const confusionChain = latest.filter((event) =>
      hasSignal(event, 'explicit_confusion') || hasSignal(event, 'repeated_question') || hasDialogueAct(event, ['confusion_statement', 'repair_or_reask'])
    );
    if (confusionChain.length >= 2) detected.push(patternPayload('repeated_confusion_or_repair', confusionChain.slice(0, 5), 0.68));

    const hintDependency = latest.filter((event) =>
      hasSignal(event, 'hint_dependency') || hasDialogueAct(event, ['hint_request'])
    );
    if (hintDependency.length >= 2) detected.push(patternPayload('hint_dependency_cluster', hintDependency.slice(0, 5), 0.64));

    const assessmentWindow = latest.filter((event) => event.eventFamily === 'assessment' || event.eventFamily === 'review');
    const errors = assessmentWindow.filter((event) => hasSignal(event, 'incorrect_answer') || hasSignal(event, 'retrieval_difficulty'));
    const laterMastery = assessmentWindow.filter((event) => hasSignal(event, 'correct_answer') || hasSignal(event, 'retrieval_strength'));
    if (errors.length >= 1 && laterMastery.length >= 1 && latest.indexOf(laterMastery[0]) < latest.indexOf(errors[0])) {
      detected.push(patternPayload('error_then_repair', [laterMastery[0], errors[0]], 0.66));
    }
    if (laterMastery.length >= 2) detected.push(patternPayload('mastery_reinforcement', laterMastery.slice(0, 4), 0.62));

    const resourceThenProduction = latest.filter((event) => event.eventFamily === 'resource' || event.eventFamily === 'production');
    if (
      resourceThenProduction.some((event) => event.eventFamily === 'resource') &&
      resourceThenProduction.some((event) => event.eventFamily === 'production')
    ) {
      detected.push(patternPayload('resource_to_artifact_flow', resourceThenProduction.slice(0, 6), 0.58));
    }

    const planningThenAction = latest.filter((event) => event.eventFamily === 'planning' || event.eventFamily === 'assessment' || event.eventFamily === 'production');
    if (
      planningThenAction.some((event) => event.eventFamily === 'planning') &&
      planningThenAction.some((event) => event.eventFamily === 'assessment' || event.eventFamily === 'production')
    ) {
      detected.push(patternPayload('plan_to_learning_action', planningThenAction.slice(0, 6), 0.6));
    }

    const saved = [];
    for (const pattern of detected) {
      saved.push(
        await prisma.learningEventSequencePattern.upsert({
          where: {
            workspaceId_patternKey: {
              workspaceId: input.workspaceId,
              patternKey: pattern.patternKey
            }
          },
          create: {
            ...pattern,
            workspaceId: input.workspaceId,
            workbenchId: input.workbenchId || events[0].workbenchId || null,
            goalId: input.goalId || events[0].goalId || null
          },
          update: {
            status: 'active',
            eventIdsJson: pattern.eventIdsJson,
            involvedConceptsJson: pattern.involvedConceptsJson,
            signalSummaryJson: pattern.signalSummaryJson,
            windowStart: pattern.windowStart,
            windowEnd: pattern.windowEnd,
            confidence: pattern.confidence
          }
        })
      );
    }
    return saved;
  }

  async list(input: {
    workspaceId: string;
    workbenchId?: string | null;
    patternType?: string;
    limit?: number;
  }) {
    const rows = await prisma.learningEventSequencePattern.findMany({
      where: {
        workspaceId: input.workspaceId,
        status: 'active',
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
        ...(input.patternType ? { patternType: input.patternType } : {})
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Math.max(input.limit || 20, 1), 100)
    });
    return rows.map((row) => ({
      id: row.id,
      patternKey: row.patternKey,
      patternType: row.patternType,
      eventIds: parseJson<string[]>(row.eventIdsJson, []),
      involvedConcepts: parseJson<string[]>(row.involvedConceptsJson, []),
      signalSummary: parseJson<JsonRecord>(row.signalSummaryJson, {}),
      confidence: row.confidence,
      windowStart: row.windowStart.toISOString(),
      windowEnd: row.windowEnd.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }));
  }
}

export const learningEventSequenceService = new LearningEventSequenceService();
