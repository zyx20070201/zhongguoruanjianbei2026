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
  return normalizeVisualExplainerPayload(context, rawPayload, markdownDraft);
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
          durationMs: Number.isFinite(Number(step.durationMs)) ? Math.max(300, Math.min(4000, Number(step.durationMs))) : 900
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
    }
  };
};
