import { aiModelProviderService } from './aiModelProviderService';
import { learnerStateService } from './learnerStateService';
import { learningEventCollectionService } from './learningEventCollectionService';
import { savedMemoryService } from './savedMemoryService';
import { learnerStateContextAdapter } from './learnerStateContextAdapter';
import { learnerPortraitEntityBuilderService } from './learnerPortraitEntityBuilderService';
import { learnerPortraitEntityResolverService } from './learnerPortraitEntityResolverService';
import { learnerPortraitPolishService } from './learnerPortraitPolishService';

type ProfileEntry = {
  id: string;
  dimension: string;
  label: string;
  value: string;
  confidence?: number | null;
  status?: string | null;
  evidenceCount?: number;
  source: 'stable_profile' | 'working_state' | 'observation_memory' | 'saved_memory' | 'event';
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

type ProfileGroup = {
  key: string;
  title: string;
  summary: string;
  items: ProfileEntry[];
};

type LearnerProfilePolishView = {
  schema: 'learner_portrait_polish.v1';
  source: 'llm' | 'fallback' | 'cache' | 'pending';
  status: 'ready' | 'pending';
  entityHash: string;
  generatedAt?: string | null;
  model?: string | null;
  provider?: string | null;
  globalSummary: {
    headline: string;
    summary: string;
    priorityInsights: string[];
    nextBestActions: string[];
  };
  dimensionSummaries: Array<{
    dimension: string;
    title: string;
    summary: string;
    tone: 'stable' | 'active' | 'needs_attention' | 'insufficient_evidence';
  }>;
  entities: Array<any>;
};

type LearnerPortraitResolutionView = {
  schema: 'learner_portrait_resolution.v1';
  source: 'llm' | 'fallback' | 'cache' | 'pending' | 'failed';
  status: 'ready' | 'pending';
  entityHash: string;
  generatedAt?: string | null;
  model?: string | null;
  provider?: string | null;
  message?: string | null;
  originalCount: number;
  resolvedCount: number;
  mergeCount: number;
  entities: Array<any>;
  clusters: Array<{
    canonicalEntityId: string;
    dimension: string;
    mergedEntityIds: string[];
    mergeReason: string;
  }>;
};

const clip = (value: string | null | undefined, maxLength = 220) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const safeArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const parseJsonObject = (value: string) => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || value;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object found in learner profile view response');
  return JSON.parse(raw.slice(start, end + 1));
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/epsilon/g, 'ε')
    .replace(/[\s"'`“”‘’.,，。:：;；!?！？()[\]{}<>《》/\\|-]+/g, '')
    .trim();

const llmSystemPrompt = [
  '你是企业级学习画像页面的数据整理器。',
  '你的任务不是诊断，而是把原始 learner profile / observation / saved memory / event 数据整理成适合前端展示的三层结构。',
  '请严格输出 JSON，不要 Markdown，不要多余解释。',
  '必须只输出以下 schema：',
  '{"overview":{"stableCount":0,"workingCount":0,"memoryCount":0,"eventCount":0,"activeVersion":0,"summary":"..."},',
  '"stableProfile":[{"key":"profileBase|knowledgeState|preferenceStyle|misconceptionState|cognitiveState|behaviorEngagement|reviewPlanning","title":"...","summary":"...","items":[{"id":"...","dimension":"...","label":"...","value":"...","confidence":0.0,"status":"active|candidate","evidenceCount":0,"observedAt":"...","rationale":"..."}]}],',
  '"workingState":[{"key":"profileBase|knowledgeState|preferenceStyle|misconceptionState|cognitiveState|behaviorEngagement|reviewPlanning","title":"...","summary":"...","items":[...]}],',
  '"savedMemory":[{"id":"...","dimension":"...","label":"...","value":"...","confidence":0.0,"status":"active","evidenceCount":0,"observedAt":"...","rationale":"..."}],',
  '"recentEvents":[{"id":"...","eventType":"...","summary":"...","confidence":0.0,"observedAt":"..."}],',
  '"dedupeNotes":["..."],',
  '"source":"llm"}'
].join('\n');

const dedupeEntries = (entries: ProfileEntry[], limit: number) => {
  const selected: ProfileEntry[] = [];
  const sorted = [...entries].sort((a, b) => {
    const confidenceDelta = Number(b.confidence || 0) - Number(a.confidence || 0);
    if (confidenceDelta) return confidenceDelta;
    const timeDelta = new Date(b.observedAt || 0).getTime() - new Date(a.observedAt || 0).getTime();
    if (timeDelta) return timeDelta;
    return Number(b.evidenceCount || 0) - Number(a.evidenceCount || 0);
  });

  for (const entry of sorted) {
    const normalized = normalize(entry.value);
    if (!normalized) continue;
    const duplicate = selected.some((other) => {
      const otherNormalized = normalize(other.value);
      return normalized === otherNormalized || normalized.includes(otherNormalized) || otherNormalized.includes(normalized);
    });
    if (!duplicate) selected.push(entry);
    if (selected.length >= limit) break;
  }
  return selected;
};

const groupEntries = (entries: ProfileEntry[], titleMap: Record<string, { title: string; summary: string }>, limitPerGroup = 5): ProfileGroup[] => {
  const grouped = new Map<string, ProfileEntry[]>();
  entries.forEach((entry) => {
    const key = entry.dimension || 'profileBase';
    grouped.set(key, [...(grouped.get(key) || []), entry]);
  });
  return Array.from(grouped.entries()).map(([key, items]) => ({
    key,
    title: titleMap[key]?.title || key,
    summary: titleMap[key]?.summary || 'Learner profile dimension',
    items: dedupeEntries(items, limitPerGroup)
  }));
};

const titleMap: Record<string, { title: string; summary: string }> = {
  profileBase: { title: 'Profile Base', summary: '学习目标、当前上下文与阶段性关注点。' },
  knowledgeState: { title: 'Knowledge State', summary: '已掌握、薄弱和前置缺口。' },
  preferenceStyle: { title: 'Preference Style', summary: '讲解方式、资源形态和练习偏好。' },
  misconceptionState: { title: 'Misconception State', summary: '误区、错误模式和纠正线索。' },
  cognitiveState: { title: 'Cognitive State', summary: '认知负荷、提问模式与习惯。' },
  behaviorEngagement: { title: 'Behavior / Engagement', summary: '近期参与度和使用节奏。' },
  reviewPlanning: { title: 'Review Planning', summary: '复习压力与下一步动作。' }
};

const portraitLlmError = (stage: string, message?: string | null) =>
  new Error(`LLM 学习画像刷新失败（${stage}）：${message || '模型未返回可用结果'}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isRetryableLlmError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|socket|econnreset|etimedout|timeout|temporarily unavailable/i.test(message);
};

export class LearnerProfileViewService {
  async build(input: { workspaceId: string; workbenchId?: string | null; limit?: number; forcePortrait?: boolean }) {
    const limit = Math.min(Math.max(input.limit || 24, 8), 60);
    const [state, memories, events, context] = await Promise.all([
      learnerStateService.ensureState({ workspaceId: input.workspaceId, workbenchId: input.workbenchId || null }),
      savedMemoryService.list({ workspaceId: input.workspaceId, workbenchId: input.workbenchId || null, limit: 40 }),
      learningEventCollectionService.list({ workspaceId: input.workspaceId, workbenchId: input.workbenchId || null, limit: 40 }),
      learnerStateContextAdapter.build({ workspaceId: input.workspaceId, workbenchId: input.workbenchId || null, audience: 'general' })
    ]);

    const stableProfile: ProfileEntry[] = [
      ...safeArray<any>(state.coreState.stableProfile.learningGoals).map((item) => ({
        id: item.id,
        dimension: 'profileBase',
        label: item.label || 'Learning goal',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'stable_profile' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      })),
      ...safeArray<any>(state.coreState.stableProfile.masteredKnowledge).map((item) => ({
        id: item.id,
        dimension: 'knowledgeState',
        label: item.label || 'Mastered knowledge',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'stable_profile' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      })),
      ...safeArray<any>(state.coreState.stableProfile.weakKnowledge).map((item) => ({
        id: item.id,
        dimension: 'knowledgeState',
        label: item.label || 'Weak knowledge',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'stable_profile' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      })),
      ...safeArray<any>(state.coreState.stableProfile.learningPreferences).map((item) => ({
        id: item.id,
        dimension: 'preferenceStyle',
        label: item.label || 'Learning preference',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'stable_profile' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      })),
      ...safeArray<any>(state.coreState.stableProfile.commonErrors).map((item) => ({
        id: item.id,
        dimension: 'misconceptionState',
        label: item.label || 'Common error',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'stable_profile' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      })),
      ...safeArray<any>(state.coreState.stableProfile.learnerTraits).map((item) => ({
        id: item.id,
        dimension: 'cognitiveState',
        label: item.label || 'Learner trait',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'stable_profile' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      }))
    ];

    const workingState: ProfileEntry[] = [
      ...safeArray<any>(state.coreState.workingState.currentCourseState.activeGoals).map((item) => ({
        id: item.id,
        dimension: 'profileBase',
        label: item.label || 'Active goal',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'working_state' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      })),
      ...safeArray<any>(state.coreState.workingState.currentCourseState.focusKnowledge).map((item) => ({
        id: item.id,
        dimension: 'knowledgeState',
        label: item.label || 'Focus knowledge',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'working_state' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      })),
      ...safeArray<any>(state.coreState.workingState.currentCourseState.pendingQuestions).map((item) => ({
        id: item.id,
        dimension: 'cognitiveState',
        label: item.label || 'Pending question',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'working_state' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      })),
      ...safeArray<any>(state.coreState.workingState.currentCourseState.nextActions).map((item) => ({
        id: item.id,
        dimension: 'reviewPlanning',
        label: item.label || 'Next action',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'working_state' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      })),
      ...safeArray<any>(state.coreState.workingState.recentBehaviorSummary.recentTopics).map((item) => ({
        id: item.id,
        dimension: 'profileBase',
        label: item.label || 'Recent topic',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'working_state' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      })),
      ...safeArray<any>(state.coreState.workingState.recentBehaviorSummary.engagementSignals).map((item) => ({
        id: item.id,
        dimension: 'behaviorEngagement',
        label: item.label || 'Engagement signal',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'working_state' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      })),
      ...safeArray<any>(state.coreState.workingState.recentBehaviorSummary.reviewPressure).map((item) => ({
        id: item.id,
        dimension: 'reviewPlanning',
        label: item.label || 'Review pressure',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'working_state' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      })),
      ...safeArray<any>(state.coreState.observationMemory.observations).map((item) => ({
        id: item.id,
        dimension: item.dimension || 'profileBase',
        label: item.label || 'Observation',
        value: item.value,
        confidence: item.confidence,
        status: item.status,
        evidenceCount: safeArray(item.evidenceIds).length,
        source: 'observation_memory' as const,
        observedAt: item.lastObservedAt || item.firstObservedAt || null,
        rationale: item.rationale || null
      }))
    ];

    const savedMemoryEntries: ProfileEntry[] = memories.map((memory) => ({
      id: memory.id,
      dimension: memory.category || 'savedMemory',
      label: memory.category || 'Saved Memory',
      value: memory.text,
      confidence: memory.confidence,
      status: memory.status,
      evidenceCount: 0,
      source: 'saved_memory',
      observedAt: memory.updatedAt,
      rationale: memory.source
    }));

    const recentEvents: ProfileEntry[] = events.map((event) => ({
      id: event.id,
      dimension: 'event',
      label: event.eventType,
      value: clip(event.payload?.interaction?.userText || event.payload?.object?.title || event.objectType || event.eventType, 160),
      confidence: event.confidence,
      status: event.actor,
      evidenceCount: 0,
      source: 'event',
      observedAt: event.observedAt,
      rationale: clip(event.payload?.interaction?.assistantText || event.payload?.source?.component || '', 120),
      eventFamily: event.eventFamily,
      eventType: event.eventType,
      objectType: event.objectType,
      objectId: event.objectId,
      diagnosticFeatures: event.diagnosticFeatures,
      cognitiveSignals: event.cognitiveSignals,
      quality: event.quality
    }));

    const portrait = await learnerPortraitEntityBuilderService.build({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      stableProfile,
      workingState,
      savedMemoryEntries,
      recentEvents,
      limit: 56,
      forceLlmExtraction: Boolean(input.forcePortrait)
    });
    const forcePortrait = Boolean(input.forcePortrait);
    if (forcePortrait && !aiModelProviderService.isConfigured({ useCase: 'memory' })) {
      throw portraitLlmError('模型配置', 'AI memory provider 未配置，无法执行 LLM 画像刷新');
    }

    const portraitResolution = forcePortrait
      ? await learnerPortraitEntityResolverService.generateNow({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          entities: portrait.entities
        })
      : learnerPortraitEntityResolverService.getCachedOrFallback({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          entities: portrait.entities
        });

    if (forcePortrait && portraitResolution.source !== 'llm') {
      throw portraitLlmError('语义归并', portraitResolution.message);
    }

    const resolutionReadyForPolish = portraitResolution.status === 'ready' && (portraitResolution.source === 'llm' || portraitResolution.source === 'cache');
    const portraitPolish = forcePortrait
      ? await learnerPortraitPolishService.generateNow({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          entities: portraitResolution.entities
        })
      : resolutionReadyForPolish
        ? learnerPortraitPolishService.getCachedOrFallback({
            workspaceId: input.workspaceId,
            workbenchId: input.workbenchId || null,
            entities: portraitResolution.entities
          })
        : learnerPortraitPolishService.fallbackOnly({
            entities: portraitResolution.entities.length ? portraitResolution.entities : portrait.entities,
            source: 'fallback',
            status: 'ready',
            message: portraitResolution.status === 'pending'
              ? '等待语义归并完成后再进行 AI 精修。'
              : '语义归并暂不可用，当前展示候选画像。'
          });

    if (forcePortrait && portraitPolish.source !== 'llm') {
      throw portraitLlmError('展示润色', portraitPolish.message);
    }

    const rawPrompt = [
      '请把以下学习画像原始数据整理成适合页面展示的三层结构：Stable Profile、Observation / Working State、Saved Memory，并去重、归并、润色文本。',
      '注意：维度是内部字段，不要把维度本身当成首页入口；首页只要三层入口卡片。',
      'portraitEntities 已由规则和证据聚合器生成，请不要重新发明，只可在 summary 中参考。',
      'portraitResolution 已由语义实体归并器生成；如果它仍处于 pending，可先基于 portraitEntities 做展示，不要重新做实体合并。',
      `LearnerState summary: ${state.summary}`,
      `LearnerState context summary: ${context.summary}`,
      `Portrait entities:\n${JSON.stringify(portrait.entities.slice(0, 30))}`,
      `Portrait resolution:\n${JSON.stringify(portraitResolution.entities.slice(0, 30))}`,
      `Stable entries:\n${JSON.stringify(stableProfile.slice(0, 40))}`,
      `Working entries:\n${JSON.stringify(workingState.slice(0, 40))}`,
      `Saved memories:\n${JSON.stringify(savedMemoryEntries.slice(0, 40))}`,
      `Recent events:\n${JSON.stringify(recentEvents.slice(0, 20))}`,
      '输出 JSON schema: {"overview":...,"stableProfile":[...],"workingState":[...],"savedMemory":[...],"recentEvents":[...],"dedupeNotes":[...],"source":"llm"}'
    ].join('\n\n');

    const syncNormalizeEnabled = process.env.LEARNER_PROFILE_SYNC_LLM_VIEW === 'true';
    const shouldRunLlmNormalize = forcePortrait || syncNormalizeEnabled;
    if (shouldRunLlmNormalize && aiModelProviderService.isConfigured({ useCase: 'memory' })) {
      try {
        let result: Awaited<ReturnType<typeof aiModelProviderService.chat>> | null = null;
        let lastError: unknown = null;
        const maxAttempts = Math.max(1, Number(process.env.LEARNER_PROFILE_VIEW_LLM_ATTEMPTS || 3));
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            result = await aiModelProviderService.chat([
              { role: 'system', content: llmSystemPrompt },
              { role: 'user', content: rawPrompt }
            ], {
              useCase: 'memory',
              model: process.env.AI_MEMORY_MODEL || undefined,
              timeoutMs: 0
            });
            break;
          } catch (error) {
            lastError = error;
            if (attempt >= maxAttempts || !isRetryableLlmError(error)) throw error;
            await sleep(500 * attempt);
          }
        }
        if (!result) throw lastError || new Error('Learner profile view LLM returned no result');
        const parsed = parseJsonObject(result.reply);
        return {
          source: 'llm',
          model: result.model,
          provider: result.provider,
          overview: parsed.overview || {
            stableCount: stableProfile.length,
            workingCount: workingState.length,
            memoryCount: savedMemoryEntries.length,
            eventCount: recentEvents.length,
            activeVersion: state.version,
            summary: state.summary
          },
          stableProfile: parsed.stableProfile || groupEntries(stableProfile, titleMap, 6),
          workingState: parsed.workingState || groupEntries(workingState, titleMap, 5),
          savedMemory: parsed.savedMemory || dedupeEntries(savedMemoryEntries, 20),
          recentEvents: parsed.recentEvents || dedupeEntries(recentEvents, 20),
          portraitEntities: portrait.entities,
          portraitResolution,
          portraitSummary: {
            schema: portrait.schema,
            dimensions: portrait.dimensions,
            sourceFrameworks: portrait.sourceFrameworks
          },
          portraitPolish,
          dedupeNotes: safeArray<string>(parsed.dedupeNotes),
          raw: {
            stableProfile,
            workingState,
            savedMemoryEntries,
            recentEvents
          }
        };
      } catch (error) {
        if (forcePortrait) {
          throw portraitLlmError('页面摘要整理', error instanceof Error ? error.message : String(error));
        }
        // fall through to fallback for passive page loading.
      }
    }

    if (forcePortrait) {
      throw portraitLlmError('页面摘要整理', 'AI memory provider 未配置或未返回可用 JSON');
    }

    return {
      source: 'fallback',
      overview: {
        stableCount: stableProfile.length,
        workingCount: workingState.length,
        memoryCount: savedMemoryEntries.length,
        eventCount: recentEvents.length,
        activeVersion: state.version,
        summary: state.summary
      },
      stableProfile: groupEntries(stableProfile, titleMap, 6),
      workingState: groupEntries(workingState, titleMap, 5),
      savedMemory: dedupeEntries(savedMemoryEntries, 20),
      recentEvents: dedupeEntries(recentEvents, 20),
      portraitEntities: portrait.entities,
      portraitResolution,
      portraitSummary: {
        schema: portrait.schema,
        dimensions: portrait.dimensions,
        sourceFrameworks: portrait.sourceFrameworks
      },
      portraitPolish,
      dedupeNotes: ['LLM unavailable or parse failed; returned normalized fallback view.'],
      raw: {
        stableProfile,
        workingState,
        savedMemoryEntries,
        recentEvents
      }
    };
  }
}

export const learnerProfileViewService = new LearnerProfileViewService();
