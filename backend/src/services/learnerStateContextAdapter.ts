import prisma from '../config/db';
import { learnerStateService } from './learnerStateService';
import { buildLearnerMemoryKey } from './learnerMemoryKeys';
import type { LearnerSignalRecord } from './learnerStateModel';

export type LearnerContextAudience =
  | 'general'
  | 'tutor'
  | 'planner'
  | 'quiz'
  | 'flashcard'
  | 'studio'
  | 'reflection';

export interface LearnerStateAgentContext {
  audience: LearnerContextAudience;
  summary: string;
  promptContext: string;
  personalizationHints: string[];
  learningSignals: {
    recentTopics: string[];
    activeGoals: string[];
    goals: string[];
    focusConcepts: string[];
    candidateWeaknesses: string[];
    stableWeaknesses: string[];
    emergingStrengths: string[];
    misconceptions: string[];
    preferredResourceForms: string[];
    cognitiveLoad?: string | null;
    learnerLevel?: string | null;
    recommendedDifficulty?: string | null;
    nextActions: string[];
    reviewPressure: string[];
    corrections: string[];
    downranks: string[];
  };
  guardrails: string[];
  provenance: {
    learnerStateId: string;
    version: number;
    confidence: number;
    evidenceCount: number;
    pendingPatchCount: number;
    lastEvidenceAt?: string | null;
    updatedAt: string;
  };
}

const clip = (value: string | null | undefined, maxLength = 180) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const unique = (items: string[], limit = 8) => Array.from(new Set(items.map((item) => clip(item, 120)).filter(Boolean))).slice(0, limit);

const signalValues = (signals: LearnerSignalRecord[], limit = 8) => unique(signals.filter((signal) => signal.status !== 'suppressed').map((signal) => signal.value), limit);

const scoreLabel = (value: number) => {
  if (value >= 0.75) return 'stable';
  if (value >= 0.5) return 'emerging';
  if (value > 0) return 'tentative';
  return 'unknown';
};

const confidenceFromSignals = (signals: LearnerSignalRecord[]) => {
  if (!signals.length) return 0.45;
  return Math.max(0.45, Math.min(1, signals.reduce((sum, signal) => sum + signal.confidence, 0) / signals.length));
};

const evidenceCount = (signals: LearnerSignalRecord[]) =>
  signals.reduce((sum, signal) => sum + Math.max(signal.evidenceIds.length, signal.sources.length ? 1 : 0), 0);

const controlledValues = (dimension: string, values: string[], controls: Array<Record<string, unknown>>) => {
  const suppressed = new Set(
    controls
      .filter((item) => item.action === 'delete' || item.action === 'freeze')
      .map((item) => String(item.memoryKey || ''))
  );
  const correctionByKey = new Map(
    controls
      .filter((item) => item.action === 'correct' && item.correctedText)
      .map((item) => [String(item.memoryKey || ''), String(item.correctedText || '')])
  );
  return unique(values.map((value) => {
    const key = buildLearnerMemoryKey(dimension, value);
    if (suppressed.has(key)) return '';
    return correctionByKey.get(key) || value;
  }));
};

const extractSignals = (state: Awaited<ReturnType<typeof learnerStateService.ensureState>>, controls: Array<Record<string, unknown>>) => {
  const core = state.coreState;
  const stable = core.stableProfile;
  const working = core.workingState;
  const observations = core.observationMemory.observations;
  const allSignals = [
    ...stable.learningGoals,
    ...stable.masteredKnowledge,
    ...stable.weakKnowledge,
    ...stable.learningPreferences,
    ...stable.commonErrors,
    ...stable.learnerTraits,
    ...working.currentCourseState.activeGoals,
    ...working.currentCourseState.focusKnowledge,
    ...working.currentCourseState.nextActions,
    ...working.recentBehaviorSummary.recentTopics,
    ...working.recentBehaviorSummary.reviewPressure,
    ...observations
  ];
  const corrections = unique(
    controls
      .filter((item) => item.action === 'correct')
      .map((item) => `${String(item.memoryKey || '')}:${String(item.correctedText || '')}`),
    5
  );
  const downranks = unique(
    controls
      .filter((item) => item.action === 'downrank')
      .map((item) => String(item.memoryKey || '')),
    5
  );

  const recentTopics = controlledValues('profileBase', signalValues(working.recentBehaviorSummary.recentTopics, 8), controls);
  const goals = controlledValues('profileBase', signalValues(stable.learningGoals, 5), controls);
  const activeGoals = controlledValues('profileBase', signalValues(working.currentCourseState.activeGoals, 5), controls);
  const focusConcepts = controlledValues('knowledgeState', signalValues(working.currentCourseState.focusKnowledge, 8), controls);
  const stableWeaknesses = controlledValues('knowledgeState', signalValues(stable.weakKnowledge.filter((signal) => signal.status === 'active'), 5), controls);
  const candidateWeaknesses = controlledValues(
    'knowledgeState',
    signalValues(observations.filter((signal) => signal.label === 'Candidate weak knowledge'), 8),
    controls
  );

  return {
    recentTopics,
    activeGoals: activeGoals.length ? activeGoals : goals,
    goals,
    focusConcepts,
    candidateWeaknesses,
    stableWeaknesses,
    emergingStrengths: controlledValues('knowledgeState', signalValues(stable.masteredKnowledge, 5), controls),
    misconceptions: controlledValues('misconceptionState', signalValues(stable.commonErrors, 6), controls),
    preferredResourceForms: controlledValues('preferenceStyle', signalValues(stable.learningPreferences, 6), controls),
    cognitiveLoad: null,
    learnerLevel: null,
    recommendedDifficulty: null,
    nextActions: signalValues(working.currentCourseState.nextActions, 6),
    reviewPressure: controlledValues('reviewPlanning', signalValues(working.recentBehaviorSummary.reviewPressure, 6), controls),
    corrections,
    downranks,
    confidence: confidenceFromSignals(allSignals),
    evidenceCount: evidenceCount(allSignals)
  };
};

