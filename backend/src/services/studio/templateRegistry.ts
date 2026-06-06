import { StudioGoalCategory, StudioResourceTemplate } from './types';

export const STUDIO_GOALS: Array<{
  id: StudioGoalCategory;
  zh: string;
  en: string;
  description: string;
}> = [
  { id: 'understand', zh: '资源理解', en: 'Resource Understand', description: '把上传资源转成可编辑笔记，或对比不同资源之间的观点、结构和差异。' },
  { id: 'map', zh: '梳理知识', en: 'Map', description: '思维导图、知识图谱和概念关系。' },
  { id: 'practice', zh: '巩固练习', en: 'Practice', description: '按用户要求从选定资源生成练习题。' },
  { id: 'review', zh: '复习记忆', en: 'Review', description: 'Flashcards、速记清单、复习计划和回忆提示。' },
  { id: 'lab', zh: '动手实操', en: 'Lab', description: 'Code Lab、Starter Code、Debug Task 和实验步骤。' },
  { id: 'visualize', zh: '可视化学习', en: 'Visualize', description: 'Slide、Video Script、Animation Script 和信息图脚本。' },
  { id: 'plan', zh: '学习规划', en: 'Plan', description: '学习计划、每日任务、阶段验收和复盘报告。' },
];

export const STUDIO_TEMPLATES: StudioResourceTemplate[] = [
  {
    id: 'resource_to_notes',
    goal: 'understand',
    title: 'Resource to BlockSuite Notes',
    shortTitle: 'Resource Notes',
    description: '把用户上传或选定的 sources 转成结构清晰、可继续编辑的 Markdown 学习笔记。',
    generator: 'text',
    renderer: 'markdown',
    format: 'md',
    filename: 'resource-understand-notes.md',
    outputLabel: 'BlockSuite Markdown Notes',
    legacyResourceType: 'report',
    promptFrame: '把选定资源转成可编辑 Markdown 笔记，保留标题层级、关键概念、步骤、例子和来源依据。',
    systemInstruction:
      '把选定 sources 整理成可直接粘贴到 BlockSuite Notes 的 Markdown 笔记。必须包含：标题、资源摘要、结构化大纲、关键概念、重要步骤/公式/例子、待确认问题和来源说明。不要写成泛泛讲解，要忠实转写和组织资源内容。',
    defaultOptions: { detail: 'standard', output: 'blocksuite_markdown_notes' },
    tags: ['resource-notes', 'blocksuite', 'source-grounded'],
    recommendedUse: '需要把资料沉淀成可编辑笔记时使用。',
    recommendationRules: [
      { id: 'source-notes', reason: '当前上下文包含可整理的来源资料，适合先转成笔记。', priority: 70, when: ['has_sources'] }
    ]
  },
  {
    id: 'pagelm_cornell_notes',
    goal: 'understand',
    title: 'PageLM-style Cornell Notes',
    shortTitle: 'PageLM Notes',
    description: '用 Cornell-style 结构把用户选定 sources 整理成高密度学习笔记，便于先试验 PageLM 风格效果。',
    generator: 'text',
    renderer: 'markdown',
    format: 'md',
    filename: 'resource-understand-pagelm-notes.md',
    outputLabel: 'PageLM-style Cornell Notes',
    legacyResourceType: 'report',
    promptFrame: '把选定资源整理成 Cornell-style 学习笔记：主题、详细笔记、总结、复习问题和对应答案。',
    systemInstruction:
      '只基于用户选定 sources 生成 Cornell-style 学习笔记。输出应包含：标题、详细笔记、简明总结、复习问题和对应答案。问题和答案必须一一对应，内容要服务于理解和复习，不要混入未选择来源。',
    defaultOptions: { output: 'cornell_markdown_notes', sourceScope: 'selected_resources_only' },
    tags: ['pagelm-style', 'cornell-notes', 'source-grounded'],
    recommendedUse: '想试验 PageLM SmartNotes 风格整理效果时使用。',
    recommendationRules: [
      { id: 'pagelm-notes', reason: '当前上下文包含可整理的来源资料，可试用 Cornell-style 笔记。', priority: 68, when: ['has_sources'] }
    ]
  },
  {
    id: 'pure_markdown_notes',
    goal: 'understand',
    title: 'Pure Markdown Notes',
    shortTitle: 'Pure Markdown',
    description: '只把用户勾选 source 全文和用户要求直接交给模型，生成 Markdown 学习笔记。',
    generator: 'text',
    renderer: 'markdown',
    format: 'md',
    filename: 'resource-understand-pure-markdown-notes.md',
    outputLabel: 'Pure Markdown Notes',
    legacyResourceType: 'report',
    promptFrame: '根据用户勾选的资源全文，直接整理成 Markdown 学习笔记。',
    systemInstruction:
      '只使用用户勾选的资源全文和用户文字要求，直接生成 Markdown 学习笔记；不要使用 AI Studio 通用上下文、检索摘要或学习者画像。',
    defaultOptions: { output: 'pure_markdown_notes', sourceScope: 'selected_resources_only' },
    tags: ['pure-markdown', 'source-fulltext', 'source-grounded'],
    recommendedUse: '想测试“全文直接喂给模型整理笔记”的最小链路效果时使用。',
    recommendationRules: [
      { id: 'pure-markdown-notes', reason: '当前上下文包含可整理的来源资料，可直接用全文生成 Markdown 笔记。', priority: 69, when: ['has_sources'] }
    ]
  },
  {
    id: 'resource_compare',
    goal: 'understand',
    title: 'Resource Compare',
    shortTitle: 'Resource Compare',
    description: '对比不同资源之间的主题覆盖、观点差异、结构差异、互补信息和冲突点。',
    generator: 'text',
    renderer: 'markdown',
    format: 'md',
    filename: 'resource-understand-compare.md',
    outputLabel: '资源对比分析',
    promptFrame: '对比选定资源，说明它们分别覆盖什么、互相补充什么、哪里说法不同、应该如何合并学习。',
    systemInstruction:
      '生成资源对比分析。必须包含：资源列表、对比维度表、共同点、差异点、冲突或缺口、推荐阅读顺序、合并后的学习笔记骨架和来源说明。重点比较不同 sources，不要只做单一概念讲解。',
    defaultOptions: { format: 'resource_comparison_table' },
    tags: ['resource-compare', 'comparison', 'source-grounded'],
    recommendationRules: [
      { id: 'multi-source-compare', reason: '当前资料适合做资源对比，帮助识别互补内容和差异。', priority: 64, when: ['has_sources'] }
    ]
  },
  {
    id: 'mind_map',
    goal: 'map',
    title: '知识点思维导图',
    shortTitle: '思维导图',
    description: '把当前主题整理成层级清晰、关系可追踪的 Mermaid 思维导图。',
    generator: 'structure',
    renderer: 'mermaid',
    format: 'md',
    filename: 'map-mind-map.md',
    outputLabel: '知识点思维导图',
    legacyResourceType: 'mind_map',
    promptFrame: '把当前主题组织成中心主题、一级分支、关键概念、易错点、应用例子和复习抓手。',
    systemInstruction:
      [
        '生成一张学习者可直接复习的 Mermaid mindmap，并补充 concept_graph JSON、层级大纲和来源说明。',
        'mindmap 只表达层级结构：中心主题下保留 4-6 个一级分支，每个分支下放 2-4 个短节点，覆盖定义/条件、结构关系、方法步骤、例子应用、易错点和复习抓手。',
        'concept_graph 表达横向关系：从 mindmap 节点中抽取 8-18 个概念点，links 标出 contains/prerequisite/contrast/supports/applies_to/pitfall/remediation 等关系。',
        '节点必须是概念、动作或判断规则，不要把来源编号、文件名、页码、章节号当节点；来源只写在“来源说明”。'
      ].join('\n'),
    defaultOptions: { branchCount: 5, includeConceptGraph: true },
    tags: ['mindmap', 'concept-graph', 'review-map'],
    recommendationRules: [
      { id: 'source-map', reason: '当前资料较多，先梳理结构能降低后续学习负担。', priority: 66, when: ['has_sources'] },
      { id: 'visual-map', reason: '学习偏好包含视觉化表达，适合生成思维导图。', priority: 72, when: ['visual_preference'] }
    ]
  },
  {
    id: 'knowledge_graph',
    goal: 'map',
    title: '知识图谱',
    shortTitle: '知识图谱',
    description: '把概念、前置关系、依赖关系和易混关系整理成可视化知识网络。',
    generator: 'structure',
    renderer: 'mermaid',
    format: 'md',
    filename: 'map-knowledge-graph.md',
    outputLabel: '知识图谱',
    promptFrame: '从当前资料抽取核心概念、前置依赖、因果/包含/对比关系，并生成 concept_graph。',
    systemInstruction:
      '生成知识图谱。必须包含 Mermaid mindmap、concept_graph JSON、关键关系说明、学习路径建议和来源说明。',
    tags: ['knowledge-graph', 'concept-graph', 'relationship'],
    recommendationRules: [
      { id: 'source-graph', reason: '当前资料较多，适合抽取知识图谱帮助建立概念关系。', priority: 64, when: ['has_sources'] },
      { id: 'weak-graph', reason: '薄弱点可能来自概念关系不清，适合生成知识图谱。', priority: 58, when: ['weak_knowledge'] }
    ]
  },
  {
    id: 'custom_practice',
    goal: 'practice',
    title: 'Custom Practice',
    shortTitle: 'Practice',
    description: '根据用户输入的题型、数量、难度和来源范围生成练习。',
    generator: 'assessment',
    renderer: 'quiz',
    format: 'json',
    filename: 'practice-custom-quiz.json',
    outputLabel: '练习题',
    legacyResourceType: 'quiz',
    promptFrame: '根据用户要求生成练习题，优先遵循题型、数量、难度和选定 sources。',
    systemInstruction:
      '生成一套可交互练习题。必须优先遵循用户指定的题型、数量、难度和来源范围。题目必须有 skill、difficulty、answer、rubric、explanation、knowledgePoints、commonMistake 和 sourceRefs。',
    defaultOptions: { questionCount: 6, difficulty: 'adaptive', questionTypes: ['single_choice', 'fill_blank', 'short_answer'] },
    tags: ['practice', 'quiz', 'custom'],
    recommendationRules: [
      { id: 'custom-practice', reason: '当前资料可以用于生成自定义练习。', priority: 60, when: ['has_sources'] }
    ]
  },
  {
    id: 'flashcards',
    goal: 'review',
    title: 'Flashcards',
    shortTitle: 'Flashcards',
    description: '生成主动回忆卡片，用于间隔复习。',
    generator: 'memory',
    renderer: 'flashcards',
    format: 'md',
    filename: 'review-flashcards.md',
    outputLabel: 'Flashcards',
    legacyResourceType: 'flashcards',
    promptFrame: '把关键概念、步骤、对比、易错点转成主动回忆卡片。',
    systemInstruction:
      '生成结构化 flashcard 卡组。每张卡包含 front、back、concept、difficulty、explanation、sourceRefs。',
    defaultOptions: { cardCount: 16, cardTypes: ['basic', 'concept', 'cloze'] },
    tags: ['memory', 'spaced-repetition'],
    recommendationRules: [
      { id: 'review-pressure', reason: '存在复习压力或遗忘风险，适合生成 Flashcards。', priority: 88, when: ['review_pressure'] },
      { id: 'weak-review', reason: '薄弱点需要反复回忆巩固，适合转成卡片。', priority: 68, when: ['weak_knowledge'] }
    ]
  },
  {
    id: 'quick_review_sheet',
    goal: 'review',
    title: '速记清单',
    shortTitle: '速记',
    description: '生成考前或课后快速回忆清单。',
    generator: 'memory',
    renderer: 'markdown',
    format: 'md',
    filename: 'review-quick-sheet.md',
    outputLabel: '速记清单',
    promptFrame: '把当前知识压缩成定义、公式/步骤、易错提醒和自测提示。',
    systemInstruction:
      '生成速记清单。必须短、可回忆、分组明确，包含最后 5 分钟检查项。',
    tags: ['review', 'checklist'],
    recommendationRules: [
      { id: 'review-sheet', reason: '复习压力较高，适合生成短清单快速巩固。', priority: 76, when: ['review_pressure'] }
    ]
  },
  {
    id: 'review_plan',
    goal: 'review',
    title: '复习计划',
    shortTitle: '复习计划',
    description: '根据当前资料、薄弱点和复习压力生成间隔复习计划。',
    generator: 'memory',
    renderer: 'markdown',
    format: 'md',
    filename: 'review-plan.md',
    outputLabel: '复习计划',
    promptFrame: '把当前知识点拆成复习单元，安排今日、三日、一周的复习任务和自测方式。',
    systemInstruction:
      '生成复习计划。必须包含复习目标、任务安排、间隔复习节奏、自测题建议、错题回看和复盘记录格式。',
    defaultOptions: { horizonDays: 7, difficulty: 'adaptive' },
    tags: ['review-plan', 'spaced-repetition', 'schedule'],
    recommendationRules: [
      { id: 'review-plan-pressure', reason: '存在复习压力，适合生成可执行复习计划。', priority: 82, when: ['review_pressure'] },
      { id: 'weak-review-plan', reason: '薄弱点需要持续回看，适合安排间隔复习。', priority: 60, when: ['weak_knowledge'] }
    ]
  },
  {
    id: 'code_lab',
    goal: 'lab',
    title: 'Code Lab',
    shortTitle: 'Code Lab',
    description: '生成代码实操案例、步骤、Starter Code 和测试任务。',
    generator: 'code_lab',
    renderer: 'code_lab',
    format: 'md',
    filename: 'lab-code-lab.md',
    outputLabel: '代码类实操案例',
    promptFrame: '围绕当前主题设计一个可操作的代码实验，包含目标、步骤、Starter Code、测试用例和反思问题。',
    systemInstruction:
      '生成 Code Lab。必须包含实验目标、背景、Starter Code、TODO、测试用例、调试提示、验收标准和扩展任务。',
    defaultOptions: { language: 'auto', difficulty: 'adaptive' },
    tags: ['code', 'lab', 'hands-on'],
    recommendationRules: [
      { id: 'code-context', reason: '当前上下文包含代码或算法实操内容，适合生成 Code Lab。', priority: 84, when: ['code_context'] }
    ]
  },
  {
    id: 'debug_task',
    goal: 'lab',
    title: 'Debug Task',
    shortTitle: 'Debug',
    description: '生成带错误代码和调试任务的实操材料。',
    generator: 'code_lab',
    renderer: 'code_lab',
    format: 'md',
    filename: 'lab-debug-task.md',
    outputLabel: 'Debug 实操任务',
    promptFrame: '设计一个带常见错误的调试任务，要求学生定位、解释并修复。',
    systemInstruction:
      '生成 Debug Task。必须包含错误现象、错误代码、调试线索、修复目标、参考答案和反思问题。',
    tags: ['debug', 'lab'],
    recommendationRules: [
      { id: 'debug-weak', reason: '学生可能在实操迁移上存在困难，适合用 Debug Task 暴露误区。', priority: 64, when: ['weak_knowledge', 'code_context'] }
    ]
  },
  {
    id: 'visual_explainer',
    goal: 'visualize',
    title: 'Visual Explainer',
    shortTitle: '视觉讲解',
    description: '先生成完整 Markdown 答案，再切成讲解分镜，并为每个分镜生成可播放的局部动画步骤。',
    generator: 'multimodal',
    renderer: 'visual_explainer',
    format: 'md',
    filename: 'visualize-visual-explainer.md',
    outputLabel: '视觉讲解动画',
    promptFrame: '把问题回答成一个可播放的视觉讲解：先给完整 Markdown 答案，再拆分 section 分镜，并设计每个分镜内部的动画步骤。',
    systemInstruction:
      '生成通用视觉讲解资源。先保证 Markdown 答案完整、准确、结构清楚；再把答案拆成 4-7 个 section 分镜；每个 section 必须聚焦一个讲解目标，并包含 screenText、narration、visual objects、timeline steps 和可选检查问题。不要只做标题切分，要按语义和讲解节奏切分。',
    defaultOptions: { sectionCount: 5, animationDepth: 'lightweight', rendererFamily: 'slides+motion' },
    tags: ['visual-explainer', 'markdown-first', 'storyboard', 'animation'],
    recommendationRules: [
      { id: 'visual-explainer-general', reason: '该主题适合从纯文字回答升级为分镜式视觉讲解。', priority: 86, when: ['visual_preference'] },
      { id: 'visual-explainer-source', reason: '当前资料可以先沉淀 Markdown，再转成可播放讲解。', priority: 74, when: ['has_sources'] }
    ]
  },
  {
    id: 'slide_deck',
    goal: 'visualize',
    title: 'Slide Deck',
    shortTitle: 'Slide',
    description: '生成可转成课件的 Markdown slide deck。',
    generator: 'multimodal',
    renderer: 'slides',
    format: 'md',
    filename: 'visualize-slide-deck.md',
    outputLabel: '多模态课件',
    legacyResourceType: 'slide_deck',
    promptFrame: '把当前主题转成自学或展示用幻灯片，包含讲者备注和视觉建议。',
    systemInstruction:
      '生成 Markdown slide deck，用 --- 分隔页面。每页必须有标题、要点、讲者备注和可视化建议。',
    tags: ['slide', 'multimodal'],
    recommendationRules: [
      { id: 'visual-slide', reason: '视觉化表达有助于当前主题学习，适合生成课件。', priority: 68, when: ['visual_preference'] }
    ]
  },
  {
    id: 'video_script',
    goal: 'visualize',
    title: 'Video Script',
    shortTitle: '视频脚本',
    description: '生成教学视频或动画脚本，不直接渲染视频。',
    generator: 'multimodal',
    renderer: 'markdown',
    format: 'md',
    filename: 'visualize-video-script.md',
    outputLabel: '教学视频脚本',
    promptFrame: '生成一段 3-5 分钟教学视频脚本，包含镜头、旁白、板书和动画提示。',
    systemInstruction:
      '生成教学视频脚本。必须包含分镜、旁白、视觉元素、动画提示、停顿互动和来源说明。',
    tags: ['video-script', 'animation'],
    recommendationRules: [
      { id: 'visual-video', reason: '该主题适合用过程动画解释，建议生成视频脚本。', priority: 60, when: ['visual_preference'] }
    ]
  },
  {
    id: 'interactive_demo',
    goal: 'visualize',
    title: 'Interactive Demo',
    shortTitle: '交互演示',
    description: '生成可在浏览器中打开的 p5.js 交互式学习演示。',
    generator: 'multimodal',
    renderer: 'interactive_html',
    format: 'md',
    filename: 'visualize-interactive-demo.html',
    outputLabel: '网页交互演示',
    promptFrame: '围绕当前主题生成一个可交互演示，包含参数控制、逐步播放、说明和来源依据。',
    systemInstruction:
      '生成网页交互演示设计稿。优先适配算法、数学函数、物理运动、几何变化等主题。必须包含交互控件、动画状态、观察问题和来源说明。',
    tags: ['p5.js', 'interactive', 'simulation', 'visualization'],
    recommendationRules: [
      { id: 'visual-interactive', reason: '该主题适合用可调参数或逐步播放来观察变化。', priority: 72, when: ['visual_preference'] },
      { id: 'code-interactive', reason: '当前上下文包含算法或代码内容，适合生成交互式演示。', priority: 78, when: ['code_context'] }
    ]
  },
  {
    id: 'algorithm_animation',
    goal: 'visualize',
    title: 'Algorithm / STEM Animation',
    shortTitle: '动画脚本',
    description: '生成 Manim 动画源码，用于算法、数学、物理过程讲解。',
    generator: 'multimodal',
    renderer: 'manim_script',
    format: 'md',
    filename: 'visualize-manim-animation.py',
    outputLabel: 'Manim 动画脚本',
    promptFrame: '把当前主题转成 Manim 场景，展示排序、公式推导、函数变化、几何关系或物理运动轨迹。',
    systemInstruction:
      '生成可运行的 Manim Community Python 脚本。必须包含 Scene 类、坐标/对象/箭头/步骤文本、动画时间线和运行说明。',
    tags: ['manim', 'animation', 'math', 'physics', 'algorithm'],
    recommendationRules: [
      { id: 'visual-manim', reason: '当前主题适合用连续动画展示过程变化。', priority: 74, when: ['visual_preference'] },
      { id: 'code-manim', reason: '算法或公式类内容适合生成 Manim 讲解动画。', priority: 76, when: ['code_context'] }
    ]
  },
  {
    id: 'ui_video',
    goal: 'visualize',
    title: 'UI Style Video',
    shortTitle: 'UI 视频',
    description: '生成 Remotion React 视频源码，适合卡片式知识总结、学习报告视频和课程介绍。',
    generator: 'multimodal',
    renderer: 'remotion_source',
    format: 'md',
    filename: 'visualize-remotion-video.tsx',
    outputLabel: 'Remotion 视频源码',
    promptFrame: '把当前主题转成可用 Remotion 渲染的 React 视频片段，包含镜头、字幕、卡片和时间轴。',
    systemInstruction:
      '生成 Remotion React 源码。必须包含组件、Sequence、字幕文本、卡片布局、配色建议和渲染说明。',
    tags: ['remotion', 'react-video', 'ui-video'],
    recommendationRules: [
      { id: 'visual-remotion', reason: '适合把知识点总结成动态页面式视频。', priority: 58, when: ['visual_preference'] }
    ]
  },
  {
    id: 'study_plan',
    goal: 'plan',
    title: '学习计划',
    shortTitle: '学习计划',
    description: '生成个性化阶段计划、每日任务和复盘方式。',
    generator: 'planning',
    renderer: 'markdown',
    format: 'md',
    filename: 'plan-study-plan.md',
    outputLabel: '学习计划',
    promptFrame: '根据目标、资料和薄弱点生成可执行学习计划。',
    systemInstruction:
      '生成学习计划。必须包含目标、时间安排、每日任务、资源建议、验收标准、复盘问题和风险调整策略。',
    tags: ['plan', 'schedule'],
    recommendationRules: [
      { id: 'thin-plan', reason: '当前学习路径不够明确，适合先生成计划。', priority: 52, when: ['thin_evidence'] }
    ]
  },
];

const CURRENT_TEMPLATE_VERSION = '1.0.0';
const versionedTemplates = STUDIO_TEMPLATES.map((template) => ({
  ...template,
  version: template.version || CURRENT_TEMPLATE_VERSION
}));

const byId = new Map(versionedTemplates.map((template) => [template.id, template]));

export const studioTemplateRegistry = {
  list(goal?: StudioGoalCategory) {
    return goal ? versionedTemplates.filter((template) => template.goal === goal) : versionedTemplates;
  },

  listGoals() {
    return STUDIO_GOALS;
  },

  get(id: string) {
    return byId.get(id) || null;
  },

  getByLegacyResourceType(resourceType: string) {
    return versionedTemplates.find((template) => template.legacyResourceType === resourceType) || null;
  }
};
