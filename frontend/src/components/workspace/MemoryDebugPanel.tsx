import { useState } from 'react';
import { Activity, Brain, Database, History, Loader2, RefreshCw, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { learningApi } from '../../services/learningApi';

interface MemoryDebugPanelProps {
  workspaceId: string;
  workbenchId?: string;
}

const short = (value: unknown, fallback = '暂无') => {
  const text = String(value || '').trim();
  return text || fallback;
};

export default function MemoryDebugPanel({ workspaceId, workbenchId }: MemoryDebugPanelProps) {
  const [query, setQuery] = useState('');
  const [debug, setDebug] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [backfillResult, setBackfillResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!workspaceId || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await learningApi.getMemoryDebug(workspaceId, { workbenchId, query: query.trim() || undefined });
      setDebug(result);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '加载 Memory Debug 失败');
    } finally {
      setLoading(false);
    }
  };

  const loadHealth = async () => {
    setHealthLoading(true);
    setError(null);
    try {
      setHealth(await learningApi.getMemoryHealth());
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '加载服务健康状态失败');
    } finally {
      setHealthLoading(false);
    }
  };

  const runBackfill = async () => {
    setBackfillLoading(true);
    setError(null);
    try {
      const result = await learningApi.backfillConversationEmbeddings({ workspaceId, limit: 500, enqueue: true });
      setBackfillResult(result);
      await loadHealth();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '启动 embedding backfill 失败');
    } finally {
      setBackfillLoading(false);
    }
  };

  const savedMemories = debug?.whatWillInfluenceAnswers?.savedMemories || [];
  const retrievedHistory = debug?.whatWillInfluenceAnswers?.retrievedHistory || [];
  const pendingCandidates = debug?.whatWillInfluenceAnswers?.pendingSaveCandidates || [];
  const learnerSignals = debug?.whatWillInfluenceAnswers?.learnerSignals || {};

  return (
    <section className="mt-10 border-t border-[#eeeeeb] pt-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#f1f1ef] px-3 py-1 text-xs font-medium text-[#55585d]">
            <Brain className="h-3.5 w-3.5" />
            记忆调试
          </div>
          <h3 className="text-2xl font-semibold tracking-normal text-[#202124]">AI 为什么会想起这些</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#666a70]">
            输入一个问题，预览本次回答可能会参考的长期记忆、历史对话和学习状态。这里展示的是可读解释，不是原始 prompt。
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-[#e6e6e1] bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 min-w-0 flex-1 rounded-lg border border-[#deded9] bg-[#fbfbfa] px-3 text-sm text-[#202124] outline-none transition focus:border-[#b9bab2] focus:bg-white"
            placeholder="例如：我们上次说的软件项目风险例子"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#202124] px-4 text-sm font-medium text-white transition hover:bg-black disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              预览记忆使用
            </button>
            <button
              onClick={() => void loadHealth()}
              disabled={healthLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef] disabled:opacity-50"
              title="检查服务"
            >
              {healthLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        {health ? (
          <div className="mt-5 rounded-lg border border-[#eeeeeb] p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-[#202124]">
                <Database className="h-4 w-4 text-[#777b80]" />
                服务健康
              </p>
              <button
                onClick={() => void runBackfill()}
                disabled={backfillLoading}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-[#55585d] transition hover:bg-[#f1f1ef] disabled:opacity-50"
              >
                {backfillLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                补齐历史 embedding
              </button>
            </div>
            <div className="grid gap-2 md:grid-cols-4">
              {[
                ['DeepSeek', health.services?.llm?.ok],
                ['Embedding', health.services?.embedding?.ok],
                ['Reranker', health.services?.reranker?.ok],
                ['Qdrant', health.services?.qdrant?.ok]
              ].map(([name, ok]) => (
                <div key={String(name)} className={`rounded-lg px-3 py-2 text-sm ${ok ? 'bg-[#edf7f2] text-[#20694f]' : 'bg-[#fff6e5] text-[#8a5a00]'}`}>
                  {name}: {ok ? '可用' : '降级'}
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-[#777b80]">当前语义检索模式：{health.semanticRetrievalMode}</p>
            {backfillResult ? (
              <p className="mt-2 text-xs text-[#777b80]">
                已扫描 {backfillResult.scanned} 条历史消息，排队 {backfillResult.queued} 条 embedding 任务。
              </p>
            ) : null}
          </div>
        ) : null}

        {debug ? (
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg bg-[#f7f7f4] p-3">
                <p className="text-xs text-[#777b80]">状态</p>
                <p className="mt-1 text-sm font-semibold text-[#202124]">{debug.health?.readiness || 'unknown'}</p>
              </div>
              <div className="rounded-lg bg-[#f7f7f4] p-3">
                <p className="text-xs text-[#777b80]">证据</p>
                <p className="mt-1 text-sm font-semibold text-[#202124]">{debug.health?.evidenceCount || 0}</p>
              </div>
              <div className="rounded-lg bg-[#f7f7f4] p-3">
                <p className="text-xs text-[#777b80]">来源类型</p>
                <p className="mt-1 text-sm font-semibold text-[#202124]">{debug.health?.sourceDiversity || 0}</p>
              </div>
              <div className="rounded-lg bg-[#f7f7f4] p-3">
                <p className="text-xs text-[#777b80]">待确认</p>
                <p className="mt-1 text-sm font-semibold text-[#202124]">{debug.health?.pendingSaveCandidates || 0}</p>
              </div>
            </div>

            <div className="rounded-lg border border-[#eeeeeb] p-3">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#202124]">
                <Sparkles className="h-4 w-4 text-[#777b80]" />
                简明解释
              </p>
              <div className="space-y-1">
                {(debug.plainEnglishTrace || []).map((line: string) => (
                  <p key={line} className="text-sm leading-6 text-[#55585d]">{line}</p>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-[#eeeeeb] p-3">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#202124]">
                  <ShieldCheck className="h-4 w-4 text-[#777b80]" />
                  长期记忆
                </p>
                {savedMemories.length ? savedMemories.map((memory: any, index: number) => (
                  <p key={`${memory.text}-${index}`} className="border-t border-[#f1f1ef] py-2 text-sm leading-6 text-[#55585d]">
                    {memory.text}
                  </p>
                )) : <p className="text-sm text-[#777b80]">暂无长期记忆。</p>}
              </div>

              <div className="rounded-lg border border-[#eeeeeb] p-3">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#202124]">
                  <History className="h-4 w-4 text-[#777b80]" />
                  找回的历史
                </p>
                {retrievedHistory.length ? retrievedHistory.map((item: any) => (
                  <div key={item.id} className="border-t border-[#f1f1ef] py-2">
                    <p className="text-xs text-[#96999d]">{item.retrievalMode || 'keyword'} · {Math.round(Number(item.score || 0) * 100)}%</p>
                    <p className="text-sm leading-6 text-[#55585d]">{item.summary || item.content}</p>
                  </div>
                )) : <p className="text-sm text-[#777b80]">没有匹配历史。</p>}
              </div>

              <div className="rounded-lg border border-[#eeeeeb] p-3">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#202124]">
                  <Brain className="h-4 w-4 text-[#777b80]" />
                  学习状态
                </p>
                <p className="text-sm leading-6 text-[#55585d]">最近主题：{short((learnerSignals.recentTopics || []).slice(0, 3).join('、'))}</p>
                <p className="text-sm leading-6 text-[#55585d]">可能补强：{short((learnerSignals.candidateWeaknesses || []).slice(0, 3).join('、'))}</p>
                <p className="text-sm leading-6 text-[#55585d]">讲解偏好：{short((learnerSignals.preferredResourceForms || []).slice(0, 3).join('、'))}</p>
                {pendingCandidates.length ? (
                  <p className="mt-2 text-xs leading-5 text-[#777b80]">{pendingCandidates.length} 条长期记忆候选等待确认。</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
