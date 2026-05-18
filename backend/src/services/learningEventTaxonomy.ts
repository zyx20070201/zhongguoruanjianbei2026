import crypto from 'crypto';
import type { CollectLearningEventInput, LearningEventActor } from './learningEventCollectionService';

export type LearningEventFamily =
  | 'navigation'
  | 'resource'
  | 'dialogue'
  | 'assessment'
  | 'help'
  | 'self_report'
  | 'review'
  | 'planning'
  | 'production'
  | 'system'
  | 'unknown';

export type CognitiveSignalKey =
  | 'course_engagement'
  | 'workbench_engagement'
  | 'resource_attention'
  | 'help_seeking'
  | 'explicit_confusion'
  | 'repeated_question'
  | 'hint_dependency'
  | 'answer_attempt'
  | 'correct_answer'
  | 'incorrect_answer'
  | 'partial_mastery'
  | 'self_reported_unknown'
  | 'self_reported_mastery'
  | 'retrieval_strength'
  | 'retrieval_difficulty'
  | 'planning_intent'
  | 'artifact_production';

export interface CognitiveSignal {
  key: CognitiveSignalKey;
  polarity: 'positive' | 'negative' | 'neutral';
  strength: number;
  source: 'interaction' | 'event_type' | 'payload' | 'heuristic';
  evidence: string;
}

export interface DiagnosticFeatures {
  schema: 'diagnostic_features.v1';
  eventFamily: LearningEventFamily;
  dialogueAct?: string;
  dialogueActConfidence?: number;
  helpSeekingLevel: number;
  confusionLevel: number;
  masteryEvidenceLevel: number;
  errorEvidenceLevel: number;
  engagementLevel: number;
  reviewPressureLevel: number;
  planningIntentLevel: number;
  artifactProductionLevel: number;
  conceptCandidates: string[];
  textStats: {
    userTextLength: number;
    assistantTextLength: number;
    questionMarkCount: number;
  };
}

export interface EventQuality {
  schema: 'event_quality.v1';
  status: 'accepted' | 'low_confidence' | 'incomplete';
  score: number;
  sourceTrust: number;
  completeness: number;
  hasObject: boolean;
  hasInteraction: boolean;
  hasClientEventId: boolean;
  idempotencyBasis?: string | null;
  warnings: string[];
}

export interface EnrichedLearningEvent {
  schemaVersion: 'learning_event.v2';
  eventType: string;
  eventFamily: LearningEventFamily;
  actor: LearningEventActor;
  objectType: string | null;
  objectId: string | null;
  sessionId: string | null;
  idempotencyKey: string | null;
  cognitiveSignals: CognitiveSignal[];
  diagnosticFeatures: DiagnosticFeatures;
  quality: EventQuality;
  confidence: number;
}

const clamp01 = (value: unknown, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
};

const textOf = (value: unknown) => String(value || '').trim();

const unique = (items: Array<string | null | undefined>) =>
  Array.from(new Set(items.map((item) => textOf(item)).filter(Boolean)));

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 40);

const eventFamilies: Array<{ pattern: RegExp; family: LearningEventFamily }> = [
  { pattern: /^(course|workbench)\./, family: 'navigation' },
  { pattern: /^(resource|file)\./, family: 'resource' },
  { pattern: /^(ai|chat|conversation)\./, family: 'dialogue' },
  { pattern: /^(quiz|assignment|task)\./, family: 'assessment' },
  { pattern: /^(hint|help)\./, family: 'help' },
  { pattern: /^learner\.marked_/, family: 'self_report' },
  { pattern: /^(flashcard|review)\./, family: 'review' },
  { pattern: /^(mcl\.plan|plan\.|goal\.)/, family: 'planning' },
  { pattern: /^(mcl\.artifact|artifact|studio|generated)\./, family: 'production' },
  { pattern: /^(system|schema)\./, family: 'system' }
];

export const classifyLearningEventFamily = (eventType: string): LearningEventFamily =>
  eventFamilies.find((item) => item.pattern.test(eventType))?.family || 'unknown';

const conceptCandidatesFromText = (text: string) => {
  const candidates: string[] = [];
  for (const match of text.matchAll(/[「“"]([^」”"]{2,80})[」”"]/g)) {
    candidates.push(match[1]);
  }
  const patterns = [
    /(?:关于|围绕|学习|理解|掌握|解释|讲讲|梳理)\s*([^，。！？\n]{2,80})/g,
    /(?:concept|topic|skill)\s*[:：]\s*([^,.;\n，。；]{2,80})/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) candidates.push(match[1]);
  }
  return unique(candidates).slice(0, 8);
};

