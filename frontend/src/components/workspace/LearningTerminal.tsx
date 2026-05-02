import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  FolderUp,
  Loader2,
  Plus,
  Send,
  Target,
  Wand2
} from 'lucide-react';
import { LearningGoalDraft, LearningTerminalMessage, WorkbenchItem } from '../../types';
import { learningApi } from '../../services/learningApi';

interface LearningTerminalProps {
  workspaceId: string;
  workspaceName: string;
  major?: string;
  workbenches: WorkbenchItem[];
  fileCount: number;
  messages: LearningTerminalMessage[];
  onMessagesChange: (messages: LearningTerminalMessage[]) => void;
  onChatStarted: (title: string) => void;
  onUploadMaterials: () => void;
  onCreateWorkbench: () => void;
  onWorkbenchCreated: (workbenchId: string) => void;
  onRefresh: () => Promise<void> | void;
}

const starterPrompts = [
  '我想建立一个新的学习目标',
  '帮我总结当前进度',
  '根据已有资料推荐下一步',
  '创建一个项目实战学习现场'
];

export default function LearningTerminal({
  workspaceId,
  workspaceName,
  workbenches,
  messages,
  onMessagesChange,
  onChatStarted,
  onUploadMaterials,
  onCreateWorkbench,
  onWorkbenchCreated,
  onRefresh
}: LearningTerminalProps) {
  const [input, setInput] = useState('');
  const [goalDraft, setGoalDraft] = useState<LearningGoalDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latestWorkbench = workbenches[0];
  const overviewText = useMemo(() => {
    if (workbenches.length === 0) {
      return '还没有学习现场，可以先从一个明确目标开始。';
    }

    return `最近学习现场：${latestWorkbench.title}`;
  }, [latestWorkbench, workbenches.length]);

  const sendMessage = async (preset?: string) => {
    const content = (preset ?? input).trim();
    if (!content || loading) return;

    if (messages.length === 0) {
      onChatStarted(content);
    }

    const nextMessages: LearningTerminalMessage[] = [...messages, { role: 'user', content }];
    onMessagesChange(nextMessages);
    setInput('');
    setError(null);
    setLoading(true);

    try {
      const response = await learningApi.chatTerminal(workspaceId, nextMessages);
      setGoalDraft(response.goalDraft ?? null);
      onMessagesChange([
        ...nextMessages,
        {
          role: 'assistant',
          content: response.reply,
          goalDraft: response.goalDraft
        }
      ]);
    } catch (chatError: any) {
      setError(chatError?.response?.data?.error || chatError?.message || 'AI Terminal request failed');
    } finally {
      setLoading(false);
    }
  };

  const createGuidedWorkbench = async () => {
    const draft = goalDraft;
    const fallbackGoal = input.trim() || '建立一个新的启发式学习目标';
    setCreating(true);
    setError(null);

    try {
      const result = await learningApi.createGuidedWorkbench({
        workspaceId,
        goalText: draft?.goalText || fallbackGoal,
        title: draft?.title,
        mode: draft?.suggestedMode,
        goalDraft: draft || undefined
      });
      await onRefresh();
      onWorkbenchCreated(result.workbench.id);
    } catch (createError: any) {
      setError(createError?.response?.data?.error || createError?.message || 'Failed to create workbench');
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="workspace-terminal mx-auto flex min-h-full w-full max-w-5xl flex-col px-6 pb-8 pt-28">
      <div className="workspace-hero mx-auto mb-8 w-full max-w-3xl text-center">
        {messages.length === 0 ? (
          <>
            <h1 className="text-4xl font-semibold tracking-normal text-[#202124]">
              What should we build in {workspaceName}?
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-[#777b80]">
              {overviewText} 描述一个目标，或从下面的建议开始。
            </p>
          </>
        ) : (
          <h1 className="text-3xl font-semibold tracking-normal text-[#202124]">AI Terminal</h1>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
        {messages.length > 0 && (
        <div className="flex-1 space-y-5">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`workspace-message flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              style={{ animationDelay: `${Math.min(index * 45, 240)}ms` }}
            >
              <div
                className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                  message.role === 'user'
                    ? 'bg-[#202124] text-white'
                    : 'border border-[#e7e7e2] bg-white text-[#34373c]'
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 pl-11 text-sm text-[#777b80]">
              <Loader2 className="h-4 w-4 animate-spin" />
              AI Terminal 正在整理目标草案...
            </div>
          )}

          {goalDraft && (
            <div className="workspace-card-in ml-11 rounded-2xl border border-[#e2e2de] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Target className="h-4 w-4 text-[#1683ff]" />
                  <h3 className="truncate text-sm font-semibold text-[#202124]">{goalDraft.title}</h3>
                </div>
                <button
                  onClick={() => void createGuidedWorkbench()}
                  disabled={creating}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  创建学习现场
                </button>
              </div>
              <p className="text-sm leading-6 text-[#55585d]">{goalDraft.goalText}</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-medium text-[#96999d]">技能拆解</p>
                  <div className="space-y-1.5">
                    {goalDraft.skills.map((skill) => (
                      <div key={skill} className="flex items-center gap-2 text-sm text-[#34373c]">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span>{skill}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-[#96999d]">初始短板</p>
                  <div className="space-y-1.5">
                    {goalDraft.weaknesses.map((weakness) => (
                      <div key={weakness} className="text-sm text-[#55585d]">
                        {weakness}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        <div className={`${messages.length > 0 ? 'sticky bottom-0 mt-8 bg-gradient-to-t from-[#fbfbfa] via-[#fbfbfa] to-transparent pt-10' : 'mt-2'} pb-6`}>
          <div className="mx-auto w-full max-w-3xl">
            {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

            <div className="workspace-composer rounded-[26px] border border-[#deded9] bg-white p-3 shadow-[0_18px_60px_rgba(0,0,0,0.10)] focus-within:border-[#c8c8c2]">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                className="min-h-[58px] w-full resize-none bg-transparent px-1 py-2 text-[15px] leading-6 text-[#202124] outline-none placeholder:text-[#b9babd]"
                placeholder="Ask anything. Describe a goal, mention files, or create the next workbench..."
                rows={2}
              />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-[#8a8d91]">
                  <button
                    onClick={onUploadMaterials}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#f1f1ef] px-2.5 py-1 text-[#666a70] transition hover:bg-[#e9e9e5] hover:text-[#202124]"
                  >
                    <FolderUp className="h-3.5 w-3.5" />
                    Upload files
                  </button>
                  <button
                    onClick={onCreateWorkbench}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#f1f1ef] px-2.5 py-1 text-[#666a70] transition hover:bg-[#e9e9e5] hover:text-[#202124]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New workbench
                  </button>
                </div>
                <button
                  onClick={() => void sendMessage()}
                  disabled={!input.trim() || loading}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#858585] text-white transition hover:bg-[#202124] disabled:cursor-not-allowed disabled:opacity-45"
                  title="Send"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>

            {messages.length === 0 && (
              <div className="mx-auto mt-8 max-w-xl">
                <p className="mb-4 text-sm font-medium text-[#777b80]">Suggested</p>
                <div className="space-y-4">
                  {starterPrompts.map((prompt, index) => (
                    <button
                      key={prompt}
                      onClick={() => void sendMessage(prompt)}
                      className="workspace-suggestion block w-full rounded-xl px-3 py-2 text-left transition hover:bg-[#f6f6f4]"
                      style={{ animationDelay: `${index * 70 + 120}ms` }}
                    >
                      <span className="block text-sm font-semibold text-[#34373c]">{prompt}</span>
                      <span className="mt-0.5 block text-xs text-[#8a8d91]">
                        {index === 0
                          ? '从目标开始创建一条可持续的学习路线'
                          : index === 1
                            ? '整理已有 workbench 与资源的状态'
                            : index === 2
                              ? '根据当前文件生成下一步行动'
                              : '创建一个带资源和助教的任务现场'}
                      </span>
                    </button>
                  ))}
                  <button
                    onClick={() => void sendMessage('帮我总结当前进度')}
                    className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-[#34373c] transition hover:bg-[#f6f6f4]"
                  >
                    总结当前进度
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
