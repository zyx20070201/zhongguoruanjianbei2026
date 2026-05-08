import prisma from '../config/db';
import { CentralLearnerState, LearnerStateSnapshot, learnerStateService } from './learnerStateService';
import { buildLearnerMemoryKey } from './learnerMemoryKeys';

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

const asArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
};

const asRecordArray = (value: unknown) => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[] : []);

const unique = (items: string[], limit = 8) => Array.from(new Set(items.map((item) => clip(item, 120)).filter(Boolean))).slice(0, limit);

const scoreLabel = (value: number) => {
  if (value >= 0.75) return 'stable';
  if (value >= 0.5) return 'emerging';
  if (value > 0) return 'tentative';
  return 'unknown';
};

const difficultyLabel = (band: unknown) => {
  if (!band || typeof band !== 'object') return null;
  const record = band as Record<string, unknown>;
  const min = Number(record.min);
  const max = Number(record.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max <= 2) return 'easy';
  if (min >= 4) return 'challenging';
  return `level ${min}-${max}`;
};

const ageDecayWeight = (observedAt?: string | Date | null, halfLifeDays = 30) => {
  if (!observedAt) return 1;
  const date = observedAt instanceof Date ? observedAt : new Date(observedAt);
  const ageDays = Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / Math.max(halfLifeDays, 1));
};

const resourceStyleHints = (signals: ReturnType<typeof extractSignals>) => {
  const hints: string[] = [];
  const prefs = signals.preferredResourceForms;
  if (prefs.includes('examples')) hints.push('Lead with a concrete example before abstraction.');
  if (prefs.includes('code_or_project')) hints.push('Ground explanations in code, procedures, or a small project artifact.');
  if (prefs.includes('visual_explanation')) hints.push('Use diagrams, structure, or stepwise visual framing when possible.');
  if (prefs.includes('practice_or_quiz')) hints.push('End with a quick check question or practice task.');
  if (prefs.includes('flashcards_or_review')) hints.push('Convert important points into recall-friendly bullets or flashcard-ready prompts.');
  if (prefs.includes('step_by_step')) hints.push('Break the explanation into short ordered steps.');
  if (prefs.includes('concise_summary')) hints.push('Keep the answer compact and move quickly to the point.');
  return unique(hints, 8);
};

const compactMastery = (state: LearnerStateSnapshot) => {
  const masterySignals = asRecordArray(state.knowledgeState.masterySignals);
  const byConcept = new Map<string, { total: number; count: number; weak: number; strong: number; weightTotal: number }>();

  masterySignals.forEach((signal) => {
    const concept = clip(String(signal.concept || signal.skill || signal.targetSkill || ''), 120);
    if (!concept) return;
    const sourceType = String(signal.source || signal.sourceType || 'unknown');
    const sourceWeight = sourceType === 'quiz' ? 1 : sourceType === 'flashcard' ? 0.8 : sourceType === 'trace' ? 0.7 : sourceType === 'chat' ? 0.45 : 0.6;
    const observedAt = signal.observedAt || signal.reviewedAt || signal.updatedAt;
    const recencyWeight = ageDecayWeight(
      typeof observedAt === 'string' || observedAt instanceof Date ? observedAt : null,
      45
    );
    const weight = Math.max(0.1, sourceWeight * recencyWeight);
    const score =
      typeof signal.score === 'number'
        ? signal.score
        : signal.rating === 'again'
          ? 0.25
          : signal.rating === 'hard'
            ? 0.45
            : signal.rating === 'good'
              ? 0.72
              : signal.rating === 'easy'
                ? 0.86
                : signal.correct === true
                  ? 0.75
                  : signal.correct === false
                    ? 0.35
                    : 0.5;
    const current = byConcept.get(concept) || { total: 0, count: 0, weak: 0, strong: 0, weightTotal: 0 };
    current.total += score * weight;
    current.count += 1;
    current.weightTotal += weight;
    if (score < 0.55) current.weak += 1;
    if (score >= 0.75) current.strong += 1;
    byConcept.set(concept, current);
  });

  const stableWeaknesses = Array.from(byConcept.entries())
    .filter(([, stats]) => stats.count >= 2 && stats.weak >= 2 && stats.total / Math.max(stats.weightTotal, 0.1) < 0.55)
    .sort((a, b) => b[1].weak - a[1].weak)
    .map(([concept]) => concept);
  const emergingStrengths = Array.from(byConcept.entries())
    .filter(([, stats]) => stats.count >= 2 && stats.strong >= 2 && stats.weak === 0 && stats.total / Math.max(stats.weightTotal, 0.1) >= 0.75)
    .sort((a, b) => b[1].strong - a[1].strong)
    .map(([concept]) => concept);
  const focusConcepts = Array.from(byConcept.entries())
    .sort((a, b) => (b[1].count + b[1].weightTotal) - (a[1].count + a[1].weightTotal))
    .map(([concept]) => concept);

  return {
    focusConcepts,
    stableWeaknesses,
    emergingStrengths,
    signalCount: masterySignals.length
  };
};

