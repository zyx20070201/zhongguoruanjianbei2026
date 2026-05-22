import { aiModelProviderService } from './aiModelProviderService';
import { stableHash } from './chunkSchema';
import type { LearnerPortraitEntity, PortraitDimension, PortraitEvidence, PortraitPolarity, PortraitStatus } from './learnerPortraitEntityBuilderService';

export interface LearnerPortraitResolutionResult {
  schema: 'learner_portrait_resolution.v1';
  source: 'llm' | 'cache' | 'fallback' | 'pending' | 'failed';
  status: 'ready' | 'pending';
  entityHash: string;
  generatedAt?: string | null;
  model?: string | null;
  provider?: string | null;
  message?: string | null;
  originalCount: number;
  resolvedCount: number;
  mergeCount: number;
  entities: LearnerPortraitEntity[];
  clusters: Array<{
    canonicalEntityId: string;
    dimension: PortraitDimension;
    mergedEntityIds: string[];
    mergeReason: string;
  }>;
}

type CacheEntry = {
  expiresAt: number;
  result: LearnerPortraitResolutionResult;
};

type FailureState = {
  expiresAt: number;
  cooldownUntil: number;
  lastError: string;
  lastAttemptAt: number;
  failureCount: number;
  result: LearnerPortraitResolutionResult;
};

type LlmCluster = {
  dimension?: string;
  canonicalTitle?: string;
  canonicalDescription?: string;
  canonicalRecommendation?: string;
  mergedEntityIds?: string[];
  mergeReason?: string;
  polarity?: string;
  status?: string;
  type?: string;
  aliases?: string[];
};

const RESOLUTION_SCHEMA_VERSION = 'portrait-resolution-2026-05-20';
const CACHE_TTL_MS = Number(process.env.LEARNER_PORTRAIT_RESOLUTION_CACHE_TTL_MS || 1000 * 60 * 60 * 6);
const FAILURE_CACHE_TTL_MS = Number(process.env.LEARNER_PORTRAIT_RESOLUTION_FAILURE_CACHE_TTL_MS || 1000 * 60 * 15);
const BASE_COOLDOWN_MS = Number(process.env.LEARNER_PORTRAIT_RESOLUTION_COOLDOWN_MS || 1000 * 60 * 5);
const resolutionCache = new Map<string, CacheEntry>();
const failureCache = new Map<string, FailureState>();
const running = new Set<string>();

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

const RESOLUTION_DIMENSION_PRIORITY: PortraitDimension[] = [
  'learningPreference',
  'learningGoal',
  'supportNeed',
  'cognitiveStyle',
  'knowledgeFoundation',
  'errorPattern',
  'learningRisk',
  'metacognitiveStrategy',
  'learningBackground'
];

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
const clamp01 = (value: number) => Math.max(0, Math.min(1, Number(value) || 0));

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

const unique = (items: string[], limit = 12) => {
  const seen = new Set<string>();
  const out: string[] = [];
  items.forEach((item) => {
    const text = clip(item, 160);
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  });
  return out.slice(0, limit);
};

const entityHashFor = (entities: LearnerPortraitEntity[]) =>
  stableHash({
    schema: RESOLUTION_SCHEMA_VERSION,
    entities: entities.map((entity) => ({
      dimension: entity.dimension,
      type: entity.type,
      title: semanticText(entity.title, 120),
      description: semanticText(entity.description, 220),
      status: entity.status,
      polarity: entity.polarity,
      severity: entity.severity || null,
      evidence: safeArray<PortraitEvidence>(entity.evidence).map((item) => ({
        id: item.id,
        sourceType: item.sourceType,
        sourceId: item.sourceId || null,
        summary: semanticText(item.summary, 160)
      })).sort((a, b) => `${a.sourceType}:${a.sourceId || a.id}:${a.summary}`.localeCompare(`${b.sourceType}:${b.sourceId || b.id}:${b.summary}`)).slice(0, 6),
      affectedConcepts: safeArray<string>(entity.affectedConcepts).map((item) => semanticText(item, 80)).sort().slice(0, 8),
      recommendation: semanticText(entity.recommendation, 160)
    })).sort((a, b) =>
      `${a.dimension}:${a.type}:${a.title}:${a.description}`.localeCompare(`${b.dimension}:${b.type}:${b.title}:${b.description}`)
    )
  });