const conceptCandidates = (input: CollectLearningEventInput) => {
  const payload = input.payload || {};
  const objectTitle = input.object?.title;
  const fields = [
    objectTitle,
    input.interaction?.userText,
    (payload as any).concept,
    (payload as any).skill,
    (payload as any).question?.skill,
    (payload as any).question?.learningObjective,
    Array.isArray((payload as any).question?.knowledgePoints) ? (payload as any).question.knowledgePoints.join(' ') : '',
    (payload as any).question?.question,
    (payload as any).result?.feedback
  ].filter(Boolean).map((item) => textOf(item));
  return unique([
    ...fields.filter((item) => item.length > 1 && item.length < 90),
    ...fields.flatMap(conceptCandidatesFromText)
  ]).slice(0, 8);
};

const signal = (
  key: CognitiveSignalKey,
  polarity: CognitiveSignal['polarity'],
  strength: number,
  source: CognitiveSignal['source'],
  evidence: string
): CognitiveSignal => ({
  key,
  polarity,
  strength: clamp01(strength),
  source,
  evidence
});

export interface DialogueActResult {
  act:
    | 'question'
    | 'clarification_request'
    | 'confusion_statement'
    | 'hint_request'
    | 'repair_or_reask'
    | 'answer_attempt'
    | 'self_explanation'
    | 'reflection'
    | 'planning_request'
    | 'summary_request'
    | 'resource_request'
    | 'feedback_request'
    | 'confirmation'
    | 'off_task'
    | 'learner_utterance';
  confidence: number;
  markers: string[];
}

export const classifyDialogueAct = (
  text: string,
  interaction: CollectLearningEventInput['interaction'],
  eventType?: string
): DialogueActResult | undefined => {
  const markers: string[] = [];
  const lower = text.toLowerCase();
  const choose = (act: DialogueActResult['act'], confidence: number, marker: string): DialogueActResult => ({
    act,
    confidence: clamp01(confidence),
    markers: [...markers, marker]
  });

  if (interaction?.hintUsed || eventType === 'hint.used' || /提示|hint|给点线索|提醒/.test(text)) {
    return choose('hint_request', 0.86, 'hint_marker');
  }
  if (interaction?.repeatedQuestion || /还是不懂|再说一遍|换个说法|重新解释|again|still confused/i.test(text)) {
    return choose('repair_or_reask', 0.84, 'repair_marker');
  }
  if (/不懂|没懂|不会|看不懂|confus|stuck|lost/i.test(text)) {
    return choose('confusion_statement', 0.82, 'confusion_marker');
  }
  if (/我觉得|我的理解|是不是可以理解|所以|because|therefore|因此|也就是说/.test(text) && text.length > 18) {
    return choose('self_explanation', 0.72, 'self_explanation_marker');
  }
  if (/答案是|我选|应该是|我的答案|提交|answer is|i choose/i.test(text) || eventType === 'quiz.answer_submitted') {
    return choose('answer_attempt', 0.78, 'answer_marker');
  }
  if (/对吗|哪里错|错在哪|反馈|评价|批改|check|feedback/i.test(text)) {
    return choose('feedback_request', 0.75, 'feedback_marker');
  }
  if (/资料|资源|文档|课件|论文|找.*材料|resource|reference/i.test(text)) {
    return choose('resource_request', 0.7, 'resource_marker');
  }
  if (/总结|归纳|复盘|整理|summary|recap/i.test(text)) {
    return choose('summary_request', 0.74, 'summary_marker');
  }
  if (/计划|目标|安排|路径|roadmap|下一步|怎么学/i.test(text)) {
    return choose('planning_request', 0.76, 'planning_marker');
  }
  if (/反思|收获|复盘一下|我学到了|reflection/i.test(text)) {
    return choose('reflection', 0.72, 'reflection_marker');
  }
  if (/为什么|怎么|如何|什么是|区别|what|why|how|\?/.test(text)) {
    return choose(/区别|对比|差别|vs\.?|versus/i.test(text) ? 'clarification_request' : 'question', 0.68, 'question_marker');
  }
  if (/好的|明白|懂了|yes|ok|got it/i.test(lower)) {
    return choose('confirmation', 0.62, 'confirmation_marker');
  }
  if (/天气|电影|游戏|无关|随便聊/.test(text)) {
    return choose('off_task', 0.58, 'off_task_marker');
  }
  return text ? choose('learner_utterance', 0.42, 'fallback') : undefined;
};

