import prisma from '../config/db';
import { FileSystemService } from './fileSystemService';
import { deepseekService } from './deepseekService';
import { learningRunService } from './learningRunService';
import { QuizQualityReport, quizQualityService } from './quizQualityService';
import {
  flashcardService,
  FlashcardSourceRef,
  StructuredFlashcardInput
} from './flashcardService';
import {
  ClientWorkbenchContext,
  workbenchContextService
} from './contextSystemService';
import { learnerStateAnalyzer } from './learnerStateAnalyzer';
import { learnerStateContextAdapter, LearnerStateAgentContext } from './learnerStateContextAdapter';
import { ContextCapsule } from '../types/contextSystem';

export type StudioResourceType =
  | 'report'
  | 'slide_deck'
  | 'mind_map'
  | 'flashcards'
  | 'quiz'
  | 'data_table';

export type QuizQuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'short_answer'
  | 'error_analysis'
  | 'application'
  | 'coding_calculation';

export interface StudioQuizQuestion {
  id: string;
  type: QuizQuestionType;
  question: string;
  options?: Array<{ id: 'A' | 'B' | 'C' | 'D'; text: string }>;
  answer: string;
  acceptableAnswers?: string[];
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

interface StudioQuizPayload {
  title: string;
  questions: StudioQuizQuestion[];
}

interface StudioFlashcardDeckPayload {
  title: string;
  description?: string;
  cards: StructuredFlashcardInput[];
}

interface JudgeQuizAnswerInput {
  workspaceId: string;
  workbenchId?: string | null;
  question: StudioQuizQuestion;
  userAnswer: string;
}

interface QuizQuestionAssistantInput {
  workspaceId: string;
  workbenchId?: string | null;
  question: StudioQuizQuestion;
  userMessage: string;
  userAnswer?: string;
}

interface StudioGenerateInput {
  workspaceId: string;
  workbenchId?: string | null;
  resourceType: StudioResourceType;
  prompt?: string;
  options?: Record<string, unknown>;
  context: ClientWorkbenchContext;
}

const RESOURCE_CONFIG: Record<
  StudioResourceType,
  {
    label: string;
    filename: string;
    extension: 'md' | 'csv';
    instruction: string;
  }
> = {
  report: {
    label: 'Report',
    filename: 'studio-report.md',
    extension: 'md',
    instruction:
      '生成一份结构化学习报告。必须包含标题、适用对象、核心结论、关键概念、证据来源、学习建议。使用 Markdown。'
  },
  slide_deck: {
    label: 'Slide Deck',
    filename: 'studio-slide-deck.md',
    extension: 'md',
    instruction:
      '生成一份可转成幻灯片的 Markdown slide deck。用 --- 分隔每页。每页包含标题、3-5 个要点和必要讲者备注。'
  },
  mind_map: {
    label: 'Mind Map',
    filename: 'studio-mind-map.md',
    extension: 'md',
    instruction:
      [
        '生成一张高质量 Mermaid mindmap，并在图后补充层级大纲和来源说明。',
        'mindmap 必须是概念图，不是资料目录转写：先抽取中心主题，再归纳 4-7 个一级分支，每个一级分支下放 2-5 个关键概念、关系、方法、风险、例子或易错点。',
        '节点文本要短，优先使用名词短语或动宾短语；不要整句照抄，不要使用编号目录前缀，不要在节点中使用 <br>。',
        '严禁把 [S1]、S1、[S2]、S2 等来源编号作为 mindmap 节点；也不要创建“来源”“证据来源”分支来挂 S1/S2 节点。',
        '如需引用来源，只能在图后的“来源说明”小节中说明：- [S1] 支持哪些概念。',
        '同时输出一个 ```concept_graph JSON 代码块，用于 3D 空间概念网络。JSON 格式必须是 {"nodes":[{"id","label","group","importance","summary","sourceRefs"}],"links":[{"source","target","label","type","weight"}]}。',
        'concept_graph 没有根节点；nodes 是空间中的概念点，links 表示任意概念之间的关系。节点 label 不能是来源编号，sourceRefs 里可以写 ["S1","S2"]。',
        '输出格式：先给一个 ```mermaid 代码块，代码块第一行必须是 mindmap；然后给一个 ```concept_graph 代码块；然后给 ## 大纲；最后给 ## 来源说明。'
      ].join('\n')
  },
  flashcards: {
    label: 'Flashcards',
    filename: 'studio-flashcards.md',
    extension: 'md',
    instruction:
      '生成 12-20 张学习卡片。每张卡片包含 Front、Back、Source、Difficulty。适合间隔复习。使用 Markdown 表格或分节。'
  },
  quiz: {
    label: 'Quiz',
    filename: 'studio-quiz.json',
    extension: 'md',
    instruction:
      '生成一套可交互测验题。必须优先满足用户指定题型。选择题必须且只能有 A/B/C/D 四个选项，answer 必须是 A/B/C/D 之一。填空题 answer 写最标准答案，acceptableAnswers 写可接受同义答案。解答题 rubric 写语义评分标准。'
  },
  data_table: {
    label: 'Data Table',
    filename: 'studio-data-table.csv',
    extension: 'csv',
    instruction:
      '生成 CSV 表格。列名建议为 Topic,Definition,Key Evidence,Example,Common Pitfall,Source。只输出 CSV 内容，不要 Markdown 代码围栏。'
  }
};

const clip = (value: string | null | undefined, maxLength = 1200) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const latestUserPrompt = (input: StudioGenerateInput) =>
  clip(input.prompt || `生成 ${RESOURCE_CONFIG[input.resourceType].label}`, 600);

const plainQuizTopic = (input: StudioGenerateInput, capsule: ContextCapsule) => {
  const prompt = clip(input.prompt, 180);
  if (prompt && !/JSON|mock|配置|course_id|question_types|真实 AI|Context Capsule/i.test(prompt)) {
    return prompt;
  }
  const evidence =
    capsule.selection?.content ||
    capsule.viewport?.content ||
    capsule.activeFile?.summary ||
    capsule.retrievedChunks?.[0]?.content ||
    capsule.activeFile?.fileName ||
    '当前资料';
  return clip(evidence, 80).replace(/\s+/g, ' ');
};

const citationList = (capsule: ContextCapsule) =>
  capsule.citations
    .slice(0, 12)
    .map((citation) => {
      const source = citation.sourceId ? `[${citation.sourceId}] ` : '';
      return `- ${source}${citation.label}${citation.confidence ? ` (${citation.confidence})` : ''}`;
    })
    .join('\n') || '无';

const sourceReferencePattern = /^\s*(?:[-*]\s*)?(?:\(?\[?S\d+\]?\)?)(?:\s*[，,、;；]\s*(?:\(?\[?S\d+\]?\)?))*\s*$/i;

const sanitizeMindMapNodeText = (line: string) => {
  const leading = line.match(/^\s*/)?.[0] || '';
  let text = line.trim();
  text = text.replace(/<br\s*\/?>/gi, ' ');
  text = text.replace(/(?:\s*[，,、;；]?\s*\[?S\d+\]?)+\s*$/gi, '');
  text = text.replace(/^\d+(?:\.\d+)*[\.、)]\s*/, '');
  text = text.replace(/\s+/g, ' ').trim();
  return text ? `${leading}${text}` : '';
};

