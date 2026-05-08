import {
  ArrowLeft,
  BarChart3,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  HelpCircle,
  Layers3,
  Loader2,
  Maximize2,
  Orbit,
  Pencil,
  Play,
  RefreshCw,
  Send,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  SplitSquareHorizontal,
  Table2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { ComponentType, useEffect, useMemo, useRef, useState } from 'react';
import { Graph } from '@antv/x6';
import ELK, { ElkNode } from 'elkjs/lib/elk.bundled.js';
import ForceGraph3D, { ForceGraphMethods, GraphData, LinkObject, NodeObject } from 'react-force-graph-3d';
import MindElixir, { MindElixirData, MindElixirInstance, NodeObj } from 'mind-elixir';
import 'mind-elixir/style.css';
import SpriteText from 'three-spritetext';
import {
  aiApi,
  AiChatContext,
  AiChatMessage,
  AiContextMode,
  AiStudioResourceType,
  AiUsedContextSummary,
  FlashcardCard,
  FlashcardDeck,
  FlashcardRating
} from '../../services/aiApi';
import { EditorState } from '../../types';
import MarkdownPreview from './MarkdownPreview';

interface AIStudioPanelProps {
  editor: EditorState;
  workspaceId: string;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
}

type StudioModalState = {
  resourceType: AiStudioResourceType;
  format: string;
  language: string;
  amount: 'fewer' | 'standard' | 'more';
  difficulty: 'easy' | 'medium' | 'hard' | 'adaptive';
  length: 'short' | 'default';
  orientation: 'landscape' | 'portrait' | 'square';
  detail: 'concise' | 'standard' | 'detailed';
  visualStyle: string;
  topic: string;
};

interface StudioResult {
  id: string;
  name: string;
  path: string;
  resourceType: AiStudioResourceType;
  content: string;
  createdAt: string;
  runId: string;
  flashcardDeck?: FlashcardDeck | null;
  summary?: AiUsedContextSummary;
  qualityReport?: {
    score?: number;
    keptCount?: number;
    removedCount?: number;
    warnings?: string[];
    issues?: Array<{ questionId: string; severity: string; code: string; message: string }>;
  };
}

type QuizQuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'short_answer'
  | 'error_analysis'
  | 'application'
  | 'coding_calculation';

interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  question: string;
  options: string[];
  answer: string;
  rubric: string;
  skill: string;
  difficulty: 'easy' | 'medium' | 'hard';
  source?: string;
  explanation?: string;
  hint?: string;
  choiceFeedback?: Partial<Record<'A' | 'B' | 'C' | 'D', string>>;
  knowledgePoints?: string[];
  learningObjective?: string;
  commonMistake?: string;
  sourceRefs?: Array<{ title: string; snippet: string }>;
}

interface MockQuizPayload {
  id: string;
  title: string;
  sourceCount: number;
  difficulty: string;
  questionCount: number;
  questionTypes: string[];
  generatedAt: string;
  questions: Array<{
    id: string;
    type: string;
    difficulty: string;
    stem: string;
    options?: Array<{ key: string; text: string }>;
    answer: string;
    explanation: string;
    knowledgePoints: string[];
    learningObjective: string;
    commonMistake: string;
    sourceRefs: Array<{ title: string; snippet: string }>;
  }>;
}

interface QuizAttempt {
  answer: string;
  submitted: boolean;
  skipped: boolean;
  correct: boolean;
  score: number;
  feedback: string;
  correctAnswer?: string;
  selectedOptionId?: string;
  missingPoints?: string[];
  matchedPoints?: string[];
  judgedBy?: string;
}

interface ConceptGraphNode {
  id: string;
  label: string;
  group?: string;
  importance?: number;
  summary?: string;
  sourceRefs?: string[];
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
  [key: string]: unknown;
}

interface ConceptGraphLink {
  source: string;
  target: string;
  label?: string;
  type?: string;
  weight?: number;
  [key: string]: unknown;
}

interface ConceptGraphPayload {
  nodes: ConceptGraphNode[];
  links: ConceptGraphLink[];
}

const isConceptGraphNode = (value: ConceptGraphNode | ConceptGraphLink | null): value is ConceptGraphNode =>
  Boolean(value && 'id' in value && 'label' in value);

interface QuizAssistantState {
  input: string;
  loading: boolean;
  messages: AiChatMessage[];
  issueType?: 'question_quality' | 'answer_quality' | 'needs_clarification' | 'none';
}

const optionIdOf = (value: string) => value.match(/[A-D]/)?.[0]?.toUpperCase() || '';

const studioCards: Array<{
  type: AiStudioResourceType | 'audio' | 'video' | 'infographic';
  label: string;
  disabled?: boolean;
  icon: ComponentType<{ className?: string }>;
}> = [
  { type: 'audio', label: 'Audio Overview', disabled: true, icon: Sparkles },
  { type: 'slide_deck', label: 'Slide Deck', icon: SplitSquareHorizontal },
  { type: 'video', label: 'Video Overview', disabled: true, icon: Play },
  { type: 'mind_map', label: 'Mind Map', icon: SlidersHorizontal },
  { type: 'report', label: 'Reports', icon: FileText },
  { type: 'flashcards', label: 'Flashcards', icon: Layers3 },
  { type: 'quiz', label: 'Quiz', icon: HelpCircle },
  { type: 'infographic', label: 'Infographic', disabled: true, icon: BarChart3 },
  { type: 'data_table', label: 'Data Table', icon: Table2 }
];

const defaultModalState = (resourceType: AiStudioResourceType): StudioModalState => ({
  resourceType,
  format:
    resourceType === 'slide_deck'
      ? 'detailed_deck'
      : resourceType === 'report'
        ? 'study_guide'
        : 'standard',
  language: '简体中文',
  amount: 'standard',
  difficulty: 'medium',
  length: 'default',
  orientation: 'landscape',
  detail: 'standard',
  visualStyle: 'auto',
  topic: ''
});

const resultTitle = (type: AiStudioResourceType) => {
  if (type === 'slide_deck') return 'Slide Deck';
  if (type === 'mind_map') return 'Mind Map';
  if (type === 'flashcards') return 'Flashcards';
  if (type === 'quiz') return 'Quiz';
  if (type === 'data_table') return 'Data Table';
  return 'Report';
};

function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full bg-[#f1f1ef] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
            value === option.value
              ? 'bg-white text-[#202124] shadow-sm'
              : 'text-[#777a80] hover:bg-white'
          }`}
        >
          {value === option.value && <Check className="h-3.5 w-3.5" />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function OptionCard({
  title,
  description,
  selected,
  onClick
}: {
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative rounded-xl border p-3 text-left transition ${
        selected ? 'border-[#202124] bg-white' : 'border-[#eeeeeb] bg-[#fbfbfa] hover:bg-white'
      }`}
    >
      {selected && (
        <span className="absolute right-3 top-3 rounded-full bg-[#202124] p-1 text-white">
          <Check className="h-3 w-3" />
        </span>
      )}
      <div className="pr-7 text-sm font-semibold text-[#202124]">{title}</div>
      <div className="mt-1 text-xs leading-5 text-[#777a80]">{description}</div>
    </button>
  );
}

const quizQuestionTypeLabel = (type: string) => {
  if (type === 'single_choice') return '单选题';
  if (type === 'multiple_choice') return '多选题';
  if (type === 'true_false') return '判断题';
  if (type === 'fill_blank') return '填空题';
  if (type === 'error_analysis') return '错因分析题';
  if (type === 'application') return '应用题';
  if (type === 'coding_calculation') return '代码/计算题';
  if (type === 'multiple_choice_legacy') return '选择题';
  return '简答题';
};

const quizQuestionTypeLabels = (types?: string[]) => (types || ['mixed']).map((type) => quizQuestionTypeLabel(type)).join('、');

const isChoiceQuestion = (type: QuizQuestionType) =>
  type === 'single_choice' || type === 'multiple_choice' || type === 'true_false';

const labelFor = (options: string[][], value: string) => options.find((option) => option[0] === value)?.[1] || value;

const amountToCount = (amount: StudioModalState['amount']) => {
  if (amount === 'fewer') return 5;
  if (amount === 'more') return 20;
  return 10;
};

const buildQuizGenerationRequest = (modal: StudioModalState, workspaceId: string, workbenchId?: string) => ({
  course_id: workspaceId,
  task_id: workbenchId || null,
  number_mode: modal.amount,
  question_count: amountToCount(modal.amount),
  difficulty: modal.difficulty,
  user_prompt: modal.topic
});

