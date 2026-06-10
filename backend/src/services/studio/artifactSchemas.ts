import { StudioArtifactKind, StudioGenerationContext, StudioStructuredArtifact } from './types';
import { createArtifactEnvelope } from './artifactRenderer';
import {
  STUDIO_VISUALIZATION_IR_JSON_SCHEMA,
  normalizeTeachingVisualizationIR,
  validateTeachingVisualizationIR
} from './visualizationIr';
import {
  normalizeVisualCodeLessonPayload,
  normalizeVisualExplainerPayload,
  VISUAL_EXPLAINER_SCHEMA_HINT
} from './visualExplainer';

const clip = (value: string | null | undefined, maxLength = 1200) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

export const inferArtifactKind = (context: StudioGenerationContext): StudioArtifactKind => {
  if (context.template.renderer === 'quiz') return 'quiz';
  if (context.template.renderer === 'mermaid') return 'mind_map';
  if (context.template.renderer === 'flashcards') return 'flashcards';
  if (context.template.renderer === 'code_lab') return 'code_lab';
  if (context.template.renderer === 'slides') return 'slides';
  if (context.template.renderer === 'visual_explainer') return 'visual_explainer';
  if (context.template.renderer === 'interactive_html') return 'interactive_demo';
  if (context.template.renderer === 'manim_script') return 'animation_script';
  if (context.template.renderer === 'remotion_source') return 'ui_video';
  if (context.template.id === 'video_script') return 'video_script';
  if (context.template.id === 'study_plan') return 'study_plan';
  return 'text';
};

const parseJson = (value: string) => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || value;
  try {
    return JSON.parse(raw);
  } catch {
    // Continue with object extraction below for model replies that wrap JSON in prose.
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
};

