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
  if (context.template.renderer === 'light_visual_lesson') return 'light_visual_lesson';
  if (context.template.renderer === 'visual_explainer') return 'visual_explainer';
  if (context.template.renderer === 'interactive_html') return 'interactive_demo';
  if (context.template.renderer === 'hyperframes_composition') return 'hyperframes_video';
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

const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const stringArray = (value: unknown, max = 8) =>
  Array.isArray(value)
    ? value.map((item) => clip(String(item), 500)).filter(Boolean).slice(0, max)
    : [];

const codeLabFallbackPayload = (context: StudioGenerationContext) => {
  const topic = clip(context.input.prompt || context.template.promptFrame || context.template.title, 220);
  return {
    problem: {
      statementMarkdown: [
        `围绕「${topic}」完成一个可运行的代码练习。`,
        '',
        '实现一个程序：从标准输入读取若干整数，输出它们的和。这个默认题面用于生成失败时保持 Code Lab 可运行；重新生成后会替换为更贴合资料的题目。'
      ].join('\n'),
      examples: [
        { input: '1 2 3\n', output: '6', explanation: '读取 1、2、3，和为 6。' }
      ],
      constraints: ['输入只包含整数。', '输出一个整数并换行。']
    },
    editor: {
      language: 'javascript',
      starterCode: [
        "const fs = require('fs');",
        "const nums = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).filter(Boolean).map(Number);",
        '',
        '// TODO: replace the placeholder implementation with your solution.',
        'const answer = nums.reduce((sum, value) => sum + value, 0);',
        'console.log(answer);'
      ].join('\n')
    },
    guide: {
      hints: ['先确认输入如何被拆分成数字。', '边界情况可以从空格、换行和负数开始检查。'],
      acceptanceCriteria: ['能运行公开样例。', '输出必须与期望输出一致。']
    },
    tests: {
      cases: [
        { id: 'case-1', name: '公开样例', stdin: '1 2 3\n', expectedStdout: '6', explanation: '基础求和。' },
        { id: 'case-2', name: '包含负数', stdin: '10 -2 5 -3\n', expectedStdout: '10' }
      ]
    },
    solution: {
      approachMarkdown: '把标准输入按空白符切分为数字，累加后输出。复杂度为 O(n)。',
      referenceCode: [
        "const fs = require('fs');",
        "const nums = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).filter(Boolean).map(Number);",
        'console.log(nums.reduce((sum, value) => sum + value, 0));'
      ].join('\n'),
      complexity: 'Time O(n), space O(n).'
    }
  };
};

const normalizeCodeLabPayload = (raw: any, context: StudioGenerationContext) => {
  const fallback = codeLabFallbackPayload(context);
  const problem = isRecord(raw?.problem) ? raw.problem : {};
  const editor = isRecord(raw?.editor) ? raw.editor : {};
  const guide = isRecord(raw?.guide) ? raw.guide : {};
  const tests = isRecord(raw?.tests) ? raw.tests : {};
  const solution = isRecord(raw?.solution) ? raw.solution : {};

  const examples = Array.isArray(problem.examples)
    ? problem.examples.slice(0, 4).map((example: any, index: number) => ({
        input: clip(example?.input || '', 1200),
        output: clip(example?.output || '', 1200),
        explanation: clip(example?.explanation || '', 800)
      })).filter((example: any) => example.input || example.output)
    : [];

  const cases = Array.isArray(tests.cases)
    ? tests.cases.slice(0, 10).map((test: any, index: number) => ({
        id: clip(test?.id || `case-${index + 1}`, 60),
        name: clip(test?.name || `Case ${index + 1}`, 120),
        stdin: clip(test?.stdin || '', 4000),
        expectedStdout: clip(test?.expectedStdout ?? test?.output ?? '', 4000),
        explanation: clip(test?.explanation || '', 800)
      })).filter((test: any) => test.stdin || test.expectedStdout)
    : [];

  return {
    problem: {
      statementMarkdown: clip(problem.statementMarkdown || fallback.problem.statementMarkdown, 5000),
      examples: examples.length ? examples : fallback.problem.examples,
      constraints: stringArray(problem.constraints, 10).length ? stringArray(problem.constraints, 10) : fallback.problem.constraints
    },
    editor: {
      language: clip(editor.language || context.input.options?.language as string || fallback.editor.language, 40),
      starterCode: clip(editor.starterCode || fallback.editor.starterCode, 12000)
    },
    guide: {
      hints: stringArray(guide.hints, 8).length ? stringArray(guide.hints, 8) : fallback.guide.hints,
      acceptanceCriteria: stringArray(guide.acceptanceCriteria, 8).length
        ? stringArray(guide.acceptanceCriteria, 8)
        : fallback.guide.acceptanceCriteria
    },
    tests: {
      cases: cases.length ? cases : fallback.tests.cases
    },
    solution: {
      approachMarkdown: clip(solution.approachMarkdown || fallback.solution.approachMarkdown, 5000),
      referenceCode: clip(solution.referenceCode || '', 12000),
      complexity: clip(solution.complexity || '', 500)
    }
  };
};