export const extractCognitiveSignals = (input: CollectLearningEventInput): CognitiveSignal[] => {
  const signals: CognitiveSignal[] = [];
  const type = input.eventType;
  const interaction = input.interaction || {};
  const payload = input.payload || {};
  const userText = textOf(interaction.userText);
  const score = interaction.score ?? (payload as any).score ?? (payload as any).result?.score;
  const normalizedScore = Number.isFinite(Number(score)) ? clamp01(score) : null;

  if (type === 'course.entered') signals.push(signal('course_engagement', 'positive', 0.45, 'event_type', type));
  if (type === 'workbench.opened') signals.push(signal('workbench_engagement', 'positive', 0.5, 'event_type', type));
  if (type === 'resource.viewed') signals.push(signal('resource_attention', 'neutral', 0.46, 'event_type', type));
  if (/mcl\.plan|goal|plan\./.test(type) || /计划|目标|路径|安排/.test(userText)) {
    signals.push(signal('planning_intent', 'neutral', 0.55, /mcl\.plan/.test(type) ? 'event_type' : 'heuristic', type));
  }
  if (/artifact|generated|studio/.test(type)) signals.push(signal('artifact_production', 'positive', 0.56, 'event_type', type));
  if (interaction.hintUsed || type === 'hint.used') signals.push(signal('hint_dependency', 'negative', 0.56, 'interaction', 'hint used'));
  if (interaction.repeatedQuestion) signals.push(signal('repeated_question', 'negative', 0.62, 'interaction', 'repeated question'));
  if (/不懂|没懂|不会|看不懂|confus/i.test(userText)) {
    signals.push(signal('explicit_confusion', 'negative', 0.68, 'heuristic', userText.slice(0, 160)));
  }
  if (/为什么|怎么|如何|what|why|how|\?/.test(userText) || interaction.hintUsed) {
    signals.push(signal('help_seeking', 'neutral', interaction.hintUsed ? 0.62 : 0.44, 'heuristic', userText.slice(0, 160) || type));
  }
  if (type === 'quiz.answer_submitted' || normalizedScore !== null || interaction.answerCorrect !== undefined) {
    signals.push(signal('answer_attempt', 'neutral', 0.58, 'event_type', type));
    if (normalizedScore !== null) {
      if (normalizedScore >= 0.82 || interaction.answerCorrect === true) {
        signals.push(signal('correct_answer', 'positive', Math.max(0.65, normalizedScore), 'interaction', `score=${normalizedScore}`));
      } else if (normalizedScore <= 0.45 || interaction.answerCorrect === false) {
        signals.push(signal('incorrect_answer', 'negative', Math.max(0.55, 1 - normalizedScore), 'interaction', `score=${normalizedScore}`));
      } else {
        signals.push(signal('partial_mastery', 'neutral', 0.52, 'interaction', `score=${normalizedScore}`));
      }
    }
  }
  if (interaction.markedUnknown || type === 'learner.marked_unknown') {
    signals.push(signal('self_reported_unknown', 'negative', 0.72, 'interaction', 'learner marked unknown'));
  }
  if (interaction.markedMastered || type === 'learner.marked_mastered') {
    signals.push(signal('self_reported_mastery', 'positive', 0.68, 'interaction', 'learner marked mastered'));
  }
  if (type === 'flashcard.reviewed') {
    if (normalizedScore !== null && normalizedScore >= 0.8) {
      signals.push(signal('retrieval_strength', 'positive', normalizedScore, 'interaction', `review score=${normalizedScore}`));
    }
    if (normalizedScore !== null && normalizedScore < 0.55) {
      signals.push(signal('retrieval_difficulty', 'negative', 1 - normalizedScore, 'interaction', `review score=${normalizedScore}`));
    }
  }
  return signals;
};

