import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { learningApi } from '../../services/learningApi';
import { PersonalizedWorkspaceIntegration } from '../../types';

type MemoryStatus = 'active' | 'corrected' | 'frozen' | 'downranked' | 'deleted';

interface KeyMemoryItem {
  key: string;
  dimension: string;
  label: string;
  userFacingLabel?: string;
  signalType?: string;
  value: string;
  evidenceCount: number;
  sources: string[];
  status: MemoryStatus;
  explanation: string;
}

interface MyLearningStatusProps {
  workspaceId: string;
  workbenchId?: string;
}

const unique = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

const pickByDimension = (memories: KeyMemoryItem[], dimension: string, limit = 3) =>
  memories.filter((item) => item.dimension === dimension && item.status !== 'deleted').slice(0, limit);

export default function MyLearningStatus({ workspaceId, workbenchId }: MyLearningStatusProps) {
  const [memories, setMemories] = useState<KeyMemoryItem[]>([]);
  const [integration, setIntegration] = useState<PersonalizedWorkspaceIntegration | null>(null);
  const [contextSummary, setContextSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await learningApi.listLearnerMemories(workspaceId, { workbenchId, limit: 24 });
      const integrationResult = await learningApi.getWorkspaceIntegration(workspaceId, { workbenchId });
      setMemories(Array.isArray(result.memories) ? result.memories : []);
      setContextSummary(String(result.contextSummary || ''));
      setIntegration(integrationResult.integration || null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '加载学习状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [workspaceId, workbenchId]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await learningApi.refreshLearnerState({ workspaceId, workbenchId });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '更新学习建议失败');
    } finally {
      setRefreshing(false);
    }
  };

  const overview = useMemo(() => {
    const active = memories.filter((item) => item.status !== 'deleted');
    const topicCount = unique(active.map((item) => item.userFacingLabel || item.label)).length;
    const sourceCount = unique(active.flatMap((item) => item.sources || [])).length;
    return { topicCount, sourceCount, suggestionCount: active.length };
  }, [memories]);

  const nextSteps = useMemo(
    () => pickByDimension(memories, 'reviewPlanning', 3).concat(pickByDimension(memories, 'knowledgeState', 2)).slice(0, 4),
    [memories]
  );

  const recentFocus = useMemo(
    () => pickByDimension(memories, 'misconceptionState', 3).concat(pickByDimension(memories, 'knowledgeState', 2)).slice(0, 4),
    [memories]
  );

  const resourceHints = useMemo(() => pickByDimension(memories, 'preferenceStyle', 4), [memories]);
  const progressItems = useMemo(() => pickByDimension(memories, 'knowledgeState', 4), [memories]);
  const recommendedTasks = integration?.taskRecommendations || [];
  const recommendedResources = integration?.resourceRecommendations || [];
  const explanations = integration?.recommendationExplanations || [];

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[#202124]">我的学习者画像</h2>
          <p className="mt-1 text-sm leading-6 text-[#666a70]">这里会把稳定画像、当前学习状态和短期观察分开整理，用来生成更可靠的学习建议。</p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={refreshing || loading}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          更新学习建议
        </button>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-[#ffd6d6] bg-[#fff7f7] px-3 py-2 text-sm text-[#b42318]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-[#d8d8d3] bg-white text-sm text-[#777b80]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在整理学习状态
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-xl border border-[#e6e6e1] bg-white p-4"><p className="text-xs text-[#96999d]">画像概览</p><p className="mt-2 text-sm text-[#55585d]">当前有 {overview.suggestionCount} 条可用状态，覆盖 {overview.topicCount} 个学习主题。</p></article>
            <article className="rounded-xl border border-[#e6e6e1] bg-white p-4"><p className="text-xs text-[#96999d]">证据来源</p><p className="mt-2 text-sm text-[#55585d]">画像来自 {overview.sourceCount || 1} 类学习证据，并通过状态版本持续治理。</p></article>
            <article className="rounded-xl border border-[#e6e6e1] bg-white p-4"><p className="text-xs text-[#96999d]">继续学习</p><p className="mt-2 text-sm text-[#55585d]">{integration?.continueLearning?.nextStepTitle || '短期观察会先保留在 observation memory，重复证据才会进入稳定画像。'}</p></article>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-xl border border-[#e6e6e1] bg-white p-4">
              <h3 className="text-sm font-semibold text-[#202124]">下一步建议</h3>
              <div className="mt-2 space-y-2">
                {recommendedTasks.length ? recommendedTasks.slice(0, 4).map((item) => <p key={item.id} className="text-sm leading-6 text-[#55585d]">{item.title}：{item.reason}</p>) : nextSteps.length ? nextSteps.map((item) => <p key={item.key} className="text-sm leading-6 text-[#55585d]">接下来建议：{item.value}</p>) : <p className="text-sm text-[#777b80]">先继续学习一次，我们会给出更具体的下一步建议。</p>}
              </div>
            </article>
            <article className="rounded-xl border border-[#e6e6e1] bg-white p-4">
              <h3 className="text-sm font-semibold text-[#202124]">近期建议关注</h3>
              <div className="mt-2 space-y-2">
                {integration?.learnerState?.weakSkills?.length ? integration.learnerState.weakSkills.slice(0, 4).map((item) => <p key={item} className="text-sm leading-6 text-[#55585d]">可以留意：{item}</p>) : recentFocus.length ? recentFocus.map((item) => <p key={item.key} className="text-sm leading-6 text-[#55585d]">可以留意：{item.value}</p>) : <p className="text-sm text-[#777b80]">目前没有需要额外关注的主题，保持当前节奏即可。</p>}
              </div>
            </article>
            <article className="rounded-xl border border-[#e6e6e1] bg-white p-4">
              <h3 className="text-sm font-semibold text-[#202124]">推荐资源</h3>
              <div className="mt-2 space-y-2">
                {recommendedResources.length ? recommendedResources.slice(0, 4).map((item) => <p key={item.id} className="text-sm leading-6 text-[#55585d]">{item.title}：{item.reason}</p>) : resourceHints.length ? resourceHints.map((item) => <p key={item.key} className="text-sm leading-6 text-[#55585d]">资源建议：{item.value}</p>) : <p className="text-sm text-[#777b80]">继续上传或使用课程资料后，这里会给出更贴合的资源建议。</p>}
              </div>
            </article>
            <article className="rounded-xl border border-[#e6e6e1] bg-white p-4">
              <h3 className="text-sm font-semibold text-[#202124]">AI 反馈方式</h3>
              <div className="mt-2 space-y-2">
                {integration?.terminalGuidance?.suggestedPrompts?.length ? integration.terminalGuidance.suggestedPrompts.slice(0, 3).map((item) => <p key={item} className="text-sm leading-6 text-[#55585d]">{item}</p>) : progressItems.length ? progressItems.slice(0, 3).map((item) => <p key={item.key} className="text-sm leading-6 text-[#55585d]">你可以尝试：{item.explanation}</p>) : <p className="text-sm text-[#777b80]">目前建议保持现有学习方式，后续会根据学习过程再细化。</p>}
              </div>
            </article>
          </div>

          <article className="rounded-xl border border-[#e6e6e1] bg-white p-4">
            <h3 className="text-sm font-semibold text-[#202124]">为什么推荐这些</h3>
            <div className="mt-2 space-y-2">
              {explanations.length ? explanations.map((item) => <p key={item} className="text-sm leading-6 text-[#55585d]">{item}</p>) : <p className="text-sm leading-6 text-[#55585d]">{contextSummary || '这些建议来自你近期学习中的稳定迹象，目的是帮助你更顺畅地推进下一步。'}</p>}
            </div>
          </article>
        </>
      )}
    </section>
  );
}
