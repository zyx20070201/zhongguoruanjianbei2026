import prisma from '../config/db';
import { courseKnowledgeGraphService } from './courseKnowledgeGraphService';

type JsonRecord = Record<string, any>;

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));
const logit = (value: number) => Math.log(clamp(value, 0.001, 0.999) / (1 - clamp(value, 0.001, 0.999)));
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export interface KnowledgeTracingObservation {
  eventId: string;
  conceptId: string;
  conceptTitle: string;
  correct: boolean | null;
  score: number | null;
  hintUsed: boolean;
  repeatedQuestion: boolean;
  confusion: number;
  helpSeeking: number;
  quality: number;
  difficulty: number;
  discrimination: number;
  observedAt: Date;
}

export class KnowledgeTracingModelService {
  async traceConcept(input: {
    workspaceId: string;
    conceptId: string;
    conceptTitle?: string;
    eventIds?: string[];
    since?: Date;
    apply?: boolean;
  }) {
    const observations = await this.loadObservations(input);
    const existing = await prisma.courseKnowledgeLearnerState.findUnique({
      where: {
        workspaceId_conceptId_stateScope: {
          workspaceId: input.workspaceId,
          conceptId: input.conceptId,
          stateScope: 'workspace'
        }
      }
    });
    const priorMastery = existing?.masteryEstimate ?? 0.5;
    const bkt = this.runBkt(observations, priorMastery);
    const irt = this.runIrt(observations, priorMastery);
    const pfa = this.runPfa(observations, priorMastery);
    const evidenceStrength = clamp01(Math.min(1, observations.length / 8) * 0.45 + avg(observations.map((item) => item.quality)) * 0.35 + (observations.some((item) => item.correct !== null) ? 0.2 : 0));
    const masteryEstimate = clamp01(bkt.mastery * 0.46 + irt.mastery * 0.32 + pfa.mastery * 0.22);
    const weaknessEstimate = clamp01((1 - masteryEstimate) * 0.52 + bkt.hintPenalty * 0.18 + bkt.confusionPenalty * 0.2 + (1 - evidenceStrength) * 0.1);
    const readinessEstimate = clamp01(masteryEstimate * 0.62 + evidenceStrength * 0.18 + (1 - weaknessEstimate) * 0.2);
    const report = {
      schema: 'knowledge_tracing_hybrid.v1',
      framework: {
        bkt: 'Bayesian Knowledge Tracing with learn/forget/slip/guess transition update',
        irt: '2PL-style ability update using item difficulty and discrimination',
        pfa: 'Performance Factors Analysis style success/failure accumulation',
        dktReady: 'sequence features are retained for later DKT/Transformer training when enough labelled data exists'
      },
      workspaceId: input.workspaceId,
      concept: { id: input.conceptId, title: input.conceptTitle || observations[0]?.conceptTitle || input.conceptId },
      observationCount: observations.length,
      estimates: {
        masteryEstimate: Number(masteryEstimate.toFixed(3)),
        weaknessEstimate: Number(weaknessEstimate.toFixed(3)),
        readinessEstimate: Number(readinessEstimate.toFixed(3)),
        evidenceStrength: Number(evidenceStrength.toFixed(3))
      },
      bkt,
      irt,
      pfa,
      sequenceFeatures: this.sequenceFeatures(observations)
    };

    if (input.apply && observations.length) {
      await courseKnowledgeGraphService.updateLearnerConceptState({
        workspaceId: input.workspaceId,
        conceptId: input.conceptId,
        masteryEstimate,
        weaknessEstimate,
        readinessEstimate,
        sourceSignalId: `kt:${input.conceptId}`,
        evidence: {
          source: 'hybrid_knowledge_tracing',
          eventIds: observations.map((item) => item.eventId),
          report
        }
      });
    }
    return report;
  }

  async traceWorkspace(input: { workspaceId: string; conceptIds?: string[]; since?: Date; apply?: boolean; limit?: number }) {
    const concepts = input.conceptIds?.length
      ? await prisma.courseKnowledgeConcept.findMany({ where: { workspaceId: input.workspaceId, id: { in: input.conceptIds } }, take: Math.min(input.conceptIds.length, 80) })
      : await prisma.courseKnowledgeConcept.findMany({
          where: { workspaceId: input.workspaceId, status: 'active' },
          orderBy: [{ activationScore: 'desc' }, { updatedAt: 'desc' }],
          take: Math.min(Math.max(input.limit || 40, 1), 120)
        });
    const reports = [];
    for (const concept of concepts) {
      const report = await this.traceConcept({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        conceptTitle: concept.title,
        since: input.since,
        apply: input.apply
      });
      if (report.observationCount) reports.push(report);
    }
    return {
      schema: 'workspace_knowledge_tracing.v1',
      workspaceId: input.workspaceId,
      conceptCount: concepts.length,
      tracedConceptCount: reports.length,
      reports
    };
  }