const sectionsFromMarkdown = (content: string) => {
  const sections: Array<{ title: string; body: string; bullets: string[] }> = [];
  const parts = content.split(/\n(?=##\s+)/g);
  for (const part of parts) {
    const title = part.match(/^##\s+(.+)$/m)?.[1] || (sections.length ? '补充内容' : '核心内容');
    const body = part.replace(/^##\s+.+$/m, '').trim();
    const bullets = body
      .split('\n')
      .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1])
      .filter((item): item is string => Boolean(item))
      .slice(0, 8);
    sections.push({ title: clip(title, 80), body: clip(body, 2200), bullets });
  }
  return sections.length ? sections.slice(0, 12) : [{ title: '核心内容', body: clip(content, 4000), bullets: [] }];
};

const titleFromSourceContext = (context: StudioGenerationContext, fallback: string) =>
  clip(
    context.capsule.citations[0]?.label?.replace(/\.[a-z0-9]+$/i, '').trim() ||
      context.capsule.activeFile?.fileName?.replace(/\.[a-z0-9]+$/i, '').trim() ||
      fallback,
    160
  );

const normalizeQuiz = (context: StudioGenerationContext, content: string) => {
  const parsed = parseJson(content) || {};
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  return createArtifactEnvelope(
    context,
    'quiz',
    {
      questions: questions.map((question: any, index: number) => ({
        id: String(question.id || `q${index + 1}`),
        type: String(question.type || 'short_answer'),
        question: clip(question.question || question.stem || '', 1200),
        options: Array.isArray(question.options)
          ? question.options.slice(0, 4).map((option: any, optionIndex: number) => ({
              id: String(option?.id || ['A', 'B', 'C', 'D'][optionIndex] || '').toUpperCase(),
              text: clip(option?.text || '', 420)
            }))
          : undefined,
        answer: clip(question.answer || '', 600),
        acceptableAnswers: Array.isArray(question.acceptableAnswers) ? question.acceptableAnswers.slice(0, 8) : undefined,
        rubric: clip(question.rubric || question.explanation || '', 1200),
        skill: clip(question.skill || question.learningObjective || '', 160),
        difficulty: ['easy', 'medium', 'hard'].includes(String(question.difficulty)) ? question.difficulty : 'medium',
        explanation: clip(question.explanation || '', 1200),
        hint: clip(question.hint || '', 320),
        conceptId: clip(question.conceptId || question.knowledgePoints?.[0] || question.skill || '', 120),
        objectiveId: clip(question.objectiveId || question.learningObjective || '', 120),
        tier: clip(question.tier || '', 80),
        knowledgePoints: Array.isArray(question.knowledgePoints) ? question.knowledgePoints.slice(0, 8) : [],
        learningObjective: clip(question.learningObjective || '', 400),
        commonMistake: clip(question.commonMistake || '', 400),
        sourceRefs: Array.isArray(question.sourceRefs) ? question.sourceRefs.slice(0, 4) : []
      })).filter((question: any) => question.question),
      questionCount: questions.length
    },
    clip(parsed.title || context.input.prompt || context.template.title, 160),
    '用于定位掌握情况的结构化练习。'
  );
};

const normalizeMindMap = (context: StudioGenerationContext, content: string) => {
  const mermaid = content.match(/```mermaid\s*([\s\S]*?)```/i)?.[1]?.trim();
  const conceptGraphRaw = content.match(/```concept_graph\s*([\s\S]*?)```/i)?.[1]?.trim();
  const conceptGraph = conceptGraphRaw ? parseJson(conceptGraphRaw) : null;
  const outline = (content.match(/##\s*大纲\s*([\s\S]*?)(?:\n##|$)/i)?.[1] || '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*\d.、]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 20);
  return createArtifactEnvelope(
    context,
    'mind_map',
    {
      mermaid: mermaid ? `\`\`\`mermaid\n${mermaid}\n\`\`\`` : '',
      conceptGraph: conceptGraph || { nodes: [], links: [] },
      outline
    },
    context.input.prompt || context.template.title,
    '课程知识结构、概念关系和学习路径。'
  );
};

const looksLikeRawFlashcardRequest = (front: string, context: StudioGenerationContext) => {
  const normalized = front.replace(/\s+/g, '').trim();
  const prompt = String(context.input.prompt || '').replace(/\s+/g, '').trim();
  return Boolean(
    normalized &&
      ((prompt && normalized === prompt) ||
        /^(请|给我|帮我|生成|制作|创建|把).{0,24}(flashcards?|复习卡|抽认卡|卡片|card)/i.test(front))
  );
};

const isValidFlashcardFront = (front: string, context: StudioGenerationContext) => {
  const text = front.replace(/\s+/g, ' ').trim();
  if (!text || looksLikeRawFlashcardRequest(text, context)) return false;
  if (/^(?:#+\s*)?(?:Card|卡片)\s*\d+\s*[:：-]/i.test(text)) return false;
  if (/^(?:第\s*)?\d+\s*(?:张|个)?(?:卡片|Card)\s*[:：-]/i.test(text)) return false;
  if (/(?:速记|复习|基础|进阶|专项)?(?:卡片|Card)$/i.test(text) && !/[?？]|____|\{\{c\d+::/.test(text)) return false;
  if (/^(?:章节|小节|主题|标题|目录|大纲|概览|总结|引言|背景|案例|练习|来源|参考|说明)[:：]/i.test(text)) return false;

  const asksRecall =
    /[?？]/.test(text) ||
    /____|_{2,}|…|\{\{c\d+::/.test(text) ||
    /^(?:什么|为什么|如何|怎样|哪|是否|请|写出|指出|解释|描述|列出|比较|判断|说明|给出|计算|证明|When|What|Why|How|Which|Explain|Describe|List|Compare|Judge|State)\b/i.test(text) ||
    /(?:是什么|有什么作用|如何变化|为什么|哪一|是否|请写出|请指出|请解释|请描述|请列出|请比较|判断.*正误|第一步|关键步骤|最终结果|适用条件|输出什么)/.test(text);
  if (asksRecall) return true;

  const compact = text.replace(/[^\p{L}\p{N}]/gu, '');
  return compact.length >= 18 && /(?:定义|作用|条件|步骤|区别|关系|原因|结果|例子|公式|规则|性质|含义|用途|判断|计算|证明)/.test(text);
};

const cleanFlashcardText = (value: string) =>
  clip(value, 2400)
    .replace(/^\s*(?:Answer|答案)\s*[:：]\s*/i, '')
    .replace(/\n\s*(?:Difficulty|难度)\s*[:：]\s*(?:easy|medium|hard|简单|中等|困难)\s*/gi, '\n')
    .replace(/\n\s*(?:Source|来源)\s*[:：][^\n]*/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const combineAnswerAndExplanation = (answer: unknown, explanation: unknown) => {
  const cleanedAnswer = cleanFlashcardText(String(answer || ''));
  const cleanedExplanation = cleanFlashcardText(String(explanation || ''));
  if (!cleanedExplanation || cleanedAnswer.includes(cleanedExplanation)) return cleanedAnswer;
  return [cleanedAnswer, cleanedExplanation].filter(Boolean).join('\n\n');
};

const normalizeFlashcards = (context: StudioGenerationContext, content: string) => {
  const parsed = parseJson(content);
  const jsonCards = Array.isArray(parsed?.cards) ? parsed.cards : [];
  const cards = jsonCards.length
    ? jsonCards
        .map((card: any, index: number) => ({
          id: String(card.id || `card-${index + 1}`),
          front: clip(card.front || card.question || '', 1000),
          back: combineAnswerAndExplanation(card.back || card.answer || '', card.explanation || ''),
          cardType: ['basic', 'reverse', 'cloze', 'mcq', 'concept'].includes(String(card.cardType)) ? card.cardType : 'basic',
          concept: clip(card.concept || card.knowledgePoint || '', 160),
          difficulty: ['easy', 'medium', 'hard'].includes(String(card.difficulty)) ? card.difficulty : 'medium',
          explanation: '',
          tags: Array.isArray(card.tags) ? card.tags.slice(0, 8).map((tag: unknown) => clip(String(tag), 40)).filter(Boolean) : [],
          sourceRefs: Array.isArray(card.sourceRefs) ? card.sourceRefs.slice(0, 4) : []
        }))
        .filter((card: any) => card.front && card.back && isValidFlashcardFront(card.front, context))
    : content
        .split(/\n##\s+Card\s+\d+/i)
        .slice(1)
        .map((block, index) => ({
          id: `card-${index + 1}`,
          front: clip(block.match(/Front:\s*([\s\S]*?)(?:\nBack:|$)/i)?.[1], 1000),
          back: combineAnswerAndExplanation(
            block.match(/Back:\s*([\s\S]*?)(?:\nConcept:|\nDifficulty:|\nSource:|\nExplanation:|$)/i)?.[1],
            block.match(/Explanation:\s*([\s\S]*?)(?:\nSource:|$)/i)?.[1]
          ),
          concept: clip(block.match(/Concept:\s*([\s\S]*?)(?:\nDifficulty:|\nSource:|$)/i)?.[1], 160),
          difficulty: /Difficulty:\s*hard/i.test(block) ? 'hard' : /Difficulty:\s*easy/i.test(block) ? 'easy' : 'medium',
          explanation: ''
        }))
        .filter((card) => card.front && card.back && isValidFlashcardFront(card.front, context));
  return createArtifactEnvelope(
    context,
    'flashcards',
    { cards, cardCount: cards.length },
    clip(parsed?.title || context.input.prompt || context.template.title, 160),
    clip(parsed?.description || '用于主动回忆和间隔复习的卡片组。', 400)
  );
};

const normalizeCodeLab = (context: StudioGenerationContext, content: string) => {
  const code = content.match(/```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/) || [];
  return createArtifactEnvelope(
    context,
    'code_lab',
    {
      objective: clip(content.match(/##\s*实验目标\s*([\s\S]*?)(?:\n##|$)/i)?.[1] || context.template.promptFrame, 1000),
      steps: (content.match(/##\s*(?:TODO|实验步骤)\s*([\s\S]*?)(?:\n##|$)/i)?.[1] || '')
        .split('\n')
        .map((line) => line.replace(/^\s*[-*\d.、]+\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 12),
      language: code[1] || 'text',
      starterCode: clip(code[2] || '', 4000),
      tests: (content.match(/##\s*(?:测试任务|测试用例)\s*([\s\S]*?)(?:\n##|$)/i)?.[1] || '')
        .split('\n')
        .map((line) => line.replace(/^\s*[-*\d.、]+\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 10),
      debugHints: (content.match(/##\s*调试提示\s*([\s\S]*?)(?:\n##|$)/i)?.[1] || '')
        .split('\n')
        .map((line) => line.replace(/^\s*[-*\d.、]+\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 10)
    },
    context.input.prompt || context.template.title,
    '可操作的代码实操案例。'
  );
};

const normalizeSlides = (context: StudioGenerationContext, content: string) => {
  const slides = content.split(/\n---+\n/g).map((block, index) => ({
    id: `slide-${index + 1}`,
    title: clip(block.match(/^#\s+(.+)$/m)?.[1] || block.match(/^##\s+(.+)$/m)?.[1] || `Slide ${index + 1}`, 100),
    bullets: block
      .split('\n')
      .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1])
      .filter((item): item is string => Boolean(item))
      .slice(0, 8),
    notes: clip(block.match(/Notes:\s*([\s\S]*?)(?:\nVisual:|$)/i)?.[1], 800),
    visual: clip(block.match(/Visual:\s*([\s\S]*?)$/i)?.[1], 500)
  }));
  return createArtifactEnvelope(
    context,
    'slides',
    { slides, slideCount: slides.length },
    context.input.prompt || context.template.title,
    '可转成课件的结构化幻灯片。'
  );
};

const normalizeVisualExplainer = (context: StudioGenerationContext, content: string) => {
  const parsed = parseJson(content);
  if (parsed?.schemaVersion === 'visual_code_lesson.v1') {
    const selectedSourceIds = context.capsule.citations
      .map((citation) => citation.sourceId)
      .filter((id): id is string => Boolean(id));
    const payload = normalizeVisualCodeLessonPayload(
      context,
      parsed,
      context.input.prompt || context.template.title,
      selectedSourceIds.length ? selectedSourceIds : Array.isArray(parsed.sourceIds) ? parsed.sourceIds : []
    );
    return createArtifactEnvelope(
      context,
      'visual_explainer',
      payload as unknown as Record<string, unknown>,
      payload.title || context.input.prompt || context.template.title,
      payload.summary || '包含讲解文本和可执行前端可视化代码块的视觉化课程。'
    );
  }
  const payload = normalizeVisualExplainerPayload(context, parsed, content);
  return createArtifactEnvelope(
    context,
    'visual_explainer',
    {
      ...payload,
      schemaHint: VISUAL_EXPLAINER_SCHEMA_HINT
    },
    payload.title || context.input.prompt || context.template.title,
    payload.summary || 'Markdown-first 的分镜式视觉讲解。'
  );
};

const normalizeVideoScript = (context: StudioGenerationContext, content: string) => {
  const scenes = content
    .split('\n')
    .filter((line) => /^\|.+\|$/.test(line) && !/---/.test(line) && !/时间\s*\|/.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()).filter(Boolean))
    .map((cells, index) => ({
      id: `scene-${index + 1}`,
      time: cells[0] || '',
      visual: cells[1] || '',
      narration: cells[2] || '',
      interaction: cells[3] || ''
    }));
  return createArtifactEnvelope(
    context,
    'video_script',
    { scenes, sceneCount: scenes.length },
    context.input.prompt || context.template.title,
    '教学视频或动画脚本。'
  );
};

const normalizeInteractiveDemo = (context: StudioGenerationContext, content: string) => {
  const visualization = normalizeTeachingVisualizationIR(context, parseJson(content), content);
  const contract = validateTeachingVisualizationIR(visualization);
  const controls = [
    { id: 'speed', label: 'Speed / 速度', type: 'range', min: 1, max: 8, defaultValue: 3 },
    { id: 'parameter', label: 'Parameter / 参数', type: 'range', min: 20, max: 180, defaultValue: 90 },
    { id: 'step', label: 'Next step / 下一步', type: 'button' }
  ];
  return createArtifactEnvelope(
    context,
    'interactive_demo',
    {
      framework: 'p5.js',
      interactionModel: 'parameterized-step-playback',
      controls,
      states: ['输入状态', '关键判断', '状态更新', '输出/复盘'],
      teachingPlan: visualization.teachingPlan,
      processTrace: visualization.processTrace,
      visualMapping: visualization.visualMapping,
      irSchema: STUDIO_VISUALIZATION_IR_JSON_SCHEMA,
      irContract: contract,
      observationQuestions: [
        '参数变化时，哪些状态最先发生改变？',
        '下一步为什么成立？',
        '哪些边界条件会导致演示结果不同？'
      ],
      designBrief: clip(content, 3200),
      requiredChecks: ['html-loads', 'has-controls', 'has-animation-loop', 'has-source-notes']
    },
    context.input.prompt || context.template.title,
    '可在浏览器中运行的参数化交互演示。'
  );
};

const normalizeAnimationScript = (context: StudioGenerationContext, content: string) => {
  const visualization = normalizeTeachingVisualizationIR(context, parseJson(content), content);
  const contract = validateTeachingVisualizationIR(visualization);
  return createArtifactEnvelope(
    context,
    'animation_script',
    {
      framework: 'Manim',
      sceneClass: 'AIStudioExplanation',
      targetOutput: 'mp4',
      teachingPlan: visualization.teachingPlan,
      processTrace: visualization.processTrace,
      visualMapping: visualization.visualMapping,
      irSchema: STUDIO_VISUALIZATION_IR_JSON_SCHEMA,
      irContract: contract,
      timeline: [
        { label: '引入主题', seconds: 3 },
        { label: '展示坐标/状态对象', seconds: 4 },
        { label: '动画演示关键变化', seconds: 6 },
        { label: '总结检查问题', seconds: 3 }
      ],
      sourcePlan: clip(content, 3200),
      renderCommand: 'manim -pqh visualize-manim-animation.py AIStudioExplanation',
      requiredChecks: ['python-syntax', 'manim-cli-available', 'mp4-output']
    },
    context.input.prompt || context.template.title,
    '用于算法、数学或物理过程讲解的 Manim 动画脚本。'
  );
};

const normalizeUiVideo = (context: StudioGenerationContext, content: string) => {
  const visualization = normalizeTeachingVisualizationIR(context, parseJson(content), content);
  const contract = validateTeachingVisualizationIR(visualization);
  return createArtifactEnvelope(
    context,
    'ui_video',
    {
      framework: 'Remotion',
      componentName: 'AIStudioVideo',
      targetOutput: 'mp4',
      composition: { width: 1920, height: 1080, fps: 30, durationSeconds: 9 },
      teachingPlan: visualization.teachingPlan,
      processTrace: visualization.processTrace,
      visualMapping: visualization.visualMapping,
      irSchema: STUDIO_VISUALIZATION_IR_JSON_SCHEMA,
      irContract: contract,
      storyboard: [
        { label: '标题引入', seconds: 3 },
        { label: '关键知识卡片', seconds: 4 },
        { label: '下一步行动', seconds: 2 }
      ],
      sourcePlan: clip(content, 3200),
      requiredChecks: ['tsx-source', 'remotion-cli-available', 'mp4-output']
    },
    context.input.prompt || context.template.title,
    '用于学习报告、知识总结或课程介绍的 UI 风格视频源码。'
  );
};

const normalizeStudyPlan = (context: StudioGenerationContext, content: string) => {
  const parentPlan = context.enrichment?.parentPlan as any;
  const parsed = parseJson(content);
  const parentSteps = Array.isArray(parentPlan?.steps) ? parentPlan.steps : [];
  const tasks = Array.isArray(parsed?.tasks)
    ? parsed.tasks
    : [
        {
          day: '今天',
          title: '对齐父规划下一步',
          action: parentSteps[0]?.title || '阅读当前资料并标出目标知识点、薄弱点和待验证问题。',
          resources: parentPlan?.candidateResources?.[0]?.title || '当前 Workbench 资料',
          acceptance: '能说清当前任务对应父规划中的哪个目标，并列出 2 个检查问题。',
          feedback: '把完成情况回写为学习事件，用于更新下一轮推荐。'
        },
        {
          day: '第 2 天',
          title: '生成学习资源并完成自测',
          action: '生成讲解/思维导图/诊断题中的一种，并完成一次自测。',
          resources: 'AI Studio 当前生成资源',
          acceptance: '至少完成 1 个资源和 1 次自测，记录错因。',
          feedback: '若错因集中，继续生成错因专项或 Flashcards。'
        },
        {
          day: '第 3 天',
          title: '复盘并决定是否回到父规划',
          action: '复盘薄弱点变化，决定推进父规划下一步或继续局部补强。',
          resources: 'Studio Artifact + Workspace 父规划',
          acceptance: '输出一段复盘：掌握了什么、还卡在哪里、下一步做什么。',
          feedback: '把复盘作为 learner state 证据。'
        }
      ];
  return createArtifactEnvelope(
    context,
    'study_plan',
    {
      objective: clip(parsed?.objective || context.input.prompt || context.template.promptFrame, 240),
      parentPlan: parentPlan || null,
      tasks: tasks.slice(0, 12).map((task: any, index: number) => ({
        id: String(task.id || `task-${index + 1}`),
        day: clip(task.day || task.time || `Step ${index + 1}`, 80),
        title: clip(task.title || `学习任务 ${index + 1}`, 160),
        action: clip(task.action || task.description || '', 800),
        resources: clip(task.resources || task.resource || '', 400),
        acceptance: clip(task.acceptance || task.acceptanceCriteria || task.check || '', 500),
        feedback: clip(task.feedback || task.writeback || '', 400)
      })),
      risks: Array.isArray(parsed?.risks)
        ? parsed.risks.slice(0, 8).map((item: any) => clip(item, 260))
        : ['如果诊断题错误集中，暂停推进父规划，先生成易错点讲解和分层练习。'],
      reflectionQuestions: Array.isArray(parsed?.reflectionQuestions)
        ? parsed.reflectionQuestions.slice(0, 8).map((item: any) => clip(item, 260))
        : ['今天的任务对应父规划哪个目标？', '哪个薄弱点有证据显示正在改善？', '下一步应该推进还是补强？']
    },
    context.input.prompt || context.template.title,
    '从 Workspace 战略规划派生出的当前 Workbench 战术子规划。'
  );
};

export const normalizeStudioArtifact = (
  context: StudioGenerationContext,
  content: string,
  existing?: StudioStructuredArtifact | null
): StudioStructuredArtifact => {
  if (existing?.schemaVersion === 'studio_artifact.v1') return existing;
  const kind = inferArtifactKind(context);
  if (kind === 'quiz') return normalizeQuiz(context, content);
  if (kind === 'mind_map') return normalizeMindMap(context, content);
  if (kind === 'flashcards') return normalizeFlashcards(context, content);
  if (kind === 'code_lab') return normalizeCodeLab(context, content);
  if (kind === 'slides') return normalizeSlides(context, content);
  if (kind === 'visual_explainer') return normalizeVisualExplainer(context, content);
  if (kind === 'video_script') return normalizeVideoScript(context, content);
  if (kind === 'interactive_demo') return normalizeInteractiveDemo(context, content);
  if (kind === 'animation_script') return normalizeAnimationScript(context, content);
  if (kind === 'ui_video') return normalizeUiVideo(context, content);
  if (kind === 'study_plan') return normalizeStudyPlan(context, content);
  if (context.template.id === 'resource_to_notes' || context.template.id === 'pagelm_cornell_notes' || context.template.id === 'pure_markdown_notes') {
    return createArtifactEnvelope(
      context,
      kind,
      {
        sections: sectionsFromMarkdown(content),
        rawContent: content
      },
      titleFromSourceContext(
        context,
        context.template.id === 'pagelm_cornell_notes'
          ? 'PageLM Notes'
          : context.template.id === 'pure_markdown_notes'
            ? 'Pure Markdown Notes'
            : 'Resource Notes'
      ),
      context.template.id === 'pagelm_cornell_notes'
        ? '可保存为 BlockSuite Note 的 Cornell-style 资源学习笔记。'
        : context.template.id === 'pure_markdown_notes'
          ? '可保存为 BlockSuite Note 的纯 Markdown 资源学习笔记。'
          : '可保存为 BlockSuite Note 的资源学习笔记。'
    );
  }
  if (context.template.id === 'resource_compare') {
    return createArtifactEnvelope(
      context,
      kind,
      {
        sections: sectionsFromMarkdown(content),
        rawContent: content
      },
      'Resource Compare',
      '不同学习资源之间的覆盖、差异、互补和缺口分析。'
    );
  }
  return createArtifactEnvelope(
    context,
    kind,
    {
      sections: sectionsFromMarkdown(content),
      rawContent: content
    },
    context.input.prompt || context.template.title,
    context.template.description
  );
};