export const buildDiagnosticFeatures = (
  input: CollectLearningEventInput,
  family: LearningEventFamily,
  signals: CognitiveSignal[]
): DiagnosticFeatures => {
  const userText = textOf(input.interaction?.userText);
  const assistantText = textOf(input.interaction?.assistantText);
  const dialogueAct = family === 'dialogue' || family === 'help' || family === 'assessment'
    ? classifyDialogueAct(userText, input.interaction, input.eventType)
    : undefined;
  const strengthOf = (keys: CognitiveSignalKey[]) =>
    signals.filter((item) => keys.includes(item.key)).reduce((max, item) => Math.max(max, item.strength), 0);

  return {
    schema: 'diagnostic_features.v1',
    eventFamily: family,
    dialogueAct: dialogueAct?.act,
    dialogueActConfidence: dialogueAct?.confidence,
    helpSeekingLevel: strengthOf(['help_seeking', 'hint_dependency', 'repeated_question']),
    confusionLevel: strengthOf(['explicit_confusion', 'self_reported_unknown', 'incorrect_answer']),
    masteryEvidenceLevel: strengthOf(['correct_answer', 'self_reported_mastery', 'retrieval_strength']),
    errorEvidenceLevel: strengthOf(['incorrect_answer', 'retrieval_difficulty']),
    engagementLevel: strengthOf(['course_engagement', 'workbench_engagement', 'resource_attention', 'answer_attempt']),
    reviewPressureLevel: strengthOf(['retrieval_difficulty', 'self_reported_unknown']),
    planningIntentLevel: strengthOf(['planning_intent']),
    artifactProductionLevel: strengthOf(['artifact_production']),
    conceptCandidates: conceptCandidates(input),
    textStats: {
      userTextLength: userText.length,
      assistantTextLength: assistantText.length,
      questionMarkCount: (userText.match(/[?？]/g) || []).length
    }
  };
};

const sourceTrust = (input: CollectLearningEventInput) => {
  const component = textOf(input.source?.component);
  if (/quiz|flashcard|learning_terminal|mcl|orchestrator|studio/i.test(component)) return 0.82;
  if (input.actor === 'agent' || input.actor === 'system') return 0.78;
  if (input.source?.clientEventId) return 0.74;
  if (component) return 0.68;
  return 0.55;
};

const idempotencyBasis = (input: CollectLearningEventInput) => {
  const explicit =
    input.source?.clientEventId ||
    input.interaction?.messageId ||
    textOf((input.payload || {}).dedupeKey) ||
    textOf((input.payload || {}).clientEventId);
  if (!explicit) return null;
  return [
    input.workspaceId,
    input.workbenchId || '',
    input.goalId || '',
    input.eventType,
    input.actor || 'system',
    explicit
  ].join('|');
};

export const assessEventQuality = (
  input: CollectLearningEventInput,
  signals: CognitiveSignal[],
  diagnosticFeatures: DiagnosticFeatures
): EventQuality => {
  const warnings: string[] = [];
  const trust = sourceTrust(input);
  const hasObject = Boolean(input.object?.type || input.object?.id || input.object?.title);
  const hasInteraction = Boolean(input.interaction && Object.keys(input.interaction).length > 0);
  const hasClientEventId = Boolean(input.source?.clientEventId);
  const family = diagnosticFeatures.eventFamily;
  if (family === 'unknown') warnings.push('unknown_event_family');
  if (!hasObject && ['resource', 'assessment', 'review', 'self_report'].includes(family)) warnings.push('missing_learning_object');
  if (!hasInteraction && ['dialogue', 'help', 'assessment'].includes(family)) warnings.push('missing_interaction_payload');
  if (signals.length === 0) warnings.push('no_cognitive_signal');

  const completeness = clamp01(
    0.34 +
      (hasObject ? 0.18 : 0) +
      (hasInteraction ? 0.18 : 0) +
      (input.workbenchId ? 0.08 : 0) +
      (input.goalId ? 0.06 : 0) +
      (signals.length ? 0.16 : 0)
  );
  const score = clamp01(trust * 0.48 + completeness * 0.38 + clamp01(input.confidence, 0.58) * 0.14);
  return {
    schema: 'event_quality.v1',
    status: score < 0.35 ? 'incomplete' : score < 0.5 ? 'low_confidence' : 'accepted',
    score,
    sourceTrust: trust,
    completeness,
    hasObject,
    hasInteraction,
    hasClientEventId,
    idempotencyBasis: idempotencyBasis(input),
    warnings
  };
};

export const enrichLearningEvent = (input: CollectLearningEventInput): EnrichedLearningEvent => {
  const family = classifyLearningEventFamily(input.eventType);
  const signals = extractCognitiveSignals(input);
  const diagnosticFeatures = buildDiagnosticFeatures(input, family, signals);
  const quality = assessEventQuality(input, signals, diagnosticFeatures);
  const basis = quality.idempotencyBasis;
  const baseConfidence = clamp01(input.confidence, 0.58);
  return {
    schemaVersion: 'learning_event.v2',
    eventType: input.eventType,
    eventFamily: family,
    actor: input.actor || 'system',
    objectType: input.object?.type || null,
    objectId: input.object?.id || null,
    sessionId: input.interaction?.sessionId || null,
    idempotencyKey: basis ? hash(basis) : null,
    cognitiveSignals: signals,
    diagnosticFeatures,
    quality,
    confidence: clamp01(baseConfidence * 0.72 + quality.score * 0.28, baseConfidence)
  };
};