const extractSignals = (state: CentralLearnerState, controls: Array<Record<string, unknown>>) => {
  const snapshot = state.state;
  const mastery = compactMastery(snapshot);
  const goalSignals = [
    ...asArray(snapshot.profileBase.goals),
    ...asArray(snapshot.profileBase.activeLearningGoalSignals),
    ...asArray(snapshot.profileBase.recentGoalSignals)
  ];
  const recentTopics = [
    ...asArray(snapshot.profileBase.recentTopics),
    ...asRecordArray(snapshot.profileBase.transientTopicSignals).map((item) => String(item.topic || ''))
  ];
  const candidateWeaknesses = [
    ...asArray(snapshot.knowledgeState.weakSkills),
    ...asArray(snapshot.knowledgeState.candidateWeakSkills),
    ...asRecordArray(snapshot.knowledgeState.weakSkillSignals).map((item) => String(item.concept || ''))
  ];
  const preferenceSignals = [
    ...asArray(snapshot.preferenceStyle.resourcePreference),
    ...asArray(snapshot.preferenceStyle.tentativeResourcePreferences),
    ...asArray(snapshot.preferenceStyle.preferredResourceForms)
  ];
  const misconceptions = [
    ...asArray(snapshot.misconceptionState.candidates),
    ...asArray(snapshot.misconceptionState.candidateMisconceptions)
  ];
  const nextActions = [
    ...asArray(snapshot.reviewPlanning.nextActions),
    ...asArray(snapshot.reviewPlanning.replanTriggers).map((item) => `Replan trigger: ${item}`)
  ];
  const reviewPressure = [
    ...asArray(snapshot.reviewPlanning.reviewPressureSignals),
    ...asRecordArray(snapshot.reviewPlanning.recentFlashcardReviews)
      .filter((item) => item.rating === 'again' || item.rating === 'hard')
      .map((item) => String(item.concept || ''))
  ];
  const confidenceValue = Number(snapshot.confidence.confidence || snapshot.confidence.lastPatchConfidence || 0.45);
  const evidenceCount = Number(snapshot.confidence.evidenceCount || 0);
  const suppressedKeys = new Set(
    controls
      .filter((item) => item.action === 'delete' || item.action === 'freeze')
      .map((item) => String(item.memoryKey || ''))
  );
  const correctionByKey = new Map(
    controls
      .filter((item) => item.action === 'correct' && item.correctedText)
      .map((item) => [String(item.memoryKey || ''), String(item.correctedText || '')])
  );
  const controlled = (dimension: string, values: string[]) =>
    unique(values.map((value) => {
      const key = buildLearnerMemoryKey(dimension, value);
      if (suppressedKeys.has(key)) return '';
      return correctionByKey.get(key) || value;
    }));
  const activeCorrections = controls.filter((item) => item.action === 'correct').map((item) => `${String(item.memoryKey || '')}:${String(item.correctedText || '')}`);
  const activeDownranks = controls.filter((item) => item.action === 'downrank').map((item) => String(item.memoryKey || ''));

  return {
    recentTopics: controlled('profileBase', recentTopics).slice(0, 8),
    activeGoals: controlled('profileBase', [...asArray(snapshot.profileBase.goals), ...asArray(snapshot.profileBase.activeLearningGoalSignals)]).slice(0, 5),
    goals: controlled('profileBase', goalSignals).slice(0, 5),
    focusConcepts: controlled('knowledgeState', [...mastery.focusConcepts, ...candidateWeaknesses]).slice(0, 8),
    candidateWeaknesses: controlled('knowledgeState', candidateWeaknesses).slice(0, 8),
    stableWeaknesses: controlled('knowledgeState', mastery.stableWeaknesses).slice(0, 5),
    emergingStrengths: controlled('knowledgeState', [...asArray(snapshot.knowledgeState.emergingStrengths), ...mastery.emergingStrengths]).slice(0, 5),
    misconceptions: controlled('misconceptionState', misconceptions).slice(0, 6),
    preferredResourceForms: controlled('preferenceStyle', preferenceSignals).slice(0, 6),
    cognitiveLoad: typeof snapshot.cognitiveState.cognitiveLoadTolerance === 'string' ? snapshot.cognitiveState.cognitiveLoadTolerance : null,
    learnerLevel: typeof snapshot.cognitiveState.learnerLevel === 'string' ? snapshot.cognitiveState.learnerLevel : null,
    recommendedDifficulty: difficultyLabel(snapshot.cognitiveState.recommendedDifficultyBand),
    nextActions: unique(nextActions, 6),
    reviewPressure: controlled('reviewPlanning', reviewPressure).slice(0, 6),
    corrections: unique(activeCorrections, 5),
    downranks: unique(activeDownranks, 5),
    confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0.45,
    evidenceCount,
    masterySignalCount: mastery.signalCount
  };
};

