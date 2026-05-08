import { useEffect, useState } from 'react';
import { ArchiveRestore, Check, Loader2, Plus, RefreshCw, Save, Sparkles, Trash2, X } from 'lucide-react';
import { learningApi } from '../../services/learningApi';

interface SavedMemory {
  id: string;
  memoryKey: string;
  text: string;
  category: string;
  source: string;
  confidence: number;
  status: string;
  updatedAt: string;
}

interface MemoryCandidate {
  id: string;
  text: string;
  category: string;
  confidence: number;
  reason: string;
  askUserToSaveText: string;
  observedAt: string;
}

export default function SavedMemoryCenter({ workspaceId, workbenchId }: { workspaceId: string; workbenchId?: string }) {
  const [memories, setMemories] = useState<SavedMemory[]>([]);
  const [newText, setNewText] = useState('');
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actingCandidateId, setActingCandidateId] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await learningApi.listSavedMemories(workspaceId, { includeDeleted: true, limit: 40 });
      const candidateResult = await learningApi.listMemoryCandidates(workspaceId, { limit: 6 });
      setMemories(Array.isArray(result.memories) ? result.memories : []);
      setCandidates(Array.isArray(candidateResult.candidates) ? candidateResult.candidates : []);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '加载 Saved Memories 失败');
    } finally {
      setLoading(false);
    }
  };

  const decideCandidate = async (candidate: MemoryCandidate, decision: 'save' | 'dismiss') => {
    setActingCandidateId(candidate.id);
    setError(null);
    try {
      await learningApi.decideMemoryCandidate(workspaceId, candidate.id, {
        workbenchId,
        decision,
        text: candidate.text,
        category: candidate.category
      });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '处理候选记忆失败');
    } finally {
      setActingCandidateId(null);
    }
  };

  useEffect(() => {
    void load();
  }, [workspaceId]);

  const create = async () => {
    const text = newText.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(null);
    try {
      await learningApi.createSavedMemory({ workspaceId, workbenchId, text });
      setNewText('');
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '保存 memory 失败');
    } finally {
      setSaving(false);
    }
  };

  const update = async (memory: SavedMemory) => {
    const text = editingText.trim();
    if (!text) return;
    setSaving(true);
    try {
      await learningApi.updateSavedMemory(workspaceId, memory.memoryKey, { text, category: memory.category });
      setEditingKey(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '更新 memory 失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (memory: SavedMemory) => {
    setSaving(true);
    try {
      await learningApi.deleteSavedMemory(workspaceId, memory.memoryKey);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '删除 memory 失败');
    } finally {
      setSaving(false);
    }
  };

  const restore = async (memory: SavedMemory) => {
    setSaving(true);
    try {
      await learningApi.updateSavedMemory(workspaceId, memory.memoryKey, { action: 'restore' });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '恢复 memory 失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-10 border-t border-[#eeeeeb] pt-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#edf7f2] px-3 py-1 text-xs font-medium text-[#20694f]">
            <Save className="h-3.5 w-3.5" />
            Saved memories
          </div>
          <h3 className="text-2xl font-semibold tracking-normal text-[#202124]">长期记忆</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#666a70]">
            这里只放用户明确要求记住、手动保存或长期稳定的信息。普通问题和单次格式要求会留在历史检索或学习状态里，不会默认变成长期记忆。
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef] disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新
        </button>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      {candidates.length ? (
        <div className="mb-4 rounded-xl border border-[#dbe7ff] bg-[#f8fbff] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#315fba]" />
            <p className="text-sm font-semibold text-[#202124]">需要你确认后才会保存</p>
          </div>
          <div className="space-y-3">
            {candidates.map((candidate) => {
              const acting = actingCandidateId === candidate.id;
              return (
                <div key={candidate.id} className="rounded-lg border border-[#e2e9f8] bg-white p-3">
                  <p className="text-sm leading-6 text-[#34373c]">{candidate.askUserToSaveText || candidate.text}</p>
                  <p className="mt-1 text-xs leading-5 text-[#777b80]">
                    {candidate.reason} · {Math.round(candidate.confidence * 100)}% confidence
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => void decideCandidate(candidate, 'save')}
                      disabled={acting}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#202124] px-3 text-xs font-medium text-white transition hover:bg-black disabled:opacity-50"
                    >
                      {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      保存为长期记忆
                    </button>
                    <button
                      onClick={() => void decideCandidate(candidate, 'dismiss')}
                      disabled={acting}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-[#55585d] transition hover:bg-[#f1f1ef] disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      不用保存
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-[#e6e6e1] bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={newText}
            onChange={(event) => setNewText(event.target.value)}
            className="h-10 min-w-0 flex-1 rounded-lg border border-[#deded9] bg-[#fbfbfa] px-3 text-sm text-[#202124] outline-none transition focus:border-[#b9bab2] focus:bg-white"
            placeholder="例如：用户偏好用具体例子理解抽象概念"
          />
          <button
            onClick={() => void create()}
            disabled={saving || !newText.trim()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#202124] px-4 text-sm font-medium text-white transition hover:bg-black disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            保存
          </button>
        </div>

        <div className="mt-4 divide-y divide-[#eeeeeb]">
          {loading ? (
            <p className="py-5 text-sm text-[#777b80]">正在读取长期记忆...</p>
          ) : memories.length === 0 ? (
            <p className="py-5 text-sm text-[#777b80]">暂无长期记忆。用户说“请记住...”后会自动出现在这里。</p>
          ) : (
            memories.map((memory) => {
              const isEditing = editingKey === memory.memoryKey;
              return (
                <div key={memory.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[#f6f6f4] px-2 py-0.5 text-xs font-medium text-[#666a70]">{memory.category}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${memory.status === 'deleted' ? 'bg-[#fff1f1] text-[#b42318]' : 'bg-[#edf7f2] text-[#20694f]'}`}>
                          {memory.status}
                        </span>
                        <span className="text-xs text-[#96999d]">{Math.round(memory.confidence * 100)}% · {memory.source}</span>
                      </div>
                      {isEditing ? (
                        <input
                          value={editingText}
                          onChange={(event) => setEditingText(event.target.value)}
                          className="h-10 w-full rounded-lg border border-[#deded9] bg-[#fbfbfa] px-3 text-sm text-[#202124] outline-none transition focus:border-[#b9bab2] focus:bg-white"
                        />
                      ) : (
                        <p className={`text-sm leading-6 ${memory.status === 'deleted' ? 'text-[#96999d] line-through' : 'text-[#34373c]'}`}>
                          {memory.text}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {isEditing ? (
                        <button onClick={() => void update(memory)} className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium text-[#20694f] transition hover:bg-[#edf7f2]">
                          保存修改
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingKey(memory.memoryKey);
                            setEditingText(memory.text);
                          }}
                          className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium text-[#55585d] transition hover:bg-[#f1f1ef]"
                        >
                          编辑
                        </button>
                      )}
                      {memory.status === 'deleted' ? (
                        <button onClick={() => void restore(memory)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#777b80] transition hover:bg-[#edf7f2] hover:text-[#20694f]" title="恢复">
                          <ArchiveRestore className="h-4 w-4" />
                        </button>
                      ) : (
                        <button onClick={() => void remove(memory)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#777b80] transition hover:bg-[#fff1f1] hover:text-[#b42318]" title="删除">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
