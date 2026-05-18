import prisma from '../config/db';
import { stableHash } from './chunkSchema';
import { courseKnowledgeGraphService } from './courseKnowledgeGraphService';
import { knowledgeTracingModelService } from './knowledgeTracingModelService';
import { filterCleanLearningSignals, isPollutedLearningSignal } from './learnerSignalSanitizer';
import { learnerStateService } from './learnerStateService';

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

const normalize = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();

const unique = (items: Array<string | null | undefined>) =>
  Array.from(new Set(items.map((item) => normalize(item)).filter((item) => item.length >= 2)));

const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

type ConceptAccumulator = {
  title: string;
  eventIds: string[];
  evidenceIds: string[];
  masteryEvidence: number[];
  errorEvidence: number[];
  confusion: number[];
  helpSeeking: number[];
  hintDependency: number[];
  selfRepair: number[];
  quality: number[];
  dialogueActs: string[];
  misconceptionTexts: string[];
};

type DiagnosisStateUpdateReport = {
  schema: 'learner_diagnosis_state_update.v1';
  workspaceId: string;
  workbenchId: string | null;
  goalId: string | null;
  window: { since: string; eventCount: number };
  summary: {
    candidateConcepts: number;
    acceptedUpdates: number;
    pendingUpdates: number;
    rejectedUpdates: number;
    ungroundedDiagnosticEvents: number;
    highRiskConcepts: number;
    masteryImprovingConcepts: number;
  };
  updates: Array<Record<string, any>>;
  pendingUpdates: Array<Record<string, any>>;
  rejectedUpdates: Array<Record<string, any>>;
  ungroundedEventIds: string[];
};

