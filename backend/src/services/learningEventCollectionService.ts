import prisma from '../config/db';
import { learnerStateService } from './learnerStateService';
import { learnerDiagnosisStateUpdateService } from './learnerDiagnosisStateUpdateService';
import { enrichLearningEvent } from './learningEventTaxonomy';
import { learningEventSequenceService } from './learningEventSequenceService';

export type LearningEventActor = 'user' | 'assistant' | 'system' | 'agent';

export type LearningEventType =
  | 'course.entered'
  | 'workbench.opened'
  | 'task.completed'
  | 'assignment.submitted'
  | 'quiz.completed'
  | 'quiz.answer_submitted'
  | 'resource.viewed'
  | 'ai.chat_turn'
  | 'hint.used'
  | 'learner.marked_unknown'
  | 'learner.marked_mastered'
  | string;

export interface CollectLearningEventInput {
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  eventType: LearningEventType;
  actor?: LearningEventActor;
  payload?: Record<string, unknown>;
  object?: {
    type?: string;
    id?: string | null;
    title?: string | null;
  };
  interaction?: {
    sessionId?: string | null;
    messageId?: string | null;
    turnIndex?: number | null;
    userText?: string | null;
    assistantText?: string | null;
    hintUsed?: boolean;
    repeatedQuestion?: boolean;
    markedUnknown?: boolean;
    markedMastered?: boolean;
    answerCorrect?: boolean | null;
    score?: number | null;
  };
  source?: {
    component?: string;
    route?: string;
    clientEventId?: string;
  };
  confidence?: number;
  observedAt?: Date;
  mirrorToEvidence?: boolean;
}

const stringify = (value: unknown, fallback = '{}') => {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback));
  } catch {
    return fallback;
  }
};

const clampConfidence = (value: number | undefined, fallback = 0.58) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
};

const evidenceSummary = (input: CollectLearningEventInput) => {
  if (input.interaction?.userText) return String(input.interaction.userText).slice(0, 240);
  if (input.object?.title) return `${input.eventType}: ${input.object.title}`;
  return input.eventType;
};

export class LearningEventCollectionService {
  async collect(input: CollectLearningEventInput) {
    const enrichment = enrichLearningEvent(input);
    const payload = {
      ...(input.payload || {}),
      object: input.object || null,
      interaction: input.interaction || null,
      source: input.source || null,
      diagnosticFeatures: enrichment.diagnosticFeatures,
      cognitiveSignals: enrichment.cognitiveSignals,
      eventFamily: enrichment.eventFamily,
      collectedAt: new Date().toISOString(),
      schema: 'learning_event_collection.v2'
    };
    if (enrichment.idempotencyKey) {
      const existing = await prisma.learningEvent.findUnique({
        where: { idempotencyKey: enrichment.idempotencyKey }
      }).catch(() => null);
      if (existing) return existing;
    }

    const event = await prisma.learningEvent.create({
      data: {
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        eventType: input.eventType,
        actor: enrichment.actor,
        schemaVersion: enrichment.schemaVersion,
        eventFamily: enrichment.eventFamily,
        objectType: enrichment.objectType,
        objectId: enrichment.objectId,
        sessionId: enrichment.sessionId,
        idempotencyKey: enrichment.idempotencyKey,
        payloadJson: stringify(payload),
        metadataJson: stringify({
          source: input.source || null,
          object: input.object || null,
          schemaVersion: enrichment.schemaVersion,
          eventFamily: enrichment.eventFamily,
          idempotencyKey: enrichment.idempotencyKey,
          interactionSignals: {
            hintUsed: Boolean(input.interaction?.hintUsed),
            repeatedQuestion: Boolean(input.interaction?.repeatedQuestion),
            markedUnknown: Boolean(input.interaction?.markedUnknown),
            markedMastered: Boolean(input.interaction?.markedMastered),
            answerCorrect: input.interaction?.answerCorrect ?? null,
            score: input.interaction?.score ?? null
          }
        }),
        cognitiveSignalsJson: stringify(enrichment.cognitiveSignals, '[]'),
        diagnosticFeaturesJson: stringify(enrichment.diagnosticFeatures),
        qualityJson: stringify(enrichment.quality),
        confidence: enrichment.confidence,
        observedAt: input.observedAt || new Date(),
        ...(input.observedAt ? { createdAt: input.observedAt } : {})
      }
    });

    if (input.mirrorToEvidence !== false) {
      await learnerStateService.recordEvidence({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        evidenceType: input.eventType,
        sourceType: 'learning_event',
        sourceId: event.id,
        actor: input.actor || 'system',
        title: input.object?.title || input.eventType,
        summary: evidenceSummary(input),
        payload: {
          ...payload,
          eventId: event.id,
          eventFamily: enrichment.eventFamily,
          cognitiveSignals: enrichment.cognitiveSignals,
          diagnosticFeatures: enrichment.diagnosticFeatures,
          quality: enrichment.quality
        },
        confidence: enrichment.confidence,
        observedAt: event.observedAt
      }).catch((error) => {
        console.warn('Failed to mirror learning event into learner evidence:', error);
      });
    }

    await learningEventSequenceService.detectAndStore({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      windowMinutes: 180,
      limit: 80
    }).catch((error) => {
      console.warn('Learning event sequence detection failed:', error);
    });

    if (['dialogue', 'assessment', 'help', 'review', 'self_report'].includes(enrichment.eventFamily)) {
      await learnerDiagnosisStateUpdateService.run({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        since: new Date(Date.now() - 6 * 60 * 60 * 1000),
        limit: 80,
        minConfidence: 0.5,
        apply: true,
        force: false
      }).catch((error) => {
        console.warn('Learning diagnosis state update failed:', error);
      });
    }

    return event;
  }

  async list(input: {
    workspaceId: string;
    workbenchId?: string | null;
    eventType?: string;
    actor?: string;
    objectType?: string;
    objectId?: string;
    limit?: number;
  }) {
    const events = await prisma.learningEvent.findMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
        ...(input.eventType ? { eventType: input.eventType } : {}),
        ...(input.actor ? { actor: input.actor } : {}),
        ...(input.objectType ? { objectType: input.objectType } : {}),
        ...(input.objectId ? { objectId: input.objectId } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(input.limit || 50, 1), 200)
    });
    return events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      actor: event.actor,
      schemaVersion: event.schemaVersion,
      eventFamily: event.eventFamily,
      workspaceId: event.workspaceId,
      workbenchId: event.workbenchId,
      goalId: event.goalId,
      objectType: event.objectType,
      objectId: event.objectId,
      sessionId: event.sessionId,
      confidence: event.confidence,
      payload: JSON.parse(event.payloadJson || '{}'),
      metadata: JSON.parse(event.metadataJson || '{}'),
      cognitiveSignals: JSON.parse(event.cognitiveSignalsJson || '[]'),
      diagnosticFeatures: JSON.parse(event.diagnosticFeaturesJson || '{}'),
      quality: JSON.parse(event.qualityJson || '{}'),
      observedAt: event.observedAt.toISOString(),
      createdAt: event.createdAt.toISOString()
    }));
  }
}

export const learningEventCollectionService = new LearningEventCollectionService();