const fallbackResolution = (
  entities: LearnerPortraitEntity[],
  entityHash: string,
  source: LearnerPortraitResolutionResult['source'],
  status: LearnerPortraitResolutionResult['status'],
  message?: string | null
): LearnerPortraitResolutionResult => ({
  schema: 'learner_portrait_resolution.v1',
  source,
  status,
  entityHash,
  generatedAt: source === 'pending' ? null : new Date().toISOString(),
  model: null,
  provider: null,
  message: message || null,
  originalCount: entities.length,
  resolvedCount: entities.length,
  mergeCount: 0,
  entities: entities.map((entity) => ({
    ...entity,
    mergedFrom: safeArray<string>(entity.mergedFrom).length ? entity.mergedFrom : [entity.id],
    resolutionSource: source === 'pending' ? 'builder' : 'resolver_fallback'
  })),
  clusters: []
});

const timeoutFallback = (
  entities: LearnerPortraitEntity[],
  entityHash: string,
  message: string
): LearnerPortraitResolutionResult => ({
  ...fallbackResolution(entities, entityHash, 'failed', 'ready', message),
  generatedAt: new Date().toISOString(),
  source: 'failed',
  message
});

const confidenceFor = (items: LearnerPortraitEntity[]) => {
  const weighted = items.reduce((sum, item) => sum + clamp01(item.confidence) * Math.max(1, item.evidenceCount || 1), 0);
  const weights = items.reduce((sum, item) => sum + Math.max(1, item.evidenceCount || 1), 0);
  return Number(clamp01((weighted / Math.max(1, weights)) + Math.min(0.12, (items.length - 1) * 0.035)).toFixed(3));
};

const statusRank: Record<PortraitStatus, number> = { stable: 4, active: 3, candidate: 2, needs_review: 1 };
const polarityRank: Record<PortraitPolarity, number> = { risk: 5, need: 4, preference: 3, strength: 2, neutral: 1 };

const mergedStatusFor = (items: LearnerPortraitEntity[]): PortraitStatus =>
  [...items].sort((a, b) => statusRank[b.status] - statusRank[a.status])[0]?.status || 'candidate';

const mergedPolarityFor = (items: LearnerPortraitEntity[], suggested?: string): PortraitPolarity => {
  if (suggested === 'strength' || suggested === 'need' || suggested === 'risk' || suggested === 'preference' || suggested === 'neutral') return suggested;
  return [...items].sort((a, b) => polarityRank[b.polarity] - polarityRank[a.polarity])[0]?.polarity || 'neutral';
};

const mergedEntityFrom = (items: LearnerPortraitEntity[], patch: LlmCluster): LearnerPortraitEntity => {
  const sorted = [...items].sort((a, b) => b.confidence - a.confidence || b.evidenceCount - a.evidenceCount);
  const base = sorted[0];
  const evidence: PortraitEvidence[] = [];
  items.flatMap((item) => safeArray<PortraitEvidence>(item.evidence)).forEach((item) => {
    if (!evidence.some((existing) => existing.id === item.id && existing.sourceType === item.sourceType)) evidence.push(item);
  });
  const mergedIds = unique(items.flatMap((item) => safeArray<string>(item.mergedFrom).length ? safeArray<string>(item.mergedFrom) : [item.id]), 24);
  const aliases = unique([
    ...items.flatMap((item) => [item.title, ...safeArray<string>(item.aliases)]),
    ...safeArray<string>(patch.aliases)
  ], 10).filter((item) => item !== patch.canonicalTitle);
  return {
    ...base,
    id: `resolved:${stableHash({ dimension: base.dimension, ids: mergedIds }).slice(0, 18)}`,
    type: clip(patch.type || base.type, 48),
    title: clip(patch.canonicalTitle || base.title, 72),
    description: clip(patch.canonicalDescription || base.description, 260),
    recommendation: clip(patch.canonicalRecommendation || base.recommendation || '', 200) || undefined,
    status: patch.status === 'stable' || patch.status === 'active' || patch.status === 'candidate' || patch.status === 'needs_review'
      ? patch.status
      : mergedStatusFor(items),
    polarity: mergedPolarityFor(items, patch.polarity),
    confidence: confidenceFor(items),
    severity: items.some((item) => item.severity === 'high') ? 'high' : items.some((item) => item.severity === 'medium') ? 'medium' : base.severity,
    evidenceCount: evidence.length,
    evidence: evidence
      .sort((a, b) => b.confidence - a.confidence || new Date(b.observedAt || 0).getTime() - new Date(a.observedAt || 0).getTime())
      .slice(0, 12),
    affectedConcepts: unique(items.flatMap((item) => safeArray<string>(item.affectedConcepts)).concat(evidence.flatMap((item) => safeArray<string>(item.relatedConcepts))), 12),
    updatedAt: evidence.map((item) => item.observedAt).filter(Boolean).sort().reverse()[0] || base.updatedAt || null,
    mergedFrom: mergedIds,
    mergeReason: clip(patch.mergeReason || '语义归并：这些画像实体表达同一类学习状态或支持需求。', 180),
    aliases,
    resolutionSource: 'semantic_resolver'
  };
};