const sanitizeMermaidMindMap = (content: string) =>
  content.replace(/```mermaid\s*([\s\S]*?)```/gi, (_match, code: string) => {
    const cleaned = code
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || /^mindmap$/i.test(trimmed)) return line;
        if (sourceReferencePattern.test(trimmed)) return '';
        return sanitizeMindMapNodeText(line);
      })
      .filter((line) => line.trim())
      .join('\n');
    const normalized = /^mindmap\b/i.test(cleaned.trim()) ? cleaned : `mindmap\n${cleaned}`;
    return `\`\`\`mermaid\n${normalized}\n\`\`\``;
  });

const extractMindMapNodeLabels = (content: string) => {
  const mermaid = content.match(/```mermaid\s*([\s\S]*?)```/i)?.[1] || '';
  return mermaid
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^mindmap$/i, '')
        .replace(/^root\s*/i, '')
        .replace(/^\(+|\)+$/g, '')
        .replace(/^\[+|\]+$/g, '')
        .replace(/^"+|"+$/g, '')
        .replace(/^\d+(?:\.\d+)*[\.、)]\s*/, '')
        .replace(/(?:\s*[，,、;；]?\s*\[?S\d+\]?)+\s*$/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((label) => label && !sourceReferencePattern.test(label))
    .slice(0, 28);
};

const fallbackConceptGraphFromMindMap = (content: string, capsule: ContextCapsule) => {
  const labels = Array.from(new Set(extractMindMapNodeLabels(content)));
  const nodes = labels.slice(0, 22).map((label, index) => ({
    id: `n${index + 1}`,
    label,
    group: index === 0 ? 'core' : `cluster-${(index % 5) + 1}`,
    importance: index === 0 ? 1 : Math.max(0.35, 0.85 - index * 0.02),
    summary: label,
    sourceRefs: capsule.citations.slice(0, 2).map((citation) => citation.sourceId).filter(Boolean)
  }));
  const links = nodes.slice(1).map((node, index) => ({
    source: nodes[0]?.id || node.id,
    target: node.id,
    label: index % 3 === 0 ? '关联' : index % 3 === 1 ? '支持' : '延伸',
    type: index % 3 === 0 ? 'association' : index % 3 === 1 ? 'support' : 'extension',
    weight: 0.55
  }));
  return { nodes, links };
};

const ensureConceptGraphBlock = (content: string, capsule: ContextCapsule) => {
  if (/```concept_graph\s*[\s\S]*?```/i.test(content)) return content;
  const graph = fallbackConceptGraphFromMindMap(content, capsule);
  return `${content.trim()}\n\n\`\`\`concept_graph\n${JSON.stringify(graph, null, 2)}\n\`\`\`\n`;
};