export class LearnerDiagnosisStateUpdateService {
  async run(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    since?: Date;
    limit?: number;
    minConfidence?: number;
    apply?: boolean;
    force?: boolean;
  }) {
    const previousEvidence = await prisma.learnerEvidence.findFirst({
      where: {
        workspaceId: input.workspaceId,
        evidenceType: 'learner_diagnosis_state_update',
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {})
      },
      orderBy: { observedAt: 'desc' }
    });
    const previousPayload = parseJson<{ window?: { since?: string }; updates?: Array<{ eventIds?: string[] }> }>(previousEvidence?.payloadJson, {});
    const processedEventIds = new Set((previousPayload.updates || []).flatMap((update) => update.eventIds || []));
    const since = input.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const events = await prisma.learningEvent.findMany({
      where: {
        workspaceId: input.workspaceId,
        observedAt: { gte: since },
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
        ...(input.goalId ? { goalId: input.goalId } : {}),
        ...(input.force ? {} : processedEventIds.size ? { id: { notIn: Array.from(processedEventIds).slice(0, 900) } } : {})
      },
      orderBy: { observedAt: 'asc' },
      take: Math.min(Math.max(input.limit || 200, 1), 800)
    });

    const groups = new Map<string, ConceptAccumulator>();
    const ungrounded: string[] = [];
    const titleToConcept = await this.buildConceptGroundingIndex(input.workspaceId);

    for (const event of events) {
      const features = parseJson<JsonRecord>(event.diagnosticFeaturesJson, {});
      const quality = parseJson<JsonRecord>(event.qualityJson, {});
      const signals = parseJson<JsonRecord[]>(event.cognitiveSignalsJson, []);
      const payload = parseJson<JsonRecord>(event.payloadJson, {});
      const concepts = unique([
        ...(Array.isArray(features.conceptCandidates) ? features.conceptCandidates : []),
        event.objectType === 'course_knowledge_concept' || event.objectType === 'concept' ? event.objectId || '' : '',
        payload?.object?.title,
        payload?.question?.skill,
        payload?.question?.learningObjective,
        ...(Array.isArray(payload?.question?.knowledgePoints) ? payload.question.knowledgePoints : [])
      ]).slice(0, 8);

      if (!concepts.length && (features.confusionLevel || features.errorEvidenceLevel || features.helpSeekingLevel)) {
        ungrounded.push(event.id);
      }

      for (const rawTitle of concepts) {
        const grounded = this.groundConcept(rawTitle, titleToConcept);
        const title = grounded?.title || rawTitle;
        const key = grounded?.id || title.toLowerCase();
        const current = groups.get(key) || {
          title,
          eventIds: [],
          evidenceIds: [],
          masteryEvidence: [],
          errorEvidence: [],
          confusion: [],
          helpSeeking: [],
          hintDependency: [],
          selfRepair: [],
          quality: [],
          dialogueActs: [],
          misconceptionTexts: []
        };
        (current as any).groundedConceptId = grounded?.id || null;
        (current as any).groundingConfidence = grounded?.confidence || 0.38;
        (current as any).groundingStatus = grounded ? 'matched_kg' : 'ungrounded_candidate';
        current.eventIds.push(event.id);
        current.evidenceIds.push(event.id);
        current.masteryEvidence.push(Number(features.masteryEvidenceLevel) || 0);
        current.errorEvidence.push(Number(features.errorEvidenceLevel) || 0);
        current.confusion.push(Number(features.confusionLevel) || 0);
        current.helpSeeking.push(Number(features.helpSeekingLevel) || 0);
        current.quality.push(Number(quality.score) || event.confidence || 0.5);
        if (features.dialogueAct) current.dialogueActs.push(String(features.dialogueAct));
        if (signals.some((signal) => signal.key === 'hint_dependency')) current.hintDependency.push(Math.max(...signals.filter((signal) => signal.key === 'hint_dependency').map((signal) => Number(signal.strength) || 0.5)));
        if (features.dialogueAct === 'repair_or_reask' || signals.some((signal) => signal.key === 'repeated_question')) current.selfRepair.push(0.65);
        const userText = normalize(payload?.interaction?.userText);
        if ((Number(features.errorEvidenceLevel) > 0.35 || Number(features.confusionLevel) > 0.4) && userText) {
          current.misconceptionTexts.push(userText.slice(0, 180));
        }
        groups.set(key, current);
      }
    }

    const updates = [];
    const pendingUpdates = [];
    const rejectedUpdates = [];
    const minConfidence = input.minConfidence ?? 0.42;

    for (const group of groups.values()) {
      const eventCount = group.eventIds.length;
      const qualityScore = avg(group.quality);
      const mastery = avg(group.masteryEvidence);
      const error = avg(group.errorEvidence);
      const confusion = avg(group.confusion);
      const helpSeeking = avg(group.helpSeeking);
      const hintDependency = avg(group.hintDependency);
      const repair = avg(group.selfRepair);
      const groundingConfidence = Number((group as any).groundingConfidence || 0.38);
      const confidence = clamp01(qualityScore * 0.28 + Math.min(0.22, eventCount * 0.03) + Math.max(mastery, error, confusion, helpSeeking) * 0.3 + groundingConfidence * 0.2);

      const masteryDelta = clamp((mastery * 0.16 + repair * 0.04) - (error * 0.14 + confusion * 0.06 + hintDependency * 0.04), -0.18, 0.18);
      const weaknessDelta = clamp((error * 0.16 + confusion * 0.1 + hintDependency * 0.08) - mastery * 0.1 - repair * 0.03, -0.16, 0.2);
      const readinessDelta = clamp((mastery * 0.12 + repair * 0.05) - (confusion * 0.1 + helpSeeking * 0.04 + error * 0.08), -0.16, 0.14);
      const diagnosis =
        error >= 0.45 || confusion >= 0.52 || hintDependency >= 0.55
          ? 'needs_support'
          : mastery >= 0.55 && error < 0.25
            ? 'improving_or_mastered'
            : helpSeeking >= 0.45
              ? 'help_seeking'
              : 'developing';

      const candidate = {
        conceptTitle: group.title,
        groundedConceptId: (group as any).groundedConceptId || null,
        groundingStatus: (group as any).groundingStatus || 'ungrounded_candidate',
        groundingConfidence: Number(groundingConfidence.toFixed(3)),
        eventCount,
        eventIds: Array.from(new Set(group.eventIds)).slice(0, 30),
        evidenceIds: Array.from(new Set(group.evidenceIds)).slice(0, 30),
        confidence: Number(confidence.toFixed(3)),
        diagnosis,
        scores: {
          masteryEvidence: Number(mastery.toFixed(3)),
          errorEvidence: Number(error.toFixed(3)),
          confusion: Number(confusion.toFixed(3)),
          helpSeeking: Number(helpSeeking.toFixed(3)),
          hintDependency: Number(hintDependency.toFixed(3)),
          selfRepair: Number(repair.toFixed(3)),
          quality: Number(qualityScore.toFixed(3))
        },
        deltas: {
          masteryDelta: Number(masteryDelta.toFixed(3)),
          weaknessDelta: Number(weaknessDelta.toFixed(3)),
          readinessDelta: Number(readinessDelta.toFixed(3))
        },
        dialogueActs: Array.from(new Set(group.dialogueActs)).slice(0, 8),
        misconceptionTexts: Array.from(new Set(group.misconceptionTexts)).slice(0, 5)
      };
      const hasStrongOutcome = mastery >= 0.42 || error >= 0.38 || confusion >= 0.45 || hintDependency >= 0.42;
      const isGroundedEnough = candidate.groundedConceptId || groundingConfidence >= 0.62;
      if (confidence >= minConfidence && hasStrongOutcome && isGroundedEnough) {
        updates.push(candidate);
      } else if (confidence >= 0.32 && hasStrongOutcome) {
        pendingUpdates.push({
          ...candidate,
          reason: isGroundedEnough ? 'needs_more_repeated_evidence' : 'needs_concept_grounding_review'
        });
      } else {
        rejectedUpdates.push({
          ...candidate,
          reason: 'low_confidence_or_weak_signal'
        });
      }
    }

    const report: DiagnosisStateUpdateReport = {
      schema: 'learner_diagnosis_state_update.v1',
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      window: { since: since.toISOString(), eventCount: events.length },
      summary: {
        candidateConcepts: groups.size,
        acceptedUpdates: updates.length,
        pendingUpdates: pendingUpdates.length,
        rejectedUpdates: rejectedUpdates.length,
        ungroundedDiagnosticEvents: ungrounded.length,
        highRiskConcepts: updates.filter((item) => item.diagnosis === 'needs_support').length,
        masteryImprovingConcepts: updates.filter((item) => item.diagnosis === 'improving_or_mastered').length
      },
      updates,
      pendingUpdates,
      rejectedUpdates,
      ungroundedEventIds: ungrounded.slice(0, 40)
    };

    const knowledgeTracingReports: Array<Record<string, any>> = [];

    if (!input.apply) {
      await this.recordPendingCandidates(input, report).catch((error) => console.warn('Failed to record pending diagnosis candidates:', error));
      return { report, applied: false };
    }

    const evidence = await learnerStateService.recordEvidence({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      evidenceType: 'learner_diagnosis_state_update',
      sourceType: 'learning_event_window',
      sourceId: stableHash([input.workspaceId, since.toISOString(), events.map((event) => event.id)]).slice(0, 32),
      actor: 'system',
      title: 'Learning-event based learner diagnosis update',
      summary: `Updated ${updates.length} concept diagnostics from ${events.length} learning events.`,
      payload: report,
      confidence: avg(updates.map((item) => item.confidence)) || 0.5
    });

    for (const update of updates.filter((item) => !isPollutedLearningSignal(item.conceptTitle)).slice(0, 40)) {
      const concept = update.groundedConceptId
        ? await prisma.courseKnowledgeConcept.findFirst({ where: { id: update.groundedConceptId, workspaceId: input.workspaceId } })
        : await courseKnowledgeGraphService.upsertConcept({
            workspaceId: input.workspaceId,
            title: update.conceptTitle,
            source: 'learning_event_diagnosis',
            evidence: { evidenceId: evidence.id, eventIds: update.eventIds, diagnosis: update.diagnosis, confidence: update.confidence }
          });
      if (!concept) continue;
      const knowledgeTracingReport = await knowledgeTracingModelService.traceConcept({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        conceptTitle: concept.title,
        eventIds: update.eventIds,
        apply: false
      }).catch((error) => {
        console.warn('Knowledge tracing model update failed:', error);
        return null;
      });
      if (knowledgeTracingReport?.observationCount) {
        knowledgeTracingReports.push({
          conceptId: concept.id,
          conceptTitle: concept.title,
          eventIds: update.eventIds,
          estimates: knowledgeTracingReport.estimates,
          bkt: {
            mastery: knowledgeTracingReport.bkt.mastery,
            hintPenalty: knowledgeTracingReport.bkt.hintPenalty,
            confusionPenalty: knowledgeTracingReport.bkt.confusionPenalty
          },
          irt: knowledgeTracingReport.irt,
          pfa: knowledgeTracingReport.pfa,
          sequenceFeatures: knowledgeTracingReport.sequenceFeatures
        });
      }
      await courseKnowledgeGraphService.updateLearnerConceptState({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        masteryEstimate: knowledgeTracingReport?.observationCount
          ? knowledgeTracingReport.estimates.masteryEstimate
          : undefined,
        weaknessEstimate: knowledgeTracingReport?.observationCount
          ? knowledgeTracingReport.estimates.weaknessEstimate
          : undefined,
        readinessEstimate: knowledgeTracingReport?.observationCount
          ? knowledgeTracingReport.estimates.readinessEstimate
          : undefined,
        masteryDelta: knowledgeTracingReport?.observationCount ? undefined : update.deltas.masteryDelta * update.confidence,
        weaknessDelta: knowledgeTracingReport?.observationCount ? undefined : update.deltas.weaknessDelta * update.confidence,
        readinessDelta: knowledgeTracingReport?.observationCount ? undefined : update.deltas.readinessDelta * update.confidence,
        sourceSignalId: evidence.id,
        evidence: {
          source: knowledgeTracingReport?.observationCount ? 'hybrid_knowledge_tracing' : 'learning_event_diagnosis',
          evidenceId: evidence.id,
          eventIds: update.eventIds,
          scores: update.scores,
          deltas: update.deltas,
          diagnosis: update.diagnosis,
          knowledgeTracing: knowledgeTracingReport?.observationCount
            ? {
                schema: knowledgeTracingReport.schema,
                estimates: knowledgeTracingReport.estimates,
                bkt: {
                  mastery: knowledgeTracingReport.bkt.mastery,
                  hintPenalty: knowledgeTracingReport.bkt.hintPenalty,
                  confusionPenalty: knowledgeTracingReport.bkt.confusionPenalty
                },
                irt: knowledgeTracingReport.irt,
                pfa: knowledgeTracingReport.pfa
              }
            : null
        }
      });
      await courseKnowledgeGraphService.activateConcept({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        activationType: 'learner_diagnosis_update',
        sourceType: 'learner_evidence',
        sourceId: evidence.id,
        score: Math.min(0.5, 0.18 + update.confidence * 0.22),
        evidence: { diagnosis: update.diagnosis, eventCount: update.eventCount }
      });
      if (update.misconceptionTexts.length && update.diagnosis === 'needs_support') {
        await courseKnowledgeGraphService.upsertMisconception({
          workspaceId: input.workspaceId,
          conceptId: concept.id,
          title: `Repeated confusion/error around ${update.conceptTitle}`,
          description: update.misconceptionTexts.join('\n'),
          repairHint: 'Use prerequisite check, lower-load explanation, and targeted practice before advancing.',
          severity: clamp01(update.scores.errorEvidence * 0.45 + update.scores.confusion * 0.35 + update.scores.hintDependency * 0.2),
          confidence: update.confidence,
          evidence: { evidenceId: evidence.id, eventIds: update.eventIds, examples: update.misconceptionTexts }
        });
      }
    }
    if (knowledgeTracingReports.length) {
      await learnerStateService.recordEvidence({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        evidenceType: 'knowledge_tracing_model_update',
        sourceType: 'learning_event_window',
        sourceId: evidence.id,
        actor: 'system',
        title: 'Hybrid knowledge tracing model update',
        summary: `Updated ${knowledgeTracingReports.length} concept estimates using BKT/IRT/PFA hybrid tracing.`,
        payload: {
          schema: 'knowledge_tracing_model_update.v1',
          framework: {
            bkt: 'Bayesian Knowledge Tracing posterior update over concept mastery',
            irt: '2PL-style ability estimate from scored attempts',
            pfa: 'Performance Factors Analysis style success/failure/hint accumulation',
            dktReady: 'Event sequence tensors retained for later DKT/Transformer KT training'
          },
          sourceDiagnosisEvidenceId: evidence.id,
          reports: knowledgeTracingReports
        },
        confidence: avg(knowledgeTracingReports.map((item) => Number(item.estimates?.evidenceStrength) || 0.55)) || 0.55
      });
    }
    await this.recordPendingCandidates(input, report).catch((error) => console.warn('Failed to record pending diagnosis candidates:', error));

    const cleanUpdates = updates.filter((item) => !isPollutedLearningSignal(item.conceptTitle));
    const weakSkills = cleanUpdates
      .filter((item) => item.diagnosis === 'needs_support' || item.deltas.weaknessDelta > 0.04)
      .map((item) => item.conceptTitle)
      .slice(0, 12);
    const mastered = cleanUpdates
      .filter((item) => item.diagnosis === 'improving_or_mastered' && item.deltas.masteryDelta > 0.04)
      .map((item) => item.conceptTitle)
      .slice(0, 12);
    const misconceptions = cleanUpdates
      .filter((item) => item.misconceptionTexts.length && item.diagnosis === 'needs_support')
      .map((item) => `${item.conceptTitle}: repeated confusion/error`)
      .slice(0, 12);
    const nextActions = [
      weakSkills.length ? `Remediate weak concepts: ${weakSkills.slice(0, 3).join(', ')}` : '',
      report.summary.ungroundedDiagnosticEvents ? 'Review ungrounded dialogue events and bind them to KG concepts.' : '',
      updates.some((item) => item.scores.hintDependency >= 0.5) ? 'Insert lower-load scaffolded practice for hint-dependent concepts.' : ''
    ].filter(Boolean);

    if (weakSkills.length || mastered.length) {
      await learnerStateService.proposePatch({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        targetDimension: 'knowledgeState',
        proposedBy: 'LearnerDiagnosisStateUpdateService',
        evidenceId: evidence.id,
        confidence: avg(updates.map((item) => item.confidence)) || 0.55,
        rationale: 'ParLD-style event diagnosis converted learning interactions into governed knowledge-state patches.',
        payload: {
          candidateWeakSkills: weakSkills,
          emergingStrengths: mastered,
          targetSkills: weakSkills,
          masterySignals: cleanUpdates.slice(0, 20).map((item) => ({
            concept: item.conceptTitle,
            score: clamp01(
              knowledgeTracingReports.find((reportItem) => reportItem.conceptTitle === item.conceptTitle)?.estimates?.masteryEstimate
                ?? 0.5 + item.deltas.masteryDelta - item.deltas.weaknessDelta
            ),
            diagnosis: item.diagnosis,
            confidence: item.confidence,
            eventCount: item.eventCount
          }))
        }
      });
    }
    if (misconceptions.length) {
      await learnerStateService.proposePatch({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        targetDimension: 'misconceptionState',
        proposedBy: 'LearnerDiagnosisStateUpdateService',
        evidenceId: evidence.id,
        confidence: avg(updates.filter((item) => item.misconceptionTexts.length).map((item) => item.confidence)) || 0.55,
        rationale: 'Repeated errors, hint use, and confusion were compressed into misconception candidates.',
        payload: { candidateMisconceptions: filterCleanLearningSignals(misconceptions, 12), candidates: filterCleanLearningSignals(misconceptions, 12) }
      });
    }
    if (nextActions.length) {
      await learnerStateService.proposePatch({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        targetDimension: 'reviewPlanning',
        proposedBy: 'LearnerDiagnosisStateUpdateService',
        evidenceId: evidence.id,
        confidence: 0.62,
        rationale: 'Learning-event diagnosis produced short-term remediation and review planning actions.',
        payload: { nextActions, reviewPressureSignals: filterCleanLearningSignals(weakSkills, 12) }
      });
    }

    const state = await learnerStateService.applyPendingPatches(input.workspaceId, { changedBy: 'LearnerDiagnosisStateUpdateService' });
    return { report, evidenceId: evidence.id, state, applied: true };
  }

  private async buildConceptGroundingIndex(workspaceId: string) {
    const concepts = await prisma.courseKnowledgeConcept.findMany({
      where: { workspaceId, status: 'active' },
      select: { id: true, title: true, aliasesJson: true },
      take: 800
    });
    const index = new Map<string, { id: string; title: string; confidence: number }>();
    concepts.forEach((concept) => {
      if (isPollutedLearningSignal(concept.title)) return;
      [concept.title, ...parseJson<string[]>(concept.aliasesJson, [])].forEach((alias) => {
        if (isPollutedLearningSignal(alias)) return;
        const key = normalize(alias).toLowerCase();
        if (key.length >= 2 && !index.has(key)) index.set(key, { id: concept.id, title: concept.title, confidence: 0.92 });
      });
    });
    return index;
  }

  private groundConcept(title: string, index: Map<string, { id: string; title: string; confidence: number }>) {
    const key = normalize(title).toLowerCase();
    const exact = index.get(key);
    if (exact) return exact;
    let best: { id: string; title: string; confidence: number } | null = null;
    for (const [candidate, concept] of index.entries()) {
      if (candidate.includes(key) || key.includes(candidate)) {
        const overlap = Math.min(candidate.length, key.length) / Math.max(candidate.length, key.length);
        const confidence = clamp01(0.52 + overlap * 0.28);
        if (!best || confidence > best.confidence) best = { ...concept, confidence };
      }
    }
    return best && best.confidence >= 0.62 ? best : null;
  }

  private async recordPendingCandidates(input: { workspaceId: string; workbenchId?: string | null; goalId?: string | null }, report: DiagnosisStateUpdateReport) {
    if (!report.pendingUpdates.length && !report.rejectedUpdates.length) return;
    await learnerStateService.recordEvidence({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      evidenceType: 'learner_diagnosis_update_candidates',
      sourceType: 'learning_event_window',
      actor: 'system',
      title: 'Pending learner diagnosis candidates',
      summary: `Pending=${report.pendingUpdates.length}, rejected=${report.rejectedUpdates.length}. These were not applied to stable learner state.`,
      payload: {
        pendingUpdates: report.pendingUpdates,
        rejectedUpdates: report.rejectedUpdates.slice(0, 20),
        ungroundedEventIds: report.ungroundedEventIds
      },
      confidence: 0.42
    });
  }
}

export const learnerDiagnosisStateUpdateService = new LearnerDiagnosisStateUpdateService();
