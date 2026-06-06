import {
  ArrowLeft,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Download,
  Dumbbell,
  Code,
  Image as ImageIcon,
  Lightbulb,
  MessageCircle,
  Mic,
  FileText,
  FlaskConical,
  GraduationCap,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Network,
  Orbit,
  Play,
  Presentation,
  RefreshCw,
  Repeat2,
  Send,
  Sparkles,
  X,
  Pause,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { ComponentType, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Deck, Fragment as RevealFragment, Slide } from '@revealjs/react';
import Editor from '@monaco-editor/react';
import { Graph } from '@antv/x6';
import ELK, { ElkNode } from 'elkjs/lib/elk.bundled.js';
import mermaid from 'mermaid';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import ForceGraph3D, { ForceGraphMethods, GraphData, LinkObject, NodeObject } from 'react-force-graph-3d';
import MindElixir, { MindElixirData, MindElixirInstance, NodeObj } from 'mind-elixir';
import 'mind-elixir/style.css';
import SpriteText from 'three-spritetext';
import {
  aiApi,
  AiCodeLabRunResult,
  AiChatContext,
  AiChatMessage,
  AiContextMode,
  AiLockedSelectionContext,
  AiStudioArtifactSummary,
  AiStudioDeliveryArtifact,
  AiStudioGoalCategory,
  AiStudioGoalInfo,
  AiStudioRecommendation,
  AiStudioRenderJob,
  AiStudioResourceType,
  AiStudioReviewReport,
  AiStudioTemplate,
  AiStudioWorkflowTraceItem,
  AiUsedContextSummary,
  FlashcardSourceRef,
  FlashcardCard,
  FlashcardDeck,
  FlashcardRating
} from '../../services/aiApi';
import { learningApi } from '../../services/learningApi';
import { fileSystemApi } from '../../services/fileSystemApi';
import { audioNoteApi, AudioNoteAnalysis, AudioNoteProvider } from '../../services/audioNoteApi';
import { EditorState, FileSystemObject, ResourceReference } from '../../types';
import MarkdownPreview from './MarkdownPreview';
import MotionCanvasStage from './MotionCanvasStage';
import type {AlgorithmPresentationScene, PresentationObject} from './motionCanvasPresentation';
import { OWDocumentPageIcon, OWEllipsisHorizontalIcon, OWSearchIcon } from '../common/openWebUIIcons';
import 'reveal.js/reveal.css';
import 'reveal.js/theme/white.css';

interface AIStudioPanelProps {
  editor: EditorState;
  workspaceId: string;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
  resources?: ResourceReference[];
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  onOpenResource?: (resource: ResourceReference) => void;
  initialTemplateId?: string | null;
  initialTemplateRequestId?: number | null;
}

const EMPTY_STUDIO_RESOURCES: ResourceReference[] = [];

type StudioModalState = {
  resourceType: AiStudioResourceType;
  templateId?: string;
  goal?: AiStudioGoalCategory;
  topic: string;
  selectedResourceIds: string[];
};

type StudioSelectableResource = ResourceReference;

interface StudioGenerationProgressState {
  templateId?: string | null;
  renderer?: string | null;
  startedAt: number;
  elapsedMs: number;
  stageIndex: number;
}

interface StudioResult {
  id: string;
  name: string;
  path: string;
  resourceType: AiStudioResourceType;
  template?: AiStudioTemplate | null;
  goal?: AiStudioGoalCategory;
  generator?: string;
  renderer?: string;
  content: string;
  createdAt: string;
  runId: string;
  source?: string;
  metadata?: Record<string, unknown>;
  flashcardDeck?: FlashcardDeck | null;
  summary?: AiUsedContextSummary;
  workflowTrace?: AiStudioWorkflowTraceItem[];
  review?: AiStudioReviewReport;
  qualityReport?: {
    score?: number;
    keptCount?: number;
    removedCount?: number;
    warnings?: string[];
    issues?: Array<{ questionId: string; severity: string; code: string; message: string }>;
  };
  practiceNext?: {
    templateId: string;
    goal: AiStudioGoalCategory;
    title: string;
    reason: string;
    priority: number;
    evidence: string[];
    focusConcepts: string[];
    preferredDifficulty: 'easy' | 'medium' | 'hard' | 'adaptive';
    mastery?: {
      averageScore: number;
      attemptedCount: number;
      correctCount: number;
      weakConcepts: string[];
      masteredConcepts: string[];
      needsRemediation: boolean;
    };
  } | null;
  recommendation?: AiStudioRecommendation | null;
  artifact?: AiStudioArtifactSummary | null;
  renderJob?: AiStudioRenderJob | null;
  delivery?: AiStudioDeliveryArtifact | null;
  structured?: unknown;
  createdNote?: FileSystemObject | null;
  autoCreateNoteError?: string | null;
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
  conceptId?: string;
  objectiveId?: string;
  tier?: string;
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
  retryCount?: number;
  reviewNotes?: string[];
}

interface QuizSessionSnapshot {
  savedAt: string;
  summary: {
    correctCount: number;
    wrongCount: number;
    skippedCount: number;
    averageScore: number;
    questionCount: number;
  };
  questions: QuizQuestion[];
  attempts: Record<string, QuizAttempt>;
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

type TeachingDomain = 'sequence' | 'graph' | 'table' | 'state_machine' | 'formula' | 'hybrid';
type VisualPrimitiveKind = 'sequence' | 'graph' | 'table' | 'state_machine' | 'formula' | 'variables' | 'text';
type VisualCueEffect = 'focus' | 'compare' | 'update' | 'create' | 'remove' | 'success' | 'warning';

interface ProcessVisualCue {
  primitiveId: string;
  targetIds: string[];
  effect: VisualCueEffect;
  label?: string;
}

interface ProcessStepIR {
  id: string;
  index: number;
  title: string;
  goal: string;
  operation: {
    type: 'initialize' | 'inspect' | 'compare' | 'transition' | 'update' | 'emit' | 'summarize';
    targetIds: string[];
    description: string;
  };
  statePatch: Record<string, unknown>;
  narration: string;
  observation: string;
  misconception?: string;
  checkQuestion?: string;
  visualCues: ProcessVisualCue[];
}

interface VisualPrimitiveIR {
  id: string;
  kind: VisualPrimitiveKind;
  label: string;
  role?: string;
  data: Record<string, any>;
}

interface ProcessTraceIR {
  schemaVersion: 'process_trace.v1';
  domain: TeachingDomain;
  title: string;
  initialState: Record<string, unknown>;
  stateModel: {
    primitives: VisualPrimitiveIR[];
    variables: Array<{ id: string; label: string; value: string; role?: string }>;
  };
  steps: ProcessStepIR[];
}

interface VisualMappingIR {
  schemaVersion: 'visual_mapping.v1';
  layout: TeachingDomain;
  views: Array<{ id: string; primitiveId: string; kind: VisualPrimitiveKind; title: string; priority: number }>;
  cueRules?: Array<{ operation: string; effects: string[]; description: string }>;
  narrationBinding?: Record<string, string>;
}

interface TeachingPlanIR {
  schemaVersion?: 'teaching_understanding.v1';
  learningObjectives?: string[];
  coreConcepts?: string[];
  prerequisites?: string[];
  misconceptions?: string[];
  explanationStrategy?: string[];
  assessmentCheckpoints?: string[];
}

interface TeachingVisualizationPayload {
  teachingPlan?: TeachingPlanIR;
  processTrace?: ProcessTraceIR;
  visualMapping?: VisualMappingIR;
  irContract?: {
    schemaVersion: string;
    valid: boolean;
    metrics?: {
      primitiveCount?: number;
      visualElementCount?: number;
      stepCount?: number;
      cueCount?: number;
      frameCount?: number;
      rendererFrameCount?: number;
      mappedPrimitiveCount?: number;
      coveredElementCount?: number;
      danglingTargetCount?: number;
    };
    coverage?: {
      primitiveCoverage?: Array<{
        primitiveId: string;
        kind: VisualPrimitiveKind;
        mapped: boolean;
        elementCount: number;
        coveredElementCount: number;
        uncoveredElementIds: string[];
        danglingTargetIds: string[];
      }>;
    };
    diff?: {
      frames?: Array<{
        fromStepId?: string;
        toStepId: string;
        changes: Array<{ path: string; type: 'added' | 'removed' | 'changed'; before?: unknown; after?: unknown }>;
      }>;
    };
    rendererState?: RendererStateResult;
  };
}

type VisualActionType = 'highlight' | 'compare' | 'move' | 'swap' | 'insert' | 'remove' | 'create' | 'update' | 'traverse' | 'emit' | 'summarize';

type VisualExplainerMode = 'slide' | 'process' | 'diagram' | 'comparison' | 'whiteboard' | 'chart' | 'summary';
type VisualExplainerAction = 'appear' | 'focus' | 'connect' | 'move' | 'transform' | 'compare' | 'annotate' | 'fade';
type VisualExplainerRendererKind = 'reveal' | 'mermaid' | 'x6' | 'vega_lite' | 'tldraw' | 'motion_canvas' | 'jsav';
type VisualExplainerX6Terminal = string | { cell: string; port?: string };

type VisualExplainerBlock =
  | { id: string; kind: 'markdown'; markdown: string }
  | { id: string; kind: 'mermaid'; diagramType?: string; code: string }
  | {
      id: string;
      kind: 'x6';
      graph: {
        nodes?: Array<{
          id: string;
          shape?: string;
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          label?: string;
          attrs?: Record<string, unknown>;
          data?: Record<string, unknown>;
        }>;
        edges?: Array<{
          id: string;
          shape?: string;
          source: VisualExplainerX6Terminal;
          target: VisualExplainerX6Terminal;
          label?: string;
          attrs?: Record<string, unknown>;
          data?: Record<string, unknown>;
        }>;
      };
    }
  | { id: string; kind: 'vega_lite'; spec: Record<string, unknown> }
  | { id: string; kind: 'tldraw'; snapshot?: Record<string, unknown>; records?: unknown[] }
  | { id: string; kind: 'motion_canvas'; sceneName?: string; source?: string; sceneSpec?: Record<string, unknown> }
  | {
      id: string;
      kind: 'jsav';
      source?: string;
      dataStructure?: string;
      initialState?: Record<string, unknown>;
      steps?: Array<Record<string, unknown>>;
    };

interface VisualExplainerObject {
  id: string;
  kind: 'title' | 'card' | 'node' | 'edge' | 'formula' | 'table' | 'image_hint' | 'chart_hint';
  label: string;
  detail?: string;
  role?: 'main' | 'support' | 'example' | 'warning' | 'summary';
  fromId?: string;
  toId?: string;
}

interface VisualExplainerTimelineStep {
  id: string;
  action: VisualExplainerAction;
  targetIds: string[];
  narration: string;
  screenText?: string;
  durationMs?: number;
}

interface VisualExplainerSection {
  id: string;
  title: string;
  focus: string;
  sourceHint?: string;
  sourceMarkdown?: string;
  bodyMarkdown?: string;
  visualMode: VisualExplainerMode;
  screenText: string[];
  narration: string;
  objects: VisualExplainerObject[];
  timeline: VisualExplainerTimelineStep[];
  visualBlocks?: VisualExplainerBlock[];
  preferredRenderer?: VisualExplainerRendererKind;
  checkQuestion?: string;
}

interface VisualExplainerPayload {
  schemaVersion: 'visual_explainer.v1';
  markdownDraft: string;
  title: string;
  summary: string;
  sections: VisualExplainerSection[];
  rendererPlan?: {
    primary?: string;
    libraries?: string[];
    exportTargets?: string[];
  };
}

interface VisualAction {
  id: string;
  type: VisualActionType;
  primitiveId: string;
  targetIds: string[];
  fromIndex?: number;
  toIndex?: number;
  fromId?: string;
  toId?: string;
  value?: unknown;
  label?: string;
  durationMs: number;
}

interface RendererViewState {
  viewId: string;
  primitiveId: string;
  kind: VisualPrimitiveKind;
  title: string;
  priority?: number;
  effect?: VisualCueEffect;
  activeTargets: string[];
  primitiveData?: Record<string, unknown>;
  frameState?: Record<string, unknown>;
  diff?: Array<{ path: string; type?: string; before?: unknown; after?: unknown }>;
  rendererState?: Record<string, any>;
  visualActions?: VisualAction[];
  animationTimeline?: Array<{ id: string; actionId: string; offsetMs: number; durationMs: number; easing: string }>;
}

interface RendererStateResult {
  schemaVersion: 'renderer_state.v1';
  frames: Array<{
    index: number;
    stepId: string;
    title: string;
    views: RendererViewState[];
    diff?: Array<{ path: string; type?: string; before?: unknown; after?: unknown }>;
  }>;
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

const goalIconMap: Record<AiStudioGoalCategory, ComponentType<{ className?: string }>> = {
  understand: GraduationCap,
  map: Network,
  practice: Dumbbell,
  review: Repeat2,
  lab: FlaskConical,
  visualize: Presentation,
  plan: CalendarCheck
};

const goalColorMap: Record<AiStudioGoalCategory, { icon: string; bg: string; border: string }> = {
  understand: { icon: 'text-[#41566f]', bg: 'bg-[#d8dee6]', border: 'border-[#c7cfda]' },
  map: { icon: 'text-[#4d665b]', bg: 'bg-[#d8e1da]', border: 'border-[#c8d4cc]' },
  practice: { icon: 'text-[#745b45]', bg: 'bg-[#e4d8c9]', border: 'border-[#d7c8b6]' },
  review: { icon: 'text-[#5c526c]', bg: 'bg-[#ddd7e4]', border: 'border-[#cec6d8]' },
  lab: { icon: 'text-[#4a6570]', bg: 'bg-[#d5e1e3]', border: 'border-[#c4d2d6]' },
  visualize: { icon: 'text-[#765057]', bg: 'bg-[#e5d5d7]', border: 'border-[#d8c4c8]' },
  plan: { icon: 'text-[#4e5873]', bg: 'bg-[#d9dce7]', border: 'border-[#c8ccda]' }
};

const studioGoalCatalog: AiStudioGoalInfo[] = [
  { id: 'understand', zh: 'Resource Understand', en: 'Resource Understand', description: 'Turn uploaded sources into editable notes or compare multiple resources.' },
  { id: 'map', zh: 'Knowledge Map', en: 'Knowledge Map', description: 'Create mind maps, knowledge graphs, and concept maps.' },
  { id: 'practice', zh: 'Practice', en: 'Practice', description: 'Generate practice from selected sources with your own requirements.' },
  { id: 'review', zh: 'Review', en: 'Review', description: 'Build flashcards, quick review sheets, and spaced review plans.' },
  { id: 'lab', zh: 'Lab', en: 'Lab', description: 'Create code labs, starter code, and debugging tasks.' },
  { id: 'visualize', zh: 'Visualize', en: 'Visualize', description: 'Generate slides, video scripts, animations, and infographics.' },
  { id: 'plan', zh: 'Plan', en: 'Plan', description: 'Create study plans, daily tasks, and review reports.' },
];

const coreStudioTemplates: AiStudioTemplate[] = [
  {
    id: 'resource_to_notes',
    version: '1.0.0',
    goal: 'understand',
    title: 'Resource to BlockSuite Notes',
    shortTitle: 'Resource Notes',
    description: '把用户上传或选定的 sources 转成结构清晰、可继续编辑的 Markdown 学习笔记。',
    generator: 'text',
    renderer: 'markdown',
    format: 'md',
    filename: 'resource-understand-notes.md',
    outputLabel: 'BlockSuite Markdown Notes',
    recommendedUse: '需要把资料沉淀成可编辑笔记时使用。',
    legacyResourceType: 'report',
    tags: ['resource-notes', 'blocksuite', 'source-grounded']
  },
  {
    id: 'pagelm_cornell_notes',
    version: '1.0.0',
    goal: 'understand',
    title: 'PageLM-style Cornell Notes',
    shortTitle: 'PageLM Notes',
    description: '用 Cornell-style 结构把选定 sources 整理成高密度学习笔记，便于试验 PageLM 风格。',
    generator: 'text',
    renderer: 'markdown',
    format: 'md',
    filename: 'resource-understand-pagelm-notes.md',
    outputLabel: 'PageLM-style Cornell Notes',
    recommendedUse: '想试验 Cornell-style 笔记整理效果时使用。',
    legacyResourceType: 'report',
    tags: ['pagelm-style', 'cornell-notes', 'source-grounded']
  },
  {
    id: 'pure_markdown_notes',
    version: '1.0.0',
    goal: 'understand',
    title: 'Pure Markdown Notes',
    shortTitle: 'Pure Markdown',
    description: '只把用户勾选 source 全文和用户要求直接交给模型，生成 Markdown 学习笔记。',
    generator: 'text',
    renderer: 'markdown',
    format: 'md',
    filename: 'resource-understand-pure-markdown-notes.md',
    outputLabel: 'Pure Markdown Notes',
    recommendedUse: '想测试“全文直接喂给模型整理笔记”的最小链路效果时使用。',
    legacyResourceType: 'report',
    tags: ['pure-markdown', 'source-fulltext', 'source-grounded']
  },
  {
    id: 'resource_compare',
    version: '1.0.0',
    goal: 'understand',
    title: 'Resource Compare',
    shortTitle: 'Resource Compare',
    description: '对比不同资源之间的主题覆盖、观点差异、结构差异、互补信息和冲突点。',
    generator: 'text',
    renderer: 'markdown',
    format: 'md',
    filename: 'resource-understand-compare.md',
    outputLabel: '资源对比分析',
    recommendedUse: '需要比较多个资料之间的差异和互补关系时使用。',
    legacyResourceType: 'report',
    tags: ['resource-compare', 'comparison', 'source-grounded']
  },
  {
    id: 'mind_map',
    version: '1.0.0',
    goal: 'map',
    title: '知识点思维导图',
    shortTitle: 'Mind Map',
    description: '生成层级清晰、可复习的 Mermaid mindmap 和概念关系网络。',
    generator: 'structure',
    renderer: 'mermaid',
    format: 'md',
    filename: 'map-mind-map.md',
    outputLabel: '知识点思维导图',
    legacyResourceType: 'mind_map',
    tags: ['mindmap', 'concept-graph', 'review-map']
  },
  {
    id: 'knowledge_graph',
    version: '1.0.0',
    goal: 'map',
    title: '知识图谱',
    shortTitle: 'Knowledge Graph',
    description: '把概念、前置关系、依赖关系和易混关系整理成可视化知识网络。',
    generator: 'structure',
    renderer: 'mermaid',
    format: 'md',
    filename: 'map-knowledge-graph.md',
    outputLabel: '知识图谱',
    legacyResourceType: 'mind_map',
    tags: ['knowledge-graph', 'relationship']
  },
  {
    id: 'custom_practice',
    version: '1.0.0',
    goal: 'practice',
    title: 'Custom Practice',
    shortTitle: 'Practice',
    description: '根据用户输入的题型、数量、难度和来源范围生成练习。',
    generator: 'assessment',
    renderer: 'quiz',
    format: 'json',
    filename: 'practice-custom-quiz.json',
    outputLabel: '练习题',
    recommendedUse: '还没有完成基础诊断时优先使用。',
    legacyResourceType: 'quiz',
    tags: ['practice', 'quiz', 'custom']
  },
  {
    id: 'flashcards',
    version: '1.0.0',
    goal: 'review',
    title: 'Flashcards',
    shortTitle: 'Flashcards',
    description: '生成主动回忆卡片，用于间隔复习。',
    generator: 'memory',
    renderer: 'flashcards',
    format: 'md',
    filename: 'review-flashcards.md',
    outputLabel: 'Flashcards',
    recommendedUse: '薄弱点需要反复回忆巩固时使用。',
    legacyResourceType: 'flashcards',
    tags: ['memory', 'spaced-repetition']
  },
  {
    id: 'quick_review_sheet',
    version: '1.0.0',
    goal: 'review',
    title: '速记清单',
    shortTitle: 'Quick Review',
    description: '生成考前或课后快速回忆清单。',
    generator: 'memory',
    renderer: 'markdown',
    format: 'md',
    filename: 'review-quick-sheet.md',
    outputLabel: '速记清单',
    legacyResourceType: 'report',
    tags: ['review', 'checklist']
  },
  {
    id: 'review_plan',
    version: '1.0.0',
    goal: 'review',
    title: '复习计划',
    shortTitle: 'Review Plan',
    description: '根据当前资料、薄弱点和复习压力生成间隔复习计划。',
    generator: 'memory',
    renderer: 'markdown',
    format: 'md',
    filename: 'review-plan.md',
    outputLabel: '复习计划',
    recommendedUse: '需要把薄弱点安排进可执行复习节奏时使用。',
    legacyResourceType: 'report',
    tags: ['review-plan', 'spaced-repetition', 'schedule']
  },
  {
    id: 'code_lab',
    version: '1.0.0',
    goal: 'lab',
    title: 'Code Lab',
    shortTitle: 'Code Lab',
    description: '生成代码实操案例、步骤、Starter Code 和测试任务。',
    generator: 'code_lab',
    renderer: 'code_lab',
    format: 'md',
    filename: 'lab-code-lab.md',
    outputLabel: '代码类实操案例',
    recommendedUse: '需要把当前主题转成可操作代码实验时使用。',
    legacyResourceType: 'code_lab',
    tags: ['code', 'lab', 'hands-on']
  },
  {
    id: 'slide_deck',
    version: '1.0.0',
    goal: 'visualize',
    title: 'Slide Deck',
    shortTitle: 'PPT / Slides',
    description: '生成真实 PPTX 文件，并保留可预览的 Markdown slide outline。',
    generator: 'multimodal',
    renderer: 'slides',
    format: 'md',
    filename: 'visualize-slide-deck.md',
    outputLabel: '多模态课件',
    recommendedUse: '需要把当前资料转成课堂展示、自学课件或汇报材料时使用。',
    legacyResourceType: 'slide_deck',
    tags: ['pptx', 'PptxGenJS', 'slides']
  },
  {
    id: 'visual_explainer',
    version: '1.0.0',
    goal: 'visualize',
    title: 'Visual Explainer',
    shortTitle: 'Visual Explainer',
    description: '先生成完整 Markdown 答案，再切成 section 分镜，并播放每个分镜内部的轻量动画。',
    generator: 'multimodal',
    renderer: 'visual_explainer',
    format: 'md',
    filename: 'visualize-visual-explainer.md',
    outputLabel: '视觉讲解动画',
    recommendedUse: '适合把日常问题、知识解释、机制流程或推导回答升级为 PPT/动画式讲解。',
    legacyResourceType: 'visual_explainer',
    tags: ['visual-explainer', 'storyboard', 'animation']
  },
  {
    id: 'video_script',
    version: '1.0.0',
    goal: 'visualize',
    title: 'Video Script',
    shortTitle: 'Video Script',
    description: '生成教学视频或动画脚本，包含分镜、旁白、板书和互动停顿。',
    generator: 'multimodal',
    renderer: 'markdown',
    format: 'md',
    filename: 'visualize-video-script.md',
    outputLabel: '教学视频脚本',
    recommendedUse: '需要先规划讲解视频、动画视频或课程介绍视频时使用。',
    legacyResourceType: 'report',
    tags: ['video-script', 'animation']
  },
  {
    id: 'interactive_demo',
    version: '1.0.0',
    goal: 'visualize',
    title: 'Interactive Demo',
    shortTitle: 'Interactive Demo',
    description: '生成可直接在浏览器中打开的 p5.js 交互式演示。',
    generator: 'multimodal',
    renderer: 'interactive_html',
    format: 'md',
    filename: 'visualize-interactive-demo.html',
    outputLabel: '网页交互演示',
    recommendedUse: '适合排序过程、函数变化、物理运动、几何关系和参数实验。',
    legacyResourceType: 'report',
    tags: ['p5.js', 'interactive', 'simulation']
  },
  {
    id: 'algorithm_animation',
    version: '1.0.0',
    goal: 'visualize',
    title: 'Algorithm / STEM Animation',
    shortTitle: 'Manim Animation',
    description: '生成 Manim Python 源码，用于算法、数学、物理过程动画。',
    generator: 'multimodal',
    renderer: 'manim_script',
    format: 'md',
    filename: 'visualize-manim-animation.py',
    outputLabel: 'Manim 动画脚本',
    recommendedUse: '适合插入排序、公式推导、函数图像变化、速度/加速度箭头等连续过程。',
    legacyResourceType: 'report',
    tags: ['Manim', 'animation', 'math', 'physics', 'algorithm']
  },
  {
    id: 'ui_video',
    version: '1.0.0',
    goal: 'visualize',
    title: 'UI Style Video',
    shortTitle: 'Remotion Video',
    description: '生成 Remotion React 视频源码，适合卡片式知识总结和学习报告视频。',
    generator: 'multimodal',
    renderer: 'remotion_source',
    format: 'md',
    filename: 'visualize-remotion-video.tsx',
    outputLabel: 'Remotion 视频源码',
    recommendedUse: '适合学习报告视频、知识点总结视频、课程介绍视频和动态页面视频。',
    legacyResourceType: 'report',
    tags: ['Remotion', 'React', 'ui-video']
  },
  {
    id: 'study_plan',
    version: '1.0.0',
    goal: 'plan',
    title: '战术学习子规划',
    shortTitle: 'Study Plan',
    description: '基于 Workspace 父规划和当前 Workbench 上下文生成局部执行计划。',
    generator: 'planning',
    renderer: 'markdown',
    format: 'md',
    filename: 'plan-study-plan.md',
    outputLabel: '学习子规划',
    recommendedUse: '把 Workspace 战略规划拆成当前项目的每日任务和验收标准。',
    legacyResourceType: 'report',
    tags: ['plan', 'workspace-strategy', 'tactical-plan']
  }
];

const visibleStudioTemplateIds = new Set([
  'pure_markdown_notes',
  'resource_compare',
  'mind_map',
  'knowledge_graph',
  'custom_practice',
  'flashcards',
  'code_lab',
  'visual_explainer'
]);

const visibleStudioGoalIds = new Set<AiStudioGoalCategory>([
  'understand',
  'map',
  'practice',
  'review',
  'lab',
  'visualize'
]);

const isVisibleStudioTemplate = (template: AiStudioTemplate) => visibleStudioTemplateIds.has(template.id);

const visibleStudioTemplates = (templates: AiStudioTemplate[]) => templates.filter(isVisibleStudioTemplate);

const mergeTemplates = (serverTemplates: AiStudioTemplate[]) => {
  const byId = new Map(coreStudioTemplates.map((template) => [template.id, template]));
  serverTemplates.forEach((template) => byId.set(template.id, { ...byId.get(template.id), ...template }));
  return visibleStudioTemplates(Array.from(byId.values()));
};

const practiceDefaultSeed = '围绕当前资料生成一组练习。可以按需要指定题型、数量和难度。';

type PracticeQuestionAmount = 'fewer' | 'standard' | 'more';
type PracticeDifficulty = 'easy' | 'medium' | 'hard';

const practiceQuestionAmountOptions: Array<{ id: PracticeQuestionAmount; label: string; count: number }> = [
  { id: 'fewer', label: 'Fewer', count: 5 },
  { id: 'standard', label: 'Standard', count: 10 },
  { id: 'more', label: 'More', count: 15 }
];

const practiceDifficultyOptions: Array<{ id: PracticeDifficulty; label: string }> = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' }
];

const mergeGoalCatalog = (goals: AiStudioGoalInfo[]) =>
  studioGoalCatalog.map((fallback) => {
    const fromServer = goals.find((goal) => goal.id === fallback.id);
    return {
      ...fallback,
      ...fromServer,
      description: fromServer?.description || fallback.description
    };
  }).filter((goal) => visibleStudioGoalIds.has(goal.id));

const templateResourceType = (template?: AiStudioTemplate | null): AiStudioResourceType => {
  if (template?.legacyResourceType) return template.legacyResourceType;
  if (template?.renderer === 'quiz') return 'quiz';
  if (template?.renderer === 'flashcards') return 'flashcards';
  if (template?.renderer === 'mermaid') return 'mind_map';
  if (template?.renderer === 'slides') return 'slide_deck';
  if (template?.renderer === 'visual_explainer') return 'visual_explainer';
  if (template?.renderer === 'code_lab' || template?.generator === 'code_lab' || template?.id === 'code_lab' || template?.id === 'debug_task') return 'code_lab';
  return 'report';
};

const defaultTemplateModalState = (template: AiStudioTemplate): StudioModalState => ({
  ...defaultModalState(templateResourceType(template)),
  templateId: template.id,
  goal: template.goal,
  topic: ''
});

const defaultModalState = (resourceType: AiStudioResourceType): StudioModalState => ({
  resourceType,
  topic: '',
  selectedResourceIds: []
});

const resultTitle = (type: AiStudioResourceType) => {
  if (type === 'slide_deck') return 'Slide Deck';
  if (type === 'visual_explainer') return 'Visual Explainer';
  if (type === 'mind_map') return 'Mind Map';
  if (type === 'flashcards') return 'Flashcards';
  if (type === 'quiz') return 'Quiz';
  if (type === 'data_table') return 'Data Table';
  if (type === 'code_lab') return 'Code Lab';
  return 'Report';
};

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

const quizQuestionConcept = (question: QuizQuestion) =>
  question.conceptId ||
  question.objectiveId ||
  question.knowledgePoints?.[0] ||
  question.skill ||
  question.question.slice(0, 24);

const cleanQuizConceptLabel = (value?: string | null) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/[。！？!?；;]/.test(text)) return '';
  if (/混淆|误用|忘记|认为|错误|错因|common mistake/i.test(text)) return '';
  const label = text.split(/[:：,，]/)[0].trim();
  if (!label || label.length > 24) return '';
  return label;
};

const quizQuestionConceptLabels = (question: QuizQuestion) => {
  const primary = (question.knowledgePoints || []).map(cleanQuizConceptLabel).filter(Boolean);
  if (primary.length) return primary;
  return [
    question.conceptId,
    question.objectiveId,
    question.skill,
    quizQuestionConcept(question)
  ].map(cleanQuizConceptLabel).filter(Boolean);
};

const quizQuestionWeakConceptLabels = (question: QuizQuestion, attempt?: QuizAttempt) => {
  const labels = [
    ...(question.knowledgePoints || []),
    question.conceptId,
    question.objectiveId,
    question.skill,
    ...(attempt?.missingPoints || []),
    question.commonMistake
  ]
    .map(cleanQuizConceptLabel)
    .filter(Boolean);
  return Array.from(new Set(labels)).slice(0, 4);
};

const renderQuestionText = (text: string) =>
  text
    .split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g)
    .filter(Boolean)
    .map((part, index) => {
      const blockMatch = part.match(/^\$\$([\s\S]+)\$\$$/);
      const inlineMatch = part.match(/^\$([^$\n]+)\$$/);
      if (!blockMatch && !inlineMatch) {
        return <span key={index}>{part}</span>;
      }

      const formula = (blockMatch?.[1] || inlineMatch?.[1] || '').trim();
      try {
        return (
          <span
            key={index}
            className="mx-0.5 inline-flex max-w-full items-center align-middle text-[#202124]"
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(formula, {
                throwOnError: false,
                displayMode: Boolean(blockMatch)
              })
            }}
          />
        );
      } catch {
        return <span key={index}>{formula}</span>;
      }
    });

const isChoiceQuestion = (type: QuizQuestionType) =>
  type === 'single_choice' || type === 'multiple_choice' || type === 'true_false';

const sourceScopeLabel = (modal: StudioModalState, totalResources?: number) => {
  if (!modal.selectedResourceIds.length) return '未选择来源，大模型常识回答';
  if (typeof totalResources === 'number' && modal.selectedResourceIds.length === totalResources) {
    return `全部 ${totalResources} 个来源`;
  }
  return `${modal.selectedResourceIds.length} 个来源`;
};

const isResourceNotesTemplate = (templateId?: string | null) =>
  templateId === 'resource_to_notes' || templateId === 'pagelm_cornell_notes' || templateId === 'pure_markdown_notes';

const isResourceCompareTemplate = (templateId?: string | null) => templateId === 'resource_compare';

const resultTemplateId = (result: StudioResult) =>
  result.template?.id || result.artifact?.templateId || '';