const sanitizeResolution = (
  entities: LearnerPortraitEntity[],
  parsed: any,
  entityHash: string,
  model: string,
  provider: string
): LearnerPortraitResolutionResult => {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const consumed = new Set<string>();
  const output: LearnerPortraitEntity[] = [];
  const clusters: LearnerPortraitResolutionResult['clusters'] = [];

  safeArray<LlmCluster>(parsed.clusters).forEach((cluster) => {
    const ids = unique(safeArray<string>(cluster.mergedEntityIds).map(String), 24).filter((id) => byId.has(id));
    if (ids.length < 2) return;
    const items = ids.map((id) => byId.get(id)).filter(Boolean) as LearnerPortraitEntity[];
    const dimension = items[0]?.dimension;
    if (!dimension || items.some((item) => item.dimension !== dimension)) return;
    if (ids.some((id) => consumed.has(id))) return;
    const merged = mergedEntityFrom(items, cluster);
    output.push(merged);
    ids.forEach((id) => consumed.add(id));
    clusters.push({
      canonicalEntityId: merged.id,
      dimension,
      mergedEntityIds: ids,
      mergeReason: merged.mergeReason || ''
    });
  });

  entities.forEach((entity) => {
    if (consumed.has(entity.id)) return;
    output.push({
      ...entity,
      mergedFrom: safeArray<string>(entity.mergedFrom).length ? entity.mergedFrom : [entity.id],
      resolutionSource: 'semantic_resolver'
    });
  });

  const sorted = output.sort((a, b) => {
    const riskWeight = (b.polarity === 'risk' ? 0.12 : 0) - (a.polarity === 'risk' ? 0.12 : 0);
    if (riskWeight) return riskWeight;
    return b.confidence - a.confidence || b.evidenceCount - a.evidenceCount;
  });

  return {
    schema: 'learner_portrait_resolution.v1',
    source: 'llm',
    status: 'ready',
    entityHash,
    generatedAt: new Date().toISOString(),
    model,
    provider,
    message: null,
    originalCount: entities.length,
    resolvedCount: sorted.length,
    mergeCount: clusters.reduce((sum, cluster) => sum + Math.max(0, cluster.mergedEntityIds.length - 1), 0),
    entities: sorted,
    clusters
  };
};