const normalizeLightVisualLesson = (context: StudioGenerationContext, content: string) => {
  const parsed = parseJson(content) || {};
  const fallbackSections = sectionsFromMarkdown(content);
  const rawSlides = Array.isArray(parsed.slides) && parsed.slides.length
    ? parsed.slides
    : fallbackSections.map((section) => ({
        header: section.title,
        description: section.body,
        timeline: section.bullets.length
          ? section.bullets.map((bullet) => ({ kind: 'text', content: bullet }))
          : [{ kind: 'text', content: section.body || section.title }]
      }));
  const slides = rawSlides.slice(0, 18).map((slide: any, index: number) => {
    const description = String(slide?.description || slide?.body || slide?.content || '').trim();
    const timeline = Array.isArray(slide?.timeline)
      ? slide.timeline.slice(0, 8).map((step: any) => ({
          kind: step?.kind === 'visual' ? 'visual' : 'text',
          content: clip(step?.content || step?.text || step?.description || '', 1000),
          visualIndex: Number.isInteger(step?.visualIndex) ? step.visualIndex : undefined
        })).filter((step: any) => step.content)
      : [];
    const visuals = Array.isArray(slide?.visuals)
      ? slide.visuals.slice(0, 4).map((visual: any) => ({
          type: ['diagram', 'chart', 'table', 'formula', 'code', 'image_hint', 'sketch'].includes(String(visual?.type)) ? String(visual.type) : 'diagram',
          content: clip(visual?.content || visual?.description || visual?.hint || '', 1600)
        })).filter((visual: any) => visual.content)
      : [];
    return {
      header: clip(slide?.header || slide?.title || `Slide ${index + 1}`, 120),
      description,
      timeline: timeline.length ? timeline : [{ kind: 'text', content: description || clip(slide?.header || `Slide ${index + 1}`, 1000) }],
      visuals
    };
  }).filter((slide: any) => slide.header || slide.description);
  const nestedLesson = slides.length === 1 ? parseJson(slides[0].description || '') : null;
  if (Array.isArray(nestedLesson?.slides) && nestedLesson.slides.length) {
    return normalizeLightVisualLesson(context, JSON.stringify({
      ...nestedLesson,
      markdownDraft: parsed.markdownDraft || nestedLesson.markdownDraft || ''
    }));
  }

  return createArtifactEnvelope(
    context,
    'light_visual_lesson',
    {
      title: clip(parsed.title || context.input.prompt || context.template.title, 160),
      markdownDraft: String(parsed.markdownDraft || parsed.markdown || '').trim(),
      slides: slides.length ? slides : [{
        header: context.template.title,
        description: String(content || '').trim(),
        timeline: [{ kind: 'text', content: clip(content, 1000) }],
        visuals: []
      }]
    },
    clip(parsed.title || context.input.prompt || context.template.title, 160),
    '轻量课件式可视化讲解，按 slide 和 timeline 展开。'
  );
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
  const parsed = parseJson(content);
  const payload = normalizeCodeLabPayload(parsed || {}, context);
  return createArtifactEnvelope(
    context,
    'code_lab',
    payload,
    clip((parsed as any)?.title || context.input.prompt || context.template.title, 160),
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

const normalizeHyperFramesVideo = (context: StudioGenerationContext, content: string) => {
  const parsed = parseJson(content) || {};
  const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  const durationSeconds = Math.max(30, Math.min(90, Number(parsed.durationSeconds || context.input.options?.durationSeconds || 60)));
  const fallbackSceneDuration = durationSeconds / Math.max(1, rawScenes.length || 4);
  const scenes = (rawScenes.length ? rawScenes : [
    { title: 'Opening', headline: context.input.prompt || context.template.title, caption: '建立学习目标和问题背景。', narration: '先确认这个视频要解决的学习问题。', visual: 'Title card with source chips.' },
    { title: 'Concept', headline: '核心概念', caption: '提炼资料中的定义、条件和关键关系。', narration: '把核心概念拆成可以观察的对象和关系。', visual: 'Concept cards connect on screen.' },
    { title: 'Process', headline: '过程演示', caption: '用状态变化展示推理或操作步骤。', narration: '逐步展示每一步发生了什么，以及为什么成立。', visual: 'Animated timeline with highlighted states.' },
    { title: 'Review', headline: '复盘检查', caption: '总结结论、易错点和自测问题。', narration: '最后用一个检查问题确认是否真正理解。', visual: 'Checklist and final callout.' }
  ]).slice(0, 8).map((scene: any, index: number) => ({
    id: clip(scene?.id || `scene-${index + 1}`, 60),
    title: clip(scene?.title || `Scene ${index + 1}`, 80),
    start: Math.max(0, Number.isFinite(Number(scene?.start)) ? Number(scene.start) : index * fallbackSceneDuration),
    duration: Math.max(3, Math.min(24, Number.isFinite(Number(scene?.duration)) ? Number(scene.duration) : fallbackSceneDuration)),
    headline: clip(scene?.headline || scene?.title || context.input.prompt || context.template.title, 80),
    caption: clip(scene?.caption || scene?.summary || '', 180),
    narration: clip(scene?.narration || scene?.voiceover || '', 420),
    visual: clip(scene?.visual || scene?.visualDescription || '', 240),
    bullets: stringArray(scene?.bullets, 5),
    accent: clip(scene?.accent || '', 40)
  }));
  return createArtifactEnvelope(
    context,
    'hyperframes_video',
    {
      schemaVersion: 'hyperframes_video_plan.v1',
      title: clip(parsed.title || context.input.prompt || context.template.title, 160),
      summary: clip(parsed.summary || context.template.description, 500),
      durationSeconds,
      visualStyle: clip(parsed.visualStyle || 'clean educational motion graphics', 180),
      scenes,
      sourceNotes: stringArray(parsed.sourceNotes, 8)
    },
    parsed.title || context.input.prompt || context.template.title,
    parsed.summary || '可由 HyperFrames 渲染为 MP4 的 HTML 视频 composition。'
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
  if (kind === 'light_visual_lesson') return normalizeLightVisualLesson(context, content);
  if (kind === 'visual_explainer') return normalizeVisualExplainer(context, content);
  if (kind === 'video_script') return normalizeVideoScript(context, content);
  if (kind === 'hyperframes_video') return normalizeHyperFramesVideo(context, content);
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