const capsuleSourceRefs = (capsule: ContextCapsule): FlashcardSourceRef[] =>
  capsule.citations.slice(0, 12).map((citation) => ({
    sourceId: citation.sourceId,
    title: citation.label,
    fileId: citation.fileId,
    fileName: citation.fileName,
    locator: citation.locator ? { ...(citation.locator as any) } : undefined,
    snippet: citation.preview || citation.supportSnippets?.[0]?.text || '',
    confidence: citation.confidence
  }));

const normalizeFlashcardDeckPayload = (
  payload: Partial<StudioFlashcardDeckPayload> | null | undefined,
  fallbackTitle: string,
  capsule: ContextCapsule
): StudioFlashcardDeckPayload => {
  const fallbackRefs = capsuleSourceRefs(capsule).slice(0, 3);
  const cards = Array.isArray(payload?.cards) ? payload.cards : [];
  return {
    title: clip(payload?.title || fallbackTitle || 'AI Flashcards', 120),
    description: clip(payload?.description || 'Source-grounded flashcards generated by AI Studio.', 400),
    cards: cards
      .map((card, index): StructuredFlashcardInput | null => {
        const front = clip(String(card?.front || ''), 1200);
        const back = clip(String(card?.back || ''), 3000);
        if (!front || !back) return null;
        const cardType = ['basic', 'reverse', 'cloze', 'mcq', 'concept'].includes(String(card.cardType))
          ? card.cardType
          : 'basic';
        const difficulty = card.difficulty === 'easy' || card.difficulty === 'hard' ? card.difficulty : 'medium';
        const sourceRefs = Array.isArray(card.sourceRefs) && card.sourceRefs.length ? card.sourceRefs : fallbackRefs;
        return {
          front,
          back,
          cardType,
          difficulty,
          concept: clip(card.concept || `Card ${index + 1}`, 180),
          explanation: clip(card.explanation || back, 3000),
          tags: Array.isArray(card.tags) ? card.tags.map((tag) => clip(String(tag), 40)).filter(Boolean).slice(0, 8) : [],
          sourceRefs,
          metadata: card.metadata && typeof card.metadata === 'object' ? card.metadata : {}
        };
      })
      .filter((card): card is StructuredFlashcardInput => Boolean(card))
      .slice(0, 50)
  };
};

const buildFallbackFlashcardDeck = (input: StudioGenerateInput, capsule: ContextCapsule): StudioFlashcardDeckPayload => {
  const evidence = [
    capsule.selection?.content,
    capsule.viewport?.content,
    capsule.activeFile?.summary || capsule.activeFile?.content,
    ...(capsule.retrievedChunks || []).map((chunk) => chunk.content)
  ]
    .filter(Boolean)
    .map((item) => clip(item, 520))
    .slice(0, 12);
  const refs = capsuleSourceRefs(capsule).slice(0, 3);
  const topic = latestUserPrompt(input);
  const cards = (evidence.length ? evidence : [topic]).map((item, index) => ({
    front: index === 0 ? `如何解释「${topic}」的核心概念？` : `这个来源片段支持了哪个关键知识点？`,
    back: item,
    cardType: 'concept' as const,
    difficulty: index < 3 ? 'medium' as const : 'hard' as const,
    concept: index === 0 ? topic : `来源要点 ${index + 1}`,
    explanation: `这张卡要求你用自己的话复述并连接来源证据：${item}`,
    tags: ['ai-studio', 'source-grounded'],
    sourceRefs: refs
  }));
  return {
    title: `Flashcards: ${topic}`,
    description: 'Fallback deck generated from available context evidence.',
    cards
  };
};

const flashcardDeckToMarkdown = (deck: StudioFlashcardDeckPayload) =>
  [
    `# ${deck.title}`,
    '',
    deck.description || '',
    '',
    ...deck.cards.map((card, index) =>
      [
        `## Card ${index + 1}: ${card.concept || card.front.slice(0, 60)}`,
        '',
        `Front: ${card.front}`,
        '',
        `Back: ${card.back}`,
        '',
        `Source: ${(card.sourceRefs || []).map((ref) => ref.sourceId || ref.title || ref.fileName).filter(Boolean).join(', ') || 'Context'}`,
        '',
        `Difficulty: ${card.difficulty || 'medium'}`,
        '',
        card.explanation ? `Explanation: ${card.explanation}` : ''
      ].filter(Boolean).join('\n')
    )
  ].filter(Boolean).join('\n');