function QuizCustomizeContent({
  state,
  setState
}: {
  state: StudioModalState;
  setState: (patch: Partial<StudioModalState>) => void;
}) {
  return (
    <div className="space-y-4">
      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#96999d]">Number of Questions</div>
        <SegmentedControl
          value={state.amount}
          onChange={(amount) => setState({ amount })}
          options={[
            { value: 'fewer', label: '较少 · 5' },
            { value: 'standard', label: '标准 · 10' },
            { value: 'more', label: '更多 · 20' }
          ]}
        />
      </section>

      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#96999d]">Level of Difficulty</div>
        <SegmentedControl
          value={state.difficulty}
          onChange={(difficulty) => setState({ difficulty })}
          options={[
            { value: 'easy', label: '简单' },
            { value: 'medium', label: '中等' },
            { value: 'hard', label: '困难' },
            { value: 'adaptive', label: '自适应' }
          ]}
        />
      </section>

      <section>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[#96999d]">
          让 AI 理解你的出题要求
        </label>
        <textarea
          value={state.topic}
          onChange={(event) => setState({ topic: event.target.value })}
          rows={8}
          className="w-full resize-none rounded-xl border border-[#d8d8d2] bg-white px-3 py-2.5 text-sm leading-6 text-[#202124] outline-none focus:border-[#202124]"
          placeholder={'例如：\n- 根据当前资料出 1 道填空题\n- 只围绕这节课最容易错的点\n- 不要选择题，要简答题\n- 题目必须来自老师讲义，不要超纲\n- 每道题都要有提示和解释'}
        />
      </section>
    </div>
  );
}

function buildPrompt(modal: StudioModalState) {
  if (modal.resourceType === 'quiz') {
    return [
      modal.topic.trim() || '根据当前资料生成测验',
      `题量偏好：${amountToCount(modal.amount)} 题`,
      `难度偏好：${labelFor([['easy', '简单'], ['medium', '中等'], ['hard', '困难'], ['adaptive', '自适应']], modal.difficulty)}`
    ].join('\n');
  }

  const parts = [
    modal.topic,
    `语言：${modal.language}`,
    `格式：${modal.format}`,
    `数量：${modal.amount}`,
    `难度：${modal.difficulty}`,
    `长度：${modal.length}`,
    `细节：${modal.detail}`,
  ];
  return parts.filter(Boolean).join('\n');
}

function CustomizeModal({
  state,
  setState,
  onClose,
  onGenerate,
  generating
}: {
  state: StudioModalState;
  setState: (patch: Partial<StudioModalState>) => void;
  onClose: () => void;
  onGenerate: () => void;
  generating: boolean;
}) {
  const title = `Customize ${resultTitle(state.resourceType)}`;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-3 backdrop-blur-[1px]">
      <div className={`flex max-h-[84vh] ${state.resourceType === 'quiz' ? 'w-[min(980px,95vw)]' : 'w-[min(680px,95vw)]'} flex-col overflow-hidden rounded-2xl border border-[#e5e5e1] bg-white shadow-[0_18px_60px_rgba(0,0,0,0.14)]`}>
        <div className="flex min-h-12 items-center justify-between gap-4 border-b border-[#eeeeeb] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-xl bg-[#f1f1ef] p-2 text-[#777a80]">
              <Sparkles className="h-4 w-4" />
            </div>
            <h2 className="truncate text-base font-semibold tracking-normal text-[#202124]">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#777a80] transition hover:bg-[#f6f6f4] hover:text-[#202124]"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-[260px] flex-1 overflow-auto px-4 py-3.5">
          {state.resourceType === 'quiz' ? (
            <QuizCustomizeContent state={state} setState={setState} />
          ) : (state.resourceType === 'slide_deck' || state.resourceType === 'report') && (
            <div className="space-y-4">
              <section>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#96999d]">Format</div>
                <div className={`grid gap-2 ${state.resourceType === 'report' ? 'md:grid-cols-4' : 'md:grid-cols-2'}`}>
                  {state.resourceType === 'slide_deck' ? (
                    <>
                      <OptionCard
                        title="Detailed Deck"
                        description="More explanatory slides with enough detail for self-study."
                        selected={state.format === 'detailed_deck'}
                        onClick={() => setState({ format: 'detailed_deck' })}
                      />
                      <OptionCard
                        title="Presenter Slides"
                        description="Concise slides with speaker notes for presentation."
                        selected={state.format === 'presenter_slides'}
                        onClick={() => setState({ format: 'presenter_slides' })}
                      />
                    </>
                  ) : (
                    [
                      ['custom', 'Create Your Own', 'Use your brief as the report structure.'],
                      ['briefing_doc', 'Briefing Doc', 'Executive summary and key evidence.'],
                      ['study_guide', 'Study Guide', 'Learning-focused guide and review path.'],
                      ['blog_post', 'Blog Post', 'Readable narrative explanation.']
                    ].map(([value, label, description]) => (
                      <OptionCard
                        key={value}
                        title={label}
                        description={description}
                        selected={state.format === value}
                        onClick={() => setState({ format: value })}
                      />
                    ))
                  )}
                </div>
              </section>
              {state.resourceType === 'report' && (
                <section>
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#96999d]">
                    <Sparkles className="h-3.5 w-3.5" />
                    Suggested Format
                  </div>
                  <div className="grid gap-2 md:grid-cols-4">
                    {[
                      ['technical_spec', 'Technical Specification'],
                      ['verification_plan', 'Verification Plan'],
                      ['procedure', 'Procedural Guide'],
                      ['error_analysis', 'Error Analysis Guide']
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setState({ format: value })}
                        className={`rounded-xl border p-3 text-left transition ${
                          state.format === value ? 'border-[#202124] bg-white' : 'border-[#eeeeeb] bg-[#fbfbfa] hover:bg-white'
                        }`}
                      >
                        <div className="mb-3 flex justify-end text-[#96999d]">
                          <Pencil className="h-4 w-4" />
                        </div>
                        <div className="text-xs font-semibold text-[#202124]">{label}</div>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {state.resourceType === 'flashcards' && (
            <div className="space-y-4">
              <section>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#96999d]">Number of Cards</div>
                <SegmentedControl
                  value={state.amount}
                  onChange={(amount) => setState({ amount })}
                  options={[
                    { value: 'fewer', label: 'Fewer' },
                    { value: 'standard', label: 'Standard' },
                    { value: 'more', label: 'More' }
                  ]}
                />
              </section>
              <section>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#96999d]">Level of Difficulty</div>
                <SegmentedControl
                  value={state.difficulty}
                  onChange={(difficulty) => setState({ difficulty })}
                  options={[
                    { value: 'easy', label: 'Easy' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'hard', label: 'Hard' }
                  ]}
                />
              </section>
            </div>
          )}

          {state.resourceType === 'data_table' && (
            <div className="mb-4">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[#96999d]">Choose language</label>
              <select
                value={state.language}
                onChange={(event) => setState({ language: event.target.value })}
                className="h-9 w-56 rounded-xl border border-[#e5e5e1] bg-white px-3 text-sm outline-none"
              >
                <option>简体中文</option>
                <option>English</option>
              </select>
            </div>
          )}

          {state.resourceType !== 'report' && state.resourceType !== 'quiz' && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[#96999d]">Choose language</label>
                <select
                  value={state.language}
                  onChange={(event) => setState({ language: event.target.value })}
                  className="h-9 w-full rounded-xl border border-[#e5e5e1] bg-white px-3 text-sm outline-none"
                >
                  <option>简体中文</option>
                  <option>English</option>
                </select>
              </div>
              {state.resourceType === 'slide_deck' && (
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[#96999d]">Length</label>
                  <SegmentedControl
                    value={state.length}
                    onChange={(length) => setState({ length })}
                    options={[
                      { value: 'short', label: 'Short' },
                      { value: 'default', label: 'Default' }
                    ]}
                  />
                </div>
              )}
            </div>
          )}

          {state.resourceType !== 'quiz' && <section className="mt-4">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[#96999d]">
              {state.resourceType === 'data_table'
                ? 'Describe the data table you want to create'
                : state.resourceType === 'slide_deck'
                  ? 'Describe your slide deck'
                  : 'What should the topic be?'}
            </label>
            <textarea
              value={state.topic}
              onChange={(event) => setState({ topic: event.target.value })}
              rows={5}
              className="w-full resize-none rounded-xl border border-[#e5e5e1] bg-white px-3 py-2 text-sm leading-6 text-[#202124] outline-none focus:border-[#c8c8c2]"
              placeholder={
                state.resourceType === 'flashcards'
                  ? 'Things to try\n- Restrict flashcards to a specific source\n- Focus on a specific topic\n- Keep fronts short for memorization'
                  : 'Describe what you want to generate from the current sources...'
              }
            />
          </section>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#eeeeeb] px-4 py-2.5">
          <div className="hidden text-xs text-[#777a80] sm:block">
            {state.resourceType === 'quiz' ? '测验将基于当前课程资料和你的设置生成。' : ''}
          </div>
          <div className="flex items-center gap-2">
          {state.resourceType === 'quiz' && (
            <button
              disabled={generating}
              onClick={onClose}
              className="rounded-full px-4 py-2 text-sm font-medium text-[#6f7277] transition hover:bg-[#f6f6f4] disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            disabled={generating}
            onClick={onGenerate}
            className="inline-flex min-w-[118px] items-center justify-center gap-2 rounded-full bg-[#202124] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#34373c] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating && <Loader2 className="h-4 w-4 animate-spin" />}
            {generating ? 'Generating...' : 'Generate'}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const splitSlides = (content: string) =>
  content
    .split(/\n---+\n/g)
    .map((slide) => slide.trim())
    .filter(Boolean);

const parseFlashcards = (content: string) => {
  const chunks = content.split(/\n(?=#+\s|Front\s*:|Q\s*:)/i).map((item) => item.trim()).filter(Boolean);
  const cards = chunks
    .map((chunk, index) => {
      const front = chunk.match(/Front\s*:\s*([\s\S]*?)(?:\nBack\s*:|$)/i)?.[1]?.trim();
      const back = chunk.match(/Back\s*:\s*([\s\S]*?)(?:\nSource\s*:|$)/i)?.[1]?.trim();
      if (front || back) return { front: front || `Card ${index + 1}`, back: back || chunk };
      const lines = chunk.split('\n').filter(Boolean);
      return { front: lines[0]?.replace(/^#+\s*/, '') || `Card ${index + 1}`, back: lines.slice(1).join('\n') || chunk };
    })
    .slice(0, 50);
  return cards.length ? cards : [{ front: 'Generated flashcard', back: content || 'No content generated.' }];
};

function FlashcardViewer({ result }: { result: StudioResult }) {
  if (result.flashcardDeck?.cards?.length) {
    return <FlashcardDeckViewer deck={result.flashcardDeck} workspaceId={result.flashcardDeck.workspaceId} />;
  }

  const cards = useMemo(() => parseFlashcards(result.content), [result.content]);
  const [index, setIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const card = cards[index];

  const move = (delta: number) => {
    setIndex((current) => Math.max(0, Math.min(cards.length - 1, current + delta)));
    setShowAnswer(false);
  };

  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-4 py-5">
      <div className="relative flex h-[min(360px,50vh)] w-[min(560px,100%)] flex-col rounded-2xl bg-[#202124] p-5 text-white shadow-[0_14px_42px_rgba(0,0,0,0.16)]">
        <div className="text-xs text-white/65">{index + 1} / {cards.length}</div>
        <div className="flex flex-1 items-center justify-center text-center text-xl font-semibold leading-normal">
          {showAnswer ? card.back : card.front}
        </div>
        <button
          onClick={() => setShowAnswer((value) => !value)}
          className="mx-auto rounded-full border border-white/25 px-5 py-2 text-sm font-medium text-white/90 hover:bg-white/10"
        >
          {showAnswer ? 'See question' : 'See answer'}
        </button>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button onClick={() => move(-1)} className="rounded-full border border-[#e5e5e1] bg-white p-2 text-[#202124]">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button className="rounded-full border border-[#e5e5e1] bg-white px-4 py-2 text-sm font-semibold text-red-600">
          <X className="mr-1 inline h-4 w-4" /> 0
        </button>
        <button className="rounded-full border border-[#e5e5e1] bg-white px-4 py-2 text-sm font-semibold text-green-700">
          <Check className="mr-1 inline h-4 w-4" /> 0
        </button>
        <button onClick={() => move(1)} className="rounded-full border border-[#e5e5e1] bg-white p-2 text-[#202124]">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

const ratingConfig: Array<{ rating: FlashcardRating; label: string; hint: string; className: string }> = [
  { rating: 'again', label: 'Again', hint: '< 10 min', className: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' },
  { rating: 'hard', label: 'Hard', hint: 'short', className: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100' },
  { rating: 'good', label: 'Good', hint: 'normal', className: 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' },
  { rating: 'easy', label: 'Easy', hint: 'long', className: 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100' }
];

const formatDue = (value: string) => {
  const due = new Date(value);
  const diffMs = due.getTime() - Date.now();
  if (diffMs <= 0) return 'due now';
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 90) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
};

function FlashcardDeckViewer({ deck, workspaceId }: { deck: FlashcardDeck; workspaceId: string }) {
  const [cards, setCards] = useState<FlashcardCard[]>(deck.cards || []);
  const [index, setIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loadingRating, setLoadingRating] = useState<FlashcardRating | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef(Date.now());
  const card = cards[index];
  const reviewedCount = cards.filter((item) => item.reviewCount > 0).length;
  const dueCount = cards.filter((item) => new Date(item.dueAt).getTime() <= Date.now()).length;

  useEffect(() => {
    startedAtRef.current = Date.now();
    setShowAnswer(false);
    setExplanation(null);
    setError(null);
  }, [card?.id]);

  const move = (delta: number) => {
    setIndex((current) => Math.max(0, Math.min(cards.length - 1, current + delta)));
  };

  const rate = async (rating: FlashcardRating) => {
    if (!card || loadingRating) return;
    setLoadingRating(rating);
    setError(null);
    try {
      const response = await aiApi.reviewFlashcard({
        workspaceId,
        cardId: card.id,
        rating,
        elapsedMs: Date.now() - startedAtRef.current,
        metadata: { deckId: deck.id, source: 'ai_studio_panel' }
      });
      setCards((current) => current.map((item) => (item.id === card.id ? response.card : item)));
      setShowAnswer(false);
      setExplanation(null);
      if (index < cards.length - 1) {
        setIndex(index + 1);
      }
    } catch (reviewError: any) {
      setError(reviewError?.response?.data?.error || reviewError?.message || 'Review failed');
    } finally {
      setLoadingRating(null);
    }
  };

  const explain = async () => {
    if (!card || explaining) return;
    setExplaining(true);
    setError(null);
    try {
      const response = await aiApi.explainFlashcard({ workspaceId, cardId: card.id });
      setExplanation(response.reply);
    } catch (explainError: any) {
      setError(explainError?.response?.data?.error || explainError?.message || 'Explain failed');
    } finally {
      setExplaining(false);
    }
  };

  if (!card) {
    return <div className="p-5 text-sm text-[#6f7277]">No cards in this deck.</div>;
  }

  return (
    <div className="flex min-h-[520px] flex-col bg-[#fbfbfa]">
      <div className="border-b border-[#eeeeeb] bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[#202124]">{deck.title}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-[#777a80]">
              <span>{cards.length} cards</span>
              <span>{dueCount} due</span>
              <span>{reviewedCount} reviewed</span>
              <span>FSRS-style scheduling</span>
            </div>
          </div>
          <div className="rounded-full border border-[#e5e5e1] bg-[#fbfbfa] px-3 py-1 text-xs font-medium text-[#6f7277]">
            {index + 1} / {cards.length}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-4 py-5">
        <div className="grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-h-[360px] flex-col rounded-2xl bg-[#202124] p-5 text-white shadow-[0_14px_42px_rgba(0,0,0,0.16)]">
            <div className="flex items-center justify-between gap-3 text-xs text-white/65">
              <span>{card.concept || card.cardType}</span>
              <span>{card.difficulty} · {card.state} · due {formatDue(card.dueAt)}</span>
            </div>
            <div className="flex flex-1 items-center justify-center text-center text-xl font-semibold leading-normal">
              {showAnswer ? card.back : card.front}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={() => setShowAnswer((value) => !value)}
                className="rounded-full border border-white/25 px-5 py-2 text-sm font-medium text-white/90 hover:bg-white/10"
              >
                {showAnswer ? 'See question' : 'See answer'}
              </button>
              <button
                onClick={explain}
                disabled={explaining}
                className="inline-flex items-center gap-2 rounded-full border border-white/25 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10 disabled:opacity-60"
              >
                {explaining && <Loader2 className="h-4 w-4 animate-spin" />}
                Explain
              </button>
            </div>
          </div>

          <aside className="rounded-2xl border border-[#e5e5e1] bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#96999d]">Sources</div>
            <div className="mt-3 space-y-3">
              {(card.sourceRefs || []).slice(0, 3).map((ref, refIndex) => (
                <div key={`${ref.sourceId || ref.title || refIndex}`} className="rounded-xl border border-[#eeeeeb] bg-[#fbfbfa] p-3">
                  <div className="text-xs font-semibold text-[#202124]">{ref.sourceId || ref.title || ref.fileName || `Source ${refIndex + 1}`}</div>
                  {ref.snippet && <div className="mt-1 line-clamp-4 text-xs leading-5 text-[#6f7277]">{ref.snippet}</div>}
                </div>
              ))}
              {!card.sourceRefs?.length && <div className="text-sm text-[#777a80]">No card-level source refs.</div>}
            </div>
            {explanation && (
              <div className="mt-4 rounded-xl border border-[#dbeafe] bg-[#eff6ff] p-3 text-sm leading-6 text-[#1e3a8a]">
                {explanation}
              </div>
            )}
          </aside>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button onClick={() => move(-1)} className="rounded-full border border-[#e5e5e1] bg-white p-2 text-[#202124]">
            <ChevronLeft className="h-5 w-5" />
          </button>
          {ratingConfig.map((item) => (
            <button
              key={item.rating}
              onClick={() => void rate(item.rating)}
              disabled={Boolean(loadingRating)}
              className={`min-w-[92px] rounded-full border px-4 py-2 text-sm font-semibold transition disabled:opacity-60 ${item.className}`}
            >
              {loadingRating === item.rating ? 'Saving...' : item.label}
              <span className="ml-1 text-xs opacity-70">{item.hint}</span>
            </button>
          ))}
          <button onClick={() => move(1)} className="rounded-full border border-[#e5e5e1] bg-white p-2 text-[#202124]">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
      </div>
    </div>
  );
}

function SlideViewer({ result }: { result: StudioResult }) {
  const slides = useMemo(() => splitSlides(result.content), [result.content]);
  const [index, setIndex] = useState(0);
  const slide = slides[index] || result.content;
  return (
    <div className="p-4">
      <div className="mx-auto max-w-4xl rounded-2xl border border-[#e5e5e1] bg-white p-5 shadow-sm">
        <MarkdownPreview content={slide} variant="document" />
      </div>
      <div className="mt-4 flex items-center justify-center gap-3">
        <button onClick={() => setIndex(Math.max(0, index - 1))} className="rounded-full border border-[#e5e5e1] p-2 text-[#202124]">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-sm text-[#6f7277]">{index + 1} / {Math.max(slides.length, 1)}</span>
        <button onClick={() => setIndex(Math.min(slides.length - 1, index + 1))} className="rounded-full border border-[#e5e5e1] p-2 text-[#202124]">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

const extractMermaidMindmap = (content: string) => {
  const fenced = content.match(/```mermaid\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced || content).trim();
  const firstMindmap = raw.match(/mindmap[\s\S]*/i)?.[0] || raw;
  return firstMindmap.trim().startsWith('mindmap') ? firstMindmap.trim() : `mindmap\n${firstMindmap.trim()}`;
};

const normalizeMindmapNodeText = (value: string) =>
  value
    .trim()
    .replace(/^root\s*/i, '')
    .replace(/^\(+|\)+$/g, '')
    .replace(/^\[+|\]+$/g, '')
    .replace(/^"+|"+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const getMindmapRawLines = (mermaid: string) =>
  mermaid
    .split('\n')
    .map((line, index) => ({
      index,
      source: line,
      label: normalizeMindmapNodeText(line)
    }))
    .filter((line) => line.label && !/^mindmap$/i.test(line.label));

const extractConceptGraph = (content: string): ConceptGraphPayload | null => {
  const raw = content.match(/```concept_graph\s*([\s\S]*?)```/i)?.[1] || content.match(/```json\s*([\s\S]*"nodes"[\s\S]*?)```/i)?.[1];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.links)) return null;
    const nodes = parsed.nodes
      .map((node: any, index: number) => ({
        id: String(node.id || `n${index + 1}`),
        label: String(node.label || node.name || `Node ${index + 1}`).trim(),
        group: node.group ? String(node.group) : 'concept',
        importance: Number.isFinite(Number(node.importance)) ? Number(node.importance) : 0.6,
        summary: node.summary ? String(node.summary) : '',
        sourceRefs: Array.isArray(node.sourceRefs) ? node.sourceRefs.map((ref: unknown) => String(ref)) : [],
        x: Number.isFinite(Number(node.x)) ? Number(node.x) : undefined,
        y: Number.isFinite(Number(node.y)) ? Number(node.y) : undefined,
        z: Number.isFinite(Number(node.z)) ? Number(node.z) : undefined
      }))
      .filter((node: ConceptGraphNode) => node.label && !/^\[?S\d+\]?$/i.test(node.label));
    const ids = new Set(nodes.map((node: ConceptGraphNode) => node.id));
    const links = parsed.links
      .map((link: any) => ({
        source: typeof link.source === 'object' ? String(link.source.id) : String(link.source || ''),
        target: typeof link.target === 'object' ? String(link.target.id) : String(link.target || ''),
        label: link.label ? String(link.label) : '',
        type: link.type ? String(link.type) : 'association',
        weight: Number.isFinite(Number(link.weight)) ? Number(link.weight) : 0.5
      }))
      .filter((link: ConceptGraphLink) => ids.has(link.source) && ids.has(link.target) && link.source !== link.target);
    return nodes.length ? { nodes, links } : null;
  } catch {
    return null;
  }
};

const conceptGraphFromMermaid = (mermaid: string): ConceptGraphPayload => {
  const stack: Array<{ depth: number; id: string; node: ConceptGraphNode }> = [];
  const nodes: ConceptGraphNode[] = [];
  const links: ConceptGraphLink[] = [];
  mermaid.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^mindmap$/i.test(trimmed)) return;
    const label = normalizeMindmapNodeText(trimmed.replace(/^\d+(?:\.\d+)*[\.、)]\s*/, '').replace(/\[?S\d+\]?$/i, ''));
    if (!label || /^\[?S\d+\]?$/i.test(label)) return;
    const depth = Math.floor((line.match(/^\s*/)?.[0].length || 0) / 2);
    const id = `m${nodes.length + 1}`;
    nodes.push({
      id,
      label,
      group: depth <= 1 ? 'core' : `layer-${Math.min(depth, 5)}`,
      importance: Math.max(0.35, 1 - depth * 0.12),
      summary: label,
      sourceRefs: []
    });
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) links.push({ source: parent.id, target: id, label: '关联', type: 'hierarchy', weight: 0.6 });
    stack.push({ depth, id, node: nodes[nodes.length - 1] });
  });
  return { nodes, links };
};

const mindElixirDataFromMermaid = (mermaid: string): MindElixirData => {
  const stack: Array<{ depth: number; node: NodeObj }> = [];
  let root: NodeObj | null = null;
  mermaid.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^mindmap$/i.test(trimmed)) return;
    const topic = normalizeMindmapNodeText(trimmed.replace(/^\d+(?:\.\d+)*[\.、)]\s*/, '').replace(/\[?S\d+\]?$/i, ''));
    if (!topic || /^\[?S\d+\]?$/i.test(topic)) return;
    const depth = Math.floor((line.match(/^\s*/)?.[0].length || 0) / 2);
    const node: NodeObj = {
      id: `me-${stack.length}-${Math.random().toString(36).slice(2, 9)}-${topic.slice(0, 10)}`,
      topic,
      expanded: true,
      children: []
    };
    if (!root) {
      root = node;
      stack.length = 0;
      stack.push({ depth, node });
      return;
    }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1]?.node || root;
    parent.children = parent.children || [];
    parent.children.push(node);
    stack.push({ depth, node });
  });
  return {
    nodeData: root || { id: 'me-root', topic: 'Mind Map', expanded: true, children: [] },
    direction: MindElixir.SIDE,
    theme: {
      ...MindElixir.THEME,
      name: 'AIStudio',
      palette: ['#1f5fd0', '#34a853', '#fbbc04', '#ea4335', '#7c3aed', '#0891b2', '#f97316'],
      cssVar: {
        ...MindElixir.THEME.cssVar,
        '--main-color': '#d8d8d2',
        '--main-bgcolor': '#ffffff',
        '--color': '#202124',
        '--bgcolor': '#fbfbfa',
        '--selected': '#dbeafe',
        '--accent-color': '#1f5fd0',
        '--root-color': '#ffffff',
        '--root-bgcolor': '#202124',
        '--root-border-color': '#202124',
        '--main-radius': '8px',
        '--root-radius': '10px'
      }
    }
  };
};

const normalizeGraphFor2d = (graph: ConceptGraphPayload): ConceptGraphPayload => {
  const nodes = graph.nodes.slice(0, 80);
  const ids = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    links: graph.links.filter((link) => ids.has(link.source) && ids.has(link.target)).slice(0, 140)
  };
};

const graphColors = ['#78d9ff', '#9dffcb', '#ffd166', '#f78fb3', '#c7a6ff', '#ff9f6e', '#a4f3f5'];

const colorForGroup = (group = 'concept') => {
  let hash = 0;
  for (let index = 0; index < group.length; index += 1) hash = group.charCodeAt(index) + ((hash << 5) - hash);
  return graphColors[Math.abs(hash) % graphColors.length];
};

function MindElixirTreeViewer({
  result,
  mermaid,
  onModeChange
}: {
  result: StudioResult;
  mermaid: string;
  onModeChange: (mode: '2d-tree' | '2d-graph' | '3d') => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mindRef = useRef<MindElixirInstance | null>(null);
  const data = useMemo(() => mindElixirDataFromMermaid(mermaid), [mermaid]);

  useEffect(() => {
    if (!hostRef.current) return;
    hostRef.current.innerHTML = '';
    const mind = new MindElixir({
      el: hostRef.current,
      direction: MindElixir.SIDE,
      editable: true,
      contextMenu: true,
      toolBar: true,
      keypress: true,
      allowUndo: true,
      overflowHidden: false,
      scaleMin: 0.35,
      scaleMax: 2.2,
      theme: data.theme
    });
    mind.init(data);
    mindRef.current = mind;
    window.setTimeout(() => mind.scaleFit(), 120);
    return () => {
      mind.destroy();
      mindRef.current = null;
    };
  }, [data]);

  const downloadBlob = (blob: Blob, extension: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${result.name.replace(/\.[^.]+$/, '') || 'mindmap'}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPng = async () => {
    const blob = await mindRef.current?.exportPng();
    if (blob) downloadBlob(blob, 'png');
  };

  const exportJson = () => {
    const json = mindRef.current?.getDataString() || JSON.stringify(data, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${result.name.replace(/\.[^.]+$/, '') || 'mindmap'}.mind-elixir.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-[620px] flex-col bg-[#fbfbfa]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eeeeeb] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded-full bg-[#202124] px-3 py-2 text-xs font-semibold text-white">2D Mindmap</button>
          <button onClick={() => onModeChange('2d-graph')} className="rounded-full border border-[#e5e5e1] px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f6f7fb]">2D Graph</button>
          <button onClick={() => onModeChange('3d')} className="inline-flex items-center gap-2 rounded-full border border-[#e5e5e1] px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f6f7fb]">
            <Orbit className="h-4 w-4" /> 3D
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => mindRef.current?.scaleFit()} className="inline-flex items-center gap-2 rounded-full border border-[#e5e5e1] px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f6f7fb]">
            <Maximize2 className="h-4 w-4" /> Fit
          </button>
          <button onClick={exportJson} className="inline-flex items-center gap-2 rounded-full border border-[#e5e5e1] px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f6f7fb]">
            <Download className="h-4 w-4" /> JSON
          </button>
          <button onClick={() => void exportPng()} className="inline-flex items-center gap-2 rounded-full bg-[#202124] px-3 py-2 text-xs font-medium text-white hover:bg-[#34373c]">
            <Download className="h-4 w-4" /> PNG
          </button>
        </div>
      </div>
      <div ref={hostRef} className="mind-elixir-host min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}

function ConceptGraph2DViewer({
  result,
  graph,
  onModeChange
}: {
  result: StudioResult;
  graph: ConceptGraphPayload;
  onModeChange: (mode: '2d-tree' | '2d-graph' | '3d') => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const [selected, setSelected] = useState<ConceptGraphNode | ConceptGraphLink | null>(graph.nodes[0] || null);
  const normalized = useMemo(() => normalizeGraphFor2d(graph), [graph]);

  useEffect(() => {
    let disposed = false;
    const renderGraph = async () => {
      if (!containerRef.current) return;
      graphRef.current?.dispose();
      containerRef.current.innerHTML = '';
      if (minimapRef.current) minimapRef.current.innerHTML = '';

      const x6 = new Graph({
        container: containerRef.current,
        background: { color: '#fbfbfa' },
        grid: { visible: true, type: 'mesh', args: { color: '#e8e8e4', thickness: 1 } },
        panning: true,
        mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.25, maxScale: 2.4 },
        connecting: {
          allowBlank: false,
          allowLoop: false,
          allowNode: true,
          snap: true,
          connector: 'rounded',
          connectionPoint: 'boundary'
        },
        selecting: {
          enabled: true,
          multiple: true,
          rubberband: true,
          movable: true,
          showNodeSelectionBox: true
        },
        resizing: true,
        rotating: false,
        clipboard: true,
        keyboard: true,
        history: true
      } as any);
      graphRef.current = x6;

      const elk = new ELK();
      const elkGraph: ElkNode = {
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'org.eclipse.elk.stress',
          'elk.spacing.nodeNode': '56',
          'elk.edgeRouting': 'SPLINES'
        },
        children: normalized.nodes.map((node) => ({
          id: node.id,
          width: Math.min(220, Math.max(112, node.label.length * 12 + 44)),
          height: 54
        })),
        edges: normalized.links.map((link, index) => ({
          id: `e${index + 1}`,
          sources: [link.source],
          targets: [link.target]
        }))
      };
      const layout = await elk.layout(elkGraph);
      if (disposed) return;
      const positions = new Map((layout.children || []).map((node) => [node.id, node]));

      x6.fromJSON({
        nodes: normalized.nodes.map((node) => {
          const pos = positions.get(node.id);
          const color = colorForGroup(node.group);
          return {
            id: node.id,
            shape: 'rect',
            x: pos?.x || 0,
            y: pos?.y || 0,
            width: pos?.width || 150,
            height: pos?.height || 54,
            data: node,
            attrs: {
              body: {
                rx: 8,
                ry: 8,
                fill: '#ffffff',
                stroke: color,
                strokeWidth: 1.4,
                filter: 'drop-shadow(0 8px 18px rgba(15,23,42,0.08))'
              },
              label: {
                text: node.label,
                fill: '#202124',
                fontSize: 13,
                fontWeight: 600,
                textWrap: { width: -16, height: -12, ellipsis: true }
              }
            },
            ports: {
              groups: {
                all: {
                  position: 'absolute',
                  attrs: { circle: { r: 4, magnet: true, stroke: color, fill: '#fff' } }
                }
              },
              items: [
                { id: 'top', group: 'all', args: { x: '50%', y: 0 } },
                { id: 'right', group: 'all', args: { x: '100%', y: '50%' } },
                { id: 'bottom', group: 'all', args: { x: '50%', y: '100%' } },
                { id: 'left', group: 'all', args: { x: 0, y: '50%' } }
              ]
            }
          };
        }),
        edges: normalized.links.map((link, index) => ({
          id: `edge-${index + 1}`,
          source: link.source,
          target: link.target,
          data: link,
          labels: link.label ? [{ attrs: { label: { text: link.label, fill: '#5f6368', fontSize: 11 } } }] : [],
          attrs: {
            line: {
              stroke: colorForGroup(link.type || 'association'),
              strokeWidth: 1.4 + (link.weight || 0.5),
              targetMarker: { name: 'block', width: 8, height: 6 },
              strokeDasharray: link.type === 'association' ? '' : '0'
            }
          },
          connector: { name: 'rounded' },
          router: { name: 'normal' }
        }))
      });
      x6.centerContent();
      x6.zoomToFit({ padding: 32, maxScale: 1.2 });
      x6.on('node:click', ({ node }) => setSelected(node.getData() as ConceptGraphNode));
      x6.on('edge:click', ({ edge }) => setSelected(edge.getData() as ConceptGraphLink));
      x6.on('blank:click', () => setSelected(null));
    };
    void renderGraph();
    return () => {
      disposed = true;
      graphRef.current?.dispose();
      graphRef.current = null;
    };
  }, [normalized]);

  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(normalized, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${result.name.replace(/\.[^.]+$/, '') || 'concept-graph'}.x6.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid h-full min-h-[620px] bg-[#fbfbfa] lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eeeeeb] bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => onModeChange('2d-tree')} className="rounded-full border border-[#e5e5e1] px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f6f7fb]">2D Mindmap</button>
            <button className="rounded-full bg-[#202124] px-3 py-2 text-xs font-semibold text-white">2D Graph</button>
            <button onClick={() => onModeChange('3d')} className="inline-flex items-center gap-2 rounded-full border border-[#e5e5e1] px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f6f7fb]">
              <Orbit className="h-4 w-4" /> 3D
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => graphRef.current?.zoomToFit({ padding: 32, maxScale: 1.2 })} className="inline-flex items-center gap-2 rounded-full border border-[#e5e5e1] px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f6f7fb]">
              <Maximize2 className="h-4 w-4" /> Fit
            </button>
            <button onClick={exportJson} className="inline-flex items-center gap-2 rounded-full bg-[#202124] px-3 py-2 text-xs font-medium text-white hover:bg-[#34373c]">
              <Download className="h-4 w-4" /> JSON
            </button>
          </div>
        </div>
        <div ref={containerRef} className="min-h-0 flex-1" />
      </div>
      <aside className="flex min-h-0 flex-col border-t border-[#eeeeeb] bg-white lg:border-l lg:border-t-0">
        <div className="border-b border-[#eeeeeb] px-4 py-3">
          <div className="text-sm font-semibold text-[#202124]">Inspector</div>
          <div className="mt-1 text-xs text-[#777a80]">{normalized.nodes.length} nodes · {normalized.links.length} links</div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {isConceptGraphNode(selected) ? (
            <div>
              <div className="text-lg font-semibold text-[#202124]">{selected.label}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full border border-[#e5e5e1] px-2 py-1 text-xs text-[#5f6368]">{selected.group || 'concept'}</span>
                <span className="rounded-full border border-[#e5e5e1] px-2 py-1 text-xs text-[#5f6368]">importance {Math.round((selected.importance || 0.5) * 100)}%</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-[#5f6368]">{selected.summary || 'No summary provided.'}</p>
            </div>
          ) : selected ? (
            <div>
              <div className="text-lg font-semibold text-[#202124]">{String((selected as ConceptGraphLink).label || (selected as ConceptGraphLink).type || 'Relationship')}</div>
              <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-[#f6f7fb] p-3 text-xs leading-6 text-[#5f6368]">{JSON.stringify(selected, null, 2)}</pre>
            </div>
          ) : (
            <div className="rounded-xl bg-[#f6f7fb] p-3 text-sm leading-6 text-[#5f6368]">Click a node or edge to inspect it.</div>
          )}
          <div ref={minimapRef} className="mt-5 h-36 overflow-hidden rounded-xl border border-[#eeeeeb]" />
        </div>
      </aside>
    </div>
  );
}

function ConceptSpaceViewer({
  result,
  mermaid,
  onModeChange
}: {
  result: StudioResult;
  mermaid: string;
  onModeChange: (mode: '2d-tree' | '2d-graph' | '3d' | 'mermaid') => void;
}) {
  const graphRef = useRef<ForceGraphMethods<NodeObject<ConceptGraphNode>, LinkObject<ConceptGraphNode, ConceptGraphLink>> | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 960, height: 620 });
  const graph = useMemo(() => extractConceptGraph(result.content) || conceptGraphFromMermaid(mermaid), [result.content, mermaid]);
  const [selectedNode, setSelectedNode] = useState<ConceptGraphNode | null>(graph.nodes[0] || null);
  const [selectedLink, setSelectedLink] = useState<ConceptGraphLink | null>(null);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const resize = () => setSize({ width: Math.max(520, element.clientWidth), height: Math.max(520, element.clientHeight) });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSelectedNode(graph.nodes[0] || null);
    setSelectedLink(null);
  }, [graph]);

  useEffect(() => {
    const timer = window.setTimeout(() => graphRef.current?.zoomToFit(900, 80), 500);
    return () => window.clearTimeout(timer);
  }, [graph]);

  const graphData = useMemo<GraphData<NodeObject<ConceptGraphNode>, LinkObject<ConceptGraphNode, ConceptGraphLink>>>(
    () => ({
      nodes: graph.nodes.map((node) => ({ ...node })),
      links: graph.links.map((link) => ({ ...link }))
    }),
    [graph]
  );

  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${result.name.replace(/\.[^.]+$/, '') || 'concept-space'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const focusNode = (node: ConceptGraphNode) => {
    setSelectedNode(node);
    setSelectedLink(null);
    const distance = 120;
    const nodeObject = node as NodeObject<ConceptGraphNode>;
    const distRatio = 1 + distance / Math.hypot(nodeObject.x || 1, nodeObject.y || 1, nodeObject.z || 1);
    graphRef.current?.cameraPosition(
      { x: (nodeObject.x || 0) * distRatio, y: (nodeObject.y || 0) * distRatio, z: (nodeObject.z || 0) * distRatio },
      { x: nodeObject.x || 0, y: nodeObject.y || 0, z: nodeObject.z || 0 },
      800
    );
  };

  return (
    <div className="grid h-full min-h-[620px] bg-[#080b10] text-white lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#0c1118]/95 px-4 py-3">
          <div className="flex items-center gap-2">
            <button onClick={() => onModeChange('2d-tree')} className="rounded-full border border-white/15 px-3 py-2 text-xs font-medium text-white/75 hover:bg-white/10">
              2D Mindmap
            </button>
            <button onClick={() => onModeChange('2d-graph')} className="rounded-full border border-white/15 px-3 py-2 text-xs font-medium text-white/75 hover:bg-white/10">
              2D Graph
            </button>
            <button className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold text-[#111827]">
              <Orbit className="h-4 w-4" /> 3D Concept Space
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => graphRef.current?.zoomToFit(900, 80)} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-2 text-xs font-medium text-white/75 hover:bg-white/10">
              <Maximize2 className="h-4 w-4" /> Center
            </button>
            <button onClick={exportJson} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-2 text-xs font-medium text-white/75 hover:bg-white/10">
              <Download className="h-4 w-4" /> JSON
            </button>
          </div>
        </div>
        <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white/60 backdrop-blur">
            Drag nodes to reshape the space. Scroll to zoom, drag background to orbit.
          </div>
          <ForceGraph3D
            ref={graphRef}
            graphData={graphData}
            width={size.width}
            height={size.height}
            backgroundColor="#080b10"
            showNavInfo={false}
            nodeId="id"
            nodeLabel={(node) => `${node.label}${node.summary ? `\n${node.summary}` : ''}`}
            nodeVal={(node) => 5 + (Number(node.importance) || 0.5) * 10}
            nodeColor={(node) => colorForGroup(node.group)}
            nodeOpacity={0.92}
            nodeResolution={24}
            nodeThreeObject={(node) => {
              const sprite = new SpriteText(String(node.label || ''));
              sprite.color = colorForGroup(node.group);
              sprite.textHeight = 4.5;
              sprite.backgroundColor = 'rgba(8, 11, 16, 0.62)';
              sprite.padding = 2;
              sprite.borderRadius = 4;
              return sprite;
            }}
            linkLabel={(link) => link.label || link.type || ''}
            linkColor={(link) => colorForGroup(link.type || 'association')}
            linkWidth={(link) => 0.5 + (Number(link.weight) || 0.5) * 1.8}
            linkOpacity={0.38}
            linkDirectionalParticles={(link) => (Number(link.weight) || 0.5) > 0.65 ? 3 : 1}
            linkDirectionalParticleWidth={(link) => 1 + (Number(link.weight) || 0.5) * 1.8}
            linkDirectionalParticleSpeed={0.006}
            enableNodeDrag
            enableNavigationControls
            cooldownTicks={120}
            d3VelocityDecay={0.28}
            onNodeClick={(node) => focusNode(node as ConceptGraphNode)}
            onNodeDragEnd={(node) => {
              node.fx = node.x;
              node.fy = node.y;
              node.fz = node.z;
              setSelectedNode(node as ConceptGraphNode);
              setSelectedLink(null);
            }}
            onLinkClick={(link) => {
              setSelectedLink(link as ConceptGraphLink);
              setSelectedNode(null);
            }}
          />
        </div>
      </div>
      <aside className="flex min-h-0 flex-col border-t border-white/10 bg-[#0c1118] lg:border-l lg:border-t-0">
        <div className="border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold text-white">Inspector</div>
          <div className="mt-1 text-xs text-white/50">{graph.nodes.length} nodes · {graph.links.length} links</div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {selectedNode ? (
            <div>
              <div className="text-lg font-semibold text-white">{selectedNode.label}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/65">{selectedNode.group || 'concept'}</span>
                <span className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/65">importance {Math.round((selectedNode.importance || 0.5) * 100)}%</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-white/72">{selectedNode.summary || 'No summary provided.'}</p>
              {selectedNode.sourceRefs?.length ? (
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-white/38">Sources</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedNode.sourceRefs.map((ref) => (
                      <span key={ref} className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/75">{ref}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : selectedLink ? (
            <div>
              <div className="text-lg font-semibold text-white">{selectedLink.label || selectedLink.type || 'Relationship'}</div>
              <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-white/72">
                <div>Source: {String(selectedLink.source)}</div>
                <div>Target: {String(selectedLink.target)}</div>
                <div>Type: {selectedLink.type || 'association'}</div>
                <div>Weight: {selectedLink.weight ?? 0.5}</div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-white/62">
              Click a node or link to inspect it.
            </div>
          )}
          <div className="mt-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-white/38">Clusters</div>
            <div className="mt-3 space-y-2">
              {Array.from(new Set(graph.nodes.map((node) => node.group || 'concept'))).map((group) => (
                <div key={group} className="flex items-center gap-2 text-xs text-white/65">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorForGroup(group) }} />
                  {group}
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function MindMapViewer({ result }: { result: StudioResult }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgHostRef = useRef<HTMLDivElement | null>(null);
  const mermaid = useMemo(() => extractMermaidMindmap(result.content), [result.content]);
  const rawLines = useMemo(() => getMindmapRawLines(mermaid), [mermaid]);
  const conceptGraph = useMemo(() => extractConceptGraph(result.content) || conceptGraphFromMermaid(mermaid), [result.content, mermaid]);
  const [viewMode, setViewMode] = useState<'2d-tree' | '2d-graph' | '3d' | 'mermaid'>('2d-tree');
  const [zoom, setZoom] = useState(1);
  const [selectedNode, setSelectedNode] = useState<{ label: string; source: string } | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const renderMindmap = async () => {
      if (!svgHostRef.current) return;
      setRenderError(null);
      try {
        const mermaidModule = (await import('mermaid')).default;
        mermaidModule.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'base',
          themeVariables: {
            background: '#fbfbfa',
            primaryColor: '#ffffff',
            primaryBorderColor: '#d8d8d2',
            primaryTextColor: '#202124',
            lineColor: '#b8babf',
            tertiaryColor: '#f6f7fb'
          },
          mindmap: {
            padding: 18,
            useMaxWidth: false
          }
        });
        const renderId = `studio-mindmap-${result.id.replace(/[^a-zA-Z0-9_-]/g, '')}-${Date.now()}`;
        const { svg } = await mermaidModule.render(renderId, mermaid);
        if (cancelled || !svgHostRef.current) return;
        svgHostRef.current.innerHTML = svg;
        const svgEl = svgHostRef.current.querySelector('svg');
        if (svgEl) {
          svgEl.removeAttribute('height');
          svgEl.style.width = '100%';
          svgEl.style.height = '100%';
          svgEl.style.maxWidth = 'none';
        }
      } catch (error: any) {
        if (!cancelled) setRenderError(error?.message || 'Unable to render mind map');
      }
    };
    void renderMindmap();
    return () => {
      cancelled = true;
    };
  }, [mermaid, result.id]);

  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const textNode = target?.closest('text, foreignObject, span, div');
      const label = normalizeMindmapNodeText(textNode?.textContent || '');
      if (!label) return;
      const rawLine = rawLines.find((line) => line.label === label || line.label.includes(label) || label.includes(line.label));
      setSelectedNode({
        label,
        source: rawLine?.source.trim() || label
      });
    };
    host.addEventListener('click', handleClick);
    return () => host.removeEventListener('click', handleClick);
  }, [rawLines]);

  const updateZoom = (nextZoom: number) => setZoom(Math.min(1.8, Math.max(0.55, Number(nextZoom.toFixed(2)))));

  const centerView = () => {
    updateZoom(1);
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: Math.max(0, (containerRef.current.scrollHeight - containerRef.current.clientHeight) / 2),
        left: Math.max(0, (containerRef.current.scrollWidth - containerRef.current.clientWidth) / 2),
        behavior: 'smooth'
      });
    }
  };

  const downloadText = (filename: string, text: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportSvg = () => {
    const svg = svgHostRef.current?.querySelector('svg');
    if (!svg) return;
    downloadText(`${result.name.replace(/\.[^.]+$/, '') || 'mindmap'}.svg`, svg.outerHTML, 'image/svg+xml;charset=utf-8');
  };

  const exportPng = () => {
    const svg = svgHostRef.current?.querySelector('svg');
    if (!svg) return;
    const svgText = svg.outerHTML;
    const img = new Image();
    const svgUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const width = Math.max(1200, img.naturalWidth || 1200);
      const height = Math.max(720, img.naturalHeight || 720);
      canvas.width = width * 2;
      canvas.height = height * 2;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.fillStyle = '#fbfbfa';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const pngUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = `${result.name.replace(/\.[^.]+$/, '') || 'mindmap'}.png`;
        link.click();
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
    };
    img.src = svgUrl;
  };

  if (viewMode === '3d') {
    return <ConceptSpaceViewer result={result} mermaid={mermaid} onModeChange={setViewMode} />;
  }

  if (viewMode === '2d-tree') {
    return <MindElixirTreeViewer result={result} mermaid={mermaid} onModeChange={setViewMode} />;
  }

  if (viewMode === '2d-graph') {
    return <ConceptGraph2DViewer result={result} graph={conceptGraph} onModeChange={setViewMode} />;
  }

  return (
    <div className="flex h-full min-h-[560px] flex-col bg-[#fbfbfa]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eeeeeb] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setViewMode('2d-tree')} className="rounded-full border border-[#e5e5e1] px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f6f7fb]">2D Mindmap</button>
          <button onClick={() => setViewMode('2d-graph')} className="rounded-full border border-[#e5e5e1] px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f6f7fb]">2D Graph</button>
          <button onClick={() => setViewMode('3d')} className="inline-flex items-center gap-2 rounded-full border border-[#e5e5e1] px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f6f7fb]">
            <Orbit className="h-4 w-4" /> 3D
          </button>
          <button className="rounded-full bg-[#202124] px-3 py-2 text-xs font-semibold text-white">Mermaid</button>
          <button onClick={() => updateZoom(zoom - 0.1)} className="rounded-full border border-[#e5e5e1] p-2 text-[#34373c] hover:bg-[#f6f7fb]" title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </button>
          <div className="min-w-[54px] text-center text-xs font-medium text-[#5f6368]">{Math.round(zoom * 100)}%</div>
          <button onClick={() => updateZoom(zoom + 0.1)} className="rounded-full border border-[#e5e5e1] p-2 text-[#34373c] hover:bg-[#f6f7fb]" title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button onClick={centerView} className="inline-flex items-center gap-2 rounded-full border border-[#e5e5e1] px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f6f7fb]">
            <Maximize2 className="h-4 w-4" /> Center
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportSvg} className="inline-flex items-center gap-2 rounded-full border border-[#e5e5e1] px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f6f7fb]">
            <Download className="h-4 w-4" /> SVG
          </button>
          <button onClick={exportPng} className="inline-flex items-center gap-2 rounded-full bg-[#202124] px-3 py-2 text-xs font-medium text-white hover:bg-[#34373c]">
            <Download className="h-4 w-4" /> PNG
          </button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div ref={containerRef} className="min-h-0 overflow-auto bg-[#fbfbfa]">
          <div
            className="flex min-h-full min-w-[920px] items-center justify-center p-8 transition-transform duration-150"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
          >
            {renderError ? (
              <div className="max-w-xl border-y border-[#ead7d7] bg-white p-5 text-sm text-[#8a1f1f]">{renderError}</div>
            ) : (
              <div ref={svgHostRef} className="mindmap-render min-h-[520px] w-[1040px] cursor-pointer text-[#202124]" />
            )}
          </div>
        </div>
        <aside className="flex min-h-0 flex-col border-t border-[#eeeeeb] bg-white lg:border-l lg:border-t-0">
          <div className="border-b border-[#eeeeeb] px-4 py-3">
            <div className="text-sm font-semibold text-[#202124]">Node source</div>
            <div className="mt-1 text-xs text-[#777a80]">{selectedNode ? selectedNode.label : 'No node selected'}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <pre className="whitespace-pre-wrap rounded-xl bg-[#f6f7fb] p-3 text-xs leading-relaxed text-[#34373c]">
              {selectedNode?.source || 'Click any rendered mindmap node to inspect the source line.'}
            </pre>
            <button
              onClick={() => setShowRaw((value) => !value)}
              className="mt-4 w-full rounded-full border border-[#e5e5e1] px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f6f7fb]"
            >
              {showRaw ? 'Hide Raw Mermaid' : 'Show Raw Mermaid'}
            </button>
            {showRaw ? (
              <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-xl border border-[#eeeeeb] bg-white p-3 text-xs leading-relaxed text-[#5f6368]">
                {mermaid}
              </pre>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function DataTableViewer({ result }: { result: StudioResult }) {
  const rows = result.content
    .split('\n')
    .map((line) => line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map((cell) => cell.replace(/^"|"$/g, '')))
    .filter((row) => row.some((cell) => cell.trim()));
  const [header, ...body] = rows;
  return (
    <div className="p-4">
      <div className="overflow-auto rounded-2xl border border-[#e5e5e1] bg-white">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-[#f6f7fb] text-[#5f6368]">
            <tr>{(header || []).map((cell) => <th key={cell} className="border-b border-[#e5e7eb] px-4 py-3 font-semibold">{cell}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-white even:bg-[#fbfbfa]">
                {row.map((cell, cellIndex) => <td key={cellIndex} className="border-b border-[#eeeeeb] px-4 py-3 align-top text-[#34373c]">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const normalizeAnswer = (value: string) =>
  value
    .toLowerCase()
    .replace(/[，。！？；：、,.!?;:()[\]{}"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const parseOptions = (value: string) =>
  value
    .split(/\s*\|\s*|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

const inferQuestionType = (chunk: string): QuizQuestionType => {
  const type = chunk.match(/Type\s*:\s*(single_choice|multiple_choice|true_false|fill_blank|short_answer|error_analysis|application|coding_calculation)/i)?.[1] as QuizQuestionType | undefined;
  if (type) return type;
  if (/Options\s*:|^[A-D][.、)]\s+/im.test(chunk)) return 'single_choice';
  if (/_{2,}|\(\s*\)|填空|blank/i.test(chunk)) return 'fill_blank';
  return 'short_answer';
};

const isLeakedQuizControlText = (value: string) =>
  /course_id|task_id|question_types|source_scope|focus_modes|answer_mode|current_workspace|current_workbench|不要使用 mock|真实 AI|Context Capsule|生成真实测验 JSON/i.test(value);

const cleanQuizQuestion = (value: string) =>
  value
    .replace(/真实 AI 生成要求：[\s\S]*?(?=。|$)/g, '')
    .replace(/请按以下 Quiz 配置生成真实测验 JSON：[\s\S]*$/g, '')
    .replace(/\{[\s\S]*?(course_id|question_types|source_scope)[\s\S]*?\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const getField = (chunk: string, field: string) => {
  const pattern = new RegExp(`${field}\\s*:\\s*([\\s\\S]*?)(?=\\n(?:Type|Question|Options|Answer|Rubric|Skill|Difficulty|Source)\\s*:|$)`, 'i');
  return chunk.match(pattern)?.[1]?.trim() || '';
};

const parseQuizQuestions = (content: string): QuizQuestion[] => {
  try {
    const parsed = JSON.parse(content);
    const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const jsonQuestions = rawQuestions
      .map((item: any, index: number): QuizQuestion | null => {
        const type: QuizQuestionType =
          item?.type === 'single_choice' ||
          item?.type === 'multiple_choice' ||
          item?.type === 'true_false' ||
          item?.type === 'fill_blank' ||
          item?.type === 'short_answer' ||
          item?.type === 'error_analysis' ||
          item?.type === 'application' ||
          item?.type === 'coding_calculation'
            ? item.type
            : item?.type === 'multiple_choice_legacy'
              ? 'multiple_choice'
              : 'short_answer';
        const rawQuestion = String(item?.question || item?.stem || '').trim();
        const question = isLeakedQuizControlText(rawQuestion)
          ? cleanQuizQuestion(rawQuestion) || '请根据当前资料回答一个核心概念问题。'
          : rawQuestion;
        if (!question) return null;
        const normalized: QuizQuestion = {
          id: String(item?.id || `quiz-${index + 1}`),
          type,
          question,
          options: [],
          answer: String(item?.answer || '').trim(),
          rubric: String(item?.rubric || item?.explanation || item?.answer || '').trim(),
          skill: String(item?.skill || item?.knowledgePoints?.[0] || '核心理解').trim(),
          difficulty:
            item?.difficulty === 'easy' || item?.difficulty === 'hard' || item?.difficulty === 'medium'
              ? item.difficulty
              : 'medium',
          source: item?.source || item?.sourceRefs?.[0]?.title ? String(item.source || item.sourceRefs?.[0]?.title) : undefined,
          explanation: item?.explanation ? String(item.explanation) : undefined,
          knowledgePoints: Array.isArray(item?.knowledgePoints) ? item.knowledgePoints.map(String) : undefined,
          learningObjective: item?.learningObjective ? String(item.learningObjective) : undefined,
          commonMistake: item?.commonMistake ? String(item.commonMistake) : undefined,
          sourceRefs: Array.isArray(item?.sourceRefs)
            ? item.sourceRefs.map((ref: any) => ({
                title: String(ref?.title || 'Source'),
                snippet: String(ref?.snippet || '')
              }))
            : undefined
        };
        if (isChoiceQuestion(type)) {
          const options = Array.isArray(item?.options) ? item.options : [];
          const byId = new Map(
            options.map((option: any) => [
              String(option?.id || option?.key || '').toUpperCase(),
              String(option?.text || '').trim()
            ])
          );
          normalized.options = (['A', 'B', 'C', 'D'] as const).map((id) => `${id}. ${byId.get(id) || `${id} 选项`}`);
          normalized.answer = normalized.answer.match(/[A-D]/i)?.[0]?.toUpperCase() || 'A';
        }
        return normalized;
      })
      .filter((item: QuizQuestion | null): item is QuizQuestion => Boolean(item));
    if (jsonQuestions.length) return jsonQuestions;
  } catch {
    // Fall back to legacy Markdown parsing for old generated quizzes.
  }

  const explicitChunks = content
    .split(/\n(?=(?:#{1,4}\s*)?(?:Q(?:uestion)?\s*\d+|Type\s*:))/i)
    .map((chunk) => chunk.trim())
    .filter((chunk) => /Question\s*:|Type\s*:|Answer\s*:|^[A-D][.、)]\s+/im.test(chunk));

  const chunks = explicitChunks.length ? explicitChunks : content.split(/\n\s*\d+[.)、]\s+/).map((chunk) => chunk.trim()).filter(Boolean);

  const questions = chunks.map((chunk, index): QuizQuestion => {
    const type = inferQuestionType(chunk);
    const rawQuestion =
      getField(chunk, 'Question') ||
      chunk
        .split('\n')
        .find((line) => line.trim() && !/^(Type|Options|Answer|Rubric|Skill|Difficulty|Source)\s*:/i.test(line.trim()))
        ?.replace(/^#{1,4}\s*/, '')
        .replace(/^Q(?:uestion)?\s*\d+\s*[:.、-]?\s*/i, '')
        .trim() ||
      `Question ${index + 1}`;
    const question = isLeakedQuizControlText(rawQuestion)
      ? cleanQuizQuestion(rawQuestion) || '请根据当前资料回答一个核心概念问题。'
      : rawQuestion;
    const rawOptions = getField(chunk, 'Options');
    const lineOptions = chunk.match(/^[A-D][.、)]\s+.+$/gim) || [];
    const rawParsedOptions = (rawOptions ? parseOptions(rawOptions) : lineOptions)
      .map((option) => option.replace(/^([A-D])[.、)]\s*/i, '$1. '))
      .filter((option) => /^[A-D]\.\s+/.test(option));
    const optionMap = new Map(rawParsedOptions.map((option) => [option[0].toUpperCase(), option]));
    const options = (['A', 'B', 'C', 'D'] as const)
      .map((letter) => optionMap.get(letter))
      .filter((option): option is string => Boolean(option));
    const answer = getField(chunk, 'Answer') || getField(chunk, '答案') || '';

    return {
      id: `quiz-${index + 1}`,
      type,
      question,
      options,
      answer,
      rubric: getField(chunk, 'Rubric') || getField(chunk, 'Answer Guide') || answer,
      skill: getField(chunk, 'Skill') || '核心理解',
      difficulty: (getField(chunk, 'Difficulty').toLowerCase() as QuizQuestion['difficulty']) || 'medium',
      source: getField(chunk, 'Source')
    };
  });

  return questions.length
    ? questions
    : [
        {
          id: 'quiz-1',
          type: 'short_answer',
          question: '请概括当前资料中最重要的一个概念。',
          options: [],
          answer: '',
          rubric: content || '回答应覆盖核心概念、依据和一个例子。',
          skill: '概念复述',
          difficulty: 'medium'
        }
      ];
};

const parseQuizMeta = (content: string) => {
  try {
    const parsed = JSON.parse(content) as Partial<MockQuizPayload> & { quizTitle?: string; name?: string };
    return {
      title: String(parsed?.title || parsed?.quizTitle || parsed?.name || '').trim(),
      sourceCount: typeof parsed?.sourceCount === 'number' ? parsed.sourceCount : undefined
    };
  } catch {
    return {
      title: '',
      sourceCount: undefined as number | undefined
    };
  }
};

function QuizViewer({ result, workspaceId, workbenchId }: { result: StudioResult; workspaceId: string; workbenchId?: string }) {
  const questions = useMemo(() => parseQuizQuestions(result.content), [result.content]);
  const quizMeta = useMemo(() => parseQuizMeta(result.content), [result.content]);
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState<Record<string, QuizAttempt>>({});
  const [assistantByQuestion, setAssistantByQuestion] = useState<Record<string, QuizAssistantState>>({});
  const [hintOpenByQuestion, setHintOpenByQuestion] = useState<Record<string, boolean>>({});
  const [judging, setJudging] = useState(false);
  const question = questions[index];
  const attempt = attempts[question.id];
  const currentAnswer = attempt?.answer || '';
  const assistant = assistantByQuestion[question.id] || { input: '', loading: false, messages: [] };
  const correctCount = Object.values(attempts).filter((item) => item.submitted && !item.skipped && item.correct).length;
  const wrongCount = Object.values(attempts).filter((item) => item.submitted && !item.skipped && !item.correct).length;
  const skippedCount = Object.values(attempts).filter((item) => item.skipped && !item.submitted).length;

  const updateAnswer = (answer: string) => {
    setAttempts((current) => ({
      ...current,
      [question.id]: {
        answer,
        submitted: false,
        skipped: false,
        correct: false,
        score: 0,
        feedback: '',
        missingPoints: [],
        matchedPoints: [],
        judgedBy: undefined
      }
    }));
  };

  const submit = async () => {
    if (judging) return;
    setJudging(true);
    try {
      const graded = await aiApi.judgeQuizAnswer({
        workspaceId,
        workbenchId,
        question: {
          id: question.id,
          type: isChoiceQuestion(question.type) ? question.type : question.type,
          question: question.question,
          options: question.options.map((option) => ({
            id: option.match(/[A-D]/)?.[0] || '',
            text: option.replace(/^[A-D]\.\s*/, '')
          })),
          answer: question.answer,
          rubric: question.rubric,
          skill: question.skill,
          difficulty: question.difficulty,
          source: question.source,
          explanation: question.explanation,
          knowledgePoints: question.knowledgePoints,
          learningObjective: question.learningObjective,
          commonMistake: question.commonMistake,
          sourceRefs: question.sourceRefs
        },
        userAnswer: currentAnswer
      });
      setAttempts((current) => ({
        ...current,
        [question.id]: {
          answer: currentAnswer,
          submitted: true,
          skipped: false,
          correct: graded.correct,
          score: graded.score,
          feedback: graded.feedback,
          correctAnswer: question.answer,
          selectedOptionId: optionIdOf(currentAnswer),
          missingPoints: graded.missingPoints || [],
          matchedPoints: graded.matchedPoints || [],
          judgedBy: graded.judgedBy
        }
      }));
    } catch (error: any) {
      setAttempts((current) => ({
        ...current,
        [question.id]: {
          answer: currentAnswer,
          submitted: true,
          skipped: false,
          correct: false,
          score: 0,
          feedback: error?.response?.data?.error || error?.message || 'AI judge 评分失败，请稍后重试。',
          correctAnswer: question.answer,
          selectedOptionId: optionIdOf(currentAnswer),
          missingPoints: [],
          matchedPoints: [],
          judgedBy: 'error'
        }
      }));
    } finally {
      setJudging(false);
    }
  };

  const sendAssistantMessage = async (preset?: string) => {
    const userMessage = (preset || assistant.input || '').trim();
    if (!userMessage) return;

    setAssistantByQuestion((current) => ({
      ...current,
      [question.id]: {
        ...(current[question.id] || { input: '', messages: [] }),
        input: preset ? current[question.id]?.input || '' : '',
        loading: true,
        messages: [
          ...((current[question.id]?.messages || []) as AiChatMessage[]),
          { role: 'user', content: userMessage }
        ]
      }
    }));

    try {
      const response = await aiApi.assistQuizQuestion({
        workspaceId,
        workbenchId,
        question: {
          id: question.id,
          type: question.type,
          question: question.question,
          options: question.options.map((option) => ({
            id: option.match(/[A-D]/)?.[0] || '',
            text: option.replace(/^[A-D]\.\s*/, '')
          })),
          answer: question.answer,
          rubric: question.rubric,
          skill: question.skill,
          difficulty: question.difficulty,
          source: question.source,
          explanation: question.explanation,
          knowledgePoints: question.knowledgePoints,
          learningObjective: question.learningObjective,
          commonMistake: question.commonMistake,
          sourceRefs: question.sourceRefs
        },
        userMessage,
        userAnswer: currentAnswer
      });

      setAssistantByQuestion((current) => ({
        ...current,
        [question.id]: {
          input: '',
          loading: false,
          issueType: response.issueType,
          messages: [
            ...((current[question.id]?.messages || []) as AiChatMessage[]),
            { role: 'assistant', content: response.reply }
          ]
        }
      }));
    } catch (error: any) {
      setAssistantByQuestion((current) => ({
        ...current,
        [question.id]: {
          ...(current[question.id] || { input: '', messages: [] }),
          loading: false,
          messages: [
            ...((current[question.id]?.messages || []) as AiChatMessage[]),
            { role: 'assistant', content: error?.response?.data?.error || error?.message || '这道题的 AI 助手暂时不可用。' }
          ]
        }
      }));
    }
  };

  const move = (delta: number) => setIndex((current) => Math.max(0, Math.min(questions.length - 1, current + delta)));
  const submitChoice = async (option: string) => {
    if (attempt?.submitted || judging) return;
    updateAnswer(option);
    setJudging(true);
    try {
      const graded = await aiApi.judgeQuizAnswer({
        workspaceId,
        workbenchId,
        question: {
          id: question.id,
          type: question.type,
          question: question.question,
          options: question.options.map((item) => ({
            id: item.match(/[A-D]/)?.[0] || '',
            text: item.replace(/^[A-D]\.\s*/, '')
          })),
          answer: question.answer,
          rubric: question.rubric,
          skill: question.skill,
          difficulty: question.difficulty,
          source: question.source,
          explanation: question.explanation,
          hint: question.hint,
          choiceFeedback: question.choiceFeedback,
          knowledgePoints: question.knowledgePoints,
          learningObjective: question.learningObjective,
          commonMistake: question.commonMistake,
          sourceRefs: question.sourceRefs
        },
        userAnswer: option
      });
      setAttempts((current) => ({
        ...current,
        [question.id]: {
          answer: option,
          submitted: true,
          skipped: false,
          correct: graded.correct,
          score: graded.score,
          feedback: graded.feedback,
          correctAnswer: question.answer,
          selectedOptionId: optionIdOf(option),
          missingPoints: graded.missingPoints || [],
          matchedPoints: graded.matchedPoints || [],
          judgedBy: graded.judgedBy
        }
      }));
    } catch (error: any) {
      setAttempts((current) => ({
        ...current,
        [question.id]: {
          answer: option,
          submitted: true,
          skipped: false,
          correct: false,
          score: 0,
          feedback: error?.response?.data?.error || error?.message || 'AI judge 评分失败，请稍后重试。',
          correctAnswer: question.answer,
          selectedOptionId: optionIdOf(option),
          missingPoints: [],
          matchedPoints: [],
          judgedBy: 'error'
        }
      }));
    } finally {
      setJudging(false);
    }
  };

  const markSkipped = () => {
    if (attempt?.submitted) return;
    setAttempts((current) => ({
      ...current,
      [question.id]: {
        answer: '',
        submitted: false,
        skipped: true,
        correct: false,
        score: 0,
        feedback: '',
        correctAnswer: question.answer,
        selectedOptionId: '',
        missingPoints: [],
        matchedPoints: [],
        judgedBy: 'skipped'
      }
    }));
  };
  const toggleHint = () => {
    setHintOpenByQuestion((current) => ({
      ...current,
      [question.id]: !current[question.id]
    }));
  };

  const handleNext = async () => {
    if (judging) return;
    if (!attempt?.submitted) {
      if (!isChoiceQuestion(question.type) && currentAnswer.trim()) {
        await submit();
      } else if (!currentAnswer.trim()) {
        markSkipped();
      }
    }
    if (!isLastQuestion) {
      setIndex((current) => current + 1);
    }
  };

  const progressSegments = questions.map((item, itemIndex) => {
    const itemAttempt = attempts[item.id];
    if (itemAttempt?.skipped && !itemAttempt?.submitted) return 'skipped';
    if (itemAttempt?.submitted && itemAttempt.correct) return 'correct';
    if (itemAttempt?.submitted && !itemAttempt.correct) return 'wrong';
    if (itemIndex === index) return 'current';
    return 'pending';
  });
  const isLastQuestion = index === questions.length - 1;
  const showHint = hintOpenByQuestion[question.id];

  return (
    <div className="px-4 py-4 md:px-5">
      <div className="flex flex-col gap-4 border-b border-[#eef0f4] pb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {progressSegments.map((state, segmentIndex) => (
              <div
                key={`${questions[segmentIndex].id}-${state}`}
                className={`h-2 flex-1 rounded-full transition ${
                  state === 'correct' || state === 'current'
                    ? 'bg-[#1f5fd0]'
                    : state === 'wrong'
                      ? 'bg-[#f3c8c4]'
                      : state === 'skipped'
                        ? 'bg-white ring-1 ring-inset ring-[#1f5fd0]'
                        : 'bg-white ring-1 ring-inset ring-[#1f5fd0]'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-[20px] font-semibold tracking-tight text-[#3c4043]">
              {index + 1} / {questions.length}
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[#f8d9d5] px-4 py-2 text-[15px] font-medium text-[#c43628]">
              <X className="h-4 w-4" />
              <span>{wrongCount}</span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[#cceccc] px-4 py-2 text-[15px] font-medium text-[#17833f]">
              <Check className="h-4 w-4" />
              <span>{correctCount}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-5">
        <h3 className="max-w-5xl text-[18px] font-semibold leading-8 text-[#202124] md:text-[20px]">
          <span className="mr-3 text-[#9aa0a6]">{index + 1}.</span>
          {question.question}
        </h3>

        {isChoiceQuestion(question.type) ? (
          <div className="mt-4 space-y-2.5">
            {(question.options.length ? question.options : ['A. 选项 A', 'B. 选项 B', 'C. 选项 C', 'D. 选项 D']).map((option) => {
              const optionId = optionIdOf(option);
              const selected = attempt?.selectedOptionId === optionId || currentAnswer === option;
              const isCorrectOption = attempt?.submitted && question.answer === optionId;
              const isWrongSelected = attempt?.submitted && attempt?.selectedOptionId === optionId && question.answer !== optionId;
              const optionFeedback = question.choiceFeedback?.[optionId as 'A' | 'B' | 'C' | 'D'];
              return (
                <div
                  key={option}
                  className={`rounded-xl border px-4 py-3 transition ${
                    isCorrectOption
                      ? 'border-[#b9e8c5] bg-[#cceccc]'
                      : isWrongSelected
                        ? 'border-[#f0d8d6] bg-[#fcf5f4]'
                        : selected
                          ? 'border-[#b8c4ff] bg-[#f3f5ff]'
                          : 'border-[#e6eaf2] bg-white hover:border-[#d4daea]'
                  }`}
                >
                  <button
                    onClick={() => void submitChoice(option)}
                    disabled={attempt?.submitted || judging}
                    className="w-full text-left text-[14px] text-[#202124]"
                  >
                    {option}
                  </button>
                  {attempt?.submitted && (isCorrectOption || isWrongSelected) ? (
                    <div className="mt-5 text-sm leading-6 text-[#34373c]">
                      {isWrongSelected && (
                        <div className="flex items-start gap-2">
                          <X className="mt-0.5 h-5 w-5 shrink-0 text-[#c43628]" />
                          <div className="text-red-800">
                            <div className="text-[15px] font-medium text-[#c43628]">Not quite</div>
                            <div className="mt-2 text-[15px] leading-8 text-[#202124]">
                              {optionFeedback || '这个选项抓住了表面信息，但和题干真正考察点不一致。'}
                            </div>
                          </div>
                        </div>
                      )}
                      {isCorrectOption && (
                        <div className="flex items-start gap-2">
                          <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#17833f]" />
                          <div className="text-green-900">
                            <div className="text-[15px] font-medium text-[#17833f]">That's right!</div>
                            <div className="mt-2 text-[15px] leading-8 text-[#202124]">
                              {optionFeedback || question.hint || '这项最符合题干条件与关键知识点。'}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : question.type === 'fill_blank' ? (
          <div className="mt-4">
            <input
              value={currentAnswer}
              onChange={(event) => updateAnswer(event.target.value)}
              disabled={attempt?.submitted}
              className="h-11 w-full rounded-xl border border-[#e6eaf2] bg-white px-3.5 text-[15px] outline-none transition focus:border-[#b8c4ff] disabled:opacity-70"
              placeholder="在这里填写关键词、术语或公式..."
            />
          </div>
        ) : (
          <div className="mt-4">
            <textarea
              value={currentAnswer}
              onChange={(event) => updateAnswer(event.target.value)}
              disabled={attempt?.submitted}
              rows={5}
              className="w-full resize-none rounded-xl border border-[#e6eaf2] bg-white px-3.5 py-3 text-sm leading-7 outline-none transition focus:border-[#b8c4ff] disabled:opacity-70"
              placeholder="用自己的话作答。语义接近也可以获得部分分。"
            />
          </div>
        )}

        {attempt?.submitted && !attempt?.skipped ? (
          <div
            className={`mt-4 rounded-[28px] border px-6 py-5 text-[#34373c] ${
              attempt.correct
                ? 'border-[#b9e8c5] bg-[#cceccc]'
                : 'border-[#f0d8d6] bg-[#fcf5f4]'
            }`}
          >
            <div className="flex items-start gap-3">
              {attempt.correct ? (
                <Check className="mt-1 h-5 w-5 shrink-0 text-[#17833f]" />
              ) : (
                <X className="mt-1 h-5 w-5 shrink-0 text-[#c43628]" />
              )}
              <div>
                <div className={`text-[15px] font-medium ${attempt.correct ? 'text-[#17833f]' : 'text-[#c43628]'}`}>
                  {attempt.correct ? "That's right!" : 'Not quite'}
                </div>
                <div className="mt-2 text-[15px] leading-8 text-[#202124]">{attempt.feedback}</div>
              </div>
            </div>
            {attempt.matchedPoints?.length ? (
              <div className="mt-3 text-sm leading-6">
                <span className="font-semibold">命中要点：</span>{attempt.matchedPoints.join('、')}
              </div>
            ) : null}
            {attempt.missingPoints?.length ? (
              <div className="mt-3 text-sm leading-6">
                <span className="font-semibold">还可补充：</span>{attempt.missingPoints.join('、')}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 space-y-2 text-sm text-[#5d6472]">
          <details open={showHint}>
            <summary
              onClick={(event) => {
                event.preventDefault();
                toggleHint();
              }}
              className="cursor-pointer list-none font-medium text-[#5d6472]"
            >
              {showHint ? '收起提示' : '查看提示'}
            </summary>
            {showHint ? (
              <div className="mt-2 leading-6">
                {question.hint || '先回到题干条件，确认考察的是哪个知识点。'}
              </div>
            ) : null}
          </details>

          {attempt?.submitted && !attempt?.skipped ? (
            <details>
              <summary className="cursor-pointer list-none font-medium text-[#5d6472]">查看完整解析</summary>
              <div className="mt-2 leading-6 text-[#34373c]">
                {question.explanation || question.rubric}
                {(question.answer || question.rubric) ? (
                  <div className="mt-2">
                    <span className="font-semibold">参考：</span>{question.answer || question.rubric}
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>

        <div className="mt-5 rounded-[28px] border border-[#e5e7eb] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
          <div className="space-y-2">
            {assistant.messages.slice(-4).map((message, messageIndex) => (
              <div
                key={`${message.role}-${messageIndex}-${message.content.slice(0, 12)}`}
                className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-6 ${
                    message.role === 'assistant'
                      ? 'rounded-tl-none border border-[#eef1f4] bg-[#fafbfc] text-[#202124]'
                      : 'rounded-tr-none bg-[#e8f0fe] text-[#174ea6]'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-2xl border border-[#dfe3ea] bg-white shadow-sm focus-within:border-[#c7d2fe] focus-within:ring-2 focus-within:ring-[#dbe7ff]">
            <textarea
              value={assistant.input}
              onChange={(event) =>
                setAssistantByQuestion((current) => ({
                  ...current,
                  [question.id]: {
                    ...(current[question.id] || { messages: [], loading: false }),
                    input: event.target.value
                  }
                }))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendAssistantMessage();
                }
              }}
              placeholder="Ask AI"
              rows={1}
              className="min-h-[48px] w-full resize-none border-0 bg-transparent px-4 py-3 text-sm leading-6 text-[#202124] outline-none placeholder:text-[#8b95a7]"
            />
            <div className="flex items-center justify-end px-3 pb-3">
              <button
                onClick={() => void sendAssistantMessage()}
                disabled={assistant.loading || !assistant.input.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#1f5fd0] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#1a56be] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {assistant.loading ? 'Thinking...' : 'Ask AI'}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 pt-4">
          {index > 0 ? (
            <button
              onClick={() => move(-1)}
              className="inline-flex items-center justify-center rounded-full px-6 py-3 text-[18px] font-medium text-[#1f5fd0] transition hover:bg-[#f1f3f4]"
            >
              Back
            </button>
          ) : null}
          <button
            onClick={() => void handleNext()}
            disabled={judging}
            className="inline-flex items-center justify-center rounded-full bg-[#1f5fd0] px-10 py-3 text-[18px] font-medium text-white transition hover:bg-[#1a56be] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isLastQuestion ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultView({
  result,
  workspaceId,
  workbenchId,
  onBack
}: {
  result: StudioResult;
  workspaceId: string;
  workbenchId?: string;
  onBack: () => void;
}) {
  const quizMeta = result.resourceType === 'quiz' ? parseQuizMeta(result.content) : null;
  const headerTitle =
    result.resourceType === 'quiz'
      ? quizMeta?.title || result.name.replace(/\.(json|md)$/i, '') || 'Quiz'
      : resultTitle(result.resourceType);
  const sourceCount = quizMeta?.sourceCount || result.summary?.resources || result.summary?.retrievedChunks || 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#fbfbfa]">
      <div className="flex items-center justify-between gap-4 border-b border-[#eeeeeb] bg-white px-4 py-2.5">
        <div className="min-w-0">
          <button onClick={onBack} className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-[#5f6368] hover:text-[#202124]">
            <ArrowLeft className="h-4 w-4" /> Studio
          </button>
          <h2 className="truncate text-[22px] font-semibold text-[#202124]">{headerTitle}</h2>
          <div className="mt-0.5 text-xs text-[#777a80]">
            Based on {sourceCount} sources
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {result.resourceType === 'flashcards' ? (
          <FlashcardViewer result={result} />
        ) : result.resourceType === 'slide_deck' ? (
          <SlideViewer result={result} />
        ) : result.resourceType === 'mind_map' ? (
          <MindMapViewer result={result} />
        ) : result.resourceType === 'data_table' ? (
          <DataTableViewer result={result} />
        ) : result.resourceType === 'quiz' ? (
          <QuizViewer result={result} workspaceId={workspaceId} workbenchId={workbenchId} />
        ) : (
          <div className="mx-auto max-w-4xl p-4">
            <div className="rounded-2xl border border-[#e5e7eb] bg-white p-5 shadow-sm">
              <MarkdownPreview content={result.content} variant="document" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AIStudioPanel({
  editor,
  workspaceId,
  aiContext,
  onUpdateViewState
}: AIStudioPanelProps) {
  const [modal, setModal] = useState<StudioModalState | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const results = (editor.viewState.studioResults || []) as StudioResult[];
  const activeResultId = editor.viewState.activeStudioResultId as string | undefined;
  const activeResult = results.find((result) => result.id === activeResultId) || null;

  const generate = async (overrideModal?: StudioModalState) => {
    const activeModal = overrideModal || modal;
    if (!activeModal || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const contextPayload: AiChatContext = {
        ...(aiContext || {}),
        workspaceId,
        workbenchId: aiContext?.workbenchId,
        contextMode: (aiContext?.contextMode || 'workbench') as AiContextMode,
        activeContextChips: [
          { id: 'studio-selection', kind: 'selection', enabled: true },
          { id: 'studio-viewport', kind: 'viewport', enabled: true },
          { id: 'studio-active-file', kind: 'active_file', enabled: true },
          { id: 'studio-resource-scope', kind: 'resource_scope', enabled: true }
        ],
        activeFile: aiContext?.activeFile ? { ...aiContext.activeFile, content: aiContext.activeFileContent || undefined } : null,
        selectedText: window.getSelection()?.toString().trim() || aiContext?.selectedText || ''
      };
      const response = await aiApi.generateStudioResource({
        workspaceId,
        workbenchId: aiContext?.workbenchId,
        resourceType: activeModal.resourceType,
        prompt: buildPrompt(activeModal),
        options: activeModal.resourceType === 'quiz'
          ? { quiz: buildQuizGenerationRequest(activeModal, workspaceId, aiContext?.workbenchId) }
          : undefined,
        context: contextPayload
      });
      const result: StudioResult = {
        id: response.file.id,
        name: response.file.name,
        path: response.file.path,
        resourceType: response.resourceType,
        content: response.content,
        createdAt: new Date().toISOString(),
        runId: response.runId,
        flashcardDeck: response.flashcardDeck || null,
        summary: response.usedContextSummary,
        qualityReport: response.qualityReport as StudioResult['qualityReport']
      };
      const nextResults = [result, ...results.filter((item) => item.id !== result.id)].slice(0, 12);
      onUpdateViewState?.(editor.id, {
        studioResults: nextResults,
        activeStudioResultId: result.id,
        lastStudioDebug: {
          contextCapsule: response.contextCapsule,
          contextPolicy: response.contextPolicy,
          usedContextSummary: response.usedContextSummary
        },
        ...(activeModal.resourceType === 'quiz'
          ? { lastStudioQuizRequest: buildQuizGenerationRequest(activeModal, workspaceId, aiContext?.workbenchId) }
          : {})
      });
      setModal(null);
    } catch (generateError: any) {
      setError(generateError?.response?.data?.error || generateError?.message || 'AI Studio generation failed');
    } finally {
      setGenerating(false);
    }
  };

  if (activeResult) {
    return (
      <ResultView
        result={activeResult}
        workspaceId={workspaceId}
        workbenchId={aiContext?.workbenchId}
        onBack={() => onUpdateViewState?.(editor.id, { activeStudioResultId: null })}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="flex items-center justify-between border-b border-[#eeeeeb] px-4 py-2.5">
        <div>
          <h2 className="text-base font-semibold tracking-normal text-[#202124]">AI Studio</h2>
          <div className="mt-0.5 text-xs text-[#96999d]">Generate compact learning resources from current context.</div>
        </div>
        <div className="rounded-xl border border-[#eeeeeb] p-2 text-[#777a80]">
          <SplitSquareHorizontal className="h-4 w-4" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#fbfbfa] p-3">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {studioCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.type}
                className={`group flex min-h-[56px] items-center justify-between rounded-xl border border-[#e5e5e1] bg-white px-3 py-2 text-left text-[#34373c] transition ${
                  card.disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-[#f6f6f4]'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    disabled={card.disabled}
                    onClick={() => {
                      if (card.disabled) return;
                      if (card.type === 'quiz') {
                        void generate(defaultModalState('quiz'));
                        return;
                      }
                      setModal(defaultModalState(card.type as AiStudioResourceType));
                    }}
                    className="flex min-w-0 items-center gap-3 text-left"
                  >
                    <div className="rounded-lg bg-[#f1f1ef] p-1.5 text-[#777a80]">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="truncate text-sm font-semibold tracking-normal">{card.label}</div>
                  </button>
                </div>
                <button
                  disabled={card.disabled}
                  onClick={() => !card.disabled && setModal(defaultModalState(card.type as AiStudioResourceType))}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#96999d] transition hover:bg-white hover:text-[#202124]"
                  title={card.type === 'quiz' ? 'Customize quiz' : 'Open options'}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>

        {results.length > 0 && (
          <div className="mt-5">
            <div className="mb-3 text-sm font-semibold text-[#5f6368]">Recent generations</div>
            <div className="grid gap-2 md:grid-cols-2">
              {results.map((result) => (
                <button
                  key={result.id}
                  onClick={() => onUpdateViewState?.(editor.id, { activeStudioResultId: result.id })}
                  className="rounded-2xl border border-[#e5e5e1] bg-white p-3 text-left transition hover:bg-[#f6f6f4]"
                >
                  <div className="text-sm font-semibold text-[#202124]">{resultTitle(result.resourceType)}</div>
                  <div className="mt-1 truncate text-xs text-[#6f7277]">{result.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</div>
      )}

      {modal && (
        <CustomizeModal
          state={modal}
          setState={(patch) => setModal((current) => (current ? { ...current, ...patch } : current))}
          onClose={() => setModal(null)}
          onGenerate={() => void generate()}
          generating={generating}
        />
      )}
    </div>
  );
}