const resourceStyleHints = (signals: ReturnType<typeof extractSignals>) => {
  const hints: string[] = [];
  const prefs = signals.preferredResourceForms;
  if (prefs.includes('examples')) hints.push('Lead with a concrete example before abstraction.');
  if (prefs.includes('code_or_project')) hints.push('Ground explanations in code, procedures, or a small project artifact.');
  if (prefs.includes('visual_explanation')) hints.push('Use diagrams, structure, or stepwise visual framing when possible.');
  if (prefs.includes('practice_or_quiz')) {
    hints.push('Offer a quick check question or practice task only when the user explicitly asks for practice, review, quiz, or self-test.');
  }
  if (prefs.includes('flashcards_or_review')) hints.push('Convert important points into recall-friendly bullets or flashcard-ready prompts.');
  if (prefs.includes('step_by_step')) hints.push('Break the explanation into short ordered steps.');
  if (prefs.includes('concise_summary')) hints.push('Keep the answer compact and move quickly to the point.');
  return unique(hints, 8);
};

const audienceHints = (audience: LearnerContextAudience, signals: ReturnType<typeof extractSignals>) => {
  const hints: string[] = [];
  hints.push(...resourceStyleHints(signals));
  if (signals.stableWeaknesses.length) hints.push(`Give extra support on stable weak areas: ${signals.stableWeaknesses.slice(0, 3).join(', ')}.`);
  if (!signals.stableWeaknesses.length && signals.candidateWeaknesses.length) {
    hints.push(`Treat these as short-term weak observations, not conclusions: ${signals.candidateWeaknesses.slice(0, 3).join(', ')}.`);
  }
  if (signals.reviewPressure.length) hints.push(`Review pressure exists around: ${signals.reviewPressure.slice(0, 3).join(', ')}.`);
  if (audience === 'planner') {
    hints.push('Use the stable profile for durable constraints and the observation memory only for validation or diagnostics.');
    if (signals.evidenceCount < 8) hints.push('Evidence is thin; begin with lightweight diagnostics and a short feedback loop.');
  }
  if (audience === 'tutor') {
    hints.push('Explain from the learner question first; use learner state as personalization, not as a label.');
    hints.push('Default to a short explanation and one worked example. Do not append a check question unless the user asks for practice, review, quiz, or self-test.');
  }
  if (audience === 'quiz') hints.push('Use short-term observations to choose checks, but do not treat one answer as final mastery.');
  if (audience === 'flashcard') hints.push('Prioritize review pressure and repeated weak observations before broadening scope.');
  if (audience === 'studio') hints.push('Adapt generated artifacts to stable preferences while keeping source grounding visible.');
  if (signals.corrections.length) hints.push(`Respect user corrections before heuristic personalization: ${signals.corrections.slice(0, 3).join('; ')}.`);
  if (signals.downranks.length) hints.push(`Avoid overusing downranked learner memories: ${signals.downranks.slice(0, 3).join('; ')}.`);
  return unique(hints, 8);
};

const guardrailsFor = (signals: ReturnType<typeof extractSignals>) => [
  'Use stable profile, working state, and observation memory as separate layers.',
  'Do not present learner-state signals as fixed traits or diagnoses.',
  'Do not promote short-term observations into long-term profile without repeated evidence.',
  'Prefer explaining recommendations with evidence when surfacing them to the user.',
  signals.confidence < 0.55 ? 'Personalization confidence is limited; ask clarifying questions when stakes are high.' : ''
].filter(Boolean);

