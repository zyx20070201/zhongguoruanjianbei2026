import prisma from '../config/db';
import { aiModelProviderService } from './aiModelProviderService';
import { stableHash } from './chunkSchema';

type SourceType = 'stable_profile' | 'working_state' | 'observation_memory' | 'saved_memory' | 'event' | 'knowledge_graph' | 'diagnosis';

export type PortraitDimension =
  | 'learningBackground'
  | 'learningGoal'
  | 'knowledgeFoundation'
  | 'cognitiveStyle'
  | 'learningPreference'
  | 'errorPattern'
  | 'learningRisk'
  | 'metacognitiveStrategy'
  | 'supportNeed';

export type PortraitStatus = 'stable' | 'active' | 'candidate' | 'needs_review';
export type PortraitPolarity = 'strength' | 'need' | 'risk' | 'preference' | 'neutral';

export interface PortraitEvidence {
  id: string;
  sourceType: SourceType;
  sourceId?: string | null;
  summary: string;
  confidence: number;
  observedAt?: string | null;
  relatedConcepts?: string[];
}

export interface LearnerPortraitEntity {
  id: string;
  dimension: PortraitDimension;
  type: string;
  title: string;
  description: string;
  status: PortraitStatus;
  polarity: PortraitPolarity;
  confidence: number;
  severity?: 'low' | 'medium' | 'high';
  evidenceCount: number;
  evidence: PortraitEvidence[];
  affectedConcepts: string[];
  recommendation?: string;
  updatedAt?: string | null;
  mergedFrom?: string[];
  mergeReason?: string;
  aliases?: string[];
  resolutionSource?: 'builder' | 'semantic_resolver' | 'resolver_fallback';
}

type ProfileLikeEntry = {
  id: string;
  dimension: string;
  label: string;
  value: string;
  confidence?: number | null;
  status?: string | null;
  evidenceCount?: number;
  source: SourceType;
  observedAt?: string | null;
  rationale?: string | null;
  eventFamily?: string | null;
  eventType?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  diagnosticFeatures?: Record<string, any> | null;
  cognitiveSignals?: Array<Record<string, any>> | null;
  quality?: Record<string, any> | null;
};

type CandidateEntity = Omit<LearnerPortraitEntity, 'confidence' | 'evidenceCount' | 'evidence' | 'affectedConcepts' | 'updatedAt'> & {
  evidence: PortraitEvidence[];
  affectedConcepts?: string[];
  confidence?: number;
};

type ExtractablePortraitDimension = 'learningGoal' | 'knowledgeFoundation' | 'metacognitiveStrategy' | 'learningRisk';

type LlmExtractedCandidate = {
  dimension?: string;
  type?: string;
  title?: string;
  description?: string;
  polarity?: string;
  status?: string;
  confidence?: number;
  severity?: string;
  evidenceIds?: string[];
  affectedConcepts?: string[];
  recommendation?: string;
};