const isResourceNotesResult = (result: StudioResult) => isResourceNotesTemplate(resultTemplateId(result));

const isResourceCompareResult = (result: StudioResult) => isResourceCompareTemplate(resultTemplateId(result));

const resourceNotesDisplayTitle = (result: Pick<StudioResult, 'template' | 'artifact'>) =>
  result.template?.id === 'pagelm_cornell_notes' || result.artifact?.templateId === 'pagelm_cornell_notes'
    ? 'PageLM Notes'
    : result.template?.id === 'pure_markdown_notes' || result.artifact?.templateId === 'pure_markdown_notes'
      ? 'Pure Markdown'
    : 'Resource Notes';

const stripMarkdownTitle = (content: string) => content.replace(/^\s*#\s+.+(?:\n+|$)/, '').trim();

const markdownTitleFromContent = (content: string) => content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim() || '';

const sanitizedResourceTitle = (value: string, fallback = 'Resource Notes') => {
  const cleaned = String(value || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  if (/^(把|请|帮我|生成|整理|转成|convert|create|make|summari[sz]e)\b/i.test(cleaned)) return fallback;
  if (cleaned.length > 80) return fallback;
  return cleaned;
};

const noteTitleForResult = (result: StudioResult) =>
  sanitizedResourceTitle(
    markdownTitleFromContent(result.content) ||
      result.artifact?.title ||
      result.summary?.activeFile ||
      result.summary?.citations?.[0] ||
      result.name.replace(/\.[^.]+$/, ''),
    'Resource Notes'
  );

const firstSanitizedTitle = (values: Array<string | null | undefined>, fallback: string) => {
  for (const value of values) {
    const title = sanitizedResourceTitle(String(value || ''), '');
    if (title) return title;
  }
  return fallback;
};

const studioResultTypeLabel = (result: StudioResult) =>
  isResourceNotesResult(result) ? resourceNotesDisplayTitle(result) : resultTitle(result.resourceType);

const studioResultHeaderTitle = (result: StudioResult, quizMeta?: { title: string } | null) => {
  if (isResourceNotesResult(result)) return noteTitleForResult(result);
  return firstSanitizedTitle(
    [
      quizMeta?.title,
      result.flashcardDeck?.title,
      result.artifact?.title,
      markdownTitleFromContent(result.content),
      typeof result.metadata?.title === 'string' ? result.metadata.title : '',
      typeof result.metadata?.name === 'string' ? result.metadata.name : '',
      result.name.replace(/\.[^.]+$/, '')
    ],
    resultDisplayTitle(result)
  );
};

const studioResultSourceCount = (result: StudioResult, quizMeta?: { sourceCount?: number } | null) =>
  quizMeta?.sourceCount ||
  sourceCountForResult(result) ||
  result.summary?.retrievedChunks ||
  studioSelectedResourceIdsForResult(result).length ||
  0;

const noteFilenameFromTitle = (title: string) => {
  const base = sanitizedResourceTitle(title, 'resource-notes')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'resource-notes';
  return `${base}.md`;
};

const sourceCountForResult = (result: StudioResult) =>
  result.summary?.resources ||
  result.summary?.sources ||
  (Array.isArray((result.artifact as any)?.sourceRefs) ? (result.artifact as any).sourceRefs.length : 0) ||
  0;

const noteContentForResult = (result: StudioResult, title?: string) => {
  const noteTitle = noteTitleForResult(result);
  const noteBody = stripMarkdownTitle(result.content);
  return `# ${String(title || noteTitle).trim() || noteTitle}\n\n${noteBody}`.trim() + '\n';
};

const resourceReferenceFromFile = (file: FileSystemObject): ResourceReference => ({
  id: file.id,
  name: file.name,
  path: file.path,
  type: file.fileCategory || file.extension || 'note',
  resourceType: file.resourceType,
  scope: file.scope,
  origin: file.origin,
  ownerWorkbenchId: file.ownerWorkbenchId,
  metadata: file.metadata,
  tags: file.tags,
  extension: file.extension,
  mimeType: file.mimeType,
  fileCategory: file.fileCategory,
  isBinary: file.isBinary
});

const createResourceNotesFile = async ({
  workspaceId,
  workbenchId,
  result,
  title,
  density = 'balanced'
}: {
  workspaceId: string;
  workbenchId?: string;
  result: StudioResult;
  title?: string;
  density?: 'compact' | 'balanced' | 'expanded';
}) => {
  const noteTitle = title?.trim() || noteTitleForResult(result);
  const sourceCount = sourceCountForResult(result);
  return fileSystemApi.createFile(workspaceId, {
    name: noteFilenameFromTitle(noteTitle),
    content: noteContentForResult(result, noteTitle),
    fileCategory: 'note',
    mimeType: 'text/markdown',
    workbenchId,
    resourceRole: 'note',
    resourceType: 'note',
    scope: workbenchId ? 'workbench' : 'workspace',
    origin: 'ai-studio',
    tags: ['ai-studio', 'resource-notes'],
    metadata: {
      source: 'ai_studio_resource_to_notes',
      studioResultFileId: result.id,
      templateId: resultTemplateId(result),
      sourceCount,
      density,
      noteTitle,
      autoCreated: true
    }
  });
};

function buildPrompt(modal: StudioModalState) {
  if (isResourceNotesTemplate(modal.templateId)) {
    return modal.topic.trim() || 'Convert selected sources into editable notes.';
  }
  if (isResourceCompareTemplate(modal.templateId)) {
    return modal.topic.trim() || 'Compare the selected sources and highlight overlaps, differences, and gaps.';
  }
  return modal.topic.trim();
}

const templateOptionsFor = (modal: StudioModalState) => ({
  userRequirement: modal.topic.trim(),
  sourceScope: {
    workbench: false,
    selectedResourceIds: modal.selectedResourceIds
  },
  selectedResourceIds: modal.selectedResourceIds,
  ...(modal.templateId === 'study_plan' ? { planScope: 'workbench_tactical_child' } : {})
});

const iconForResult = (result: Pick<StudioResult, 'goal' | 'resourceType'>) => {
  if (result.goal) return goalIconMap[result.goal] || Sparkles;
  if (result.resourceType === 'slide_deck') return Presentation;
  if (result.resourceType === 'visual_explainer') return Play;
  if (result.resourceType === 'mind_map') return Network;
  if (result.resourceType === 'flashcards') return Repeat2;
  if (result.resourceType === 'quiz') return Dumbbell;
  return FileText;
};

const colorsForResult = (result: Pick<StudioResult, 'goal' | 'resourceType'>) => {
  if (result.goal) return goalColorMap[result.goal] || { icon: 'text-[#4f5665]', bg: 'bg-[#f8fafc]', border: 'border-[#edf0f5]' };
  if (result.resourceType === 'slide_deck') return goalColorMap.visualize;
  if (result.resourceType === 'visual_explainer') return goalColorMap.visualize;
  if (result.resourceType === 'mind_map') return goalColorMap.map;
  if (result.resourceType === 'flashcards') return goalColorMap.review;
  if (result.resourceType === 'quiz') return goalColorMap.practice;
  return goalColorMap.understand;
};

const resultDisplayTitle = (result: StudioResult) =>
  isResourceNotesResult(result)
    ? resourceNotesDisplayTitle(result)
    : isResourceCompareResult(result)
      ? 'Resource Compare'
      : result.artifact?.title ||
  result.template?.shortTitle ||
  result.template?.title ||
  result.name.replace(/\.[^.]+$/, '') ||
  resultTitle(result.resourceType);

const resultMetaLabel = (result: StudioResult) => {
  const parts = [
    typeof result.summary?.sources === 'number'
      ? `${result.summary.sources} sources`
      : typeof result.summary?.resources === 'number'
        ? `${result.summary.resources} resources`
        : null,
    formatRelativeTime(result.createdAt)
  ].filter(Boolean);
  return parts.join(' · ');
};

type StudioSelectionBoundary = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type StudioSelectionAskResult = {
  userMessage: AiChatMessage;
  assistantMessage: AiChatMessage;
};

const studioClampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const studioRectBoundary = (rect: DOMRect | ClientRect): StudioSelectionBoundary => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom
});

const studioLastUsableRangeRect = (range: Range) => {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  return rects[rects.length - 1] || range.getBoundingClientRect();
};

const studioSelectedResourceIdsForResult = (result: StudioResult) => {
  const fromMetadata = Array.isArray(result.metadata?.selectedResourceIds)
    ? result.metadata.selectedResourceIds
    : [];
  return Array.from(new Set(fromMetadata.map(String).filter(Boolean)));
};

const studioSelectionPrompt = (prompt: string, selectedText: string) =>
  selectedText.trim()
    ? `${prompt.trim()}\n\n【选区内容】\n${selectedText.trim()}`
    : prompt.trim();

async function streamStudioSelectionAsk({
  workspaceId,
  workbenchId,
  result,
  selectedText,
  selectedRange,
  question,
  prompt,
  history,
  handlers
}: {
  workspaceId: string;
  workbenchId?: string;
  result: StudioResult;
  selectedText: string;
  selectedRange: Record<string, any>;
  question: string;
  prompt: string;
  history: AiChatMessage[];
  handlers: { onDelta: (delta: string) => void; onReplace?: (content: string) => void };
}): Promise<StudioSelectionAskResult> {
  const userCreatedAt = new Date().toISOString();
  const assistantCreatedAt = new Date().toISOString();
  const selectedResourceIds = studioSelectedResourceIdsForResult(result);
  const lockedSelection: AiLockedSelectionContext = {
    id: `studio-result-selection-${Date.now()}`,
    panelId: result.id,
    panelType: 'ai_studio_result',
    fileId: result.id,
    fileName: resultDisplayTitle(result),
    content: selectedText,
    locator: selectedRange as AiLockedSelectionContext['locator'],
    createdAt: userCreatedAt
  };
  let assistantContent = '';
  const response = await aiApi.chatStream(
    {
      messages: [
        ...history,
        { role: 'user', content: studioSelectionPrompt(prompt, selectedText), createdAt: userCreatedAt }
      ],
      context: {
        workspaceId,
        workbenchId,
        contextMode: 'selection_only' as AiContextMode,
        sourcePriority: 'selected_resources',
        selectedResourceIds,
        lockedSelection
      }
    },
    {
      onDelta: (delta) => {
        assistantContent += delta;
        handlers.onDelta(delta);
      },
      onReplace: (content) => {
        assistantContent = content;
        handlers.onReplace?.(content);
      }
    }
  );

  return {
    userMessage: { role: 'user', content: question.trim() || prompt.trim(), createdAt: userCreatedAt },
    assistantMessage: { role: 'assistant', content: response.reply || assistantContent, createdAt: assistantCreatedAt }
  };
}

function StudioSelectionPopover({
  x,
  anchorRect,
  boundaryRect,
  sourceLabel,
  onAsk,
  onExplain,
  onDismiss
}: {
  x: number;
  anchorRect: StudioSelectionBoundary;
  boundaryRect: StudioSelectionBoundary;
  sourceLabel: string;
  onAsk: (
    question: string,
    history: AiChatMessage[],
    handlers: { onDelta: (delta: string) => void; onReplace?: (content: string) => void }
  ) => Promise<StudioSelectionAskResult>;
  onExplain: (
    history: AiChatMessage[],
    handlers: { onDelta: (delta: string) => void; onReplace?: (content: string) => void }
  ) => Promise<StudioSelectionAskResult>;
  onDismiss: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<AiChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<'menu' | 'ask'>('menu');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const width = mode === 'ask' ? 320 : 132;
  const height = mode === 'ask' ? (messages.length || error ? 270 : 46) : 30;
  const margin = 8;
  const gap = 6;
  const left = studioClampNumber(x - width / 2, boundaryRect.left + margin, boundaryRect.right - width - margin);
  const above = anchorRect.top - height - gap;
  const below = anchorRect.bottom + gap;
  const top = above >= boundaryRect.top + margin
    ? above
    : below <= boundaryRect.bottom - height - margin
      ? below
      : studioClampNumber(above, boundaryRect.top + margin, boundaryRect.bottom - height - margin);

  useEffect(() => {
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  }, [onDismiss]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, loading, error]);

  const runAction = async (
    displayPrompt: string,
    submit: (
      history: AiChatMessage[],
      handlers: { onDelta: (delta: string) => void; onReplace?: (content: string) => void }
    ) => Promise<StudioSelectionAskResult>
  ) => {
    if (!displayPrompt.trim() || loading) return;
    const history = messagesRef.current.filter((message) => message.content.trim());
    const userMessage: AiChatMessage = { role: 'user', content: displayPrompt.trim(), createdAt: new Date().toISOString() };
    const assistantMessage: AiChatMessage = { role: 'assistant', content: '', createdAt: new Date().toISOString() };
    const assistantIndex = history.length + 1;
    const nextMessages = [...history, userMessage, assistantMessage];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setMode('ask');
    setLoading(true);
    setError(null);

    try {
      const updateAssistant = (contentUpdater: string | ((current: string) => string)) => {
        const updated = messagesRef.current.map((message, index) => {
          if (index !== assistantIndex) return message;
          const content = typeof contentUpdater === 'function' ? contentUpdater(message.content) : contentUpdater;
          return { ...message, content };
        });
        messagesRef.current = updated;
        setMessages(updated);
      };
      const result = await submit(history, {
        onDelta: (delta) => updateAssistant((current) => `${current}${delta}`),
        onReplace: updateAssistant
      });
      const finalized = messagesRef.current.map((message, index) => {
        if (index === assistantIndex - 1) return result.userMessage;
        if (index === assistantIndex) return result.assistantMessage;
        return message;
      });
      messagesRef.current = finalized;
      setMessages(finalized);
      setQuestion('');
    } catch (askError: any) {
      const reverted = messagesRef.current.filter((_, index) => index !== assistantIndex);
      messagesRef.current = reverted;
      setMessages(reverted);
      setError(askError?.response?.data?.error || askError?.message || 'AI 请求失败');
    } finally {
      setLoading(false);
    }
  };

  const submitQuestion = () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    void runAction(trimmed, (history, handlers) => onAsk(trimmed, history, handlers));
  };

  return (
    <div
      ref={rootRef}
      className="fixed z-50 text-xs text-gray-700"
      title={sourceLabel}
      style={{ left, top, width }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      {mode === 'menu' ? (
        <div className="flex w-full shrink-0 flex-row rounded-xl border border-gray-100 bg-white p-0.5 shadow-xl">
          <button
            type="button"
            aria-label="Ask"
            className="flex min-w-fit items-center gap-1 rounded-xl px-1.5 py-[1px] font-medium text-gray-700 transition hover:bg-gray-50"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMode('ask');
            }}
          >
            <MessageCircle className="size-3 shrink-0 text-gray-500" />
            <span className="shrink-0">Ask</span>
          </button>
          <button
            type="button"
            aria-label="Explain"
            className="flex min-w-fit items-center gap-1 rounded-xl px-1.5 py-[1px] font-medium text-gray-700 transition hover:bg-gray-50"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void runAction('Explain this selection', (history, handlers) => onExplain(history, handlers));
            }}
          >
            <Lightbulb className="size-3 shrink-0 text-gray-500" />
            <span className="shrink-0">Explain</span>
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex w-full rounded-full border border-gray-100 bg-white py-1 shadow-xl">
            <input
              type="text"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={question}
              disabled={loading}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitQuestion();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onDismiss();
                }
              }}
              placeholder="Ask about this selection"
              className="ml-5 min-w-0 flex-1 appearance-none border-0 bg-transparent text-sm font-normal text-gray-900 outline-none ring-0 placeholder:text-gray-400 disabled:text-gray-400"
            />
            <div className="ml-1 mr-1">
              <button
                type="button"
                className={`m-0.5 rounded-full p-1.5 transition ${
                  question.trim() && !loading ? 'bg-black text-white hover:bg-gray-900' : 'bg-gray-200 text-white'
                }`}
                disabled={!question.trim() || loading}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  submitQuestion();
                }}
                aria-label="Ask about selection"
              >
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              </button>
            </div>
          </div>
          {(messages.length > 0 || error) && (
            <div className="max-h-56 overflow-auto rounded-2xl border border-gray-100 bg-white p-3 text-sm leading-6 text-gray-800 shadow-xl">
              <div className="mb-2 text-[11px] font-medium text-gray-400">{sourceLabel}</div>
              <div className="space-y-3">
                {messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'text-gray-500' : 'text-gray-900'}>
                    {message.content || (loading && message.role === 'assistant' ? 'Thinking...' : '')}
                  </div>
                ))}
                {error && <div className="text-red-600">{error}</div>}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StudioResultSelectionContext({
  children,
  workspaceId,
  workbenchId,
  result,
  sourceLabel
}: {
  children: ReactNode;
  workspaceId: string;
  workbenchId?: string;
  result: StudioResult;
  sourceLabel: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number;
    anchorRect: StudioSelectionBoundary;
    boundaryRect: StudioSelectionBoundary;
    text: string;
    selectedRange: Record<string, any>;
  } | null>(null);
  const selectionMenuRef = useRef<typeof selectionMenu>(null);

  useEffect(() => {
    selectionMenuRef.current = selectionMenu;
  }, [selectionMenu]);

  const closeSelectionMenu = () => {
    selectionMenuRef.current = null;
    setSelectionMenu(null);
  };

  const readSelection = () => {
    const host = hostRef.current;
    const selection = window.getSelection();
    if (!host || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) return null;
    const text = selection.toString().trim();
    if (!text) return null;
    const rect = studioLastUsableRangeRect(range);
    if (!rect.width && !rect.height) return null;
    const hostRect = host.getBoundingClientRect();
    const boundaryRect = studioRectBoundary(hostRect);
    const anchorRect = studioRectBoundary(rect);
    return {
      text,
      selectedRange: {
        sourceType: 'ai_studio_result_selection',
        resultId: result.id,
        resultType: result.resourceType,
        textLength: text.length,
        scrollRatio: host.scrollHeight > host.clientHeight
          ? Math.min(1, Math.max(0, host.scrollTop / Math.max(1, host.scrollHeight - host.clientHeight)))
          : undefined
      },
      menu: {
        x: Math.round(rect.left + rect.width / 2),
        anchorRect,
        boundaryRect
      }
    };
  };

  const reportSelection = (showActions = false) => {
    const locator = readSelection();
    if (!locator) {
      if (!selectionMenuRef.current) setSelectionMenu(null);
      return;
    }
    if (showActions) {
      const nextMenu = {
        x: locator.menu.x,
        anchorRect: locator.menu.anchorRect,
        boundaryRect: locator.menu.boundaryRect,
        text: locator.text,
        selectedRange: locator.selectedRange
      };
      selectionMenuRef.current = nextMenu;
      setSelectionMenu(nextMenu);
    }
  };

  useEffect(() => {
    const handleSelectionChange = () => {
      window.setTimeout(() => reportSelection(false), 0);
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [result.id]);

  const askSelection = (
    question: string,
    history: AiChatMessage[],
    handlers: { onDelta: (delta: string) => void; onReplace?: (content: string) => void }
  ) => {
    const latest = selectionMenuRef.current || selectionMenu;
    if (!latest?.text) return Promise.reject(new Error('选区已失效，请重新选择文本。'));
    const prompt = `请基于我选中的 AI Studio 成品内容回答：${question}`;
    return streamStudioSelectionAsk({
      workspaceId,
      workbenchId,
      result,
      selectedText: latest.text,
      selectedRange: latest.selectedRange,
      question,
      prompt,
      history,
      handlers
    });
  };

  const explainSelection = (
    history: AiChatMessage[],
    handlers: { onDelta: (delta: string) => void; onReplace?: (content: string) => void }
  ) => {
    const latest = selectionMenuRef.current || selectionMenu;
    if (!latest?.text) return Promise.reject(new Error('选区已失效，请重新选择文本。'));
    const prompt = '请解释我选中的这段 AI Studio 成品内容';
    return streamStudioSelectionAsk({
      workspaceId,
      workbenchId,
      result,
      selectedText: latest.text,
      selectedRange: latest.selectedRange,
      question: 'Explain this selection',
      prompt,
      history,
      handlers
    });
  };

  return (
    <div
      ref={hostRef}
      className="relative min-h-0"
      onMouseDown={() => closeSelectionMenu()}
      onMouseUp={() => window.setTimeout(() => reportSelection(true), 0)}
      onKeyUp={() => window.setTimeout(() => reportSelection(true), 0)}
    >
      {selectionMenu && (
        <StudioSelectionPopover
          x={selectionMenu.x}
          anchorRect={selectionMenu.anchorRect}
          boundaryRect={selectionMenu.boundaryRect}
          sourceLabel={sourceLabel}
          onAsk={askSelection}
          onExplain={explainSelection}
          onDismiss={closeSelectionMenu}
        />
      )}
      {children}
    </div>
  );
}

type StudioResourceSection = 'source' | 'file' | 'generated';

const toStudioSelectableResource = (resource: FileSystemObject | ResourceReference): StudioSelectableResource => ({
  id: resource.id,
  name: resource.name,
  path: resource.path,
  type: (resource as ResourceReference).type || resource.resourceType || resource.fileCategory || ('nodeType' in resource ? resource.nodeType : 'file') || 'file',
  resourceType: resource.resourceType,
  scope: resource.scope,
  origin: resource.origin,
  ownerWorkbenchId: resource.ownerWorkbenchId,
  metadata: resource.metadata,
  tags: resource.tags,
  extension: resource.extension,
  mimeType: resource.mimeType,
  fileCategory: resource.fileCategory,
  isBinary: resource.isBinary
});

const studioResourceSection = (resource: FileSystemObject | ResourceReference): StudioResourceSection => {
  const resourceType = (resource.resourceType || resource.type || '').toLowerCase();
  const fileCategory = (resource.fileCategory || '').toLowerCase();
  const extension = (resource.extension || resource.name.split('.').pop() || '').toLowerCase();

  if (resourceType === 'generated' || fileCategory.includes('generated')) return 'generated';
  if (
    resourceType === 'source' ||
    resourceType === 'resource' ||
    fileCategory.includes('source') ||
    fileCategory.includes('web') ||
    extension === 'source'
  ) {
    return 'source';
  }
  return 'file';
};

const studioResourceSectionLabel: Record<StudioResourceSection, string> = {
  source: 'Sources',
  file: 'Files',
  generated: 'Generated'
};

const studioResourceKindLabel = (resource: FileSystemObject | ResourceReference) => {
  const section = studioResourceSection(resource);
  const extension = (resource.extension || resource.name.split('.').pop() || '').toLowerCase();
  if (resource.origin === 'web') return 'Web source';
  if (resource.origin === 'upload') return extension ? `Uploaded ${extension.toUpperCase()}` : 'Uploaded file';
  if (section === 'generated') return 'AI generated';
  if (resource.resourceType === 'note' || resource.fileCategory?.includes('note')) return 'Note';
  return extension ? extension.toUpperCase() : resource.resourceType || resource.fileCategory || 'File';
};

const studioResourceIconFor = (resource: FileSystemObject | ResourceReference) => {
  const extension = (resource.extension || resource.name.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(extension)) return ImageIcon;
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'c', 'cpp', 'html', 'css', 'json', 'yaml', 'yml', 'xml'].includes(extension)) return Code;
  return FileText;
};

const isSelectableStudioResource = (resource: FileSystemObject | ResourceReference) => {
  if ('nodeType' in resource && resource.nodeType !== 'file') return false;
  if ('type' in resource && resource.type === 'folder') return false;

  const section = studioResourceSection(resource);
  const path = String(resource.path || '').toLowerCase();
  return section !== 'generated' && !path.includes('/generated/') && !path.includes('/generates/');
};

