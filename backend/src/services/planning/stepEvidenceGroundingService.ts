import { aiModelProviderService } from '../aiModelProviderService';
import { documentChunkStore } from '../documentChunkStore';
import { knowledgeSearchService, KnowledgeSearchResult } from '../knowledgeSearchService';
import { getWorkbenchResourceFileIds } from '../workbenchResourceScope';
import {
  LearnerDiagnosticReport,
  LearningPlanClaimEvidenceMatrixItem,
  LearningPlanGroundingClaim,
  LearningPlanGroundingEvidence,
  LearningPlanRejectedEvidence,
  LearningPlanResourceMatch,
  LearningPlanResourceGrounding,
  ResourceGroundingStatus
} from '../planningTypes';

type GroundableStep = {
  id?: string;
  title: string;
  rationale?: string;
  learningGoal?: string;
  targetSkills?: string[];
  prerequisites?: string[];
  activities?: string[];
  expectedEvidence?: string[];
  teachingPhase?: string;
  difficulty?: number;
};

type GroundingClaimDraft = {
  id: string;
  text: string;
  query: string;
  queries: string[];
  required: boolean;
  source: 'goal' | 'skill' | 'prerequisite' | 'activity' | 'evidence' | 'rationale' | 'title';
};

type EvidenceJudgeResponse = {
  status?: ResourceGroundingStatus | 'unsupported';
  coverageScore?: number;
  supportedClaims?: string[];
  missingClaims?: string[];
  acceptedEvidence?: Array<{
    chunkId?: string;
    supportedClaims?: string[];
    whySupports?: string;
    confidence?: number;
  }>;
  rejectedEvidence?: Array<{
    chunkId?: string;
    reason?: string;
  }>;
  summary?: string;
};

type ClaimInvestigation = {
  claim: GroundingClaimDraft;
  candidates: KnowledgeSearchResult[];
  acceptedEvidence: LearningPlanGroundingEvidence[];
  rejectedEvidence: LearningPlanRejectedEvidence[];
  status: 'supported' | 'partial' | 'missing';
  confidence: number;
  missingReason?: string;
};

type ExpandedCandidate = {
  result: KnowledgeSearchResult;
  contextBefore: string;
  contextAfter: string;
};

type ClaimEvidenceJudgeResponse = {
  status?: 'supported' | 'partial' | 'missing';
  acceptedEvidence?: Array<{
    chunkId?: string;
    whySupports?: string;
    confidence?: number;
  }>;
  rejectedEvidence?: Array<{
    chunkId?: string;
    reason?: string;
  }>;
  missingReason?: string;
};

type ClaimDecompositionResponse = {
  claims?: Array<{
    text?: string;
    query?: string;
    queries?: string[];
    required?: boolean;
    source?: GroundingClaimDraft['source'];
  }>;
};

const clip = (value: unknown, maxLength = 720) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const unique = (items: Array<string | null | undefined>, limit = 12) =>
  Array.from(new Set(items.map((item) => clip(item, 140)).filter(Boolean))).slice(0, limit);

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 80);

const conceptTerms = (step: GroundableStep) => unique([
  ...(step.targetSkills || []),
  ...(step.prerequisites || []),
  step.title,
  step.learningGoal,
  ...(step.activities || []),
  ...(step.expectedEvidence || [])
], 16);