  private async loadObservations(input: {
    workspaceId: string;
    conceptId: string;
    conceptTitle?: string;
    eventIds?: string[];
    since?: Date;
  }): Promise<KnowledgeTracingObservation[]> {
    const concept = await prisma.courseKnowledgeConcept.findFirst({ where: { id: input.conceptId, workspaceId: input.workspaceId } });
    if (!concept) return [];
    const aliases = [concept.title, ...parseJson<string[]>(concept.aliasesJson, []), input.conceptTitle || '']
      .map((item) => String(item || '').toLowerCase().trim())
      .filter(Boolean);
    const events = await prisma.learningEvent.findMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.eventIds?.length ? { id: { in: input.eventIds } } : {}),
        ...(input.since ? { observedAt: { gte: input.since } } : {}),
        eventFamily: { in: ['assessment', 'dialogue', 'help', 'review', 'self_report'] }
      },
      orderBy: { observedAt: 'asc' },
      take: 400
    });
    return events
      .map((event) => {
        const features = parseJson<JsonRecord>(event.diagnosticFeaturesJson, {});
        const quality = parseJson<JsonRecord>(event.qualityJson, {});
        const payload = parseJson<JsonRecord>(event.payloadJson, {});
        const interaction = payload.interaction || {};
        const candidates = [
          ...(Array.isArray(features.conceptCandidates) ? features.conceptCandidates : []),
          event.objectType === 'concept' || event.objectType === 'course_knowledge_concept' ? event.objectId : '',
          payload?.object?.title,
          payload?.question?.skill,
          payload?.question?.learningObjective,
          ...(Array.isArray(payload?.question?.knowledgePoints) ? payload.question.knowledgePoints : [])
        ].map((item) => String(item || '').toLowerCase().trim());
        const matched = candidates.some((candidate) => aliases.some((alias) => candidate === alias || candidate.includes(alias) || alias.includes(candidate)));
        if (!matched) return null;
        const scoreRaw = interaction.score ?? payload.score ?? payload.result?.score;
        const score = Number.isFinite(Number(scoreRaw)) ? clamp01(Number(scoreRaw)) : null;
        const answerCorrect = interaction.answerCorrect ?? payload.result?.correct;
        const correct = typeof answerCorrect === 'boolean'
          ? answerCorrect
          : score === null
            ? null
            : score >= 0.72;
        const difficulty = this.inferDifficulty(payload, concept.difficulty, features);
        return {
          eventId: event.id,
          conceptId: concept.id,
          conceptTitle: concept.title,
          correct,
          score,
          hintUsed: Boolean(interaction.hintUsed || event.eventType === 'hint.used'),
          repeatedQuestion: Boolean(interaction.repeatedQuestion || features.dialogueAct === 'repair_or_reask'),
          confusion: Number(features.confusionLevel) || 0,
          helpSeeking: Number(features.helpSeekingLevel) || 0,
          quality: Number(quality.score) || event.confidence || 0.5,
          difficulty,
          discrimination: this.inferDiscrimination(event.eventFamily, payload, features),
          observedAt: event.observedAt
        };
      })
      .filter((item): item is KnowledgeTracingObservation => Boolean(item));
  }

  private runBkt(observations: KnowledgeTracingObservation[], priorMastery: number) {
    let mastery = clamp01(priorMastery);
    const transitionLog = [];
    for (const observation of observations) {
      const params = this.bktParams(observation);
      const evidenceCorrect = observation.correct ?? (observation.score !== null ? observation.score >= 0.72 : null);
      if (evidenceCorrect !== null) {
        const likelihoodCorrectGivenKnown = evidenceCorrect ? 1 - params.slip : params.slip;
        const likelihoodCorrectGivenUnknown = evidenceCorrect ? params.guess : 1 - params.guess;
        const posterior = (mastery * likelihoodCorrectGivenKnown) / Math.max(0.0001, mastery * likelihoodCorrectGivenKnown + (1 - mastery) * likelihoodCorrectGivenUnknown);
        mastery = posterior + (1 - posterior) * params.learn;
      } else {
        mastery = mastery + (1 - mastery) * params.learn * 0.35;
      }
      mastery = mastery * (1 - params.forget);
      transitionLog.push({ eventId: observation.eventId, mastery: Number(mastery.toFixed(3)), params, correct: evidenceCorrect });
    }
    return {
      mastery: Number(mastery.toFixed(3)),
      hintPenalty: Number(avg(observations.map((item) => item.hintUsed ? 0.65 : 0)).toFixed(3)),
      confusionPenalty: Number(avg(observations.map((item) => Math.max(item.confusion, item.repeatedQuestion ? 0.62 : 0))).toFixed(3)),
      transitionLog: transitionLog.slice(-12)
    };
  }

  private runIrt(observations: KnowledgeTracingObservation[], priorMastery: number) {
    const scored = observations.filter((item) => item.correct !== null);
    if (!scored.length) return { theta: Number(logit(priorMastery).toFixed(3)), mastery: priorMastery, logLikelihood: 0 };
    let theta = logit(priorMastery);
    for (let iter = 0; iter < 6; iter += 1) {
      let gradient = -0.08 * theta;
      for (const item of scored) {
        const y = item.correct ? 1 : 0;
        const p = sigmoid(item.discrimination * (theta - item.difficulty));
        gradient += item.discrimination * (y - p) * item.quality;
      }
      theta = clamp(theta + gradient * 0.18, -4, 4);
    }
    const mastery = sigmoid(theta);
    const logLikelihood = scored.reduce((sum, item) => {
      const p = clamp(sigmoid(item.discrimination * (theta - item.difficulty)), 0.001, 0.999);
      return sum + (item.correct ? Math.log(p) : Math.log(1 - p));
    }, 0);
    return { theta: Number(theta.toFixed(3)), mastery: Number(mastery.toFixed(3)), logLikelihood: Number(logLikelihood.toFixed(3)) };
  }

  private runPfa(observations: KnowledgeTracingObservation[], priorMastery: number) {
    let success = 0;
    let failure = 0;
    let hints = 0;
    observations.forEach((item) => {
      if (item.correct === true || (item.score !== null && item.score >= 0.72)) success += item.quality;
      if (item.correct === false || (item.score !== null && item.score < 0.55) || item.confusion >= 0.45) failure += item.quality;
      if (item.hintUsed || item.repeatedQuestion) hints += item.quality;
    });
    const theta = logit(priorMastery) + success * 0.42 - failure * 0.36 - hints * 0.18;
    return {
      success: Number(success.toFixed(3)),
      failure: Number(failure.toFixed(3)),
      hints: Number(hints.toFixed(3)),
      mastery: Number(sigmoid(theta).toFixed(3))
    };
  }

  private bktParams(observation: KnowledgeTracingObservation) {
    const assessment = observation.correct !== null;
    return {
      learn: clamp(
        0.08 + observation.quality * 0.08 + (observation.correct ? 0.04 : 0) - (observation.hintUsed ? 0.02 : 0),
        0.02,
        0.22
      ),
      forget: clamp(0.01 + observation.confusion * 0.02 + (observation.repeatedQuestion ? 0.015 : 0), 0.005, 0.08),
      slip: clamp(0.08 + observation.difficulty * 0.08 + observation.confusion * 0.08, 0.03, assessment ? 0.28 : 0.38),
      guess: clamp(0.18 - observation.difficulty * 0.06 + (observation.hintUsed ? 0.08 : 0), 0.05, 0.35)
    };
  }

  private inferDifficulty(payload: JsonRecord, fallback: number, features: JsonRecord) {
    const raw = payload?.question?.difficulty || payload?.difficulty;
    if (raw === 'easy') return -0.8;
    if (raw === 'hard') return 1.0;
    if (raw === 'medium') return 0.1;
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return clamp((numeric - 0.5) * 2, -2, 2);
    return clamp((fallback - 0.5) * 2 + (Number(features.helpSeekingLevel) || 0) * 0.3, -2, 2);
  }

  private inferDiscrimination(eventFamily: string, payload: JsonRecord, features: JsonRecord) {
    if (eventFamily === 'assessment') return 1.35;
    if (payload?.question?.type === 'short_answer' || payload?.question?.type === 'open_response') return 1.15;
    if (features.dialogueAct === 'self_explanation') return 0.95;
    return 0.75;
  }

  private sequenceFeatures(observations: KnowledgeTracingObservation[]) {
    return {
      dktReadyInput: observations.slice(-30).map((item) => ({
        conceptId: item.conceptId,
        eventId: item.eventId,
        correct: item.correct,
        score: item.score,
        hintUsed: item.hintUsed,
        confusion: item.confusion,
        helpSeeking: item.helpSeeking,
        difficulty: item.difficulty,
        observedAt: item.observedAt.toISOString()
      })),
      counts: {
        attempts: observations.length,
        correct: observations.filter((item) => item.correct === true).length,
        incorrect: observations.filter((item) => item.correct === false).length,
        hints: observations.filter((item) => item.hintUsed).length,
        repeatedQuestions: observations.filter((item) => item.repeatedQuestion).length
      }
    };
  }
}

export const knowledgeTracingModelService = new KnowledgeTracingModelService();
