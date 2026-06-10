import { StudioGenerationContext } from './types';

const clip = (value: unknown, maxLength = 1200) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
};

const preserveMarkdown = (value: unknown) => String(value || '').trim();

const clipMarkdown = (value: unknown, _maxLength = 6000) => preserveMarkdown(value);

const slug = (value: string, fallback: string) => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return normalized || fallback;
};

const VISUAL_MODES: VisualExplainerSection['visualMode'][] = ['slide', 'process', 'diagram', 'comparison', 'whiteboard', 'chart', 'summary'];
const VISUAL_OBJECT_KINDS: VisualExplainerObjectKind[] = ['title', 'card', 'node', 'edge', 'formula', 'table', 'image_hint', 'chart_hint'];
const VISUAL_ACTIONS: VisualExplainerAction[] = ['appear', 'focus', 'connect', 'move', 'transform', 'compare', 'annotate', 'fade'];
const VISUAL_RENDERERS: VisualExplainerRendererKind[] = ['reveal', 'mermaid', 'x6', 'vega_lite', 'tldraw', 'motion_canvas', 'jsav'];
const MERMAID_DIAGRAM_TYPES: VisualExplainerMermaidDiagramType[] = ['flowchart', 'sequenceDiagram', 'stateDiagram', 'classDiagram', 'erDiagram', 'mindmap', 'timeline', 'graph'];
const JSAV_DATA_STRUCTURES: VisualExplainerJsavDataStructure[] = ['array', 'list', 'tree', 'graph', 'matrix', 'heap', 'stack', 'queue'];
const VISUAL_LESSON_MODEL_TYPES: VisualLessonModelType[] = ['table', 'graph', 'sequence', 'code_trace', 'datapath', 'flowchart', 'markdown_mermaid'];

const finiteNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const normalizeX6Terminal = (value: unknown): VisualExplainerX6Terminal | null => {
  if (typeof value === 'string' && value.trim()) return clip(value, 80);
  if (value && typeof value === 'object') {
    const cell = clip((value as any).cell || '', 80);
    if (cell) {
      return {
        cell,
        port: (value as any).port ? clip((value as any).port, 80) : undefined
      };
    }
  }
  return null;
};

const x6TerminalCellId = (terminal: VisualExplainerX6Terminal) =>
  typeof terminal === 'string' ? terminal : terminal.cell;

const rendererFromBlockKind = (kind: VisualExplainerBlock['kind']): VisualExplainerRendererKind =>
  kind === 'markdown' ? 'reveal' : kind;

const hasRendererBlock = (renderer: VisualExplainerRendererKind, blocks: VisualExplainerBlock[]) =>
  renderer === 'reveal' || blocks.some((block) => rendererFromBlockKind(block.kind) === renderer);

const rendererForVisualMode = (visualMode: VisualExplainerSection['visualMode']): VisualExplainerRendererKind => {
  if (visualMode === 'process' || visualMode === 'diagram') return 'mermaid';
  if (visualMode === 'chart') return 'vega_lite';
  if (visualMode === 'whiteboard') return 'tldraw';
  return 'reveal';
};

export type VisualExplainerObjectKind =
  | 'title'
  | 'card'
  | 'node'
  | 'edge'
  | 'formula'
  | 'table'
  | 'image_hint'
  | 'chart_hint';

export type VisualExplainerAction =
  | 'appear'
  | 'focus'
  | 'connect'
  | 'move'
  | 'transform'
  | 'compare'
  | 'annotate'
  | 'fade';

export type VisualExplainerRendererKind =
  | 'reveal'
  | 'mermaid'
  | 'x6'
  | 'vega_lite'
  | 'tldraw'
  | 'motion_canvas'
  | 'jsav';

export type VisualExplainerMermaidDiagramType =
  | 'flowchart'
  | 'sequenceDiagram'
  | 'stateDiagram'
  | 'classDiagram'
  | 'erDiagram'
  | 'mindmap'
  | 'timeline'
  | 'graph';

export type VisualExplainerJsavDataStructure =
  | 'array'
  | 'list'
  | 'tree'
  | 'graph'
  | 'matrix'
  | 'heap'
  | 'stack'
  | 'queue';

export type VisualExplainerX6Terminal = string | { cell: string; port?: string };