const splitQueryTerms = (value: string) =>
  value
    .split(/\s+|、|，|,|\/|;|；|:|：|\(|\)|（|）|\[|\]|【|】|-|_/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

const normalizeClaimText = (value: unknown) =>
  clip(value, 180)
    .replace(/^[-*•\d.\s]+/, '')
    .replace(/^(学习|理解|掌握|完成|能够|可以|需要)\s*/, (match) => match.trim() === '完成' ? '' : match)
    .trim();

const claimQueriesFor = (step: GroundableStep, text: string) => {
  const compactTerms = unique(splitQueryTerms(text).concat(step.targetSkills || [], step.prerequisites || []), 10);
  return unique([
    text,
    [step.title, text].filter(Boolean).join(' '),
    [step.learningGoal, text].filter(Boolean).join(' '),
    compactTerms.slice(0, 8).join(' '),
    [...(step.targetSkills || []), text].filter(Boolean).join(' ')
  ], 5).filter((item) => item.length >= 2);
};

const fallbackClaimDecomposition = (step: GroundableStep): GroundingClaimDraft[] => {
  const rawItems: Array<{ text?: string; required: boolean; source: GroundingClaimDraft['source'] }> = [
    { text: step.learningGoal, required: true, source: 'goal' },
    ...(step.targetSkills || []).slice(0, 5).map((text) => ({ text, required: true, source: 'skill' as const })),
    ...(step.prerequisites || []).slice(0, 3).map((text) => ({ text, required: true, source: 'prerequisite' as const })),
    ...(step.activities || []).slice(0, 4).map((text) => ({ text, required: false, source: 'activity' as const })),
    ...(step.expectedEvidence || []).slice(0, 3).map((text) => ({ text, required: false, source: 'evidence' as const })),
    { text: step.rationale, required: false, source: 'rationale' },
    { text: step.title, required: true, source: 'title' }
  ];

  const claims = rawItems
    .flatMap((item) =>
      String(item.text || '')
        .split(/[。；;]\s*/g)
        .map((text) => ({
          text: normalizeClaimText(text),
          required: item.required,
          source: item.source
        }))
    )
    .filter((item) =>
      item.text.length >= 3 &&
      !/^完成上一阶段|可以直接开始|根据学习反馈|动态调整|推荐资源/.test(item.text)
    );

  const byText = new Map<string, { text: string; required: boolean; source: GroundingClaimDraft['source'] }>();
  claims.forEach((claim) => {
    const key = claim.text.toLowerCase();
    const existing = byText.get(key);
    if (!existing || claim.required) byText.set(key, claim);
  });

  const normalized = Array.from(byText.values()).slice(0, 7);
  const finalClaims = normalized.length ? normalized : [{ text: step.title, required: true, source: 'title' as const }];
  return finalClaims.map((claim, index) => {
    const queries = claimQueriesFor(step, claim.text);
    return {
      id: `claim-${index + 1}`,
      text: claim.text,
      query: queries[0] || claim.text,
      queries,
      required: claim.required || index === 0,
      source: claim.source
    };
  });
};

const buildQueries = (step: GroundableStep) => {
  const terms = conceptTerms(step);
  const compact = unique(terms.flatMap(splitQueryTerms), 18);
  const primary = clip([step.title, step.learningGoal, ...(step.targetSkills || [])].filter(Boolean).join(' '), 240);
  const rationale = clip([step.rationale, ...(step.activities || [])].filter(Boolean).join(' '), 260);
  return unique([
    primary,
    compact.slice(0, 8).join(' '),
    rationale,
    [...(step.targetSkills || []), ...(step.expectedEvidence || [])].join(' ')
  ], 4).filter((item) => item.length >= 2);
};

const evidenceLocatorLabel = (locator?: Record<string, any>) => {
  if (!locator) return '';
  if (typeof locator.timestampStart === 'number') {
    const start = Math.max(0, Math.floor(locator.timestampStart));
    const end = typeof locator.timestampEnd === 'number' ? Math.max(start, Math.floor(locator.timestampEnd)) : start;
    const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    return end > start ? `${fmt(start)}-${fmt(end)}` : fmt(start);
  }
  if (locator.pageStart && locator.pageEnd) return locator.pageStart === locator.pageEnd ? `第 ${locator.pageStart} 页` : `第 ${locator.pageStart}-${locator.pageEnd} 页`;
  if (locator.page || locator.primaryPage) return `第 ${locator.page || locator.primaryPage} 页`;
  if (Array.isArray(locator.headingPath) && locator.headingPath.length) return `章节：${locator.headingPath.join(' / ')}`;
  if (typeof locator.chunkIndex === 'number') return `chunk ${locator.chunkIndex}`;
  return '';
};

const snippetFor = (result: KnowledgeSearchResult) =>
  clip(result.supportSnippets?.[0]?.text || result.summary || result.chunkText, 520);

const lexicalCoverage = (step: GroundableStep, result: KnowledgeSearchResult) => {
  const claims = conceptTerms(step);
  const text = `${result.fileName} ${result.summary || ''} ${result.chunkText}`.toLowerCase();
  const claimHits = claims.filter((claim) => {
    const terms = splitQueryTerms(claim.toLowerCase());
    return terms.length ? terms.some((term) => text.includes(term)) : text.includes(claim.toLowerCase());
  });
  const queryTokens = new Set(tokenize([step.title, step.learningGoal, ...(step.targetSkills || [])].join(' ')));
  const textTokens = new Set(tokenize(`${result.summary || ''} ${result.chunkText}`));
  const tokenHits = Array.from(queryTokens).filter((term) => textTokens.has(term)).length;
  const claimScore = claims.length ? claimHits.length / claims.length : 0;
  const tokenScore = queryTokens.size ? tokenHits / queryTokens.size : 0;
  return {
    score: clamp01(claimScore * 0.68 + tokenScore * 0.32),
    supportedClaims: unique(claimHits.length ? claimHits : Array.from(queryTokens).filter((term) => textTokens.has(term)), 6),
    missingClaims: unique(claims.filter((claim) => !claimHits.includes(claim)), 8)
  };
};

const statusFromScore = (score: number, evidenceCount: number): ResourceGroundingStatus => {
  if (score >= 0.66 && evidenceCount >= 1) return 'grounded';
  if (score >= 0.38 && evidenceCount >= 1) return 'partial';
  return 'resource_gap';
};

const normalizeJudgeStatus = (status?: string): ResourceGroundingStatus => {
  if (status === 'grounded') return 'grounded';
  if (status === 'partial') return 'partial';
  return 'resource_gap';
};

export class StepEvidenceGroundingService {
  async groundStep(input: {
    workspaceId: string;
    workbenchId?: string | null;
    step: GroundableStep;
    diagnostic?: LearnerDiagnosticReport;
    maxCandidates?: number;
  }): Promise<LearningPlanResourceGrounding> {
    const fileIds = input.workbenchId
      ? await getWorkbenchResourceFileIds({ workspaceId: input.workspaceId, workbenchId: input.workbenchId, role: 'source' })
      : [];
    if (input.workbenchId && fileIds.length === 0) {
      return this.emptyGrounding(input.step, '当前 workbench 没有可检索的 sources，无法给这一步建立资料证据。');
    }

    const claims = await this.decomposeClaims(input.step);
    const investigations = await this.investigateClaims({
      workspaceId: input.workspaceId,
      fileIds: fileIds.length ? fileIds : undefined,
      claims,
      maxCandidates: input.maxCandidates || 6
    });
    const searchResults = investigations.flatMap((item) => item.candidates);

    if (!searchResults.length) {
      return this.emptyGrounding(
        input.step,
        `没有在当前资料库中检索到能支撑「${input.step.title}」的片段。`,
        claims
      );
    }

    const queries = claims.map((claim) => claim.query);
    const heuristic = this.heuristicJudge(input.step, searchResults);
    const judged = await this.modelJudge(input.step, searchResults, heuristic).catch(() => heuristic);
    return this.toGrounding(input.step, searchResults, judged, queries, claims, investigations);
  }

  async groundSteps(input: {
    workspaceId: string;
    workbenchId?: string | null;
    steps: GroundableStep[];
    diagnostic?: LearnerDiagnosticReport;
  }) {
    const results = [];
    for (const step of input.steps) {
      results.push(await this.groundStep({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        step,
        diagnostic: input.diagnostic
      }));
    }
    return results;
  }

  private async retrieveCandidates(input: {
    workspaceId: string;
    fileIds?: string[];
    queries: string[];
    maxCandidates: number;
  }) {
    const byChunkId = new Map<string, KnowledgeSearchResult>();
    for (const query of input.queries) {
      const results = await knowledgeSearchService.search({
        workspaceId: input.workspaceId,
        query,
        fileIds: input.fileIds,
        limit: input.maxCandidates,
        requireDiversity: true
      }).catch(() => []);
      results.forEach((result) => {
        const existing = byChunkId.get(result.chunkId);
        if (!existing || result.score > existing.score) byChunkId.set(result.chunkId, result);
      });
    }
    return Array.from(byChunkId.values())
      .sort((left, right) => right.score - left.score)
      .slice(0, input.maxCandidates);
  }

  private async decomposeClaims(step: GroundableStep): Promise<GroundingClaimDraft[]> {
    const fallback = fallbackClaimDecomposition(step);
    if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) return fallback;

    const response = await aiModelProviderService.json<ClaimDecompositionResponse>({
      instruction: [
        '你是学习计划 grounding 的 claim decomposition agent。',
        '任务：把一个学习计划步骤拆成可以在资料库中独立验证的原子学习点。',
        '每个 claim 必须是资料可证明/不可证明的具体内容，不要生成“动态调整”“推荐资源”“完成本步骤”这类流程性 claim。',
        '优先覆盖 learningGoal、targetSkills、prerequisites；activities 和 expectedEvidence 只在它们表达了具体知识点时纳入。',
        '每个 claim 给出 2-4 个适合资料检索的中文查询，查询要短、包含核心概念和同义表达。',
        '最多 7 个 claim。返回 JSON only。'
      ].join('\n'),
      schema: {
        claims: [{
          text: 'string',
          query: 'string',
          queries: ['string'],
          required: true,
          source: 'goal | skill | prerequisite | activity | evidence | rationale | title'
        }]
      },
      input: {
        step: {
          title: step.title,
          learningGoal: step.learningGoal,
          rationale: step.rationale,
          targetSkills: step.targetSkills || [],
          prerequisites: step.prerequisites || [],
          activities: step.activities || [],
          expectedEvidence: step.expectedEvidence || []
        },
        fallbackClaims: fallback.map((claim) => ({
          text: claim.text,
          queries: claim.queries,
          required: claim.required,
          source: claim.source
        }))
      },
      useCase: 'planner',
      timeoutMs: 20000
    }).catch(() => null);

    const modelClaims = Array.isArray(response?.data?.claims) ? response.data.claims : [];
    const normalized = modelClaims
      .map((claim) => {
        const text = normalizeClaimText(claim.text);
        if (text.length < 3) return null;
        const queries = unique([
          ...(Array.isArray(claim.queries) ? claim.queries : []),
          claim.query,
          ...claimQueriesFor(step, text)
        ], 5).filter((item) => item.length >= 2);
        return {
          text,
          queries,
          required: claim.required !== false,
          source: claim.source || 'skill'
        };
      })
      .filter((claim): claim is { text: string; queries: string[]; required: boolean; source: GroundingClaimDraft['source'] } => Boolean(claim));

    const byText = new Map<string, { text: string; queries: string[]; required: boolean; source: GroundingClaimDraft['source'] }>();
    normalized.forEach((claim) => {
      const key = claim.text.toLowerCase();
      const existing = byText.get(key);
      byText.set(key, existing
        ? {
            ...existing,
            queries: unique([...existing.queries, ...claim.queries], 5),
            required: existing.required || claim.required
          }
        : claim);
    });

    const claims = Array.from(byText.values()).slice(0, 7);
    if (!claims.length) return fallback;
    return claims.map((claim, index) => ({
      id: `claim-${index + 1}`,
      text: claim.text,
      query: claim.queries[0] || claim.text,
      queries: claim.queries.length ? claim.queries : claimQueriesFor(step, claim.text),
      required: claim.required || index === 0,
      source: claim.source
    }));
  }

  private async investigateClaims(input: {
    workspaceId: string;
    fileIds?: string[];
    claims: GroundingClaimDraft[];
    maxCandidates: number;
  }): Promise<ClaimInvestigation[]> {
    const investigations: ClaimInvestigation[] = [];
    for (const claim of input.claims) {
      const candidates = await this.retrieveCandidates({
        workspaceId: input.workspaceId,
        fileIds: input.fileIds,
        queries: claim.queries.length ? claim.queries : [claim.query],
        maxCandidates: Math.max(input.maxCandidates, 8)
      });
      const expandedCandidates = await Promise.all(
        candidates.slice(0, 6).map(async (result) => {
          const expanded = await this.expandContext(input.workspaceId, result);
          return {
            result,
            contextBefore: expanded.contextBefore,
            contextAfter: expanded.contextAfter
          };
        })
      );
      const fallbackJudge = this.heuristicClaimJudge(claim, expandedCandidates);
      const judged = await this.modelClaimJudge(claim, expandedCandidates, fallbackJudge).catch(() => fallbackJudge);
      const acceptedEvidence = this.claimAcceptedEvidence(claim, expandedCandidates, judged);
      const rejectedEvidence = this.claimRejectedEvidence(claim, expandedCandidates, judged, acceptedEvidence);
      const best = Math.max(...acceptedEvidence.map((evidence) => evidence.confidence), 0);
      const status = acceptedEvidence.length === 0
        ? 'missing'
        : judged.status === 'supported' && best >= 0.62
          ? 'supported'
          : best >= 0.42 || judged.status === 'partial'
            ? 'partial'
            : 'missing';
      investigations.push({
        claim,
        candidates,
        acceptedEvidence,
        rejectedEvidence,
        status,
        confidence: best,
        missingReason: acceptedEvidence.length ? undefined : clip(judged.missingReason || `没有找到可确认「${claim.text}」的资料片段。`, 220)
      });
    }
    return investigations;
  }

  private async expandContext(workspaceId: string, candidate: KnowledgeSearchResult) {
    const chunks = await documentChunkStore
      .listFileChunks({ workspaceId, fileObjectId: candidate.fileObjectId })
      .catch(() => []);
    const locator = candidate.metadata.locator as Record<string, any> | undefined;
    const chunkIndex = typeof locator?.chunkIndex === 'number'
      ? locator.chunkIndex
      : chunks.find((chunk) => chunk.chunkId === candidate.chunkId)?.chunkIndex;
    if (typeof chunkIndex !== 'number') return { contextBefore: '', contextAfter: '' };
    const before = chunks
      .filter((chunk) => chunk.chunkIndex >= chunkIndex - 2 && chunk.chunkIndex < chunkIndex)
      .map((chunk) => chunk.summary || chunk.text)
      .filter(Boolean)
      .join('\n');
    const after = chunks
      .filter((chunk) => chunk.chunkIndex > chunkIndex && chunk.chunkIndex <= chunkIndex + 2)
      .map((chunk) => chunk.summary || chunk.text)
      .filter(Boolean)
      .join('\n');
    return {
      contextBefore: clip(before, 520),
      contextAfter: clip(after, 520)
    };
  }

  private heuristicClaimJudge(
    claim: GroundingClaimDraft,
    candidates: ExpandedCandidate[]
  ): Required<ClaimEvidenceJudgeResponse> {
    const claimTerms = splitQueryTerms(claim.text.toLowerCase());
    const claimTokens = new Set(tokenize(claim.text));
    const scored = candidates.map((candidate) => {
      const text = [
        candidate.result.fileName,
        candidate.result.summary || '',
        candidate.result.chunkText,
        candidate.contextBefore,
        candidate.contextAfter
      ].join('\n').toLowerCase();
      const phraseHit = text.includes(claim.text.toLowerCase());
      const termHits = claimTerms.filter((term) => text.includes(term));
      const textTokens = new Set(tokenize(text));
      const tokenHits = Array.from(claimTokens).filter((term) => textTokens.has(term)).length;
      const termScore = claimTerms.length ? termHits.length / claimTerms.length : 0;
      const tokenScore = claimTokens.size ? tokenHits / claimTokens.size : 0;
      const retrievalScore = clamp01(candidate.result.score / 90);
      const contentScore = clamp01((phraseHit ? 0.35 : 0) + termScore * 0.38 + tokenScore * 0.18 + retrievalScore * 0.09);
      return {
        candidate,
        confidence: contentScore,
        phraseHit,
        termHits
      };
    });

    const accepted = scored
      .filter((item) => snippetFor(item.candidate.result).length >= 30 && item.confidence >= 0.42 && (item.phraseHit || item.termHits.length >= 1))
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 2);
    const rejected = scored
      .filter((item) => !accepted.some((acceptedItem) => acceptedItem.candidate.result.chunkId === item.candidate.result.chunkId))
      .slice(0, 4);
    const best = accepted[0]?.confidence || 0;

    return {
      status: best >= 0.72 ? 'supported' : best >= 0.42 ? 'partial' : 'missing',
      acceptedEvidence: accepted.map((item) => ({
        chunkId: item.candidate.result.chunkId,
        whySupports: item.phraseHit
          ? `片段直接出现并解释了「${claim.text}」相关内容。`
          : `片段命中了「${item.termHits.slice(0, 4).join('、')}」等关键概念，可作为部分证据。`,
        confidence: Number(item.confidence.toFixed(2))
      })),
      rejectedEvidence: rejected.map((item) => ({
        chunkId: item.candidate.result.chunkId,
        reason: item.termHits.length
          ? '候选片段只命中少量关键词，尚不能确认该学习点。'
          : '候选片段没有覆盖该学习点的关键概念。'
      })),
      missingReason: accepted.length ? '' : `当前资料未覆盖「${claim.text}」的关键解释或例子。`
    };
  }

  private async modelClaimJudge(
    claim: GroundingClaimDraft,
    candidates: ExpandedCandidate[],
    fallback: Required<ClaimEvidenceJudgeResponse>
  ): Promise<Required<ClaimEvidenceJudgeResponse>> {
    if (!aiModelProviderService.isConfigured({ useCase: 'planner' }) || candidates.length === 0) return fallback;

    const response = await aiModelProviderService.json<ClaimEvidenceJudgeResponse>({
      instruction: [
        '你是资料 grounding 的 claim-level evidence judge，行为接近代码智能体读取上下文后判断证据。',
        '给定一个学习 claim 和检索到的候选 chunk，逐条判断候选是否真正支持 claim。',
        '必须阅读 snippet 以及 before/after context；不要因为文件名、标题或关键词相似就接受。',
        'acceptedEvidence 只能包含内容上能解释、定义、推导、举例或练习该 claim 的 chunk。',
        'partial 表示只有背景/局部解释；missing 表示没有足够资料证据。',
        '返回 JSON only，理由用简体中文。'
      ].join('\n'),
      schema: {
        status: 'supported | partial | missing',
        acceptedEvidence: [{ chunkId: 'string', whySupports: 'string', confidence: 0.0 }],
        rejectedEvidence: [{ chunkId: 'string', reason: 'string' }],
        missingReason: 'string'
      },
      input: {
        claim: {
          id: claim.id,
          text: claim.text,
          required: claim.required,
          source: claim.source,
          queries: claim.queries
        },
        candidates: candidates.map((candidate) => ({
          chunkId: candidate.result.chunkId,
          fileName: candidate.result.fileName,
          locator: candidate.result.metadata.locator,
          retrievalScore: candidate.result.score,
          retrievalReason: candidate.result.retrievalReason,
          snippet: snippetFor(candidate.result),
          contextBefore: candidate.contextBefore,
          contextAfter: candidate.contextAfter
        }))
      },
      useCase: 'planner',
      timeoutMs: 25000
    });

    const data = response.data || {};
    const status = data.status === 'supported' || data.status === 'partial' || data.status === 'missing'
      ? data.status
      : fallback.status;
    return {
      status,
      acceptedEvidence: Array.isArray(data.acceptedEvidence) ? data.acceptedEvidence : fallback.acceptedEvidence,
      rejectedEvidence: Array.isArray(data.rejectedEvidence) ? data.rejectedEvidence : fallback.rejectedEvidence,
      missingReason: clip(data.missingReason || fallback.missingReason, 240)
    };
  }

  private claimAcceptedEvidence(
    claim: GroundingClaimDraft,
    candidates: ExpandedCandidate[],
    judge: Required<ClaimEvidenceJudgeResponse>
  ): LearningPlanGroundingEvidence[] {
    const candidateById = new Map(candidates.map((candidate) => [candidate.result.chunkId, candidate] as const));
    const accepted: LearningPlanGroundingEvidence[] = [];
    for (const item of judge.acceptedEvidence || []) {
      const candidate = item.chunkId ? candidateById.get(item.chunkId) : null;
      if (!candidate) continue;
      const snippet = snippetFor(candidate.result);
      const confidence = clamp01(Number(item.confidence ?? (judge.status === 'supported' ? 0.78 : 0.52)));
      if (snippet.length < 30 || confidence < 0.35) continue;
      accepted.push({
        fileId: candidate.result.fileObjectId,
        fileName: candidate.result.fileName,
        path: candidate.result.path || undefined,
        chunkId: candidate.result.chunkId,
        locator: candidate.result.metadata.locator as Record<string, unknown> | undefined,
        snippet,
        contextBefore: candidate.contextBefore,
        contextAfter: candidate.contextAfter,
        supportedClaims: [claim.text],
        whySupports: clip(item.whySupports || `该片段可支撑「${claim.text}」。`, 260),
        confidence: Number(confidence.toFixed(2)),
        retrievalQuery: claim.queries.join(' | ')
      });
    }
    return accepted.sort((left, right) => right.confidence - left.confidence).slice(0, 2);
  }

  private claimRejectedEvidence(
    claim: GroundingClaimDraft,
    candidates: ExpandedCandidate[],
    judge: Required<ClaimEvidenceJudgeResponse>,
    acceptedEvidence: LearningPlanGroundingEvidence[]
  ): LearningPlanRejectedEvidence[] {
    const acceptedIds = new Set(acceptedEvidence.map((evidence) => evidence.chunkId).filter(Boolean));
    const explicit = new Map((judge.rejectedEvidence || []).map((item) => [item.chunkId, item.reason] as const));
    return candidates
      .filter((candidate) => !acceptedIds.has(candidate.result.chunkId))
      .slice(0, 4)
      .map((candidate) => ({
        fileId: candidate.result.fileObjectId,
        fileName: candidate.result.fileName,
        chunkId: candidate.result.chunkId,
        locator: candidate.result.metadata.locator as Record<string, unknown> | undefined,
        snippet: clip(candidate.result.chunkText, 220),
        reason: clip(explicit.get(candidate.result.chunkId) || '候选片段不足以确认该学习点。', 220),
        claim: claim.text
      }));
  }

  private heuristicJudge(step: GroundableStep, candidates: KnowledgeSearchResult[]): Required<EvidenceJudgeResponse> {
    const scored = candidates.map((candidate) => {
      const coverage = lexicalCoverage(step, candidate);
      const normalizedRetrieval = clamp01(candidate.score / 80);
      const hasSnippet = snippetFor(candidate).length >= 30;
      const confidence = clamp01(coverage.score * 0.72 + normalizedRetrieval * 0.28);
      return { candidate, coverage, confidence, hasSnippet };
    });
    const accepted = scored
      .filter((item) => item.hasSnippet && item.confidence >= 0.34 && item.coverage.supportedClaims.length)
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 3);
    const rejected = scored
      .filter((item) => !accepted.some((acceptedItem) => acceptedItem.candidate.chunkId === item.candidate.chunkId))
      .slice(0, 4);
    const supportedClaims = unique(accepted.flatMap((item) => item.coverage.supportedClaims), 8);
    const missingClaims = unique([
      ...conceptTerms(step).filter((claim) => !supportedClaims.includes(claim)),
      ...accepted.flatMap((item) => item.coverage.missingClaims)
    ], 8);
    const coverageScore = accepted.length
      ? clamp01(accepted.reduce((sum, item) => sum + item.confidence, 0) / accepted.length)
      : 0;
    return {
      status: statusFromScore(coverageScore, accepted.length),
      coverageScore,
      supportedClaims,
      missingClaims,
      acceptedEvidence: accepted.map((item) => ({
        chunkId: item.candidate.chunkId,
        supportedClaims: item.coverage.supportedClaims,
        whySupports: `该片段直接命中「${item.coverage.supportedClaims.slice(0, 3).join('、')}」，可支撑当前步骤。`,
        confidence: Number(item.confidence.toFixed(2))
      })),
      rejectedEvidence: rejected.map((item) => ({
        chunkId: item.candidate.chunkId,
        reason: item.coverage.supportedClaims.length
          ? '只提供弱相关背景，不能单独证明当前步骤。'
          : '没有命中当前步骤的关键学习目标。'
      })),
      summary: accepted.length
        ? `找到 ${accepted.length} 条可审查证据。`
        : '检索到候选片段，但没有片段能证明当前步骤。'
    };
  }

  private async modelJudge(
    step: GroundableStep,
    candidates: KnowledgeSearchResult[],
    fallback: Required<EvidenceJudgeResponse>
  ): Promise<Required<EvidenceJudgeResponse>> {
    if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) return fallback;

    const response = await aiModelProviderService.json<EvidenceJudgeResponse>({
      instruction: [
        'You are an evidence grounding judge for a learning plan.',
        'Given one plan step and retrieved source chunks, decide whether the chunks truly support the step.',
        'Do not accept evidence only because the file title is related. Require snippet content to support the learning claims.',
        'If evidence is weak or missing, mark partial or unsupported and list missing claims.',
        'Return JSON only. Use Simplified Chinese for reasons.'
      ].join('\n'),
      schema: {
        status: 'grounded | partial | unsupported',
        coverageScore: 0.0,
        supportedClaims: ['string'],
        missingClaims: ['string'],
        acceptedEvidence: [{ chunkId: 'string', supportedClaims: ['string'], whySupports: 'string', confidence: 0.0 }],
        rejectedEvidence: [{ chunkId: 'string', reason: 'string' }],
        summary: 'string'
      },
      input: {
        step: {
          title: step.title,
          learningGoal: step.learningGoal,
          rationale: step.rationale,
          targetSkills: step.targetSkills || [],
          prerequisites: step.prerequisites || [],
          activities: step.activities || [],
          expectedEvidence: step.expectedEvidence || []
        },
        candidates: candidates.slice(0, 8).map((candidate) => ({
          chunkId: candidate.chunkId,
          fileName: candidate.fileName,
          locator: candidate.metadata.locator,
          snippet: snippetFor(candidate),
          retrievalReason: candidate.retrievalReason,
          matchedTerms: candidate.matchedTerms
        }))
      },
      useCase: 'planner',
      timeoutMs: 30000
    });

    const data = response.data || {};
    return {
      status: normalizeJudgeStatus(data.status),
      coverageScore: clamp01(Number(data.coverageScore ?? fallback.coverageScore)),
      supportedClaims: unique(data.supportedClaims?.length ? data.supportedClaims : fallback.supportedClaims, 8),
      missingClaims: unique(data.missingClaims?.length ? data.missingClaims : fallback.missingClaims, 8),
      acceptedEvidence: Array.isArray(data.acceptedEvidence) ? data.acceptedEvidence : fallback.acceptedEvidence,
      rejectedEvidence: Array.isArray(data.rejectedEvidence) ? data.rejectedEvidence : fallback.rejectedEvidence,
      summary: clip(data.summary || fallback.summary, 300)
    };
  }

  private toGrounding(
    step: GroundableStep,
    candidates: KnowledgeSearchResult[],
    judge: Required<EvidenceJudgeResponse>,
    queries: string[],
    claims: GroundingClaimDraft[],
    investigations: ClaimInvestigation[]
  ): LearningPlanResourceGrounding {
    const candidateById = new Map(candidates.map((candidate) => [candidate.chunkId, candidate] as const));
    const acceptedEvidence: LearningPlanGroundingEvidence[] = [];
    for (const item of judge.acceptedEvidence) {
      const candidate = item.chunkId ? candidateById.get(item.chunkId) : null;
      if (!candidate) continue;
      const snippet = snippetFor(candidate);
      if (!snippet) continue;
      acceptedEvidence.push({
        fileId: candidate.fileObjectId,
        fileName: candidate.fileName,
        path: candidate.path || undefined,
        chunkId: candidate.chunkId,
        locator: candidate.metadata.locator as Record<string, unknown> | undefined,
        snippet,
        supportedClaims: unique(item.supportedClaims || judge.supportedClaims, 6),
        whySupports: clip(item.whySupports || `该片段可支撑「${step.title}」。`, 260),
        confidence: clamp01(Number(item.confidence ?? judge.coverageScore))
      });
    }

    const rejectedEvidence: LearningPlanRejectedEvidence[] = [];
    for (const item of judge.rejectedEvidence) {
      const candidate = item.chunkId ? candidateById.get(item.chunkId) : null;
      if (!candidate) continue;
      rejectedEvidence.push({
        fileId: candidate.fileObjectId,
        fileName: candidate.fileName,
        chunkId: candidate.chunkId,
        locator: candidate.metadata.locator as Record<string, unknown> | undefined,
        snippet: clip(candidate.chunkText, 220),
        reason: clip(item.reason || '证据不足。', 220)
      });
    }

    const claimEvidence = investigations.flatMap((item) => item.acceptedEvidence);
    const mergedEvidence = this.mergeEvidence([...claimEvidence, ...acceptedEvidence]);
    const claimMatrix: LearningPlanClaimEvidenceMatrixItem[] = investigations.map((item) => ({
      claimId: item.claim.id,
      claim: item.claim.text,
      status: item.status,
      evidence: item.acceptedEvidence,
      rejectedEvidence: item.rejectedEvidence,
      missingReason: item.missingReason
    }));
    const requiredClaims = investigations.filter((item) => item.claim.required);
    const supportedRequired = requiredClaims.filter((item) => item.status === 'supported').length;
    const partialRequired = requiredClaims.filter((item) => item.status === 'partial').length;
    const coverageScore = requiredClaims.length
      ? clamp01((supportedRequired + partialRequired * 0.55) / requiredClaims.length)
      : clamp01(judge.coverageScore);
    const status = mergedEvidence.length ? statusFromScore(coverageScore, mergedEvidence.length) : 'resource_gap';
    const primary = mergedEvidence[0];
    const supportedClaims = unique(investigations.filter((item) => item.status !== 'missing').map((item) => item.claim.text), 10);
    const missingClaims = unique(investigations.filter((item) => item.status === 'missing').map((item) => item.claim.text), 10);
    const allRejectedEvidence = [...rejectedEvidence, ...investigations.flatMap((item) => item.rejectedEvidence)].slice(0, 12);
    const matches: LearningPlanResourceMatch[] = mergedEvidence.map((evidence, index) => ({
      resourceId: evidence.fileId,
      resourceTitle: evidence.fileName,
      resourceUnitId: evidence.chunkId,
      resourceUnitTitle: evidenceLocatorLabel(evidence.locator) || `证据片段 ${index + 1}`,
      resourceLocator: evidence.locator,
      resourceEntryPoint: evidenceLocatorLabel(evidence.locator),
      matchScore: Number(evidence.confidence.toFixed(2)),
      scoreBreakdown: {
        relevance: Number(evidence.confidence.toFixed(2)),
        difficultyFit: 0,
        prerequisiteFit: 0,
        learnerFit: 0
      },
      reason: evidence.whySupports,
      evidenceSnippets: [evidence.snippet],
      acceptedEvidence: [evidence],
      rejectedEvidence: allRejectedEvidence,
      missingClaims,
      claimIds: claims.filter((claim) => evidence.supportedClaims.includes(claim.text)).map((claim) => claim.id),
      groundingMethod: 'evidence_search'
    }));

    return {
      status,
      matches,
      gapReason: status === 'resource_gap'
        ? `当前资料库没有足够证据支撑「${step.title}」。`
        : status === 'partial'
          ? `当前资料只能部分支撑「${step.title}」，仍缺少：${missingClaims.slice(0, 3).join('、') || '更直接的资料证据'}。`
          : undefined,
      neededResource: missingClaims.length
        ? `需要补充覆盖「${missingClaims.slice(0, 4).join('、')}」的资料或练习。`
        : undefined,
      warnings: unique([
        `claim_count:${claims.length}`,
        `query_count:${queries.length}`,
        status === 'resource_gap' ? 'no_accepted_evidence' : '',
        mergedEvidence.length === 0 ? 'snippet_required_for_grounded_status' : ''
      ], 6),
      coverageScore: Number((primary?.confidence ? Math.max(primary.confidence, coverageScore) : coverageScore).toFixed(2)),
      supportedClaims,
      missingClaims,
      rejectedEvidence: allRejectedEvidence,
      claims: claims.map((claim) => {
        const investigation = investigations.find((item) => item.claim.id === claim.id);
        return {
          id: claim.id,
          text: claim.text,
          query: claim.query,
          queries: claim.queries,
          source: claim.source,
          required: claim.required,
          status: investigation?.status || 'missing',
          evidenceChunkIds: (investigation?.acceptedEvidence || []).map((evidence) => evidence.chunkId || '').filter(Boolean),
          missingReason: investigation?.missingReason
        } satisfies LearningPlanGroundingClaim;
      }),
      claimEvidenceMatrix: claimMatrix,
      groundingMethod: 'evidence_search'
    };
  }

  private mergeEvidence(items: LearningPlanGroundingEvidence[]) {
    const byKey = new Map<string, LearningPlanGroundingEvidence>();
    items.forEach((item) => {
      const key = item.chunkId || `${item.fileId}:${item.snippet.slice(0, 80)}`;
      const existing = byKey.get(key);
      if (!existing || item.confidence > existing.confidence) {
        byKey.set(key, {
          ...item,
          supportedClaims: unique([...(existing?.supportedClaims || []), ...item.supportedClaims], 8)
        });
      }
    });
    return Array.from(byKey.values()).sort((left, right) => right.confidence - left.confidence).slice(0, 5);
  }

  private emptyGrounding(
    step: GroundableStep,
    reason: string,
    claims: GroundingClaimDraft[] = fallbackClaimDecomposition(step)
  ): LearningPlanResourceGrounding {
    return {
      status: 'resource_gap',
      matches: [],
      gapReason: reason,
      neededResource: `需要补充能覆盖「${claims.slice(0, 4).map((claim) => claim.text).join('、') || step.title}」的课程资料。`,
      warnings: ['no_searchable_workbench_sources'],
      coverageScore: 0,
      supportedClaims: [],
      missingClaims: claims.map((claim) => claim.text),
      rejectedEvidence: [],
      claims: claims.map((claim) => ({
        id: claim.id,
        text: claim.text,
        query: claim.query,
        queries: claim.queries,
        required: claim.required,
        source: claim.source,
        status: 'missing',
        evidenceChunkIds: [],
        missingReason: reason
      })),
      claimEvidenceMatrix: claims.map((claim) => ({
        claimId: claim.id,
        claim: claim.text,
        status: 'missing',
        evidence: [],
        rejectedEvidence: [],
        missingReason: reason
      })),
      groundingMethod: 'evidence_search'
    };
  }
}

export const stepEvidenceGroundingService = new StepEvidenceGroundingService();