const buildFallbackContent = (input: StudioGenerateInput, capsule: ContextCapsule) => {
  const config = RESOURCE_CONFIG[input.resourceType];
  const title = `${config.label}: ${latestUserPrompt(input)}`;
  const evidence = [
    capsule.selection?.content,
    capsule.viewport?.content,
    capsule.activeFile?.summary || capsule.activeFile?.content,
    ...(capsule.retrievedChunks || []).map((chunk) => chunk.content)
  ]
    .filter(Boolean)
    .map((item) => clip(item, 700));

  if (input.resourceType === 'data_table') {
    const rows = [
      ['Topic', 'Definition', 'Key Evidence', 'Example', 'Common Pitfall', 'Source'],
      [
        latestUserPrompt(input).replace(/"/g, '""'),
        'Based on the selected workbench context',
        (evidence[0] || 'No strong evidence available').replace(/"/g, '""'),
        'Add a concrete example after reviewing the source',
        'Do not overgeneralize beyond the available sources',
        capsule.citations[0]?.label || 'No source'
      ]
    ];
    return rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
  }

  if (input.resourceType === 'mind_map') {
    const sourceNotes = capsule.citations
      .slice(0, 6)
      .map((citation) => `- ${citation.sourceId || citation.label}: ${citation.label}`)
      .join('\n');
    return [
      `# ${title}`,
      '',
      '```mermaid',
      'mindmap',
      `  root((${latestUserPrompt(input)}))`,
      '    核心概念',
      '      关键定义',
      '      重要关系',
      '    学习结构',
      '      对比维度',
      '      推理路径',
      '      应用场景',
      '    下一步学习',
      '      复述',
      '      练习',
      '      复盘',
      '```',
      '',
      '```concept_graph',
      JSON.stringify(
        {
          nodes: [
            { id: 'n1', label: latestUserPrompt(input), group: 'core', importance: 1, summary: '中心学习主题', sourceRefs: [] },
            { id: 'n2', label: '核心概念', group: 'concept', importance: 0.85, summary: '需要优先理解的概念集合', sourceRefs: [] },
            { id: 'n3', label: '重要关系', group: 'relation', importance: 0.75, summary: '概念之间的结构关系', sourceRefs: [] },
            { id: 'n4', label: '应用场景', group: 'application', importance: 0.65, summary: '可迁移的实践场景', sourceRefs: [] },
            { id: 'n5', label: '下一步学习', group: 'practice', importance: 0.6, summary: '复述、练习和复盘', sourceRefs: [] }
          ],
          links: [
            { source: 'n1', target: 'n2', label: '包含', type: 'contains', weight: 0.8 },
            { source: 'n2', target: 'n3', label: '组织为', type: 'structure', weight: 0.7 },
            { source: 'n3', target: 'n4', label: '迁移到', type: 'application', weight: 0.65 },
            { source: 'n4', target: 'n5', label: '驱动', type: 'next_step', weight: 0.6 }
          ]
        },
        null,
        2
      ),
      '```',
      '',
      '## 大纲',
      evidence.map((item, index) => `${index + 1}. ${item}`).join('\n') || '- 当前上下文证据不足，请扩大生成范围。',
      '',
      '## 来源说明',
      sourceNotes || '- 当前没有可用来源编号。'
    ].join('\n');
  }

  if (input.resourceType === 'quiz') {
    const topic = plainQuizTopic(input, capsule);
    return JSON.stringify(
      {
        title: `${topic}测验`,
        questions: [
          {
            id: 'q1',
            type: 'multiple_choice',
            question: `根据当前资料，下面哪一项最能概括「${topic}」的核心学习任务？`,
            options: [
              { id: 'A', text: '复述核心概念，并结合来源证据解释。' },
              { id: 'B', text: '忽略来源，直接背诵结论。' },
              { id: 'C', text: '只看标题，不需要理解证据。' },
              { id: 'D', text: '不需要练习或复盘。' }
            ],
            answer: 'A',
            rubric: '能说明核心概念，并能结合来源证据解释。',
            skill: '核心概念理解',
            difficulty: 'easy',
            source: capsule.citations[0]?.sourceId || capsule.citations[0]?.label || 'context'
          },
          {
            id: 'q2',
            type: 'fill_blank',
            question: `请填写一个与「${topic}」最相关的关键词。`,
            answer: topic,
            acceptableAnswers: [topic],
            rubric: '答案应与当前目标或资料核心概念相关。',
            skill: '关键词回忆',
            difficulty: 'medium',
            source: capsule.citations[1]?.sourceId || capsule.citations[1]?.label || 'context'
          },
          {
            id: 'q3',
            type: 'short_answer',
            question: '请用自己的话解释当前资料的一个关键概念，并说明它为什么重要。',
            answer: evidence[0] || latestUserPrompt(input),
            rubric: '回答应包含定义、重要性、一个来源依据或例子。',
            skill: '语义解释',
            difficulty: 'medium',
            source: capsule.citations[2]?.sourceId || capsule.citations[2]?.label || 'context'
          }
        ]
      },
      null,
      2
    );
  }

  return [
    `# ${title}`,
    '',
    '## 生成说明',
    `资源类型：${config.label}`,
    `用户要求：${latestUserPrompt(input)}`,
    '',
    '## 核心内容',
    evidence.map((item, index) => `### 要点 ${index + 1}\n${item}`).join('\n\n') ||
      '当前上下文证据不足，请扩大到当前 Workbench 或 Workspace 后重新生成。',
    '',
    '## 来源',
    citationList(capsule),
    '',
    '## 下一步',
    '- 检查来源是否覆盖目标范围。',
    '- 根据薄弱点继续生成 quiz 或 flashcards。',
    '- 把确认后的内容沉淀到学习笔记。'
  ].join('\n');
};

const normalizeQuizPayload = (payload: StudioQuizPayload, fallbackTitle: string): StudioQuizPayload => {
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  const allowedTypes = new Set<QuizQuestionType>([
    'single_choice',
    'multiple_choice',
    'true_false',
    'fill_blank',
    'short_answer',
    'error_analysis',
    'application',
    'coding_calculation'
  ]);
  return {
    title: String(payload.title || fallbackTitle || 'Studio Quiz'),
    questions: questions
      .map((question, index): StudioQuizQuestion | null => {
        const rawType = String(question.type || '').trim() as QuizQuestionType;
        const type = allowedTypes.has(rawType) ? rawType : 'short_answer';
        const difficulty =
          question.difficulty === 'easy' || question.difficulty === 'hard' || question.difficulty === 'medium'
            ? question.difficulty
            : 'medium';
        const normalized: StudioQuizQuestion = {
          id: String(question.id || `q${index + 1}`),
          type,
          question: clip(question.question, 1200),
          answer: clip(question.answer, 600),
          acceptableAnswers: Array.isArray(question.acceptableAnswers)
            ? question.acceptableAnswers.map((item) => clip(String(item), 160)).filter(Boolean)
            : undefined,
          rubric: clip(question.rubric, 1000),
          skill: clip(question.skill, 120) || '核心理解',
          difficulty,
          source: question.source ? clip(question.source, 160) : undefined,
          explanation: question.explanation ? clip(question.explanation, 1000) : undefined,
          hint: question.hint ? clip(question.hint, 260) : undefined,
          choiceFeedback:
            question.choiceFeedback && typeof question.choiceFeedback === 'object'
              ? {
                  A: question.choiceFeedback.A ? clip(question.choiceFeedback.A, 220) : undefined,
                  B: question.choiceFeedback.B ? clip(question.choiceFeedback.B, 220) : undefined,
                  C: question.choiceFeedback.C ? clip(question.choiceFeedback.C, 220) : undefined,
                  D: question.choiceFeedback.D ? clip(question.choiceFeedback.D, 220) : undefined
                }
              : undefined,
          knowledgePoints: Array.isArray(question.knowledgePoints)
            ? question.knowledgePoints.map((item) => clip(String(item), 80)).filter(Boolean).slice(0, 8)
            : undefined,
          learningObjective: question.learningObjective ? clip(question.learningObjective, 400) : undefined,
          commonMistake: question.commonMistake ? clip(question.commonMistake, 400) : undefined,
          sourceRefs: Array.isArray(question.sourceRefs)
            ? question.sourceRefs.slice(0, 3).map((ref) => ({
                title: clip(ref?.title, 120) || 'Source',
                snippet: clip(ref?.snippet, 300)
              }))
            : undefined
        };
        if (!normalized.question) return null;
        if (type === 'single_choice' || type === 'multiple_choice' || type === 'true_false') {
          const options = Array.isArray(question.options) ? question.options : [];
          const byId = new Map(options.map((option) => [String(option.id).toUpperCase(), String(option.text || '').trim()]));
          normalized.options = (['A', 'B', 'C', 'D'] as const).map((id) => ({
            id,
            text: byId.get(id) || `${id} 选项`
          }));
          const answer = String(question.answer || '').trim().toUpperCase().match(/[A-D]/)?.[0];
          normalized.answer = answer || 'A';
        }
        return normalized;
      })
      .filter((question): question is StudioQuizQuestion => Boolean(question))
  };
};

const buildQuizSchema = () => ({
  title: 'string',
  questions: [
    {
      id: 'string',
      type: 'single_choice | multiple_choice | true_false | fill_blank | short_answer | error_analysis | application | coding_calculation',
      question: 'string',
      options: [{ id: 'A | B | C | D', text: 'string' }],
      answer: 'string',
      acceptableAnswers: ['string'],
      rubric: 'string',
      skill: 'string',
      difficulty: 'easy | medium | hard',
      source: 'string',
      explanation: 'string',
      hint: 'string',
      choiceFeedback: {
        A: 'string',
        B: 'string',
        C: 'string',
        D: 'string'
      },
      knowledgePoints: ['string'],
      learningObjective: 'string',
      commonMistake: 'string',
      sourceRefs: [{ title: 'string', snippet: 'string' }]
    }
  ]
});

const buildGenerationPrompt = (input: StudioGenerateInput, capsule: ContextCapsule, learnerContext?: LearnerStateAgentContext) => {
  const config = RESOURCE_CONFIG[input.resourceType];
  const citationRule =
    input.resourceType === 'mind_map'
      ? [
          '引用规则：Mermaid mindmap 代码块内部严禁出现 [S1]、S1、[S2]、S2 这类来源编号节点。',
          '不要把来源编号、文件名、页码、章节号单独作为节点。来源只能写在图后的“## 来源说明”小节。',
          '如果某个概念需要来源支持，在“## 来源说明”中写成：- [S1] 支持：概念 A、概念 B。'
        ].join('\n')
      : '引用规则：事实性内容尽量使用 [S1]、[S2] 这样的来源编号。若是 CSV，则在 Source 列写来源编号或来源标签。';
  return [
    '你是 AI Studio 资源生成器，服务于一个 Multi-Agent 学习系统。',
    '你必须严格基于 Context Capsule 中的证据生成内容；依据不足时要说明不足，不要编造。',
    '',
    `资源类型：${config.label}`,
    `用户要求：${latestUserPrompt(input)}`,
    `生成指令：${config.instruction}`,
    learnerContext ? `个性化上下文：\n${learnerContext.promptContext}` : '',
    learnerContext ? '个性化上下文只用于调整资源形式、难度和下一步建议，不要把候选信号写成用户固定特质。' : '',
    '',
    citationRule,
    '',
    `Context Preview:\n${capsule.promptContextPreview || '无'}`,
    '',
    `Sources:\n${citationList(capsule)}`
  ].join('\n');
};

export class AiStudioService {
  async generate(input: StudioGenerateInput) {
    const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new Error('Workspace not found');

    const workbench = input.workbenchId
      ? await prisma.workbench.findFirst({
          where: { id: input.workbenchId, workspaceId: input.workspaceId }
        })
      : null;

    const config = RESOURCE_CONFIG[input.resourceType];
    const run = await learningRunService.startRun({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: workbench?.learningGoalId || null,
      intent: 'ai_studio_generate',
      input: {
        resourceType: input.resourceType,
        prompt: input.prompt,
        contextMode: input.context.contextMode
      }
    });

    try {
      const capsuleResult = await workbenchContextService.buildCapsule({
        context: {
          ...input.context,
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || input.context.workbenchId || null
        },
        messages: [{ role: 'user', content: latestUserPrompt(input) }]
      });
      const capsule = capsuleResult.capsule;
      const learnerContext = await learnerStateContextAdapter.build({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: workbench?.learningGoalId || null,
        audience:
          input.resourceType === 'quiz'
            ? 'quiz'
            : input.resourceType === 'flashcards'
              ? 'flashcard'
              : 'studio'
      });

      let content = '';
      let source = 'fallback';
      let qualityReport: QuizQualityReport | null = null;
      let flashcardDeckPayload: StudioFlashcardDeckPayload | null = null;
      if (input.resourceType === 'quiz' && deepseekService.isConfigured()) {
        try {
          const response = await deepseekService.json<StudioQuizPayload>({
            instruction: [
              '你是 AI Studio 的 Quiz Generator。',
              '请严格基于 Context Capsule 生成可交互测验。',
              '必须输出 JSON，不要 Markdown。',
              'single_choice、multiple_choice、true_false 每题必须且只能有 A/B/C/D 四个选项，不要重复选项字母。',
              '如果用户指定了题型，就按指定题型组合生成。',
              'fill_blank、short_answer、error_analysis、application、coding_calculation 必须提供 answer、explanation 和 rubric，供后端 AI judge 评分。',
              '每题尽量包含 knowledgePoints、learningObjective、commonMistake、sourceRefs。',
              '每题尽量包含一个简短的 hint。选择题额外提供 choiceFeedback，对 A/B/C/D 每个选项各写 1-2 句短反馈。',
              'quizOptions、internalRules、course_id、task_id、question_types 等是内部控制参数，严禁出现在题干、选项、答案、解析或标题中。',
              '不要把用户要求原文整句复制成题干；题干必须考察 Context Preview 或 Sources 中的真实课程内容。'
            ].join('\n'),
            schema: buildQuizSchema(),
            input: {
              userPrompt: input.prompt || '根据当前资料生成测验',
              quizOptions: input.options?.quiz || input.options || null,
              internalRules: {
                doNotMentionOptions: true,
                doNotCopyPromptTextIntoQuestions: true,
                hiddenControlFields: ['course_id', 'task_id', 'number_mode', 'question_count', 'question_types', 'source_scope', 'focus_modes', 'answer_mode']
              },
              instruction: config.instruction,
              learnerContext: learnerContext.promptContext,
              learnerGuardrails: learnerContext.guardrails,
              contextPreview: capsule.promptContextPreview,
              sources: capsule.citations.slice(0, 12).map((citation) => ({
                sourceId: citation.sourceId,
                label: citation.label,
                confidence: citation.confidence
              }))
            }
          });
          const normalizedQuiz = normalizeQuizPayload(response.data, latestUserPrompt(input));
          const reviewed = await quizQualityService.review(normalizedQuiz, capsule);
          content = JSON.stringify(reviewed.quiz, null, 2);
          qualityReport = reviewed.report;
          source = 'deepseek-json';
        } catch (error) {
          const fallbackQuiz = normalizeQuizPayload(JSON.parse(buildFallbackContent(input, capsule)), latestUserPrompt(input));
          const reviewed = await quizQualityService.review(fallbackQuiz, capsule);
          content = JSON.stringify(reviewed.quiz, null, 2);
          qualityReport = reviewed.report;
          source = `fallback:${error instanceof Error ? error.message : String(error)}`;
        }
      } else if (input.resourceType === 'quiz') {
        const fallbackQuiz = normalizeQuizPayload(JSON.parse(buildFallbackContent(input, capsule)), latestUserPrompt(input));
        const reviewed = await quizQualityService.review(fallbackQuiz, capsule);
        content = JSON.stringify(reviewed.quiz, null, 2);
        qualityReport = reviewed.report;
      } else if (input.resourceType === 'flashcards' && deepseekService.isConfigured()) {
        try {
          const response = await deepseekService.json<StudioFlashcardDeckPayload>({
            instruction: [
              '你是 AI Studio 的 source-grounded Flashcard Generator。',
              '严格基于 Context Capsule 生成结构化卡组。',
              '每张卡必须短 front、清晰 back、卡级 sourceRefs、difficulty、concept、explanation。',
              '优先生成可主动回忆的卡片，不要把整段资料原文作为题面。',
              '卡片覆盖定义、对比、流程、易错点、应用场景；不要重复。',
              '如果证据不足，减少卡片数量并在 description 中说明。'
            ].join('\n'),
            schema: {
              title: 'string',
              description: 'string',
              cards: [
                {
                  front: 'string',
                  back: 'string',
                  cardType: 'basic | reverse | cloze | mcq | concept',
                  difficulty: 'easy | medium | hard',
                  concept: 'string',
                  explanation: 'string',
                  tags: ['string'],
                  sourceRefs: [{ sourceId: 'string', title: 'string', snippet: 'string' }]
                }
              ]
            },
            input: {
              userPrompt: input.prompt || '根据当前资料生成抽认卡',
              flashcardOptions: input.options || null,
              instruction: config.instruction,
              learnerContext: learnerContext.promptContext,
              learnerGuardrails: learnerContext.guardrails,
              contextPreview: capsule.promptContextPreview,
              sources: capsule.citations.slice(0, 12).map((citation) => ({
                sourceId: citation.sourceId,
                title: citation.label,
                fileId: citation.fileId,
                fileName: citation.fileName,
                confidence: citation.confidence,
                snippet: citation.preview || citation.supportSnippets?.[0]?.text || ''
              }))
            }
          });
          flashcardDeckPayload = normalizeFlashcardDeckPayload(response.data, latestUserPrompt(input), capsule);
          content = flashcardDeckToMarkdown(flashcardDeckPayload);
          source = 'deepseek-json';
        } catch (error) {
          flashcardDeckPayload = buildFallbackFlashcardDeck(input, capsule);
          content = flashcardDeckToMarkdown(flashcardDeckPayload);
          source = `fallback:${error instanceof Error ? error.message : String(error)}`;
        }
      } else if (input.resourceType === 'flashcards') {
        flashcardDeckPayload = buildFallbackFlashcardDeck(input, capsule);
        content = flashcardDeckToMarkdown(flashcardDeckPayload);
      } else if (deepseekService.isConfigured()) {
        try {
          const response = await deepseekService.chat([
            { role: 'user', content: buildGenerationPrompt(input, capsule, learnerContext) }
          ]);
          content = response.reply.trim();
          source = 'deepseek';
        } catch (error) {
          content = buildFallbackContent(input, capsule);
          source = `fallback:${error instanceof Error ? error.message : String(error)}`;
        }
      } else {
        content = buildFallbackContent(input, capsule);
      }
      if (input.resourceType === 'mind_map') {
        content = sanitizeMermaidMindMap(content);
        content = ensureConceptGraphBlock(content, capsule);
      }

      const targetDir = workbench?.rootPath
        ? `${workbench.rootPath}/Generated/Studio`
        : '/Generated/Studio';
      const file = await FileSystemService.saveGeneratedContent({
        workspaceId: input.workspaceId,
        targetDir,
        filename: config.filename,
        category: 'generated',
        workbenchId: input.workbenchId || undefined,
        resourceRole: 'generated',
        resourceType: 'generated',
        scope: input.workbenchId ? 'workbench' : 'workspace',
        origin: 'ai',
        content
      });
      const flashcardDeck = flashcardDeckPayload
        ? await flashcardService.createDeck({
            workspaceId: input.workspaceId,
            workbenchId: input.workbenchId || null,
            title: flashcardDeckPayload.title,
            description: flashcardDeckPayload.description,
            source: source.startsWith('deepseek') ? 'ai_studio_deepseek' : 'ai_studio_fallback',
            sourceFileIds: capsule.citations.map((citation) => citation.fileId).filter(Boolean),
            sourceRefs: capsuleSourceRefs(capsule),
            settings: input.options || {},
            generationRunId: run.id,
            fileObjectId: file.id,
            cards: flashcardDeckPayload.cards
          })
        : null;

      await learningRunService.completeRun(run.id, {
        resourceType: input.resourceType,
        fileObjectId: file.id,
        flashcardDeckId: flashcardDeck?.id,
        source,
        citations: capsule.citations.map((citation) => citation.label)
      });

      return {
        file,
        content,
        resourceType: input.resourceType,
        flashcardDeck,
        runId: run.id,
        source,
        contextCapsule: capsule,
        contextPolicy: capsuleResult.policy,
        qualityReport,
        usedContextSummary: {
          mode: capsule.mode,
          selection: Boolean(capsule.selection),
          viewport: Boolean(capsule.viewport),
          activeFile: capsule.activeFile?.fileName || null,
          resources: capsule.resources?.length || 0,
          retrievedChunks: capsule.retrievedChunks?.length || 0,
          estimatedTokens: capsule.estimatedTokens,
          citations: capsule.citations.map((citation) => citation.label)
        }
      };
    } catch (error) {
      await learningRunService.failRun(run.id, error);
      throw error;
    }
  }

  async judgeQuizAnswer(input: JudgeQuizAnswerInput) {
    const question = input.question;
    const userAnswer = clip(input.userAnswer, 4000);

    if (!deepseekService.isConfigured()) {
      const result = {
        correct: false,
        score: 0,
        feedback: '后端 AI judge 未配置 DeepSeek API，暂时无法提供解释型评分反馈。',
        judgedBy: 'unavailable'
      };
      await learnerStateAnalyzer.analyzeQuizResult({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        question,
        userAnswer,
        result
      }).catch((error) => console.warn('LearnerStateAnalyzer fallback quiz result failed:', error));
      return result;
    }

    const response = await deepseekService.json<{
      correct: boolean;
      score: number;
      feedback: string;
      missingPoints?: string[];
      matchedPoints?: string[];
    }>({
      instruction: [
        '你是学习系统的 Quiz Judge。',
        '请根据题目、标准答案、可接受答案、rubric 和学生回答进行评分。',
        '选择题也必须结合错误选项分析给出解释性反馈，指出为什么错、正确思路是什么。',
        '填空题允许同义词、近似表达、大小写和轻微书写差异。',
        '解答题按语义评分，不要求逐字一致；可以给部分分。',
        'feedback 用简体中文，必须像老师批改一样解释，不要只报分数和正确答案。',
        'score 必须是 0 到 1 的数字。feedback 具体指出命中点、缺失点、误区或下一步建议。',
        '只输出 JSON。'
      ].join('\n'),
      schema: {
        correct: 'boolean',
        score: 'number between 0 and 1',
        feedback: 'string',
        missingPoints: ['string'],
        matchedPoints: ['string']
      },
      input: {
        question,
        userAnswer
      }
    });

    const score = Math.max(0, Math.min(1, Number(response.data.score) || 0));
    const result = {
      correct: Boolean(response.data.correct || score >= 0.72),
      score,
      feedback: response.data.feedback || (score >= 0.72 ? '回答语义正确。' : '回答还需要补充关键要点。'),
      missingPoints: response.data.missingPoints || [],
      matchedPoints: response.data.matchedPoints || [],
      judgedBy: 'deepseek'
    };
    await learnerStateAnalyzer.analyzeQuizResult({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      question,
      userAnswer,
      result
    }).catch((error) => console.warn('LearnerStateAnalyzer quiz result failed:', error));
    return result;
  }

  async assistQuizQuestion(input: QuizQuestionAssistantInput) {
    if (!deepseekService.isConfigured()) {
      return {
        reply: '后端 AI 助手暂未配置 DeepSeek API，当前无法解释这道题。',
        suggestedActions: ['检查题干和来源引用', '稍后重试 AI 解释']
      };
    }

    const response = await deepseekService.json<{
      reply: string;
      issueDetected?: boolean;
      issueType?: 'question_quality' | 'answer_quality' | 'needs_clarification' | 'none';
      suggestedActions?: string[];
    }>({
      instruction: [
        '你是学习系统中的单题 AI 助手。',
        '你只围绕当前这道题回答，可以解释题目、指出解法、分析错误原因，也可以判断题目或答案是否可疑。',
        '如果用户质疑题目或答案，要先判断是否真的可能有问题，再给出谨慎说明。',
        '回答必须简洁、具体、教学化，不要泛泛而谈。',
        '只输出 JSON。'
      ].join('\n'),
      schema: {
        reply: 'string',
        issueDetected: 'boolean',
        issueType: 'question_quality | answer_quality | needs_clarification | none',
        suggestedActions: ['string']
      },
      input: {
        question: input.question,
        userMessage: input.userMessage,
        userAnswer: input.userAnswer || ''
      }
    });

    return {
      reply: response.data.reply || '这道题我建议先回到题干中的关键条件，再逐步检查答案。',
      issueDetected: Boolean(response.data.issueDetected),
      issueType: response.data.issueType || 'none',
      suggestedActions: response.data.suggestedActions || []
    };
  }
}

export const aiStudioService = new AiStudioService();
