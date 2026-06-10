import { aiModelProviderService } from './aiModelProviderService';
import {
  dedupeProfileEntries,
  groupProfileEntries,
  LearnerPortraitBundle,
  LearnerProfileEvidenceProjection,
  safeProfileArray
} from './learnerProfileReadModel';

const parseJsonObject = (value: string) => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || value;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object found in learner profile view response');
  return JSON.parse(raw.slice(start, end + 1));
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isRetryableLlmError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|socket|econnreset|etimedout|timeout|temporarily unavailable/i.test(message);
};

const portraitLlmError = (stage: string, message?: string | null) =>
  new Error(`LLM 学习画像刷新失败（${stage}）：${message || '模型未返回可用结果'}`);

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

export class LearnerProfilePageComposerService {
  async compose(input: {
    projection: LearnerProfileEvidenceProjection;
    portraitBundle: LearnerPortraitBundle;
    forcePortrait?: boolean;
  }) {
    const { projection, portraitBundle } = input;
    const { state, context, stableProfile, workingState, savedMemoryEntries, recentEvents } = projection;
    const { portrait, portraitResolution, portraitPolish } = portraitBundle;
    const forcePortrait = Boolean(input.forcePortrait);
    const baseOverview = {
      stableCount: stableProfile.length,
      workingCount: workingState.length,
      memoryCount: savedMemoryEntries.length,
      eventCount: recentEvents.length,
      activeVersion: state.version,
      summary: state.summary
    };

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
          overview: parsed.overview || baseOverview,
          stableProfile: parsed.stableProfile || groupProfileEntries(stableProfile, undefined, 6),
          workingState: parsed.workingState || groupProfileEntries(workingState, undefined, 5),
          savedMemory: parsed.savedMemory || dedupeProfileEntries(savedMemoryEntries, 20),
          recentEvents: parsed.recentEvents || dedupeProfileEntries(recentEvents, 20),
          portraitEntities: portrait.entities,
          portraitResolution,
          portraitSummary: {
            schema: portrait.schema,
            dimensions: portrait.dimensions,
            sourceFrameworks: portrait.sourceFrameworks
          },
          portraitPolish,
          persistedProfile: portraitBundle.persisted || { candidates: [], entities: [] },
          dedupeNotes: safeProfileArray<string>(parsed.dedupeNotes),
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
      }
    }

    if (forcePortrait) {
      throw portraitLlmError('页面摘要整理', 'AI memory provider 未配置或未返回可用 JSON');
    }

    return {
      source: 'fallback',
      overview: baseOverview,
      stableProfile: groupProfileEntries(stableProfile, undefined, 6),
      workingState: groupProfileEntries(workingState, undefined, 5),
      savedMemory: dedupeProfileEntries(savedMemoryEntries, 20),
      recentEvents: dedupeProfileEntries(recentEvents, 20),
      portraitEntities: portrait.entities,
      portraitResolution,
      portraitSummary: {
        schema: portrait.schema,
        dimensions: portrait.dimensions,
        sourceFrameworks: portrait.sourceFrameworks
      },
      portraitPolish,
      persistedProfile: portraitBundle.persisted || { candidates: [], entities: [] },
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

export const learnerProfilePageComposerService = new LearnerProfilePageComposerService();