const audienceHints = (audience: LearnerContextAudience, signals: ReturnType<typeof extractSignals>) => {
  const hints: string[] = [];
  hints.push(...resourceStyleHints(signals));
  if (signals.stableWeaknesses.length) {
    hints.push(`Give extra support on stable weak areas: ${signals.stableWeaknesses.slice(0, 3).join(', ')}.`);
  } else if (signals.candidateWeaknesses.length) {
    hints.push(`Treat these as candidate weak areas, not conclusions: ${signals.candidateWeaknesses.slice(0, 3).join(', ')}.`);
  }
  if (signals.cognitiveLoad === 'low') hints.push('Use smaller steps and avoid dense multi-concept explanations.');
  if (signals.cognitiveLoad === 'high') hints.push('The learner may tolerate denser or more challenging material, but still ground it in evidence.');
  if (signals.reviewPressure.length) hints.push(`Review pressure exists around: ${signals.reviewPressure.slice(0, 3).join(', ')}.`);

  if (audience === 'quiz') {
    hints.push('Generate checks around candidate/stable weak areas; avoid using one result as a final mastery judgment.');
    hints.push('Mix one direct retrieval check with one transfer or explanation check when evidence allows.');
  }
  if (audience === 'flashcard') {
    hints.push('Prioritize concise recall prompts for review-pressure concepts and recent weak signals.');
    hints.push('Prefer spaced repetition on repeated weak concepts before broadening scope.');
  }
  if (audience === 'planner') {
    hints.push('Use CLT/ZPD constraints: diagnose before increasing difficulty, and replan after repeated weak evidence.');
    hints.push('Prefer a progression from baseline diagnosis to grounded explanation, then practice and check.');
    if (!signals.evidenceCount || signals.evidenceCount < 8) hints.push('Evidence is thin; begin with lightweight diagnostics and a short feedback loop.');
    if (signals.stableWeaknesses.length) hints.push(`Prioritize remediation for stable weaknesses first: ${signals.stableWeaknesses.slice(0, 3).join(', ')}.`);
    if (signals.emergingStrengths.length) hints.push(`Use these as anchors for the next step: ${signals.emergingStrengths.slice(0, 3).join(', ')}.`);
    if (signals.reviewPressure.length) hints.push(`Insert review or rehearsal steps around: ${signals.reviewPressure.slice(0, 3).join(', ')}.`);
  }
  if (audience === 'studio') {
    hints.push('Adapt generated artifacts to preferred formats while keeping source grounding visible.');
  }
  if (audience === 'tutor') {
    hints.push('Explain from the learner question first; use hints as personalization, not as labels.');
    hints.push('Default to a short explanation, one worked example, then a check for understanding.');
    if (signals.candidateWeaknesses.length) hints.push(`Probe these concepts gently, without declaring mastery gaps: ${signals.candidateWeaknesses.slice(0, 3).join(', ')}.`);
    if (signals.reviewPressure.length) hints.push(`After explanation, ask a retrieval check on: ${signals.reviewPressure.slice(0, 3).join(', ')}.`);
    if (signals.preferredResourceForms.includes('visual_explanation')) hints.push('Offer a structure or diagram first, then add words.');
    if (signals.preferredResourceForms.includes('code_or_project')) hints.push('When the topic is technical, tie the explanation to a concrete artifact or code example.');
    if (signals.preferredResourceForms.includes('examples')) hints.push('Start with an example before naming the rule or abstraction.');
    if (signals.corrections.length) hints.push(`Respect user corrections before any heuristic personalization: ${signals.corrections.slice(0, 3).join('; ')}.`);
    if (signals.downranks.length) hints.push(`Avoid overusing downranked memories: ${signals.downranks.slice(0, 3).join('; ')}.`);
  }

  return unique(hints, 8);
};