const workbenchIdFromLocation = () => {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/\/workbenches\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const isWorkbenchNoteResource = (resource: FileSystemObject | ResourceReference) => {
  const resourceType = String(resource.resourceType || '').toLowerCase();
  const fileCategory = String(resource.fileCategory || '').toLowerCase();
  const scope = String(resource.scope || '').toLowerCase();
  const extension = (resource.extension || resource.name.split('.').pop() || '').toLowerCase();
  return (
    scope === 'workbench' &&
    (resourceType === 'note' || fileCategory === 'note' || fileCategory.includes('note')) &&
    (extension === 'md' || extension === 'markdown' || resource.mimeType?.includes('markdown'))
  );
};

function StudioSourcePicker({
  selectedIds,
  onChange,
  resources,
  loadingResources,
  emptyLabel = 'No selectable sources found.'
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  resources: StudioSelectableResource[];
  loadingResources: boolean;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedItems = resources.filter((resource) => selectedIds.includes(resource.id));
  const filteredResources = resources.filter((resource) =>
    resource.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const items = filteredResources.map((resource) => ({
    resource,
    type: studioResourceSection(resource) === 'source' ? 'collection' : studioResourceSection(resource) === 'generated' ? 'file' : 'note'
  }));
  const typeLabel: Record<string, string> = {
    note: 'Notes',
    collection: 'Collections',
    file: 'Files'
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-studio-source-picker]')) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div data-studio-source-picker>
      <div className="flex flex-col mb-1">
        {selectedItems.length > 0 ? (
          <div className=" flex flex-wrap items-center gap-2 mb-2.5">
            {selectedItems.map((resource) => (
              <div
                key={resource.id}
                className="group flex min-w-0 max-w-[240px] items-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm font-medium text-black shadow-sm"
              >
                <OWDocumentPageIcon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{resource.name}</span>
                <span className="shrink-0 text-gray-500">{studioResourceKindLabel(resource)}</span>
                <button
                  type="button"
                  onClick={() => onChange(selectedIds.filter((id) => id !== resource.id))}
                  className="ml-1 hidden rounded-full text-gray-500 transition hover:text-black group-hover:block"
                  aria-label="Remove source"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="relative flex flex-wrap flex-row text-sm gap-1">
          <button
            type="button"
            className=" px-3.5 py-1.5 font-medium hover:bg-black/5 dark:hover:bg-white/5 outline outline-1 outline-gray-100 dark:outline-gray-850 rounded-3xl"
            onClick={() => {
              setQuery('');
              setOpen((value) => !value);
            }}
          >
            Select Knowledge
          </button>

          {open ? (
            <div className="absolute left-0 top-10 z-[10000] text-black dark:text-white rounded-2xl shadow-lg border border-gray-200 dark:border-gray-800 flex flex-col bg-white dark:bg-gray-850 w-70 p-1.5">
              <div className=" flex w-full space-x-2 px-2 pb-0.5">
                <div className="flex flex-1">
                  <div className=" self-center mr-2">
                    <OWSearchIcon className="size-3.5" />
                  </div>
                  <input
                    className=" w-full text-sm pr-4 py-1 rounded-r-xl outline-hidden bg-transparent"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search"
                    autoFocus
                  />
                </div>
              </div>

              <div className="max-h-56 overflow-y-scroll gap-0.5 flex flex-col">
                {loadingResources ? (
                  <div className="flex items-center justify-center gap-2 pt-4 pb-6 text-xs text-gray-500 dark:text-gray-400">
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading sources...
                  </div>
                ) : items.length === 0 ? (
                  <div className="text-center text-xs text-gray-500 dark:text-gray-400 pt-4 pb-6">
                    {emptyLabel}
                  </div>
                ) : (
                  items.map((item, index) => {
                    const previousType = items[index - 1]?.type;
                    const ResourceIcon =
                      item.type === 'note' ? OWDocumentPageIcon : item.type === 'collection' ? studioResourceIconFor(item.resource) : OWDocumentPageIcon;
                    const selected = selectedIds.includes(item.resource.id);

                    return (
                      <div key={item.resource.id}>
                        {index === 0 || item.type !== previousType ? (
                          <div className="px-2 text-xs text-gray-500 py-1">
                            {typeLabel[item.type]}
                          </div>
                        ) : null}

                        <div className=" px-2.5 py-1 rounded-xl w-full text-left flex justify-between items-center text-sm hover:bg-gray-50 hover:dark:bg-gray-800 hover:dark:text-gray-100 selected-command-option-button">
                          <button
                            className="w-full flex-1"
                            type="button"
                            onClick={() => {
                              onChange(
                                selected
                                  ? selectedIds.filter((id) => id !== item.resource.id)
                                  : [...selectedIds, item.resource.id]
                              );
                              setOpen(false);
                            }}
                          >
                            <div className="  text-black dark:text-gray-100 flex items-center gap-1 shrink-0">
                              <ResourceIcon className="size-4" />
                              <div className="line-clamp-1 flex-1 text-sm text-left">
                                {item.resource.name}
                              </div>
                            </div>
                          </button>
                          {selected ? <Check className="size-4 text-black dark:text-gray-100" /> : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
const hashText = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

function AudioRecorderView({
  workspaceId,
  workbenchId,
  resources,
  loadingResources,
  onClose,
  onRefreshResources
}: {
  workspaceId: string;
  workbenchId?: string;
  resources: StudioSelectableResource[];
  loadingResources: boolean;
  onClose: () => void;
  onRefreshResources: () => void;
}) {
  const [provider, setProvider] = useState<AudioNoteProvider>('auto');
  const [recordingFile, setRecordingFile] = useState<FileSystemObject | null>(null);
  const [analysis, setAnalysis] = useState<AudioNoteAnalysis | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIndexRef = useRef(0);
  const uploadChainRef = useRef(Promise.resolve());
  const recordingFileIdRef = useRef<string | null>(null);
  const notes = resources.filter(isWorkbenchNoteResource);
  const selectedNote = notes.find((note) => note.id === selectedNoteId) || notes[0] || null;
  const canApply = Boolean(selectedNote && analysis?.noteDraft?.trim());

  useEffect(() => {
    if (!startedAt || !recording) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording, startedAt]);

  useEffect(() => {
    if (!recordingFile || !['queued', 'processing'].includes(analysis?.status || '')) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await audioNoteApi.getAnalysis(workspaceId, recordingFile.id);
        setAnalysis(response.analysis);
        if (['draft_ready', 'ready', 'failed'].includes(response.analysis.status)) {
          onRefreshResources();
        }
      } catch (pollError: any) {
        setError(pollError?.response?.data?.error || pollError?.message || '获取转写状态失败');
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [workspaceId, recordingFile?.id, analysis?.status]);

  useEffect(() => () => {
    recorderRef.current?.state === 'recording' && recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const enqueueChunkUpload = (blob: Blob, fileId: string, chunkIndex: number) => {
    uploadChainRef.current = uploadChainRef.current
      .then(async () => {
        const response = await audioNoteApi.appendChunk(workspaceId, fileId, blob, chunkIndex);
        setAnalysis(response.analysis);
      })
      .catch((uploadError: any) => {
        setError(uploadError?.response?.data?.error || uploadError?.message || '音频分片上传失败');
      });
  };

  const startRecording = async () => {
    if (!workbenchId) {
      setError('当前 Workbench 不存在，无法创建录音资源。');
      return;
    }
    setBusy(true);
    setError(null);
    setApplyStatus(null);
    const optimisticStartedAt = Date.now();
    setStartedAt(optimisticStartedAt);
    setElapsedSeconds(0);
    setRecording(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const created = await audioNoteApi.createRecording(workspaceId, { workbenchId, mimeType });
      setRecordingFile(created.file);
      setAnalysis(created.analysis);
      recordingFileIdRef.current = created.file.id;
      chunkIndexRef.current = 0;
      uploadChainRef.current = Promise.resolve();
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        const fileId = recordingFileIdRef.current;
        if (!fileId || !event.data || event.data.size === 0) return;
        enqueueChunkUpload(event.data, fileId, chunkIndexRef.current++);
      };
      recorder.start(30000);
      onRefreshResources();
    } catch (startError: any) {
      setStartedAt(null);
      setElapsedSeconds(0);
      setRecording(false);
      setError(startError?.message || '无法启动麦克风录音');
    } finally {
      setBusy(false);
    }
  };

  const stopRecording = async () => {
    const fileId = recordingFileIdRef.current;
    if (!fileId) return;
    setBusy(true);
    setError(null);
    try {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          recorder.addEventListener('stop', () => resolve(), { once: true });
          recorder.requestData();
          recorder.stop();
        });
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setRecording(false);
      await uploadChainRef.current;
      const response = await audioNoteApi.finishRecording(workspaceId, fileId, provider);
      setAnalysis(response.analysis);
      onRefreshResources();
    } catch (stopError: any) {
      setError(stopError?.response?.data?.error || stopError?.message || '结束录音失败');
    } finally {
      setBusy(false);
    }
  };

  const applyDraftToNote = async () => {
    if (!selectedNote || !analysis?.noteDraft) return;
    setBusy(true);
    setApplyStatus(null);
    setError(null);
    try {
      const current = await fileSystemApi.getContent(workspaceId, selectedNote.id);
      const existing = current.content || '';
      const baseContentHash = await hashText(existing);
      const nextContent = [
        existing.trimEnd(),
        '',
        '',
        analysis.noteDraft.trim()
      ].filter(Boolean).join('\n');
      await fileSystemApi.saveContentWithRevision(workspaceId, {
        id: selectedNote.id,
        content: nextContent,
        baseContentHash,
        revisionSummary: `Audio note draft from ${recordingFile?.name || 'recording'}`,
        actionType: 'audio_to_notes',
        actor: 'ai'
      });
      setApplyStatus('已写回 Notes，并创建 revision。');
      onRefreshResources();
    } catch (applyError: any) {
      setError(applyError?.response?.data?.error || applyError?.message || '写回 Notes 失败');
    } finally {
      setBusy(false);
    }
  };

  const elapsedLabel = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
  const progressPercent = analysis?.progress?.percent ?? (recording ? 10 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f8fa]">
      <div className="flex items-center justify-between gap-3 border-b border-[#eeeeeb] bg-white px-4 py-3">
        <div className="min-w-0">
          <button onClick={onClose} className="mb-1 inline-flex items-center gap-1 text-sm font-semibold text-[#5f6673] hover:text-[#202124]">
            <ArrowLeft className="h-4 w-4" />
            AI Studio
          </button>
          <h2 className="text-xl font-semibold text-[#202124]">Lecture Recording</h2>
          <div className="mt-1 text-xs text-[#777a80]">Chunked upload, async ASR, and a draft note for class sessions.</div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as AudioNoteProvider)}
            disabled={recording || busy}
            className="rounded-full border border-[#dfe3ea] bg-white px-3 py-2 text-sm text-[#343a46]"
          >
            <option value="auto">Auto</option>
            <option value="funasr">FunASR</option>
            <option value="faster-whisper">faster-whisper</option>
          </select>
          {!recording ? (
            <button
              onClick={startRecording}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-[#202124] px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
              Start
            </button>
          ) : (
            <button
              onClick={stopRecording}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
              Stop
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <section className="rounded-lg border border-[#dfe3ea] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">Recording</div>
                <div className="mt-1 text-lg font-semibold text-[#202124]">{recordingFile?.name || 'No recording yet'}</div>
              </div>
              <div className="rounded-full bg-[#f1f5f9] px-3 py-1 text-sm font-semibold text-[#334155]">{elapsedLabel}</div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#edf0f5]">
              <div className="h-full bg-[#202124] transition-all" style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }} />
            </div>
            <div className="mt-2 text-sm text-[#667085]">
              {analysis?.progress?.message || (recording ? 'Recording audio chunks.' : 'Click Start to begin.')}
            </div>
            {analysis?.chunks?.length ? (
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#5f6673]">
                <span className="rounded-full border border-[#edf0f5] px-2.5 py-1">{analysis.chunks.length} chunks uploaded</span>
                <span className="rounded-full border border-[#edf0f5] px-2.5 py-1">status: {analysis.status}</span>
                <span className="rounded-full border border-[#edf0f5] px-2.5 py-1">provider: {analysis.provider}</span>
              </div>
            ) : null}
            {error && <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            {applyStatus && <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{applyStatus}</div>}
            {analysis?.warnings?.length ? (
              <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
                {analysis.warnings.slice(0, 3).map((warning) => <div key={warning}>{warning}</div>)}
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-[#dfe3ea] bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">Write back</div>
            <label className="mt-3 block text-sm font-semibold text-[#343a46]">Target Notes</label>
            <select
              value={selectedNote?.id || selectedNoteId}
              onChange={(event) => setSelectedNoteId(event.target.value)}
              className="mt-2 w-full rounded-lg border border-[#dfe3ea] bg-white px-3 py-2 text-sm text-[#202124]"
            >
              {loadingResources && <option>Loading notes...</option>}
              {!loadingResources && notes.length === 0 && <option>No notes found</option>}
              {notes.map((note) => (
                <option key={note.id} value={note.id}>{note.name}</option>
              ))}
            </select>
            <button
              onClick={applyDraftToNote}
              disabled={!canApply || busy}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#202124] px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              写回 Notes
            </button>
          </section>

          <section className="rounded-lg border border-[#dfe3ea] bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-[#202124]">Transcript</div>
              <span className="text-xs text-[#7b8190]">{analysis?.transcript?.length || 0} segments</span>
            </div>
            <div className="max-h-[420px] overflow-auto rounded-lg border border-[#edf0f5] bg-[#fbfcfd] p-3 text-sm leading-6 text-[#343a46]">
              {analysis?.transcript?.length ? analysis.transcript.map((segment) => (
                <p key={segment.id} className="mb-3 last:mb-0">{segment.text}</p>
              )) : (
                <div className="text-[#7b8190]">转写内容会在 ASR 完成后显示。</div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[#dfe3ea] bg-white p-4 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-[#202124]">课堂笔记草稿</div>
            <div className="max-h-[420px] overflow-auto rounded-lg border border-[#edf0f5] bg-white p-3">
              {analysis?.noteDraft ? (
                <MarkdownPreview content={analysis.noteDraft} variant="document" />
              ) : (
                <div className="text-sm leading-6 text-[#7b8190]">草稿会在转写完成后生成。</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function OpenWebUISelect({
  label,
  valueLabel,
  options,
  onSelect,
  disabled = false
}: {
  label: string;
  valueLabel: string;
  options: Array<{ id: string; label: string; description?: string }>;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && containerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={containerRef} className="flex flex-col w-full mt-1" data-openwebui-select>
      <div className=" mb-1 text-xs text-gray-500">{label}</div>
      <div className="relative flex-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center justify-between gap-2 bg-transparent py-0 text-left text-sm outline-hidden disabled:cursor-default disabled:opacity-70"
        >
          <span className="min-w-0 flex-1 truncate text-black dark:text-gray-100">{valueLabel}</span>
          <ChevronDown className={`size-4 shrink-0 text-gray-500 transition ${open ? 'rotate-180' : ''}`} />
        </button>

        {open ? (
          <div className="absolute left-0 top-7 z-[10000] flex w-70 flex-col rounded-2xl border border-gray-200 bg-white p-1.5 text-black shadow-lg dark:border-gray-800 dark:bg-gray-850 dark:text-white">
            <div className="max-h-56 overflow-y-scroll gap-0.5 flex flex-col">
              {options.map((option, index) => (
                <div key={option.id}>
                  {index === 0 ? <div className="px-2 text-xs text-gray-500 py-1">{label}</div> : null}
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(option.id);
                      setOpen(false);
                    }}
                    className="px-2.5 py-1 rounded-xl w-full text-left flex justify-between items-center text-sm hover:bg-gray-50 hover:dark:bg-gray-800 hover:dark:text-gray-100 selected-command-option-button"
                  >
                    <span className="min-w-0 flex-1 truncate text-black dark:text-gray-100">{option.label}</span>
                    {option.label === valueLabel ? <Check className="size-4 shrink-0 text-black dark:text-gray-100" /> : null}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StudioGenerationForm({
  template,
  templateOptions,
  onTemplateChange,
  state,
  setState,
  resources,
  loadingResources,
  onGenerate,
  generating,
  onCancel,
  compact = false
}: {
  template: AiStudioTemplate;
  templateOptions?: AiStudioTemplate[];
  onTemplateChange?: (template: AiStudioTemplate) => void;
  state: StudioModalState;
  setState: (patch: Partial<StudioModalState>) => void;
  resources: StudioSelectableResource[];
  loadingResources: boolean;
  onGenerate: () => void;
  generating: boolean;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const resourceNotes = isResourceNotesTemplate(template.id);
  const resourceCompare = isResourceCompareTemplate(template.id);
  const requirementLabel = resourceNotes ? 'Prompt' : resourceCompare ? 'Prompt' : 'Prompt';
  const canGenerate = resourceNotes || resourceCompare ? state.selectedResourceIds.length > 0 || state.topic.trim().length > 0 : state.topic.trim().length > 0;
  const primaryLabel = resourceNotes ? 'Convert to Notes' : resourceCompare ? 'Compare Resources' : 'Generate';
  const selectOptions = templateOptions?.length ? templateOptions : [template];

  return (
    <form
      className="flex w-full flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        onGenerate();
      }}
    >
      <OpenWebUISelect
        label="Resource Type"
        valueLabel={template.shortTitle || template.title}
        options={selectOptions.map((item) => ({ id: item.id, label: item.shortTitle || item.title }))}
        onSelect={(id) => {
          const nextTemplate = selectOptions.find((item) => item.id === id);
          if (nextTemplate) onTemplateChange?.(nextTemplate);
        }}
        disabled={!onTemplateChange || selectOptions.length <= 1}
      />

      <div className={compact ? 'my-2.5' : 'my-2.5'}>
        <div className="mb-2 text-xs text-gray-500">{requirementLabel}</div>
        <textarea
          value={state.topic}
          onChange={(event) => setState({ topic: event.target.value })}
          rows={compact ? 6 : 6}
          className=" text-sm w-full bg-transparent outline-hidden resize-none"
          placeholder="Write your model prompt content here"
        />
      </div>

      <div className={compact ? 'my-2' : 'my-2'}>
        <div className="flex w-full justify-between">
          <div className=" mb-2 text-xs text-gray-500">Knowledge</div>
          <div className=" mb-2 text-xs text-gray-500">
            {state.selectedResourceIds.length ? `${state.selectedResourceIds.length} selected` : ''}
          </div>
        </div>
        <StudioSourcePicker
          selectedIds={state.selectedResourceIds}
          onChange={(selectedResourceIds) => setState({ selectedResourceIds })}
          resources={resources}
          loadingResources={loadingResources}
          emptyLabel="No knowledge found"
        />
      </div>

      <div className="flex justify-end gap-1.5 pt-3 text-sm font-medium">
        {onCancel ? (
          <button
            disabled={generating}
            onClick={onCancel}
            className="rounded-full px-3.5 py-1.5 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
            type="button"
          >
            Cancel
          </button>
        ) : null}
        <button
          disabled={generating || !canGenerate}
          className={`flex flex-row items-center space-x-1 rounded-full bg-black px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-gray-950 dark:bg-white dark:text-black dark:hover:bg-gray-100 ${
            generating || !canGenerate ? ' cursor-not-allowed opacity-50' : ''
          }`}
          type="submit"
        >
          <span>{primaryLabel}</span>
          {generating ? (
            <div className="ml-2 self-center">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : null}
        </button>
      </div>
    </form>
  );
}

function StudioGenerateDetailModal({
  template,
  state,
  setState,
  resources,
  loadingResources,
  onClose,
  onGenerate,
  generating
}: {
  template: AiStudioTemplate;
  state: StudioModalState;
  setState: (patch: Partial<StudioModalState>) => void;
  resources: StudioSelectableResource[];
  loadingResources: boolean;
  onClose: () => void;
  onGenerate: () => void;
  generating: boolean;
}) {
  const title = template.shortTitle || template.title;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-3">
      <div className="w-full max-w-3xl overflow-visible rounded-[2rem] bg-white text-black shadow-[0_24px_80px_rgba(0,0,0,0.18)] dark:bg-gray-900 dark:text-white">
        <div className=" flex justify-between dark:text-gray-300 px-5 pt-4 pb-1">
          <div className=" text-lg font-medium self-center">
            {title}
          </div>
          <button
            onClick={onClose}
            className="self-center"
            title="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex flex-col md:flex-row w-full px-5 pb-4 md:space-x-4 dark:text-gray-200">
          <StudioGenerationForm
            template={template}
            state={state}
            setState={setState}
            resources={resources}
            loadingResources={loadingResources}
            onCancel={onClose}
            onGenerate={onGenerate}
            generating={generating}
          />
        </div>
      </div>
    </div>
  );
}

function StudioHome({
  goals,
  templates,
  artifacts,
  results,
  selectedGoal,
  setSelectedGoal,
  practiceDraft,
  setPracticeDraft,
  studioResources,
  loadingResources,
  generating,
  onOpenRecorder,
  onGenerateFromState,
  onSubmitPractice,
  onOpenResult,
  onDeleteResult
}: {
  goals: AiStudioGoalInfo[];
  templates: AiStudioTemplate[];
  artifacts: AiStudioArtifactSummary[];
  results: StudioResult[];
  selectedGoal: AiStudioGoalCategory | null;
  setSelectedGoal: (goal: AiStudioGoalCategory | null) => void;
  practiceDraft: {
    sourceIds: string[];
    prompt: string;
    templateId: string;
    questionAmount: PracticeQuestionAmount;
    difficulty: PracticeDifficulty;
  };
  setPracticeDraft: React.Dispatch<React.SetStateAction<{
    open: boolean;
    sourceIds: string[];
    prompt: string;
    templateId: string;
    questionAmount: PracticeQuestionAmount;
    difficulty: PracticeDifficulty;
  }>>;
  studioResources: StudioSelectableResource[];
  loadingResources: boolean;
  generating: boolean;
  onOpenRecorder: () => void;
  onGenerateFromState: (state: StudioModalState) => void;
  onSubmitPractice: () => void;
  onOpenResult: (id: string) => void;
  onDeleteResult: (result: StudioResult) => void;
}) {
  const [openResultMenuId, setOpenResultMenuId] = useState<string | null>(null);
  const effectiveTemplates = templates.length ? templates : visibleStudioTemplates(coreStudioTemplates);
  const goalCatalog = mergeGoalCatalog(goals);
  const selectedGoalInfo = selectedGoal ? goalCatalog.find((goal) => goal.id === selectedGoal) || null : null;
  const selectedGoalTemplates = selectedGoal ? effectiveTemplates.filter((template) => template.goal === selectedGoal) : [];
  const hasSelectedGoalTemplates = selectedGoalTemplates.length > 0;
  const [inlineModal, setInlineModal] = useState<StudioModalState | null>(null);
  const activeInlineTemplate =
    inlineModal?.templateId
      ? selectedGoalTemplates.find((template) => template.id === inlineModal.templateId) || selectedGoalTemplates[0] || null
      : selectedGoalTemplates[0] || null;
  const localArtifactIds = new Set(results.map((result) => result.artifact?.id).filter(Boolean));
  const recentLocalResults = results.slice(0, 5);
  const recentArtifacts = artifacts
    .filter((artifact) => !localArtifactIds.has(artifact.id))
    .slice(0, Math.max(0, 5 - recentLocalResults.length));
  const selectedQuestionAmount =
    practiceQuestionAmountOptions.find((option) => option.id === practiceDraft.questionAmount) || practiceQuestionAmountOptions[1];
  const selectedDifficulty =
    practiceDifficultyOptions.find((option) => option.id === practiceDraft.difficulty) || practiceDifficultyOptions[1];

  useEffect(() => {
    if (!selectedGoal || selectedGoal === 'practice') {
      setInlineModal(null);
      return;
    }
    const firstTemplate = selectedGoalTemplates[0];
    if (!firstTemplate) {
      setInlineModal(null);
      return;
    }
    setInlineModal((current) => {
      if (current?.templateId && selectedGoalTemplates.some((template) => template.id === current.templateId)) return current;
      return defaultTemplateModalState(firstTemplate);
    });
  }, [selectedGoal, selectedGoalTemplates.map((template) => template.id).join('|')]);

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
      {selectedGoal === 'practice' ? (
        <>
          <section className="px-1">
            <button
              onClick={() => setSelectedGoal(null)}
              className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[#5f6673] hover:text-[#202124]"
            >
              <ArrowLeft className="h-4 w-4" />
              AI Studio
            </button>
            <h3 className="text-xl font-semibold tracking-normal text-[#202124]">Generate practice</h3>
          </section>

          <section className="mt-5 px-1">
            <OpenWebUISelect
              label="Resource Type"
              valueLabel="Practice"
              options={[{ id: 'custom_practice', label: 'Practice' }]}
              onSelect={() => undefined}
              disabled
            />

            <div className="my-2.5">
              <div className="mb-2 text-xs text-gray-500">Prompt</div>
              <textarea
                value={practiceDraft.prompt}
                onChange={(event) => setPracticeDraft((current) => ({ ...current, prompt: event.target.value }))}
                rows={6}
                className=" text-sm w-full bg-transparent outline-hidden resize-none"
                placeholder="Write your model prompt content here"
              />
            </div>

            <div className="my-2">
              <div className="flex w-full justify-between">
                <div className=" mb-2 text-xs text-gray-500">Knowledge</div>
                <div className=" mb-2 text-xs text-gray-500">
                  {practiceDraft.sourceIds.length ? `${practiceDraft.sourceIds.length} selected` : ''}
                </div>
              </div>
              <StudioSourcePicker
                selectedIds={practiceDraft.sourceIds}
                onChange={(sourceIds) => setPracticeDraft((current) => ({ ...current, sourceIds }))}
                resources={studioResources}
                loadingResources={loadingResources}
              />
            </div>

            <div className="my-2.5 grid gap-4 md:grid-cols-2">
              <OpenWebUISelect
                label="Number of questions"
                valueLabel={selectedQuestionAmount.label}
                options={practiceQuestionAmountOptions.map((option) => ({ id: option.id, label: option.label }))}
                onSelect={(id) => setPracticeDraft((current) => ({ ...current, questionAmount: id as PracticeQuestionAmount }))}
              />
              <OpenWebUISelect
                label="Level of difficulty"
                valueLabel={selectedDifficulty.label}
                options={practiceDifficultyOptions.map((option) => ({ id: option.id, label: option.label }))}
                onSelect={(id) => setPracticeDraft((current) => ({ ...current, difficulty: id as PracticeDifficulty }))}
              />
            </div>

            <div className="flex justify-end pt-3 text-sm font-medium gap-1.5">
              <button
                onClick={onSubmitPractice}
                disabled={generating || !practiceDraft.prompt.trim()}
                className={`px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-950 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full flex flex-row space-x-1 items-center ${
                  generating || !practiceDraft.prompt.trim() ? ' cursor-not-allowed opacity-50' : ''
                }`}
              >
                <span>Generate</span>
                {generating ? (
                  <div className="ml-2 self-center">
                    <Loader2 className="size-4 animate-spin" />
                  </div>
                ) : null}
              </button>
            </div>
          </section>
        </>
      ) : !selectedGoal ? (
        <>
          <section className="flex flex-col gap-1 px-1">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2 px-0.5 text-xl font-medium text-[#202124]">
                <div>Choose a module</div>
                <div className="text-lg font-medium text-gray-500">{goalCatalog.length + 1}</div>
              </div>
            </div>

            <div className="rounded-3xl border border-gray-100/30 bg-white py-2">
              <div className="my-2 grid grid-cols-1 gap-2 px-3 lg:grid-cols-2">
                <button
                  type="button"
                  onClick={onOpenRecorder}
                  className="flex min-h-[58px] w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-gray-50"
                >
                      <span className="flex min-w-0 flex-1 items-center gap-3.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
                          <Mic className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[#202124]">Lecture Recording</span>
                        </span>
                      </span>
                  <span className="flex w-fit shrink-0 items-center rounded-xl p-1.5 text-sm text-gray-700 transition hover:bg-black/5">
                    <ChevronRight className="size-5" />
                  </span>
                </button>

                {goalCatalog.map((goal) => {
                  const Icon = goalIconMap[goal.id] || Sparkles;
                  return (
                    <button
                      key={goal.id}
                      type="button"
                      onClick={() => setSelectedGoal(goal.id)}
                      className="flex min-h-[58px] w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-gray-50"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-3.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[#202124]">{goal.en}</span>
                        </span>
                      </span>
                      <span className="flex w-fit shrink-0 items-center rounded-xl p-1.5 text-sm text-gray-700 transition hover:bg-black/5">
                        <ChevronRight className="size-5" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="px-1">
            <button
              onClick={() => setSelectedGoal(null)}
              className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-[#5f6673] hover:text-[#202124]"
            >
              <ArrowLeft className="h-4 w-4" />
              AI Studio
            </button>
            <h3 className="text-xl font-semibold tracking-normal text-[#202124]">{selectedGoalInfo?.en}</h3>
          </section>

          {hasSelectedGoalTemplates ? (
            <section className="mt-5 px-1">
              {activeInlineTemplate && inlineModal ? (
                <StudioGenerationForm
                  template={activeInlineTemplate}
                  templateOptions={selectedGoalTemplates}
                  onTemplateChange={(template) => setInlineModal((current) => ({
                    ...(current?.templateId === template.id ? current : defaultTemplateModalState(template)),
                    templateId: template.id,
                    goal: template.goal,
                    resourceType: templateResourceType(template)
                  }))}
                  state={inlineModal}
                  setState={(patch) => setInlineModal((current) => (current ? { ...current, ...patch } : current))}
                  resources={studioResources}
                  loadingResources={loadingResources}
                  onGenerate={() => onGenerateFromState(inlineModal)}
                  generating={generating}
                  compact
                />
              ) : null}
            </section>
          ) : (
            <section className="mt-4 rounded-lg border border-dashed border-[#dfe3ea] bg-white p-5 text-sm leading-6 text-[#667085]">
              当前目标暂时没有加载到可生成模板。可以返回 AI Studio 重新进入，或稍后刷新模板列表。
            </section>
          )}
        </>
      )}

      {!selectedGoal && (results.length > 0 || recentArtifacts.length > 0) && (
        <section className="mt-5 flex flex-col gap-1 px-1">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-2 px-0.5 text-xl font-medium text-[#202124]">
              <div>Recent generations</div>
              <div className="text-lg font-medium text-gray-500">{results.length + recentArtifacts.length}</div>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-100/30 bg-white py-2">
            <div className="my-2 flex flex-col gap-2 px-3">
            {results.map((result) => {
              const Icon = iconForResult(result);
              const resultMeta = resultMetaLabel(result);
              return (
                <div
                  key={result.id}
                  onClick={() => onOpenResult(result.id)}
                  className="relative flex min-h-[70px] w-full cursor-pointer items-center gap-4 rounded-2xl px-3 py-2.5 text-left transition hover:bg-gray-50"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 self-center">
                    <span className="flex items-center justify-between gap-2 -my-1 h-8">
                      <span className="min-w-0">
                        <span className="rounded-lg bg-green-500/20 px-[5px] text-xs font-medium uppercase text-green-700">
                          {result.goal || result.resourceType}
                        </span>
                      </span>
                    </span>
                    <span className="flex min-h-6 items-center gap-3 px-1.5 pr-0">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#202124]">
                        {resultDisplayTitle(result)}
                      </span>
                      <span className="hidden shrink-0 truncate text-xs text-gray-500 sm:block">
                        {resultMeta || result.name}
                      </span>
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenResultMenuId((current) => (current === result.id ? null : result.id));
                    }}
                    className="flex w-fit shrink-0 items-center self-center rounded-xl p-1.5 text-sm text-gray-700 transition hover:bg-black/5"
                    title="More actions"
                  >
                    <OWEllipsisHorizontalIcon className="size-5" />
                  </button>
                  {openResultMenuId === result.id && (
                    <div
                      onClick={(event) => event.stopPropagation()}
                      className="absolute right-10 top-10 z-20 min-w-[132px] overflow-hidden rounded-2xl border border-gray-100 bg-white px-1 py-1 text-sm text-gray-900 shadow-[0_20px_50px_rgba(32,33,36,0.14)]"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setOpenResultMenuId(null);
                          onDeleteResult(result);
                        }}
                        className="block w-full rounded-xl px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {recentArtifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="flex min-h-[70px] items-center gap-4 rounded-2xl px-3 py-2.5 text-left transition hover:bg-gray-50"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
                  <OWDocumentPageIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1 self-center">
                  <div className="flex items-center justify-between gap-2 -my-1 h-8">
                    <div>
                      <span className="rounded-lg bg-green-500/20 px-[5px] text-xs font-medium uppercase text-green-700">
                        Artifact
                      </span>
                    </div>
                  </div>
                  <div className="flex min-h-6 items-center gap-3 px-1.5 pr-0">
                    <div className="min-w-0 flex-1 truncate text-sm font-medium text-[#202124]">{artifact.title}</div>
                    <div className="hidden shrink-0 truncate text-xs text-gray-500 sm:block">
                      {artifact.summary || `${artifact.templateId} · ${artifact.templateVersion}`}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="flex w-fit shrink-0 items-center self-center rounded-xl p-1.5 text-sm text-gray-700 transition hover:bg-black/5"
                  title="More actions"
                >
                  <OWEllipsisHorizontalIcon className="size-5" />
                </button>
              </div>
            ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

const splitSlides = (content: string) =>
  content
    .split(/\n---+\n/g)
    .map((slide) => slide.trim())
    .filter(Boolean);

const cleanFlashcardDisplayText = (value?: string | null) =>
  String(value || '')
    .replace(/^\s*(?:Answer|答案)\s*[:：]\s*/i, '')
    .replace(/\n\s*(?:Difficulty|难度)\s*[:：]\s*(?:easy|medium|hard|简单|中等|困难)\s*/gi, '\n')
    .replace(/\n\s*(?:Explanation|解释)\s*[:：]\s*/gi, '\n\n')
    .replace(/\n\s*(?:Source|来源)\s*[:：][^\n]*/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const isValidFlashcardFront = (front: string) => {
  const text = String(front || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (/^(?:#+\s*)?(?:Card|卡片)\s*\d+\s*[:：-]/i.test(text)) return false;
  if (/^(?:第\s*)?\d+\s*(?:张|个)?(?:卡片|Card)\s*[:：-]/i.test(text)) return false;
  if (/(?:速记|复习|基础|进阶|专项)?(?:卡片|Card)$/i.test(text) && !/[?？]|____|\{\{c\d+::/.test(text)) return false;
  if (/^(?:章节|小节|主题|标题|目录|大纲|概览|总结|引言|背景|案例|练习|来源|参考|说明)[:：]/i.test(text)) return false;
  return (
    /[?？]/.test(text) ||
    /____|_{2,}|…|\{\{c\d+::/.test(text) ||
    /^(?:什么|为什么|如何|怎样|哪|是否|请|写出|指出|解释|描述|列出|比较|判断|说明|给出|计算|证明|When|What|Why|How|Which|Explain|Describe|List|Compare|Judge|State)\b/i.test(text) ||
    /(?:是什么|有什么作用|如何变化|为什么|哪一|是否|请写出|请指出|请解释|请描述|请列出|请比较|判断.*正误|第一步|关键步骤|最终结果|适用条件|输出什么)/.test(text)
  );
};

const parseFlashcards = (content: string) => {
  const chunks = content.split(/\n(?=#+\s|Front\s*:|Q\s*:)/i).map((item) => item.trim()).filter(Boolean);
  const cards = chunks
    .map((chunk, index) => {
      const front = chunk.match(/Front\s*:\s*([\s\S]*?)(?:\nBack\s*:|$)/i)?.[1]?.trim();
      const back = chunk.match(/Back\s*:\s*([\s\S]*?)(?:\nSource\s*:|$)/i)?.[1]?.trim();
      if (front || back) {
        const cleanedFront = cleanFlashcardDisplayText(front) || `Card ${index + 1}`;
        if (!isValidFlashcardFront(cleanedFront)) return null;
        return { front: cleanedFront, back: cleanFlashcardDisplayText(back || chunk) };
      }
      const lines = chunk.split('\n').filter(Boolean);
      const cleanedFront = cleanFlashcardDisplayText(lines[0]?.replace(/^#+\s*/, '')) || `Card ${index + 1}`;
      if (!isValidFlashcardFront(cleanedFront)) return null;
      return { front: cleanedFront, back: cleanFlashcardDisplayText(lines.slice(1).join('\n') || chunk) };
    })
    .filter((card): card is { front: string; back: string } => Boolean(card))
    .slice(0, 50);
  return cards.length ? cards : [{ front: 'Generated flashcard', back: content || 'No content generated.' }];
};

const flashcardSourceRefsForResult = (result: StudioResult): FlashcardSourceRef[] =>
  (result.summary?.citations || []).slice(0, 8).map((citation) => ({
    title: citation,
    confidence: 'medium'
  }));

const flashcardConceptFromCard = (front: string, title: string) => {
  const cleaned = cleanFlashcardDisplayText(front)
    .replace(/[?？]/g, '')
    .replace(/^(?:什么是|什么叫|为什么|如何|怎样|请解释|解释|描述|列出|比较|What is|Why|How|Explain|Describe|List|Compare)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitizedResourceTitle(cleaned, sanitizedResourceTitle(title, 'Flashcard concept')).slice(0, 120);
};

function FlashcardViewer({
  result,
  workspaceId,
  workbenchId,
  onPersistDeck
}: {
  result: StudioResult;
  workspaceId: string;
  workbenchId?: string;
  onPersistDeck?: (resultId: string, deck: FlashcardDeck) => void;
}) {
  const cards = useMemo(() => parseFlashcards(result.content), [result.content]);
  const [persistedDeck, setPersistedDeck] = useState<FlashcardDeck | null>(result.flashcardDeck || null);
  const [persistingDeck, setPersistingDeck] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const onPersistDeckRef = useRef(onPersistDeck);
  const persistRequestKeyRef = useRef('');
  const sourceRefs = useMemo(() => flashcardSourceRefsForResult(result), [result.id, result.summary?.citations]);
  const title = studioResultHeaderTitle(result);
  const sourceFileIds = useMemo(() => studioSelectedResourceIdsForResult(result), [result.id, result.metadata]);

  useEffect(() => {
    onPersistDeckRef.current = onPersistDeck;
  }, [onPersistDeck]);

  useEffect(() => {
    setPersistedDeck(result.flashcardDeck || null);
    setPersistError(null);
    persistRequestKeyRef.current = '';
  }, [result.id, result.flashcardDeck]);

  useEffect(() => {
    if (persistedDeck?.cards?.length || persistError || !cards.length) return;
    const requestKey = `${result.id}:${result.runId || 'no-run'}:${cards.length}`;
    if (persistRequestKeyRef.current === requestKey) return;
    let cancelled = false;
    persistRequestKeyRef.current = requestKey;
    setPersistingDeck(true);
    setPersistError(null);
    aiApi.createFlashcardDeck({
      workspaceId,
      workbenchId: workbenchId || null,
      title,
      description: 'Persisted from an AI Studio flashcard result.',
      source: 'ai_studio_result',
      sourceFileIds,
      sourceRefs,
      settings: {
        aiStudioResultId: result.id,
        templateId: resultTemplateId(result) || null,
        source: result.source || null,
        persistedFrom: 'ai_studio_fallback_flashcards'
      },
      generationRunId: result.runId || null,
      cards: cards.map((card, cardIndex) => ({
        front: cleanFlashcardDisplayText(card.front),
        back: cleanFlashcardDisplayText(card.back),
        cardType: 'basic',
        difficulty: 'medium',
        concept: flashcardConceptFromCard(card.front, title),
        explanation: '',
        tags: ['ai-studio'],
        sourceRefs,
        metadata: {
          aiStudioResultId: result.id,
          orderIndex: cardIndex,
          persistedFrom: 'ai_studio_fallback_flashcards'
        }
      }))
      })
      .then((response) => {
        if (!cancelled) {
          setPersistedDeck(response.deck);
          onPersistDeckRef.current?.(result.id, response.deck);
        }
      })
      .catch((error: any) => {
        persistRequestKeyRef.current = '';
        if (!cancelled) setPersistError(error?.response?.data?.error || error?.message || 'Failed to save flashcards');
      })
      .finally(() => {
        if (!cancelled) setPersistingDeck(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cards, persistedDeck?.id, persistedDeck?.cards?.length, persistError, result.id, result.runId, result.source, sourceFileIds, sourceRefs, title, workbenchId, workspaceId]);

  if (persistedDeck?.cards?.length) {
    return <FlashcardDeckViewer deck={persistedDeck} workspaceId={persistedDeck.workspaceId} allowedRatings={['again', 'good']} />;
  }

  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-4 py-5">
      <div className="relative flex h-[min(360px,50vh)] w-[min(560px,100%)] flex-col rounded-2xl border border-[#e5e7eb] bg-white p-5 text-[#202124] shadow-[0_10px_30px_rgba(32,33,36,0.08)]">
        <div className="text-xs text-[#777a80]">Saving {cards.length} flashcards</div>
        <div className="flex flex-1 items-center justify-center text-center text-xl font-semibold leading-normal">
          {persistingDeck ? 'Preparing saved flashcards...' : 'Flashcards need to be saved before review.'}
        </div>
        {persistError ? (
          <button
            onClick={() => {
              setPersistedDeck(null);
              setPersistError(null);
            }}
            className="mx-auto rounded-full border border-[#dfe3ea] px-5 py-2 text-sm font-medium text-[#343a46] hover:bg-[#f8fafc]"
          >
            Retry
          </button>
        ) : (
          <div className="mx-auto inline-flex items-center gap-2 text-sm text-[#777a80]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving
          </div>
        )}
      </div>
      {persistError && <div className="mt-3 max-w-xl text-center text-sm text-red-600">{persistError}</div>}
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

const formatRelativeTime = (value?: string) => {
  if (!value) return '';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const diffMs = Date.now() - time;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
};

function FlashcardDeckViewer({
  deck,
  workspaceId,
  allowedRatings
}: {
  deck: FlashcardDeck;
  workspaceId: string;
  allowedRatings?: FlashcardRating[];
}) {
  const [cards, setCards] = useState<FlashcardCard[]>(deck.cards || []);
  const [index, setIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loadingRating, setLoadingRating] = useState<FlashcardRating | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef(Date.now());
  const card = cards[index];
  const frontText = cleanFlashcardDisplayText(card?.front);
  const backText = cleanFlashcardDisplayText(card?.back);

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
    <div className="flex min-h-[520px] flex-col bg-white">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-5">
        <div className="grid w-full max-w-5xl grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-4">
          <div className="flex min-h-[360px] flex-col rounded-2xl border border-[#e5e7eb] bg-white p-5 text-[#202124] shadow-[0_10px_30px_rgba(32,33,36,0.08)]">
            <div className="flex items-center justify-between gap-3 text-xs text-[#777a80]">
              <span>{index + 1} / {cards.length}</span>
              <span>due {formatDue(card.dueAt)}</span>
            </div>
            <div className="flex flex-1 items-center justify-center text-center text-xl font-semibold leading-normal">
              {showAnswer ? backText : frontText}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={() => setShowAnswer((value) => !value)}
                className="rounded-full border border-[#dfe3ea] px-5 py-2 text-sm font-medium text-[#343a46] hover:bg-[#f8fafc]"
              >
                {showAnswer ? 'See question' : 'See answer'}
              </button>
              <button
                onClick={explain}
                disabled={explaining}
                className="inline-flex items-center gap-2 rounded-full border border-[#dfe3ea] px-4 py-2 text-sm font-medium text-[#343a46] hover:bg-[#f8fafc] disabled:opacity-60"
              >
                {explaining && <Loader2 className="h-4 w-4 animate-spin" />}
                Explain
              </button>
            </div>
          </div>

          <aside className="bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#96999d]">Sources</div>
            <div className="mt-3 space-y-3">
              {(card.sourceRefs || []).slice(0, 3).map((ref, refIndex) => (
                <div key={`${ref.sourceId || ref.title || refIndex}`} className="border-b border-[#eeeeeb] pb-3 last:border-b-0">
                  <div className="text-xs font-semibold text-[#202124]">{ref.sourceId || ref.title || ref.fileName || `Source ${refIndex + 1}`}</div>
                  {ref.snippet && <div className="mt-1 line-clamp-4 text-xs leading-5 text-[#6f7277]">{ref.snippet}</div>}
                </div>
              ))}
              {!card.sourceRefs?.length && <div className="text-sm text-[#777a80]">No card-level source refs.</div>}
            </div>
            {explanation && (
              <div className="mt-4 text-sm leading-6 text-[#1e3a8a]">
                {explanation}
              </div>
            )}
          </aside>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button onClick={() => move(-1)} className="rounded-full border border-[#e5e5e1] bg-white p-2 text-[#202124]">
            <ChevronLeft className="h-5 w-5" />
          </button>
          {ratingConfig.filter((item) => !allowedRatings || allowedRatings.includes(item.rating)).map((item) => (
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
    <div>
      <div className="mx-auto max-w-4xl">
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

const cleanupMermaidRenderArtifacts = (renderId: string) => {
  if (typeof document === 'undefined') return;
  const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(renderId) : renderId;
  document.querySelectorAll(`#${escapedId}, #d${escapedId}`).forEach((element) => {
    element.remove();
  });
  document.querySelectorAll('.mermaid').forEach((element) => {
    const text = element.textContent || '';
    if (/Syntax error in text/i.test(text) && /mermaid version/i.test(text)) {
      element.remove();
    }
  });
};

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
    <div className="flex h-full min-h-[620px] flex-col bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3">
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
      <div ref={hostRef} className="mind-elixir-host min-h-0 flex-1 overflow-hidden bg-white" />
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
    <div className="grid h-full min-h-[620px] bg-white">
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3">
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
      <aside className="flex min-h-0 flex-col border-t border-[#eeeeeb] bg-white">
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
    <div className="grid h-full min-h-[620px] bg-[#080b10] text-white">
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
      <aside className="flex min-h-0 flex-col border-t border-white/10 bg-[#0c1118]">
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
        await (mermaidModule as any).parse?.(mermaid);
        const { svg } = await mermaidModule.render(renderId, mermaid);
        cleanupMermaidRenderArtifacts(renderId);
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
        cleanupMermaidRenderArtifacts(`studio-mindmap-${result.id.replace(/[^a-zA-Z0-9_-]/g, '')}`);
        if (!cancelled) setRenderError(error?.message || 'Unable to render mind map');
      }
    };
    void renderMindmap();
    return () => {
      cancelled = true;
      cleanupMermaidRenderArtifacts(`studio-mindmap-${result.id.replace(/[^a-zA-Z0-9_-]/g, '')}`);
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
    <div className="flex h-full min-h-[560px] flex-col bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3">
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
      <div className="grid min-h-0 flex-1">
        <div ref={containerRef} className="min-h-0 overflow-auto bg-white">
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
        <aside className="flex min-h-0 flex-col border-t border-[#eeeeeb] bg-white">
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
    <div>
      <div className="overflow-auto bg-white">
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

const isObjectRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const extractTeachingVisualizationPayload = (result: StudioResult): TeachingVisualizationPayload | null => {
  const structured = isObjectRecord(result.structured) ? result.structured : null;
  const payload = isObjectRecord(structured?.payload) ? structured.payload : null;
  if (payload?.processTrace && payload?.visualMapping) {
    return payload as TeachingVisualizationPayload;
  }
  const parsed = (() => {
    try {
      return JSON.parse(result.content);
    } catch {
      return null;
    }
  })();
  if (isObjectRecord(parsed?.payload) && parsed.payload.processTrace && parsed.payload.visualMapping) {
    return parsed.payload as TeachingVisualizationPayload;
  }
  if (isObjectRecord(parsed) && parsed.processTrace && parsed.visualMapping) {
    return parsed as TeachingVisualizationPayload;
  }
  return null;
};

const extractVisualExplainerPayload = (result: StudioResult): VisualExplainerPayload | null => {
  const structured = isObjectRecord(result.structured) ? result.structured : null;
  const payload = isObjectRecord(structured?.payload) ? structured.payload : null;
  if (payload?.schemaVersion === 'visual_explainer.v1' && Array.isArray(payload.sections)) {
    return payload as VisualExplainerPayload;
  }
  const parsed = (() => {
    try {
      return JSON.parse(result.content);
    } catch {
      return null;
    }
  })();
  if (isObjectRecord(parsed?.payload) && parsed.payload.schemaVersion === 'visual_explainer.v1') {
    return parsed.payload as VisualExplainerPayload;
  }
  if (isObjectRecord(parsed) && parsed.schemaVersion === 'visual_explainer.v1') {
    return parsed as VisualExplainerPayload;
  }
  return null;
};

const cueForPrimitive = (step: ProcessStepIR, primitiveId: string) =>
  step.visualCues.find((cue) => cue.primitiveId === primitiveId);

const targetSetFor = (step: ProcessStepIR, primitiveId: string) =>
  new Set(cueForPrimitive(step, primitiveId)?.targetIds || step.operation.targetIds || []);

type TraceFrameState = ReturnType<typeof traceFrameAt>;

const targetSetFromFrame = (frame: TraceFrameState | null, primitiveId: string, step?: ProcessStepIR) =>
  new Set(frame?.activeTargets?.[primitiveId] || (step ? cueForPrimitive(step, primitiveId)?.targetIds || step.operation.targetIds : []));

const effectClass = (effect?: VisualCueEffect) => {
  if (effect === 'compare') return 'border-[#fbbc04] bg-[#fff8df]';
  if (effect === 'update' || effect === 'create') return 'border-[#1f5fd0] bg-[#e8f0fe]';
  if (effect === 'success') return 'border-[#34a853] bg-[#e8f6ee]';
  if (effect === 'warning') return 'border-[#ea4335] bg-[#fff1f0]';
  return 'border-[#1f5fd0] bg-[#eef4ff]';
};

const effectStyles = (effect?: VisualCueEffect) => {
  if (effect === 'compare') return { border: '#fbbc04', background: '#fff8df', text: '#9a6700', shadow: 'rgba(251, 188, 4, 0.28)' };
  if (effect === 'update' || effect === 'create') return { border: '#1f5fd0', background: '#e8f0fe', text: '#174ea6', shadow: 'rgba(31, 95, 208, 0.25)' };
  if (effect === 'success') return { border: '#34a853', background: '#e8f6ee', text: '#137333', shadow: 'rgba(52, 168, 83, 0.26)' };
  if (effect === 'warning') return { border: '#ea4335', background: '#fff1f0', text: '#a50e0e', shadow: 'rgba(234, 67, 53, 0.24)' };
  return { border: '#1f5fd0', background: '#eef4ff', text: '#174ea6', shadow: 'rgba(31, 95, 208, 0.22)' };
};

const rendererLabels: Record<VisualPrimitiveKind, string> = {
  sequence: 'Sequence Renderer',
  table: 'Table Renderer',
  graph: 'Graph Renderer',
  state_machine: 'State Machine Renderer',
  formula: 'Formula Renderer',
  variables: 'Variables Renderer',
  text: 'Text Renderer'
};

const mergeTraceState = (base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...base };
  Object.entries(patch || {}).forEach(([key, value]) => {
    const current = next[key];
    if (isObjectRecord(current) && isObjectRecord(value)) {
      next[key] = mergeTraceState(current, value);
      return;
    }
    next[key] = value;
  });
  return next;
};

const traceFrameAt = (trace: ProcessTraceIR, index: number) => {
  let state = isObjectRecord(trace.initialState) ? trace.initialState : {};
  for (let stepIndex = 0; stepIndex <= index && stepIndex < trace.steps.length; stepIndex += 1) {
    const patch = trace.steps[stepIndex]?.statePatch;
    state = mergeTraceState(state, isObjectRecord(patch) ? patch : {});
  }
  const step = trace.steps[index] || trace.steps[0];
  const activeTargets: Record<string, string[]> = {};
  const effects: Record<string, VisualCueEffect> = {};
  (step?.visualCues || []).forEach((cue) => {
    activeTargets[cue.primitiveId] = cue.targetIds || [];
    effects[cue.primitiveId] = cue.effect;
  });
  return {
    schemaVersion: 'trace_runtime.v1',
    index,
    stepId: step?.id || '',
    title: step?.title || '',
    state,
    activeTargets,
    effects
  };
};

const traceDiffAt = (current: TraceFrameState | null, previous: TraceFrameState | null) => {
  if (!current) return [];
  const changes: Array<{ path: string; before?: unknown; after?: unknown }> = [];
  const collect = (before: unknown, after: unknown, path: string) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (!isObjectRecord(before) || !isObjectRecord(after)) {
      changes.push({ path, before, after });
      return;
    }
    Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).forEach((key) => collect(before[key], after[key], `${path}.${key}`));
  };
  collect(previous?.state || {}, current.state, 'state');
  return changes.slice(0, 8);
};

const firstArrayAtKeys = (state: Record<string, unknown>, keys: string[]): unknown[] | null => {
  for (const key of keys) {
    const value = state[key];
    if (Array.isArray(value)) return value;
  }
  for (const value of Object.values(state)) {
    if (isObjectRecord(value)) {
      const nested = firstArrayAtKeys(value, keys);
      if (nested) return nested;
    }
  }
  return null;
};

const displayValue = (value: unknown) => {
  if (isObjectRecord(value)) return String(value.label ?? value.value ?? value.id ?? '');
  return String(value ?? '');
};

const stableValueId = (value: unknown, index: number, fallbackId?: string) => {
  if (isObjectRecord(value) && value.id) return String(value.id);
  if (fallbackId) return fallbackId;
  return `v-${displayValue(value).replace(/[^a-zA-Z0-9_-]+/g, '_') || index}-${index}`;
};

const normalizeSequenceRendererState = (primitive: VisualPrimitiveIR, frame: TraceFrameState | null, previousFrame: TraceFrameState | null) => {
  const baseItems = Array.isArray(primitive.data.items) ? primitive.data.items : [];
  const currentValues = frame ? firstArrayAtKeys(frame.state, ['sequence', 'array', 'items', 'elements', 'currentArray', 'values', 'data']) || baseItems : baseItems;
  const previousValues = previousFrame ? firstArrayAtKeys(previousFrame.state, ['sequence', 'array', 'items', 'elements', 'currentArray', 'values', 'data']) || baseItems : baseItems;
  const activeTargets = new Set(frame?.activeTargets?.[primitive.id] || []);
  const variables = isObjectRecord(frame?.state.variables) ? frame?.state.variables : {};
  const items = currentValues.map((value: any, index: number) => {
    const id = stableValueId(value, index, baseItems[index]?.id);
    const previousIndex = previousValues.findIndex((candidate: any, candidateIndex: number) =>
      stableValueId(candidate, candidateIndex, baseItems[candidateIndex]?.id) === id || displayValue(candidate) === displayValue(value)
    );
    return {
      id,
      value: isObjectRecord(value) && 'value' in value ? value.value : value,
      label: displayValue(value),
      index,
      previousIndex: previousIndex >= 0 ? previousIndex : index,
      status: activeTargets.has(id) ? frame?.effects?.[primitive.id] || 'focus' : undefined
    };
  });
  const pointers = Object.entries(variables)
    .filter(([, value]) => typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))
    .map(([label, value]) => ({ id: `ptr-${label}`, label, index: Number(value) }));
  const keyValue = frame?.state.key ?? frame?.state.candidate ?? frame?.state.current ?? frame?.state.pivot;
  return {
    schemaVersion: 'sequence_renderer_state.v1',
    items,
    pointers,
    key: keyValue === undefined ? null : { id: 'key', label: displayValue(keyValue), value: keyValue }
  };
};

const normalizeTableRendererState = (primitive: VisualPrimitiveIR, frame: TraceFrameState | null, previousFrame: TraceFrameState | null) => {
  const activeTargets = new Set(frame?.activeTargets?.[primitive.id] || []);
  const rows = Array.isArray(frame?.state.outputRows) && primitive.id.includes('output')
    ? frame?.state.outputRows
    : Array.isArray(frame?.state.rows) && primitive.id.includes('output')
      ? frame?.state.rows
      : Array.isArray(primitive.data.rows)
        ? primitive.data.rows
        : [];
  const previousRows = Array.isArray(previousFrame?.state.outputRows) ? previousFrame?.state.outputRows : [];
  const previousIds = new Set(previousRows.map((row: any, index: number) => String(row.id || `row-${index}`)));
  return {
    schemaVersion: 'table_renderer_state.v1',
    columns: Array.isArray(primitive.data.columns) ? primitive.data.columns : [],
    rows: rows.map((row: any, index: number) => {
      const id = String(row.id || `row-${index}`);
      return {
        id,
        cells: Array.isArray(row.cells) ? row.cells : Object.values(row),
        status: activeTargets.has(id) ? frame?.effects?.[primitive.id] || 'focus' : !previousIds.has(id) ? 'create' : undefined
      };
    })
  };
};

const normalizeGraphRendererState = (primitive: VisualPrimitiveIR, frame: TraceFrameState | null) => {
  const activeTargets = new Set(frame?.activeTargets?.[primitive.id] || []);
  return {
    schemaVersion: 'graph_renderer_state.v1',
    nodes: (Array.isArray(primitive.data.nodes) ? primitive.data.nodes : []).map((node: any, index: number) => {
      const id = String(node.id || `node-${index}`);
      return { ...node, id, status: activeTargets.has(id) ? frame?.effects?.[primitive.id] || 'focus' : undefined };
    }),
    edges: (Array.isArray(primitive.data.edges) ? primitive.data.edges : []).map((edge: any, index: number) => {
      const id = String(edge.id || `edge-${index}`);
      return { ...edge, id, status: activeTargets.has(id) ? frame?.effects?.[primitive.id] || 'focus' : undefined };
    }),
    current: frame?.state.current || frame?.state.currentState || frame?.state.currentSubset,
    frontier: frame?.state.frontier,
    visited: frame?.state.visited,
    queue: frame?.state.queue,
    stack: frame?.state.stack,
    subset: frame?.state.currentSubset || frame?.state.subset,
    alphabet: frame?.state.alphabet,
    transitionTable: frame?.state.rows || frame?.state.transitionTable || frame?.state.table
  };
};

const visualActionsForPrimitive = (primitive: VisualPrimitiveIR, step: ProcessStepIR, frame: TraceFrameState | null, previousFrame: TraceFrameState | null): VisualAction[] => {
  const targetIds = frame?.activeTargets?.[primitive.id] || cueForPrimitive(step, primitive.id)?.targetIds || step.operation.targetIds || [];
  const actions: VisualAction[] = targetIds.length
    ? [{
        id: `${step.id}-${primitive.id}-focus`,
        type: step.operation.type === 'compare' ? 'compare' : step.operation.type === 'emit' ? 'emit' : step.operation.type === 'transition' ? 'traverse' : 'highlight',
        primitiveId: primitive.id,
        targetIds,
        label: step.operation.description,
        durationMs: 420
      }]
    : [];
  if (primitive.kind === 'sequence') {
    const state = normalizeSequenceRendererState(primitive, frame, previousFrame);
    state.items.forEach((item: any) => {
      if (item.previousIndex !== item.index) {
        actions.push({
          id: `${step.id}-${primitive.id}-move-${item.id}`,
          type: 'move',
          primitiveId: primitive.id,
          targetIds: [item.id],
          fromIndex: item.previousIndex,
          toIndex: item.index,
          value: item.value,
          durationMs: 680
        });
      }
    });
    if (state.key) {
      actions.unshift({
        id: `${step.id}-${primitive.id}-key`,
        type: 'insert',
        primitiveId: primitive.id,
        targetIds,
        value: state.key.value,
        label: `key=${state.key.label}`,
        durationMs: 520
      });
    }
  }
  if (primitive.kind === 'graph' || primitive.kind === 'state_machine') {
    const edgeIds = new Set((Array.isArray(primitive.data.edges) ? primitive.data.edges : []).map((edge: any, edgeIndex: number) => String(edge.id || `edge-${edgeIndex}`)));
    targetIds.forEach((targetId, targetIndex) => {
      actions.push({
        id: `${step.id}-${primitive.id}-graph-${targetId}-${targetIndex}`,
        type: edgeIds.has(targetId) || targetId.includes('->') ? 'traverse' : step.operation.type === 'update' ? 'update' : 'highlight',
        primitiveId: primitive.id,
        targetIds: [targetId],
        label: step.operation.description,
        durationMs: 620
      });
    });
    const frontier = frame?.state.frontier || frame?.state.queue;
    if (Array.isArray(frontier)) {
      actions.push({
        id: `${step.id}-${primitive.id}-frontier`,
        type: 'update',
        primitiveId: primitive.id,
        targetIds: frontier.map(String),
        label: 'update frontier / queue',
        durationMs: 460
      });
    }
    const subset = frame?.state.currentSubset || frame?.state.subset;
    if (Array.isArray(subset)) {
      actions.push({
        id: `${step.id}-${primitive.id}-subset`,
        type: 'create',
        primitiveId: primitive.id,
        targetIds: subset.map(String),
        label: 'construct DFA subset state',
        durationMs: 620
      });
    }
  }
  return actions;
};

const localRendererViewState = (primitive: VisualPrimitiveIR, step: ProcessStepIR, frame: TraceFrameState | null, previousFrame: TraceFrameState | null): RendererViewState => {
  const rendererState = primitive.kind === 'sequence'
    ? normalizeSequenceRendererState(primitive, frame, previousFrame)
    : primitive.kind === 'table'
      ? normalizeTableRendererState(primitive, frame, previousFrame)
      : primitive.kind === 'graph' || primitive.kind === 'state_machine'
        ? normalizeGraphRendererState(primitive, frame)
        : { schemaVersion: 'generic_renderer_state.v1', data: primitive.data, state: frame?.state || {} };
  const visualActions = visualActionsForPrimitive(primitive, step, frame, previousFrame);
  return {
    viewId: `view-${primitive.id}`,
    primitiveId: primitive.id,
    kind: primitive.kind,
    title: primitive.label,
    effect: frame?.effects?.[primitive.id],
    activeTargets: frame?.activeTargets?.[primitive.id] || [],
    rendererState,
    visualActions,
    animationTimeline: visualActions.map((action, actionIndex) => ({
      id: `segment-${action.id}`,
      actionId: action.id,
      offsetMs: actionIndex * 420,
      durationMs: action.durationMs,
      easing: 'ease-in-out'
    }))
  };
};

const rendererStateAt = (
  trace: ProcessTraceIR,
  mapping: VisualMappingIR | undefined,
  frame: TraceFrameState | null,
  previousFrame: TraceFrameState | null,
  contractRendererState?: RendererStateResult
) => {
  if (!frame) return null;
  const serverFrame = contractRendererState?.frames?.find((item) => item.index === frame.index || item.stepId === frame.stepId);
  if (serverFrame) return { ...serverFrame, diff: serverFrame.diff || traceDiffAt(frame, previousFrame) };
  const diff = traceDiffAt(frame, previousFrame);
  const primitiveById = new Map(trace.stateModel.primitives.map((primitive) => [primitive.id, primitive]));
  const views = (mapping?.views || trace.stateModel.primitives.map((primitive, index) => ({
    id: `view-${primitive.id}`,
    primitiveId: primitive.id,
    kind: primitive.kind,
    title: primitive.label,
    priority: index + 1
  })))
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((view) => {
      const primitive = primitiveById.get(view.primitiveId);
      return primitive ? { ...localRendererViewState(primitive, trace.steps[frame.index] || trace.steps[0], frame, previousFrame), viewId: view.id, title: view.title, diff } as RendererViewState : null;
    })
    .filter((view): view is RendererViewState => Boolean(view));
  return {
    schemaVersion: 'renderer_state.v1',
    frameIndex: frame.index,
    stepId: frame.stepId,
    views,
    diff
  };
};

const downloadJson = (filename: string, value: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

function SequencePrimitiveView({
  primitive,
  step,
  frame,
  previousFrame,
  viewState,
  chromeless = false
}: {
  primitive: VisualPrimitiveIR;
  step: ProcessStepIR;
  frame: TraceFrameState | null;
  previousFrame: TraceFrameState | null;
  viewState?: RendererViewState;
  chromeless?: boolean;
}) {
  const targets = targetSetFromFrame(frame, primitive.id, step);
  const effect = viewState?.effect || frame?.effects?.[primitive.id] || cueForPrimitive(step, primitive.id)?.effect;
  const style = effectStyles(effect);
  const normalized = viewState?.rendererState?.schemaVersion === 'sequence_renderer_state.v1'
    ? viewState.rendererState
    : normalizeSequenceRendererState(primitive, frame, previousFrame);
  const items = Array.isArray(normalized.items) ? normalized.items : [];
  const pointerEntries = Array.isArray(normalized.pointers) ? normalized.pointers : [];
  const primitivePointers = Array.isArray(primitive.data.pointers) ? primitive.data.pointers : [];
  const actions = viewState?.visualActions || visualActionsForPrimitive(primitive, step, frame, previousFrame);
  const movingIds = new Set(actions.filter((action) => action.type === 'move' || action.type === 'swap').flatMap((action) => action.targetIds));
  const keyState = isObjectRecord(normalized.key) ? normalized.key : null;
  return (
    <div className={chromeless ? 'overflow-visible bg-transparent' : 'overflow-hidden rounded-xl border border-[#dfe3ea] bg-white shadow-sm'}>
      {!chromeless ? <div className="flex items-center justify-between border-b border-[#eef1f5] px-5 py-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">Sequence Renderer</div>
          <div className="mt-1 text-lg font-semibold text-[#202124]">{primitive.label}</div>
        </div>
        <div className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: style.background, color: style.text }}>
          {effect || 'focus'}
        </div>
      </div> : null}
      <div className={chromeless ? 'min-h-[240px] bg-transparent px-2 py-4' : 'min-h-[300px] bg-[#fbfcfd] px-6 py-8'}>
        {keyState ? (
          <div className="mb-5 flex justify-center">
            <div className="rounded-xl border-2 border-dashed px-5 py-3 text-center transition-all duration-500" style={{ borderColor: style.border, background: style.background, color: style.text }}>
              <div className="text-[10px] font-semibold uppercase tracking-wide">Key / Pivot</div>
              <div className="mt-1 text-2xl font-bold">{String(keyState.label ?? keyState.value)}</div>
            </div>
          </div>
        ) : null}
        <div className="flex min-h-[190px] flex-wrap items-center justify-center gap-4">
        {items.map((item: any, index: number) => {
          const id = String(item.id || `item-${index}`);
          const active = targets.has(id) || viewState?.activeTargets?.includes(id) || Boolean(item.status);
          const changed = typeof item.previousIndex === 'number' && item.previousIndex !== item.index;
          const moving = movingIds.has(id) || changed;
          const pointerLabels = [
            ...primitivePointers.filter((pointer: any) => pointer.targetId === id).map((pointer: any) => pointer.label),
            ...pointerEntries.filter((pointer) => pointer.index === index).map((pointer) => pointer.label)
          ];
          return (
            <div key={id} className="flex flex-col items-center gap-3">
              <div
                className={`flex h-24 min-w-20 items-center justify-center rounded-xl border-2 px-5 text-3xl font-bold transition-all duration-500 ${
                  active ? 'scale-110 shadow-xl' : 'scale-100 shadow-sm'
                } ${moving ? 'animate-pulse' : ''}`}
                style={{
                  borderColor: active ? style.border : '#dfe3ea',
                  background: active ? style.background : '#ffffff',
                  color: active ? style.text : '#202124',
                  boxShadow: active ? `0 18px 34px ${style.shadow}` : undefined,
                  transform: moving ? `translateY(${(item.previousIndex ?? index) > index ? '-8px' : '8px'}) scale(${active ? 1.1 : 1})` : undefined
                }}
              >
                {String(item.label ?? item.value ?? index)}
              </div>
              <div className="h-4 text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                {moving ? `${item.previousIndex} -> ${item.index}` : `#${index}`}
              </div>
              <div className="flex h-7 flex-wrap justify-center gap-1">
                {pointerLabels.map((label) => (
                  <span key={label} className="rounded-full bg-[#202124] px-2 py-1 text-xs font-semibold text-white">{label}</span>
                ))}
              </div>
            </div>
          );
        })}
        </div>
        {!chromeless && actions.length ? (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {actions.slice(0, 4).map((action) => (
              <span key={action.id} className="rounded-full border border-[#dfe3ea] bg-white px-3 py-1.5 text-xs font-semibold text-[#4f5665]">
                {action.type}{action.label ? `: ${action.label}` : ''}
              </span>
            ))}
          </div>
        ) : null}
        {!chromeless && isObjectRecord(frame?.state.variables) ? (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {Object.entries(frame?.state.variables || {}).map(([key, value]) => (
              <span key={key} className="rounded-full border border-[#dfe3ea] bg-white px-3 py-1.5 text-sm font-semibold text-[#4f5665]">
                {key} = {String(value)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TablePrimitiveView({
  primitive,
  step,
  frame,
  previousFrame,
  viewState,
  chromeless = false
}: {
  primitive: VisualPrimitiveIR;
  step: ProcessStepIR;
  frame: TraceFrameState | null;
  previousFrame: TraceFrameState | null;
  viewState?: RendererViewState;
  chromeless?: boolean;
}) {
  const targets = targetSetFromFrame(frame, primitive.id, step);
  const effect = viewState?.effect || frame?.effects?.[primitive.id] || cueForPrimitive(step, primitive.id)?.effect;
  const style = effectStyles(effect);
  const normalized = viewState?.rendererState?.schemaVersion === 'table_renderer_state.v1'
    ? viewState.rendererState
    : normalizeTableRendererState(primitive, frame, previousFrame);
  const columns = Array.isArray(normalized.columns) ? normalized.columns : [];
  const visibleRows = Array.isArray(normalized.rows) ? normalized.rows : [];
  return (
    <div className={chromeless ? 'overflow-hidden rounded-xl border border-[#d8dde7] bg-white/90 shadow-[0_10px_24px_rgba(15,23,42,0.08)]' : 'overflow-hidden rounded-xl border border-[#dfe3ea] bg-white shadow-sm'}>
      {!chromeless ? <div className="flex items-center justify-between border-b border-[#eef1f5] px-5 py-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">Table Renderer</div>
          <div className="mt-1 text-lg font-semibold text-[#202124]">{primitive.label}</div>
        </div>
        <div className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: style.background, color: style.text }}>
          {effect || 'focus'}
        </div>
      </div> : null}
      <table className="min-w-full border-collapse text-left text-base">
        <thead className="bg-[#f6f7fb] text-[#667085]">
          <tr>{columns.map((column: string) => <th key={column} className="border-b border-[#e5e7eb] px-5 py-4 font-semibold">{column}</th>)}</tr>
        </thead>
        <tbody>
          {visibleRows.map((row: any, rowIndex: number) => {
            const id = String(row.id || `row-${rowIndex}`);
            const active = targets.has(id) || Boolean(row.status);
            const created = row.status === 'create';
            return (
              <tr
                key={id}
                className={`transition-all duration-500 ${created ? 'animate-pulse' : ''}`}
                style={{
                  background: active || created ? style.background : rowIndex % 2 ? '#fbfbfa' : '#fff',
                  color: active || created ? style.text : '#34373c'
                }}
              >
                {(Array.isArray(row.cells) ? row.cells : Object.values(row)).map((cell: any, cellIndex: number) => (
                  <td key={`${id}-${cellIndex}`} className="border-b border-[#eeeeeb] px-5 py-4 font-medium">{String(cell)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GraphPrimitiveView({
  primitive,
  step,
  frame,
  viewState,
  chromeless = false
}: {
  primitive: VisualPrimitiveIR;
  step: ProcessStepIR;
  frame: TraceFrameState | null;
  viewState?: RendererViewState;
  chromeless?: boolean;
}) {
  const targets = targetSetFromFrame(frame, primitive.id, step);
  const effect = viewState?.effect || frame?.effects?.[primitive.id] || cueForPrimitive(step, primitive.id)?.effect;
  const style = effectStyles(effect);
  const normalized = viewState?.rendererState?.schemaVersion === 'graph_renderer_state.v1'
    ? viewState.rendererState
    : normalizeGraphRendererState(primitive, frame);
  const nodes = Array.isArray(normalized.nodes) ? normalized.nodes : [];
  const edges = Array.isArray(normalized.edges) ? normalized.edges : [];
  const positions = nodes.map((node: any, index: number) => {
    const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1) - Math.PI / 2;
    return {
      id: String(node.id || `node-${index}`),
      node,
      x: 50 + Math.cos(angle) * 34,
      y: 50 + Math.sin(angle) * 34
    };
  });
  const positionById = new Map(positions.map((position) => [position.id, position]));
  return (
    <div className={chromeless ? 'overflow-visible bg-transparent' : 'overflow-hidden rounded-xl border border-[#dfe3ea] bg-white shadow-sm'}>
      {!chromeless ? <div className="flex items-center justify-between border-b border-[#eef1f5] px-5 py-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">{primitive.kind === 'state_machine' ? 'State Machine Renderer' : 'Graph Renderer'}</div>
          <div className="mt-1 text-lg font-semibold text-[#202124]">{primitive.label}</div>
        </div>
        <div className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: style.background, color: style.text }}>
          {effect || 'focus'}
        </div>
      </div> : null}
      <div className={chromeless ? 'grid gap-4 p-0' : 'grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_240px]'}>
        <div className={chromeless ? 'relative min-h-[320px] overflow-visible rounded-xl bg-transparent' : 'relative min-h-[360px] overflow-hidden rounded-xl bg-[#fbfcfd]'}>
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {edges.map((edge: any, index: number) => {
              const id = String(edge.id || `edge-${index}`);
              const source = positionById.get(String(edge.source));
              const target = positionById.get(String(edge.target));
              if (!source || !target) return null;
              const active = targets.has(id) || Boolean(edge.status);
              return (
                <g key={id}>
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={active ? style.border : '#cbd5e1'}
                    strokeWidth={active ? 1.2 : 0.55}
                    strokeLinecap="round"
                    className="transition-all duration-500"
                  />
                  <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 2} textAnchor="middle" fontSize="3" fill={active ? style.text : '#64748b'}>
                    {String(edge.label || '')}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="absolute inset-0">
            {positions.map(({ id, node, x, y }) => {
              const active = targets.has(id) || Boolean((node as any).status);
              return (
                <div
                  key={id}
                  className={`absolute flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-lg font-bold transition-all duration-500 ${
                    active ? 'scale-110 shadow-xl' : 'scale-100 shadow-sm'
                  }`}
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    borderColor: active ? style.border : '#dfe3ea',
                    background: active ? style.background : '#fff',
                    color: active ? style.text : '#202124',
                    boxShadow: active ? `0 16px 30px ${style.shadow}` : undefined
                  }}
                >
                  {String(node.label || id)}
                </div>
              );
            })}
          </div>
        </div>
        {!chromeless ? <div className="space-y-3">
          {normalized.current || normalized.frontier || normalized.visited || normalized.queue || normalized.subset ? (
            <div className="rounded-xl border border-[#edf0f5] bg-[#fbfcfd] p-3 text-xs leading-5 text-[#4f5665]">
              {normalized.current ? <div><span className="font-semibold text-[#202124]">Current:</span> {Array.isArray(normalized.current) ? normalized.current.join(', ') : String(normalized.current)}</div> : null}
              {normalized.subset ? <div><span className="font-semibold text-[#202124]">Subset:</span> {Array.isArray(normalized.subset) ? `{${normalized.subset.join(', ')}}` : String(normalized.subset)}</div> : null}
              {normalized.frontier || normalized.queue ? <div><span className="font-semibold text-[#202124]">Frontier:</span> {String((normalized.frontier || normalized.queue || []).join?.(', ') || normalized.frontier || normalized.queue)}</div> : null}
              {normalized.visited ? <div><span className="font-semibold text-[#202124]">Visited:</span> {String((normalized.visited || []).join?.(', ') || normalized.visited)}</div> : null}
            </div>
          ) : null}
          {edges.map((edge: any, index: number) => {
            const id = String(edge.id || `edge-${index}`);
            const active = targets.has(id) || Boolean(edge.status);
            return (
              <div key={id} className={`rounded-lg border px-3 py-2 text-xs transition-all duration-500 ${active ? effectClass(effect) : 'border-[#edf0f5] bg-[#fbfcfd]'}`}>
                {String(edge.source)} {'->'} {String(edge.target)} {edge.label ? `(${edge.label})` : ''}
              </div>
            );
          })}
        </div> : null}
      </div>
    </div>
  );
}

function FormulaPrimitiveView({ primitive, step, frame, chromeless = false }: { primitive: VisualPrimitiveIR; step: ProcessStepIR; frame: TraceFrameState | null; chromeless?: boolean }) {
  const targets = targetSetFromFrame(frame, primitive.id, step);
  const effect = frame?.effects?.[primitive.id] || cueForPrimitive(step, primitive.id)?.effect;
  const style = effectStyles(effect);
  const tokens = Array.isArray(primitive.data.tokens) ? primitive.data.tokens : [];
  return (
    <div className={chromeless ? 'overflow-visible bg-transparent' : 'overflow-hidden rounded-xl border border-[#dfe3ea] bg-white shadow-sm'}>
      {!chromeless ? <div className="flex items-center justify-between border-b border-[#eef1f5] px-5 py-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">Formula Renderer</div>
          <div className="mt-1 text-lg font-semibold text-[#202124]">{primitive.label}</div>
        </div>
        <div className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: style.background, color: style.text }}>
          {effect || 'focus'}
        </div>
      </div> : null}
      <div className={chromeless ? 'flex min-h-[200px] flex-wrap items-center justify-center gap-4 bg-transparent p-4' : 'flex min-h-[260px] flex-wrap items-center justify-center gap-4 bg-[#fbfcfd] p-8'}>
        {tokens.map((token: any, index: number) => {
          const id = String(token.id || `token-${index}`);
          const active = targets.has(id);
          return (
            <div key={id} className="flex items-center gap-4">
              <div
                className={`rounded-xl border-2 px-6 py-4 text-2xl font-bold transition-all duration-500 ${active ? 'scale-110 shadow-xl' : 'scale-100 shadow-sm'}`}
                style={{
                  borderColor: active ? style.border : '#dfe3ea',
                  background: active ? style.background : '#fff',
                  color: active ? style.text : '#202124',
                  boxShadow: active ? `0 16px 30px ${style.shadow}` : undefined
                }}
              >
                {String(token.label || token.value || id)}
              </div>
              {index < tokens.length - 1 ? <div className="text-2xl font-bold text-[#94a3b8]">→</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PrimitiveView({
  primitive,
  step,
  frame,
  previousFrame,
  viewState,
  chromeless = false
}: {
  primitive: VisualPrimitiveIR;
  step: ProcessStepIR;
  frame: TraceFrameState | null;
  previousFrame: TraceFrameState | null;
  viewState?: RendererViewState;
  chromeless?: boolean;
}) {
  if (primitive.kind === 'sequence') return <SequencePrimitiveView primitive={primitive} step={step} frame={frame} previousFrame={previousFrame} viewState={viewState} chromeless={chromeless} />;
  if (primitive.kind === 'table') return <TablePrimitiveView primitive={primitive} step={step} frame={frame} previousFrame={previousFrame} viewState={viewState} chromeless={chromeless} />;
  if (primitive.kind === 'graph' || primitive.kind === 'state_machine') return <GraphPrimitiveView primitive={primitive} step={step} frame={frame} viewState={viewState} chromeless={chromeless} />;
  if (primitive.kind === 'formula') return <FormulaPrimitiveView primitive={primitive} step={step} frame={frame} chromeless={chromeless} />;
  return (
    <div className="rounded-lg border border-[#e5e5e1] bg-white p-4">
      <div className="text-sm font-semibold text-[#202124]">{primitive.label}</div>
      <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-[#f8fafc] p-3 text-xs text-[#667085]">{JSON.stringify(primitive.data, null, 2)}</pre>
    </div>
  );
}

const primitiveStageSlot = (primitive: VisualPrimitiveIR, index: number, total: number) => {
  const role = `${primitive.role || primitive.label || primitive.id}`.toLowerCase();
  const domainHint = primitive.kind;
  if (total <= 1) return { left: 8, top: 15, width: 84, rotate: 0 };
  if (/left|左|source|input|a\b|r\b|nfa/.test(role)) return { left: 6, top: 14, width: domainHint === 'graph' || domainHint === 'state_machine' ? 43 : 37, rotate: -1 };
  if (/right|右|target|lookup|b\b|s\b|dfa/.test(role)) return { left: 54, top: 16, width: domainHint === 'graph' || domainHint === 'state_machine' ? 40 : 37, rotate: 1 };
  if (/result|output|joined|结果|输出/.test(role)) return { left: total > 2 ? 22 : 52, top: total > 2 ? 60 : 48, width: total > 2 ? 48 : 40, rotate: -0.5 };
  const slots = [
    { left: 7, top: 17, width: 38, rotate: -1 },
    { left: 55, top: 17, width: 38, rotate: 1 },
    { left: 25, top: 59, width: 48, rotate: -0.5 },
    { left: 6, top: 55, width: 34, rotate: 0.5 },
    { left: 61, top: 56, width: 33, rotate: -0.5 }
  ];
  return slots[index % slots.length];
};

const primitiveStageMinHeight = (count: number) => {
  if (count <= 1) return 'min-h-[620px]';
  if (count <= 2) return 'min-h-[680px]';
  return 'min-h-[760px]';
};

type SceneObjectKind = 'title' | 'note' | 'register' | 'bits' | 'calculation' | 'decision' | 'arrow' | 'table' | 'graph';

interface SceneObject {
  id: string;
  kind: SceneObjectKind;
  label?: string;
  value?: string;
  rows?: Array<{ id: string; label: string; cells: string[]; active?: boolean; changed?: boolean }>;
  columns?: string[];
  bits?: Array<{ id: string; value: string; active?: boolean; changed?: boolean; muted?: boolean }>;
  operands?: string[];
  result?: string;
  nodes?: Array<{ id: string; label: string; active?: boolean; x: number; y: number }>;
  edges?: Array<{ id: string; source: string; target: string; active?: boolean; label?: string }>;
  x: number;
  y: number;
  w: number;
  h: number;
  emphasis?: 'primary' | 'active' | 'changed' | 'muted';
}

const compactSceneLabel = (value: unknown, fallback = ''): string => {
  if (isObjectRecord(value)) {
    return String(value.label ?? value.name ?? value.title ?? value.value ?? value.id ?? fallback);
  }
  if (Array.isArray(value)) return value.map((item) => compactSceneLabel(item)).join(', ');
  return String(value ?? fallback);
};

const binaryLike = (value: unknown) => /^[01]+(?:\.[01]+)?$/.test(String(value ?? '').trim());

const isInternalScenePrimitive = (primitive: VisualPrimitiveIR) =>
  /控制面板|步骤序列|变量|variables|timeline|action|workflow|debug|metadata/i.test(`${primitive.id} ${primitive.role || ''} ${primitive.label}`);

const bitsFromValue = (value: unknown, activeIndex?: number): SceneObject['bits'] => {
  const text = String(value ?? '').trim();
  return text.split('').map((char, index) => ({
    id: `bit-${index}`,
    value: char,
    active: index === activeIndex || (activeIndex == null && index === text.length - 1 && /[01]/.test(char)),
    muted: char === '.'
  }));
};

const primitiveRows = (primitive: VisualPrimitiveIR, frame: TraceFrameState | null, previousFrame: TraceFrameState | null, activeTargets: Set<string>) => {
  const normalized = normalizeTableRendererState(primitive, frame, previousFrame);
  const columns = (Array.isArray(normalized.columns) && normalized.columns.length ? normalized.columns : ['对象', '当前值']).map(String);
  const rows = Array.isArray(normalized.rows) && normalized.rows.length
    ? normalized.rows.map((row: any, rowIndex: number) => {
        const id = String(row.id || `row-${rowIndex}`);
        const cells = Array.isArray(row.cells) ? row.cells.map(String) : Object.values(row).map(String);
        return { id, label: id, cells, active: activeTargets.has(id) || Boolean(row.status), changed: row.status === 'create' || row.status === 'update' };
      })
    : Object.entries(primitive.data || {})
        .filter(([, value]) => value !== undefined && value !== null && typeof value !== 'object')
        .slice(0, 6)
        .map(([key, value]) => ({ id: `${primitive.id}-${key}`, label: key, cells: [key, compactSceneLabel(value)], active: activeTargets.has(key) }));
  return { columns, rows };
};

const calculationFromText = (text: string) => {
  const match = text.match(/([01]+(?:\.[01]+)?)\s*([+\-×x*÷/])\s*([01]+(?:\.[01]+)?)\s*=\s*([01]+(?:\.[01]+)?)/);
  if (!match) return null;
  return { operands: [match[1], match[3]], operator: match[2], result: match[4] };
};

const sceneObjectsFor = (
  primitives: VisualPrimitiveIR[],
  step: ProcessStepIR,
  frame: TraceFrameState | null,
  previousFrame: TraceFrameState | null,
  viewStateByPrimitiveId: Map<string, RendererViewState>,
  currentAction: VisualAction | undefined,
  variables: Record<string, unknown>
): SceneObject[] => {
  const objects: SceneObject[] = [
    {
      id: 'scene-title',
      kind: 'title',
      label: step.title,
      value: step.goal || step.operation.description,
      x: 4,
      y: 5,
      w: 58,
      h: 14,
      emphasis: 'primary'
    },
    {
      id: 'scene-decision',
      kind: 'decision',
      label: currentAction?.type || step.operation.type,
      value: currentAction?.label || step.operation.description,
      x: 66,
      y: 5,
      w: 30,
      h: 14,
      emphasis: 'active'
    }
  ];
  const calc = calculationFromText(`${step.narration} ${step.observation} ${step.operation.description}`);
  if (calc) {
    objects.push({
      id: 'scene-calculation',
      kind: 'calculation',
      label: '本步运算',
      operands: [calc.operands[0], `${calc.operator} ${calc.operands[1]}`],
      result: calc.result,
      x: 18,
      y: 25,
      w: 42,
      h: 30,
      emphasis: 'active'
    });
    objects.push({
      id: 'scene-shift-arrow',
      kind: 'arrow',
      label: /右移|right/i.test(`${step.narration} ${step.observation} ${step.operation.description}`) ? '右移一位' : '状态更新',
      x: 63,
      y: 36,
      w: 15,
      h: 8,
      emphasis: 'changed'
    });
  }
  let slotIndex = 0;
  primitives.forEach((primitive) => {
    if (isInternalScenePrimitive(primitive)) return;
    const viewState = viewStateByPrimitiveId.get(primitive.id);
    const activeTargets = new Set(viewState?.activeTargets || frame?.activeTargets?.[primitive.id] || cueForPrimitive(step, primitive.id)?.targetIds || []);
    const slotX = slotIndex % 2 === 0 ? 7 : 62;
    const slotY = calc ? 62 + Math.floor(slotIndex / 2) * 18 : 25 + Math.floor(slotIndex / 2) * 23;
    if (primitive.kind === 'table') {
      const table = primitiveRows(primitive, frame, previousFrame, activeTargets);
      objects.push({
        id: `scene-table-${primitive.id}`,
        kind: 'table',
        label: primitive.label,
        columns: table.columns,
        rows: table.rows,
        x: slotX,
        y: slotY,
        w: 31,
        h: 21,
        emphasis: table.rows.some((row) => row.active) ? 'active' : undefined
      });
      slotIndex += 1;
      return;
    }
    if (primitive.kind === 'sequence' || primitive.kind === 'formula') {
      const normalized = primitive.kind === 'sequence' ? normalizeSequenceRendererState(primitive, frame, previousFrame) : null;
      const items = normalized && Array.isArray(normalized.items)
        ? normalized.items
        : Array.isArray(primitive.data.tokens)
          ? primitive.data.tokens
          : Array.isArray(primitive.data.items)
            ? primitive.data.items
            : [];
      const value = items.map((item: any) => compactSceneLabel(item)).join('');
      objects.push({
        id: `scene-bits-${primitive.id}`,
        kind: binaryLike(value) ? 'bits' : 'register',
        label: primitive.label,
        value,
        bits: binaryLike(value) ? bitsFromValue(value) : undefined,
        x: slotX,
        y: slotY,
        w: 31,
        h: 16,
        emphasis: activeTargets.size ? 'active' : undefined
      });
      slotIndex += 1;
      return;
    }
    if (primitive.kind === 'graph' || primitive.kind === 'state_machine') {
      const graph = normalizeGraphRendererState(primitive, frame);
      const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
      const edges = Array.isArray(graph.edges) ? graph.edges : [];
      if (nodes.length) {
        objects.push({
          id: `scene-graph-${primitive.id}`,
          kind: 'graph',
          label: primitive.label,
          nodes: nodes.map((node: any, index: number) => {
            const id = String(node.id || `node-${index}`);
            const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1) - Math.PI / 2;
            return {
              id,
              label: compactSceneLabel(node, id),
              active: activeTargets.has(id) || Boolean(node.status),
              x: 50 + Math.cos(angle) * 32,
              y: 50 + Math.sin(angle) * 32
            };
          }),
          edges: edges.map((edge: any, index: number) => {
            const id = String(edge.id || `edge-${index}`);
            return { id, source: String(edge.source), target: String(edge.target), label: edge.label ? String(edge.label) : '', active: activeTargets.has(id) || Boolean(edge.status) };
          }),
          x: slotX,
          y: slotY,
          w: 31,
          h: 28,
          emphasis: activeTargets.size ? 'active' : undefined
        });
        slotIndex += 1;
        return;
      }
    }
    const entries = Object.entries(primitive.data || {})
      .filter(([, value]) => value !== undefined && value !== null)
      .slice(0, 4);
    objects.push({
      id: `scene-note-${primitive.id}`,
      kind: 'note',
      label: primitive.label,
      value: entries.length ? entries.map(([key, value]) => `${key}: ${compactSceneLabel(value)}`).join(' / ') : primitive.label,
      x: slotX,
      y: slotY,
      w: 31,
      h: 16,
      emphasis: activeTargets.size ? 'active' : undefined
    });
    slotIndex += 1;
  });
  return objects;
};

function SceneObjectView({ object }: { object: SceneObject }) {
  const active = object.emphasis === 'active' || object.emphasis === 'primary';
  const frameClass = active
    ? 'border-[#1f5fd0] bg-[#f8fbff] shadow-[0_16px_34px_rgba(31,95,208,0.14)]'
    : object.emphasis === 'changed'
      ? 'border-[#34a853] bg-[#f3fbf6] shadow-[0_14px_30px_rgba(52,168,83,0.12)]'
      : 'border-[#e2e8f0] bg-white shadow-sm';
  return (
    <div
      className={`absolute overflow-hidden rounded-lg border transition-all duration-500 ${frameClass}`}
      style={{ left: `${object.x}%`, top: `${object.y}%`, width: `${object.w}%`, minHeight: `${object.h}%` }}
    >
      {object.kind === 'title' ? (
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">current step</div>
          <div className="mt-1 text-2xl font-semibold text-[#202124]">{object.label}</div>
          <div className="mt-2 text-sm leading-6 text-[#475569]">{object.value}</div>
        </div>
      ) : null}
      {object.kind === 'decision' || object.kind === 'note' ? (
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">{object.label}</div>
          <div className="mt-2 text-lg font-semibold leading-snug text-[#174ea6]">{object.value}</div>
        </div>
      ) : null}
      {object.kind === 'calculation' ? (
        <div className="p-5 font-mono">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">{object.label}</div>
          <div className="space-y-2 text-right text-3xl font-bold text-[#202124]">
            {(object.operands || []).map((line, index) => (
              <div key={`${object.id}-${index}`} className={index === 1 ? 'border-b border-[#94a3b8] pb-2 text-[#174ea6]' : ''}>{line}</div>
            ))}
          </div>
          <div className="mt-3 text-right text-4xl font-bold text-[#137333]">{object.result}</div>
        </div>
      ) : null}
      {object.kind === 'bits' ? (
        <div className="p-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">{object.label}</div>
          <div className="flex flex-wrap gap-2">
            {(object.bits || []).map((bit) => (
              <div
                key={bit.id}
                className={`flex h-12 min-w-10 items-center justify-center rounded-md border px-3 font-mono text-2xl font-bold transition-all duration-500 ${
                  bit.active ? 'scale-110 border-[#1f5fd0] bg-[#e8f0fe] text-[#174ea6]' : bit.muted ? 'border-transparent text-[#94a3b8]' : 'border-[#dfe3ea] bg-white text-[#202124]'
                }`}
              >
                {bit.value}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {object.kind === 'register' ? (
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">{object.label}</div>
          <div className="mt-2 whitespace-pre-wrap font-mono text-xl font-bold text-[#202124]">{object.value}</div>
        </div>
      ) : null}
      {object.kind === 'arrow' ? (
        <div className="flex h-20 items-center justify-center gap-3 p-3 text-[#137333]">
          <div className="h-px flex-1 bg-[#34a853]" />
          <div className="text-sm font-semibold">{object.label}</div>
          <ChevronRight className="h-8 w-8" />
        </div>
      ) : null}
      {object.kind === 'table' ? (
        <div className="p-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">{object.label}</div>
          <table className="w-full border-collapse text-center text-sm">
            {object.columns?.length ? (
              <thead>
                <tr>{object.columns.map((column) => <th key={column} className="border border-[#e2e8f0] bg-[#f8fafc] px-2 py-2 text-xs font-semibold text-[#475569]">{column}</th>)}</tr>
              </thead>
            ) : null}
            <tbody>
              {(object.rows || []).map((row) => (
                <tr key={row.id} className={row.active ? 'bg-[#e8f0fe] text-[#174ea6]' : row.changed ? 'bg-[#e8f6ee] text-[#137333]' : 'bg-white text-[#334155]'}>
                  {row.cells.map((cell, index) => <td key={`${row.id}-${index}`} className="border border-[#e2e8f0] px-2 py-2 font-semibold">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {object.kind === 'graph' ? (
        <div className="relative h-[240px]">
          <div className="absolute left-4 top-3 text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">{object.label}</div>
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {(object.edges || []).map((edge) => {
              const source = object.nodes?.find((node) => node.id === edge.source);
              const target = object.nodes?.find((node) => node.id === edge.target);
              if (!source || !target) return null;
              return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={edge.active ? '#1f5fd0' : '#cbd5e1'} strokeWidth={edge.active ? 1 : 0.5} />;
            })}
          </svg>
          {(object.nodes || []).map((node) => (
            <div key={node.id} className={`absolute flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 font-bold ${node.active ? 'border-[#1f5fd0] bg-[#e8f0fe] text-[#174ea6]' : 'border-[#dfe3ea] bg-white text-[#202124]'}`} style={{ left: `${node.x}%`, top: `${node.y}%` }}>
              {node.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FreeCanvasStage({
  primitives,
  step,
  frame,
  previousFrame,
  viewStateByPrimitiveId,
  currentAction,
  variables
}: {
  primitives: VisualPrimitiveIR[];
  step: ProcessStepIR;
  frame: TraceFrameState | null;
  previousFrame: TraceFrameState | null;
  viewStateByPrimitiveId: Map<string, RendererViewState>;
  currentAction?: VisualAction;
  variables: Record<string, unknown>;
}) {
  const objects = sceneObjectsFor(primitives, step, frame, previousFrame, viewStateByPrimitiveId, currentAction, variables);
  return (
    <div className="bg-white p-4 sm:p-5">
      <div className="relative min-h-[640px] overflow-hidden rounded-lg border border-[#dfe3ea] bg-white shadow-inner">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(31,95,208,0.06),transparent_28%),radial-gradient(circle_at_82%_20%,rgba(52,168,83,0.05),transparent_24%)]" />
        {objects.map((object) => <SceneObjectView key={object.id} object={object} />)}
      </div>
    </div>
  );
}

const toPresentationObject = (object: SceneObject): PresentationObject => {
  if (object.kind === 'calculation') {
    return {...object, kind: 'calculationStack'};
  }
  if (object.kind === 'bits' || object.kind === 'register') {
    return {
      ...object,
      kind: 'digitRow',
      cells: object.bits || String(object.value || '').split('').map((value, index) => ({
        id: `${object.id}-cell-${index}`,
        value
      }))
    };
  }
  if (object.kind === 'title' || object.kind === 'decision' || object.kind === 'note') {
    return {...object, kind: 'annotation'};
  }
  return object as PresentationObject;
};

const presentationSceneFor = (
  primitives: VisualPrimitiveIR[],
  step: ProcessStepIR,
  frame: TraceFrameState | null,
  previousFrame: TraceFrameState | null,
  viewStateByPrimitiveId: Map<string, RendererViewState>,
  currentAction: VisualAction | undefined,
  variables: Record<string, unknown>
): AlgorithmPresentationScene => {
  const objects = sceneObjectsFor(primitives, step, frame, previousFrame, viewStateByPrimitiveId, currentAction, variables)
    .filter((object) => object.id !== 'scene-title')
    .map(toPresentationObject);

  return {
    title: step.title,
    subtitle: step.goal || step.operation.description,
    actionLabel: currentAction?.label || currentAction?.type || step.operation.description,
    objects
  };
};

function BlackboardConnectors({ primitives }: { primitives: VisualPrimitiveIR[] }) {
  if (primitives.length < 2) return null;
  const hasResult = primitives.some((primitive) => /result|output|joined|结果|输出/i.test(`${primitive.role || primitive.label}`));
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <marker id="stage-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L6,3 L0,6 Z" fill="#8aa0bf" />
        </marker>
      </defs>
      {primitives.length === 2 ? (
        <path d="M44 35 C50 28, 54 28, 60 35" fill="none" stroke="#8aa0bf" strokeWidth="0.8" strokeDasharray="2 1.4" markerEnd="url(#stage-arrow)" />
      ) : (
        <>
          <path d="M30 45 C36 55, 42 60, 49 67" fill="none" stroke="#8aa0bf" strokeWidth="0.75" strokeDasharray="2 1.5" markerEnd="url(#stage-arrow)" />
          <path d="M72 45 C67 56, 61 61, 54 67" fill="none" stroke="#8aa0bf" strokeWidth="0.75" strokeDasharray="2 1.5" markerEnd="url(#stage-arrow)" />
          {hasResult ? <text x="50" y="57" textAnchor="middle" className="fill-[#64748b]" fontSize="3.1" fontWeight="700">join / transform</text> : null}
        </>
      )}
    </svg>
  );
}

function BlackboardPrimitive({
  primitive,
  primitiveIndex,
  primitiveCount,
  step,
  frame,
  previousFrame,
  viewState
}: {
  primitive: VisualPrimitiveIR;
  primitiveIndex: number;
  primitiveCount: number;
  step: ProcessStepIR;
  frame: TraceFrameState | null;
  previousFrame: TraceFrameState | null;
  viewState?: RendererViewState;
}) {
  const slot = primitiveStageSlot(primitive, primitiveIndex, primitiveCount);
  const style = effectStyles(viewState?.effect || frame?.effects?.[primitive.id] || cueForPrimitive(step, primitive.id)?.effect);
  const active = Boolean(viewState?.effect || viewState?.activeTargets?.length);
  return (
    <div
      className={`absolute transition-all duration-500 ${active ? 'z-20' : 'z-10'}`}
      style={{
        left: `${slot.left}%`,
        top: `${slot.top}%`,
        width: `${slot.width}%`,
        transform: `rotate(${slot.rotate}deg) scale(${active ? 1.02 : 1})`
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="max-w-[82%] truncate text-base font-semibold text-[#202124]">{primitive.label}</div>
        {active ? (
          <div className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide" style={{ background: style.background, color: style.text }}>
            {viewState?.effect || 'focus'}
          </div>
        ) : null}
      </div>
      <div
        className={`relative rounded-[4px] transition-all duration-500 ${
          active ? 'ring-4 ring-offset-4 ring-offset-[#fffdf8]' : ''
        }`}
        style={{ ['--tw-ring-color' as any]: style.shadow }}
      >
        <PrimitiveView
          primitive={primitive}
          step={step}
          frame={frame}
          previousFrame={previousFrame}
          viewState={viewState}
          chromeless
        />
      </div>
    </div>
  );
}

function TeachingVisualizationViewer({ result }: { result: StudioResult }) {
  const payload = useMemo(() => extractTeachingVisualizationPayload(result), [result]);
  const trace = payload?.processTrace;
  const mapping = payload?.visualMapping;
  const plan = payload?.teachingPlan;
  const [index, setIndex] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [hoveredActionId, setHoveredActionId] = useState<string | null>(null);
  const [prediction, setPrediction] = useState('');
  const [predictionResult, setPredictionResult] = useState<'idle' | 'correct' | 'miss'>('idle');
  const [showErrorPath, setShowErrorPath] = useState(false);
  const step = trace?.steps[index] || trace?.steps[0];
  const frame = trace && step ? traceFrameAt(trace, index) : null;
  const previousFrame = trace && index > 0 ? traceFrameAt(trace, index - 1) : null;
  const rendererState = trace ? rendererStateAt(trace, mapping, frame, previousFrame, payload?.irContract?.rendererState) : null;
  const frameDiff: Array<{ path: string; type?: string; before?: unknown; after?: unknown }> = rendererState?.diff || payload?.irContract?.diff?.frames?.[index]?.changes || [];
  const coverageMetrics = payload?.irContract?.metrics;
  const coverageRatio = coverageMetrics?.visualElementCount
    ? Math.round(((coverageMetrics.coveredElementCount || 0) / coverageMetrics.visualElementCount) * 100)
    : null;

  useEffect(() => {
    setIndex(0);
    setActionIndex(0);
    setBreakpoints(new Set());
    setPrediction('');
    setPredictionResult('idle');
    setShowErrorPath(false);
    setPlaying(false);
  }, [trace?.title]);

  useEffect(() => {
    if (!playing || !trace?.steps.length) return;
    const timer = window.setInterval(() => {
      setActionIndex((currentAction) => {
        const actionCount = Math.max(1, ((rendererState?.views || []) as RendererViewState[]).reduce((max, view) => Math.max(max, view.visualActions?.length || 0), 0));
        if (currentAction < actionCount - 1) return currentAction + 1;
        setIndex((current) => {
          if (current >= trace.steps.length - 1) {
            setPlaying(false);
            return current;
          }
          if (breakpoints.has(current + 1)) {
            setPlaying(false);
          }
          return current + 1;
        });
        return 0;
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [playing, trace?.steps.length, rendererState, breakpoints]);

  if (!trace || !step) {
    return (
      <div className="mx-auto max-w-4xl rounded-lg border border-[#e5e7eb] bg-white p-5 shadow-sm">
        <MarkdownPreview content={result.delivery?.previewContent || result.content} variant="document" />
      </div>
    );
  }

  const orderedViews = (mapping?.views || [])
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((view) => trace.stateModel.primitives.find((primitive) => primitive.id === view.primitiveId))
    .filter((primitive): primitive is VisualPrimitiveIR => Boolean(primitive));
  const primitives = orderedViews.length ? orderedViews : trace.stateModel.primitives;
  const rendererViews = ((rendererState?.views || []) as RendererViewState[]);
  const viewStateByPrimitiveId = new Map(rendererViews.map((view) => {
    const visibleActions = (view.visualActions || []).slice(0, Math.max(1, actionIndex + 1));
    const activeActionTargets = visibleActions.length ? visibleActions[visibleActions.length - 1].targetIds : view.activeTargets;
    return [view.primitiveId, { ...view, activeTargets: activeActionTargets, visualActions: visibleActions }];
  }));
  const actionCount = Math.max(1, rendererViews.reduce((max, view) => Math.max(max, view.visualActions?.length || 0), 0));
  const visibleActions = rendererViews.flatMap((view) => view.visualActions || []);
  const currentAction = visibleActions[Math.min(actionIndex, Math.max(0, visibleActions.length - 1))];
  const variables = isObjectRecord(frame?.state.variables) ? frame?.state.variables : {};
  const presentationScene = presentationSceneFor(primitives, step, frame, previousFrame, viewStateByPrimitiveId, currentAction, variables);
  const nextStep = trace.steps[index + 1];
  const moveAction = (delta: number) => {
    const nextActionIndex = actionIndex + delta;
    if (nextActionIndex >= 0 && nextActionIndex < actionCount) {
      setActionIndex(nextActionIndex);
      return;
    }
    if (delta > 0 && index < trace.steps.length - 1) {
      setIndex(index + 1);
      setActionIndex(0);
      return;
    }
    if (delta < 0 && index > 0) {
      setIndex(index - 1);
      setActionIndex(0);
    }
  };
  const toggleBreakpoint = () => {
    setBreakpoints((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
  const checkPrediction = () => {
    const expected = `${nextStep?.title || ''} ${nextStep?.operation?.description || ''} ${(nextStep?.operation?.targetIds || []).join(' ')}`.toLowerCase();
    const guess = prediction.toLowerCase().trim();
    setPredictionResult(guess && expected.split(/\s+|，|。|、|:|：/).some((token) => token.length > 1 && guess.includes(token)) ? 'correct' : 'miss');
  };

  return (
    <div className="space-y-3">
      <section className="min-w-0 overflow-hidden rounded-xl border border-[#dfe3ea] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef1f5] px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">Learning Visualization · {trace.domain}</div>
            <h3 className="mt-1 truncate text-2xl font-semibold text-[#202124]">{trace.title}</h3>
          </div>
          <div className="rounded-full bg-[#eef4ff] px-3 py-1 text-xs font-semibold text-[#1f5fd0]">
            {currentAction?.type || step.operation.type}
          </div>
        </div>
        <MotionCanvasStage
          scene={presentationScene}
          playing={playing}
          stepKey={`${step.id}-${actionIndex}`}
        />
      </section>

      <section className="rounded-xl border border-[#dfe3ea] bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => moveAction(-1)}
              disabled={index === 0 && actionIndex === 0}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#dfe3ea] text-[#343a46] hover:bg-[#f8fafc] disabled:opacity-40"
              title="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPlaying((value) => !value)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#202124] text-white hover:bg-black"
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button
              onClick={() => moveAction(1)}
              disabled={index >= trace.steps.length - 1 && actionIndex >= actionCount - 1}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#dfe3ea] text-[#343a46] hover:bg-[#f8fafc] disabled:opacity-40"
              title="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="min-w-[180px] flex-1">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-[#667085]">
              <span>Step {index + 1} / {trace.steps.length}</span>
              <span>Action {Math.min(actionIndex + 1, actionCount)} / {actionCount}</span>
            </div>
            <div className="flex gap-1.5">
              {trace.steps.map((item, itemIndex) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setIndex(itemIndex);
                    setActionIndex(0);
                  }}
                  className={`h-2 min-w-6 flex-1 rounded-full transition ${itemIndex === index ? 'bg-[#1f5fd0]' : itemIndex < index ? 'bg-[#9bbcf4]' : 'bg-[#e5e7eb]'}`}
                  title={item.title}
                />
              ))}
            </div>
          </div>

          <button
            onClick={() => {
              setActionIndex(0);
              setPlaying(true);
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#dfe3ea] text-[#343a46] hover:bg-[#f8fafc]"
            title="Replay"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        <details className="mt-3 rounded-lg border border-[#eef1f5] bg-[#fbfcfd]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[#343a46] marker:hidden">
            <span className="inline-flex items-center gap-2"><MoreHorizontal className="h-4 w-4" /> 更多</span>
            <span className="text-xs font-medium text-[#7b8190]">调试、导出和生成依据</span>
          </summary>
          <div className="grid gap-4 border-t border-[#eef1f5] p-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-white px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#7b8190]">Frame</div>
                  <div className="mt-1 text-sm font-bold text-[#202124]">{frame?.index ?? 0}</div>
                </div>
                <div className="rounded-lg bg-white px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#7b8190]">Changes</div>
                  <div className="mt-1 text-sm font-bold text-[#202124]">{frameDiff.length}</div>
                </div>
                <div className="rounded-lg bg-white px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#7b8190]">Covered</div>
                  <div className="mt-1 text-sm font-bold text-[#202124]">{coverageRatio === null ? 'local' : `${coverageRatio}%`}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={toggleBreakpoint}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${breakpoints.has(index) ? 'border-[#ea4335] bg-[#fff1f0] text-[#a50e0e]' : 'border-[#dfe3ea] bg-white text-[#343a46] hover:bg-[#f8fafc]'}`}
                >
                  Breakpoint
                </button>
                <button
                  onClick={() => setShowErrorPath((value) => !value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${showErrorPath ? 'border-[#fbbc04] bg-[#fff8df] text-[#9a6700]' : 'border-[#dfe3ea] bg-white text-[#343a46] hover:bg-[#f8fafc]'}`}
                >
                  Wrong Path
                </button>
                <button
                  onClick={() => downloadJson(`${trace.title || 'process-trace'}.ir.json`, payload)}
                  className="inline-flex items-center gap-2 rounded-full border border-[#dfe3ea] bg-white px-3 py-1.5 text-xs font-semibold text-[#343a46] hover:bg-[#f8fafc]"
                >
                  <Download className="h-3.5 w-3.5" /> Export
                </button>
              </div>
              {showErrorPath ? (
                <div className="rounded-lg border border-[#fef3c7] bg-[#fffbeb] p-3 text-sm leading-6 text-[#92400e]">
                  <div className="font-semibold">错误路径演示</div>
                  <div className="mt-1">{step.misconception || '如果跳过当前比较/状态更新，后续步骤会建立在未验证的状态上，导致结论无法解释。'}</div>
                </div>
              ) : null}

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">Action Timeline</div>
                <div className="mt-2 space-y-2">
                  {visibleActions.length ? visibleActions.map((action, itemIndex) => (
                    <button
                      key={action.id}
                      onMouseEnter={() => setHoveredActionId(action.id)}
                      onMouseLeave={() => setHoveredActionId(null)}
                      onClick={() => setActionIndex(itemIndex)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                        itemIndex === actionIndex
                          ? 'border-[#1f5fd0] bg-[#eef4ff] text-[#174ea6]'
                          : itemIndex < actionIndex
                            ? 'border-[#dbeafe] bg-white text-[#475569]'
                            : 'border-[#edf0f5] bg-white text-[#667085]'
                      }`}
                      title={action.label || `${action.type} ${action.targetIds.join(', ')}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{action.type}</span>
                        <span>{action.durationMs}ms</span>
                      </div>
                      <div className="mt-1 truncate">{action.label || action.targetIds.join(' -> ') || 'visual transition'}</div>
                    </button>
                  )) : (
                    <div className="rounded-lg bg-white px-3 py-2 text-xs text-[#667085]">当前步骤没有显式动作。</div>
                  )}
                </div>
                {currentAction || hoveredActionId ? (
                  <div className="mt-2 rounded-lg bg-white p-3 text-xs leading-5 text-[#4f5665]">
                    {(() => {
                      const hovered = visibleActions.find((action) => action.id === hoveredActionId) || currentAction;
                      return hovered ? `${hovered.type}: ${hovered.label || hovered.targetIds.join(', ')}` : '';
                    })()}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">Variables</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {Object.keys(variables).length ? Object.entries(variables).map(([key, value]) => (
                    <div key={key} className="rounded-lg bg-white px-3 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-[#7b8190]">{key}</div>
                      <div className="mt-1 text-sm font-bold text-[#202124]">{String(value)}</div>
                    </div>
                  )) : (
                    <div className="col-span-2 rounded-lg bg-white px-3 py-2 text-xs text-[#667085]">无显式变量。</div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">Predict Next</div>
                <textarea
                  value={prediction}
                  onChange={(event) => {
                    setPrediction(event.target.value);
                    setPredictionResult('idle');
                  }}
                  rows={3}
                  className="mt-2 w-full resize-none rounded-lg border border-[#dfe3ea] bg-white px-3 py-2 text-sm text-[#343a46] outline-none focus:border-[#1f5fd0]"
                  placeholder="预测下一步会比较、移动或生成什么..."
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <button onClick={checkPrediction} className="rounded-full bg-[#202124] px-4 py-2 text-xs font-semibold text-white">Check</button>
                  {predictionResult !== 'idle' ? (
                    <div className={`text-xs font-semibold ${predictionResult === 'correct' ? 'text-[#137333]' : 'text-[#a50e0e]'}`}>
                      {predictionResult === 'correct' ? '预测方向匹配' : `参考下一步：${nextStep?.title || '已到末尾'}`}
                    </div>
                  ) : null}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">State Changes</div>
                <div className="mt-2 space-y-2">
                  {frameDiff.length ? frameDiff.slice(0, 6).map((change: { path: string; type?: string; before?: unknown; after?: unknown }, changeIndex: number) => (
                    <div key={`${change.path}-${changeIndex}`} className="rounded-lg border border-[#edf0f5] bg-white px-3 py-2 text-xs leading-5 text-[#4f5665]">
                      <span className="font-semibold text-[#202124]">{change.path}</span>
                      <span className="mx-1 text-[#94a3b8]">→</span>
                      <span>{String((change as any).after ?? '')}</span>
                    </div>
                  )) : (
                    <div className="rounded-lg bg-white px-3 py-2 text-xs text-[#667085]">当前帧没有状态变化。</div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">Learning Goals</div>
                <div className="mt-2 space-y-2 text-sm leading-6 text-[#4f5665]">
                  {plan?.learningObjectives?.length ? <div><span className="font-semibold text-[#202124]">目标：</span>{plan.learningObjectives.slice(0, 2).join('；')}</div> : null}
                  {plan?.coreConcepts?.length ? <div><span className="font-semibold text-[#202124]">概念：</span>{plan.coreConcepts.slice(0, 5).join('、')}</div> : null}
                  {plan?.misconceptions?.length ? <div><span className="font-semibold text-[#202124]">易错：</span>{plan.misconceptions.slice(0, 2).join('；')}</div> : null}
                </div>
              </div>
            </div>
          </div>
        </details>
      </section>

      <section className="rounded-xl border border-[#dfe3ea] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">Explanation</div>
            <h3 className="mt-1 text-2xl font-semibold text-[#202124]">{step.title}</h3>
          </div>
          <div className="rounded-full bg-[#eef4ff] px-2.5 py-1 text-xs font-semibold text-[#1f5fd0]">
            {step.operation.type}: {step.operation.description}
          </div>
        </div>
        <p className="mt-4 text-sm leading-7 text-[#4f5665]">{step.narration}</p>
        {step.observation ? (
          <div className="mt-3 rounded-lg bg-[#f8fafc] p-3 text-sm leading-6 text-[#5f6673]">{step.observation}</div>
        ) : null}
        {step.checkQuestion ? (
          <div className="mt-3 rounded-lg border border-[#dbeafe] bg-[#eff6ff] p-3 text-sm font-medium leading-6 text-[#1d4ed8]">{step.checkQuestion}</div>
        ) : null}
      </section>
    </div>
  );
}

const studioDurationLabel = (ms?: number | null) => {
  const value = Math.max(0, Number(ms || 0));
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`;
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
};

const visualExplainerStagePlan = [
  { id: 'request', label: 'Request', description: '准备上下文和模板' },
  { id: 'markdown', label: 'Markdown', description: '生成完整文字底稿' },
  { id: 'content_map', label: 'Content Map', description: '提取概念、步骤、关系和例子' },
  { id: 'section_plan', label: 'Sections', description: '按讲解节奏切分分镜' },
  { id: 'slide_text', label: 'Slide Text', description: '生成左侧讲解文案' },
  { id: 'visual_intent', label: 'Visual Intent', description: '判断图形类型和 renderer' },
  { id: 'renderer_blocks', label: 'Blocks', description: '生成 renderer 原生输入' },
  { id: 'validation', label: 'Validation', description: '校验最终结构和引用' },
  { id: 'render', label: 'Reveal Render', description: '前端渲染 slides 和图形' }
];

const providerErrorsFromSource = (source?: string) => {
  const text = String(source || '');
  const match = text.match(/\(([\s\S]*)\)$/);
  return (match?.[1] || '')
    .split(/\s+\|\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const isVisualFallbackSource = (source?: string) => String(source || '').startsWith('markdown-fallback:');

interface VisualPipelineStageMeta {
  id: string;
  label: string;
  status: string;
  durationMs: number;
  summary: string;
  error: string;
  provider: string;
}

interface VisualPipelineMeta {
  stages: VisualPipelineStageMeta[];
  fallbackStages: string[];
  validation: { warnings: string[] } | null;
}

const visualPipelineFromResult = (result: StudioResult): VisualPipelineMeta | null => {
  const pipeline = result.metadata?.visualExplainerPipeline;
  if (!pipeline || typeof pipeline !== 'object') return null;
  const stages = Array.isArray((pipeline as any).stages) ? (pipeline as any).stages : [];
  const validation = (pipeline as any).validation && typeof (pipeline as any).validation === 'object'
    ? (pipeline as any).validation
    : null;
  return {
    stages: stages.map((stage: any) => ({
      id: String(stage.id || stage.label || ''),
      label: String(stage.label || stage.id || 'Stage'),
      status: String(stage.status || 'completed'),
      durationMs: Number(stage.durationMs || 0),
      summary: String(stage.summary || ''),
      error: stage.error ? String(stage.error) : '',
      provider: stage.provider ? String(stage.provider) : ''
    })),
    fallbackStages: Array.isArray((pipeline as any).fallbackStages) ? (pipeline as any).fallbackStages.map(String) : [],
    validation: validation
      ? { warnings: Array.isArray(validation.warnings) ? validation.warnings.map(String) : [] }
      : null
  };
};

function StudioGenerationProgressStrip({ progress }: { progress: StudioGenerationProgressState }) {
  const percent = Math.min(92, Math.max(8, (progress.stageIndex + 0.35) / visualExplainerStagePlan.length * 100));
  const activeStage = visualExplainerStagePlan[Math.min(progress.stageIndex, visualExplainerStagePlan.length - 1)];
  const isVisual = progress.templateId === 'visual_explainer' || progress.renderer === 'visual_explainer';
  return (
    <div className="border-t border-[#e8edf5] bg-[#f8fbff] px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#1f5fd0]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {isVisual ? activeStage.label : 'Generating'}
          </div>
          <div className="mt-1 text-xs leading-5 text-[#667085]">
            {isVisual ? activeStage.description : 'AI Studio 正在生成资源'} · {studioDurationLabel(progress.elapsedMs)}
          </div>
        </div>
        <div className="w-full max-w-sm">
          <div className="h-2 overflow-hidden rounded-full bg-[#dbeafe]">
            <div className="h-full rounded-full bg-[#2563eb] transition-all duration-500" style={{ width: `${percent}%` }} />
          </div>
          {isVisual ? (
            <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${visualExplainerStagePlan.length}, minmax(0, 1fr))` }}>
              {visualExplainerStagePlan.map((stage, index) => (
                <div
                  key={stage.id}
                  className={`h-1.5 rounded-full ${index <= progress.stageIndex ? 'bg-[#2563eb]' : 'bg-[#cbd5e1]'}`}
                  title={stage.label}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function VisualExplainerDiagnostics({ result, payload }: { result: StudioResult; payload: VisualExplainerPayload }) {
  const fallback = isVisualFallbackSource(result.source);
  const providerErrors = providerErrorsFromSource(result.source);
  const pipeline = visualPipelineFromResult(result);
  const trace = result.workflowTrace || [];
  const totalTraceMs = trace.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0);
  const slowTrace = trace.filter((item) => Number(item.durationMs) > 12000).slice(0, 3);
  const sectionCount = payload.sections?.length || 0;
  const visualBlockCount = (payload.sections || []).reduce((sum, section) => sum + (section.visualBlocks?.length || 0), 0);
  const stages = pipeline?.stages?.length
    ? [
        ...pipeline.stages.map((stage) => ({
          label: stage.label,
          state: stage.status === 'fallback' ? 'failed' : 'done',
          detail: [stage.summary, stage.durationMs ? studioDurationLabel(stage.durationMs) : '', stage.provider || '']
            .filter(Boolean)
            .join(' · ')
        })),
        { label: 'Render', state: 'done', detail: `${sectionCount} sections · ${visualBlockCount} blocks` }
      ]
    : [
        { label: 'Markdown', state: 'done', detail: '已生成文字底稿' },
        {
          label: 'Storyboard',
          state: fallback ? 'failed' : 'done',
          detail: fallback ? 'JSON 分镜失败，已进入 fallback' : 'JSON 分镜成功'
        },
        {
          label: 'Fallback',
          state: fallback ? 'done' : 'skipped',
          detail: fallback ? '已用 Markdown 切分并归一化' : '未使用 fallback'
        },
        { label: 'Render', state: 'done', detail: `${sectionCount} sections · ${visualBlockCount} blocks` }
      ];
  const pipelineFallbackReason = pipeline?.stages
    ?.filter((stage) => stage.status === 'fallback' && stage.error)
    .map((stage) => `${stage.label}: ${stage.error}`)
    .slice(0, 6) || [];
  return (
    <div className={`border-b px-5 py-3 ${fallback ? 'border-amber-200 bg-amber-50' : 'border-[#eef1f5] bg-[#f8fafc]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
            <span>Generation Pipeline</span>
            <span className={`rounded-full px-2 py-0.5 normal-case tracking-normal ${fallback ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
              {fallback ? 'Fallback used' : 'Structured'}
            </span>
            {result.source ? <span className="normal-case tracking-normal text-[#94a3b8]">{result.source.split(':')[0]}</span> : null}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            {stages.map((stage) => (
              <div key={stage.label} className="min-w-0 rounded-md border border-white/70 bg-white/70 px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#202124]">
                  {stage.state === 'failed' ? <CircleAlert className="h-3.5 w-3.5 text-amber-600" /> : <Check className="h-3.5 w-3.5 text-emerald-600" />}
                  {stage.label}
                </div>
                <div className="mt-1 truncate text-xs text-[#667085]" title={stage.detail}>{stage.detail}</div>
              </div>
            ))}
          </div>
        </div>
        {totalTraceMs ? (
          <div className="shrink-0 rounded-md bg-white/75 px-3 py-2 text-xs leading-5 text-[#475569]">
            <div className="font-semibold text-[#202124]">{studioDurationLabel(totalTraceMs)}</div>
            <div>{trace.length} backend steps</div>
          </div>
        ) : null}
      </div>
      {pipeline?.fallbackStages?.length ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-white/70 p-3 text-xs leading-5 text-amber-900">
          <div className="font-semibold">Pipeline fallback</div>
          <div className="mt-1">{pipeline.fallbackStages.join(' · ')}</div>
        </div>
      ) : null}
      {pipeline?.validation?.warnings?.length ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-white/70 p-3 text-xs leading-5 text-slate-700">
          <div className="font-semibold text-slate-900">Validation</div>
          <div className="mt-1 grid gap-1 md:grid-cols-2">
            {pipeline.validation.warnings.slice(0, 6).map((item: string) => <div key={item} className="truncate" title={item}>{item}</div>)}
          </div>
        </div>
      ) : null}
      {providerErrors.length ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-white/70 p-3 text-xs leading-5 text-amber-900">
          <div className="font-semibold">Fallback reason</div>
          <div className="mt-1 grid gap-1 md:grid-cols-2">
            {providerErrors.map((item) => <div key={item} className="truncate" title={item}>{item}</div>)}
          </div>
        </div>
      ) : null}
      {!providerErrors.length && pipelineFallbackReason.length ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-white/70 p-3 text-xs leading-5 text-amber-900">
          <div className="font-semibold">Stage reason</div>
          <div className="mt-1 grid gap-1 md:grid-cols-2">
            {pipelineFallbackReason.map((item) => <div key={item} className="truncate" title={item}>{item}</div>)}
          </div>
        </div>
      ) : null}
      {slowTrace.length ? (
        <div className="mt-2 text-xs leading-5 text-[#667085]">
          Slow steps: {slowTrace.map((item) => `${item.title} ${studioDurationLabel(item.durationMs)}`).join(' · ')}
        </div>
      ) : null}
    </div>
  );
}

const visualModeLabel: Record<VisualExplainerMode, string> = {
  slide: 'Slide',
  process: 'Process',
  diagram: 'Diagram',
  comparison: 'Compare',
  whiteboard: 'Board',
  chart: 'Chart',
  summary: 'Summary'
};

const cleanRevealText = (value: string | undefined, maxLength = 420) => {
  const text = String(value || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
};

const revealSlidePoints = (section: VisualExplainerSection) => {
  const timelinePoints = (section.timeline || [])
    .map((item) => cleanRevealText(item.screenText || item.narration, 110))
    .filter(Boolean);
  const screenText = (section.screenText || []).map((item) => cleanRevealText(item, 110)).filter(Boolean);
  const objectLabels = (section.objects || [])
    .filter((object) => object.kind !== 'edge')
    .map((object) => cleanRevealText(object.label, 90))
    .filter(Boolean);
  return Array.from(new Set([...screenText, ...timelinePoints, ...objectLabels])).slice(0, 5);
};

const revealNarration = (section: VisualExplainerSection) =>
  cleanRevealText(section.narration || section.focus || section.screenText?.join(' '), 560);

const markdownCompareKey = (value: string | undefined) =>
  String(value || '')
    .replace(/^[#>\s-]+/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const numberedMarkdownTitle = (value: string) =>
  value.trim().match(/^(?:\d+[.、]\s+|[一二三四五六七八九十]+[、.]\s*)(.+)$/)?.[1]?.trim() || '';

const stripSlideBodyMarkdown = (markdown: string, title: string) => {
  const titleKey = markdownCompareKey(title);
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  let droppedMatchingHeading = false;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      if (kept.length && kept[kept.length - 1] !== '') kept.push('');
      return;
    }
    if (/^-{3,}$/.test(trimmed) || /^#{1,6}$/.test(trimmed)) return;
    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      const headingLevel = trimmed.match(/^#{1,3}/)?.[0] || '##';
      const headingText = numberedMarkdownTitle(heading[1]) || heading[1];
      const headingKey = markdownCompareKey(headingText);
      if (!droppedMatchingHeading && titleKey && headingKey === titleKey) {
        droppedMatchingHeading = true;
        return;
      }
      if (!kept.length && /视觉讲解底稿|visual explainer|讲解底稿/i.test(headingText)) return;
      kept.push(`${headingLevel} ${headingText}`);
      return;
    }
    const numberedTitle = numberedMarkdownTitle(trimmed);
    if (numberedTitle) {
      const numberedKey = markdownCompareKey(numberedTitle);
      if (!droppedMatchingHeading && titleKey && numberedKey === titleKey) {
        droppedMatchingHeading = true;
        return;
      }
      kept.push(`### ${numberedTitle}`);
      return;
    }
    kept.push(line);
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const sectionBodyMarkdown = (section: VisualExplainerSection) =>
  stripSlideBodyMarkdown(
    String(section.bodyMarkdown || section.sourceMarkdown || section.narration || section.screenText?.join('\n') || '').trim(),
    section.title
  );

const firstMeaningfulMarkdownLine = (markdown: string) =>
  markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s+/.test(line) && !/^-{3,}$/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.、])\s+/, ''))
    .find(Boolean) || '';

const slideFocusText = (section: VisualExplainerSection, bodyMarkdown = '') => {
  const raw = String(section.focus || '').trim();
  if (!raw || /---|\|/.test(raw) || raw.length > 140) return '';
  const cleaned = cleanRevealText(raw, 120);
  if (markdownCompareKey(cleaned) === markdownCompareKey(section.title)) return '';
  const firstLine = firstMeaningfulMarkdownLine(bodyMarkdown);
  if (firstLine && markdownCompareKey(firstLine).includes(markdownCompareKey(cleaned))) return '';
  if (firstLine && markdownCompareKey(cleaned).includes(markdownCompareKey(firstLine))) return '';
  return cleaned;
};

const revealVisualSteps = (section: VisualExplainerSection) => {
  const timeline = (section.timeline || [])
    .map((step) => cleanRevealText(step.screenText || step.narration, 96))
    .filter(Boolean);
  return Array.from(new Set(timeline.length ? timeline : revealSlidePoints(section))).slice(0, 5);
};

interface RoutedVisualRenderer {
  renderer: VisualExplainerRendererKind;
  reason: string;
}

const visualBlockFor = <TKind extends VisualExplainerBlock['kind']>(
  section: VisualExplainerSection,
  kind: TKind
) => (section.visualBlocks || []).find((block): block is Extract<VisualExplainerBlock, { kind: TKind }> => block.kind === kind);

const routeVisualRenderer = (section: VisualExplainerSection): RoutedVisualRenderer => {
  if (section.preferredRenderer === 'x6' && visualBlockFor(section, 'x6')) {
    return { renderer: 'x6', reason: 'backend x6 block' };
  }
  if (section.preferredRenderer === 'mermaid' && visualBlockFor(section, 'mermaid')) {
    return { renderer: 'mermaid', reason: 'backend mermaid block' };
  }
  if (visualBlockFor(section, 'x6')) {
    return { renderer: 'x6', reason: 'available x6 block' };
  }
  if (visualBlockFor(section, 'mermaid')) {
    return { renderer: 'mermaid', reason: 'available mermaid block' };
  }
  const hasEdges = section.objects.some((object) => object.kind === 'edge' && object.fromId && object.toId);
  if ((section.visualMode === 'diagram' || section.visualMode === 'process') && hasEdges) {
    return { renderer: 'x6', reason: 'node-edge visual model' };
  }
  if (section.visualMode === 'diagram' || section.visualMode === 'process') {
    return { renderer: 'mermaid', reason: 'flow/process visual intent' };
  }
  return { renderer: 'reveal', reason: 'text-first slide' };
};

const mermaidLabel = (value: string) => cleanRevealText(value, 64).replace(/[|"[\]{}]/g, '');

const x6TerminalId = (terminal: VisualExplainerX6Terminal) =>
  typeof terminal === 'string' ? terminal : terminal.cell;

interface RoutedX6Node {
  id: string;
  shape?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label: string;
  attrs?: Record<string, unknown>;
}

interface RoutedX6Edge {
  id: string;
  source: string;
  target: string;
  label: string;
  attrs?: Record<string, unknown>;
}

const mermaidFromSection = (section: VisualExplainerSection) => {
  const mermaidBlock = visualBlockFor(section, 'mermaid');
  if (mermaidBlock?.code) return mermaidBlock.code;
  const nodes = section.objects.filter((object) => object.kind !== 'edge').slice(0, 8);
  const edges = section.objects.filter((object) => object.kind === 'edge' && object.fromId && object.toId);
  if (nodes.length && edges.length) {
    const lines = ['flowchart LR'];
    nodes.forEach((node) => {
      lines.push(`  ${node.id.replace(/[^a-zA-Z0-9_]/g, '_')}["${mermaidLabel(node.label)}"]`);
    });
    edges.forEach((edge) => {
      const from = String(edge.fromId).replace(/[^a-zA-Z0-9_]/g, '_');
      const to = String(edge.toId).replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`  ${from} --> ${to}`);
    });
    return lines.join('\n');
  }
  const points = revealSlidePoints(section).slice(0, 7);
  const lines = ['flowchart TD'];
  points.forEach((point, index) => {
    lines.push(`  n${index + 1}["${mermaidLabel(point)}"]`);
    if (index > 0) lines.push(`  n${index} --> n${index + 1}`);
  });
  return lines.join('\n');
};

function MermaidSectionDiagram({ section }: { section: VisualExplainerSection }) {
  const [svg, setSvg] = useState('');
  const source = useMemo(() => mermaidFromSection(section), [section]);

  useEffect(() => {
    let cancelled = false;
    const diagramId = `visual-explainer-${section.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.now()}`;
    setSvg('');
    mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'strict' });
    (mermaid as any).parse?.(source)
      .then(() => mermaid.render(diagramId, source))
      .then((result: { svg: string }) => {
        cleanupMermaidRenderArtifacts(diagramId);
        if (!cancelled) setSvg(result.svg);
      })
      .catch(() => {
        cleanupMermaidRenderArtifacts(diagramId);
        if (!cancelled) setSvg('');
      });
    return () => {
      cancelled = true;
      cleanupMermaidRenderArtifacts(diagramId);
    };
  }, [section.id, source]);

  if (!svg) return null;
  return (
    <div
      className="mx-auto mt-6 max-h-[360px] max-w-4xl overflow-hidden [&_svg]:mx-auto [&_svg]:max-h-[360px] [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

const x6VisualGraph = (section: VisualExplainerSection): { nodes: RoutedX6Node[]; edges: RoutedX6Edge[] } => {
  const x6Block = visualBlockFor(section, 'x6');
  if (x6Block?.graph?.nodes?.length) {
    const nodes = x6Block.graph.nodes.slice(0, 18).map((node, index) => ({
      id: node.id || `n${index + 1}`,
      shape: node.shape || 'rect',
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      label: cleanRevealText(node.label || String(node.data?.label || `Node ${index + 1}`), 90),
      attrs: node.attrs
    }));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = (x6Block.graph.edges || [])
      .slice(0, 28)
      .map((edge, index) => ({
        id: edge.id || `e${index + 1}`,
        source: x6TerminalId(edge.source),
        target: x6TerminalId(edge.target),
        label: edge.label || '',
        attrs: edge.attrs
      }))
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    return { nodes, edges };
  }
  const visualNodes = section.objects.filter((object) => object.kind !== 'edge').slice(0, 12);
  const nodes: RoutedX6Node[] = visualNodes.length
    ? visualNodes
    : revealSlidePoints(section).map((point, index) => ({ id: `n${index + 1}`, label: point }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const explicitEdges = section.objects
    .filter((object) => object.kind === 'edge' && object.fromId && object.toId && nodeIds.has(object.fromId) && nodeIds.has(object.toId))
    .map((object, index): RoutedX6Edge => ({ id: object.id || `e${index + 1}`, source: object.fromId as string, target: object.toId as string, label: object.label }));
  const edges: RoutedX6Edge[] = explicitEdges.length
    ? explicitEdges
    : nodes.slice(1).map((node, index): RoutedX6Edge => ({ id: `e${index + 1}`, source: nodes[index].id, target: node.id, label: '' }));
  return { nodes, edges };
};

function X6SectionDiagram({ section }: { section: VisualExplainerSection }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const visualGraph = useMemo(() => x6VisualGraph(section), [section]);

  useEffect(() => {
    let disposed = false;
    const renderGraph = async () => {
      if (!containerRef.current) return;
      graphRef.current?.dispose();
      containerRef.current.innerHTML = '';
      const graph = new Graph({
        container: containerRef.current,
        background: { color: '#ffffff' },
        interacting: false,
        panning: false,
        mousewheel: false,
        connecting: { connector: 'rounded' }
      } as any);
      graphRef.current = graph;
      const elk = new ELK();
      const layout = await elk.layout({
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.spacing.nodeNode': '56',
          'elk.layered.spacing.nodeNodeBetweenLayers': '72'
        },
        children: visualGraph.nodes.map((node) => ({
          id: node.id,
          width: node.width || Math.min(260, Math.max(140, cleanRevealText(node.label, 80).length * 10 + 52)),
          height: node.height || 64
        })),
        edges: visualGraph.edges.map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target]
        }))
      });
      if (disposed) return;
      const positions = new Map((layout.children || []).map((node) => [node.id, node]));
      graph.fromJSON({
        nodes: visualGraph.nodes.map((node) => {
          const position = positions.get(node.id);
          return {
            id: node.id,
            shape: node.shape || 'rect',
            x: position?.x ?? node.x ?? 0,
            y: position?.y ?? node.y ?? 0,
            width: position?.width || node.width || 180,
            height: position?.height || node.height || 64,
            label: cleanRevealText(node.label, 70),
            attrs: node.attrs || {
              body: { rx: 12, ry: 12, fill: '#f8fafc', stroke: '#cbd5e1', strokeWidth: 1.4 },
              label: { fill: '#202124', fontSize: 15, fontWeight: 600 }
            }
          };
        }),
        edges: visualGraph.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: cleanRevealText(edge.label, 40),
          attrs: edge.attrs || {
            line: {
              stroke: '#2563eb',
              strokeWidth: 2,
              targetMarker: { name: 'classic', size: 8 }
            }
          }
        }))
      } as any);
      graph.centerContent();
      graph.zoomToFit({ padding: 24, maxScale: 1.1 });
    };
    void renderGraph();
    return () => {
      disposed = true;
      graphRef.current?.dispose();
      graphRef.current = null;
    };
  }, [visualGraph]);

  return <div ref={containerRef} className="mx-auto mt-6 h-[360px] max-w-5xl overflow-hidden rounded-lg bg-white" />;
}

function RoutedSectionVisual({ section }: { section: VisualExplainerSection }) {
  const route = routeVisualRenderer(section);
  if (route.renderer === 'x6') return <X6SectionDiagram section={section} />;
  if (route.renderer === 'mermaid') return <MermaidSectionDiagram section={section} />;
  return null;
}

function VisualExplainerViewer({ result }: { result: StudioResult }) {
  const payload = useMemo(() => extractVisualExplainerPayload(result), [result]);
  const sections = payload?.sections?.length ? payload.sections : [];

  if (!payload || !sections.length) {
    return (
      <div className="mx-auto max-w-4xl">
        <MarkdownPreview content={result.content} variant="document" />
      </div>
    );
  }

  return (
    <section className="min-w-0 overflow-hidden bg-white">
      <div className="px-5 py-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">
          Visual Explainer · {visualModeLabel[sections[0]?.visualMode] || 'Slide'}
        </div>
      </div>
      <div className="h-[min(720px,calc(100vh-250px))] min-h-[520px] bg-white">
        <Deck
          config={{
            width: 1280,
            height: 720,
            controls: true,
            progress: true,
            center: true,
            hash: false,
            transition: 'slide',
            backgroundTransition: 'fade'
          }}
        >
          {sections.map((section) => {
            const route = routeVisualRenderer(section);
            const hasRenderer = route.renderer === 'x6' || route.renderer === 'mermaid';
            const narration = revealNarration(section);
            const bodyMarkdown = sectionBodyMarkdown(section);
            const focus = slideFocusText(section, bodyMarkdown);
            return (
              <Slide key={section.id} autoAnimate>
                <section
                  className={`mx-auto grid h-full text-left ${
                    hasRenderer
                      ? 'max-w-6xl grid-cols-[1.05fr_0.95fr] items-stretch gap-8 px-2 py-8'
                      : 'max-w-5xl grid-cols-1 px-3 py-8'
                  }`}
                >
                  <div className={`flex min-h-0 min-w-0 flex-col ${hasRenderer ? 'pr-4' : ''}`}>
                    <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#64748b]">
                      {visualModeLabel[section.visualMode] || section.visualMode}
                    </div>
                    <h2 className="!mb-4 !text-[34px] !font-semibold !leading-tight !text-[#202124]">
                      {cleanRevealText(section.title, 72)}
                    </h2>
                    {focus ? (
                      <p className="!mx-0 !mb-4 !text-[20px] !leading-snug !text-[#475569]">
                        {focus}
                      </p>
                    ) : null}
                    {bodyMarkdown ? (
                      <RevealFragment animation="fade-up" as="div">
                        <div className={`min-h-0 flex-1 overflow-y-auto text-left ${hasRenderer ? 'pr-3' : 'pr-2'}`}>
                          <MarkdownPreview content={bodyMarkdown} variant="message" />
                        </div>
                      </RevealFragment>
                    ) : narration ? (
                      <RevealFragment animation="fade-up" as="p">
                        <span className="block !text-[19px] !leading-relaxed !text-[#334155]">{narration}</span>
                      </RevealFragment>
                    ) : null}
                  </div>
                  {hasRenderer ? (
                    <div className="flex min-h-0 min-w-0 items-center border-l border-[#e2e8f0] pl-8">
                      <RoutedSectionVisual section={section} />
                    </div>
                  ) : null}
                </section>
              </Slide>
            );
          })}
        </Deck>
      </div>
    </section>
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
          conceptId: item?.conceptId ? String(item.conceptId) : undefined,
          objectiveId: item?.objectiveId ? String(item.objectiveId) : undefined,
          tier: item?.tier ? String(item.tier) : undefined,
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

const quizContentFromResult = (result: StudioResult) => {
  const structured = isObjectRecord(result.structured) ? result.structured : null;
  const payload = isObjectRecord(structured?.payload) ? structured.payload : null;
  const hasStructuredQuiz =
    Array.isArray(payload?.questions) ||
    structured?.artifactKind === 'quiz' ||
    result.renderer === 'quiz';
  if (hasStructuredQuiz && payload) {
    return JSON.stringify({
      title: payload.title || structured?.title || result.name,
      questions: Array.isArray(payload.questions) ? payload.questions : [],
      sourceCount: Array.isArray(structured?.sourceRefs) ? structured.sourceRefs.length : undefined
    });
  }
  return result.content;
};

const optionBriefFeedback = (value: string | undefined, maxChars: number, fallback = '') => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  const sentence = text.split(/[。！？!?；;]/)[0].trim() || text;
  if (sentence.length <= maxChars) return sentence;
  return `${sentence.slice(0, maxChars)}...`;
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

function QuizCompletionSummary({
  result,
  questions,
  averageScore,
  correctCount,
  wrongCount,
  skippedCount,
  weakConcepts,
  masteredConcepts,
  nextTemplate,
  onGenerateTemplate
}: {
  result: StudioResult;
  questions: QuizQuestion[];
  averageScore: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  weakConcepts: string[];
  masteredConcepts: string[];
  nextTemplate: AiStudioTemplate | null;
  onGenerateTemplate?: (template: AiStudioTemplate, seed?: string) => void;
}) {
  const accuracy = Math.round(averageScore * 100);
  const status =
    averageScore >= 0.85
      ? '可以进入综合测验'
      : averageScore >= 0.65
        ? '建议分层巩固'
        : '需要补强';
  const statusTone =
    averageScore >= 0.85
      ? 'border-[#b9e8c5] bg-[#f1fbf4] text-[#17833f]'
      : averageScore >= 0.65
        ? 'border-[#d8def5] bg-[#f4f6ff] text-[#1f5fd0]'
        : 'border-[#f0d8d6] bg-[#fcf5f4] text-[#9f2f24]';
  const topicsCovered = Array.from(
    new Set(
      questions.flatMap(quizQuestionConceptLabels)
    )
  );
  const refinedWeakConcepts = Array.from(new Set(weakConcepts.map(cleanQuizConceptLabel).filter(Boolean))).slice(0, 8);
  const refinedMasteredConcepts = Array.from(new Set(masteredConcepts.map(cleanQuizConceptLabel).filter(Boolean))).slice(0, 8);
  const keepLearningTopics = Array.from(new Set([
    ...(result.practiceNext?.focusConcepts || []).map(cleanQuizConceptLabel),
    ...refinedWeakConcepts
  ].filter(Boolean)));

  const startNextPractice = () => {
    if (!nextTemplate || !onGenerateTemplate) return;
    const seed = [
      result.practiceNext?.reason || '根据本次练习结果生成下一组练习。',
      keepLearningTopics.length ? `聚焦薄弱点：${keepLearningTopics.slice(0, 5).join('、')}` : '',
      `推荐难度：${result.practiceNext?.preferredDifficulty || 'adaptive'}`,
      `本次平均得分：${accuracy}%`
    ].filter(Boolean).join('\n');
    onGenerateTemplate(nextTemplate, seed);
  };

  return (
    <section className="min-h-[min(760px,calc(100vh-190px))] bg-white px-4 py-4 text-[#202124] md:px-5">
      <div className="mx-auto max-w-5xl">
        <div className="border-b border-[#eceff3] pb-4">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#7b8190]">Diagnostic report</div>
              <div className="mt-1 text-[28px] font-semibold leading-tight text-[#202124]">
                {correctCount} correct · {wrongCount} wrong · {skippedCount} skipped · {accuracy}% accuracy
              </div>
              <div className="mt-5">
                <span className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${statusTone}`}>{status}</span>
              </div>
            </div>
            <div className="relative h-32 w-32 shrink-0">
              <div
                className="h-full w-full rounded-full"
                style={{
                  background: `conic-gradient(#202124 ${accuracy * 3.6}deg, #eceff3 0deg)`
                }}
              />
              <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-white">
                <div className="text-2xl font-semibold text-[#202124]">{accuracy}%</div>
                <div className="text-xs font-medium text-[#7b8190]">accuracy</div>
              </div>
            </div>
          </div>
        </div>

        <div className="border-b border-[#eceff3] py-6">
          <div className="text-sm font-semibold text-[#202124]">掌握的知识点</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {refinedMasteredConcepts.length ? (
              refinedMasteredConcepts.map((concept) => (
                <span key={concept} className="rounded-full border border-[#b9e8c5] bg-[#f1fbf4] px-3 py-1.5 text-sm font-medium text-[#17833f]">
                  {concept}
                </span>
              ))
            ) : (
              <span className="text-sm text-[#7b8190]">暂无</span>
            )}
          </div>

          <div className="mt-5 text-sm font-semibold text-[#202124]">没掌握的知识点</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {refinedWeakConcepts.length ? (
              refinedWeakConcepts.map((concept) => (
                <span key={concept} className="rounded-full border border-[#f0d8d6] bg-[#fcf5f4] px-3 py-1.5 text-sm font-medium text-[#9f2f24]">
                  {concept}
                </span>
              ))
            ) : (
              <span className="text-sm text-[#7b8190]">暂无</span>
            )}
          </div>
        </div>

        <div className="grid gap-8 py-6 lg:grid-cols-[1fr_1fr]">
          <div>
            <div className="text-sm font-semibold text-[#202124]">Topics covered</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {topicsCovered.length ? (
                topicsCovered.slice(0, 12).map((topic) => (
                  <span key={topic} className="rounded-full border border-[#dfe3ea] bg-white px-3 py-1.5 text-sm font-medium text-[#343a46]">
                    {topic}
                  </span>
                ))
              ) : (
                <span className="text-sm text-[#7b8190]">暂无</span>
              )}
            </div>
          </div>

          <div className="lg:border-l lg:border-[#eceff3] lg:pl-6">
            <div className="text-sm font-semibold text-[#202124]">Keep learning</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {keepLearningTopics.length ? (
                keepLearningTopics.slice(0, 6).map((topic) => (
                  <span key={topic} className="rounded-full border border-[#d8def5] bg-[#f8fbff] px-3 py-1.5 text-sm font-medium text-[#1f5fd0]">
                    {topic}
                  </span>
                ))
              ) : (
                <span className="text-sm text-[#7b8190]">暂无</span>
              )}
            </div>
            {nextTemplate ? (
              <button
                onClick={startNextPractice}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#202124] px-4 py-2 text-sm font-semibold text-white hover:bg-black"
              >
                Next practice
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function QuizViewer({
  result,
  workspaceId,
  workbenchId,
  templates,
  onGenerateTemplate
}: {
  result: StudioResult;
  workspaceId: string;
  workbenchId?: string;
  templates: AiStudioTemplate[];
  onGenerateTemplate?: (template: AiStudioTemplate, seed?: string) => void;
}) {
  const quizContent = useMemo(() => quizContentFromResult(result), [result]);
  const questions = useMemo(() => parseQuizQuestions(quizContent), [quizContent]);
  const quizMeta = useMemo(() => parseQuizMeta(quizContent), [quizContent]);
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState<Record<string, QuizAttempt>>({});
  const [assistantByQuestion, setAssistantByQuestion] = useState<Record<string, QuizAssistantState>>({});
  const [hintOpenByQuestion, setHintOpenByQuestion] = useState<Record<string, boolean>>({});
  const [judging, setJudging] = useState(false);
  const [sessionSnapshot, setSessionSnapshot] = useState<QuizSessionSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const hasRestoredSnapshotRef = useRef(false);
  const question = questions[index];
  const attempt = attempts[question.id];
  const currentAnswer = attempt?.answer || '';
  const assistant = assistantByQuestion[question.id] || { input: '', loading: false, messages: [] };
  const correctCount = Object.values(attempts).filter((item) => item.submitted && !item.skipped && item.correct).length;
  const wrongCount = Object.values(attempts).filter((item) => item.submitted && !item.skipped && !item.correct).length;
  const skippedCount = Object.values(attempts).filter((item) => item.skipped && !item.submitted).length;
  const submittedAttempts = Object.values(attempts).filter((item) => item.submitted && !item.skipped);
  const finished = Object.values(attempts).filter((item) => item.submitted || item.skipped).length >= questions.length;
  const averageScore = submittedAttempts.length
    ? submittedAttempts.reduce((sum, item) => sum + item.score, 0) / submittedAttempts.length
    : 0;
  const weakConcepts = questions
    .filter((item) => {
      const itemAttempt = attempts[item.id];
      return itemAttempt?.submitted && !itemAttempt.correct;
    })
    .flatMap((item) => quizQuestionWeakConceptLabels(item, attempts[item.id]));
  const uniqueWeakConcepts = Array.from(new Set([...(result.practiceNext?.mastery?.weakConcepts || []), ...weakConcepts])).slice(0, 8);
  const masteredConcepts = questions
    .filter((item) => {
      const itemAttempt = attempts[item.id];
      return itemAttempt?.submitted && itemAttempt.correct;
    })
    .map(quizQuestionConcept);
  const uniqueMasteredConcepts = Array.from(new Set([...(result.practiceNext?.mastery?.masteredConcepts || []), ...masteredConcepts])).slice(0, 8);
  const nextTemplate = result.practiceNext?.templateId
    ? templates.find((template) => template.id === result.practiceNext?.templateId) || null
    : null;
  const isHistoricalReview = Boolean(sessionSnapshot && hasRestoredSnapshotRef.current);

  useEffect(() => {
    let cancelled = false;
    const loadSnapshot = async () => {
      if (result.resourceType !== 'quiz') return;
      setLoadingSnapshot(true);
      try {
        const events = await learningApi.listLearningEvents(workspaceId, {
          workbenchId,
          eventType: 'quiz.completed',
          objectId: result.id,
          limit: 1
        });
        if (cancelled) return;
        const event = events.events?.[0];
        const payload = event?.payload || {};
        const snapshot = payload?.snapshot || payload;
        if (snapshot?.questions && snapshot?.attempts) {
          const restoredSnapshot: QuizSessionSnapshot = {
            savedAt: event?.createdAt || event?.observedAt || new Date().toISOString(),
            summary: snapshot.summary || {
              correctCount: 0,
              wrongCount: 0,
              skippedCount: 0,
              averageScore: 0,
              questionCount: questions.length
            },
            questions: snapshot.questions,
            attempts: snapshot.attempts
          };
          hasRestoredSnapshotRef.current = true;
          setAttempts(snapshot.attempts);
          setSessionSnapshot(restoredSnapshot);
        }
      } catch {
        if (!cancelled) setSessionSnapshot(null);
      } finally {
        if (!cancelled) setLoadingSnapshot(false);
      }
    };
    void loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [result.id, result.resourceType, workspaceId, workbenchId, questions.length]);

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

  const retryQuestion = () => {
    setAttempts((current) => ({
      ...current,
      [question.id]: {
        answer: '',
        submitted: false,
        skipped: false,
        correct: false,
        score: 0,
        feedback: '',
        missingPoints: [],
        matchedPoints: [],
        retryCount: (current[question.id]?.retryCount || 0) + 1,
        reviewNotes: current[question.id]?.feedback ? [current[question.id].feedback] : current[question.id]?.reviewNotes || []
      }
    }));
    setHintOpenByQuestion((current) => ({ ...current, [question.id]: false }));
  };

  const startNextPractice = () => {
    if (!nextTemplate || !onGenerateTemplate) return;
    const focus = Array.from(new Set([...weakConcepts, ...(result.practiceNext?.focusConcepts || [])])).slice(0, 5);
    const seed = [
      result.practiceNext?.reason || '根据本次练习结果生成下一组练习。',
      focus.length ? `聚焦薄弱点：${focus.join('、')}` : '',
      `推荐难度：${result.practiceNext?.preferredDifficulty || 'adaptive'}`,
      `本次平均得分：${Math.round(averageScore * 100)}%`
    ].filter(Boolean).join('\n');
    onGenerateTemplate(nextTemplate, seed);
  };

  const saveQuizSnapshot = async () => {
    if (hasRestoredSnapshotRef.current || sessionSnapshot) return;
    const snapshot: QuizSessionSnapshot = {
      savedAt: new Date().toISOString(),
      summary: {
        correctCount,
        wrongCount,
        skippedCount,
        averageScore,
        questionCount: questions.length
      },
      questions,
      attempts
    };
    await learningApi.recordLearningEvent({
      workspaceId,
      workbenchId,
      eventType: 'quiz.completed',
      actor: 'user',
      object: { type: 'quiz_result', id: result.id, title: quizMeta.title || result.name },
      payload: {
        resultId: result.id,
        snapshot
      },
      interaction: {
        answerCorrect: correctCount > wrongCount,
        score: averageScore
      },
      confidence: 0.88
    });
    setSessionSnapshot(snapshot);
  };

  useEffect(() => {
    if (!finished || sessionSnapshot || loadingSnapshot || hasRestoredSnapshotRef.current) return;
    void saveQuizSnapshot().catch((error) => console.warn('Quiz snapshot save failed:', error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

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
          conceptId: question.conceptId,
          objectiveId: question.objectiveId,
          tier: question.tier,
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
          conceptId: question.conceptId,
          objectiveId: question.objectiveId,
          tier: question.tier,
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
    if (isHistoricalReview) {
      if (!isLastQuestion) {
        setIndex((current) => current + 1);
      }
      return;
    }
    if (!attempt?.submitted && !currentAnswer.trim()) {
      markSkipped();
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
  const showHint = Boolean(hintOpenByQuestion[question.id]);
  const progressPercent = questions.length ? ((index + 1) / questions.length) * 100 : 0;

  if (finished && !isHistoricalReview) {
    return (
      <div>
        <QuizCompletionSummary
          result={result}
          questions={questions}
          averageScore={averageScore}
          correctCount={correctCount}
          wrongCount={wrongCount}
          skippedCount={skippedCount}
          weakConcepts={uniqueWeakConcepts}
          masteredConcepts={uniqueMasteredConcepts}
          nextTemplate={nextTemplate}
          onGenerateTemplate={onGenerateTemplate}
        />
      </div>
    );
  }

  return (
    <div className="px-4 py-4 text-[13px] md:px-5">
      <div className="flex flex-col gap-2 border-b border-[#eef0f4] pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-[#1f5fd0]">
            {index + 1}/{questions.length}
          </div>
          <div className="flex items-center gap-3 text-xs text-[#5d6472]">
            <span className="inline-flex items-center gap-1">
              <X className="h-3.5 w-3.5 text-[#c43628]" />
              {wrongCount} wrong
            </span>
            <span className="inline-flex items-center gap-1">
              <Check className="h-3.5 w-3.5 text-[#17833f]" />
              {correctCount} correct
            </span>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#e9edf5]">
          <div
            className="h-full rounded-full bg-[#1f5fd0] transition-all duration-300"
            style={{ width: `${Math.max(4, Math.min(100, progressPercent))}%` }}
          />
        </div>
      </div>

      <div className="pt-4">
        <h3 className="max-w-5xl text-[15px] font-semibold leading-6 text-[#202124]">
          {renderQuestionText(question.question)}
        </h3>

        {isChoiceQuestion(question.type) ? (
          <div className="mt-4 space-y-3">
            {(question.options.length ? question.options : ['A. 选项 A', 'B. 选项 B', 'C. 选项 C', 'D. 选项 D']).map((option) => {
              const optionId = optionIdOf(option);
              const selected = attempt?.selectedOptionId === optionId || currentAnswer === option;
              const isCorrectOption = attempt?.submitted && question.answer === optionId;
              const isWrongSelected = attempt?.submitted && attempt?.selectedOptionId === optionId && question.answer !== optionId;
              const optionFeedback = question.choiceFeedback?.[optionId as 'A' | 'B' | 'C' | 'D'];
              const optionText = option.replace(/^[A-D][\).\s]+/, '').trim() || option;
              return (
                <div
                  key={option}
                  className={`relative rounded-lg border transition ${
                    isCorrectOption
                      ? 'border-[#14b8a6] bg-[#f8fffd]'
                      : isWrongSelected
                        ? 'border-[#f0d8d6] bg-[#fcf5f4]'
                        : selected
                          ? 'border-[#b8c4ff] bg-[#f3f5ff]'
                          : 'border-[#d5dbe5] bg-white hover:border-[#b8c4d6]'
                  }`}
                >
                  <button
                    onClick={() => void submitChoice(option)}
                    disabled={attempt?.submitted || judging}
                    className="flex min-h-[52px] w-full items-center justify-center px-10 py-3 text-center text-[13px] font-medium leading-5 text-[#202124]"
                  >
                    <span className="max-w-full break-words">{renderQuestionText(optionText)}</span>
                  </button>
                  {isCorrectOption ? (
                    <span className="absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-[#14b8a6] text-white">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                  {attempt?.submitted && (isCorrectOption || isWrongSelected) ? (
                    <div className="border-t border-black/5 px-4 py-3 text-sm leading-6 text-[#34373c]">
                      {isWrongSelected && (
                        <div className="flex items-start gap-2">
                          <X className="mt-1 h-4 w-4 shrink-0 text-[#c43628]" />
                          <div className="text-red-800">
                            <div className="text-sm font-medium text-[#c43628]">Not quite</div>
                            <div className="mt-1 text-sm leading-6 text-[#202124]">
                              {optionBriefFeedback(optionFeedback || attempt?.feedback || question.explanation, 20, '看下方解析')}
                            </div>
                          </div>
                        </div>
                      )}
                      {isCorrectOption && (
                        <div className="flex items-start gap-2">
                          <Check className="mt-1 h-4 w-4 shrink-0 text-[#14a38f]" />
                          <div className="text-green-900">
                            <div className="text-sm font-medium text-[#0f8f7e]">That's right!</div>
                            <div className="mt-1 text-sm leading-6 text-[#202124]">
                              {optionBriefFeedback(optionFeedback || question.explanation || attempt?.feedback, 15, '看下方解析')}
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
          <div className="mt-4 space-y-3">
            <input
              value={currentAnswer}
              onChange={(event) => updateAnswer(event.target.value)}
              disabled={attempt?.submitted}
              className="min-h-[52px] w-full rounded-lg border border-[#d5dbe5] bg-white px-4 text-center text-[13px] font-medium leading-5 text-[#202124] outline-none transition placeholder:font-normal placeholder:text-[#8b95a7] focus:border-[#b8c4ff] disabled:opacity-70"
              placeholder="在此填写你的答案"
            />
            {!attempt?.submitted ? (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={judging || !currentAnswer.trim()}
                className="inline-flex items-center justify-center rounded-lg border border-[#d5dbe5] bg-white px-3 py-2 text-[13px] font-semibold text-[#1f5fd0] transition hover:border-[#b8c4d6] hover:bg-[#f8fbff] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {judging ? '验证中...' : '验证答案'}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <textarea
              value={currentAnswer}
              onChange={(event) => updateAnswer(event.target.value)}
              disabled={attempt?.submitted}
              rows={3}
              className="w-full resize-none rounded-lg border border-[#d5dbe5] bg-white px-4 py-3 text-[13px] leading-6 text-[#202124] outline-none transition placeholder:text-[#8b95a7] focus:border-[#b8c4ff] disabled:opacity-70"
              placeholder="在此填写你的答案"
            />
            {!attempt?.submitted ? (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={judging || !currentAnswer.trim()}
                className="inline-flex items-center justify-center rounded-lg border border-[#d5dbe5] bg-white px-3 py-2 text-[13px] font-semibold text-[#1f5fd0] transition hover:border-[#b8c4d6] hover:bg-[#f8fbff] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {judging ? '验证中...' : '验证答案'}
              </button>
            ) : null}
          </div>
        )}

        {attempt?.submitted && !attempt?.skipped ? (
          <div
            className={`mt-4 rounded-lg border px-4 py-3 text-[#34373c] ${
              attempt.correct
                ? 'border-[#b9e8c5] bg-[#f8fffd]'
                : 'border-[#f0d8d6] bg-[#fcf5f4]'
            }`}
          >
            <div className="flex items-start gap-3">
              {attempt.correct ? (
                <Check className="mt-1 h-4 w-4 shrink-0 text-[#14a38f]" />
              ) : (
                <X className="mt-1 h-4 w-4 shrink-0 text-[#c43628]" />
              )}
              <div>
                <div className={`text-sm font-medium ${attempt.correct ? 'text-[#0f8f7e]' : 'text-[#c43628]'}`}>
                  {attempt.correct ? "That's right!" : 'Not quite'}
                </div>
                <div className="mt-1 text-sm leading-6 text-[#202124]">{attempt.feedback}</div>
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

        <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px] font-semibold text-[#5d6472]">
          <button
            type="button"
            onClick={toggleHint}
            className="text-[#5d6472] transition hover:text-[#1f5fd0]"
          >
            {showHint ? '收起提示' : '查看提示'}
          </button>
        </div>

        {showHint ? (
          <div className="mt-2 rounded-lg border border-[#dfe3ea] bg-[#fbfcfd] px-3 py-2 text-[13px] leading-6 text-[#4f5665]">
            {question.hint || '先圈出题干中的关键条件，再判断它们对应到哪一步运算或概念。'}
          </div>
        ) : null}

        <div className="mt-5 rounded-lg border border-[#d5dbe5] bg-white p-3 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
          <div className="space-y-2">
            {assistant.messages.slice(-4).map((message, messageIndex) => (
              <div
                key={`${message.role}-${messageIndex}-${message.content.slice(0, 12)}`}
                className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-lg px-3 py-2 text-[13px] leading-6 ${
                    message.role === 'assistant'
                      ? 'border border-[#eef1f4] bg-[#fafbfc] text-[#202124]'
                      : 'border border-[#d8e4ff] bg-[#eef5ff] text-[#174ea6]'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 ml-auto max-w-lg rounded-lg border border-[#d5dbe5] bg-white shadow-sm focus-within:border-[#c7d2fe] focus-within:ring-2 focus-within:ring-[#dbe7ff]">
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
              placeholder="询问这题有关问题"
              rows={1}
              className="min-h-[34px] w-full resize-none border-0 bg-transparent px-3 py-1.5 text-[13px] leading-5 text-[#202124] outline-none placeholder:text-[#8b95a7]"
            />
            <div className="flex items-center justify-end px-2.5 pb-2">
              <button
                onClick={() => void sendAssistantMessage()}
                disabled={assistant.loading || !assistant.input.trim()}
                className="inline-flex items-center gap-1.5 px-1 py-0.5 text-[13px] font-semibold text-[#1f5fd0] transition hover:text-[#174ea6] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {assistant.loading ? '思考中...' : '询问此题'}
              </button>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 z-20 -mx-4 mt-5 flex items-center justify-between border-t border-[#dfe3ea] bg-[#fbfbfa]/95 px-4 py-2.5 backdrop-blur md:-mx-5 md:px-5">
          <div className="flex items-center gap-3">
            {index > 0 ? (
              <button
                onClick={() => move(-1)}
                className="inline-flex items-center gap-2 py-2 text-[13px] font-semibold text-[#1f5fd0] transition hover:text-[#174ea6]"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
            ) : (
              <span />
            )}
          </div>
          <div className="flex items-center gap-4">
            {attempt?.submitted && !isHistoricalReview ? (
              <button
                onClick={retryQuestion}
                className="inline-flex items-center justify-center gap-1.5 py-2 text-[13px] font-semibold text-[#5d6472] transition hover:text-[#202124]"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            ) : null}
            <button
              onClick={() => void handleNext()}
              disabled={judging || (isHistoricalReview && isLastQuestion)}
              className="inline-flex items-center gap-2 py-2 text-[13px] font-semibold text-[#1f5fd0] transition hover:text-[#174ea6] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isHistoricalReview && isLastQuestion ? '已到最后一题' : isLastQuestion ? 'Finish' : 'Next'}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneratedFileViewer({
  result,
  workspaceId
}: {
  result: StudioResult;
  workspaceId: string;
}) {
  const fileUrl = fileSystemApi.downloadUrl(workspaceId, result.id);
  const deliveryKind = result.delivery?.kind;

  if (deliveryKind === 'html' || /\.html?$/i.test(result.name)) {
    return (
      <div className="h-[min(760px,calc(100vh-180px))] overflow-hidden bg-white">
        <iframe title={result.name} src={fileUrl} className="h-full w-full bg-white" />
      </div>
    );
  }

  if (deliveryKind === 'pptx' || /\.pptx$/i.test(result.name)) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex items-center justify-end">
          <a
            href={fileUrl}
            className="inline-flex items-center gap-2 rounded-full bg-[#202124] px-4 py-2 text-sm font-semibold text-white"
          >
            <Download className="h-4 w-4" /> Download PPTX
          </a>
        </div>
        <SlideViewer result={{ ...result, content: result.delivery?.previewContent || result.content, name: result.delivery?.filename || result.name }} />
      </div>
    );
  }

  if (deliveryKind === 'python' || deliveryKind === 'tsx' || /\.py$|\.tsx$/i.test(result.name)) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 truncate text-sm text-[#667085]">{result.path}</div>
          <a
            href={fileUrl}
            className="inline-flex items-center gap-2 rounded-full bg-[#202124] px-4 py-2 text-sm font-semibold text-white"
          >
            <Download className="h-4 w-4" /> Download source
          </a>
        </div>
        <MarkdownPreview content={result.delivery?.previewContent || result.content} variant="document" />
      </div>
    );
  }

  return null;
}

function RenderJobPanel({
  initialJob,
  workspaceId,
  sourceFileObjectId
}: {
  initialJob?: AiStudioRenderJob | null;
  workspaceId: string;
  sourceFileObjectId: string;
}) {
  const [job, setJob] = useState<AiStudioRenderJob | null>(initialJob || null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      if (job?.id) {
        setJob(await aiApi.getStudioRenderJob(workspaceId, job.id));
      } else {
        const response = await aiApi.listStudioRenderJobs({ workspaceId, sourceFileObjectId, limit: 1 });
        setJob(response.jobs[0] || null);
      }
    } finally {
      setLoading(false);
    }
  };

  const retry = async () => {
    if (!job?.id) return;
    setLoading(true);
    try {
      setJob(await aiApi.retryStudioRenderJob(workspaceId, job.id));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setJob(initialJob || null);
  }, [initialJob?.id]);

  useEffect(() => {
    if (!job?.id || !['queued', 'running'].includes(job.status)) return;
    const timer = window.setInterval(() => {
      void aiApi.getStudioRenderJob(workspaceId, job.id).then(setJob).catch(() => undefined);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status, workspaceId]);

  useEffect(() => {
    if (!initialJob?.id) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFileObjectId, workspaceId]);

  const statusClass =
    job?.status === 'succeeded'
      ? 'bg-emerald-50 text-emerald-700'
      : job?.status === 'failed'
        ? 'bg-red-50 text-red-700'
        : job?.status === 'running'
          ? 'bg-blue-50 text-blue-700'
          : 'bg-slate-100 text-slate-700';
  const outputUrl = job?.outputFileObjectId ? fileSystemApi.downloadUrl(workspaceId, job.outputFileObjectId) : '';

  return (
    <section className="rounded-lg border border-[#dfe3ea] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">Render Job</div>
          <div className="mt-1 text-sm font-semibold text-[#202124]">{job?.framework || job?.kind || 'renderer'}</div>
        </div>
        <button
          onClick={() => void refresh()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#e5e7eb] text-[#667085] hover:bg-[#f8fafc]"
          title="Refresh render job"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {job ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}>{job.status}</span>
            <span className="rounded-full bg-[#f1f5f9] px-2.5 py-1 text-xs font-semibold text-[#475569]">{job.stage}</span>
            <span className="text-xs text-[#667085]">{Math.round(job.progress || 0)}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf0f5]">
            <div className="h-full rounded-full bg-[#202124] transition-all" style={{ width: `${Math.max(4, Math.min(100, job.progress || 0))}%` }} />
          </div>
          {job.error && <div className="mt-3 rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-700">{job.error}</div>}
          {outputUrl && (
            <a href={outputUrl} className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#202124] px-3 py-1.5 text-xs font-semibold text-white">
              <Download className="h-3.5 w-3.5" /> Download rendered output
            </a>
          )}
          {job.status === 'failed' && (
            <button
              onClick={() => void retry()}
              disabled={loading}
              className="mt-3 ml-2 inline-flex items-center gap-2 rounded-full border border-[#dfe3ea] px-3 py-1.5 text-xs font-semibold text-[#343a46] hover:bg-[#f8fafc] disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Retry render
            </button>
          )}
          {job.logs?.length ? (
            <div className="mt-3 max-h-36 overflow-auto rounded-lg bg-[#f8fafc] p-3 text-xs leading-5 text-[#667085]">
              {job.logs.slice(-6).map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-[#dfe3ea] p-3 text-xs leading-5 text-[#667085]">
          No render job found yet.
        </div>
      )}
    </section>
  );
}

const monacoLanguageFor = (language: string) => {
  const normalized = language.toLowerCase();
  if (['js', 'node', 'nodejs'].includes(normalized)) return 'javascript';
  if (['ts'].includes(normalized)) return 'typescript';
  if (['py', 'python3'].includes(normalized)) return 'python';
  if (['c++', 'cpp17', 'cc'].includes(normalized)) return 'cpp';
  if (normalized === 'golang') return 'go';
  if (['sqlite3', 'sqlite', 'sql'].includes(normalized)) return 'sql';
  return normalized || 'javascript';
};

const extractFirstCodeBlock = (content: string) => {
  const match = content.match(/```([a-zA-Z0-9_+#-]*)\s*([\s\S]*?)```/);
  return {
    language: monacoLanguageFor(match?.[1] || 'javascript'),
    code: match?.[2]?.trim() || ''
  };
};

const extractMarkdownSectionLines = (content: string, titles: string[]) => {
  const escaped = titles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = content.match(new RegExp(`##\\s*(?:${escaped})\\s*([\\s\\S]*?)(?:\\n##|$)`, 'i'));
  return (match?.[1] || '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*\d.、)]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
};

const buildCodeLabModel = (result: StudioResult) => {
  const structured = isObjectRecord(result.structured) ? result.structured : null;
  const payload = isObjectRecord(structured?.payload) ? structured.payload : null;
  const markdownCode = extractFirstCodeBlock(result.content);
  const language = monacoLanguageFor(String(payload?.language || markdownCode.language || 'javascript'));
  const starterCode = String(payload?.starterCode || markdownCode.code || [
    'function solve() {',
    '  console.log("Hello, Code Lab");',
    '}',
    '',
    'solve();'
  ].join('\n'));
  return {
    title: result.template?.title || resultTitle(result.resourceType),
    objective: String(payload?.objective || result.content.match(/##\s*实验目标\s*([\s\S]*?)(?:\n##|$)/i)?.[1] || '').trim(),
    steps: Array.isArray(payload?.steps) ? payload.steps.map(String) : extractMarkdownSectionLines(result.content, ['TODO', '实验步骤']),
    tests: Array.isArray(payload?.tests) ? payload.tests.map(String) : extractMarkdownSectionLines(result.content, ['测试任务', '测试用例']),
    debugHints: Array.isArray(payload?.debugHints) ? payload.debugHints.map(String) : extractMarkdownSectionLines(result.content, ['调试提示']),
    language,
    starterCode
  };
};

function CodeLabWorkbench({ result }: { result: StudioResult }) {
  const lab = useMemo(() => buildCodeLabModel(result), [result.id, result.content, result.structured]);
  const [language, setLanguage] = useState(lab.language);
  const [code, setCode] = useState(lab.starterCode);
  const [stdin, setStdin] = useState('');
  const [runResult, setRunResult] = useState<AiCodeLabRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setLanguage(lab.language);
    setCode(lab.starterCode);
    setStdin('');
    setRunResult(null);
    setRunError(null);
  }, [lab.language, lab.starterCode, result.id]);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setRunError(null);
    try {
      setRunResult(await aiApi.runCodeLab({ language, sourceCode: code, stdin }));
    } catch (error: any) {
      setRunError(error?.response?.data?.error || error?.message || 'Code execution failed');
      setRunResult(null);
    } finally {
      setRunning(false);
    }
  };

  const outputText = [
    runResult?.stdout ? `stdout\n${runResult.stdout}` : '',
    runResult?.compileOutput ? `compile output\n${runResult.compileOutput}` : '',
    runResult?.stderr ? `stderr\n${runResult.stderr}` : '',
    runResult?.message ? `message\n${runResult.message}` : ''
  ].filter(Boolean).join('\n\n');

  return (
    <div className="flex h-[calc(100vh-190px)] min-h-[720px] flex-col overflow-hidden bg-white">
      <section className="max-h-[38%] overflow-auto border-b border-[#e5e7eb] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#7b8190]">
              <Code className="h-4 w-4" /> Code Lab
            </div>
            <h3 className="mt-2 text-xl font-semibold text-[#202124]">{lab.title}</h3>
            {lab.objective && <p className="mt-3 max-w-5xl text-sm leading-6 text-[#4f5665]">{lab.objective}</p>}
          </div>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {lab.steps.length > 0 && (
            <section className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#202124]"><ClipboardCheck className="h-4 w-4" /> Steps</div>
              <ol className="mt-2 space-y-2 text-sm leading-6 text-[#4f5665]">
                {lab.steps.map((step, index) => <li key={`${step}-${index}`}>{index + 1}. {step}</li>)}
              </ol>
            </section>
          )}
          {lab.tests.length > 0 && (
            <section className="min-w-0">
              <div className="text-sm font-semibold text-[#202124]">Tests</div>
              <div className="mt-2 space-y-2">
                {lab.tests.map((test, index) => (
                  <div key={`${test}-${index}`} className="rounded-md border border-[#e5e7eb] bg-[#fbfcfd] px-3 py-2 text-sm leading-5 text-[#4f5665]">{test}</div>
                ))}
              </div>
            </section>
          )}
          {lab.debugHints.length > 0 && (
            <section className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#202124]"><CircleAlert className="h-4 w-4" /> Hints</div>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-[#4f5665]">
                {lab.debugHints.map((hint, index) => <li key={`${hint}-${index}`}>- {hint}</li>)}
              </ul>
            </section>
          )}
        </div>
      </section>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-[#e5e7eb] bg-[#fbfcfd] px-4 py-3">
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="h-9 rounded-md border border-[#dfe3ea] bg-white px-3 text-sm font-semibold text-[#202124] outline-none"
          >
            {['javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'go', 'rust', 'sql'].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[#202124] px-4 text-sm font-semibold text-white transition hover:bg-[#3c4043] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run
          </button>
        </div>
        <div className="min-h-[420px] flex-1">
          <Editor
            height="100%"
            language={monacoLanguageFor(language)}
            theme="light"
            value={code}
            onChange={(value) => setCode(value || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'on'
            }}
          />
        </div>
        <div className="grid h-48 grid-cols-[minmax(240px,30%)_minmax(0,1fr)] border-t border-[#e5e7eb]">
          <label className="flex min-h-0 flex-col border-r border-[#e5e7eb] bg-white">
            <span className="border-b border-[#e5e7eb] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#7b8190]">stdin</span>
            <textarea
              value={stdin}
              onChange={(event) => setStdin(event.target.value)}
              className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-sm text-[#202124] outline-none"
              spellCheck={false}
            />
          </label>
          <div className="min-h-0 overflow-auto bg-white">
            <div className="flex items-center justify-between border-b border-[#e5e7eb] px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">output</span>
              {runResult && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${runResult.status.success ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {runResult.status.description}
                </span>
              )}
            </div>
            <pre className="whitespace-pre-wrap p-3 font-mono text-sm leading-6 text-[#202124]">
              {runError || outputText || 'Run code to see stdout, stderr, compile output, time, and memory.'}
            </pre>
            {runResult && (
              <div className="border-t border-[#e5e7eb] px-3 py-2 text-xs text-[#7b8190]">
                time {runResult.time || '-'}s · memory {runResult.memory ?? '-'} KB · provider {runResult.provider}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function ResultView({
  result,
  workspaceId,
  workbenchId,
  templates,
  onBack,
  onGenerateTemplate,
  onPersistFlashcardDeck,
  onOpenResource
}: {
  result: StudioResult;
  workspaceId: string;
  workbenchId?: string;
  templates: AiStudioTemplate[];
  onBack: () => void;
  onGenerateTemplate?: (template: AiStudioTemplate, seed?: string) => void;
  onPersistFlashcardDeck?: (resultId: string, deck: FlashcardDeck) => void;
  onOpenResource?: (resource: ResourceReference) => void;
}) {
  const quizMeta = result.resourceType === 'quiz' ? parseQuizMeta(result.content) : null;
  const resourceNotes = isResourceNotesResult(result);
  const noteTitle = resourceNotes ? noteTitleForResult(result) : '';
  const headerTitle = studioResultHeaderTitle(result, quizMeta);
  const sourceCount = studioResultSourceCount(result, quizMeta);
  const headerMeta = `${studioResultTypeLabel(result)} · Based on ${sourceCount} sources`;
  const hasGeneratedFileViewer = Boolean(result.delivery && result.delivery.kind !== 'markdown');
  const teachingVisualization = extractTeachingVisualizationPayload(result);
  const visualExplainer = extractVisualExplainerPayload(result);
  const [resourceNote, setResourceNote] = useState<FileSystemObject | null>(result.createdNote || null);
  const [resourceNoteError, setResourceNoteError] = useState<string | null>(result.autoCreateNoteError || null);
  const [openingNote, setOpeningNote] = useState(false);

  useEffect(() => {
    setResourceNote(result.createdNote || null);
  }, [result.id, result.createdNote]);

  useEffect(() => {
    setResourceNoteError(result.autoCreateNoteError || null);
  }, [result.id, result.autoCreateNoteError]);

  const openResourceNote = (file: FileSystemObject) => {
    if (typeof window === 'undefined') return;
    if (onOpenResource) {
      onOpenResource(resourceReferenceFromFile(file));
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('resourceId', file.id);
    window.location.assign(url.toString());
  };

  const openOrCreateResourceNote = async () => {
    if (!resourceNotes || openingNote) return;
    if (resourceNote) {
      openResourceNote(resourceNote);
      return;
    }
    setOpeningNote(true);
    setResourceNoteError(null);
    try {
      const created = await createResourceNotesFile({
        workspaceId,
        workbenchId,
        result,
        title: noteTitle
      });
      setResourceNote(created);
      openResourceNote(created);
    } catch (createError: any) {
      setResourceNoteError(createError?.response?.data?.error || createError?.message || 'Failed to open note');
    } finally {
      setOpeningNote(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center justify-between gap-4 bg-white px-6 pb-3 pt-5">
        <div className="min-w-0">
          <button onClick={onBack} className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-[#5f6368] hover:text-[#202124]">
            <ArrowLeft className="h-4 w-4" /> Studio
          </button>
          <h2 className="truncate text-[22px] font-semibold text-[#202124]">{headerTitle}</h2>
          <div className="mt-0.5 text-xs text-[#777a80]">
            {headerMeta}
          </div>
        </div>
        {resourceNotes && (
          <button
            type="button"
            onClick={() => void openOrCreateResourceNote()}
            disabled={openingNote}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#dfe3ea] px-4 py-2 text-sm font-semibold text-[#343a46] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {openingNote && <Loader2 className="h-4 w-4 animate-spin" />}
            Open Note
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-h-full bg-white px-6 pb-6 pt-1">
          <StudioResultSelectionContext
            workspaceId={workspaceId}
            workbenchId={workbenchId}
            result={result}
            sourceLabel={headerTitle}
          >
            <div className="min-w-0">
              {visualExplainer ? (
                <VisualExplainerViewer result={result} />
              ) : teachingVisualization ? (
                <TeachingVisualizationViewer result={result} />
              ) : hasGeneratedFileViewer ? (
                <GeneratedFileViewer result={result} workspaceId={workspaceId} />
              ) : result.resourceType === 'flashcards' ? (
                <FlashcardViewer
                  result={result}
                  workspaceId={workspaceId}
                  workbenchId={workbenchId}
                  onPersistDeck={onPersistFlashcardDeck}
                />
              ) : result.resourceType === 'slide_deck' ? (
                <SlideViewer result={result} />
              ) : result.resourceType === 'mind_map' ? (
                <MindMapViewer result={result} />
              ) : result.resourceType === 'data_table' ? (
                <DataTableViewer result={result} />
              ) : result.resourceType === 'code_lab' ? (
                <CodeLabWorkbench result={result} />
              ) : result.resourceType === 'quiz' ? (
                <QuizViewer
                  result={result}
                  workspaceId={workspaceId}
                  workbenchId={workbenchId}
                  templates={templates}
                  onGenerateTemplate={onGenerateTemplate}
                />
              ) : (
                resourceNotes ? (
                  <ResourceNotesResultView result={result} error={resourceNoteError} />
                ) : (
                  <div className="mx-auto max-w-4xl">
                    <MarkdownPreview content={result.content} variant="document" />
                  </div>
                )
              )}
            </div>
          </StudioResultSelectionContext>
        </div>
      </div>
    </div>
  );
}

function ResourceNotesResultView({
  result,
  error
}: {
  result: StudioResult;
  error?: string | null;
}) {
  const noteContent = stripMarkdownTitle(result.content);

  return (
    <div className="mx-auto max-w-5xl">
      {error && <div className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <MarkdownPreview content={noteContent} variant="document" />
    </div>
  );
}

export default function AIStudioPanel({
  editor,
  workspaceId,
  aiContext,
  resources: workbenchResources,
  onUpdateViewState,
  onOpenResource,
  initialTemplateId,
  initialTemplateRequestId
}: AIStudioPanelProps) {
  const [modal, setModal] = useState<StudioModalState | null>(null);
  const [practiceDraft, setPracticeDraft] = useState<{
    open: boolean;
    sourceIds: string[];
    prompt: string;
    templateId: string;
    questionAmount: PracticeQuestionAmount;
    difficulty: PracticeDifficulty;
  }>({
    open: false,
    sourceIds: [],
    prompt: practiceDefaultSeed,
    templateId: 'custom_practice',
    questionAmount: 'standard',
    difficulty: 'medium'
  });
  const [templates, setTemplates] = useState<AiStudioTemplate[]>([]);
  const [goals, setGoals] = useState<AiStudioGoalInfo[]>([]);
  const [recommendations, setRecommendations] = useState<AiStudioRecommendation[]>([]);
  const [artifacts, setArtifacts] = useState<AiStudioArtifactSummary[]>([]);
  const [studioResources, setStudioResources] = useState<StudioSelectableResource[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<AiStudioGoalCategory | null>(null);
  const [loadingStudio, setLoadingStudio] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<StudioGenerationProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(initialTemplateId || null);
  const results = (editor.viewState.studioResults || []) as StudioResult[];
  const activeResultId = editor.viewState.activeStudioResultId as string | undefined;
  const activeResult = results.find((result) => result.id === activeResultId) || null;
  const activeStudioView = editor.viewState.activeStudioView as string | undefined;
  const effectiveTemplates = templates.length ? templates : visibleStudioTemplates(coreStudioTemplates);
  const selectedTemplate = modal?.templateId ? effectiveTemplates.find((template) => template.id === modal.templateId) || null : null;
  const practiceTemplate = useMemo(
    () => effectiveTemplates.find((template) => template.id === 'custom_practice') || effectiveTemplates.find((template) => template.id === practiceDraft.templateId) || visibleStudioTemplates(coreStudioTemplates)[0],
    [effectiveTemplates, practiceDraft.templateId]
  );
  const effectiveWorkbenchResources = workbenchResources || EMPTY_STUDIO_RESOURCES;
  const sharedWorkbenchResources = useMemo(
    () => effectiveWorkbenchResources.filter((resource) => resource.type !== 'folder'),
    [effectiveWorkbenchResources]
  );
  const sharedWorkbenchResourceKey = useMemo(
    () => sharedWorkbenchResources.map((resource) => resource.id).join('|'),
    [sharedWorkbenchResources]
  );
  const effectiveWorkbenchId =
    aiContext?.workbenchId ||
    aiContext?.activeFile?.ownerWorkbenchId ||
    aiContext?.openPanels?.find((panel) => panel.ownerWorkbenchId)?.ownerWorkbenchId ||
    workbenchIdFromLocation() ||
    undefined;

  const buildStudioContext = (sourceScope?: Pick<StudioModalState, 'selectedResourceIds'>): AiChatContext => {
    const selectedResourceIds = sourceScope?.selectedResourceIds || [];
    const contextPayload: AiChatContext = {
      workspaceId,
      workbenchId: effectiveWorkbenchId,
      contextMode: 'workbench' as AiContextMode,
      sourcePriority: 'selected_resources',
      activeContextChips: [
        { id: 'studio-resource-scope', kind: 'resource_scope', enabled: true },
        { id: 'studio-selection', kind: 'selection', enabled: false },
        { id: 'studio-viewport', kind: 'viewport', enabled: false },
        { id: 'studio-active-file', kind: 'active_file', enabled: false }
      ],
      activeFileId: null,
      activeFile: null,
      activePanelId: null,
      openPanels: [],
      lockedSelection: null,
      selectedText: '',
      selectedResourceIds
    };
    return contextPayload;
  };

  const buildSelectedSourcesOnlyContext = (selectedResourceIds: string[]): AiChatContext => ({
    workspaceId,
    workbenchId: effectiveWorkbenchId,
    contextMode: 'workbench' as AiContextMode,
    sourcePriority: 'selected_resources',
    activeContextChips: [
      { id: 'studio-resource-scope', kind: 'resource_scope', enabled: true },
      { id: 'studio-selection', kind: 'selection', enabled: false },
      { id: 'studio-viewport', kind: 'viewport', enabled: false },
      { id: 'studio-active-file', kind: 'active_file', enabled: false }
    ],
    activeFileId: null,
    activeFile: null,
    activePanelId: null,
    openPanels: [],
    lockedSelection: null,
    selectedText: '',
    selectedResourceIds
  });

  useEffect(() => {
    let cancelled = false;
    const loadStudio = async () => {
      setLoadingStudio(true);
      try {
        const contextPayload = buildStudioContext();
        const [templateResponse, recommendationResponse, artifactResponse] = await Promise.all([
          aiApi.listStudioTemplates(),
          aiApi.recommendStudioResources({
            workspaceId,
            workbenchId: aiContext?.workbenchId,
            context: contextPayload
          }).catch((recommendError) => {
            console.warn('AI Studio recommendation failed:', recommendError);
            return { recommendations: [], signals: {}, features: {} };
          }),
          aiApi.listStudioArtifacts({
            workspaceId,
            workbenchId: aiContext?.workbenchId,
            limit: 8
          }).catch(() => ({ artifacts: [] }))
        ]);
        if (cancelled) return;
        setGoals(templateResponse.goals || []);
        const mergedTemplates = mergeTemplates(templateResponse.templates || []);
        setTemplates(mergedTemplates);
        setRecommendations(recommendationResponse.recommendations || []);
        setArtifacts(artifactResponse.artifacts || []);
      } catch (loadError: any) {
        if (!cancelled) {
          setGoals(studioGoalCatalog.filter((goal) => visibleStudioGoalIds.has(goal.id)));
          setTemplates(visibleStudioTemplates(coreStudioTemplates));
          setRecommendations([]);
          setError(loadError?.response?.data?.error || loadError?.message || 'AI Studio context failed');
        }
      } finally {
        if (!cancelled) setLoadingStudio(false);
      }
    };
    void loadStudio();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, effectiveWorkbenchId]);

  const refreshStudioResources = async () => {
      if (sharedWorkbenchResources.length > 0) {
        const selectable = sharedWorkbenchResources.filter(isSelectableStudioResource);
        setStudioResources(selectable);
        setModal((current) => {
          if (!current) return current;
          const validIds = new Set(selectable.map((resource) => resource.id));
          return {
            ...current,
            selectedResourceIds: current.selectedResourceIds.filter((id) => validIds.has(id))
          };
        });
        setLoadingResources(false);
        return;
      }
      if (!effectiveWorkbenchId) {
        setStudioResources([]);
        setLoadingResources(false);
        return;
      }
      setLoadingResources(true);
      try {
        const resources = await fileSystemApi.getResources(workspaceId, {
          workbenchId: effectiveWorkbenchId,
          scope: 'workbench'
        });
        const files = resources.filter(isSelectableStudioResource).map(toStudioSelectableResource);
        setStudioResources(files);
        setModal((current) => {
          if (!current) return current;
          const validIds = new Set(files.map((resource) => resource.id));
          return {
            ...current,
            selectedResourceIds: current.selectedResourceIds.filter((id) => validIds.has(id))
          };
        });
      } catch (resourceError) {
        console.warn('AI Studio resource list failed:', resourceError);
        setStudioResources([]);
      } finally {
        setLoadingResources(false);
      }
    };

  useEffect(() => {
    let cancelled = false;
    const loadResources = async () => {
      if (cancelled) return;
      await refreshStudioResources();
    };
    void loadResources();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, effectiveWorkbenchId, sharedWorkbenchResourceKey]);

  useEffect(() => {
    if (selectedGoal === 'practice') {
      void refreshStudioResources();
    }
  }, [selectedGoal]);

  useEffect(() => {
    setPendingTemplateId(initialTemplateId || null);
  }, [initialTemplateId, initialTemplateRequestId]);

  useEffect(() => {
    if (!generating || !generationProgress) return;
    const timer = window.setInterval(() => {
      setGenerationProgress((current) => {
        if (!current) return current;
        const elapsedMs = Date.now() - current.startedAt;
        const stageIndex = elapsedMs < 3500
          ? 0
          : elapsedMs < 12000
            ? 1
            : elapsedMs < 26000
              ? 2
              : elapsedMs < 40000
                ? 3
                : elapsedMs < 56000
                  ? 4
                  : elapsedMs < 76000
                    ? 5
                    : elapsedMs < 98000
                      ? 6
                      : elapsedMs < 120000
                        ? 7
                        : 8;
        return { ...current, elapsedMs, stageIndex };
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [generating, generationProgress?.startedAt]);

  const generate = async (overrideModal?: StudioModalState) => {
    const activeModal = overrideModal || modal;
    if (!activeModal || generating) return;
    const sourceFirstTemplate = isResourceNotesTemplate(activeModal.templateId) || isResourceCompareTemplate(activeModal.templateId);
    if (!activeModal.topic.trim() && !(sourceFirstTemplate && activeModal.selectedResourceIds.length)) {
      setError(sourceFirstTemplate ? '请先选择至少一个 source，或填写转换要求。' : '请先填写生成要求。');
      return;
    }
    setGenerating(true);
    setGenerationProgress({
      templateId: activeModal.templateId,
      renderer: (activeModal.templateId ? effectiveTemplates.find((template) => template.id === activeModal.templateId)?.renderer : selectedTemplate?.renderer) || null,
      startedAt: Date.now(),
      elapsedMs: 0,
      stageIndex: 0
    });
    setError(null);
    try {
      const contextPayload = buildSelectedSourcesOnlyContext(activeModal.selectedResourceIds);
      const response = await aiApi.generateStudioResource({
        workspaceId,
        workbenchId: effectiveWorkbenchId,
        resourceType: activeModal.templateId ? undefined : activeModal.resourceType,
        templateId: activeModal.templateId,
        goal: activeModal.goal,
        prompt: buildPrompt(activeModal),
        options: templateOptionsFor(activeModal),
        context: contextPayload
      });
      const responseTemplate = response.template || (activeModal.templateId ? effectiveTemplates.find((template) => template.id === activeModal.templateId) : null);
      let result: StudioResult = {
        id: response.file.id,
        name: response.file.name,
        path: response.file.path,
        resourceType: response.resourceType || templateResourceType(responseTemplate),
        template: responseTemplate || null,
        goal: response.goal || activeModal.goal,
        generator: response.generator,
        renderer: response.renderer,
        content: response.content,
        createdAt: new Date().toISOString(),
        runId: response.runId,
        source: response.source,
        metadata: {
          ...(response.metadata || {}),
          selectedResourceIds: activeModal.selectedResourceIds
        },
        flashcardDeck: response.flashcardDeck || null,
        summary: response.usedContextSummary,
        workflowTrace: response.workflowTrace || [],
        review: response.review,
        recommendation: response.recommendation || null,
        artifact: response.artifact || null,
        renderJob: response.renderJob || null,
        delivery: response.delivery || null,
        structured: response.structured,
        qualityReport: response.qualityReport as StudioResult['qualityReport'],
        practiceNext: response.practiceNext || null
      };
      let activeStudioResultId: string | null = result.id;
      let autoCreatedNote: FileSystemObject | null = null;
      if (isResourceNotesResult(result)) {
        try {
          autoCreatedNote = await createResourceNotesFile({
            workspaceId,
            workbenchId: effectiveWorkbenchId,
            result
          });
          result = { ...result, createdNote: autoCreatedNote };
          activeStudioResultId = null;
        } catch (noteError: any) {
          const noteMessage =
            noteError?.response?.data?.error ||
            noteError?.message ||
            'AI Studio generated notes, but failed to create the BlockSuite note.';
          result = { ...result, autoCreateNoteError: noteMessage };
          setError(noteMessage);
        }
      }
      const nextResults = [result, ...results.filter((item) => item.id !== result.id)].slice(0, 12);
      onUpdateViewState?.(editor.id, {
        studioResults: nextResults,
        activeStudioResultId,
        lastStudioDebug: {
          contextCapsule: response.contextCapsule,
          contextPolicy: response.contextPolicy,
          usedContextSummary: response.usedContextSummary
        },
        lastStudioGenerationRequest: {
          templateId: activeModal.templateId || null,
          resourceType: activeModal.resourceType,
          sourceScope: {
            workbench: false,
            selectedResourceIds: activeModal.selectedResourceIds
          },
          userRequirement: activeModal.topic.trim()
        }
      });
      setModal(null);
      if (response.artifact) setArtifacts((current) => [response.artifact!, ...current.filter((item) => item.id !== response.artifact?.id)].slice(0, 8));
      if (autoCreatedNote) {
        onOpenResource?.(resourceReferenceFromFile(autoCreatedNote));
      }
    } catch (generateError: any) {
      setError(generateError?.response?.data?.error || generateError?.message || 'AI Studio generation failed');
    } finally {
      setGenerating(false);
      setGenerationProgress(null);
    }
  };

  const submitPractice = async () => {
    if (generating) return;
    const template = practiceTemplate;
    if (!template) {
      setError('Practice template not found');
      return;
    }
    const questionAmount = practiceQuestionAmountOptions.find((option) => option.id === practiceDraft.questionAmount) || practiceQuestionAmountOptions[1];
    setGenerating(true);
    setGenerationProgress({
      templateId: template.id,
      renderer: template.renderer,
      startedAt: Date.now(),
      elapsedMs: 0,
      stageIndex: 0
    });
    setError(null);
    try {
      const contextPayload = buildSelectedSourcesOnlyContext(practiceDraft.sourceIds);
      const response = await aiApi.generateStudioResource({
        workspaceId,
        workbenchId: effectiveWorkbenchId,
        templateId: template.id,
        goal: 'practice',
        prompt: practiceDraft.prompt,
        options: {
          ...templateOptionsFor({
            resourceType: 'quiz',
            templateId: template.id,
            goal: 'practice',
            topic: practiceDraft.prompt,
            selectedResourceIds: practiceDraft.sourceIds
          } as any),
          sourceScope: {
            workbench: false,
            selectedResourceIds: practiceDraft.sourceIds
          },
          questionCount: questionAmount.count,
          difficulty: practiceDraft.difficulty
        },
        context: contextPayload
      });
      const responseTemplate = response.template || template;
      const result: StudioResult = {
        id: response.file.id,
        name: response.file.name,
        path: response.file.path,
        resourceType: response.resourceType || templateResourceType(responseTemplate),
        template: responseTemplate || null,
        goal: response.goal || 'practice',
        generator: response.generator,
        renderer: response.renderer,
        content: response.content,
        createdAt: new Date().toISOString(),
        runId: response.runId,
        source: response.source,
        metadata: {
          ...(response.metadata || {}),
          selectedResourceIds: practiceDraft.sourceIds
        },
        flashcardDeck: response.flashcardDeck || null,
        summary: response.usedContextSummary,
        workflowTrace: response.workflowTrace || [],
        review: response.review,
        recommendation: response.recommendation || null,
        artifact: response.artifact || null,
        renderJob: response.renderJob || null,
        delivery: response.delivery || null,
        structured: response.structured,
        qualityReport: response.qualityReport as StudioResult['qualityReport'],
        practiceNext: response.practiceNext || null
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
        lastStudioGenerationRequest: {
          templateId: template.id,
          resourceType: 'quiz',
          sourceScope: {
            workbench: false,
            selectedResourceIds: practiceDraft.sourceIds
          },
          userRequirement: practiceDraft.prompt
        }
      });
      setPracticeDraft((current) => ({ ...current, open: false }));
      if (response.artifact) setArtifacts((current) => [response.artifact!, ...current.filter((item) => item.id !== response.artifact?.id)].slice(0, 8));
    } catch (generateError: any) {
      setError(generateError?.response?.data?.error || generateError?.message || 'AI Studio generation failed');
    } finally {
      setGenerating(false);
      setGenerationProgress(null);
    }
  };

  const openGenerateTemplate = (template: AiStudioTemplate, seed = '') => {
    if (!isVisibleStudioTemplate(template)) return;
    setModal({
      ...defaultTemplateModalState(template),
      topic: seed
    });
    void refreshStudioResources();
  };

  useEffect(() => {
    if (!pendingTemplateId || generating || loadingStudio) return;
    const template = effectiveTemplates.find((item) => item.id === pendingTemplateId);
    if (!template) {
      setPendingTemplateId(null);
      return;
    }
    if (template.goal) setSelectedGoal(template.goal);
    setPendingTemplateId(null);
    void refreshStudioResources();
  }, [effectiveTemplates, generating, loadingStudio, modal?.templateId, pendingTemplateId, refreshStudioResources]);

  if (activeResult) {
    return (
      <ResultView
        result={activeResult}
        workspaceId={workspaceId}
        workbenchId={effectiveWorkbenchId}
        templates={effectiveTemplates}
        onGenerateTemplate={openGenerateTemplate}
        onOpenResource={onOpenResource}
        onPersistFlashcardDeck={(resultId, deck) => {
          const nextResults = results.map((item) =>
            item.id === resultId
              ? {
                  ...item,
                  flashcardDeck: deck,
                  metadata: {
                    ...(item.metadata || {}),
                    flashcardDeckId: deck.id,
                    flashcardDeckPersistedAt: new Date().toISOString()
                  }
                }
              : item
          );
          onUpdateViewState?.(editor.id, { studioResults: nextResults });
        }}
        onBack={() => onUpdateViewState?.(editor.id, { activeStudioResultId: null })}
      />
    );
  }

  if (activeStudioView === 'record') {
    return (
      <AudioRecorderView
        workspaceId={workspaceId}
        workbenchId={effectiveWorkbenchId}
        resources={studioResources}
        loadingResources={loadingResources}
        onClose={() => onUpdateViewState?.(editor.id, { activeStudioView: null })}
        onRefreshResources={() => void refreshStudioResources()}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <StudioHome
        goals={goals}
        templates={templates}
        artifacts={artifacts}
        results={results}
        selectedGoal={selectedGoal}
        setSelectedGoal={setSelectedGoal}
        practiceDraft={practiceDraft}
        setPracticeDraft={setPracticeDraft}
        studioResources={studioResources}
        loadingResources={loadingResources}
        generating={generating}
        onOpenRecorder={() => onUpdateViewState?.(editor.id, { activeStudioView: 'record' })}
        onGenerateFromState={(state) => void generate(state)}
        onSubmitPractice={submitPractice}
        onOpenResult={(id) => onUpdateViewState?.(editor.id, { activeStudioResultId: id })}
        onDeleteResult={async (result) => {
          try {
            await fileSystemApi.remove(workspaceId, result.id);
            onUpdateViewState?.(editor.id, {
              studioResults: results.filter((item) => item.id !== result.id),
              activeStudioResultId: activeResultId === result.id ? null : activeResultId
            });
          } catch (deleteError: any) {
            setError(deleteError?.response?.data?.error || deleteError?.message || 'Failed to delete result');
          }
        }}
      />

      {error && (
        <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</div>
      )}

      {generating && generationProgress ? (
        <StudioGenerationProgressStrip progress={generationProgress} />
      ) : null}

      {modal && (
        <StudioGenerateDetailModal
          template={selectedTemplate || effectiveTemplates.find((template) => template.legacyResourceType === modal.resourceType) || visibleStudioTemplates(coreStudioTemplates)[0]}
          state={modal}
          setState={(patch) => setModal((current) => (current ? { ...current, ...patch } : current))}
          resources={studioResources}
          loadingResources={loadingResources}
          onClose={() => setModal(null)}
          onGenerate={() => void generate(modal)}
          generating={generating}
        />
      )}
    </div>
  );
}