export interface VisualExplainerX6NodeMetadata {
  id: string;
  shape?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: string;
  attrs?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface VisualExplainerX6EdgeMetadata {
  id: string;
  shape?: string;
  source: VisualExplainerX6Terminal;
  target: VisualExplainerX6Terminal;
  label?: string;
  attrs?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface VisualExplainerObject {
  id: string;
  kind: VisualExplainerObjectKind;
  label: string;
  detail?: string;
  role?: 'main' | 'support' | 'example' | 'warning' | 'summary';
  fromId?: string;
  toId?: string;
}

export interface VisualExplainerTimelineStep {
  id: string;
  action: VisualExplainerAction;
  targetIds: string[];
  narration: string;
  screenText?: string;
  durationMs?: number;
  statePatch?: Record<string, unknown>;
}

export type VisualLessonModelType =
  | 'table'
  | 'graph'
  | 'sequence'
  | 'code_trace'
  | 'datapath'
  | 'flowchart'
  | 'markdown_mermaid';

export interface VisualLessonTimelineStep {
  stepId: string;
  action: string;
  targetIds: string[];
  screenText?: string;
  narration: string;
  statePatch: Record<string, unknown>;
  durationMs: number;
}

export interface VisualLessonVisualModel {
  type: VisualLessonModelType;
  title: string;
  objects: VisualExplainerObject[];
  blocks: VisualExplainerBlock[];
  markdown: string;
  data?: Record<string, unknown>;
}

export interface VisualLessonSlide {
  id: string;
  title: string;
  bodyMarkdown: string;
  narration: string;
  layout: 'text_visual' | 'visual_first' | 'text_first' | 'full_text';
  visualModel: VisualLessonVisualModel;
  timeline: VisualLessonTimelineStep[];
  checkQuestion?: string;
}

export interface VisualLesson {
  schemaVersion: 'visual_lesson.v1';
  title: string;
  summary: string;
  sourceIds: string[];
  slides: VisualLessonSlide[];
}

export interface VisualCodeLesson {
  schemaVersion: 'visual_code_lesson.v1';
  title: string;
  summary: string;
  sourceIds: string[];
  contentMarkdown: string;
}

export type VisualExplainerBlock =
  | {
      id: string;
      kind: 'markdown';
      markdown: string;
    }
  | {
      id: string;
      kind: 'mermaid';
      diagramType: VisualExplainerMermaidDiagramType;
      code: string;
    }
  | {
      id: string;
      kind: 'x6';
      graph: {
        nodes: VisualExplainerX6NodeMetadata[];
        edges: VisualExplainerX6EdgeMetadata[];
      };
    }
  | {
      id: string;
      kind: 'vega_lite';
      spec: Record<string, unknown>;
    }
  | {
      id: string;
      kind: 'tldraw';
      snapshot?: Record<string, unknown>;
      records?: unknown[];
    }
  | {
      id: string;
      kind: 'motion_canvas';
      sceneName: string;
      source?: string;
      sceneSpec?: Record<string, unknown>;
    }
  | {
      id: string;
      kind: 'jsav';
      source?: string;
      dataStructure: VisualExplainerJsavDataStructure;
      initialState: Record<string, unknown>;
      steps: Array<{
        id: string;
        operation: string;
        targets?: string[];
        state?: Record<string, unknown>;
        explanation?: string;
      }>;
    };

export interface VisualExplainerSection {
  id: string;
  title: string;
  focus: string;
  sourceHint?: string;
  sourceMarkdown?: string;
  bodyMarkdown?: string;
  visualMode: 'slide' | 'process' | 'diagram' | 'comparison' | 'whiteboard' | 'chart' | 'summary';
  screenText: string[];
  narration: string;
  objects: VisualExplainerObject[];
  timeline: VisualExplainerTimelineStep[];
  visualBlocks?: VisualExplainerBlock[];
  preferredRenderer?: VisualExplainerRendererKind;
  checkQuestion?: string;
}

export interface VisualExplainerPayload {
  schemaVersion: 'visual_explainer.v1';
  markdownDraft: string;
  title: string;
  summary: string;
  sections: VisualExplainerSection[];
  visualLesson?: VisualLesson;
  rendererPlan: {
    primary: 'section_player';
    libraries: string[];
    exportTargets: Array<'web' | 'video' | 'pptx'>;
  };
}

export interface VisualExplainerContentMap {
  schemaVersion: 'visual_explainer.content_map.v1';
  title: string;
  summary: string;
  concepts: Array<{ id: string; label: string; explanation: string; sourceHint?: string }>;
  steps: Array<{ id: string; label: string; description: string; order: number; sourceHint?: string }>;
  relationships: Array<{ id: string; from: string; to: string; label: string; kind?: 'cause' | 'sequence' | 'contrast' | 'contains' | 'depends_on' }>;
  examples: Array<{ id: string; label: string; description: string; sourceHint?: string }>;
}

export interface VisualExplainerMarkdownSourceBlock {
  id: string;
  title: string;
  sourcePreview: string;
  keyPoints: string[];
  sourceMarkdown: string;
}

export interface VisualExplainerSectionPlan {
  schemaVersion: 'visual_explainer.section_plan.v1';
  title: string;
  summary: string;
  sections: Array<{
    id: string;
    title: string;
    goal: string;
    sourceHint: string;
    sourceBlockIds: string[];
    sourceMarkdown: string;
    keyPoints: string[];
    sectionType: 'intro' | 'concept' | 'process' | 'example' | 'comparison' | 'derivation' | 'summary';
  }>;
}

export interface VisualExplainerSlideTextPlan {
  schemaVersion: 'visual_explainer.slide_text.v1';
  sections: Array<{
    id: string;
    title: string;
    focus: string;
    screenText: string[];
    narration: string;
    checkQuestion?: string;
  }>;
}

export interface VisualExplainerVisualIntentPlan {
  schemaVersion: 'visual_explainer.visual_intent.v1';
  sections: Array<{
    id: string;
    visualMode: VisualExplainerSection['visualMode'];
    preferredRenderer: VisualExplainerRendererKind;
    blockKinds: VisualExplainerBlock['kind'][];
    reason: string;
  }>;
}

export interface VisualExplainerRendererBlockPlan {
  schemaVersion: 'visual_explainer.renderer_blocks.v1';
  sections: Array<{
    id: string;
    objects: VisualExplainerObject[];
    timeline: VisualExplainerTimelineStep[];
    visualBlocks: VisualExplainerBlock[];
  }>;
}

export interface VisualExplainerValidationReport {
  schemaVersion: 'visual_explainer.validation.v1';
  valid: boolean;
  warnings: string[];
  sectionCount: number;
  visualBlockCount: number;
  rendererCounts: Record<string, number>;
}

export const VISUAL_EXPLAINER_SCHEMA_HINT = {
  schemaVersion: 'visual_explainer.v1',
  markdownDraft: '完整 Markdown 答案。先作为内容底稿，不要省略关键解释。',
  title: 'string',
  summary: 'string',
  sections: [
    {
      id: 'stable-section-id',
      title: 'string',
      focus: '这一幕只聚焦解释什么',
      sourceHint: '来自 Markdown 的哪一段/哪几个小标题',
      sourceMarkdown: '这一幕对应的完整 Markdown 原文片段；这是内容本体，不是摘要，不要裁剪语义',
      bodyMarkdown: '这一幕用于 slide 展示的正文 Markdown；去掉重复大标题和分隔线，但不改写正文语义',
      visualMode: 'slide | process | diagram | comparison | whiteboard | chart | summary',
      screenText: ['短屏幕文字，每条不超过 28 个中文字符'],
      narration: '这一幕的口播说明',
      objects: [
        {
          id: 'stable-object-id',
          kind: 'title | card | node | edge | formula | table | image_hint | chart_hint',
          label: 'string',
          detail: 'string',
          role: 'main | support | example | warning | summary',
          fromId: 'edge 起点，可选',
          toId: 'edge 终点，可选'
        }
      ],
      timeline: [
        {
          id: 'stable-step-id',
          action: 'appear | focus | connect | move | transform | compare | annotate | fade',
          targetIds: ['object-id'],
          narration: '这一步讲什么',
          screenText: '短提示，可选',
          durationMs: 900
        }
      ],
      visualBlocks: [
        {
          id: 'block-id',
          kind: 'mermaid | x6 | vega_lite | tldraw | motion_canvas | jsav | markdown',
          markdown: 'kind=markdown 时使用这一幕的 Markdown 片段',
          code: 'kind=mermaid 时使用 Mermaid 原生 DSL，不要包代码围栏',
          graph: 'kind=x6 时使用 X6 Graph.fromJSON({ nodes, edges }) 兼容 metadata',
          spec: 'kind=vega_lite 时使用 Vega-Lite 原生 JSON spec，包含 data/mark/encoding',
          snapshot: 'kind=tldraw 时只使用 tldraw snapshot；不确定时不要伪造',
          records: 'kind=tldraw 时可使用 tldraw records；不确定时不要伪造',
          source: 'kind=motion_canvas/jsav 时只在能写出有效官方示例风格源码时提供',
          sceneSpec: 'kind=motion_canvas 时可给保守的结构化 sceneSpec',
          dataStructure: 'kind=jsav 时标明 array/list/tree/graph/matrix/heap/stack/queue'
        }
      ],
      preferredRenderer: 'reveal | mermaid | x6 | vega_lite | tldraw | motion_canvas | jsav',
      checkQuestion: '可选自检问题'
    }
  ],
  rendererPlan: {
    primary: 'section_player',
    libraries: ['Motion Canvas', 'React section renderer'],
    exportTargets: ['web', 'video', 'pptx']
  }
};

export const VISUAL_LESSON_SCHEMA_HINT = {
  schemaVersion: 'visual_lesson.v1',
  title: '面向学习者的课件标题',
  summary: '1-3 句话说明这份课件讲什么、用什么例子演示',
  sourceIds: ['只填写输入 selectedSources 中出现过的 id；没有来源则为空数组'],
  slides: [
    {
      id: 'stable-slide-id',
      title: '短标题，不超过 24 个中文字符',
      bodyMarkdown: '这一页左侧/正文区展示的 Markdown。必须是学习者可读内容，不包含内部字段说明。',
      narration: '这一页的自然口播说明，解释为什么要看当前视觉变化。',
      layout: 'text_visual | visual_first | text_first | full_text',
      visualModel: {
        type: 'table | graph | sequence | code_trace | datapath | flowchart | markdown_mermaid',
        title: '视觉区域标题',
        objects: [
          {
            id: 'stable-object-id',
            kind: 'title | card | node | edge | formula | table | image_hint | chart_hint',
            label: '屏幕上显示的短标签',
            detail: '对象解释，可选',
            role: 'main | support | example | warning | summary',
            fromId: 'edge 起点，可选',
            toId: 'edge 终点，可选'
          }
        ],
        blocks: [
          {
            id: 'block-id',
            kind: 'markdown | mermaid | x6 | vega_lite | tldraw | motion_canvas | jsav',
            markdown: 'kind=markdown 时的 Markdown',
            code: 'kind=mermaid 时的 Mermaid DSL，不要代码围栏',
            graph: 'kind=x6 时的 { nodes, edges }',
            spec: 'kind=vega_lite 时的 Vega-Lite spec',
            dataStructure: 'kind=jsav 时的数据结构类型'
          }
        ],
        markdown: '视觉模型的可读降级描述；前端渲染器不可用时展示',
        data: {
          note: '可选结构化数据。table 可放 leftTable/rightTable/resultTable/joinCondition；graph 可放 nodes/edges/start/target；sequence 可放 items；datapath 可放 components/signals/path。'
        }
      },
      timeline: [
        {
          stepId: 'stable-step-id',
          action: 'appear | focus | connect | move | transform | compare | annotate | fade',
          targetIds: ['必须引用 visualModel.objects[].id；没有对象时可为空数组'],
          screenText: '屏幕短提示，不超过 32 个中文字符',
          narration: '这一小步讲什么',
          statePatch: {
            activeTargetIds: ['当前高亮对象 id'],
            note: '渲染器状态增量。table 可放 highlightRows/connections/outputRows；graph 可放 activeNodes/visitedNodes/activeEdges/distances；sequence 可放 activeIndices/items；datapath 可放 activeComponents/activeSignals。'
          },
          durationMs: 900
        }
      ],
      checkQuestion: '可选自检问题'
    }
  ]
};

export const VISUAL_EXPLAINER_CONTENT_MAP_SCHEMA_HINT = {
  schemaVersion: 'visual_explainer.content_map.v1',
  title: 'string',
  summary: 'string',
  concepts: [{ id: 'stable-id', label: '概念/实体名', explanation: '一句解释', sourceHint: 'Markdown 中的依据位置' }],
  steps: [{ id: 'stable-id', label: '步骤名', description: '步骤说明', order: 1, sourceHint: 'Markdown 中的依据位置' }],
  relationships: [{ id: 'stable-id', from: 'concept-or-step-id', to: 'concept-or-step-id', label: '关系名', kind: 'cause | sequence | contrast | contains | depends_on' }],
  examples: [{ id: 'stable-id', label: '例子名', description: '例子说明', sourceHint: 'Markdown 中的依据位置' }]
};

export const VISUAL_EXPLAINER_SECTION_PLAN_SCHEMA_HINT = {
  schemaVersion: 'visual_explainer.section_plan.v1',
  title: 'string',
  summary: 'string',
  sections: [{
    id: 'stable-section-id',
    title: '短标题',
    goal: '这一幕要让用户理解什么',
    sourceHint: '来自哪些 markdownBlocks / content map 部分',
    sourceBlockIds: ['只填写输入 markdownBlocks 中存在的 id，例如 block-1-intro；不要输出 sourceMarkdown 原文'],
    keyPoints: ['2-4 个不同要点'],
    sectionType: 'intro | concept | process | example | comparison | derivation | summary'
  }]
};

export const VISUAL_CODE_LESSON_SCHEMA_HINT = {
  schemaVersion: 'visual_code_lesson.v1',
  title: 'string',
  summary: 'string',
  sourceIds: ['selected source id'],
  contentMarkdown: [
    '# Title',
    '',
    'Teacher-facing explanation in Markdown.',
    '',
    '~~~REACT_VIZ',
    'import { useState } from "react";',
    '',
    'export default function App() {',
    '  return <div className="p-4 text-gray-900">Interactive visualization</div>;',
    '}',
    '~~~'
  ].join('\n')
};

export const visualCodeLessonPrompt = (
  userPrompt: string,
  sources: Array<{ id: string; name: string; path?: string; content: string }>
) => [
  '你是 AI Studio 的教学可视化生成智能体。',
  '你的任务是生成“讲解 Markdown + 可执行前端小动画/交互演示代码”。',
  '',
  '输出硬性要求：',
  '- 只输出一个合法 JSON 对象，不要 Markdown 代码围栏包住 JSON，不要额外解释。',
  '- JSON 顶层 schemaVersion 必须是 "visual_code_lesson.v1"。',
  '- contentMarkdown 是最终展示给学生看的完整内容，里面可以包含普通 Markdown 和可执行可视化代码块。',
  '- 至少生成 1 个可执行可视化代码块；适合交互时优先生成 REACT_VIZ。',
  '',
  '可视化代码块协议：',
  '- React 模式用 ~~~REACT_VIZ 和 ~~~ 包裹 JSX/TSX，标记必须独占一行。',
  '- React 模式必须 export default 导出一个函数组件。',
  '- React 环境预装 React 18、ReactDOM、Babel、Recharts、Tailwind CSS；可以使用 Hooks。',
  '- HTML 模式用 ~~~HTML_VIZ 和 ~~~ 包裹完整自包含 HTML，标记必须独占一行。',
  '- HTML 模式适合 Canvas、SVG、CSS animation、少量 D3/Chart.js 类演示。',
  '- 代码要完整、短小、能直接运行；宁可少做功能，也不要输出半截代码。',
  '',
  '安全限制：',
  '- 不要使用 localStorage、sessionStorage、document.cookie。',
  '- 不要访问 window.parent、parent.document、top、opener。',
  '- 不要使用 fetch、XMLHttpRequest、WebSocket、EventSource、navigator.sendBeacon。',
  '- 不要使用 eval、new Function、动态 import、外链脚本、外链样式或项目内部组件。',
  '- 不要让代码依赖用户本地文件、后端 API、真实账号或环境变量。',
  '',
  '教学质量要求：',
  '- contentMarkdown 要像老师讲课：先讲概念，再给例子，再让动画演示变化，最后给观察问题。',
  '- 动画/交互必须服务于概念理解，不要做装饰性动效。',
  '- 计算机课程内容要具体：算法给输入和状态变化；数据库给表、字段、条件、结果；组成原理给部件和数据流；网络给报文/状态/时序。',
  '- 所有可视化中的文字必须清晰可读：白色/浅色背景，深色文字，不要大面积深色背景。',
  '- 如果资料不足，要在 summary 或正文里说明保守生成，不要编造资料外事实。',
  '',
  '资料忠实度硬性要求：',
  '- 如果「用户勾选资料全文」非空，讲解主题、动画对象、示例数据、术语和步骤必须来自这些资料。',
  '- 不要因为用户要求笼统就另选常见 demo；例如资料是数据库，就不能生成排序、搜索、CPU 数据通路等无关演示。',
  '- 如果用户要求和资料主题冲突，优先围绕资料生成，并在 summary 中用一句话说明已按勾选资料修正主题。',
  '- 可视化代码中的表名、字段名、状态名、概念名应尽量使用资料里出现过的词；没有证据时使用“示例”并说明。',
  '- 生成前先在内部确认：动画是否能被资料片段支持；不能支持的内容不要写进最终 JSON。',
  '',
  '上下文边界：',
  '- 你只能使用「用户要求」和「用户勾选资料全文」。',
  '- 严禁使用、推断或提及 Context Capsule、Workbench 全量资源、当前文件、学习者画像、历史记忆、推荐系统、未勾选资源或 AI Studio 内部工作流。',
  '',
  'Schema 参考：',
  JSON.stringify(VISUAL_CODE_LESSON_SCHEMA_HINT, null, 2),
  '',
  `用户要求：${userPrompt || '把勾选资料转换成带交互动画的视觉化讲解。'}`,
  '',
  '# 用户勾选资料全文',
  sources.length
    ? sources.map((source, index) => [
      `## Source ${index + 1}: ${source.name}`,
      `SourceId: ${source.id}`,
      source.path ? `Path: ${source.path}` : '',
      '',
      source.content || '(empty source text)'
    ].filter(Boolean).join('\n')).join('\n\n---\n\n')
    : '(no selected source text)'
].join('\n');

const stripDangerousVizCode = (value: string) => {
  const text = preserveMarkdown(value);
  if (!text) return '';
  return text.replace(/~~~(REACT_VIZ|HTML_VIZ)\s*\n([\s\S]*?)~~~/g, (block, _kind, code) => {
    const dangerous = /(localStorage|sessionStorage|document\.cookie|window\.parent|parent\.document|\btop\b|\bopener\b|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|eval\s*\(|new\s+Function|import\s*\(|<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=)/i.test(code);
    return dangerous
      ? [
        '> 这个可视化代码块因为包含不允许的浏览器能力，已被安全策略拦截。',
        '',
        '```text',
        'Blocked unsafe visualization code.',
        '```'
      ].join('\n')
      : block;
  });
};

export const normalizeVisualCodeLessonPayload = (
  context: StudioGenerationContext,
  value: unknown,
  userPrompt: string,
  selectedSourceIds: string[]
): VisualCodeLesson => {
  const raw = value && typeof value === 'object' ? value as any : {};
  const contentMarkdown = stripDangerousVizCode(raw.contentMarkdown || raw.markdown || raw.content || '');
  const fallbackContent = [
    `# ${clip(userPrompt || context.template.title, 120)}`,
    '',
    '当前模型没有返回有效的可执行可视化内容。请稍后重试，或缩小主题范围后重新生成。'
  ].join('\n');
  const sourceIdSet = new Set(selectedSourceIds);
  return {
    schemaVersion: 'visual_code_lesson.v1',
    title: clip(raw.title || userPrompt || context.template.title, 160),
    summary: clip(raw.summary || '包含讲解文本和可执行前端可视化代码块的视觉化课程。', 400),
    sourceIds: Array.isArray(raw.sourceIds)
      ? raw.sourceIds.map((id: unknown) => clip(id, 120)).filter((id: string) => sourceIdSet.has(id)).slice(0, 20)
      : selectedSourceIds.slice(0, 20),
    contentMarkdown: contentMarkdown || fallbackContent
  };
};

const AVL_REACT_VISUALIZATION_CODE = String.raw`
import { useMemo, useState } from "react";

const clone = (node) => node ? {
  value: node.value,
  height: node.height,
  left: clone(node.left),
  right: clone(node.right)
} : null;

const height = (node) => node ? node.height : 0;
const update = (node) => {
  if (node) node.height = Math.max(height(node.left), height(node.right)) + 1;
  return node;
};
const balance = (node) => node ? height(node.left) - height(node.right) : 0;

const rotateRight = (y) => {
  const x = y.left;
  const t2 = x.right;
  x.right = y;
  y.left = t2;
  update(y);
  update(x);
  return x;
};

const rotateLeft = (x) => {
  const y = x.right;
  const t2 = y.left;
  y.left = x;
  x.right = t2;
  update(x);
  update(y);
  return y;
};

const snapshot = (root, message, focus = [], kind = "normal") => ({
  root: clone(root),
  message,
  focus: focus.map(String),
  kind
});

const rebalance = (node, steps, context) => {
  update(node);
  const bf = balance(node);
  steps.push(snapshot(context.root, "回溯到节点 " + node.value + "，高度=" + node.height + "，平衡因子=" + bf + "。", [node.value], Math.abs(bf) > 1 ? "warn" : "normal"));

  if (bf > 1 && balance(node.left) >= 0) {
    steps.push(snapshot(context.root, "LL 型失衡：对节点 " + node.value + " 做一次右旋。", [node.value, node.left.value], "rotate"));
    return rotateRight(node);
  }
  if (bf > 1 && balance(node.left) < 0) {
    steps.push(snapshot(context.root, "LR 型失衡：先对左孩子 " + node.left.value + " 左旋，再对节点 " + node.value + " 右旋。", [node.value, node.left.value], "rotate"));
    node.left = rotateLeft(node.left);
    return rotateRight(node);
  }
  if (bf < -1 && balance(node.right) <= 0) {
    steps.push(snapshot(context.root, "RR 型失衡：对节点 " + node.value + " 做一次左旋。", [node.value, node.right.value], "rotate"));
    return rotateLeft(node);
  }
  if (bf < -1 && balance(node.right) > 0) {
    steps.push(snapshot(context.root, "RL 型失衡：先对右孩子 " + node.right.value + " 右旋，再对节点 " + node.value + " 左旋。", [node.value, node.right.value], "rotate"));
    node.right = rotateRight(node.right);
    return rotateLeft(node);
  }
  return node;
};

const insertNode = (node, value, steps, path, context) => {
  if (!node) {
    const created = { value, height: 1, left: null, right: null };
    steps.push(snapshot(context.root || created, "插入新节点 " + value + "。", [value], "insert"));
    return created;
  }
  path.push(node.value);
  steps.push(snapshot(context.root, value + " 与 " + node.value + " 比较，" + (value < node.value ? "进入左子树。" : value > node.value ? "进入右子树。" : "已经存在，不重复插入。"), path, "search"));
  if (value < node.value) node.left = insertNode(node.left, value, steps, path.slice(), context);
  else if (value > node.value) node.right = insertNode(node.right, value, steps, path.slice(), context);
  else return node;
  return rebalance(node, steps, context);
};

const minValueNode = (node) => {
  let current = node;
  while (current.left) current = current.left;
  return current;
};

const deleteNode = (node, value, steps, path, context) => {
  if (!node) {
    steps.push(snapshot(context.root, "没有找到 " + value + "，删除结束。", path, "warn"));
    return null;
  }
  path.push(node.value);
  steps.push(snapshot(context.root, "查找待删除节点 " + value + "，当前访问 " + node.value + "。", path, "search"));

  if (value < node.value) node.left = deleteNode(node.left, value, steps, path.slice(), context);
  else if (value > node.value) node.right = deleteNode(node.right, value, steps, path.slice(), context);
  else {
    if (!node.left || !node.right) {
      steps.push(snapshot(context.root, "删除节点 " + node.value + "：它最多只有一个孩子，直接用孩子替换。", [node.value], "delete"));
      return node.left || node.right;
    }
    const successor = minValueNode(node.right);
    steps.push(snapshot(context.root, "删除节点 " + node.value + "：有两个孩子，用右子树最小值 " + successor.value + " 替换。", [node.value, successor.value], "delete"));
    node.value = successor.value;
    node.right = deleteNode(node.right, successor.value, steps, path.slice(), context);
  }

  if (!node) return null;
  return rebalance(node, steps, context);
};

const searchNode = (root, value) => {
  const steps = [];
  let node = root;
  const path = [];
  while (node) {
    path.push(node.value);
    steps.push(snapshot(root, "查询 " + value + "：访问节点 " + node.value + "。", path, "search"));
    if (value === node.value) {
      steps.push(snapshot(root, "查询成功：找到节点 " + value + "。", path, "found"));
      return steps;
    }
    node = value < node.value ? node.left : node.right;
  }
  steps.push(snapshot(root, "查询失败：路径走到空指针，没有 " + value + "。", path, "warn"));
  return steps;
};

const layoutTree = (root) => {
  const nodes = [];
  const edges = [];
  const walk = (node, depth, minX, maxX, parentKey) => {
    if (!node) return;
    const key = String(node.value);
    const x = (minX + maxX) / 2;
    const y = depth * 96 + 44;
    const label = String(node.value);
    const width = Math.max(60, label.length * 11 + 26);
    nodes.push({ key, value: node.value, label, height: node.height, bf: balance(node), x, y, width });
    if (parentKey) edges.push({ from: parentKey, to: key });
    walk(node.left, depth + 1, minX, x - 18, key);
    walk(node.right, depth + 1, x + 18, maxX, key);
  };
  walk(root, 0, 52, 908, null);
  return { nodes, edges, height: Math.max(330, (Math.max(0, ...nodes.map((n) => n.y)) + 86)), width: 960 };
};

const buildInitial = () => {
  let root = null;
  [30, 20, 40, 10, 25, 35, 50].forEach((value) => {
    const context = { root };
    root = insertNode(root, value, [], [], context);
  });
  return root;
};

const countNodes = (node) => node ? 1 + countNodes(node.left) + countNodes(node.right) : 0;
const maxAbsBalance = (node) => node ? Math.max(Math.abs(balance(node)), maxAbsBalance(node.left), maxAbsBalance(node.right)) : 0;

export default function AvlTreeLab() {
  const [root, setRoot] = useState(buildInitial());
  const [input, setInput] = useState("45");
  const [steps, setSteps] = useState([snapshot(buildInitial(), "初始 AVL 树：每个节点显示 value、height 和 BF。", [], "normal")]);
  const [index, setIndex] = useState(0);
  const current = steps[index] || steps[0];
  const drawing = useMemo(() => layoutTree(current.root), [current]);

  const parseValue = () => {
    const value = Number(input);
    if (!Number.isSafeInteger(value) || Math.abs(value) > 999999999) return null;
    return value;
  };

  const runInsert = () => {
    const value = parseValue();
    if (value === null) {
      setSteps([snapshot(root, "请输入 -999999999 到 999999999 之间的整数。", [], "warn")]);
      setIndex(0);
      return;
    }
    const nextRoot = clone(root);
    const context = { root: nextRoot };
    const nextSteps = [snapshot(nextRoot, "准备插入 " + value + "：先按二叉搜索树规则查找位置。", [], "normal")];
    const result = insertNode(nextRoot, value, nextSteps, [], context);
    nextSteps.push(snapshot(result, "插入完成：所有失衡节点已经通过旋转恢复 AVL 条件。", [value], "found"));
    setRoot(result);
    setSteps(nextSteps);
    setIndex(0);
  };

  const runDelete = () => {
    const value = parseValue();
    if (value === null) {
      setSteps([snapshot(root, "请输入 -999999999 到 999999999 之间的整数。", [], "warn")]);
      setIndex(0);
      return;
    }
    const nextRoot = clone(root);
    const context = { root: nextRoot };
    const nextSteps = [snapshot(nextRoot, "准备删除 " + value + "：先定位节点，再回溯检查平衡。", [], "normal")];
    const result = deleteNode(nextRoot, value, nextSteps, [], context);
    nextSteps.push(snapshot(result, "删除完成：沿删除路径回溯，必要时完成旋转。", [], "found"));
    setRoot(result);
    setSteps(nextSteps);
    setIndex(0);
  };

  const runSearch = () => {
    const value = parseValue();
    if (value === null) {
      setSteps([snapshot(root, "请输入 -999999999 到 999999999 之间的整数。", [], "warn")]);
      setIndex(0);
      return;
    }
    setSteps(searchNode(root, value));
    setIndex(0);
  };

  const reset = () => {
    const initial = buildInitial();
    setRoot(initial);
    setInput("45");
    setSteps([snapshot(initial, "初始 AVL 树：插入、删除、查询都会展示访问路径和旋转原因。", [], "normal")]);
    setIndex(0);
  };

  const color = current.kind === "rotate" ? "#f97316" : current.kind === "warn" ? "#dc2626" : current.kind === "found" ? "#16a34a" : current.kind === "delete" ? "#9333ea" : current.kind === "insert" ? "#2563eb" : "#334155";
  const operationLabel = current.kind === "rotate" ? "旋转修复" : current.kind === "warn" ? "需要注意" : current.kind === "found" ? "操作完成" : current.kind === "delete" ? "删除节点" : current.kind === "insert" ? "插入节点" : current.kind === "search" ? "查找路径" : "观察状态";
  const nodeCount = countNodes(root);
  const treeHeight = height(root);
  const worstBalance = maxAbsBalance(root);
  const progress = steps.length <= 1 ? 100 : Math.round((index / (steps.length - 1)) * 100);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-950 text-slate-100 shadow-sm">
      <div className="border-b border-white/10 bg-[radial-gradient(circle_at_12%_0%,rgba(59,130,246,0.28),transparent_34%),linear-gradient(135deg,#0f172a,#111827)] px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center rounded-full border border-blue-300/30 bg-blue-400/10 px-3 py-1 text-xs font-semibold text-blue-100">
              AVL Tree Visual Lab
            </div>
            <h2 className="text-2xl font-bold tracking-normal text-white">AVL 树动态实验台</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">输入整数后执行插入、删除或查询，逐步观察搜索路径、节点高度、平衡因子和旋转修复过程。</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-white/10 bg-white/10 px-4 py-3">
              <div className="text-xl font-bold text-white">{nodeCount}</div>
              <div className="text-xs text-slate-300">节点数</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/10 px-4 py-3">
              <div className="text-xl font-bold text-white">{treeHeight}</div>
              <div className="text-xs text-slate-300">树高</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/10 px-4 py-3">
              <div className={worstBalance > 1 ? "text-xl font-bold text-red-300" : "text-xl font-bold text-emerald-300"}>{worstBalance}</div>
              <div className="text-xs text-slate-300">最大 |BF|</div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 rounded-xl border border-white/10 bg-white/95 p-3 text-slate-900 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-sm font-semibold text-slate-600">操作值</span>
            <input className="h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-base font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 lg:w-44" value={input} onChange={(event) => setInput(event.target.value.replace(/(?!^-)[^0-9-]/g, "").replace(/(?!^)-/g, ""))} placeholder="整数" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button className="h-11 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700" onClick={runInsert}>插入</button>
            <button className="h-11 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700" onClick={runDelete}>删除</button>
            <button className="h-11 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700" onClick={runSearch}>查询</button>
            <button className="h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50" onClick={reset}>重置</button>
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 bg-slate-100 p-4">
          <div className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>{operationLabel}</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">步骤 {index + 1} / {steps.length}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-40" disabled={index === 0} onClick={() => setIndex(Math.max(0, index - 1))}>上一步</button>
                <button className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-40" disabled={index >= steps.length - 1} onClick={() => setIndex(Math.min(steps.length - 1, index + 1))}>下一步</button>
              </div>
            </div>
            <div className="px-4 py-3">
              <p className="text-sm leading-6 text-slate-700">{current.message}</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full transition-all duration-300" style={{ width: progress + "%", backgroundColor: color }} />
              </div>
            </div>
          </div>

          <svg viewBox={"0 0 " + drawing.width + " " + drawing.height} className="h-auto w-full rounded-xl border border-slate-200 bg-white shadow-sm">
            <defs>
              <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#e2e8f0" strokeWidth="1" opacity="0.65" />
              </pattern>
              <filter id="nodeShadow" x="-25%" y="-25%" width="150%" height="150%">
                <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#0f172a" floodOpacity="0.16" />
              </filter>
            </defs>
            <rect x="0" y="0" width={drawing.width} height={drawing.height} fill="url(#grid)" />
        {drawing.edges.map((edge) => {
          const from = drawing.nodes.find((node) => node.key === edge.from);
          const to = drawing.nodes.find((node) => node.key === edge.to);
          if (!from || !to) return null;
          const active = current.focus.includes(from.key) && current.focus.includes(to.key);
          return <line key={edge.from + "-" + edge.to} x1={from.x} y1={from.y + 28} x2={to.x} y2={to.y - 28} stroke={active ? color : "#94a3b8"} strokeWidth={active ? "4" : "3"} strokeLinecap="round" />;
        })}
        {drawing.nodes.map((node) => {
          const active = current.focus.includes(node.key);
          const bad = Math.abs(node.bf) > 1;
          return (
            <g key={node.key}>
              <rect filter="url(#nodeShadow)" x={node.x - node.width / 2} y={node.y - 30} width={node.width} height="60" rx="20" fill={active ? color : bad ? "#fee2e2" : "#ffffff"} stroke={active ? color : bad ? "#ef4444" : "#64748b"} strokeWidth="3" />
              <text x={node.x} y={node.y - 2} textAnchor="middle" className="select-none text-sm font-bold" fill={active ? "#fff" : "#0f172a"}>{node.label}</text>
              <text x={node.x} y={node.y + 14} textAnchor="middle" className="select-none text-[10px]" fill={active ? "#fff" : "#475569"}>h{node.height} BF{node.bf}</text>
            </g>
          );
        })}
          </svg>
        </div>

        <aside className="border-t border-white/10 bg-slate-900 p-4 lg:border-l lg:border-t-0">
          <div className="mb-4 text-sm font-bold text-white">步骤时间线</div>
          <div className="max-h-[520px] space-y-2 overflow-auto pr-1">
            {steps.map((step, stepIndex) => (
              <button key={stepIndex} type="button" onClick={() => setIndex(stepIndex)} className={(stepIndex === index ? "border-blue-400 bg-blue-500/15 text-white" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10") + " w-full rounded-lg border px-3 py-2 text-left transition"}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold">#{stepIndex + 1}</span>
                  <span className="text-[11px] uppercase tracking-wide">{step.kind}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-xs leading-5">{step.message}</div>
              </button>
            ))}
          </div>
          <div className="mt-5 grid gap-2 text-xs text-slate-300">
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="font-bold text-white">插入</div>
              <p className="mt-1 leading-5">先按 BST 规则插入叶子，再回溯更新高度。</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="font-bold text-white">删除</div>
              <p className="mt-1 leading-5">按孩子数量替换节点，再沿路径检查平衡。</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="font-bold text-white">旋转</div>
              <p className="mt-1 leading-5">当 |BF| &gt; 1 时，通过单旋或双旋恢复平衡。</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
`;

export const isAvlVisualExplainerRequest = (
  userPrompt: string,
  sources: Array<{ name?: string; content?: string }> = []
) => {
  const text = [
    userPrompt,
    ...sources.map((source) => `${source.name || ''} ${clip(source.content || '', 800)}`)
  ].join('\n').toLowerCase();
  return /\bavl\b|平衡二叉树|自平衡|二叉搜索树|balanced binary search tree/.test(text);
};

export const buildAvlVisualCodeLesson = (
  context: StudioGenerationContext,
  userPrompt: string,
  selectedSourceIds: string[]
): VisualCodeLesson => ({
  schemaVersion: 'visual_code_lesson.v1',
  title: 'AVL 树插入、删除、查询交互动画',
  summary: '这是一个确定性 AVL 树专项演示：用户可以输入整数并执行插入、删除、查询，逐步观察访问路径、平衡因子和 LL/LR/RR/RL 旋转。',
  sourceIds: selectedSourceIds.slice(0, 20),
  contentMarkdown: [
    '# AVL 树交互动画',
    '',
    userPrompt
      ? `本演示按你的任务「${clip(userPrompt, 120)}」生成。`
      : '本演示用于讲解 AVL 树如何在插入、删除、查询时保持高度平衡。',
    '',
    '你可以输入一个整数，然后点击 **插入**、**删除** 或 **查询**。动画会把操作拆成步骤，展示搜索路径、节点高度、平衡因子以及触发旋转的原因。',
    '',
    '~~~REACT_VIZ',
    AVL_REACT_VISUALIZATION_CODE.trim(),
    '~~~',
    '',
    '## 观察问题',
    '',
    '1. 为什么 AVL 树在普通 BST 插入之后还要沿路径回溯更新高度？',
    '2. LL、LR、RR、RL 四种失衡分别对应什么旋转？',
    '3. 删除节点后，为什么也可能触发旋转？'
  ].join('\n')
});

export const VISUAL_EXPLAINER_SLIDE_TEXT_SCHEMA_HINT = {
  schemaVersion: 'visual_explainer.slide_text.v1',
  sections: [{
    id: '必须来自 section plan',
    title: '短标题',
    focus: '一句聚焦说明，不复制 title',
    screenText: ['2-4 条屏幕短文案，每条不超过 28 个中文字符，彼此不重复'],
    narration: '面向用户的自然口播解释',
    checkQuestion: '可选自检问题'
  }]
};

export const VISUAL_EXPLAINER_VISUAL_INTENT_SCHEMA_HINT = {
  schemaVersion: 'visual_explainer.visual_intent.v1',
  sections: [{
    id: '必须来自 section plan',
    visualMode: 'slide | process | diagram | comparison | whiteboard | chart | summary',
    preferredRenderer: 'reveal | mermaid | x6 | vega_lite | tldraw | motion_canvas | jsav',
    blockKinds: ['markdown | mermaid | x6 | vega_lite | tldraw | motion_canvas | jsav'],
    reason: '为什么这个 section 适合这种视觉表达'
  }]
};

export const VISUAL_EXPLAINER_RENDERER_BLOCK_SCHEMA_HINT = {
  schemaVersion: 'visual_explainer.renderer_blocks.v1',
  sections: [{
    id: '必须来自 section plan',
    objects: VISUAL_EXPLAINER_SCHEMA_HINT.sections[0].objects,
    timeline: VISUAL_EXPLAINER_SCHEMA_HINT.sections[0].timeline,
    visualBlocks: VISUAL_EXPLAINER_SCHEMA_HINT.sections[0].visualBlocks
  }]
};

export const visualExplainerInstruction = [
  '必须输出 JSON，不要 Markdown 包裹。',
  '采用 Markdown-first：markdownDraft 必须是一份完整、自然、可单独阅读的回答。',
  '然后做二次创作：把 markdownDraft 按语义和讲解节奏拆成 4-7 个 sections，不要机械按标题切分。',
  '每个 section 是一个分镜，只聚焦一个问题、步骤、对比或例子。',
  '不要把只有大标题、目录标题或过渡标题的段落单独做成 section；这类标题必须合并到后面真正有信息量的 section。',
  '禁止在同一个 section 里让 title、focus、screenText、objects.label、timeline.screenText 反复重复同一句话。title 只写短标题，focus 写一句解释，screenText 写 2-4 个不同短要点，timeline 写动作推进。',
  '如果 Markdown 某段只有一句话，就不要强行复制成多个 objects 或 timeline steps；可以只保留一个主对象，或与相邻段合并。',
  '切分优先级：概念定义、例子、步骤变化、类型对比、公式/SQL、总结自检。不要按每个 Markdown 标题一刀切。',
  '为每个 section 选择 visualMode：普通讲解用 slide/summary，对比用 comparison，流程/算法/系统机制用 process，结构关系/组件连接用 diagram，推导草稿用 whiteboard，数据趋势用 chart。',
  '每个 section 内部用 objects + timeline 表达动画，不要只写 fade in；要说明哪些对象出现、被高亮、连接、移动、变换或对比。',
  '当 visualMode 是 process 或 diagram 时，objects 里要尽量包含 node/card/formula/table 等对象；如果对象之间有方向关系，额外生成 kind=edge 的对象，并填写 fromId/toId。',
  '同时为每个 section 生成 1-2 个 visualBlocks。visualBlocks 是给开源渲染器的原生输入，不是新的自定义绘图语言。',
  'Mermaid block 使用 Mermaid DSL；X6 block 使用 Graph.fromJSON({ nodes, edges }) 兼容对象；Vega-Lite block 使用完整 Vega-Lite spec；tldraw block 只使用 snapshot/records；Motion Canvas block 只在能写有效 makeScene2D 风格 scene 时给 source；JSAV block 可给 JSAV script 或保守的 dataStructure/steps trace。',
  '如果不确定某个开源项目的原生格式，不要伪造复杂 snapshot/source/spec，改用 markdown、mermaid 或 x6 的简单可靠 block。',
  'preferredRenderer 必须与本 section 的 visualBlocks 可用类型一致；普通讲解优先 reveal，流程优先 mermaid，复杂节点连线优先 x6，真实数据图表优先 vega_lite，推导草稿才考虑 tldraw，算法数据结构动画才考虑 jsav。',
  'screenText 要短，narration 可以承载完整解释。',
  '对象 id 必须稳定，timeline.targetIds 必须引用 objects 中存在的 id。',
  '如果主题不适合复杂动画，也要用 slide/process/diagram 的轻量动画表达重点。',
  '不要输出 HTML、CSS、视频源码或 renderer 代码。'
].join('\n');

export const visualLessonPrompt = (
  userPrompt: string,
  sources: Array<{ id: string; name: string; path?: string; content: string }>
) => [
  '你是 AI Studio 的教学可视化课件规划器。',
  '你的任务是把用户要求和勾选资料转换成可播放的结构化课件 JSON。',
  '',
  '输出硬性要求：',
  '- 只输出一个合法 JSON 对象，不要 Markdown 代码围栏，不要额外解释。',
  '- JSON 顶层 schemaVersion 必须是 "visual_lesson.v1"。',
  '- 不要输出 HTML、CSS、React、Canvas、视频源码或任意应用代码。',
  '- 不要输出普通长文；正文必须放在 slides[].bodyMarkdown，逐步讲解必须放在 slides[].timeline。',
  '- 所有 timeline[].targetIds 必须引用同页 visualModel.objects[].id；没有合适对象时使用空数组。',
  '- 每页 timeline 至少 2 步；涉及算法、SQL、代码或数据通路时至少 3 步。',
  '- statePatch 必须表达这一帧的视觉状态变化，不能总是空对象。',
  '',
  '上下文边界：',
  '- 你只能使用「用户要求」和「用户勾选资料全文」。',
  '- 严禁使用、推断或提及 Context Capsule、Workbench 全量资源、当前文件、学习者画像、历史记忆、推荐系统、未勾选资源或 AI Studio 内部工作流。',
  '- 如果勾选资料存在，必须以资料内容为准；资料没有的信息只能做保守通用解释，不要编造细节。',
  '',
  'visualModel.type 选择规则：',
  '- SQL JOIN、关系表、表格推导：table。',
  '- Dijkstra、BFS、DFS、图遍历、最短路：graph。',
  '- 栈、队列、堆、链表、排序、数组状态变化：sequence。',
  '- 程序逐行执行、变量变化、递归/循环 trace：code_trace。',
  '- CPU lw/sw、控制信号、寄存器堆、ALU、存储器、数据通路：datapath。',
  '- 普通过程、流程、系统机制：flowchart。',
  '- 只适合文字+简单图：markdown_mermaid。',
  '',
  '教学质量要求：',
  '- slides 数量通常 3-6 页；每页只讲一个概念、步骤、对比或例子。',
  '- bodyMarkdown 面向学生阅读，短段落、列表、表格、代码块都可以，但不要暴露 JSON 字段说明。',
  '- narration 用老师口吻解释当前页为什么重要。',
  '- timeline.screenText 要短，timeline.narration 解释该步发生了什么、为什么发生、当前结果是什么。',
  '- 对 SQL/table：visualModel.data 应尽量包含 leftTable、rightTable、joinCondition、resultTable；statePatch 可包含 highlightRows、connections、outputRows。',
  '- 对 graph：visualModel.data 应尽量包含 nodes、edges、start、target；statePatch 可包含 activeNodes、visitedNodes、activeEdges、distances、queue 或 priorityQueue。',
  '- 对 sequence：visualModel.data 应尽量包含 initialItems 和 operations；statePatch 可包含 items、activeIndices、swaps、push、pop、enqueue、dequeue。',
  '- 对 code_trace：visualModel.data 应尽量包含 code、language、variables；statePatch 可包含 currentLine、variables、callStack、output。',
  '- 对 datapath：visualModel.data 应尽量包含 components、signals、instruction、path；statePatch 可包含 activeComponents、activeSignals、dataValues。',
  '- 每份课件最后至少有 1 个 checkQuestion。',
  '',
  'Schema 参考：',
  JSON.stringify(VISUAL_LESSON_SCHEMA_HINT, null, 2),
  '',
  `用户要求：${userPrompt || '把勾选资料转换成视觉化课件讲解。'}`,
  '',
  '# 用户勾选资料全文',
  sources.length
    ? sources.map((source, index) => [
      `## Source ${index + 1}: ${source.name}`,
      `SourceId: ${source.id}`,
      source.path ? `Path: ${source.path}` : '',
      '',
      source.content || '(empty source text)'
    ].filter(Boolean).join('\n')).join('\n\n---\n\n')
    : '(no selected source text)'
].join('\n');

export const visualExplainerMarkdownPrompt = (userPrompt: string) => [
  '你只负责 Visual Explainer 的第一阶段：生成内容底稿。',
  '只根据用户要求回答，不要使用、提及或等待任何外部 sources、Context Capsule、AI Studio 模板、内部配置或系统工作流。',
  '输出必须是纯 Markdown 正文，不要输出 JSON，不要输出 YAML，不要输出 schemaVersion、markdownDraft、sections、objects、timeline、rendererPlan 等内部字段。',
  '允许使用 Markdown 表格、任务列表、引用、公式、普通代码块、伪代码代码块，以及 ```mermaid 图代码块；不要输出 HTML、CSS、视频源码或应用内部资源协议。',
  '不要包含 schemaVersion、markdownDraft、sections、objects、timeline、rendererPlan 这些内部字段。',
  '底稿不是普通长文，而是“可被拆成 PPT/动画分镜的视觉讲解 Markdown”：每个一级/二级小节都要短而聚焦，保留完整解释，但避免把多个主题挤成一大段。',
  '参考 Reveal.js Markdown slide 的写法组织内容：用清晰标题、短段落、列表、必要的分隔线或小节边界，让后续可以自然切成 4-8 个讲解页。',
  '参考 Mermaid 的文本图思想：只在适合时给出 1-2 个 ```mermaid 代码块，图必须声明 diagram type，例如 flowchart、sequenceDiagram、stateDiagram、erDiagram、mindmap 或 timeline；图中节点和边要对应正文概念，不要为了有图而画空泛图。',
  '参考 Vega-Lite 的数据驱动思想：如果问题包含数据、趋势、对比、计量、指标或实验结果，必须提供一个小型 Markdown 数据表，列名清晰，能映射到 data / mark / encoding。',
  '参考 JSAV/算法可视化的素材形态：如果问题包含算法、数据结构、程序执行、系统机制、推导或状态机，必须给出可追踪的状态序列；状态序列要包含 step、操作、关键变量、当前状态、变化原因。',
  '如果题目适合代码或伪代码，必须给出一个简洁、正确、可讲解的代码块或伪代码块，并解释变量含义；如果不适合代码，不要硬塞代码。',
  '计算机课程内容要特别具体：算法要有输入样例和逐步 trace；数据库要有表/字段/连接条件/中间结果；操作系统要有地址、页号、偏移、页表/TLB 状态；组成原理要有部件、控制信号、数据通路和时序；网络要有端点、报文、状态和时序。',
  '日常问题也要视觉化友好：给出结构化步骤、对比表、决策树、例子、类比和检查问题；不要只写散文式建议。',
  '每个涉及过程的小节都要包含“发生了什么 -> 为什么 -> 当前状态/结果 -> 下一步”的信息，方便后续生成 timeline。',
  '每个涉及结构的小节都要明确实体、关系、方向、层级或包含关系，方便后续生成 diagram。',
  '每个涉及例子的小节都要给出完整 worked example：初始条件、每一步变化、最终结果、容易误解的点。',
  '最后给出 2-4 个自检问题或观察点，帮助用户确认是否理解关键变化。',
  '不要在开头写“当然可以”“以下是”等寒暄，不要在结尾询问是否需要更多内容；直接给出高质量 Markdown 底稿。',
  '',
  `用户要求：${userPrompt}`
].join('\n');

export const visualExplainerSelectedSourcesMarkdownPrompt = (
  userPrompt: string,
  sources: Array<{ id: string; name: string; path?: string; content: string }>
) => [
  '你只负责 Visual Explainer 的第一阶段：生成内容底稿。',
  '你只能使用下面的「用户要求」和「用户勾选资料全文」。',
  '严禁使用、推断或提及 Context Capsule、Workbench 全量资源、当前文件、学习者画像、历史记忆、推荐系统、未勾选资源或 AI Studio 内部工作流。',
  '如果勾选资料为空，可以只根据用户要求生成通用教学底稿；如果勾选资料存在，必须以资料内容为准，不要引入资料外的细节。',
  '输出必须是纯 Markdown 正文，不要输出 JSON，不要输出 YAML，不要输出 schemaVersion、markdownDraft、sections、objects、timeline、rendererPlan 等内部字段。',
  '底稿目标是“可被拆成 PPT/动画分镜的计算机课程讲解 Markdown”，不是普通摘要。',
  '每个一级/二级小节都要短而聚焦，保留完整解释、例子、状态变化、关键条件和易错点。',
  '允许使用 Markdown 表格、公式、代码块、伪代码代码块，以及 ```mermaid 图代码块；不要输出 HTML、CSS、视频源码或应用内部资源协议。',
  '计算机课程内容要特别具体：数据库要有表/字段/连接条件/中间结果；算法和数据结构要有输入样例、状态序列和关键变量；组成原理要有部件、控制信号、数据通路和时序。',
  '每个涉及过程的小节都要包含“发生了什么 -> 为什么 -> 当前状态/结果 -> 下一步”的信息，方便后续生成 timeline。',
  '每个涉及结构的小节都要明确实体、关系、方向、层级或包含关系，方便后续生成 diagram。',
  '最后给出 2-4 个自检问题或观察点。',
  '不要在开头写寒暄，不要在结尾询问是否需要更多内容；直接给出 Markdown 底稿。',
  '',
  `用户要求：${userPrompt || '把勾选资料转换成视觉化课件讲解。'}`,
  '',
  '# 用户勾选资料全文',
  sources.length
    ? sources.map((source, index) => [
      `## Source ${index + 1}: ${source.name}`,
      `SourceId: ${source.id}`,
      source.path ? `Path: ${source.path}` : '',
      '',
      source.content || '(empty source text)'
    ].filter(Boolean).join('\n')).join('\n\n---\n\n')
    : '(no selected source text)'
].join('\n');

export const visualExplainerStoryboardPrompt = [
  '你只负责 Visual Explainer 的第二阶段：把已有 Markdown 底稿改编成视觉讲解分镜。',
  '只使用输入里的 userPrompt 和 markdownDraft，不要使用、提及或等待任何外部 sources、Context Capsule、AI Studio 模板、内部配置或系统工作流。',
  visualExplainerInstruction
].join('\n');

export const visualExplainerContentMapPrompt = [
  '你只负责 Visual Explainer 的第二阶段：从 raw Markdown 中提取内容地图。',
  '只使用输入里的 userPrompt 和 markdownDraft，不要使用、提及或等待 sources、Context Capsule、模板或内部工作流。',
  '必须输出 JSON，不要 Markdown 包裹。',
  '这一阶段只做语义提取：概念、步骤、关系、例子。不要切分 slide，不要写 renderer，不要写动画。',
  'concepts 写核心实体/概念；steps 写真实过程、推导、算法或建议步骤；relationships 写有方向的因果/顺序/对比/包含关系；examples 写用于讲解的例子。',
  '不要把标题机械复制成概念；每个字段都要承载不同信息。'
].join('\n');

export const visualExplainerSectionPlanPrompt = [
  '你只负责 Visual Explainer 的第三阶段：基于 markdownBlocks 和 contentMap 做分镜切分。',
  '只使用输入里的 userPrompt、markdownBlocks、contentMap。',
  '必须输出 JSON，不要 Markdown 包裹。',
  '目标是得到 4-7 个讲解 sections；不要机械按 Markdown 标题切分，要按用户理解节奏切分。',
  '最重要：这一阶段只做分镜规划和 source block 引用，不要复制、改写或输出 Markdown 原文。',
  '每个 section 必须填写 sourceBlockIds，且只能使用输入 markdownBlocks 中存在的 id；后端会根据这些 id 本地拼回完整 sourceMarkdown。',
  '所有有信息量的 markdownBlocks 都必须被某个 section.sourceBlockIds 覆盖；可以把相邻 blocks 合并到同一个 section，但不能遗漏包含代码、表格、公式、例子、状态序列或关键解释的 block。',
  '每个 section 只聚焦一个概念、步骤、例子、对比、推导或总结。',
  '不要生成 title-only section；过渡标题必须合并到后面真正有信息量的 section。',
  'title/goal/keyPoints 只是导航和展示入口，不能替代 sourceBlockIds 指向的原文。',
  '这一阶段不要写 sourceMarkdown、screenText、narration、objects、timeline、renderer 或 visualBlocks。'
].join('\n');

export const visualExplainerSlideTextPrompt = [
  '你只负责 Visual Explainer 的第四阶段：给每个 section 补充展示层文案。',
  '只使用输入里的 userPrompt、markdownDraft、contentMap、sectionPlan。',
  '必须输出 JSON，不要 Markdown 包裹。',
  '为每个 section 生成 title、focus、screenText、narration、checkQuestion。',
  '不要重写、裁剪或替代 sectionPlan.sections[].sourceMarkdown；完整内容已经在 sourceMarkdown 中。',
  'title 是短标题；focus 是这一页的一句简介；screenText 是右侧动画提示；narration 是开场口播或过渡，不承载全部内容。',
  'screenText 每条不超过 28 个中文字符；不要把同一句话同时放进 title/focus/screenText。'
].join('\n');

export const visualExplainerVisualIntentPrompt = [
  '你只负责 Visual Explainer 的第五阶段：判断每个 section 适合怎样视觉化。',
  '只使用输入里的 userPrompt、sectionPlan、slideText。',
  '必须输出 JSON，不要 Markdown 包裹。',
  '这一阶段只做视觉意图分类和 renderer 候选，不生成 objects/timeline/visualBlocks。',
  '判断时必须以 sectionPlan.sections[].sourceMarkdown 的完整内容为依据，不要只看短 screenText。',
  '普通解释用 reveal；步骤/机制/算法流程用 mermaid；复杂节点连线/系统组件/数据库关系用 x6；真实数据趋势用 vega_lite；推导草稿用 tldraw；算法数据结构 trace 可考虑 jsav。',
  '如果不确定复杂 renderer，选择 reveal/mermaid/x6 的可靠组合。'
].join('\n');

export const visualExplainerRendererBlocksPrompt = [
  '你只负责 Visual Explainer 的第六阶段：为每个 section 生成对象、动画 timeline 和开源 renderer 原生 block。',
  '只使用输入里的 userPrompt、markdownDraft、contentMap、sectionPlan、slideText、visualIntent。',
  '必须输出 JSON，不要 Markdown 包裹。',
  '生成 objects/timeline/visualBlocks 时必须从 sectionPlan.sections[].sourceMarkdown 读取完整内容；slideText 只是展示提示，不能作为唯一依据。',
  'objects/timeline 要表达一个 section 内部的讲解动画：出现、聚焦、连接、移动、变换、对比或注释。',
  '如果 sourceMarkdown 包含算法步骤、状态变化、公式、表格或示例，timeline 必须覆盖这些关键变化，不能只给一个 appear/focus。',
  'visualBlocks 是给开源渲染器的原生输入，不是新的自定义绘图语言。',
  'Mermaid block 使用 Mermaid DSL；X6 block 使用 Graph.fromJSON({ nodes, edges }) 兼容对象；Vega-Lite block 使用完整 Vega-Lite spec；tldraw block 只使用 snapshot/records；JSAV block 可给 dataStructure/initialState/steps。',
  '如果不确定某个开源项目的原生格式，不要伪造复杂 snapshot/source/spec，改用 markdown、mermaid 或 x6 的简单可靠 block。',
  'timeline.targetIds 必须引用 objects 中存在的 id。'
].join('\n');

export const isVisualExplainerPayload = (value: unknown): value is VisualExplainerPayload =>
  Boolean(value && typeof value === 'object' && (value as any).schemaVersion === 'visual_explainer.v1');

const stripJsonFence = (value: string) => {
  const text = value.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || text;
};

const normalizeMarkdownStructure = (value: string) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const fencedBlocks: string[] = [];
  const masked = text.replace(/```[\s\S]*?```/g, (block) => {
    const token = `__VISUAL_EXPLAINER_CODE_BLOCK_${fencedBlocks.length}__`;
    fencedBlocks.push(block);
    return token;
  });
  const withBreaks = masked
    .replace(/[ \t]+(#{1,4})[ \t]+(?=\S)/g, '\n\n$1 ')
    .replace(/[ \t]+(-|\*|\d+[.、])[ \t]+(?=\S)/g, '\n$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return withBreaks.replace(/__VISUAL_EXPLAINER_CODE_BLOCK_(\d+)__/g, (_, index) => fencedBlocks[Number(index)] || '');
};

const stripMarkdownMarkersForCompare = (value: unknown) =>
  String(value || '')
    .replace(/^[#>\s-]+/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const isMarkdownDivider = (value: string) => /^-{3,}$/.test(value.trim());

const numberedSectionTitle = (value: string) =>
  value.trim().match(/^(?:\d+[.、]\s+|[一二三四五六七八九十]+[、.]\s*)(.+)$/)?.[1]?.trim() || '';

const bodyMarkdownForSlide = (sourceMarkdown: unknown, title: unknown) => {
  const titleKey = stripMarkdownMarkersForCompare(title);
  const lines = normalizeMarkdownStructure(String(sourceMarkdown || ''))
    .split('\n');
  const kept: string[] = [];
  let droppedFirstMatchingHeading = false;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      if (kept.length && kept[kept.length - 1] !== '') kept.push('');
      return;
    }
    if (isMarkdownDivider(trimmed)) return;
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      const headingLevel = trimmed.match(/^#{1,3}/)?.[0] || '##';
      const headingText = numberedSectionTitle(headingMatch[1]) || headingMatch[1];
      const headingKey = stripMarkdownMarkersForCompare(headingText);
      if (!droppedFirstMatchingHeading && titleKey && headingKey === titleKey) {
        droppedFirstMatchingHeading = true;
        return;
      }
      if (/视觉讲解底稿|visual explainer|讲解底稿/i.test(headingText) && kept.length === 0) return;
      kept.push(`${headingLevel} ${headingText}`);
      return;
    }
    if (/^#{1,6}$/.test(trimmed)) return;
    const numberedTitle = numberedSectionTitle(trimmed);
    if (numberedTitle) {
      const numberedKey = stripMarkdownMarkersForCompare(numberedTitle);
      if (!droppedFirstMatchingHeading && titleKey && numberedKey === titleKey) {
        droppedFirstMatchingHeading = true;
        return;
      }
      kept.push(`### ${numberedTitle}`);
      return;
    }
    kept.push(line);
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const displayFocus = (value: unknown, fallback: unknown, title: unknown) => {
  const raw = clip(value || fallback || '', 220);
  const cleaned = raw
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\|/g, ' ')
    .replace(/---+/g, ' ')
    .replace(/^#+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const titleKey = stripMarkdownMarkersForCompare(title);
  const firstSentence = cleaned.split(/[。！？.!?]\s*/g).map((item) => item.trim()).find(Boolean) || cleaned;
  if (!firstSentence || stripMarkdownMarkersForCompare(firstSentence) === titleKey) return '';
  return clip(firstSentence, 110);
};

const parseMaybeJson = (value: string) => {
  const text = stripJsonFence(value);
  if (!text.startsWith('{')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const parseVisualExplainerJsonString = (value: string) => {
  const parsed = parseMaybeJson(value);
  return isVisualExplainerPayload(parsed) ? parsed : null;
};

const extractJsonStringField = (value: string, fieldName: string) => {
  const text = stripJsonFence(value);
  const fieldIndex = text.indexOf(`"${fieldName}"`);
  if (fieldIndex < 0) return '';
  const colonIndex = text.indexOf(':', fieldIndex);
  if (colonIndex < 0) return '';
  let quoteIndex = colonIndex + 1;
  while (quoteIndex < text.length && /\s/.test(text[quoteIndex])) quoteIndex += 1;
  if (text[quoteIndex] !== '"') return '';

  let raw = '"';
  let escaped = false;
  for (let index = quoteIndex + 1; index < text.length; index += 1) {
    const char = text[index];
    raw += char;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      try {
        return JSON.parse(raw);
      } catch {
        return '';
      }
    }
  }
  return '';
};

export const extractVisualExplainerMarkdownDraft = (value: string) => {
  const parsed = parseMaybeJson(value);
  if (parsed && typeof (parsed as any).markdownDraft === 'string') {
    return normalizeMarkdownStructure((parsed as any).markdownDraft);
  }
  const extracted = extractJsonStringField(value, 'markdownDraft');
  return normalizeMarkdownStructure(extracted || value);
};

export const extractVisualExplainerPayloadFromText = (value: string) => {
  const parsed = parseVisualExplainerJsonString(value);
  return parsed?.sections?.length ? parsed : null;
};

const markdownSections = (markdown: string) => {
  const stripMarkdownInline = (value: string, maxLength = 180) =>
    clip(
      value
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/^[-*]\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim(),
      maxLength
    );
  const splitInlineHeadingBody = (heading: string) => {
    const candidates = [
      /\s+(?=\*\*)/,
      /\s+(?=```)/,
      /\s+(?=表连接是|想象|通过|只返回|返回|与左连接|如果|当|比如|可以|我们|这一步|核心|总结|工作原理|示例|执行步骤|状态变化)/
    ];
    const indexes = candidates
      .map((pattern) => heading.search(pattern))
      .filter((index) => index > 4);
    const splitAt = indexes.length ? Math.min(...indexes) : -1;
    if (splitAt > 0 && splitAt <= 50) {
      return {
        title: heading.slice(0, splitAt).trim(),
        bodyPrefix: heading.slice(splitAt).trim()
      };
    }
    return { title: heading.trim(), bodyPrefix: '' };
  };
  const normalizedMarkdown = normalizeMarkdownStructure(markdown);
  const parts = normalizedMarkdown
    .split(/\n(?=#{1,3}\s+)/g)
    .map((part) => part.trim())
    .filter(Boolean);
  const normalized = parts.length ? parts : [normalizedMarkdown];
  const parsed = normalized.map((part, index) => {
    const heading = part.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() || '';
    const splitHeading = heading ? splitInlineHeadingBody(heading) : null;
    const title = splitHeading?.title || (index === 0 ? '核心问题' : `部分 ${index + 1}`);
    const body = [splitHeading?.bodyPrefix, part.replace(/^#{1,3}\s+.+$/m, '').trim()].filter(Boolean).join('\n\n');
    const bullets = body
      .split('\n')
      .map((line) => line.match(/^\s*(?:[-*]|\d+[.、])\s+(.+)$/)?.[1]?.trim())
      .filter((item): item is string => Boolean(item))
      .map((item) => stripMarkdownInline(item, 90))
      .filter((item) => item && item !== stripMarkdownInline(title, 90))
      .slice(0, 4);
    const paragraphs = body
      .split(/\n{2,}/g)
      .map((item) => stripMarkdownInline(item, 220))
      .filter((item) => item && item !== stripMarkdownInline(title, 220));
    return {
      title: stripMarkdownInline(title, 80),
      body: clip(paragraphs.join('\n\n') || stripMarkdownInline(body || part, 600), 900),
      sourceMarkdown: clipMarkdown(part, 6000),
      bullets,
      isTitleOnly: !paragraphs.length && !bullets.length
    };
  });
  const merged: Array<{ title: string; body: string; sourceMarkdown: string; bullets: string[] }> = [];
  parsed.forEach((section) => {
    if (section.isTitleOnly && parsed.length > 1) return;
    merged.push({
      title: section.title,
      body: section.body,
      sourceMarkdown: section.sourceMarkdown,
      bullets: section.bullets
    });
  });
  const source = merged.length ? merged : parsed;
  if (source.length <= 6) return source;
  const buckets: Array<{ title: string; body: string; sourceMarkdown: string; bullets: string[] }> = [];
  source.forEach((section, index) => {
    const bucketIndex = Math.min(5, Math.floor(index * 6 / source.length));
    const bucket = buckets[bucketIndex];
    if (!bucket) {
      buckets[bucketIndex] = {
        title: section.title,
        body: section.body,
        sourceMarkdown: section.sourceMarkdown,
        bullets: section.bullets
      };
      return;
    }
    bucket.body = clip([bucket.body, section.body].filter(Boolean).join('\n\n'), 1200);
    bucket.sourceMarkdown = [bucket.sourceMarkdown, section.sourceMarkdown].filter(Boolean).join('\n\n');
    bucket.bullets = uniqueTexts([...bucket.bullets, ...section.bullets], 4, 90);
  });
  return buckets.filter(Boolean);
};

export const buildVisualExplainerMarkdownSourceBlocks = (markdownDraft: string): VisualExplainerMarkdownSourceBlock[] =>
  markdownSections(markdownDraft)
    .filter((section) => bodyMarkdownForSlide(section.sourceMarkdown, section.title) || section.bullets.length)
    .map((section, index) => ({
      id: `block-${index + 1}-${slug(section.title, 'part')}`,
      title: section.title,
      sourcePreview: clip(bodyMarkdownForSlide(section.sourceMarkdown, section.title) || section.sourceMarkdown || section.body || section.title, 900),
      keyPoints: uniqueTexts(section.bullets.length ? section.bullets : section.body.split(/[。！？\n]/g), 4, 90),
      sourceMarkdown: section.sourceMarkdown
    }));

const mermaidSafeId = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, '_') || 'node';

const mermaidFromSectionParts = (sectionId: string, title: string, bullets: string[]) => {
  const points = (bullets.length ? bullets : [title]).slice(0, 7);
  return [
    'flowchart TD',
    ...points.flatMap((point, index) => [
      `  ${mermaidSafeId(`${sectionId}_n${index + 1}`)}["${clip(point, 64).replace(/["|{}[\]]/g, '')}"]`,
      index > 0 ? `  ${mermaidSafeId(`${sectionId}_n${index}`)} --> ${mermaidSafeId(`${sectionId}_n${index + 1}`)}` : ''
    ]).filter(Boolean)
  ].join('\n');
};

const x6GraphFromObjects = (objects: VisualExplainerObject[]) => {
  const nodes = objects
    .filter((object) => object.kind !== 'edge')
    .slice(0, 12)
    .map((object) => ({
      id: object.id,
      shape: 'rect',
      label: object.label,
      width: 180,
      height: 64,
      attrs: {
        body: { rx: 8, ry: 8 },
        label: { text: object.label }
      },
      data: {
        kind: object.kind,
        role: object.role,
        detail: object.detail
      }
    }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const explicitEdges = objects
    .filter((object) => object.kind === 'edge' && object.fromId && object.toId && nodeIds.has(object.fromId) && nodeIds.has(object.toId))
    .slice(0, 18)
    .map((object) => ({
      id: object.id,
      source: object.fromId as string,
      target: object.toId as string,
      label: object.label,
      attrs: {
        line: {
          targetMarker: { name: 'classic' }
        }
      },
      data: { detail: object.detail }
    }));
  const edges = explicitEdges.length
    ? explicitEdges
    : nodes.slice(1).map((node, index) => ({
        id: `edge-${index + 1}`,
        source: nodes[index].id,
        target: node.id,
        label: ''
      }));
  return { nodes, edges };
};

const fallbackBlocksForSection = (
  sectionId: string,
  title: string,
  body: string,
  bullets: string[],
  visualMode: VisualExplainerSection['visualMode'],
  objects: VisualExplainerObject[],
  timeline: VisualExplainerTimelineStep[]
): VisualExplainerBlock[] => {
  const blocks: VisualExplainerBlock[] = [
    {
      id: `${sectionId}-markdown`,
      kind: 'markdown',
      markdown: [title ? `## ${title}` : '', body].filter(Boolean).join('\n\n')
    }
  ];
  if (visualMode === 'process' || visualMode === 'diagram') {
    blocks.push({
      id: `${sectionId}-mermaid`,
      kind: 'mermaid',
      diagramType: 'flowchart',
      code: mermaidFromSectionParts(sectionId, title, bullets.length ? bullets : timeline.map((step) => step.screenText || step.narration))
    });
    blocks.push({
      id: `${sectionId}-x6`,
      kind: 'x6',
      graph: x6GraphFromObjects(objects)
    });
  }
  if (visualMode === 'chart') {
    blocks.push({
      id: `${sectionId}-vega-lite`,
      kind: 'vega_lite',
      spec: {
        $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
        description: title,
        data: { values: [] },
        mark: 'bar',
        encoding: {}
      }
    });
  }
  if (visualMode === 'whiteboard') {
    blocks.push({
      id: `${sectionId}-tldraw`,
      kind: 'tldraw',
      records: []
    });
  }
  return blocks;
};

const normalizeVisualBlocks = (
  rawBlocks: unknown,
  fallbackBlocks: VisualExplainerBlock[]
): VisualExplainerBlock[] => {
  if (!Array.isArray(rawBlocks)) return fallbackBlocks;
  const blocks = rawBlocks
    .slice(0, 6)
    .map((block: any, index): VisualExplainerBlock | null => {
      const id = clip(block?.id || `block-${index + 1}`, 80);
      const kind = String(block?.kind || '').trim();
      if (kind === 'markdown') {
        const markdown = clip(block.markdown || block.content || '', 4000);
        if (!markdown) return null;
        return {
          id,
          kind,
          markdown
        };
      }
      if (kind === 'mermaid') {
        const code = clip(block.code || block.source || '', 6000);
        if (!code) return null;
        return {
          id,
          kind,
          diagramType: MERMAID_DIAGRAM_TYPES.includes(String(block.diagramType) as VisualExplainerMermaidDiagramType)
            ? block.diagramType
            : 'flowchart',
          code
        };
      }
      if (kind === 'x6') {
        const graph = block.graph && typeof block.graph === 'object' ? block.graph : {};
        const nodes = Array.isArray(graph.nodes) ? graph.nodes.slice(0, 24) : [];
        const normalizedNodes: VisualExplainerX6NodeMetadata[] = nodes.map((node: any, nodeIndex: number) => ({
          id: clip(node.id || `node-${nodeIndex + 1}`, 80),
          shape: clip(node.shape || 'rect', 40),
          x: finiteNumber(node.x),
          y: finiteNumber(node.y),
          width: finiteNumber(node.width),
          height: finiteNumber(node.height),
          label: node.label || node.title ? clip(node.label || node.title, 120) : undefined,
          attrs: node.attrs && typeof node.attrs === 'object' ? node.attrs : undefined,
          data: node.data && typeof node.data === 'object' ? node.data : undefined
        }));
        const nodeIds = new Set(normalizedNodes.map((node) => node.id));
        const edges = Array.isArray(graph.edges) ? graph.edges.slice(0, 36) : [];
        const normalizedEdges = edges
          .map((edge: any, edgeIndex: number) => {
            const source = normalizeX6Terminal(edge.source || edge.from || '');
            const target = normalizeX6Terminal(edge.target || edge.to || '');
            return {
              id: clip(edge.id || `edge-${edgeIndex + 1}`, 80),
              shape: edge.shape ? clip(edge.shape, 40) : undefined,
              source,
              target,
              label: edge.label ? clip(edge.label, 120) : undefined,
              attrs: edge.attrs && typeof edge.attrs === 'object' ? edge.attrs : undefined,
              data: edge.data && typeof edge.data === 'object' ? edge.data : undefined
            };
          })
          .filter((edge: {
            id: string;
            shape?: string;
            source: VisualExplainerX6Terminal | null;
            target: VisualExplainerX6Terminal | null;
            label?: string;
            attrs?: Record<string, unknown>;
            data?: Record<string, unknown>;
          }): edge is VisualExplainerX6EdgeMetadata =>
            Boolean(edge.source && edge.target && nodeIds.has(x6TerminalCellId(edge.source)) && nodeIds.has(x6TerminalCellId(edge.target)))
          );
        if (!normalizedNodes.length && !normalizedEdges.length) return null;
        return {
          id,
          kind,
          graph: {
            nodes: normalizedNodes,
            edges: normalizedEdges
          }
        };
      }
      if (kind === 'vega_lite') {
        if (!block.spec || typeof block.spec !== 'object') return null;
        return {
          id,
          kind,
          spec: block.spec
        };
      }
      if (kind === 'tldraw') {
        if (!block.snapshot && !Array.isArray(block.records)) return null;
        return {
          id,
          kind,
          snapshot: block.snapshot && typeof block.snapshot === 'object' ? block.snapshot : undefined,
          records: Array.isArray(block.records) ? block.records.slice(0, 200) : undefined
        };
      }
      if (kind === 'motion_canvas') {
        const source = block.source ? clip(block.source, 12000) : undefined;
        const sceneSpec = block.sceneSpec && typeof block.sceneSpec === 'object' ? block.sceneSpec : undefined;
        if (!source && !sceneSpec) return null;
        return {
          id,
          kind,
          sceneName: clip(block.sceneName || 'AIStudioScene', 80),
          source,
          sceneSpec
        };
      }
      if (kind === 'jsav') {
        const dataStructure = JSAV_DATA_STRUCTURES.includes(String(block.dataStructure) as VisualExplainerJsavDataStructure)
          ? String(block.dataStructure) as VisualExplainerJsavDataStructure
          : 'array';
        return {
          id,
          kind,
          source: block.source ? clip(block.source, 12000) : undefined,
          dataStructure,
          initialState: block.initialState && typeof block.initialState === 'object' ? block.initialState : {},
          steps: Array.isArray(block.steps)
            ? block.steps.slice(0, 40).map((step: any, stepIndex: number) => ({
                id: clip(step.id || `step-${stepIndex + 1}`, 80),
                operation: clip(step.operation || step.action || '', 120),
                targets: Array.isArray(step.targets) ? step.targets.slice(0, 8).map((target: unknown) => clip(target, 80)) : undefined,
                state: step.state && typeof step.state === 'object' ? step.state : undefined,
                explanation: step.explanation ? clip(step.explanation, 400) : undefined
              }))
            : []
        };
      }
      return null;
    })
    .filter((block): block is VisualExplainerBlock => Boolean(block));
  return blocks.length ? blocks : fallbackBlocks;
};

export const buildFallbackVisualExplainer = (
  context: StudioGenerationContext,
  markdownDraft: string
): VisualExplainerPayload => {
  const parsedDraft = parseVisualExplainerJsonString(markdownDraft);
  const cleanMarkdownDraft = parsedDraft?.markdownDraft || extractVisualExplainerMarkdownDraft(markdownDraft);
  const prompt = clip(context.input.prompt || context.template.promptFrame || context.template.title, 100);
  const sections = parsedDraft?.sections?.length ? parsedDraft.sections.map((section) => {
    const looseSection = section as VisualExplainerSection & { markdown?: string };
    return {
      title: looseSection.title,
      body: looseSection.narration || looseSection.focus,
      sourceMarkdown: looseSection.sourceMarkdown || looseSection.markdown || looseSection.narration || looseSection.focus,
      bullets: looseSection.screenText || []
    };
  }) : markdownSections(cleanMarkdownDraft);
  return {
    schemaVersion: 'visual_explainer.v1',
    markdownDraft: cleanMarkdownDraft,
    title: prompt,
    summary: `把「${prompt}」拆成可播放的视觉讲解。`,
    sections: sections.map((section, index) => {
      const sectionId = `section-${index + 1}-${slug(section.title, 'part')}`;
      const mainId = `${sectionId}-main`;
      const bodySummary = clip(section.body || section.title, 240);
      const points = Array.from(new Set((section.bullets.length ? section.bullets : section.body
        .split(/\n{2,}|[。！？]/g)
        .map((item) => clip(item, 90))
        .filter(Boolean))
        .filter((item) => item !== section.title)
      )).slice(0, 3);
      const visualMode: VisualExplainerSection['visualMode'] = index === sections.length - 1
        ? 'summary'
        : index % 3 === 1
          ? 'diagram'
          : index % 3 === 2
            ? 'process'
            : 'slide';
      const supportIds = (points.length ? points : [bodySummary])
        .map((_, itemIndex) => `${sectionId}-point-${itemIndex + 1}`);
      const objects: VisualExplainerObject[] = [
        {
          id: mainId,
          kind: 'title',
          label: section.title,
          detail: bodySummary,
          role: index === 0 ? 'main' : 'summary'
        },
        ...supportIds.map((id, itemIndex) => ({
          id,
          kind: 'card' as const,
          label: clip((points[itemIndex] || bodySummary).replace(/^#+\s*/, ''), 70),
          detail: bodySummary,
          role: itemIndex === 0 ? 'main' as const : 'support' as const
        }))
      ];
      return {
        id: sectionId,
        title: section.title,
        focus: displayFocus(bodySummary, section.body, section.title),
        sourceHint: section.title,
        sourceMarkdown: clipMarkdown(section.sourceMarkdown || [`## ${section.title}`, section.body].filter(Boolean).join('\n\n'), 6000),
        bodyMarkdown: bodyMarkdownForSlide(section.sourceMarkdown || [`## ${section.title}`, section.body].filter(Boolean).join('\n\n'), section.title),
        visualMode,
        screenText: Array.from(new Set([section.title, ...points])).slice(0, 4),
        narration: clip(section.body, 700),
        objects,
        timeline: [
          {
            id: `${sectionId}-step-1`,
            action: 'appear',
            targetIds: [mainId],
            narration: bodySummary || `先建立这一幕的焦点：${section.title}`,
            screenText: section.title,
            durationMs: 800
          },
          ...supportIds.map((id, itemIndex) => ({
            id: `${sectionId}-step-${itemIndex + 2}`,
            action: itemIndex === 0 ? 'focus' as const : 'connect' as const,
            targetIds: itemIndex === 0 ? [id] : [mainId, id],
            narration: clip(points[itemIndex] || bodySummary, 180),
            screenText: clip(points[itemIndex] || bodySummary, 42),
            durationMs: 900
          }))
        ],
        visualBlocks: fallbackBlocksForSection(
          sectionId,
          section.title,
          section.body,
          points,
          visualMode,
          objects,
          [
            {
              id: `${sectionId}-step-1`,
              action: 'appear',
              targetIds: [mainId],
              narration: bodySummary || `先建立这一幕的焦点：${section.title}`,
              screenText: section.title,
              durationMs: 800
            },
            ...supportIds.map((id, itemIndex) => ({
              id: `${sectionId}-step-${itemIndex + 2}`,
              action: itemIndex === 0 ? 'focus' as const : 'connect' as const,
              targetIds: itemIndex === 0 ? [id] : [mainId, id],
              narration: clip(points[itemIndex] || bodySummary, 180),
              screenText: clip(points[itemIndex] || bodySummary, 42),
              durationMs: 900
            }))
          ]
        ),
        preferredRenderer: rendererForVisualMode(visualMode),
        checkQuestion: `你能用一句话复述「${section.title}」的关键点吗？`
      };
    }),
    rendererPlan: {
      primary: 'section_player',
      libraries: ['Reveal.js', 'Mermaid', 'AntV X6', 'Vega-Lite', 'tldraw', 'Motion Canvas', 'JSAV'],
      exportTargets: ['web', 'video', 'pptx']
    }
  };
};

const normalizeId = (value: unknown, fallback: string) => slug(clip(value || fallback, 80), fallback);

const uniqueTexts = (items: unknown[], max = 4, maxLength = 90) =>
  Array.from(new Set(
    items
      .map((item) => clip(item, maxLength))
      .filter(Boolean)
  )).slice(0, max);

const sectionTypeToVisualMode = (sectionType: VisualExplainerSectionPlan['sections'][number]['sectionType']): VisualExplainerSection['visualMode'] => {
  if (sectionType === 'process') return 'process';
  if (sectionType === 'comparison') return 'comparison';
  if (sectionType === 'derivation') return 'whiteboard';
  if (sectionType === 'summary') return 'summary';
  return 'slide';
};

const inferVisualModeFromText = (text: string, fallback: VisualExplainerSection['visualMode'] = 'slide') => {
  if (/(图表|趋势|统计|分布|柱状|折线|数据变化|chart|plot)/i.test(text)) return 'chart';
  if (/(推导|证明|公式|递推|化简|展开|演算)/i.test(text)) return 'whiteboard';
  if (/(对比|区别|相同|不同|优缺点|类型|比较)/i.test(text)) return 'comparison';
  if (/(流程|步骤|过程|算法|循环|状态|地址变换|数据通路|执行|流动|trace)/i.test(text)) return 'process';
  if (/(结构|连接|关系|表连接|数据库|组件|节点|边|ER|join|graph)/i.test(text)) return 'diagram';
  return fallback;
};

const rendererForIntent = (
  visualMode: VisualExplainerSection['visualMode'],
  text: string
): VisualExplainerRendererKind => {
  if (visualMode === 'chart') return 'vega_lite';
  if (visualMode === 'whiteboard') return 'tldraw';
  if (/(数组|链表|树|堆|栈|队列|排序|查找|插入排序|冒泡|quick|merge|heap)/i.test(text)) return 'mermaid';
  if (visualMode === 'diagram') return 'x6';
  if (visualMode === 'process') return 'mermaid';
  return 'reveal';
};

const blockKindsForIntent = (renderer: VisualExplainerRendererKind): VisualExplainerBlock['kind'][] => {
  if (renderer === 'reveal') return ['markdown'];
  if (renderer === 'mermaid') return ['markdown', 'mermaid'];
  if (renderer === 'x6') return ['markdown', 'x6'];
  if (renderer === 'vega_lite') return ['markdown', 'vega_lite'];
  if (renderer === 'tldraw') return ['markdown', 'tldraw'];
  if (renderer === 'jsav') return ['markdown', 'jsav'];
  return ['markdown', 'motion_canvas'];
};

export const normalizeVisualExplainerContentMap = (
  context: StudioGenerationContext,
  value: unknown,
  markdownDraft: string
): VisualExplainerContentMap => {
  const raw = value && typeof value === 'object' ? value as any : {};
  const sections = markdownSections(markdownDraft);
  const fallbackConcepts = sections.map((section, index) => ({
    id: `concept-${index + 1}-${slug(section.title, 'item')}`,
    label: section.title,
    explanation: clip(section.body || section.title, 240),
    sourceHint: section.title
  }));
  const rawConcepts = Array.isArray(raw.concepts) ? raw.concepts : [];
  const concepts = (rawConcepts.length ? rawConcepts : fallbackConcepts).slice(0, 12).map((item: any, index: number) => ({
    id: normalizeId(item.id || item.label, `concept-${index + 1}`),
    label: clip(item.label || item.title || fallbackConcepts[index]?.label || `概念 ${index + 1}`, 100),
    explanation: clip(item.explanation || item.description || fallbackConcepts[index]?.explanation || '', 420),
    sourceHint: item.sourceHint ? clip(item.sourceHint, 160) : fallbackConcepts[index]?.sourceHint
  }));
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const fallbackSteps = sections.flatMap((section, sectionIndex) => {
    const points = section.bullets.length ? section.bullets : section.body.split(/[。！？\n]/g).map((item) => clip(item, 100)).filter(Boolean);
    return points.slice(0, 3).map((point, pointIndex) => ({
      id: `step-${sectionIndex + 1}-${pointIndex + 1}`,
      label: clip(point, 80),
      description: clip(point, 240),
      order: sectionIndex * 3 + pointIndex + 1,
      sourceHint: section.title
    }));
  });
  const steps = (rawSteps.length ? rawSteps : fallbackSteps).slice(0, 18).map((item: any, index: number) => ({
    id: normalizeId(item.id || item.label, `step-${index + 1}`),
    label: clip(item.label || item.title || fallbackSteps[index]?.label || `步骤 ${index + 1}`, 100),
    description: clip(item.description || item.detail || fallbackSteps[index]?.description || '', 420),
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1,
    sourceHint: item.sourceHint ? clip(item.sourceHint, 160) : fallbackSteps[index]?.sourceHint
  }));
  const rawRelationships = Array.isArray(raw.relationships) ? raw.relationships : [];
  const relationships = rawRelationships.slice(0, 24).map((item: any, index: number) => ({
    id: normalizeId(item.id || item.label, `rel-${index + 1}`),
    from: clip(item.from || item.source || '', 80),
    to: clip(item.to || item.target || '', 80),
    label: clip(item.label || item.kind || '关联', 80),
    kind: ['cause', 'sequence', 'contrast', 'contains', 'depends_on'].includes(String(item.kind)) ? item.kind : undefined
  })).filter((item: VisualExplainerContentMap['relationships'][number]) => item.from && item.to);
  const rawExamples = Array.isArray(raw.examples) ? raw.examples : [];
  const examples = rawExamples.slice(0, 8).map((item: any, index: number) => ({
    id: normalizeId(item.id || item.label, `example-${index + 1}`),
    label: clip(item.label || item.title || `例子 ${index + 1}`, 100),
    description: clip(item.description || item.detail || '', 420),
    sourceHint: item.sourceHint ? clip(item.sourceHint, 160) : undefined
  })).filter((item: VisualExplainerContentMap['examples'][number]) => item.label && item.description);
  const prompt = clip(context.input.prompt || context.template.title, 120);
  return {
    schemaVersion: 'visual_explainer.content_map.v1',
    title: clip(raw.title || prompt, 160),
    summary: clip(raw.summary || sections[0]?.body || prompt, 500),
    concepts,
    steps,
    relationships,
    examples
  };
};

export const normalizeVisualExplainerSectionPlan = (
  context: StudioGenerationContext,
  value: unknown,
  markdownDraft: string,
  contentMap: VisualExplainerContentMap,
  sourceBlocks: VisualExplainerMarkdownSourceBlock[] = buildVisualExplainerMarkdownSourceBlocks(markdownDraft)
): VisualExplainerSectionPlan => {
  const raw = value && typeof value === 'object' ? value as any : {};
  const sourceBlockById = new Map(sourceBlocks.map((block) => [block.id, block]));
  const sourceMarkdownForIds = (ids: string[], fallbackMarkdown = '') => {
    const stitched = ids
      .map((id) => sourceBlockById.get(id)?.sourceMarkdown)
      .filter((item): item is string => Boolean(item?.trim()))
      .join('\n\n');
    return clipMarkdown(stitched || fallbackMarkdown, 6000);
  };
  const fallbackSections = sourceBlocks.map((block, index) => ({
    id: `section-${index + 1}-${slug(block.title, 'part')}`,
    title: block.title,
    goal: clip(block.sourcePreview || block.title, 220),
    sourceHint: block.title,
    sourceBlockIds: [block.id],
    sourceMarkdown: sourceMarkdownForIds([block.id], block.sourceMarkdown),
    keyPoints: uniqueTexts(block.keyPoints.length ? block.keyPoints : block.sourcePreview.split(/[。！？\n]/g), 4, 90),
    sectionType: index === 0 ? 'intro' as const : index === sourceBlocks.length - 1 ? 'summary' as const : inferVisualModeFromText(`${block.title} ${block.sourcePreview}`) === 'process' ? 'process' as const : 'concept' as const
  }));
  if (fallbackSections.length < 4 && contentMap.steps.length >= 4) {
    contentMap.steps.slice(0, 5).forEach((step, index) => {
      if (fallbackSections.length >= 4) return;
      fallbackSections.push({
        id: `section-step-${index + 1}-${slug(step.label, 'step')}`,
        title: step.label,
        goal: step.description,
        sourceHint: step.sourceHint || step.label,
        sourceBlockIds: [],
        sourceMarkdown: clipMarkdown([`## ${step.label}`, step.description].join('\n\n'), 2000),
        keyPoints: [step.description],
        sectionType: 'process'
      });
    });
  }
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const sections = (rawSections.length ? rawSections : fallbackSections).slice(0, 10).map((section: any, index: number) => {
    const fallback = fallbackSections[index] || fallbackSections[fallbackSections.length - 1];
    const sectionType = ['intro', 'concept', 'process', 'example', 'comparison', 'derivation', 'summary'].includes(String(section.sectionType))
      ? section.sectionType
      : fallback?.sectionType || 'concept';
    const rawSourceBlockIds = Array.isArray(section.sourceBlockIds)
      ? section.sourceBlockIds.map((id: unknown) => String(id || '').trim()).filter((id: string) => sourceBlockById.has(id))
      : [];
    const sourceBlockIds = rawSourceBlockIds.length ? rawSourceBlockIds : fallback?.sourceBlockIds || [];
    const fallbackSourceMarkdown = section.sourceMarkdown || section.markdown || section.content || fallback?.sourceMarkdown || fallback?.goal || '';
    return {
      id: normalizeId(section.id || section.title || fallback?.id, `section-${index + 1}`),
      title: clip(section.title || fallback?.title || `Section ${index + 1}`, 90),
      goal: clip(section.goal || section.focus || fallback?.goal || '', 260),
      sourceHint: clip(section.sourceHint || sourceBlockIds.join(', ') || fallback?.sourceHint || section.title || '', 180),
      sourceBlockIds,
      sourceMarkdown: sourceMarkdownForIds(sourceBlockIds, fallbackSourceMarkdown),
      keyPoints: uniqueTexts(Array.isArray(section.keyPoints) ? section.keyPoints : fallback?.keyPoints || [], 4, 90),
      sectionType
    };
  }).filter((section: VisualExplainerSectionPlan['sections'][number]) =>
    section.title && (section.goal || section.keyPoints.length || section.sourceMarkdown)
  );
  const prompt = clip(context.input.prompt || context.template.title, 120);
  return {
    schemaVersion: 'visual_explainer.section_plan.v1',
    title: clip(raw.title || contentMap.title || prompt, 160),
    summary: clip(raw.summary || contentMap.summary || prompt, 500),
    sections: sections.length ? sections : fallbackSections.slice(0, 6)
  };
};

export const normalizeVisualExplainerSlideText = (
  value: unknown,
  sectionPlan: VisualExplainerSectionPlan
): VisualExplainerSlideTextPlan => {
  const raw = value && typeof value === 'object' ? value as any : {};
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const byId = new Map(rawSections.map((section: any) => [String(section.id || ''), section]));
  return {
    schemaVersion: 'visual_explainer.slide_text.v1',
    sections: sectionPlan.sections.map((section) => {
      const rawSection: any = byId.get(section.id) || {};
      const screenText = uniqueTexts(
        Array.isArray(rawSection.screenText) ? rawSection.screenText : section.keyPoints,
        4,
        80
      ).filter((item) => item !== section.title);
      return {
        id: section.id,
        title: clip(rawSection.title || section.title, 90),
        focus: displayFocus(rawSection.focus, section.goal, section.title),
        screenText: screenText.length ? screenText : uniqueTexts(section.keyPoints.length ? section.keyPoints : [section.goal], 3, 80),
        narration: clip(rawSection.narration || [section.goal, ...section.keyPoints].filter(Boolean).join('。'), 900),
        checkQuestion: rawSection.checkQuestion ? clip(rawSection.checkQuestion, 220) : `你能说出「${section.title}」的关键点吗？`
      };
    })
  };
};

export const normalizeVisualExplainerVisualIntent = (
  value: unknown,
  sectionPlan: VisualExplainerSectionPlan,
  slideText: VisualExplainerSlideTextPlan
): VisualExplainerVisualIntentPlan => {
  const raw = value && typeof value === 'object' ? value as any : {};
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const byId = new Map(rawSections.map((section: any) => [String(section.id || ''), section]));
  const slideById = new Map(slideText.sections.map((section) => [section.id, section]));
  return {
    schemaVersion: 'visual_explainer.visual_intent.v1',
    sections: sectionPlan.sections.map((section) => {
      const rawSection: any = byId.get(section.id) || {};
      const slide = slideById.get(section.id);
      const text = `${section.title} ${section.goal} ${section.keyPoints.join(' ')} ${section.sourceMarkdown} ${slide?.narration || ''}`;
      const fallbackMode = sectionTypeToVisualMode(section.sectionType);
      const visualMode = VISUAL_MODES.includes(String(rawSection.visualMode) as VisualExplainerSection['visualMode'])
        ? rawSection.visualMode as VisualExplainerSection['visualMode']
        : inferVisualModeFromText(text, fallbackMode);
      const fallbackRenderer = rendererForIntent(visualMode, text);
      const preferredRenderer = VISUAL_RENDERERS.includes(String(rawSection.preferredRenderer) as VisualExplainerRendererKind)
        ? rawSection.preferredRenderer as VisualExplainerRendererKind
        : fallbackRenderer;
      const blockKinds = Array.isArray(rawSection.blockKinds)
        ? rawSection.blockKinds.filter((kind: unknown): kind is VisualExplainerBlock['kind'] =>
          ['markdown', 'mermaid', 'x6', 'vega_lite', 'tldraw', 'motion_canvas', 'jsav'].includes(String(kind))
        ).slice(0, 3)
        : blockKindsForIntent(preferredRenderer);
      return {
        id: section.id,
        visualMode,
        preferredRenderer,
        blockKinds: blockKinds.length ? blockKinds : blockKindsForIntent(preferredRenderer),
        reason: clip(rawSection.reason || `根据 section 类型 ${section.sectionType} 选择 ${preferredRenderer}`, 220)
      };
    })
  };
};

export const normalizeVisualExplainerRendererBlocks = (
  value: unknown,
  sectionPlan: VisualExplainerSectionPlan,
  slideText: VisualExplainerSlideTextPlan,
  visualIntent: VisualExplainerVisualIntentPlan
): VisualExplainerRendererBlockPlan => {
  const raw = value && typeof value === 'object' ? value as any : {};
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const rawById = new Map(rawSections.map((section: any) => [String(section.id || ''), section]));
  const slideById = new Map(slideText.sections.map((section) => [section.id, section]));
  const intentById = new Map(visualIntent.sections.map((section) => [section.id, section]));
  return {
    schemaVersion: 'visual_explainer.renderer_blocks.v1',
    sections: sectionPlan.sections.map((section) => {
      const rawSection: any = rawById.get(section.id) || {};
      const slide = slideById.get(section.id);
      const intent = intentById.get(section.id);
      const points = uniqueTexts([...(slide?.screenText || []), ...section.keyPoints], 4, 80);
      const mainId = `${section.id}-main`;
      const supportIds = points.map((_, index) => `${section.id}-point-${index + 1}`);
      const fallbackObjects: VisualExplainerObject[] = [
        {
          id: mainId,
          kind: 'title',
          label: section.title,
          detail: slide?.focus || section.goal,
          role: 'main'
        },
        ...supportIds.map((id, index) => ({
          id,
          kind: 'card' as const,
          label: points[index],
          detail: slide?.narration || section.goal,
          role: index === 0 ? 'main' as const : 'support' as const
        }))
      ];
      const fallbackTimeline: VisualExplainerTimelineStep[] = [
        {
          id: `${section.id}-step-1`,
          action: 'appear',
          targetIds: [mainId],
          narration: slide?.focus || section.goal,
          screenText: section.title,
          durationMs: 800
        },
        ...supportIds.map((id, index) => ({
          id: `${section.id}-step-${index + 2}`,
          action: index === 0 ? 'focus' as const : 'connect' as const,
          targetIds: index === 0 ? [id] : [mainId, id],
          narration: points[index],
          screenText: points[index],
          durationMs: 900
        }))
      ];
      const visualMode = intent?.visualMode || sectionTypeToVisualMode(section.sectionType);
      const fallbackBlocks = fallbackBlocksForSection(
        section.id,
        section.title,
        slide?.narration || section.goal,
        points,
        visualMode,
        fallbackObjects,
        fallbackTimeline
      );
      return {
        id: section.id,
        objects: Array.isArray(rawSection.objects) ? rawSection.objects : fallbackObjects,
        timeline: Array.isArray(rawSection.timeline) ? rawSection.timeline : fallbackTimeline,
        visualBlocks: normalizeVisualBlocks(rawSection.visualBlocks, fallbackBlocks)
      };
    })
  };
};

const selectedSourceIdsFromContext = (context: StudioGenerationContext) => {
  const selectedResourceIds = (context.input.context as any)?.selectedResourceIds;
  return Array.isArray(selectedResourceIds)
    ? Array.from(new Set(selectedResourceIds.map((id) => String(id || '').trim()).filter(Boolean)))
    : [];
};

const visualLessonModelTypeForSection = (section: VisualExplainerSection): VisualLessonModelType => {
  const text = `${section.title} ${section.focus} ${section.sourceMarkdown || ''} ${section.bodyMarkdown || ''}`.toLowerCase();
  if (/(join|inner join|left join|right join|数据库|关系表|表连接|字段|主键|外键)/i.test(text)) return 'table';
  if (/(dijkstra|bfs|dfs|最短路|图算法|节点|边|邻接|graph)/i.test(text)) return 'graph';
  if (/(lw|load word|数据通路|datapath|控制信号|寄存器堆|alu|数据存储器|指令存储器)/i.test(text)) return 'datapath';
  if (/(数组|链表|栈|队列|堆|排序|sequence|array|stack|queue|heap)/i.test(text)) return 'sequence';
  if (/(代码|伪代码|变量|trace|执行到|循环|递归|function|for|while)/i.test(text)) return 'code_trace';
  if ((section.visualBlocks || []).some((block) => block.kind === 'mermaid') || section.visualMode === 'process' || section.visualMode === 'diagram') {
    return 'flowchart';
  }
  return 'markdown_mermaid';
};

const visualLessonLayoutForSection = (section: VisualExplainerSection): VisualLessonSlide['layout'] => {
  if (section.preferredRenderer === 'reveal' || section.visualMode === 'summary') return 'text_first';
  if (section.visualMode === 'diagram' || section.visualMode === 'process' || section.visualMode === 'chart') return 'visual_first';
  return 'text_visual';
};

export const visualLessonFromExplainer = (
  context: StudioGenerationContext,
  payload: Omit<VisualExplainerPayload, 'visualLesson'>
): VisualLesson => ({
  schemaVersion: 'visual_lesson.v1',
  title: payload.title,
  summary: payload.summary,
  sourceIds: selectedSourceIdsFromContext(context),
  slides: payload.sections.map((section) => ({
    id: section.id,
    title: section.title,
    bodyMarkdown: section.bodyMarkdown || section.sourceMarkdown || '',
    narration: section.narration,
    layout: visualLessonLayoutForSection(section),
    visualModel: {
      type: visualLessonModelTypeForSection(section),
      title: section.title,
      objects: section.objects,
      blocks: section.visualBlocks || [],
      markdown: section.sourceMarkdown || section.bodyMarkdown || ''
    },
    timeline: section.timeline.map((step) => ({
      stepId: step.id,
      action: step.action,
      targetIds: step.targetIds,
      screenText: step.screenText,
      narration: step.narration,
      statePatch: step.statePatch || {
        activeTargetIds: step.targetIds,
        action: step.action
      },
      durationMs: step.durationMs || 900
    })),
    checkQuestion: section.checkQuestion
  }))
});

const visualLessonLayout = (value: unknown): VisualLessonSlide['layout'] =>
  value === 'visual_first' || value === 'text_first' || value === 'full_text' || value === 'text_visual'
    ? value
    : 'text_visual';

const visualLessonModelType = (value: unknown, fallback: VisualLessonModelType = 'markdown_mermaid'): VisualLessonModelType =>
  VISUAL_LESSON_MODEL_TYPES.includes(String(value) as VisualLessonModelType)
    ? String(value) as VisualLessonModelType
    : fallback;

const normalizeVisualLessonObjects = (rawObjects: unknown, slideId: string, slideTitle: string): VisualExplainerObject[] => {
  const objects = Array.isArray(rawObjects)
    ? rawObjects.slice(0, 40).map((object: any, index): VisualExplainerObject => ({
      id: clip(object?.id || `${slideId}-object-${index + 1}`, 80),
      kind: VISUAL_OBJECT_KINDS.includes(String(object?.kind) as VisualExplainerObjectKind) ? object.kind : 'card',
      label: clip(object?.label || object?.title || `Object ${index + 1}`, 100),
      detail: object?.detail || object?.description ? clip(object.detail || object.description, 500) : undefined,
      role: ['main', 'support', 'example', 'warning', 'summary'].includes(String(object?.role)) ? object.role : 'support',
      fromId: object?.fromId ? clip(object.fromId, 80) : undefined,
      toId: object?.toId ? clip(object.toId, 80) : undefined
    }))
    : [];
  return objects.length
    ? objects
    : [{
      id: `${slideId}-main`,
      kind: 'title',
      label: slideTitle,
      role: 'main'
    }];
};

const normalizeVisualLessonTimeline = (
  rawTimeline: unknown,
  slideId: string,
  objects: VisualExplainerObject[],
  narration: string
): VisualLessonTimelineStep[] => {
  const objectIds = new Set(objects.map((object) => object.id));
  const fallbackTargets = objects.slice(0, 1).map((object) => object.id);
  const sourceSteps = Array.isArray(rawTimeline) && rawTimeline.length
    ? rawTimeline
    : [
      { action: 'appear', targetIds: fallbackTargets, screenText: '观察这一页的核心对象', narration },
      { action: 'focus', targetIds: fallbackTargets, screenText: '聚焦关键变化', narration }
    ];
  return sourceSteps.slice(0, 12).map((step: any, index): VisualLessonTimelineStep => {
    const rawTargets = Array.isArray(step?.targetIds) ? step.targetIds : Array.isArray(step?.targets) ? step.targets : [];
    const targetIds = rawTargets
      .map((id: unknown) => clip(id, 80))
      .filter((id: string) => objectIds.has(id));
    const activeTargetIds = targetIds.length ? targetIds : fallbackTargets;
    const action = VISUAL_ACTIONS.includes(String(step?.action) as VisualExplainerAction) ? String(step.action) : 'focus';
    const rawStatePatch = step?.statePatch && typeof step.statePatch === 'object' && !Array.isArray(step.statePatch)
      ? step.statePatch as Record<string, unknown>
      : {};
    return {
      stepId: clip(step?.stepId || step?.id || `${slideId}-step-${index + 1}`, 80),
      action,
      targetIds: activeTargetIds,
      screenText: step?.screenText ? clip(step.screenText, 120) : undefined,
      narration: clip(step?.narration || narration || step?.screenText || '', 700),
      statePatch: Object.keys(rawStatePatch).length
        ? rawStatePatch
        : { activeTargetIds, action },
      durationMs: Number.isFinite(Number(step?.durationMs)) ? Math.max(400, Math.min(6000, Number(step.durationMs))) : 1000
    };
  });
};

export const normalizeVisualLessonPayload = (
  context: StudioGenerationContext,
  value: unknown,
  userPrompt = '',
  selectedSourceIds: string[] = []
): VisualLesson => {
  const raw = value && typeof value === 'object' ? value as any : {};
  if (raw.schemaVersion !== 'visual_lesson.v1' || !Array.isArray(raw.slides) || raw.slides.length === 0) {
    const fallbackTitle = clip(userPrompt || context.input.prompt || context.template.title || 'Visual Lesson', 100);
    const fallback = buildFallbackVisualExplainer(
      context,
      [`# ${fallbackTitle}`, '', `请围绕「${fallbackTitle}」生成视觉化讲解。`].join('\n')
    );
    return {
      ...visualLessonFromExplainer(context, fallback),
      sourceIds: selectedSourceIds
    };
  }

  const allowedSourceIds = new Set(selectedSourceIds);
  const sourceIds = Array.isArray(raw.sourceIds)
    ? raw.sourceIds.map((id: unknown) => String(id || '').trim()).filter((id: string) => allowedSourceIds.has(id))
    : [];
  const promptTitle = clip(context.template.title || userPrompt || context.input.prompt || 'Visual Lesson', 100);
  const title = clip(raw.title || promptTitle, 100);
  const summary = clip(raw.summary || `把「${promptTitle}」转换成可播放的视觉讲解。`, 500);
  const slides = raw.slides.slice(0, 8).map((slide: any, index: number): VisualLessonSlide => {
    const slideId = clip(slide?.id || `slide-${index + 1}`, 80);
    const slideTitle = clip(slide?.title || `Slide ${index + 1}`, 100);
    const bodyMarkdown = clipMarkdown(slide?.bodyMarkdown || slide?.markdown || slide?.narration || slideTitle, 6000);
    const narration = clip(slide?.narration || slide?.speakerNotes || bodyMarkdown, 1000);
    const rawVisualModel = slide?.visualModel && typeof slide.visualModel === 'object' ? slide.visualModel : {};
    const objects = normalizeVisualLessonObjects(rawVisualModel.objects || slide?.objects, slideId, slideTitle);
    const fallbackBlock: VisualExplainerBlock = {
      id: `${slideId}-markdown`,
      kind: 'markdown',
      markdown: bodyMarkdown
    };
    const blocks = normalizeVisualBlocks(rawVisualModel.blocks || slide?.blocks, [fallbackBlock]);
    const timeline = normalizeVisualLessonTimeline(slide?.timeline, slideId, objects, narration);
    return {
      id: slideId,
      title: slideTitle,
      bodyMarkdown,
      narration,
      layout: visualLessonLayout(slide?.layout),
      visualModel: {
        type: visualLessonModelType(rawVisualModel.type),
        title: clip(rawVisualModel.title || slideTitle, 100),
        objects,
        blocks,
        markdown: clipMarkdown(rawVisualModel.markdown || bodyMarkdown, 6000),
        data: rawVisualModel.data && typeof rawVisualModel.data === 'object' && !Array.isArray(rawVisualModel.data)
          ? rawVisualModel.data as Record<string, unknown>
          : undefined
      },
      timeline,
      checkQuestion: slide?.checkQuestion ? clip(slide.checkQuestion, 240) : undefined
    };
  });

  return {
    schemaVersion: 'visual_lesson.v1',
    title,
    summary,
    sourceIds,
    slides
  };
};

export const buildVisualExplainerFromStages = (
  context: StudioGenerationContext,
  markdownDraft: string,
  contentMap: VisualExplainerContentMap,
  sectionPlan: VisualExplainerSectionPlan,
  slideText: VisualExplainerSlideTextPlan,
  visualIntent: VisualExplainerVisualIntentPlan,
  rendererBlocks: VisualExplainerRendererBlockPlan
): VisualExplainerPayload => {
  const slideById = new Map(slideText.sections.map((section) => [section.id, section]));
  const intentById = new Map(visualIntent.sections.map((section) => [section.id, section]));
  const blocksById = new Map(rendererBlocks.sections.map((section) => [section.id, section]));
  const rawPayload = {
    schemaVersion: 'visual_explainer.v1',
    markdownDraft,
    title: sectionPlan.title || contentMap.title,
    summary: sectionPlan.summary || contentMap.summary,
    sections: sectionPlan.sections.map((section) => {
      const slide = slideById.get(section.id);
      const intent = intentById.get(section.id);
      const blocks = blocksById.get(section.id);
      return {
        id: section.id,
        title: slide?.title || section.title,
        focus: slide?.focus || section.goal,
        sourceHint: section.sourceHint,
        sourceMarkdown: section.sourceMarkdown,
        bodyMarkdown: bodyMarkdownForSlide(section.sourceMarkdown, slide?.title || section.title),
        visualMode: intent?.visualMode || sectionTypeToVisualMode(section.sectionType),
        screenText: slide?.screenText || section.keyPoints,
        narration: slide?.narration || section.goal,
        objects: blocks?.objects,
        timeline: blocks?.timeline,
        visualBlocks: blocks?.visualBlocks,
        preferredRenderer: intent?.preferredRenderer,
        checkQuestion: slide?.checkQuestion
      };
    }),
    rendererPlan: {
      primary: 'section_player',
      libraries: ['Reveal.js', 'Mermaid', 'AntV X6', 'Vega-Lite', 'tldraw', 'Motion Canvas', 'JSAV'],
      exportTargets: ['web', 'video', 'pptx']
    }
  };
  const normalized = normalizeVisualExplainerPayload(context, rawPayload, markdownDraft);
  return {
    ...normalized,
    visualLesson: visualLessonFromExplainer(context, normalized)
  };
};

export const validateVisualExplainerPayload = (payload: VisualExplainerPayload): VisualExplainerValidationReport => {
  const warnings: string[] = [];
  const rendererCounts: Record<string, number> = {};
  payload.sections.forEach((section) => {
    if (!section.sourceMarkdown?.trim()) {
      warnings.push(`${section.id} has no sourceMarkdown`);
    }
    const objectIds = new Set(section.objects.map((object) => object.id));
    section.timeline.forEach((step) => {
      const missing = step.targetIds.filter((id) => !objectIds.has(id));
      if (missing.length) warnings.push(`${section.id}/${step.id} has missing target ids: ${missing.join(', ')}`);
    });
    section.visualBlocks?.forEach((block) => {
      const renderer = rendererFromBlockKind(block.kind);
      rendererCounts[renderer] = (rendererCounts[renderer] || 0) + 1;
      if (block.kind === 'mermaid' && !/^(flowchart|graph|sequenceDiagram|stateDiagram|classDiagram|erDiagram|mindmap|timeline)\b/m.test(block.code.trim())) {
        warnings.push(`${section.id}/${block.id} has unusual Mermaid DSL start`);
      }
      if (block.kind === 'x6' && !block.graph.nodes.length) {
        warnings.push(`${section.id}/${block.id} has no X6 nodes`);
      }
    });
  });
  const visualBlockCount = payload.sections.reduce((sum, section) => sum + (section.visualBlocks?.length || 0), 0);
  const sourceMarkdownLength = payload.sections.reduce((sum, section) => sum + (section.sourceMarkdown?.trim().length || 0), 0);
  const draftLength = payload.markdownDraft.trim().length;
  if (!payload.sections.length) warnings.push('payload has no sections');
  if (!visualBlockCount) warnings.push('payload has no visual blocks');
  if (draftLength > 800 && sourceMarkdownLength < draftLength * 0.65) {
    warnings.push('section sourceMarkdown coverage is much shorter than markdownDraft');
  }
  return {
    schemaVersion: 'visual_explainer.validation.v1',
    valid: warnings.length === 0,
    warnings,
    sectionCount: payload.sections.length,
    visualBlockCount,
    rendererCounts
  };
};

export const normalizeVisualExplainerPayload = (
  context: StudioGenerationContext,
  value: unknown,
  fallbackMarkdown: string
): VisualExplainerPayload => {
  const raw = value && typeof value === 'object' ? value as any : {};
  const markdownDraft = clipMarkdown(extractVisualExplainerMarkdownDraft(raw.markdownDraft || fallbackMarkdown), 30000);
  const fallback = buildFallbackVisualExplainer(context, markdownDraft);
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const sections = rawSections.length ? rawSections : fallback.sections;
  return {
    schemaVersion: 'visual_explainer.v1',
    markdownDraft,
    title: clip(raw.title || fallback.title, 160),
    summary: clip(raw.summary || fallback.summary, 500),
    sections: sections.slice(0, 10).map((section: any, index: number) => {
      const sectionId = clip(section.id || `section-${index + 1}-${slug(section.title || '', 'part')}`, 80);
      const rawObjects = Array.isArray(section.objects) ? section.objects : [];
      const objects: VisualExplainerObject[] = (rawObjects.length ? rawObjects : fallback.sections[index]?.objects || []).slice(0, 10).map((object: any, objectIndex: number) => ({
        id: clip(object.id || `${sectionId}-object-${objectIndex + 1}`, 80),
        kind: VISUAL_OBJECT_KINDS.includes(String(object.kind) as VisualExplainerObjectKind) ? object.kind : 'card',
        label: clip(object.label || object.title || `Object ${objectIndex + 1}`, 100),
        detail: clip(object.detail || object.description || '', 500),
        role: ['main', 'support', 'example', 'warning', 'summary'].includes(String(object.role)) ? object.role : 'support',
        fromId: object.fromId ? clip(object.fromId, 80) : undefined,
        toId: object.toId ? clip(object.toId, 80) : undefined
      }));
      const objectIds = new Set(objects.map((object) => object.id));
      const rawTimeline = Array.isArray(section.timeline) ? section.timeline : [];
      const timeline: VisualExplainerTimelineStep[] = (rawTimeline.length ? rawTimeline : fallback.sections[index]?.timeline || []).slice(0, 8).map((step: any, stepIndex: number) => {
        const targets = Array.isArray(step.targetIds) ? step.targetIds.map((id: unknown) => clip(id, 80)).filter((id: string) => objectIds.has(id)) : [];
        return {
          id: clip(step.id || `${sectionId}-step-${stepIndex + 1}`, 80),
          action: VISUAL_ACTIONS.includes(String(step.action) as VisualExplainerAction) ? step.action : 'focus',
          targetIds: targets.length ? targets : objects.slice(0, 1).map((object) => object.id),
          narration: clip(step.narration || section.narration || section.focus || '', 500),
          screenText: step.screenText ? clip(step.screenText, 120) : undefined,
          durationMs: Number.isFinite(Number(step.durationMs)) ? Math.max(300, Math.min(4000, Number(step.durationMs))) : 900,
          statePatch: step.statePatch && typeof step.statePatch === 'object'
            ? step.statePatch as Record<string, unknown>
            : undefined
        };
      });
      const visualMode: VisualExplainerSection['visualMode'] = VISUAL_MODES.includes(String(section.visualMode) as VisualExplainerSection['visualMode']) ? section.visualMode : 'slide';
      const fallbackBlocks = fallbackBlocksForSection(
        sectionId,
        clip(section.title || `Section ${index + 1}`, 100),
        clip(section.narration || section.focus || '', 1000),
        Array.isArray(section.screenText) ? section.screenText.slice(0, 6).map((item: unknown) => clip(item, 80)) : objects.slice(0, 4).map((object) => object.label),
        visualMode,
        objects,
        timeline
      );
      const visualBlocks = normalizeVisualBlocks(section.visualBlocks, fallbackBlocks);
      const requestedRenderer = VISUAL_RENDERERS.includes(String(section.preferredRenderer) as VisualExplainerRendererKind)
        ? section.preferredRenderer as VisualExplainerRendererKind
        : rendererForVisualMode(visualMode);
      const preferredRenderer = hasRendererBlock(requestedRenderer, visualBlocks)
        ? requestedRenderer
        : rendererFromBlockKind(visualBlocks[0]?.kind || 'markdown');
      const normalizedTitle = clip(section.title || `Section ${index + 1}`, 100);
      const normalizedSourceMarkdown = clipMarkdown(section.sourceMarkdown || section.markdown || fallback.sections[index]?.sourceMarkdown || section.narration || section.focus || '', 6000);
      const normalizedBodyMarkdown = bodyMarkdownForSlide(section.bodyMarkdown || normalizedSourceMarkdown, normalizedTitle);
      return {
        id: sectionId,
        title: normalizedTitle,
        focus: displayFocus(section.focus, section.narration, normalizedTitle),
        sourceHint: section.sourceHint ? clip(section.sourceHint, 160) : undefined,
        sourceMarkdown: normalizedSourceMarkdown,
        bodyMarkdown: normalizedBodyMarkdown,
        visualMode,
        screenText: Array.isArray(section.screenText) ? section.screenText.slice(0, 6).map((item: unknown) => clip(item, 80)) : objects.slice(0, 4).map((object) => object.label),
        narration: clip(section.narration || section.focus || '', 1000),
        objects,
        timeline,
        visualBlocks,
        preferredRenderer,
        checkQuestion: section.checkQuestion ? clip(section.checkQuestion, 240) : undefined
      };
    }),
    rendererPlan: {
      primary: 'section_player',
      libraries: Array.isArray(raw.rendererPlan?.libraries) ? raw.rendererPlan.libraries.slice(0, 6).map((item: unknown) => clip(item, 60)) : fallback.rendererPlan.libraries,
      exportTargets: ['web', 'video', 'pptx']
    },
    visualLesson: raw.visualLesson?.schemaVersion === 'visual_lesson.v1' && Array.isArray(raw.visualLesson?.slides)
      ? raw.visualLesson as VisualLesson
      : undefined
  };
};