const guardrailsFor = (signals: ReturnType<typeof extractSignals>) => [
  'Do not present learner-state signals as fixed traits or diagnoses.',
  'Do not claim mastery from a single chat, quiz, or flashcard review.',
  'Use tentative language for candidate weaknesses unless repeated evidence exists.',
  'Prefer explaining recommendations with evidence when surfacing them to the user.',
  signals.confidence < 0.55 ? 'Personalization confidence is limited; ask clarifying questions when stakes are high.' : ''
].filter(Boolean);

const promptLines = (audience: LearnerContextAudience, signals: ReturnType<typeof extractSignals>, hints: string[], guardrails: string[]) => {
  const lines = [
    `Learner context for ${audience}:`,
    signals.goals.length ? `- Current/recent goals: ${signals.goals.slice(0, 3).join('; ')}` : '- Current/recent goals: not stable yet.',
    signals.recentTopics.length ? `- Recent topics: ${signals.recentTopics.slice(0, 5).join(', ')}` : '',
    signals.focusConcepts.length ? `- Focus concepts: ${signals.focusConcepts.slice(0, 5).join(', ')}` : '',
    signals.stableWeaknesses.length
      ? `- Stable weak signals: ${signals.stableWeaknesses.slice(0, 4).join(', ')}`
      : signals.candidateWeaknesses.length
        ? `- Candidate weak signals: ${signals.candidateWeaknesses.slice(0, 4).join(', ')}`
        : '',
    signals.misconceptions.length ? `- Candidate misconceptions: ${signals.misconceptions.slice(0, 3).join('; ')}` : '',
    signals.emergingStrengths.length ? `- Emerging strengths: ${signals.emergingStrengths.slice(0, 3).join(', ')}` : '',
    signals.preferredResourceForms.length ? `- Resource preferences: ${signals.preferredResourceForms.slice(0, 4).join(', ')}` : '',
    signals.learnerLevel || signals.cognitiveLoad || signals.recommendedDifficulty
      ? `- Cognitive planning: level=${signals.learnerLevel || 'unknown'}, load=${signals.cognitiveLoad || 'unknown'}, difficulty=${signals.recommendedDifficulty || 'unknown'}`
      : '',
    signals.nextActions.length ? `- Next actions: ${signals.nextActions.slice(0, 3).join('; ')}` : '',
    hints.length ? `- Personalization hints: ${hints.slice(0, 4).join(' ')}` : '',
    `- Guardrail: ${guardrails[0]}`
  ];

  if (audience === 'tutor') {
    lines.push(
      '',
      'Tutor-specific strategy:',
      `- Explanation style: ${signals.preferredResourceForms.includes('concise_summary') ? 'brief and direct' : 'example-first and guided'}.`,
      `- Pacing: ${signals.cognitiveLoad === 'low' ? 'slow, short chunks' : signals.cognitiveLoad === 'high' ? 'can handle denser steps' : 'moderate, adaptive'}.`,
      signals.stableWeaknesses.length
        ? `- Remediation focus: ${signals.stableWeaknesses.slice(0, 3).join(', ')}`
        : signals.candidateWeaknesses.length
          ? `- Soft probe focus: ${signals.candidateWeaknesses.slice(0, 3).join(', ')}`
          : '- Remediation focus: still collecting evidence.',
      signals.emergingStrengths.length
        ? `- Anchor strengths: ${signals.emergingStrengths.slice(0, 3).join(', ')}`
        : '- Anchor strengths: not enough repeated evidence yet.',
      signals.reviewPressure.length
        ? `- Check-for-understanding targets: ${signals.reviewPressure.slice(0, 3).join(', ')}`
        : '- Check-for-understanding targets: choose a small retrieval question after explanation.',
      signals.preferredResourceForms.length
        ? `- Format bias: ${signals.preferredResourceForms.slice(0, 4).join(', ')}`
        : '- Format bias: keep neutral and adaptive.',
      signals.corrections.length
        ? `- User corrections: ${signals.corrections.slice(0, 3).join('; ')}`
        : '- User corrections: none yet.',
      signals.downranks.length
        ? `- Downranked memories: ${signals.downranks.slice(0, 3).join('; ')}`
        : '- Downranked memories: none yet.'
    );
  }

  if (audience === 'planner') {
    const difficulty = signals.recommendedDifficulty || 'unknown';
    lines.push(
      '',
      'Planner-specific strategy:',
      `- Planning posture: ${signals.evidenceCount < 8 ? 'diagnostic-first' : 'adaptive execution with checkpoints'}.`,
      `- Difficulty band: ${difficulty}.`,
      signals.stableWeaknesses.length
        ? `- Must-remediate first: ${signals.stableWeaknesses.slice(0, 3).join(', ')}`
        : signals.candidateWeaknesses.length
          ? `- Candidate weaknesses to validate: ${signals.candidateWeaknesses.slice(0, 3).join(', ')}`
          : '- Weaknesses: still collecting evidence.',
      signals.emergingStrengths.length
        ? `- Use as planning anchors: ${signals.emergingStrengths.slice(0, 3).join(', ')}`
        : '- Planning anchors: not enough repeated evidence yet.',
      signals.reviewPressure.length
        ? `- Insert review loop around: ${signals.reviewPressure.slice(0, 3).join(', ')}`
        : '- Insert review loop: after the first learning cycle.',
      signals.focusConcepts.length
        ? `- Top concepts to prioritize: ${signals.focusConcepts.slice(0, 4).join(', ')}`
        : '- Top concepts: infer from goals and recent weak signals.',
      `- Replan trigger rule: if repeated weak evidence appears, or if the learner repeatedly asks for a different format, replan rather than deepen.`
    );
  }

  return lines.filter(Boolean).join('\n');
};

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
    const pendingPatchCount = await prisma.learnerStatePatch.count({
      where: {
        workspaceId: input.workspaceId,
        learnerStateId: state.id,
        status: 'pending'
      }
    });
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
      signals.goals.length ? `Goals: ${signals.goals.slice(0, 2).join(' / ')}` : 'Goals: not stable',
      signals.stableWeaknesses.length
        ? `Stable weak: ${signals.stableWeaknesses.slice(0, 2).join(', ')}`
        : signals.candidateWeaknesses.length
          ? `Candidate weak: ${signals.candidateWeaknesses.slice(0, 2).join(', ')}`
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
