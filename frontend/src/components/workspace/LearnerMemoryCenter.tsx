import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArchiveRestore,
  Ban,
  Check,
  Eye,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Wand2,
  X
} from 'lucide-react';
import { learningApi } from '../../services/learningApi';

type MemoryStatus = 'active' | 'corrected' | 'frozen' | 'downranked' | 'deleted';
type MemoryAction = 'correct' | 'delete' | 'freeze' | 'downrank' | 'restore';

interface KeyMemoryItem {
  key: string;
  dimension: string;
  label: string;
  userFacingLabel?: string;
  signalType?: string;
  value: string;
  confidence: number;
  confidenceLabel: 'low' | 'medium' | 'high';
  evidenceCount: number;
  sources: string[];
  status: MemoryStatus;
  explanation: string;
  editable: boolean;
}

interface MemoryExplainResult {
  memoryKey: string;
  dimension: string;
  controls: Array<{
    id: string;
    action: string;
    reason?: string;
    correctedText?: string;
    weightMultiplier?: number;
    createdAt?: string;
  }>;
  evidence: Array<{
    id: string;
    evidenceType: string;
    sourceType: string;
    title: string;
    summary: string;
    confidence: number;
    observedAt: string;
  }>;
  patches: Array<{
    id: string;
    status: string;
    operation: string;
    confidence: number;
    rationale: string;
    createdAt: string;
    appliedAt?: string | null;
  }>;
}

interface LearnerMemoryCenterProps {
  workspaceId: string;
  workbenchId?: string;
}

const statusTone: Record<MemoryStatus, string> = {
  active: 'bg-[#edf7f2] text-[#20694f]',
  corrected: 'bg-[#eef2ff] text-[#3949a7]',
  frozen: 'bg-[#f1f1ef] text-[#55585d]',
  downranked: 'bg-[#fff6e5] text-[#8a5a00]',
  deleted: 'bg-[#fff1f1] text-[#b42318]'
};

const dimensionLabel = (dimension: string) => {
  const labels: Record<string, string> = {
    profileBase: '目标/背景',
    knowledgeState: '知识状态',
    preferenceStyle: '偏好',
    reviewPlanning: '复习计划',
    misconceptionState: '误解候选',
    behaviorEngagement: '学习行为',
    cognitiveState: '认知状态'
  };
  return labels[dimension] || dimension;
};

const confidenceText = (item: KeyMemoryItem) => {
  if (item.status === 'deleted') return 'hidden';
  return `${Math.round(item.confidence * 100)}% · ${item.confidenceLabel}`;
};

const formatDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
};