const promptLines = (audience: LearnerContextAudience, signals: ReturnType<typeof extractSignals>, hints: string[], guardrails: string[]) => [
  `Learner context for ${audience}:`,
  signals.goals.length ? `- Stable learning goals: ${signals.goals.slice(0, 3).join('; ')}` : '- Stable learning goals: not established yet.',
  signals.activeGoals.length ? `- Working goals: ${signals.activeGoals.slice(0, 3).join('; ')}` : '',
  signals.recentTopics.length ? `- Short-term recent topics: ${signals.recentTopics.slice(0, 5).join(', ')}` : '',
  signals.focusConcepts.length ? `- Current focus knowledge: ${signals.focusConcepts.slice(0, 5).join(', ')}` : '',
  signals.stableWeaknesses.length
    ? `- Stable weak knowledge: ${signals.stableWeaknesses.slice(0, 4).join(', ')}`
    : signals.candidateWeaknesses.length
      ? `- Short-term weak observations: ${signals.candidateWeaknesses.slice(0, 4).join(', ')}`
      : '',
  signals.misconceptions.length ? `- Common error candidates: ${signals.misconceptions.slice(0, 3).join('; ')}` : '',
  signals.emergingStrengths.length ? `- Mastered/emerging strengths: ${signals.emergingStrengths.slice(0, 3).join(', ')}` : '',
  signals.preferredResourceForms.length ? `- Stable learning preferences: ${signals.preferredResourceForms.slice(0, 4).join(', ')}` : '',
  signals.reviewPressure.length ? `- Working review pressure: ${signals.reviewPressure.slice(0, 3).join(', ')}` : '',
  signals.nextActions.length ? `- Working next actions: ${signals.nextActions.slice(0, 3).join('; ')}` : '',
  hints.length ? `- Personalization hints: ${hints.slice(0, 4).join(' ')}` : '',
  `- Guardrail: ${guardrails[0]}`
].filter(Boolean).join('\n');

export class LearnerStateContextAdapter {
  async build(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    audience?: LearnerContextAudience;
    tokenBudget?: number;
  }): Promise<LearnerStateAgentContext> {
    const state = await learnerStateService.ensureState({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null
    });
    const pendingPatchCount = Number((await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*) as count FROM "LearnerStateTransition" WHERE "workspaceId" = ? AND "learnerStateCoreId" = ? AND "status" = 'pending'`,
      input.workspaceId,
      state.id
    ))[0]?.count || 0);
    const controls = await prisma.learnerMemoryControl.findMany({
      where: { workspaceId: input.workspaceId, status: 'active' },
      orderBy: { updatedAt: 'desc' }
    });
    const signals = extractSignals(state, controls as Array<Record<string, unknown>>);
    const audience = input.audience || 'general';
    const hints = audienceHints(audience, signals);
    const guardrails = guardrailsFor(signals);
    const confidence = signals.confidence;
    const summary = [
      signals.goals.length ? `Stable goals: ${signals.goals.slice(0, 2).join(' / ')}` : 'Stable goals: not established',
      signals.stableWeaknesses.length
        ? `Stable weak: ${signals.stableWeaknesses.slice(0, 2).join(', ')}`
        : signals.candidateWeaknesses.length
          ? `Observed weak: ${signals.candidateWeaknesses.slice(0, 2).join(', ')}`
          : 'Weak signals: insufficient evidence',
      signals.preferredResourceForms.length ? `Prefs: ${signals.preferredResourceForms.slice(0, 2).join(', ')}` : '',
      `Confidence: ${scoreLabel(confidence)}`
    ].filter(Boolean).join(' | ');
    const promptContext = clip(promptLines(audience, signals, hints, guardrails), input.tokenBudget || 1600);

    return {
      audience,
      summary,
      promptContext,
      personalizationHints: hints,
      learningSignals: {
        recentTopics: signals.recentTopics,
        activeGoals: signals.activeGoals,
        goals: signals.goals,
        focusConcepts: signals.focusConcepts,
        candidateWeaknesses: signals.candidateWeaknesses,
        stableWeaknesses: signals.stableWeaknesses,
        emergingStrengths: signals.emergingStrengths,
        misconceptions: signals.misconceptions,
        preferredResourceForms: signals.preferredResourceForms,
        cognitiveLoad: signals.cognitiveLoad,
        learnerLevel: signals.learnerLevel,
        recommendedDifficulty: signals.recommendedDifficulty,
        nextActions: signals.nextActions,
        reviewPressure: signals.reviewPressure,
        corrections: signals.corrections,
        downranks: signals.downranks
      },
      guardrails,
      provenance: {
        learnerStateId: state.id,
        version: state.version,
        confidence,
        evidenceCount: signals.evidenceCount,
        pendingPatchCount,
        lastEvidenceAt: state.lastEvidenceAt,
        updatedAt: state.updatedAt
      }
    };
  }
}

export const learnerStateContextAdapter = new LearnerStateContextAdapter();