export class LearnerPortraitEntityResolverService {
  getCachedOrFallback(input: { workspaceId: string; workbenchId?: string | null; entities: LearnerPortraitEntity[]; force?: boolean }) {
    const entityHash = entityHashFor(input.entities);
    const cacheKey = `${input.workspaceId}:${input.workbenchId || 'workspace'}:${entityHash}`;
    if (input.force) {
      resolutionCache.delete(cacheKey);
      failureCache.delete(cacheKey);
    }
    const cached = resolutionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.result, source: 'cache' as const };
    const failure = failureCache.get(cacheKey);
    if (failure && failure.expiresAt > Date.now()) return { ...failure.result, source: 'failed' as const };
    if (failure && failure.expiresAt <= Date.now()) failureCache.delete(cacheKey);
    this.schedule({ ...input, entityHash, cacheKey });
    return fallbackResolution(input.entities, entityHash, 'pending', 'pending');
  }

  async generateNow(input: { workspaceId: string; workbenchId?: string | null; entities: LearnerPortraitEntity[] }) {
    const entityHash = entityHashFor(input.entities);
    const cacheKey = `${input.workspaceId}:${input.workbenchId || 'workspace'}:${entityHash}`;
    const result = await this.generate({ ...input, entityHash, cacheKey });
    resolutionCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  private schedule(input: { workspaceId: string; workbenchId?: string | null; entities: LearnerPortraitEntity[]; entityHash: string; cacheKey: string }) {
    if (running.has(input.cacheKey)) return;
    if (input.entities.length < 2) return;
    if (!aiModelProviderService.isConfigured({ useCase: 'memory' })) return;
    const failure = failureCache.get(input.cacheKey);
    if (failure && failure.cooldownUntil > Date.now()) return;
    running.add(input.cacheKey);
    setTimeout(() => {
      this.generate(input)
        .then((result) => {
          resolutionCache.set(input.cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
          failureCache.delete(input.cacheKey);
        })
        .catch((error) => console.warn('Learner portrait resolver background failed:', {
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          entityHash: input.entityHash.slice(0, 12),
          error: error instanceof Error ? error.message : String(error)
        }))
        .finally(() => running.delete(input.cacheKey));
    }, 0);
  }

  private async generate(input: { workspaceId: string; workbenchId?: string | null; entities: LearnerPortraitEntity[]; entityHash: string; cacheKey: string }): Promise<LearnerPortraitResolutionResult> {
    if (!aiModelProviderService.isConfigured({ useCase: 'memory' })) {
      return fallbackResolution(input.entities, input.entityHash, 'fallback', 'ready');
    }

    const grouped = RESOLUTION_DIMENSION_PRIORITY
      .map((dimension) => ({
        dimension,
        dimensionTitle: dimensionTitle[dimension],
        entities: input.entities
          .filter((entity) => entity.dimension === dimension)
          .sort((a, b) => b.confidence - a.confidence || b.evidenceCount - a.evidenceCount)
          .slice(0, Number(process.env.LEARNER_PORTRAIT_RESOLUTION_MAX_PER_DIMENSION || 6))
          .map((entity) => ({
            id: entity.id,
            type: entity.type,
            title: clip(entity.title, 72),
            description: clip(entity.description, 120),
            recommendation: clip(entity.recommendation, 90),
            polarity: entity.polarity,
            status: entity.status,
            confidence: entity.confidence,
            evidenceCount: entity.evidenceCount,
            affectedConcepts: safeArray<string>(entity.affectedConcepts).slice(0, 3),
            evidence: safeArray<PortraitEvidence>(entity.evidence).slice(0, 1).map((item) => ({
              sourceType: item.sourceType,
              summary: clip(item.summary, 80),
              confidence: item.confidence
            }))
          }))
      }))
      .filter((group) => group.entities.length >= 2)
      .slice(0, Number(process.env.LEARNER_PORTRAIT_RESOLUTION_MAX_DIMENSIONS || 4));

    if (!grouped.length) return fallbackResolution(input.entities, input.entityHash, 'fallback', 'ready');

    try {
      const result = await aiModelProviderService.json<any>({
        useCase: 'memory',
        timeoutMs: envTimeoutMs('LEARNER_PORTRAIT_RESOLUTION_TIMEOUT_MS', 0),
        instruction: [
          '你是企业级学习画像的语义实体归并器（semantic entity resolver），不是展示润色器。',
          '任务：在同一个画像维度内部，判断哪些实体表达同一个 learner portrait entity，并输出语义 clusters。',
          '严格限制：只能合并同一 dimension 内的实体；只能使用输入里的 entity id；不要为了好看而合并；不确定就保留分开。',
          '合并标准：意图、学习状态、偏好对象、风险机制或支持需求本质相同，即使措辞不同也可合并；只是都属于同一大类但含义不同，则不要合并。',
          '输出 canonicalTitle/Description/Recommendation 应是合并后的实体表述，不要新增事实；mergeReason 用一句中文解释为什么这些 id 是同一实体。'
        ].join('\n'),
        schema: {
          clusters: [{
            dimension: 'string',
            canonicalTitle: 'string',
            canonicalDescription: 'string',
            canonicalRecommendation: 'string',
            mergedEntityIds: ['string'],
            mergeReason: 'string',
            polarity: 'strength|need|risk|preference|neutral',
            status: 'stable|active|candidate|needs_review',
            type: 'string',
            aliases: ['string']
          }],
          keepSeparate: [{ entityId: 'string', reason: 'string' }],
          conflicts: [{ entityIds: ['string'], reason: 'string' }]
        },
        input: {
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          dimensions: dimensionTitle,
          groups: grouped
        },
        systemPrompt: '只输出 JSON。你负责语义实体解析，必须保守、可解释、证据约束，禁止跨维度归并。'
      });
      return sanitizeResolution(input.entities, result.data, input.entityHash, result.model, result.provider);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureCount = (failureCache.get(input.cacheKey) || { failureCount: 0 }).failureCount + 1;
      const cooldownMs = Math.min(BASE_COOLDOWN_MS * Math.max(1, failureCount), Number(process.env.LEARNER_PORTRAIT_RESOLUTION_MAX_COOLDOWN_MS || 1000 * 60 * 30));
      const failedResult = timeoutFallback(input.entities, input.entityHash, message);
      failureCache.set(input.cacheKey, {
        expiresAt: Date.now() + FAILURE_CACHE_TTL_MS,
        cooldownUntil: Date.now() + cooldownMs,
        lastError: message,
        lastAttemptAt: Date.now(),
        failureCount,
        result: failedResult
      });
      console.warn('Learner portrait resolver LLM fallback:', {
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        entityHash: input.entityHash.slice(0, 12),
        error: message
      });
      return failedResult;
    }
  }
}

export const learnerPortraitEntityResolverService = new LearnerPortraitEntityResolverService();