export default function LearnerMemoryCenter({ workspaceId, workbenchId }: LearnerMemoryCenterProps) {
  const [memories, setMemories] = useState<KeyMemoryItem[]>([]);
  const [contextSummary, setContextSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [governing, setGoverning] = useState(false);
  const [lifecycleEvents, setLifecycleEvents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [explain, setExplain] = useState<MemoryExplainResult | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [correctedText, setCorrectedText] = useState('');
  const [controlReason, setControlReason] = useState('');
  const [downrankWeight, setDownrankWeight] = useState(0.4);
  const [actingKey, setActingKey] = useState<string | null>(null);

  const selectedMemory = useMemo(
    () => memories.find((memory) => memory.key === selectedKey) || null,
    [memories, selectedKey]
  );

  const loadMemories = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await learningApi.listLearnerMemories(workspaceId, { workbenchId, limit: 18 });
      setMemories(Array.isArray(result.memories) ? result.memories : []);
      setContextSummary(String(result.contextSummary || ''));
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '加载学习记忆失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMemories();
  }, [workspaceId, workbenchId]);

  const refreshState = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await learningApi.refreshLearnerState({ workspaceId, workbenchId });
      await loadMemories();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '刷新画像失败');
    } finally {
      setRefreshing(false);
    }
  };

  const governState = async () => {
    setGoverning(true);
    setError(null);
    try {
      const result = await learningApi.governLearnerState({ workspaceId, workbenchId });
      setLifecycleEvents(Array.isArray(result.lifecycleEvents) ? result.lifecycleEvents : []);
      await loadMemories();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '治理学习状态失败');
    } finally {
      setGoverning(false);
    }
  };

  const showWhy = async (memory: KeyMemoryItem) => {
    setSelectedKey(memory.key);
    setExplain(null);
    setExplainLoading(true);
    try {
      const result = await learningApi.explainLearnerMemory(workspaceId, memory.key);
      setExplain(result);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '加载解释失败');
    } finally {
      setExplainLoading(false);
    }
  };

  const startCorrection = (memory: KeyMemoryItem) => {
    setEditingKey(memory.key);
    setSelectedKey(memory.key);
    setCorrectedText(memory.value);
    setControlReason('');
  };

  const controlMemory = async (memory: KeyMemoryItem, action: MemoryAction, extra?: Partial<{
    correctedText: string;
    reason: string;
    weightMultiplier: number;
  }>) => {
    setActingKey(memory.key);
    setError(null);
    try {
      await learningApi.controlLearnerMemory({
        workspaceId,
        workbenchId,
        memoryKey: memory.key,
        dimension: memory.dimension,
        action,
        originalText: memory.value,
        correctedText: extra?.correctedText,
        reason: extra?.reason,
        weightMultiplier: extra?.weightMultiplier
      });
      setEditingKey(null);
      await loadMemories();
      if (selectedKey === memory.key) {
        await showWhy(memory);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '更新记忆控制失败');
    } finally {
      setActingKey(null);
    }
  };

  return (
    <section className="mt-10 border-t border-[#eeeeeb] pt-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#f1f1ef] px-3 py-1 text-xs font-medium text-[#55585d]">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Centralized learner state
          </div>
          <h3 className="text-2xl font-semibold tracking-normal text-[#202124]">中心化学习者画像</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#666a70]">
            这里按稳定画像、当前学习状态和短期观察三层展示会影响 tutor、planner、quiz 和 flashcard agent 的 learner state。短期观察不会直接等于长期画像，只有经过重复证据和状态治理后才会升级。
          </p>
          {contextSummary ? <p className="mt-2 text-xs leading-5 text-[#96999d]">{contextSummary}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void governState()}
            disabled={governing || loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {governing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            整理状态
          </button>
          <button
            onClick={() => void refreshState()}
            disabled={refreshing || loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新学习状态
          </button>
        </div>
      </div>

      {lifecycleEvents.length ? (
        <div className="mb-4 rounded-lg border border-[#dbe7ff] bg-[#f8fbff] px-3 py-2">
          <p className="text-sm font-medium text-[#202124]">刚刚整理了这些状态</p>
          <div className="mt-1 space-y-1">
            {lifecycleEvents.map((event) => (
              <p key={event} className="text-xs leading-5 text-[#666a70]">{event}</p>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-[#ffd6d6] bg-[#fff7f7] px-3 py-2 text-sm text-[#b42318]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {loading ? (
            <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-[#d8d8d3] bg-white text-sm text-[#777b80]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在读取学习记忆
            </div>
          ) : memories.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#d8d8d3] bg-white p-6">
              <p className="text-sm font-medium text-[#34373c]">暂时没有足够稳定的学习状态信号</p>
              <p className="mt-2 text-sm leading-6 text-[#777b80]">
                多几次 AI 对话、测验和 flashcard review 后，这里会逐步出现可解释、可控制的画像信号。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {memories.map((memory) => {
                const isEditing = editingKey === memory.key;
                const isActing = actingKey === memory.key;
                return (
                  <article key={memory.key} className="rounded-xl border border-[#e6e6e1] bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[#f6f6f4] px-2 py-0.5 text-xs font-medium text-[#666a70]">
                            {dimensionLabel(memory.dimension)}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusTone[memory.status]}`}>
                            {memory.status}
                          </span>
                          <span className="text-xs text-[#96999d]">{confidenceText(memory)}</span>
                        </div>
                        <p className="mt-2 text-sm font-medium text-[#202124]">{memory.userFacingLabel || memory.label}</p>
                        {isEditing ? (
                          <div className="mt-3 space-y-2">
                            <textarea
                              value={correctedText}
                              onChange={(event) => setCorrectedText(event.target.value)}
                              rows={3}
                              className="w-full resize-none rounded-lg border border-[#deded9] bg-[#fbfbfa] px-3 py-2 text-sm leading-6 text-[#202124] outline-none transition focus:border-[#b9bab2] focus:bg-white"
                            />
                            <input
                              value={controlReason}
                              onChange={(event) => setControlReason(event.target.value)}
                              className="h-9 w-full rounded-lg border border-[#deded9] bg-[#fbfbfa] px-3 text-sm text-[#202124] outline-none transition focus:border-[#b9bab2] focus:bg-white"
                              placeholder="可选：为什么这样纠正"
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => void controlMemory(memory, 'correct', {
                                  correctedText: correctedText.trim(),
                                  reason: controlReason.trim()
                                })}
                                disabled={isActing || !correctedText.trim()}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#202124] px-3 text-xs font-medium text-white transition hover:bg-black disabled:opacity-50"
                              >
                                <Check className="h-3.5 w-3.5" />
                                保存纠正
                              </button>
                              <button
                                onClick={() => setEditingKey(null)}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-[#55585d] transition hover:bg-[#f1f1ef]"
                              >
                                <X className="h-3.5 w-3.5" />
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className={`mt-1 text-sm leading-6 ${memory.status === 'deleted' ? 'text-[#96999d] line-through' : 'text-[#55585d]'}`}>
                            {memory.value}
                          </p>
                        )}
                        <p className="mt-2 text-xs leading-5 text-[#96999d]">
                          {memory.explanation}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#96999d]">
                          <span>{memory.evidenceCount} signals</span>
                          <span>·</span>
                          <span>{memory.sources.join(', ') || 'learner state'}</span>
                          {memory.signalType ? (
                            <>
                              <span>·</span>
                              <span>{memory.signalType}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        <button onClick={() => void showWhy(memory)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#777b80] transition hover:bg-[#f1f1ef] hover:text-[#202124]" title="查看依据">
                          <Eye className="h-4 w-4" />
                        </button>
                        {memory.status === 'deleted' ? (
                          <button onClick={() => void controlMemory(memory, 'restore', { reason: 'User restored deleted memory.' })} disabled={isActing} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#777b80] transition hover:bg-[#edf7f2] hover:text-[#20694f]" title="恢复">
                            <ArchiveRestore className="h-4 w-4" />
                          </button>
                        ) : (
                          <>
                            <button onClick={() => startCorrection(memory)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#777b80] transition hover:bg-[#eef2ff] hover:text-[#3949a7]" title="纠正">
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button onClick={() => void controlMemory(memory, 'freeze', { reason: 'User froze this memory.' })} disabled={isActing} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#777b80] transition hover:bg-[#f1f1ef] hover:text-[#34373c]" title="冻结">
                              <Lock className="h-4 w-4" />
                            </button>
                            <button onClick={() => void controlMemory(memory, 'delete', { reason: 'User deleted this memory.' })} disabled={isActing} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#777b80] transition hover:bg-[#fff1f1] hover:text-[#b42318]" title="删除">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {memory.status !== 'deleted' ? (
                      <div className="mt-4 border-t border-[#f1f1ef] pt-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="text-xs font-medium text-[#777b80]">降权</label>
                          <input
                            type="range"
                            min={0.1}
                            max={0.8}
                            step={0.1}
                            value={downrankWeight}
                            onChange={(event) => setDownrankWeight(Number(event.target.value))}
                            className="w-32 accent-[#202124]"
                          />
                          <span className="w-10 text-xs text-[#96999d]">{Math.round(downrankWeight * 100)}%</span>
                          <button
                            onClick={() => void controlMemory(memory, 'downrank', {
                              reason: 'User downranked this memory.',
                              weightMultiplier: downrankWeight
                            })}
                            disabled={isActing}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-[#55585d] transition hover:bg-[#fff6e5] hover:text-[#8a5a00] disabled:opacity-50"
                          >
                            <Ban className="h-3.5 w-3.5" />
                            降低影响
                          </button>
                          {memory.status !== 'active' ? (
                            <button
                              onClick={() => void controlMemory(memory, 'restore', { reason: 'User restored this memory.' })}
                              disabled={isActing}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-[#55585d] transition hover:bg-[#edf7f2] hover:text-[#20694f] disabled:opacity-50"
                            >
                              <ArchiveRestore className="h-3.5 w-3.5" />
                              恢复默认
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="min-w-0 rounded-xl border border-[#e6e6e1] bg-white p-4 lg:sticky lg:top-4 lg:self-start">
          <h4 className="text-sm font-semibold text-[#202124]">为什么系统会这么认为</h4>
          {!selectedMemory ? (
            <p className="mt-3 text-sm leading-6 text-[#777b80]">
              选择某条状态的眼睛图标后，这里会展示证据、transition patch 和用户控制历史。解释会区分短期观察与稳定画像，而不是给用户贴固定标签。
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              <div>
                <p className="text-xs font-medium text-[#96999d]">{dimensionLabel(selectedMemory.dimension)}</p>
                <p className="mt-1 text-sm font-medium leading-6 text-[#34373c]">{selectedMemory.value}</p>
              </div>
              {explainLoading ? (
                <p className="inline-flex items-center gap-2 text-sm text-[#777b80]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在读取依据
                </p>
              ) : explain ? (
                <>
                  <div>
                    <p className="mb-2 text-xs font-semibold text-[#202124]">最近证据</p>
                    <div className="space-y-2">
                      {explain.evidence.length ? explain.evidence.slice(0, 5).map((item) => (
                        <div key={item.id} className="border-l border-[#deded9] pl-3">
                          <p className="text-sm font-medium text-[#34373c]">{item.title}</p>
                          <p className="text-xs leading-5 text-[#777b80]">{item.sourceType} · {Math.round(item.confidence * 100)}% · {formatDate(item.observedAt)}</p>
                          <p className="text-xs leading-5 text-[#777b80]">{item.summary}</p>
                        </div>
                      )) : <p className="text-sm text-[#777b80]">没有找到直接匹配证据，可能来自聚合后的学习状态。</p>}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold text-[#202124]">状态更新</p>
                    <div className="space-y-2">
                      {explain.patches.length ? explain.patches.slice(0, 5).map((patch) => (
                        <div key={patch.id} className="border-l border-[#deded9] pl-3">
                          <p className="text-xs leading-5 text-[#777b80]">{patch.status} · {patch.operation} · {Math.round(patch.confidence * 100)}%</p>
                          <p className="text-xs leading-5 text-[#666a70]">{patch.rationale}</p>
                        </div>
                      )) : <p className="text-sm text-[#777b80]">暂无 patch 记录。</p>}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold text-[#202124]">用户控制</p>
                    {explain.controls.length ? (
                      <div className="space-y-2">
                        {explain.controls.map((control) => (
                          <p key={control.id} className="text-xs leading-5 text-[#777b80]">
                            {control.action}
                            {control.correctedText ? ` · ${control.correctedText}` : ''}
                            {control.reason ? ` · ${control.reason}` : ''}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-[#777b80]">这条记忆还没有人工控制。</p>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
