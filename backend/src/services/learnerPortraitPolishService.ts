import { aiModelProviderService } from './aiModelProviderService';
import { stableHash } from './chunkSchema';
import type { LearnerPortraitEntity, PortraitDimension } from './learnerPortraitEntityBuilderService';

export interface PolishedPortraitEntity extends LearnerPortraitEntity {
  originalTitle?: string;
  originalDescription?: string;
  displayTitle: string;
  displayDescription: string;
  displayRecommendation?: string;
}

export interface LearnerPortraitPolishResult {
  schema: 'learner_portrait_polish.v1';
  source: 'llm' | 'fallback' | 'cache' | 'pending' | 'failed';
  status: 'ready' | 'pending';
  entityHash: string;
  generatedAt?: string | null;
  model?: string | null;
  provider?: string | null;
  message?: string | null;
  globalSummary: {
    headline: string;
    summary: string;
    priorityInsights: string[];
    nextBestActions: string[];
  };
  dimensionSummaries: Array<{
    dimension: PortraitDimension;
    title: string;
    summary: string;
    tone: 'stable' | 'active' | 'needs_attention' | 'insufficient_evidence';
  }>;
  entities: PolishedPortraitEntity[];
}

type CacheEntry = {
  expiresAt: number;
  result: LearnerPortraitPolishResult;
};

type FailureState = {
  expiresAt: number;
  cooldownUntil: number;
  lastError: string;
  lastAttemptAt: number;
  failureCount: number;
  result: LearnerPortraitPolishResult;
};

const POLISH_SCHEMA_VERSION = 'portrait-polish-2026-05-20';
const CACHE_TTL_MS = Number(process.env.LEARNER_PORTRAIT_POLISH_CACHE_TTL_MS || 1000 * 60 * 60 * 6);
const FAILURE_CACHE_TTL_MS = Number(process.env.LEARNER_PORTRAIT_POLISH_FAILURE_CACHE_TTL_MS || 1000 * 60 * 15);
const BASE_COOLDOWN_MS = Number(process.env.LEARNER_PORTRAIT_POLISH_COOLDOWN_MS || 1000 * 60 * 5);
const polishCache = new Map<string, CacheEntry>();
const failureCache = new Map<string, FailureState>();
const running = new Set<string>();

const clip = (value: unknown, maxLength = 420) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const envTimeoutMs = (key: string, fallback = 0) => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const safeArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableLlmError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|socket|econnreset|etimedout|timeout|temporarily unavailable/i.test(message);
};