const clip = (value: unknown, maxLength = 220) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const safeArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableLlmError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|socket|econnreset|etimedout|timeout|temporarily unavailable/i.test(message);
};

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const normalize = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .replace(/epsilon/g, 'ε')
    .replace(/[\s"'`“”‘’.,，。:：;；!?！？()[\]{}<>《》/\\|-]+/g, '')
    .trim();

const stableId = (dimension: PortraitDimension, type: string, title: string) =>
  `${dimension}:${type}:${normalize(title).slice(0, 80) || 'entity'}`;

const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const clamp01 = (value: number) => Math.max(0, Math.min(1, Number(value) || 0));

const statusFrom = (confidence: number, evidenceCount: number, hasRisk = false): PortraitStatus => {
  if (confidence >= 0.72 && evidenceCount >= 2) return 'stable';
  if (confidence >= 0.52 || hasRisk) return 'active';
  if (confidence >= 0.34) return 'candidate';
  return 'needs_review';
};

const severityFrom = (score: number): 'low' | 'medium' | 'high' => {
  if (score >= 0.74) return 'high';
  if (score >= 0.48) return 'medium';
  return 'low';
};

const unique = (items: string[], limit = 8) =>
  Array.from(new Set(items.map((item) => clip(item, 120)).filter(Boolean))).slice(0, limit);

const evidenceFromEntry = (entry: ProfileLikeEntry): PortraitEvidence => ({
  id: entry.id,
  sourceType: entry.source,
  sourceId: entry.id,
  summary: clip(entry.value || entry.label, 180),
  confidence: clamp01(Number(entry.confidence ?? 0.5)),
  observedAt: entry.observedAt || null,
  relatedConcepts: entry.dimension === 'knowledgeState' || entry.dimension === 'misconceptionState' ? [clip(entry.value, 80)] : []
});

const collectConcepts = (entries: ProfileLikeEntry[]) =>
  unique(entries
    .filter((entry) => entry.dimension === 'knowledgeState' || entry.dimension === 'misconceptionState')
    .map((entry) => entry.value), 10);

const strongEventFamilies = new Set(['dialogue', 'assessment', 'help', 'self_report', 'review', 'planning', 'production']);
const weakEventFamilies = new Set(['navigation', 'resource']);
const strongEventTypes = [
  /^ai\.chat_turn$/,
  /^chat\./,
  /^conversation\./,
  /^quiz\./,
  /^hint\./,
  /^learner\.marked_/,
  /^flashcard\./,
  /^review\./,
  /^mcl\.plan/,
  /^goal\./,
  /^learning_plan\./,
  /^task\.completed$/,
  /^assignment\.submitted$/
];

const eventTypeOf = (entry: ProfileLikeEntry) => entry.eventType || entry.label || '';

const isStrongLearningEvidence = (entry: ProfileLikeEntry) => {
  if (entry.source !== 'event') return true;
  const eventFamily = String(entry.eventFamily || '');
  const eventType = eventTypeOf(entry);
  if (strongEventFamilies.has(eventFamily)) return true;
  if (strongEventTypes.some((pattern) => pattern.test(eventType))) return true;
  if (entry.diagnosticFeatures?.dialogueAct) return true;
  if (safeArray<Record<string, any>>(entry.cognitiveSignals).some((signal) =>
    ['help_seeking', 'explicit_confusion', 'repeated_question', 'hint_dependency', 'answer_attempt', 'correct_answer', 'incorrect_answer', 'partial_mastery', 'self_reported_unknown', 'self_reported_mastery', 'retrieval_strength', 'retrieval_difficulty', 'planning_intent'].includes(String(signal.key || ''))
  )) return true;
  return false;
};

const isWeakBehaviorEvidence = (entry: ProfileLikeEntry) =>
  entry.source === 'event' && (
    weakEventFamilies.has(String(entry.eventFamily || '')) ||
    /^(workbench|course|resource|file)\./.test(eventTypeOf(entry))
  );

const evidenceWeight = (entry: ProfileLikeEntry) => {
  if (entry.source === 'saved_memory') return 1;
  if (entry.source === 'stable_profile') return 0.92;
  if (entry.source === 'working_state' || entry.source === 'observation_memory') return 0.78;
  if (entry.source === 'knowledge_graph' || entry.source === 'diagnosis') return 0.86;
  if (isStrongLearningEvidence(entry)) return 0.82;
  if (isWeakBehaviorEvidence(entry)) return 0.25;
  return 0.5;
};

const weightedEvidence = (entry: ProfileLikeEntry): PortraitEvidence => ({
  ...evidenceFromEntry(entry),
  confidence: clamp01(Number(entry.confidence ?? 0.5) * evidenceWeight(entry))
});

const hasPrimaryEvidence = (items: ProfileLikeEntry[]) => items.some((entry) => !isWeakBehaviorEvidence(entry));

const isExtractableDimension = (value: unknown): value is ExtractablePortraitDimension =>
  value === 'learningGoal' || value === 'knowledgeFoundation' || value === 'metacognitiveStrategy' || value === 'learningRisk';

const polarityForDimension = (dimension: ExtractablePortraitDimension, value?: string): PortraitPolarity => {
  if (value === 'strength' || value === 'need' || value === 'risk' || value === 'preference' || value === 'neutral') return value;
  if (dimension === 'learningRisk') return 'risk';
  if (dimension === 'knowledgeFoundation') return 'neutral';
  return 'neutral';
};

const statusForExtracted = (value: unknown, confidence: number, evidenceCount: number, dimension: ExtractablePortraitDimension): PortraitStatus => {
  if (value === 'stable' && confidence >= 0.72 && evidenceCount >= 2) return 'stable';
  if (value === 'active' || value === 'candidate' || value === 'needs_review') return value;
  return statusFrom(confidence, evidenceCount, dimension === 'learningRisk');
};

const severityForExtracted = (value: unknown, confidence: number): 'low' | 'medium' | 'high' | undefined => {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return confidence >= 0.5 ? severityFrom(confidence) : undefined;
};

const mergeCandidates = (candidates: CandidateEntity[]): LearnerPortraitEntity[] => {
  const grouped = new Map<string, CandidateEntity[]>();
  candidates.forEach((candidate) => {
    grouped.set(candidate.id, [...(grouped.get(candidate.id) || []), candidate]);
  });
  return Array.from(grouped.values()).map((items) => {
    const base = items[0];
    const evidence = items.flatMap((item) => item.evidence);
    const dedupedEvidence: PortraitEvidence[] = [];
    evidence.forEach((item) => {
      if (!dedupedEvidence.some((existing) => existing.id === item.id && existing.sourceType === item.sourceType)) {
        dedupedEvidence.push(item);
      }
    });
    const confidence = clamp01(Math.max(
      base.confidence || 0,
      avg(dedupedEvidence.map((item) => item.confidence)) * 0.72 + Math.min(0.2, dedupedEvidence.length * 0.04) + (base.status === 'stable' ? 0.08 : 0)
    ));
    const hasRisk = base.polarity === 'risk';
    return {
      ...base,
      confidence: Number(confidence.toFixed(3)),
      status: base.status === 'stable' ? 'stable' : statusFrom(confidence, dedupedEvidence.length, hasRisk),
      evidenceCount: dedupedEvidence.length,
      evidence: dedupedEvidence.slice(0, 8),
      affectedConcepts: unique(items.flatMap((item) => item.affectedConcepts || []).concat(dedupedEvidence.flatMap((item) => item.relatedConcepts || [])), 8),
      updatedAt: dedupedEvidence.map((item) => item.observedAt).filter(Boolean).sort().reverse()[0] || null
    };
  });
};

export class LearnerPortraitEntityBuilderService {
  private compactEvidence(entries: ProfileLikeEntry[]) {
    return entries
      .filter((entry) => entry.value || entry.rationale)
      .filter((entry) => entry.source !== 'event' || isStrongLearningEvidence(entry))
      .sort((a, b) => new Date(b.observedAt || 0).getTime() - new Date(a.observedAt || 0).getTime())
      .slice(0, Number(process.env.LEARNER_PORTRAIT_EXTRACTOR_MAX_EVIDENCE || 36))
      .map((entry) => ({
        id: entry.id,
        source: entry.source,
        evidenceWeight: evidenceWeight(entry),
        dimension: entry.dimension,
        label: clip(entry.label, 60),
        value: clip(entry.value, 260),
        rationale: clip(entry.rationale || '', 180),
        confidence: clamp01(Number(entry.confidence ?? 0.5)),
        observedAt: entry.observedAt || null,
        eventFamily: entry.eventFamily || null,
        eventType: entry.eventType || null,
        dialogueAct: entry.diagnosticFeatures?.dialogueAct || null,
        diagnostic: entry.diagnosticFeatures ? {
          helpSeekingLevel: entry.diagnosticFeatures.helpSeekingLevel,
          confusionLevel: entry.diagnosticFeatures.confusionLevel,
          masteryEvidenceLevel: entry.diagnosticFeatures.masteryEvidenceLevel,
          errorEvidenceLevel: entry.diagnosticFeatures.errorEvidenceLevel,
          reviewPressureLevel: entry.diagnosticFeatures.reviewPressureLevel,
          planningIntentLevel: entry.diagnosticFeatures.planningIntentLevel,
          conceptCandidates: safeArray<string>(entry.diagnosticFeatures.conceptCandidates).slice(0, 5)
        } : null,
        cognitiveSignals: safeArray<Record<string, any>>(entry.cognitiveSignals).map((signal) => ({
          key: signal.key,
          polarity: signal.polarity,
          strength: signal.strength,
          evidence: clip(signal.evidence, 100)
        })).slice(0, 6),
        ecnuSignalFrame: {
          cognitive: ['question', 'clarification_request', 'confusion_statement', 'answer_attempt', 'self_explanation'].includes(String(entry.diagnosticFeatures?.dialogueAct || '')) || safeArray<Record<string, any>>(entry.cognitiveSignals).some((signal) => /confusion|answer|mastery|unknown|correct|incorrect/.test(String(signal.key || ''))),
          behavioral: isStrongLearningEvidence(entry) && entry.source === 'event',
          emotional: /焦虑|压力|frustrat|anxious|overwhelm|崩溃|紧张/i.test(`${entry.value} ${entry.rationale || ''}`),
          metacognitive: ['reflection', 'planning_request', 'summary_request', 'feedback_request'].includes(String(entry.diagnosticFeatures?.dialogueAct || '')) || safeArray<Record<string, any>>(entry.cognitiveSignals).some((signal) => /planning|help_seeking|repeated_question|hint_dependency/.test(String(signal.key || ''))),
          contextual: Boolean(entry.objectType || entry.objectId || entry.eventFamily)
        }
      }));
  }

  private sanitizeExtractedCandidates(extracted: LlmExtractedCandidate[], entries: ProfileLikeEntry[]): CandidateEntity[] {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return extracted
      .slice(0, Number(process.env.LEARNER_PORTRAIT_EXTRACTOR_MAX_OUTPUT || 12))
      .flatMap((item): CandidateEntity[] => {
        if (!isExtractableDimension(item.dimension)) return [];
        const evidenceEntries = unique(safeArray<string>(item.evidenceIds).map(String), 6)
          .map((id) => byId.get(id))
          .filter(Boolean) as ProfileLikeEntry[];
        if (!evidenceEntries.length) return [];
        const confidence = clamp01(Number(item.confidence ?? avg(evidenceEntries.map((entry) => Number(entry.confidence ?? 0.55)))));
        const title = clip(item.title, 72);
        if (!title) return [];
        const dimension = item.dimension;
        const type = clip(item.type || 'llmSignal', 48);
        return [{
          id: stableId(dimension, type, title || stableHash(item).slice(0, 12)),
          dimension,
          type,
          title,
          description: clip(item.description || title, 220),
          polarity: polarityForDimension(dimension, item.polarity),
          status: statusForExtracted(item.status, confidence, evidenceEntries.length, dimension),
          confidence: Number(confidence.toFixed(3)),
          severity: dimension === 'learningRisk' ? severityForExtracted(item.severity, confidence) : undefined,
          evidence: evidenceEntries.map(weightedEvidence),
          affectedConcepts: unique(safeArray<string>(item.affectedConcepts).map(String), 8),
          recommendation: clip(item.recommendation || '', 180) || undefined
        }];
      });
  }

  private async extractLlmCandidates(input: { workspaceId: string; workbenchId?: string | null; entries: ProfileLikeEntry[] }): Promise<CandidateEntity[]> {
    if (!aiModelProviderService.isConfigured({ useCase: 'memory' })) return [];
    const evidence = this.compactEvidence(input.entries);
    if (!evidence.length) return [];
    const maxAttempts = Math.max(1, Number(process.env.LEARNER_PORTRAIT_EXTRACTOR_LLM_ATTEMPTS || 2));
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await aiModelProviderService.json<{ candidates?: LlmExtractedCandidate[] }>({
          useCase: 'memory',
          timeoutMs: Number(process.env.LEARNER_PORTRAIT_EXTRACTOR_TIMEOUT_MS || 0),
          instruction: [
            '你是学习画像候选抽取器，负责从学习事件、对话摘要、工作态和保存记忆中抽取结构化 learner portrait candidates。',
            '只允许抽取四类 dimension: learningGoal, knowledgeFoundation, metacognitiveStrategy, learningRisk。',
            '不要抽取学习偏好、支持需求或背景信息；这些已有专门规则处理。',
            '每个候选必须引用输入 evidence 的 id；没有明确证据就不要输出。',
            '优先使用 workbench 内 AI chat 对话、quiz/hint/self_report/review/diagnosis/saved memory 作为主证据；navigation/resource 这类弱行为不得单独支撑画像候选。',
            '可以参考 ECNUClaw 五维信号理解输入：cognitive=概念理解/问题/答案，behavioral=练习/提示/复习行为，emotional=压力/挫败/信心表达，metacognitive=反思/计划/监控/求助策略，contextual=工作台/资源/任务上下文。',
            '保持保守：目标必须来自用户表达、计划或持续 AI chat/任务内容；知识基础必须来自掌握/薄弱/误区/题目表现；元认知策略必须来自反思、计划、监控、求助方式；风险必须来自困惑、错误、低 readiness、反复求助或复习压力。',
            '不要新增输入没有的课程、概念或心理诊断。低证据内容用 candidate/needs_review，置信度不要超过 0.72。'
          ].join('\n'),
          schema: {
            candidates: [{
              dimension: 'learningGoal|knowledgeFoundation|metacognitiveStrategy|learningRisk',
              type: 'string',
              title: 'string',
              description: 'string',
              polarity: 'strength|need|risk|neutral',
              status: 'stable|active|candidate|needs_review',
              confidence: 0.6,
              severity: 'low|medium|high',
              evidenceIds: ['string'],
              affectedConcepts: ['string'],
              recommendation: 'string'
            }]
          },
          input: {
            workspaceId: input.workspaceId,
            workbenchId: input.workbenchId || null,
            evidence
          },
          systemPrompt: '只输出 JSON。你抽取的是可追溯学习画像候选，必须证据约束、宁缺毋滥。'
        });
        return this.sanitizeExtractedCandidates(safeArray<LlmExtractedCandidate>(result.data?.candidates), input.entries);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isRetryableLlmError(error)) break;
        await sleep(500 * attempt);
      }
    }

    console.warn('Learner portrait candidate extractor skipped:', {
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      error: lastError instanceof Error ? lastError.message : String(lastError)
    });
    return [];
  }

  async build(input: {
    workspaceId: string;
    workbenchId?: string | null;
    stableProfile: ProfileLikeEntry[];
    workingState: ProfileLikeEntry[];
    savedMemoryEntries: ProfileLikeEntry[];
    recentEvents: ProfileLikeEntry[];
    limit?: number;
    forceLlmExtraction?: boolean;
  }) {
    const conceptScopeWhere = input.workbenchId
      ? { bindings: { some: { workbenchId: input.workbenchId } } }
      : {};
    const [conceptStates, misconceptions] = await Promise.all([
      prisma.courseKnowledgeLearnerState.findMany({
        where: { workspaceId: input.workspaceId, status: 'active', concept: conceptScopeWhere },
        include: { concept: true },
        orderBy: [{ weaknessEstimate: 'desc' }, { updatedAt: 'desc' }],
        take: 32
      }),
      prisma.courseKnowledgeMisconception.findMany({
        where: { workspaceId: input.workspaceId, concept: conceptScopeWhere },
        include: { concept: true },
        orderBy: [{ severity: 'desc' }, { updatedAt: 'desc' }],
        take: 24
      }).catch(() => [])
    ]);

    const entries = [
      ...input.stableProfile,
      ...input.workingState,
      ...input.savedMemoryEntries,
      ...input.recentEvents
    ].filter((entry) => entry.value);
    const candidates: CandidateEntity[] = [];
    const byDimension = (dimension: string) => entries.filter((entry) => entry.dimension === dimension);
    const bySource = (source: SourceType) => entries.filter((entry) => entry.source === source);
    const contains = (patterns: RegExp[]) => entries.filter((entry) => patterns.some((pattern) => pattern.test(`${entry.label} ${entry.value} ${entry.rationale || ''}`)));

    const profileBase = byDimension('profileBase');
    const knowledge = byDimension('knowledgeState');
    const preferences = byDimension('preferenceStyle').concat(input.savedMemoryEntries.filter((entry) => /prefer|preference|偏好|喜欢|解释|例子|代码|图解/i.test(`${entry.label} ${entry.value}`)));
    const misconceptionsFromSignals = byDimension('misconceptionState');
    const cognitive = byDimension('cognitiveState');
    const behavior = byDimension('behaviorEngagement');
    const planning = byDimension('reviewPlanning');
    const observations = bySource('observation_memory');

    profileBase.filter((entry) => /专业|课程|年级|背景|项目|实验|作业|course|major|project|lab/i.test(`${entry.label} ${entry.value}`)).slice(0, 5).forEach((entry) => {
      candidates.push({
        id: stableId('learningBackground', 'context', entry.value),
        dimension: 'learningBackground',
        type: 'context',
        title: clip(entry.value, 48),
        description: `学习背景线索：${clip(entry.value, 120)}`,
        polarity: 'neutral',
        status: entry.source === 'stable_profile' ? 'stable' : 'active',
        evidence: [evidenceFromEntry(entry)],
        recommendation: '后续推荐资源和学习计划应优先贴合该课程/项目场景。'
      });
    });

    profileBase.filter((entry) => /目标|计划|准备|考试|完成|掌握|希望|需要|goal|objective/i.test(`${entry.label} ${entry.value}`)).slice(0, 6).forEach((entry) => {
      if (isWeakBehaviorEvidence(entry)) return;
      candidates.push({
        id: stableId('learningGoal', 'goal', entry.value),
        dimension: 'learningGoal',
        type: 'goal',
        title: clip(entry.value, 52),
        description: `当前目标或成功标准：${clip(entry.value, 140)}`,
        polarity: 'neutral',
        status: entry.source === 'stable_profile' ? 'stable' : 'active',
        evidence: [weightedEvidence(entry)],
        recommendation: '把诊断、资料推荐和练习安排都绑定到这个目标上。'
      });
    });

    conceptStates.slice(0, 12).forEach((state) => {
      const weak = state.weaknessEstimate >= 0.54;
      const mastered = state.masteryEstimate >= 0.7;
      if (!weak && !mastered && state.readinessEstimate < 0.62) return;
      const title = state.concept.title;
      candidates.push({
        id: stableId('knowledgeFoundation', weak ? 'weakConcept' : mastered ? 'masteredConcept' : 'readyConcept', title),
        dimension: 'knowledgeFoundation',
        type: weak ? 'weakConcept' : mastered ? 'masteredConcept' : 'readyConcept',
        title: weak ? `薄弱概念：${title}` : mastered ? `已掌握：${title}` : `可继续学习：${title}`,
        description: weak
          ? `该概念的薄弱度较高，可能影响后续学习。`
          : mastered
            ? `该概念掌握度较高，可作为后续学习的基础。`
            : `该概念准备度较高，适合作为下一步学习入口。`,
        polarity: weak ? 'need' : 'strength',
        status: state.updatedAt ? 'active' : 'candidate',
        confidence: Math.max(state.masteryEstimate, state.weaknessEstimate, state.readinessEstimate),
        evidence: [{
          id: state.id,
          sourceType: 'knowledge_graph',
          sourceId: state.conceptId,
          summary: `mastery=${state.masteryEstimate.toFixed(2)}, weakness=${state.weaknessEstimate.toFixed(2)}, readiness=${state.readinessEstimate.toFixed(2)}`,
          confidence: Math.max(state.masteryEstimate, state.weaknessEstimate, state.readinessEstimate),
          observedAt: state.updatedAt.toISOString(),
          relatedConcepts: [title]
        }],
        affectedConcepts: [title],
        recommendation: weak ? '优先补一个短诊断和针对性例题。' : '可以把它作为新知识的前置支点。'
      });
    });

    knowledge.slice(0, 10).forEach((entry) => {
      if (isWeakBehaviorEvidence(entry)) return;
      candidates.push({
        id: stableId('knowledgeFoundation', /weak|薄弱|缺口|不会|错误/i.test(`${entry.label} ${entry.value}`) ? 'weakSignal' : 'knowledgeSignal', entry.value),
        dimension: 'knowledgeFoundation',
        type: /weak|薄弱|缺口|不会|错误/i.test(`${entry.label} ${entry.value}`) ? 'weakSignal' : 'knowledgeSignal',
        title: clip(entry.value, 52),
        description: `知识基础信号：${clip(entry.value, 140)}`,
        polarity: /weak|薄弱|缺口|不会|错误/i.test(`${entry.label} ${entry.value}`) ? 'need' : 'strength',
        status: entry.source === 'stable_profile' ? 'stable' : 'active',
        evidence: [weightedEvidence(entry)],
        affectedConcepts: [clip(entry.value, 80)],
        recommendation: '在计划生成时把该知识点作为诊断和资源匹配条件。'
      });
    });

    const styleRules: Array<{ type: string; title: string; patterns: RegExp[]; recommendation: string }> = [
      { type: 'exampleDriven', title: '示例驱动理解', patterns: [/例子|案例|example|worked example/i], recommendation: '讲解时先给具体例子，再抽象总结。' },
      { type: 'visualStructured', title: '视觉化/结构化理解', patterns: [/图解|可视化|流程图|结构|diagram|visual/i], recommendation: '优先使用结构图、步骤图或对照表。' },
      { type: 'stepwise', title: '步骤化加工', patterns: [/一步一步|拆解|步骤|慢一点|step/i], recommendation: '把复杂任务拆成短步骤和检查点。' },
      { type: 'codeGrounded', title: '代码/项目情境理解', patterns: [/代码|实现|demo|project|项目|调试/i], recommendation: '用代码片段和可运行检查来解释抽象概念。' }
    ];
    styleRules.forEach((rule) => {
      const matched = contains(rule.patterns).filter((entry) => ['preferenceStyle', 'cognitiveState', 'profileBase'].includes(entry.dimension)).slice(0, 5);
      if (!matched.length) return;
      candidates.push({
        id: stableId('cognitiveStyle', rule.type, rule.title),
        dimension: 'cognitiveStyle',
        type: rule.type,
        title: rule.title,
        description: `从提问方式和偏好信号看，学习者更容易通过${rule.title}吸收内容。`,
        polarity: 'preference',
        status: matched.some((entry) => entry.source === 'stable_profile' || entry.source === 'saved_memory') ? 'stable' : 'active',
        evidence: matched.map(evidenceFromEntry),
        recommendation: rule.recommendation
      });
    });

    preferences.slice(0, 8).forEach((entry) => {
      candidates.push({
        id: stableId('learningPreference', 'instructionPreference', entry.value),
        dimension: 'learningPreference',
        type: 'instructionPreference',
        title: clip(entry.value, 52),
        description: `学习偏好：${clip(entry.value, 140)}`,
        polarity: 'preference',
        status: entry.source === 'saved_memory' || entry.source === 'stable_profile' ? 'stable' : 'active',
        evidence: [evidenceFromEntry(entry)],
        recommendation: '个性化回复和资源推荐应默认遵循该偏好，除非用户纠正。'
      });
    });

    misconceptions.slice(0, 10).forEach((item) => {
      candidates.push({
        id: stableId('errorPattern', 'misconception', item.title),
        dimension: 'errorPattern',
        type: 'misconception',
        title: item.title,
        description: item.description || `围绕 ${item.concept.title} 的易错模式。`,
        polarity: 'need',
        status: item.confidence >= 0.62 ? 'active' : 'candidate',
        confidence: Math.max(item.confidence, item.severity),
        severity: severityFrom(item.severity),
        evidence: [{
          id: item.id,
          sourceType: 'diagnosis',
          sourceId: item.conceptId,
          summary: item.repairHint || item.description || item.title,
          confidence: item.confidence,
          observedAt: item.updatedAt.toISOString(),
          relatedConcepts: [item.concept.title]
        }],
        affectedConcepts: [item.concept.title],
        recommendation: item.repairHint || '安排一个针对该误区的反例和纠错练习。'
      });
    });

    misconceptionsFromSignals.slice(0, 8).forEach((entry) => {
      candidates.push({
        id: stableId('errorPattern', 'errorSignal', entry.value),
        dimension: 'errorPattern',
        type: 'errorSignal',
        title: clip(entry.value, 52),
        description: `易错/误区信号：${clip(entry.value, 140)}`,
        polarity: 'need',
        status: entry.source === 'stable_profile' ? 'stable' : 'active',
        evidence: [evidenceFromEntry(entry)],
        affectedConcepts: [clip(entry.value, 80)],
        recommendation: '用最小反例验证该误区是否仍然存在。'
      });
    });

    const riskInputs = {
      weakConcepts: conceptStates.filter((item) => item.weaknessEstimate >= 0.58).slice(0, 6),
      lowReadiness: conceptStates.filter((item) => item.readinessEstimate < 0.45 && item.weaknessEstimate >= 0.42).slice(0, 6),
      confusion: input.recentEvents.filter((entry) => isStrongLearningEvidence(entry) && /不会|不懂|卡|错|confus|help|hint|repeated|求助|看不懂/i.test(`${entry.label} ${entry.value} ${entry.rationale || ''}`)),
      reviewPressure: planning,
      hintOrRepeated: input.recentEvents.filter((entry) => isStrongLearningEvidence(entry) && /hint|repeated|again|求助|提示|反复/i.test(`${entry.label} ${entry.value} ${entry.rationale || ''}`))
    };
    if (riskInputs.lowReadiness.length) {
      candidates.push({
        id: stableId('learningRisk', 'prerequisiteGap', '知识断层风险'),
        dimension: 'learningRisk',
        type: 'prerequisiteGap',
        title: '知识断层风险',
        description: '部分概念准备度较低，可能在继续学习时形成前置缺口。',
        polarity: 'risk',
        status: 'active',
        severity: severityFrom(avg(riskInputs.lowReadiness.map((item) => 1 - item.readinessEstimate))),
        confidence: avg(riskInputs.lowReadiness.map((item) => Math.max(item.weaknessEstimate, 1 - item.readinessEstimate))),
        evidence: riskInputs.lowReadiness.map((item) => ({
          id: item.id,
          sourceType: 'knowledge_graph',
          sourceId: item.conceptId,
          summary: `${item.concept.title}: readiness=${item.readinessEstimate.toFixed(2)}, weakness=${item.weaknessEstimate.toFixed(2)}`,
          confidence: Math.max(item.weaknessEstimate, 1 - item.readinessEstimate),
          observedAt: item.updatedAt.toISOString(),
          relatedConcepts: [item.concept.title]
        })),
        affectedConcepts: riskInputs.lowReadiness.map((item) => item.concept.title),
        recommendation: '先补前置概念的最小诊断，再进入新内容。'
      });
    }
    if (riskInputs.weakConcepts.length && riskInputs.confusion.length) {
      candidates.push({
        id: stableId('learningRisk', 'surfaceUnderstanding', '表面理解/迁移风险'),
        dimension: 'learningRisk',
        type: 'surfaceUnderstanding',
        title: '表面理解/迁移风险',
        description: '薄弱概念与近期困惑同时出现，可能会照着例子完成，但换场景时迁移不足。',
        polarity: 'risk',
        status: 'active',
        severity: severityFrom(avg(riskInputs.weakConcepts.map((item) => item.weaknessEstimate))),
        evidence: [
          ...riskInputs.weakConcepts.slice(0, 4).map((item) => ({
            id: item.id,
            sourceType: 'knowledge_graph' as const,
            sourceId: item.conceptId,
            summary: `${item.concept.title}: weakness=${item.weaknessEstimate.toFixed(2)}`,
            confidence: item.weaknessEstimate,
            observedAt: item.updatedAt.toISOString(),
            relatedConcepts: [item.concept.title]
          })),
          ...riskInputs.confusion.slice(0, 4).map(weightedEvidence)
        ],
        affectedConcepts: riskInputs.weakConcepts.map((item) => item.concept.title),
        recommendation: '用一个变式题或边界样例检查是否真的能迁移。'
      });
    }
    if (riskInputs.hintOrRepeated.length >= 2) {
      candidates.push({
        id: stableId('learningRisk', 'hintDependency', '提示依赖风险'),
        dimension: 'learningRisk',
        type: 'hintDependency',
        title: '提示依赖风险',
        description: '近期存在反复求助或提示使用信号，需要减少直接给答案，增加自检脚手架。',
        polarity: 'risk',
        status: 'active',
        severity: severityFrom(Math.min(1, riskInputs.hintOrRepeated.length / 5)),
        evidence: riskInputs.hintOrRepeated.slice(0, 6).map(weightedEvidence),
        affectedConcepts: collectConcepts(riskInputs.hintOrRepeated),
        recommendation: '先给检查清单和局部提示，让学习者自己完成关键一步。'
      });
    }
    if (riskInputs.reviewPressure.length) {
      candidates.push({
        id: stableId('learningRisk', 'forgettingRisk', '遗忘/复习压力'),
        dimension: 'learningRisk',
        type: 'forgettingRisk',
        title: '遗忘/复习压力',
        description: '近期出现复习压力或下一步回顾信号，适合安排短复盘。',
        polarity: 'risk',
        status: 'active',
        evidence: riskInputs.reviewPressure.slice(0, 6).map(evidenceFromEntry),
        affectedConcepts: collectConcepts(riskInputs.reviewPressure),
        recommendation: '生成 3-5 张回忆卡片或一次短测。'
      });
    }

    cognitive.concat(behavior).filter((entry) => !isWeakBehaviorEvidence(entry) && /反思|总结|计划|调整|哪里不会|为什么|策略|求助|monitor|reflect|plan/i.test(`${entry.label} ${entry.value} ${entry.rationale || ''}`)).slice(0, 8).forEach((entry) => {
      candidates.push({
        id: stableId('metacognitiveStrategy', 'strategySignal', entry.value),
        dimension: 'metacognitiveStrategy',
        type: /反思|总结|reflect/i.test(`${entry.label} ${entry.value}`) ? 'reflection' : /计划|plan/i.test(`${entry.label} ${entry.value}`) ? 'planning' : 'helpSeeking',
        title: clip(entry.value, 52),
        description: `元认知/学习策略信号：${clip(entry.value, 140)}`,
        polarity: 'neutral',
        status: entry.source === 'stable_profile' ? 'stable' : 'active',
        evidence: [weightedEvidence(entry)],
        recommendation: '在阶段结束时用一句反思巩固这个策略。'
      });
    });

    const supportSignals = [
      ...preferences,
      ...planning,
      ...riskInputs.confusion,
      ...observations.filter((entry) => !isWeakBehaviorEvidence(entry) && /需要|建议|下一步|练习|检查|资源|例子|图|代码|诊断|support|practice/i.test(`${entry.label} ${entry.value}`))
    ];
    const supportRules: Array<{ type: string; title: string; patterns: RegExp[]; recommendation: string }> = [
      { type: 'scaffold', title: '需要分步脚手架', patterns: [/一步一步|步骤|拆解|检查清单|卡住|不会/i], recommendation: '使用短步骤、检查点和局部提示。' },
      { type: 'diagnostic', title: '需要轻量诊断', patterns: [/诊断|哪里不会|薄弱|错|测|quiz|practice/i], recommendation: '先做 2-3 个定位题，再给资源。' },
      { type: 'workedExample', title: '需要 worked example', patterns: [/例子|案例|示例|代码|demo/i], recommendation: '先给完整示例，再让学习者改一个变量或边界条件。' },
      { type: 'review', title: '需要复习安排', patterns: [/复习|回顾|遗忘|卡片|总结|review/i], recommendation: '生成短复盘和间隔复习提醒。' }
    ];
    supportRules.forEach((rule) => {
      const matched = supportSignals.filter((entry) => rule.patterns.some((pattern) => pattern.test(`${entry.label} ${entry.value} ${entry.rationale || ''}`))).slice(0, 6);
      if (!matched.length) return;
      if (!hasPrimaryEvidence(matched)) return;
      candidates.push({
        id: stableId('supportNeed', rule.type, rule.title),
        dimension: 'supportNeed',
        type: rule.type,
        title: rule.title,
        description: `画像显示当前更适合：${rule.recommendation}`,
        polarity: 'need',
        status: matched.some((entry) => entry.source === 'stable_profile' || entry.source === 'saved_memory') ? 'stable' : 'active',
        evidence: matched.map(weightedEvidence),
        affectedConcepts: collectConcepts(matched),
        recommendation: rule.recommendation
      });
    });

    if (input.forceLlmExtraction || process.env.LEARNER_PORTRAIT_EXTRACTOR_SYNC === 'true') {
      candidates.push(...await this.extractLlmCandidates({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        entries
      }));
    }

    const merged = mergeCandidates(candidates)
      .filter((entity) => entity.evidenceCount > 0)
      .sort((a, b) => {
        const riskWeight = (b.polarity === 'risk' ? 0.12 : 0) - (a.polarity === 'risk' ? 0.12 : 0);
        if (riskWeight) return riskWeight;
        return b.confidence - a.confidence || b.evidenceCount - a.evidenceCount;
      })
      .slice(0, Math.min(Math.max(input.limit || 48, 12), 80));

    const dimensionCounts = merged.reduce<Record<string, number>>((acc, entity) => {
      acc[entity.dimension] = (acc[entity.dimension] || 0) + 1;
      return acc;
    }, {});

    return {
      schema: 'learner_portrait_entities.v1',
      sourceFrameworks: [
        'Open Learner Model: evidence-backed, inspectable learner profile',
        'ALEKS/MATHia: visual mastery and readiness state',
        'Self-Regulated Learning analytics: reflection, planning, monitoring, support needs'
      ],
      dimensions: dimensionCounts,
      entities: merged
    };
  }
}

export const learnerPortraitEntityBuilderService = new LearnerPortraitEntityBuilderService();