const semanticText = (value: unknown, maxLength = 220) =>
  String(value || '')
    .toLowerCase()
    .replace(/epsilon/g, 'ε')
    .replace(/\d{4}-\d{2}-\d{2}[t\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?z?/gi, '')
    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, '')
    .replace(/\s+/g, ' ')
    .replace(/["'`“”‘’]/g, '')
    .trim()
    .slice(0, maxLength);

const dimensionTitle: Record<PortraitDimension, string> = {
  learningBackground: '学习背景',
  learningGoal: '学习目标',
  knowledgeFoundation: '知识基础',
  cognitiveStyle: '认知风格',
  learningPreference: '学习偏好',
  errorPattern: '易错模式',
  learningRisk: '学习风险',
  metacognitiveStrategy: '元认知策略',
  supportNeed: '支持需求'
};

const entityHashFor = (entities: LearnerPortraitEntity[]) =>
  stableHash({
    schema: POLISH_SCHEMA_VERSION,
    entities: entities.map((entity) => ({
      dimension: entity.dimension,
      type: entity.type,
      title: semanticText(entity.title, 120),
      description: semanticText(entity.description, 220),
      status: entity.status,
      polarity: entity.polarity,
      severity: entity.severity || null,
      affectedConcepts: safeArray<string>(entity.affectedConcepts).map((item) => semanticText(item, 80)).sort().slice(0, 8),
      recommendation: semanticText(entity.recommendation, 160),
      mergedFrom: safeArray<string>(entity.mergedFrom).sort().slice(0, 12)
    })).sort((a, b) =>
      `${a.dimension}:${a.type}:${a.title}:${a.description}`.localeCompare(`${b.dimension}:${b.type}:${b.title}:${b.description}`)
    )
  });

const fallbackPolish = (
  entities: LearnerPortraitEntity[],
  entityHash: string,
  source: LearnerPortraitPolishResult['source'],
  status: LearnerPortraitPolishResult['status'],
  message?: string | null
): LearnerPortraitPolishResult => {
  const top = [...entities].sort((a, b) => b.confidence - a.confidence || b.evidenceCount - a.evidenceCount).slice(0, 5);
  const risks = entities.filter((entity) => entity.polarity === 'risk').slice(0, 3);
  const dimensions = Array.from(new Set(entities.map((entity) => entity.dimension)));
  return {
    schema: 'learner_portrait_polish.v1',
    source,
    status,
    entityHash,
    generatedAt: source === 'pending' ? null : new Date().toISOString(),
    model: null,
    provider: null,
    message: message || null,
    globalSummary: {
      headline: dimensions.length ? `已形成 ${dimensions.length} 个维度的学习画像` : '学习画像证据还在积累中',
      summary: top.length
        ? `当前画像主要集中在${dimensions.map((dimension) => dimensionTitle[dimension]).slice(0, 4).join('、')}。系统会优先依据证据较强的实体进行个性化。`
        : '继续学习、提问、完成练习或复盘后，画像会逐步变得更具体。',
      priorityInsights: top.map((entity) => `${dimensionTitle[entity.dimension]}：${clip(entity.title, 60)}`),
      nextBestActions: risks.length
        ? risks.map((entity) => entity.recommendation || `优先处理：${entity.title}`)
        : top.slice(0, 3).map((entity) => entity.recommendation || `继续观察：${entity.title}`).filter(Boolean)
    },
    dimensionSummaries: (Object.keys(dimensionTitle) as PortraitDimension[]).map((dimension) => {
      const items = entities.filter((entity) => entity.dimension === dimension);
      const riskCount = items.filter((entity) => entity.polarity === 'risk').length;
      return {
        dimension,
        title: dimensionTitle[dimension],
        summary: items.length ? `${items.length} 个画像实体，${riskCount ? `${riskCount} 个风险信号` : '暂无明显风险信号'}。` : '暂无足够证据。',
        tone: items.length ? (riskCount ? 'needs_attention' : 'active') : 'insufficient_evidence'
      };
    }),
    entities: entities.map((entity) => ({
      ...entity,
      originalTitle: entity.title,
      originalDescription: entity.description,
      displayTitle: entity.title,
      displayDescription: entity.description,
      displayRecommendation: entity.recommendation
    }))
  };
};

const failedPolish = (entities: LearnerPortraitEntity[], entityHash: string, message: string): LearnerPortraitPolishResult => ({
  ...fallbackPolish(entities, entityHash, 'failed', 'ready', message),
  generatedAt: new Date().toISOString(),
  source: 'failed',
  message
});

const sanitizePolish = (entities: LearnerPortraitEntity[], parsed: any, entityHash: string, model: string, provider: string): LearnerPortraitPolishResult => {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const polishedById = new Map(safeArray<any>(parsed.entities).map((item) => [String(item.id || ''), item]));
  const polishedEntities = entities.map((entity) => {
    const patch = polishedById.get(entity.id) || {};
    return {
      ...entity,
      originalTitle: entity.title,
      originalDescription: entity.description,
      displayTitle: clip(patch.displayTitle || patch.title || entity.title, 64),
      displayDescription: clip(patch.displayDescription || patch.description || entity.description, 220),
      displayRecommendation: clip(patch.displayRecommendation || patch.recommendation || entity.recommendation || '', 180) || undefined
    };
  });
  const dimensionSummaries = (Object.keys(dimensionTitle) as PortraitDimension[]).map((dimension) => {
    const patch = safeArray<any>(parsed.dimensionSummaries).find((item) => item.dimension === dimension) || {};
    const items = entities.filter((entity) => entity.dimension === dimension);
    return {
      dimension,
      title: dimensionTitle[dimension],
      summary: clip(patch.summary || (items.length ? `${items.length} 个画像实体。` : '暂无足够证据。'), 180),
      tone: ['stable', 'active', 'needs_attention', 'insufficient_evidence'].includes(patch.tone) ? patch.tone : (items.length ? 'active' : 'insufficient_evidence')
    };
  });
  const global = parsed.globalSummary || {};
  return {
    schema: 'learner_portrait_polish.v1',
    source: 'llm',
    status: 'ready',
    entityHash,
    generatedAt: new Date().toISOString(),
    model,
    provider,
    message: null,
    globalSummary: {
      headline: clip(global.headline || '学习画像已更新', 80),
      summary: clip(global.summary || '系统已根据现有证据整理学习画像。', 260),
      priorityInsights: safeArray<string>(global.priorityInsights).map((item) => clip(item, 120)).filter(Boolean).slice(0, 5),
      nextBestActions: safeArray<string>(global.nextBestActions).map((item) => clip(item, 120)).filter(Boolean).slice(0, 5)
    },
    dimensionSummaries,
    entities: polishedEntities.filter((entity) => byId.has(entity.id))
  };
};

export class LearnerPortraitPolishService {
  fallbackOnly(input: { entities: LearnerPortraitEntity[]; source?: LearnerPortraitPolishResult['source']; status?: LearnerPortraitPolishResult['status']; message?: string | null }) {
    return fallbackPolish(
      input.entities,
      entityHashFor(input.entities),
      input.source || 'fallback',
      input.status || 'ready',
      input.message || null
    );
  }

  getCachedOrFallback(input: { workspaceId: string; workbenchId?: string | null; entities: LearnerPortraitEntity[]; force?: boolean }) {
    const entityHash = entityHashFor(input.entities);
    const cacheKey = `${input.workspaceId}:${input.workbenchId || 'workspace'}:${entityHash}`;
    if (input.force) {
      polishCache.delete(cacheKey);
      failureCache.delete(cacheKey);
    }
    const cached = polishCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.result, source: 'cache' as const };
    const failure = failureCache.get(cacheKey);
    if (failure && failure.expiresAt > Date.now()) return { ...failure.result, source: 'failed' as const };
    if (failure && failure.expiresAt <= Date.now()) failureCache.delete(cacheKey);
    this.schedule({ ...input, entityHash, cacheKey });
    return fallbackPolish(input.entities, entityHash, 'pending', 'pending');
  }

  async generateNow(input: { workspaceId: string; workbenchId?: string | null; entities: LearnerPortraitEntity[] }) {
    const entityHash = entityHashFor(input.entities);
    const cacheKey = `${input.workspaceId}:${input.workbenchId || 'workspace'}:${entityHash}`;
    const result = await this.generate({ ...input, entityHash, cacheKey });
    polishCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  private schedule(input: { workspaceId: string; workbenchId?: string | null; entities: LearnerPortraitEntity[]; entityHash: string; cacheKey: string }) {
    if (running.has(input.cacheKey)) return;
    if (!input.entities.length) return;
    if (!aiModelProviderService.isConfigured({ useCase: 'memory' })) return;
    const failure = failureCache.get(input.cacheKey);
    if (failure && failure.cooldownUntil > Date.now()) return;
    running.add(input.cacheKey);
    setTimeout(() => {
      this.generate(input)
        .then((result) => {
          polishCache.set(input.cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
          failureCache.delete(input.cacheKey);
        })
        .catch((error) => console.warn('Learner portrait polish background failed:', {
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          entityHash: input.entityHash.slice(0, 12),
          error: error instanceof Error ? error.message : String(error)
        }))
        .finally(() => running.delete(input.cacheKey));
    }, 0);
  }

  private async generate(input: { workspaceId: string; workbenchId?: string | null; entities: LearnerPortraitEntity[]; entityHash: string; cacheKey: string }): Promise<LearnerPortraitPolishResult> {
    if (!aiModelProviderService.isConfigured({ useCase: 'memory' })) {
      return fallbackPolish(input.entities, input.entityHash, 'fallback', 'ready');
    }
    const compactEntities = (Object.keys(dimensionTitle) as PortraitDimension[])
      .flatMap((dimension) =>
        input.entities
          .filter((entity) => entity.dimension === dimension)
          .sort((a, b) => b.confidence - a.confidence || b.evidenceCount - a.evidenceCount)
          .slice(0, Number(process.env.LEARNER_PORTRAIT_POLISH_MAX_PER_DIMENSION || 2))
      )
      .slice(0, Number(process.env.LEARNER_PORTRAIT_POLISH_MAX_ENTITIES || 18))
      .map((entity) => ({
      id: entity.id,
      dimension: entity.dimension,
      dimensionTitle: dimensionTitle[entity.dimension],
      type: entity.type,
      title: clip(entity.title, 80),
      description: clip(entity.description, 130),
      status: entity.status,
      polarity: entity.polarity,
      confidence: entity.confidence,
      evidenceCount: entity.evidenceCount,
      affectedConcepts: safeArray<string>(entity.affectedConcepts).slice(0, 2),
      recommendation: clip(entity.recommendation, 90),
      evidence: safeArray<NonNullable<LearnerPortraitEntity['evidence']>[number]>(entity.evidence).slice(0, 1).map((item) => ({
        sourceType: item.sourceType,
        summary: clip(item.summary, 80),
        confidence: item.confidence
      }))
    }));
    try {
      let result: Awaited<ReturnType<typeof aiModelProviderService.json<any>>> | null = null;
      let lastError: unknown = null;
      const maxAttempts = Math.max(1, Number(process.env.LEARNER_PORTRAIT_POLISH_LLM_ATTEMPTS || 3));
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          result = await aiModelProviderService.json<any>({
            useCase: 'memory',
            timeoutMs: envTimeoutMs('LEARNER_PORTRAIT_POLISH_TIMEOUT_MS', 0),
            instruction: [
              '你是学习画像的展示层编辑器。请基于输入的结构化画像实体，做实体级 polish 和全局摘要。',
              '严格保持事实边界：不要新增输入里没有的事实、课程、风险或诊断。低置信度内容要用“可能/倾向/近期观察”表达。',
              '合并风格只体现在措辞上，不要删除输入实体，不要改 id、dimension、status、polarity、confidence。',
              '输出要适合直接展示给学生：简洁、克制、支持性，不要像日志字段，不要贴标签化评价。'
            ].join('\n'),
            schema: {
              globalSummary: {
                headline: 'string',
                summary: 'string',
                priorityInsights: ['string'],
                nextBestActions: ['string']
              },
              dimensionSummaries: [{ dimension: 'string', summary: 'string', tone: 'stable|active|needs_attention|insufficient_evidence' }],
              entities: [{ id: 'string', displayTitle: 'string', displayDescription: 'string', displayRecommendation: 'string' }]
            },
            input: {
              workspaceId: input.workspaceId,
              workbenchId: input.workbenchId || null,
              dimensions: dimensionTitle,
              entities: compactEntities
            },
            systemPrompt: '只输出 JSON。你编辑的是可解释学习画像展示文案，必须证据约束、语气克制、面向学习支持。'
          });
          break;
        } catch (error) {
          lastError = error;
          if (attempt >= maxAttempts || !isRetryableLlmError(error)) throw error;
          await sleep(500 * attempt);
        }
      }
      if (!result) throw lastError || new Error('Learner portrait polish LLM returned no result');
      return sanitizePolish(input.entities, result.data, input.entityHash, result.model, result.provider);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureCount = (failureCache.get(input.cacheKey) || { failureCount: 0 }).failureCount + 1;
      const cooldownMs = Math.min(BASE_COOLDOWN_MS * Math.max(1, failureCount), Number(process.env.LEARNER_PORTRAIT_POLISH_MAX_COOLDOWN_MS || 1000 * 60 * 30));
      const failedResult = failedPolish(input.entities, input.entityHash, message);
      failureCache.set(input.cacheKey, {
        expiresAt: Date.now() + FAILURE_CACHE_TTL_MS,
        cooldownUntil: Date.now() + cooldownMs,
        lastError: message,
        lastAttemptAt: Date.now(),
        failureCount,
        result: failedResult
      });
      console.warn('Learner portrait polish LLM fallback:', {
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        entityHash: input.entityHash.slice(0, 12),
        error: message
      });
      return failedResult;
    }
  }
}

export const learnerPortraitPolishService = new LearnerPortraitPolishService();
