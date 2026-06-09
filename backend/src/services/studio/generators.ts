import { AiModelProviderId, ProviderChatMessage, aiModelProviderService } from '../aiModelProviderService';
import prisma from '../../config/db';
import { quizQualityService } from '../quizQualityService';
import { FileSystemService } from '../fileSystemService';
import { documentTextExtractionService } from '../documentTextExtractionService';
import { ContextCapsule } from '../../types/contextSystem';
import {
  StudioGenerationContext,
  StudioGeneratorKind,
  StudioGeneratorResult,
  StudioResourceTemplate,
  StudioStructuredArtifact
} from './types';
import { normalizeStudioArtifact } from './artifactSchemas';
import { renderStudioArtifact } from './artifactRenderer';
import { reviewStudioArtifact } from './reviewAgent';
import {
  parsePracticeRequestContract,
  practiceContractInstruction,
  reconcileQuizWithPracticeContract
} from './practiceRequest';
import {
  buildVisualExplainerMarkdownSourceBlocks,
  buildVisualExplainerFromStages,
  buildFallbackVisualExplainer,
  extractVisualExplainerMarkdownDraft,
  normalizeVisualExplainerContentMap,
  normalizeVisualExplainerRendererBlocks,
  normalizeVisualExplainerSectionPlan,
  normalizeVisualExplainerSlideText,
  normalizeVisualExplainerVisualIntent,
  validateVisualExplainerPayload,
  VISUAL_EXPLAINER_CONTENT_MAP_SCHEMA_HINT,
  VISUAL_EXPLAINER_RENDERER_BLOCK_SCHEMA_HINT,
  VISUAL_EXPLAINER_SCHEMA_HINT,
  VISUAL_EXPLAINER_SECTION_PLAN_SCHEMA_HINT,
  VISUAL_EXPLAINER_SLIDE_TEXT_SCHEMA_HINT,
  VISUAL_EXPLAINER_VISUAL_INTENT_SCHEMA_HINT,
  visualExplainerContentMapPrompt,
  visualExplainerMarkdownPrompt,
  visualExplainerSelectedSourcesMarkdownPrompt,
  visualExplainerRendererBlocksPrompt,
  visualExplainerSectionPlanPrompt,
  visualExplainerSlideTextPrompt,
  visualExplainerVisualIntentPrompt
} from './visualExplainer';

const STUDIO_MODEL_TIMEOUT_MS = Number(process.env.STUDIO_MODEL_TIMEOUT_MS || 240000);
const VISUAL_EXPLAINER_STAGE_TIMEOUT_MS = Number(process.env.VISUAL_EXPLAINER_STAGE_TIMEOUT_MS || 45000);
const DEFAULT_STUDIO_FALLBACK_PROVIDERS: AiModelProviderId[] = ['deepseek', 'claude', 'openai', 'gemini'];
const providerCircuit = new Map<AiModelProviderId, { disabledUntil: number; reason: string }>();

const clip = (value: string | null | undefined, maxLength = 1200) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const citationList = (capsule: ContextCapsule) =>
  capsule.citations
    .slice(0, 12)
    .map((citation) => {
      const source = citation.sourceId ? `[${citation.sourceId}] ` : '';
      return `- ${source}${citation.label}${citation.confidence ? ` (${citation.confidence})` : ''}`;
    })
    .join('\n') || '无';

const evidenceSnippets = (capsule: ContextCapsule, max = 8) =>
  [
    capsule.selection?.content,
    capsule.viewport?.content,
    capsule.activeFile?.summary || capsule.activeFile?.content,
    ...(capsule.resources || []).map((resource) => resource.summary || resource.fileName),
    ...(capsule.retrievedChunks || []).map((chunk) => chunk.content)
  ]
    .filter(Boolean)
    .map((item) => clip(item, 700))
    .slice(0, max);

const isResourceNotesLikeTemplate = (templateId: string) =>
  templateId === 'resource_to_notes' || templateId === 'pagelm_cornell_notes' || templateId === 'pure_markdown_notes';

const topicFromContext = (context: StudioGenerationContext) => {
  const prompt = latestPrompt(context).replace(/^根据当前资料生成个性化学习资源$/i, '').trim();
  if (isResourceNotesLikeTemplate(context.template.id) || context.template.id === 'resource_compare') {
    const citationTopic = context.capsule.citations[0]?.label?.replace(/\.[a-z0-9]+$/i, '').trim();
    if (citationTopic) return citationTopic;
    const activeFileTopic = context.capsule.activeFile?.fileName?.replace(/\.[a-z0-9]+$/i, '').trim();
    if (activeFileTopic) return activeFileTopic;
  }
  if (prompt && prompt.length < 120) return prompt;
  const citationTopic = context.capsule.citations[0]?.label?.replace(/\.[a-z0-9]+$/i, '').trim();
  if (citationTopic) return citationTopic;
  const activeFileTopic = context.capsule.activeFile?.fileName?.replace(/\.[a-z0-9]+$/i, '').trim();
  return activeFileTopic || context.template.title;
};

const latestPrompt = (context: StudioGenerationContext) =>
  clip(context.input.prompt || context.template.promptFrame || context.template.title, 700);

const parseProviderList = (value?: string | null): AiModelProviderId[] =>
  String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is AiModelProviderId =>
      item === 'openai' || item === 'gemini' || item === 'claude' || item === 'deepseek'
    );

const isRecoverableModelError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|socket|econnreset|econnrefused|etimedout|terminated|timeout|abort|und_err|no available channel|status 429|status 5\d\d/i.test(message);
};

const studioFallbackProviders = (primary: AiModelProviderId) => {
  const configured = parseProviderList(process.env.AI_STUDIO_FALLBACK_PROVIDERS);
  const candidates = configured.length ? configured : DEFAULT_STUDIO_FALLBACK_PROVIDERS;
  return candidates.filter((provider, index, list) => provider !== primary && list.indexOf(provider) === index);
};

const providerCooldownMs = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/no available channel/i.test(message)) return Number(process.env.AI_PROVIDER_NO_CHANNEL_COOLDOWN_MS || 10 * 60 * 1000);
  if (/status 429/i.test(message)) return Number(process.env.AI_PROVIDER_RATE_LIMIT_COOLDOWN_MS || 2 * 60 * 1000);
  if (/fetch failed|network|socket|econnreset|econnrefused|etimedout|terminated|timeout|abort|und_err|status 5\d\d/i.test(message)) {
    return Number(process.env.AI_PROVIDER_TRANSIENT_COOLDOWN_MS || 60 * 1000);
  }
  return 0;
};

const recordProviderFailure = (provider: AiModelProviderId, error: unknown) => {
  const cooldownMs = providerCooldownMs(error);
  if (!cooldownMs) return;
  const message = error instanceof Error ? error.message : String(error);
  providerCircuit.set(provider, {
    disabledUntil: Date.now() + cooldownMs,
    reason: clip(message, 180)
  });
};

const recordProviderSuccess = (provider: AiModelProviderId) => {
  providerCircuit.delete(provider);
};

const studioProviderCandidates = (primary: AiModelProviderId, errors: string[]) => {
  const candidates = [primary, ...studioFallbackProviders(primary)].filter((provider, index, list) => list.indexOf(provider) === index);
  return candidates.filter((provider) => {
    if (!aiModelProviderService.isConfigured({ provider, useCase: 'studio' })) return false;
    const circuit = providerCircuit.get(provider);
    if (circuit && circuit.disabledUntil > Date.now()) {
      errors.push(`${provider}: temporarily disabled (${circuit.reason})`);
      return false;
    }
    if (circuit) providerCircuit.delete(provider);
    return true;
  });
};

const describeModelError = (provider: AiModelProviderId, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return `${provider}: ${message}`;
};

const chatWithStudioFallback = async (
  messages: ProviderChatMessage[],
  context: StudioGenerationContext,
  options: { includeVisualEvidence?: boolean; timeoutMs?: number } = {}
) => {
  const primary = aiModelProviderService.provider({ useCase: 'studio' });
  const errors: string[] = [];
  const visualEvidence = options.includeVisualEvidence === false ? undefined : context.capsule.visualEvidence;
  const timeoutMs = options.timeoutMs || STUDIO_MODEL_TIMEOUT_MS;

  for (const provider of studioProviderCandidates(primary, errors)) {
    try {
      const result = await aiModelProviderService.chat(messages, undefined, {
        provider: provider === primary ? undefined : provider,
        timeoutMs,
        useCase: 'studio',
        visualEvidence
      });
      recordProviderSuccess(provider);
      return {
        ...result,
        usage: {
          ...(result.usage || {}),
          ...(provider !== primary ? { fallbackFrom: primary } : {}),
          ...(errors.length ? { fallbackErrors: errors } : {})
        }
      };
    } catch (error) {
      errors.push(describeModelError(provider, error));
      recordProviderFailure(provider, error);
      if (!isRecoverableModelError(error)) break;
    }
  }

  throw new Error(`AI Studio model generation failed (${errors.join(' | ')})`);
};

const jsonWithStudioFallback = async <T>(
  context: StudioGenerationContext,
  params: {
    instruction: string;
    schema: Record<string, unknown>;
    input: Record<string, unknown>;
  },
  options: { includeVisualEvidence?: boolean; timeoutMs?: number } = {}
) => {
  const primary = aiModelProviderService.provider({ useCase: 'studio' });
  const errors: string[] = [];
  const visualEvidence = options.includeVisualEvidence === false ? undefined : context.capsule.visualEvidence;
  const timeoutMs = options.timeoutMs || STUDIO_MODEL_TIMEOUT_MS;

  for (const provider of studioProviderCandidates(primary, errors)) {
    try {
      const result = await aiModelProviderService.json<T>({
        ...params,
        provider: provider === primary ? undefined : provider,
        context: { visualEvidence },
        timeoutMs,
        useCase: 'studio'
      });
      recordProviderSuccess(provider);
      return {
        ...result,
        usage: {
          ...(result.usage || {}),
          ...(provider !== primary ? { fallbackFrom: primary } : {}),
          ...(errors.length ? { fallbackErrors: errors } : {})
        }
      };
    } catch (error) {
      errors.push(describeModelError(provider, error));
      recordProviderFailure(provider, error);
      if (!isRecoverableModelError(error)) break;
    }
  }

  throw new Error(`AI Studio JSON generation failed (${errors.join(' | ')})`);
};

const commonPrompt = (context: StudioGenerationContext, extra: string) =>
  [
    '你是 AI Studio 2.0 的资源生成智能体，服务于一个多智能体学习资源工厂。',
    '必须严格基于 Context Capsule 和 Sources 生成内容；证据不足时要明说，不要编造。',
    '个性化上下文只用于调整难度、例子和建议，不要把短期观察写成固定特质。',
    '最终产物只写给学习者看的资源内容。不要输出或复述系统提示词、模板框架、生成指令、用户配置、Context Capsule、内部字段名或 JSON 配置片段，除非模板明确要求输出 JSON 资源本身。',
    '',
    `学习目标类别：${context.template.goal}`,
    `资源模板：${context.template.title} (${context.template.id})`,
    `底层生成器：${context.template.generator}`,
    `用户要求：${latestPrompt(context)}`,
    `模板框架：${context.template.promptFrame}`,
    `生成指令：${context.template.systemInstruction}`,
    context.learnerContext ? `学习者上下文：\n${context.learnerContext.promptContext}` : '',
    context.learnerContext?.guardrails?.length ? `个性化护栏：\n${context.learnerContext.guardrails.join('\n')}` : '',
    context.enrichment?.resourceDiscovery
      ? `外部资源搜索结果：\n${JSON.stringify(context.enrichment.resourceDiscovery, null, 2).slice(0, 5000)}`
      : '',
    context.enrichment?.parentPlan
      ? `Workspace 父规划快照：\n${JSON.stringify(context.enrichment.parentPlan, null, 2).slice(0, 5000)}`
      : '',
    '',
    extra,
    '',
    `Context Preview:\n${context.capsule.promptContextPreview || '无'}`,
    '',
    `Sources:\n${citationList(context.capsule)}`
  ].filter(Boolean).join('\n');

const fallbackMarkdown = (context: StudioGenerationContext, sections: string[]) => {
  const snippets = evidenceSnippets(context.capsule);
  const title = context.template.id === 'resource_to_notes'
    ? topicFromContext(context)
    : context.template.id === 'resource_compare'
      ? '资源对比分析'
      : `${context.template.title}: ${latestPrompt(context)}`;
  return [
    `# ${title}`,
    '',
    ...sections,
    '',
    '## 来源依据',
    citationList(context.capsule),
    '',
    '## 上下文摘录',
    snippets.length
      ? snippets.map((snippet, index) => `### 片段 ${index + 1}\n${snippet}`).join('\n\n')
      : '当前上下文证据不足，请扩大到当前 Workbench 或 Workspace 后重新生成。',
    '',
    '## 下一步建议',
    '- 检查资源是否覆盖当前学习目标。',
    '- 若仍有薄弱点，继续生成诊断练习或易错点讲解。',
    '- 使用后把结果反馈给系统，以便更新下一次推荐。'
  ].join('\n');
};

const fallbackTextResource = (context: StudioGenerationContext) => {
  const topic = topicFromContext(context);
  const snippets = evidenceSnippets(context.capsule, 4);
  if (context.template.id === 'pure_markdown_notes') {
    return fallbackMarkdown(context, [
      '## 知识总览',
      snippets.length
        ? snippets.map((snippet, index) => `- 资料片段 ${index + 1}：${snippet}`).join('\n')
        : `- 当前围绕「${topic}」的可用资源证据不足，请选择或上传更多 sources。`,
      '',
      '## 分节笔记',
      snippets.length
        ? snippets.map((snippet, index) => `### 片段 ${index + 1}\n${snippet}`).join('\n\n')
        : `### ${topic}\n暂无可展开全文。`,
      '',
      '## 复习问题',
      '- 这份资料的核心主题是什么？',
      '- 哪些定义、步骤或例子需要回到原文复习？'
    ]);
  }
  if (context.template.id === 'pagelm_cornell_notes') {
    return renderPageLmCornellMarkdown(context, {
      title: topic,
      notes: snippets.length
        ? snippets.map((snippet, index) => `Source note ${index + 1}: ${snippet}`).join('\n\n')
        : `The selected sources did not provide enough extractable text for detailed Cornell notes on "${topic}".`,
      summary: snippets.length
        ? `These notes organize the selected material around ${topic}.`
        : 'Evidence is insufficient; choose a text-rich source and generate again.',
      questions: ['What is the central idea of this source?', 'Which details need review before applying the concept?'],
      answers: [
        snippets[0] || topic,
        snippets[1] || 'Return to the original source and verify definitions, examples, and steps.'
      ]
    });
  }
  if (context.template.id === 'resource_to_notes') {
    return fallbackMarkdown(context, [
      '## 资源摘要',
      snippets.length
        ? snippets.map((snippet, index) => `- 资源片段 ${index + 1}：${snippet}`).join('\n')
        : `- 当前围绕「${topic}」的可用资源证据不足，请选择或上传更多 sources。`,
      '',
      '## 结构化笔记',
      `### ${topic}`,
      '- 核心问题：这份资源主要解释了什么问题、对象或流程。',
      '- 关键概念：从资料中抽取定义、术语、变量、条件或结论。',
      '- 关键步骤：按资源顺序整理过程、推导、操作或论证链。',
      '',
      '## 重点摘录',
      snippets.slice(0, 3).map((snippet, index) => `> [S${index + 1}] ${snippet}`).join('\n\n') || '> 暂无可引用片段。',
      '',
      '## 待确认问题',
      '- 哪些概念需要回到原文再次确认？',
      '- 哪些步骤适合继续生成练习或可视化？'
    ]);
  }
  if (context.template.id === 'resource_compare') {
    return fallbackMarkdown(context, [
      '## 资源列表',
      snippets.length
        ? snippets.map((snippet, index) => `- 资源 ${index + 1}：${snippet.slice(0, 220)}`).join('\n')
        : '- 当前可用资源不足，建议至少选择两个 sources 再做对比。',
      '',
      '## 对比维度',
      '| 维度 | 资源 A | 资源 B/其他资源 | 学习意义 |',
      '| --- | --- | --- | --- |',
      `| 主题覆盖 | ${topic} 的核心内容 | 补充、例子或不同侧重点 | 先建立共同框架，再补差异 |`,
      '| 结构顺序 | 按资源原顺序理解 | 对照另一资源的组织方式 | 找到更适合复习的顺序 |',
      '| 证据/例子 | 资料中的主要片段 | 其他资料的佐证或反例 | 用多来源检查理解是否稳定 |',
      '',
      '## 共同点',
      '- 标出多个资源都支持的核心概念和结论。',
      '',
      '## 差异与缺口',
      '- 标出只有某一个资源提到、但另一个资源缺失的概念、步骤或例子。',
      '- 如果不同资源表达冲突，回到原文确认定义、前提和适用范围。',
      '',
      '## 合并后的笔记骨架',
      '1. 共同核心概念',
      '2. 资源 A 的优势内容',
      '3. 资源 B/其他资源的补充内容',
      '4. 仍需确认的问题'
    ]);
  }
  return fallbackMarkdown(context, [
    '## 适用对象',
    '适合正在建立概念理解、需要把资料内容转成自己语言的学习者。',
    '',
    '## 核心直觉',
    `学习「${topic}」时，不要先背结论，而要先确认它解决什么问题、依赖哪些条件、输出什么结果。`,
    '',
    '## 关键概念',
    snippets.length
      ? snippets.map((snippet, index) => `### 概念 ${index + 1}\n${snippet}`).join('\n\n')
      : `围绕「${topic}」提取定义、条件、步骤和例子。`,
    '',
    '## 例子或类比',
    `把「${topic}」看成一个“输入条件 -> 判断步骤 -> 输出结论”的过程，每一步都要能回到课程资料找到依据。`,
    '',
    '## 检查问题',
    `1. 你能用一句话解释「${topic}」解决的问题吗？`,
    '2. 你能指出一个适用条件和一个常见误区吗？'
  ]);
};

const fallbackStudyPlan = (context: StudioGenerationContext) => {
  const topic = topicFromContext(context);
  const parentPlan = context.enrichment?.parentPlan as any;
  const parentStep = Array.isArray(parentPlan?.steps) ? parentPlan.steps[0] : null;
  return JSON.stringify({
    objective: latestPrompt(context) || `围绕「${topic}」制定当前 Workbench 子规划`,
    parentPlan,
    tasks: [
      {
        day: '今天',
        title: '对齐父规划和当前上下文',
        action: parentStep?.title || `阅读当前资料，确认「${topic}」的目标知识点、薄弱点和可用资源。`,
        resources: parentPlan?.candidateResources?.[0]?.title || '当前 Workbench 资料',
        acceptance: '能说明当前子规划服务于父规划中的哪个目标，并列出 2 个检查问题。',
        feedback: '记录为 studio.plan_aligned 学习事件。'
      },
      {
        day: '第 2 天',
        title: '生成资源并完成一次证据闭环',
        action: '生成讲解、思维导图或诊断题，并完成一次自测或复盘。',
        resources: 'AI Studio 生成资源',
        acceptance: '至少有一个 artifact 和一个自测/复盘结果。',
        feedback: '把错因或掌握证据回写 learner state。'
      },
      {
        day: '第 3 天',
        title: '判断推进或补强',
        action: '根据自测表现决定进入父规划下一步，或继续生成错因专项/Flashcards。',
        resources: 'Workspace 父规划 + Studio Artifact',
        acceptance: '写出推进/补强决策和理由。',
        feedback: '触发下一轮 Studio 推荐。'
      }
    ],
    risks: [
      '如果当前资料证据不足，先补充资源或生成拓展阅读。',
      '如果诊断题错误集中，暂停推进父规划，先做局部补强。'
    ],
    reflectionQuestions: [
      '当前任务对应父规划的哪个目标？',
      '我今天产生了哪些可观察学习证据？',
      '下一步应该推进、复习还是补资料？'
    ]
  }, null, 2);
};

const optionCount = (context: StudioGenerationContext, key: string, fallback: number) => {
  const value = Number(context.input.options?.[key]);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 30) : fallback;
};

const sourceRefs = (capsule: ContextCapsule) =>
  capsule.citations.slice(0, 4).map((citation) => ({
    title: citation.label,
    sourceId: citation.sourceId,
    snippet: citation.preview || citation.supportSnippets?.[0]?.text || ''
  }));

type PageLmCornellNotesPayload = {
  title?: string;
  notes?: string;
  summary?: string;
  questions?: unknown[];
  answers?: unknown[];
};

const pageLmCornellNotesSchema = {
  type: 'object',
  required: ['title', 'notes', 'summary', 'questions', 'answers'],
  properties: {
    title: { type: 'string' },
    notes: { type: 'string' },
    summary: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
    answers: { type: 'array', items: { type: 'string' } }
  }
};

const cleanCornellText = (value: unknown, maxLength = 12000) =>
  clip(String(value || '').replace(/\r\n/g, '\n').trim(), maxLength);

const normalizeCornellList = (value: unknown, maxItems = 12) =>
  (Array.isArray(value) ? value : [])
    .map((item) => cleanCornellText(item, 900))
    .filter(Boolean)
    .slice(0, maxItems);

const selectedResourceIdsForContext = (context: StudioGenerationContext) =>
  [
    ...new Set(
      (context.input.context.selectedResourceIds || [])
        .filter((value): value is string => typeof value === 'string' && Boolean(value))
    )
  ];

const videoAnalysisText = (file: any) => {
  try {
    const metadata = file.metadataJson ? JSON.parse(file.metadataJson) : {};
    const analysis = metadata.videoAnalysis && typeof metadata.videoAnalysis === 'object' ? metadata.videoAnalysis : null;
    if (!analysis) return '';
    const transcript = Array.isArray(analysis.transcript)
      ? analysis.transcript.map((item: any) => `[${item.start ?? ''}] ${item.text || item.content || ''}`).join('\n')
      : '';
    const chapters = Array.isArray(analysis.chapters)
      ? analysis.chapters.map((item: any) => `${item.title || ''}\n${item.summary || ''}`).join('\n\n')
      : '';
    const keyPoints = Array.isArray(analysis.keyPoints)
      ? analysis.keyPoints.map((item: any) => `${item.concept || item.title || ''}: ${item.explanation || item.summary || ''}`).join('\n')
      : '';
    return [analysis.title ? `Title: ${analysis.title}` : '', analysis.summary || '', chapters, keyPoints, transcript]
      .filter(Boolean)
      .join('\n\n');
  } catch {
    return '';
  }
};

const readSelectedSourceFullText = async (workspaceId: string, file: any) => {
  const videoText = videoAnalysisText(file);
  if (videoText.trim()) return videoText;
  try {
    return await FileSystemService.getFileContent(workspaceId, file.id);
  } catch {
    const extracted = await documentTextExtractionService.extract(file).catch(() => null);
    return extracted?.text || '';
  }
};

const selectedSourceFullTexts = async (context: StudioGenerationContext) => {
  const ids = selectedResourceIdsForContext(context);
  if (!ids.length) return [];
  const files = await prisma.fileSystemObject.findMany({
    where: {
      workspaceId: context.input.workspaceId,
      id: { in: ids },
      nodeType: 'file'
    }
  });
  const byId = new Map(files.map((file) => [file.id, file] as const));
  return Promise.all(
    ids.map(async (id, index) => {
      const file = byId.get(id);
      if (!file) {
        return { id, name: `Selected source ${index + 1}`, path: '', content: '' };
      }
      const content = await readSelectedSourceFullText(context.input.workspaceId, file);
      return {
        id: file.id,
        name: file.name,
        path: file.path,
        content: String(content || '').trim()
      };
    })
  );
};

const renderPageLmCornellMarkdown = (
  context: StudioGenerationContext,
  payload: PageLmCornellNotesPayload
) => {
  const title = cleanCornellText(payload.title, 120) || topicFromContext(context) || 'PageLM Notes';
  const notes = cleanCornellText(payload.notes, 20000);
  const summary = cleanCornellText(payload.summary, 4000);
  const questions = normalizeCornellList(payload.questions);
  const answers = normalizeCornellList(payload.answers);
  const count = Math.max(questions.length, answers.length);
  const qna = Array.from({ length: count })
    .map((_, index) => {
      const question = questions[index] || `Review question ${index + 1}`;
      const answer = answers[index] || '';
      return [`### ${index + 1}. ${question}`, answer ? `Answer: ${answer}` : 'Answer:'].join('\n');
    })
    .join('\n\n');

  return [
    `# ${title}`,
    '',
    '## Cornell Notes',
    notes || 'No detailed notes were generated from the selected sources.',
    '',
    '## Summary',
    summary || 'No summary was generated.',
    '',
    '## Review Questions',
    qna || '- No review questions were generated.',
    '',
    '## Sources',
    citationList(context.capsule)
  ].join('\n');
};

const selectedSourcesMarkdownBlock = (sources: Awaited<ReturnType<typeof selectedSourceFullTexts>>) =>
  sources.map((source, index) => [
    `## Source ${index + 1}: ${source.name}`,
    source.path ? `Path: ${source.path}` : '',
    '',
    source.content || '(empty source text)'
  ].filter(Boolean).join('\n')).join('\n\n---\n\n');

const pureMarkdownNotesPrompt = (
  userRequirement: string,
  sources: Awaited<ReturnType<typeof selectedSourceFullTexts>>
) => [
  '请根据下面用户勾选的资料全文，整理成一份高质量 Markdown 学习笔记。',
  '',
  '要求：',
  '- 只使用下面的资料全文和用户要求。',
  '- 直接输出 Markdown，不要输出 JSON，不要解释生成过程。',
  '- 不要写成摘要，要写成可学习、可复习、可继续编辑的笔记。',
  '- 尽量保留原文结构、标题层级、术语、定义、步骤、公式、例子和关键细节。',
  '- 如果原文很短，可以补充必要解释、例子、易错点和复习问题，让笔记比原文更适合学习。',
  '- 笔记长度原则上不要短于原文；不要过度压缩。',
  '- 推荐结构：标题、知识总览、分节笔记、关键概念、例子/步骤/公式、易错点、复习问题。',
  '',
  userRequirement ? `用户要求：\n${userRequirement}` : '用户要求：整理成学习笔记。',
  '',
  '# 用户勾选资料全文',
  selectedSourcesMarkdownBlock(sources)
].join('\n');

const fallbackQuiz = (context: StudioGenerationContext) => {
  const topic = topicFromContext(context);
  const contract = parsePracticeRequestContract({
    prompt: latestPrompt(context),
    options: context.input.options || {},
    templateId: context.template.id,
    defaultOptions: context.template.defaultOptions
  });
  const count = contract.questionCount || optionCount(context, 'questionCount', 6);
  const refs = sourceRefs(context.capsule);
  const tiers = ['基础理解', '关键判断', '迁移应用'];
  const typeSequence = contract.questionTypes.length
    ? reconcileQuizWithPracticeContract({ questions: [] }, contract, topic).questions.map((question: any) => question.type)
    : [];
  const questions = Array.from({ length: count }).map((_, index) => {
    const type = typeSequence[index] || (index % 3 === 0 ? 'single_choice' : index % 3 === 1 ? 'fill_blank' : 'short_answer');
    const tier = tiers[index % tiers.length];
    const base = {
      id: `q${index + 1}`,
      type,
      difficulty: index < 2 ? 'easy' : index < 5 ? 'medium' : 'hard',
      skill: `${topic}：${tier}`,
      conceptId: topic,
      objectiveId: `${context.template.id}:${tier}`,
      tier,
      knowledgePoints: [topic, tier],
      learningObjective: `检查学生是否能完成「${tier}」。`,
      commonMistake: '只背结论而没有结合条件、步骤或来源证据。',
      sourceRefs: refs
    };
    if (type === 'single_choice' || type === 'multiple_choice' || type === 'true_false') {
      return {
        ...base,
        question: type === 'true_false'
          ? `判断正误：学习「${topic}」时，应结合来源证据说明关键条件和步骤。`
          : `关于「${topic}」，下面哪一项最符合当前资料支持的学习要求？`,
        options: [
          { id: 'A', text: '能说明核心概念，并结合条件或来源证据解释。' },
          { id: 'B', text: '只记住标题，不需要理解过程。' },
          { id: 'C', text: '忽略前置条件，直接套用结论。' },
          { id: 'D', text: '不需要练习或复盘。' }
        ],
        answer: 'A',
        rubric: '选择 A，并能解释为什么需要结合概念、条件和来源证据。',
        explanation: '诊断题先检查是否理解学习任务，而不是只背表层词语。',
        hint: '注意题干问的是“符合资料支持的学习要求”。'
      };
    }
    if (type === 'fill_blank') {
      return {
        ...base,
        question: `请写出「${topic}」学习中最需要优先掌握的一个关键词或步骤。`,
        answer: topic,
        acceptableAnswers: [topic],
        rubric: '答案应与当前主题、关键步骤或来源材料中的核心概念相关。',
        explanation: '填空题用于检查能否主动回忆关键术语。',
        hint: '从当前资料标题、核心概念或步骤中寻找。'
      };
    }
    if (type === 'error_analysis') {
      return {
        ...base,
        question: `某同学学习「${topic}」时直接套用结论，没有检查前置条件。请指出这个错误属于哪类错因，并说明如何纠正。`,
        answer: '错因是忽略适用条件或中间验证。纠正时应先列出输入条件，再逐步检查定义、步骤和来源依据。',
        rubric: '回答应包含错误现象、错误原因、正确步骤和一个防止复犯的方法。',
        explanation: '错因专项训练的重点不是得到答案，而是识别错误为什么发生。',
        hint: '先问：这个结论成立需要哪些条件？'
      };
    }
    if (type === 'application') {
      return {
        ...base,
        question: `请设计一个关于「${topic}」的小场景，并说明如何用当前资料中的步骤完成判断或解释。`,
        answer: evidenceSnippets(context.capsule, 1)[0] || topic,
        rubric: '应包含场景、输入条件、判断步骤、输出结论和来源依据。',
        explanation: '应用题检查能否把知识迁移到新情境。',
        hint: '按“场景 -> 条件 -> 步骤 -> 结论”的顺序组织。'
      };
    }
    return {
      ...base,
      question: `请用自己的话解释「${topic}」的一个关键概念，并说明它为什么重要。`,
      answer: evidenceSnippets(context.capsule, 1)[0] || topic,
      rubric: '回答应包含定义、重要性、一个条件/步骤/例子，以及来源依据。',
      explanation: '简答题用于检查语义理解和迁移解释能力。',
      hint: '可以按“是什么 -> 为什么重要 -> 例子/条件”的顺序回答。'
    };
  });
  const title = `${topic}练习`;
  return JSON.stringify({ title, questions }, null, 2);
};

const fallbackMindMap = (context: StudioGenerationContext) => {
  const topic = topicFromContext(context);
  const refs = context.capsule.citations.slice(0, 3).map((citation) => citation.sourceId).filter(Boolean);
  const isKnowledgeGraph = context.template.id === 'knowledge_graph';
  const graph = isKnowledgeGraph
    ? {
        nodes: [
          { id: 'n1', label: topic, group: 'core', importance: 1, summary: '中心学习主题', sourceRefs: refs },
          { id: 'n2', label: '核心概念', group: 'concept', importance: 0.86, summary: '需要先理解的定义和术语', sourceRefs: refs },
          { id: 'n3', label: '关键步骤', group: 'process', importance: 0.8, summary: '解决问题或推理的主要步骤', sourceRefs: refs },
          { id: 'n4', label: '易错点', group: 'pitfall', importance: 0.75, summary: '常见误判或遗漏条件', sourceRefs: refs },
          { id: 'n5', label: '练习路径', group: 'practice', importance: 0.68, summary: '诊断、分层练习和复盘', sourceRefs: refs }
        ],
        links: [
          { source: 'n1', target: 'n2', label: '包含', type: 'contains', weight: 0.8 },
          { source: 'n2', target: 'n3', label: '支撑', type: 'supports', weight: 0.74 },
          { source: 'n3', target: 'n4', label: '暴露', type: 'reveals', weight: 0.7 },
          { source: 'n4', target: 'n5', label: '驱动', type: 'drives', weight: 0.66 }
        ]
      }
    : {
        nodes: [
          { id: 'n1', label: topic, group: 'core', importance: 1, summary: '中心学习主题', sourceRefs: refs },
          { id: 'n2', label: '核心定义', group: 'definition', importance: 0.9, summary: '需要先说清的定义和边界', sourceRefs: refs },
          { id: 'n3', label: '适用条件', group: 'condition', importance: 0.84, summary: '判断概念或方法是否成立的前提', sourceRefs: refs },
          { id: 'n4', label: '结构关系', group: 'relation', importance: 0.8, summary: '概念之间的包含、对比或依赖关系', sourceRefs: refs },
          { id: 'n5', label: '方法步骤', group: 'method', importance: 0.76, summary: '解决问题时可执行的步骤', sourceRefs: refs },
          { id: 'n6', label: '典型例子', group: 'example', importance: 0.68, summary: '帮助迁移理解的例子或应用场景', sourceRefs: refs },
          { id: 'n7', label: '常见误区', group: 'pitfall', importance: 0.72, summary: '容易混淆、遗漏或误判的位置', sourceRefs: refs },
          { id: 'n8', label: '复习抓手', group: 'review', importance: 0.64, summary: '用于回忆、练习和复盘的检查点', sourceRefs: refs }
        ],
        links: [
          { source: 'n1', target: 'n2', label: '定义为', type: 'contains', weight: 0.84 },
          { source: 'n2', target: 'n3', label: '受限于', type: 'prerequisite', weight: 0.78 },
          { source: 'n3', target: 'n5', label: '决定', type: 'supports', weight: 0.72 },
          { source: 'n4', target: 'n5', label: '组织', type: 'supports', weight: 0.7 },
          { source: 'n5', target: 'n6', label: '迁移到', type: 'applies_to', weight: 0.64 },
          { source: 'n7', target: 'n3', label: '常忽略', type: 'pitfall', weight: 0.68 },
          { source: 'n8', target: 'n7', label: '修正', type: 'remediation', weight: 0.62 }
        ]
      };
  return [
    '```mermaid',
    'mindmap',
    `  root((${topic}))`,
    ...(isKnowledgeGraph
      ? [
          '    概念节点',
          '      核心概念',
          '      前置知识',
          '      相邻概念',
          '    关系边',
          '      包含关系',
          '      依赖关系',
          '      对比关系',
          '    学习路径',
          '      先修节点',
          '      关键节点',
          '      验收节点'
        ]
      : [
          '    核心概念',
          '      核心定义',
          '      适用条件',
          '      边界例外',
          '    结构关系',
          '      包含关系',
          '      对比关系',
          '      前后依赖',
          '    方法步骤',
          '      输入信息',
          '      判断过程',
          '      输出结论',
          '    应用例子',
          '      典型场景',
          '      迁移问题',
          '    易错点',
          '      忽略前提',
          '      混淆概念',
          '      跳过验证',
          '    复习抓手',
          '      自测问题',
          '      记忆线索',
          '      复盘总结'
        ]),
    '```',
    '',
    '```concept_graph',
    JSON.stringify(graph, null, 2),
    '```',
    '',
    '## 大纲',
    isKnowledgeGraph ? '- 先确认核心概念和适用条件。' : '- 先确认核心定义、适用条件和边界例外。',
    isKnowledgeGraph ? '- 再梳理步骤、关系和常见误区。' : '- 再把结构关系、方法步骤和应用例子连接起来。',
    isKnowledgeGraph ? '- 最后用练习路径形成闭环。' : '- 最后用易错点和复习抓手形成可回忆的闭环。',
    '',
    '## 来源说明',
    citationList(context.capsule)
  ].join('\n');
};

const fallbackFlashcards = (context: StudioGenerationContext) => {
  const topic = topicFromContext(context);
  if (context.template.id === 'quick_review_sheet') {
    return fallbackMarkdown(context, [
      '## 速记清单',
      `围绕「${topic}」保留最需要在复习前快速唤起的内容。`,
      '',
      '### 必背定义',
      `- 用自己的话解释「${topic}」解决的问题。`,
      '- 写出适用条件、关键步骤和输出结论。',
      '',
      '### 易错提醒',
      '- 不要跳过前置条件。',
      '- 不要只背结论，要能解释中间步骤。',
      '- 遇到边界情况时，用反例检查。',
      '',
      '### 5 分钟自测',
      '1. 写出一个核心概念。',
      '2. 写出一个常见错误。',
      '3. 用一个例子说明正确步骤。'
    ]);
  }
  if (context.template.id === 'review_plan') {
    return fallbackMarkdown(context, [
      '## 复习目标',
      `在 7 天内把「${topic}」从“看懂”推进到“能回忆、能解释、能做题”。`,
      '',
      '## 间隔复习安排',
      '| 时间 | 任务 | 验收方式 |',
      '| --- | --- | --- |',
      '| 今天 | 阅读资料并生成 8 张卡片 | 能回答基础定义 |',
      '| 第 2 天 | 完成诊断题并标记错因 | 找到 1-2 个薄弱点 |',
      '| 第 4 天 | 做分层练习 | 正确解释关键步骤 |',
      '| 第 7 天 | 完成模拟测验和复盘 | 输出复盘报告 |',
      '',
      '## 错题回看',
      '- 每道错题记录：错误现象、错因、正确步骤、复发提醒。',
      '- 对重复错因生成“错因专项训练”。'
    ]);
  }
  const snippets = evidenceSnippets(context.capsule, 10);
  const refs = sourceRefs(context.capsule);
  return [
    `# Flashcards: ${topic}`,
    '',
    '## 卡组说明',
    '这组卡片优先覆盖定义、步骤、对比、易错点和应用场景。',
    '',
    ...(snippets.length ? snippets : [topic]).slice(0, optionCount(context, 'cardCount', 12)).map((snippet, index) =>
      [
        `## Card ${index + 1}`,
        '',
        `Front: ${index === 0 ? `如何解释「${topic}」的核心概念？` : `这个片段支持了哪个关键知识点？`}`,
        '',
        `Back: ${snippet}`,
        '',
        `Concept: ${index === 0 ? topic : `来源要点 ${index + 1}`}`,
        '',
        `Difficulty: ${index < 4 ? 'medium' : 'hard'}`,
        '',
        `Source: ${refs.map((ref) => ref.sourceId || ref.title).filter(Boolean).join(', ') || 'Context'}`
      ].join('\n')
    )
  ].join('\n');
};

const fallbackCodeLab = (context: StudioGenerationContext) =>
  fallbackMarkdown(context, [
    '## 实验目标',
    `围绕「${latestPrompt(context)}」完成一个可运行或可推演的小实验。`,
    '',
    '## Starter Code',
    '```ts',
    'type Input = Record<string, unknown>;',
    '',
    'export function solve(input: Input) {',
    '  // TODO: 根据课程资料补全核心步骤',
    '  return { ok: false, reason: "not implemented" };',
    '}',
    '```',
    '',
    '## TODO',
    '1. 标出输入条件和输出目标。',
    '2. 补全核心判断步骤。',
    '3. 写出至少 2 个正常样例和 1 个边界样例。',
    '',
    '## 调试提示',
    '- 先验证前置条件，再执行核心算法。',
    '- 每一步输出中间状态，检查是否与资料中的定义一致。',
    '',
    '## 验收标准',
    '- 能解释每个变量或步骤的含义。',
    '- 能通过基础样例和边界样例。',
    '- 能指出一个常见错误及修复方式。'
  ]);

const fallbackSlides = (context: StudioGenerationContext) => {
  const topic = latestPrompt(context);
  return [
    `# ${topic}`,
    '',
    '- 学习目标',
    '- 当前知识位置',
    '- 本节课要解决的问题',
    '',
    'Notes: 用一个真实问题引入主题。',
    '',
    '---',
    '',
    '## 核心概念',
    '',
    '- 定义',
    '- 条件',
    '- 关键关系',
    '',
    'Notes: 每个概念都要结合来源材料说明。',
    '',
    '---',
    '',
    '## 易错点与检查',
    '',
    '- 常见误区',
    '- 判断步骤',
    '- 自测问题',
    '',
    'Notes: 让学生先判断，再展示答案。',
    '',
    '---',
    '',
    '## 下一步',
    '',
    '- 完成诊断题',
    '- 生成 Flashcards',
    '- 做一次复盘',
    '',
    'Notes: 形成学习闭环。',
    '',
    '## 来源',
    citationList(context.capsule)
  ].join('\n');
};

const fallbackByGenerator: Record<StudioGeneratorKind, (context: StudioGenerationContext) => string> = {
  text: fallbackTextResource,
  structure: fallbackMindMap,
  assessment: fallbackQuiz,
  memory: fallbackFlashcards,
  code_lab: fallbackCodeLab,
  multimodal: (context) => {
    if (context.template.id === 'slide_deck') return fallbackSlides(context);
    const storyboardMarkdown = fallbackMarkdown(context, [
      '## 分镜脚本',
      `主题：${latestPrompt(context)}`,
      '',
      '| 时间 | 画面 | 旁白 | 互动 |',
      '| --- | --- | --- | --- |',
      '| 0:00-0:30 | 展示问题场景 | 引出学习目标 | 让学生预测答案 |',
      '| 0:30-2:00 | 拆解核心概念 | 解释定义和条件 | 暂停自测 |',
      '| 2:00-4:00 | 动画演示步骤 | 展示关键变化 | 选择下一步 |',
      '| 4:00-5:00 | 总结易错点 | 给出复盘任务 | 完成一道小题 |'
    ]);
    if (context.template.id === 'visual_explainer') {
      const answerMarkdown = fallbackMarkdown(context, [
        '## 核心回答',
        `围绕「${latestPrompt(context)}」先给出完整解释，保留结论、背景、步骤、例子和检查问题。`,
        '',
        '## 关键结构',
        '- 第一部分建立问题和核心结论。',
        '- 第二部分拆解概念或机制。',
        '- 第三部分用步骤、对比或例子说明变化。',
        '- 最后一部分总结自检问题。',
        '',
        '## 视觉化方向',
        '- 每个 section 聚焦一个讲解目标。',
        '- section 内部用出现、高亮、连接、注释表达动画。'
      ]);
      return JSON.stringify(buildFallbackVisualExplainer(context, answerMarkdown), null, 2);
    }
    return storyboardMarkdown;
  },
  planning: (context) =>
    context.template.id === 'study_plan' ? fallbackStudyPlan(context) : fallbackMarkdown(context, [
      '## 学习目标',
      `围绕「${latestPrompt(context)}」建立可执行计划。`,
      '',
      '## 三阶段安排',
      '1. 诊断：完成基础题，定位薄弱点。',
      '2. 学懂：生成讲解或思维导图，补齐概念。',
      '3. 巩固：完成分层练习，复盘错因。',
      '',
      '## 每日任务',
      '- 20 分钟阅读资料和整理问题。',
      '- 20 分钟完成练习。',
      '- 10 分钟复盘并更新下一步。'
    ]),
  review: (context) =>
    fallbackMarkdown(context, [
      '## 质量审查',
      '该模板用于检查资源是否有来源依据、是否符合学习目标、是否有下一步建议。'
    ])
};

const buildSchemaHint = (template: StudioResourceTemplate) => {
  if (template.renderer === 'quiz') {
    return {
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
          conceptId: 'stable course concept id or canonical concept name',
          objectiveId: 'learning objective id or concise objective label',
          tier: 'diagnostic | basic | intermediate | application | mistake | mock',
          difficulty: 'easy | medium | hard',
          explanation: 'string',
          hint: 'one short solving cue for this exact question; point to the next reasoning step, no metadata/source/difficulty labels',
          knowledgePoints: ['string'],
          learningObjective: 'string',
          commonMistake: 'string',
          sourceRefs: [{ title: 'string', snippet: 'string' }]
        }
      ]
    };
  }
  if (template.renderer === 'flashcards') {
    return {
      title: 'string',
      description: 'string',
      cards: [
        {
          id: 'string',
          front: 'short active-recall question, not a title, never the raw user request',
          back: 'answer plus brief explanation grounded in sources',
          cardType: 'basic | reverse | cloze | mcq | concept',
          difficulty: 'easy | medium | hard',
          concept: 'course concept or knowledge point',
          explanation: 'optional brief explanation; it will be merged into back',
          tags: ['string'],
          sourceRefs: [{ sourceId: 'string', title: 'string', snippet: 'string' }]
        }
      ]
    };
  }
  if (template.renderer === 'visual_explainer') {
    return VISUAL_EXPLAINER_SCHEMA_HINT;
  }
  if (
    template.renderer === 'interactive_html' ||
    template.renderer === 'manim_script' ||
    template.renderer === 'remotion_source'
  ) {
    return {
      teachingPlan: {
        learningObjectives: ['string'],
        coreConcepts: ['string'],
        prerequisites: ['string'],
        misconceptions: ['string'],
        explanationStrategy: ['string'],
        assessmentCheckpoints: ['string']
      },
      processTrace: {
        domain: 'sequence | graph | table | state_machine | formula | hybrid',
        title: 'string',
        initialState: {},
        stateModel: {
          primitives: [
            {
              id: 'string',
              kind: 'sequence | graph | table | state_machine | formula | variables | text',
              label: 'string',
              role: 'string',
              data: {}
            }
          ],
          variables: [{ id: 'string', label: 'string', value: 'string', role: 'string' }]
        },
        steps: [
          {
            id: 'string',
            title: 'string',
            goal: 'string',
            operation: {
              type: 'initialize | inspect | compare | transition | update | emit | summarize',
              targetIds: ['string'],
              description: 'string'
            },
            statePatch: {},
            narration: 'string',
            observation: 'string',
            misconception: 'string',
            checkQuestion: 'string',
            visualCues: [
              {
                primitiveId: 'string',
                targetIds: ['string'],
                effect: 'focus | compare | update | create | remove | success | warning',
                label: 'string'
              }
            ]
          }
        ]
      },
      visualMapping: {
        layout: 'sequence | graph | table | state_machine | formula | hybrid',
        views: [{ id: 'string', primitiveId: 'string', kind: 'string', title: 'string', priority: 1 }],
        cueRules: [{ operation: 'string', effects: ['string'], description: 'string' }]
      }
    };
  }
  return { content: 'string', warnings: ['string'] };
};

const applyPracticeContract = (
  context: StudioGenerationContext,
  structured: StudioStructuredArtifact
): StudioStructuredArtifact => {
  if (context.template.renderer !== 'quiz') return structured;
  const contract = parsePracticeRequestContract({
    prompt: latestPrompt(context),
    options: context.input.options || {},
    templateId: context.template.id,
    defaultOptions: context.template.defaultOptions
  });
  const topic = topicFromContext(context);
  const payload = reconcileQuizWithPracticeContract(structured.payload as any, contract, topic);
  return {
    ...structured,
    payload: {
      ...payload,
      questionCount: payload.questions.length,
      requestContract: {
        questionCount: contract.questionCount,
        questionTypes: contract.questionTypes,
        questionTypeCounts: contract.questionTypeCounts,
        difficulty: contract.difficulty,
        explicit: contract.explicit
      }
    }
  } as StudioStructuredArtifact;
};

interface VisualExplainerPipelineStage {
  id: string;
  label: string;
  status: 'completed' | 'fallback';
  provider?: string;
  model?: string;
  durationMs: number;
  summary: string;
  error?: string;
  fallbackErrors?: string[];
}

const fallbackVisualMarkdownDraft = (context: StudioGenerationContext) => [
  `# ${latestPrompt(context)}`,
  '',
  '## 核心回答',
  `围绕「${latestPrompt(context)}」先给出完整解释，并保留结论、背景、步骤、例子和检查问题。`,
  '',
  '## 关键结构',
  '- 先建立问题和核心结论。',
  '- 再拆解概念、机制或条件。',
  '- 接着用步骤、对比或例子说明变化。',
  '- 最后总结自检问题。',
  '',
  '## 视觉化方向',
  '- 每个 section 聚焦一个讲解目标。',
  '- section 内部用出现、高亮、连接、注释表达动画。'
].join('\n');

const fallbackErrorText = (error: unknown) => error instanceof Error ? error.message : String(error);

const fallbackErrorsFromUsage = (usage: unknown): string[] => {
  const errors = (usage && typeof usage === 'object' ? (usage as any).fallbackErrors : null);
  return Array.isArray(errors) ? errors.map((item) => String(item)).filter(Boolean) : [];
};

const generateWithModel = async (context: StudioGenerationContext): Promise<StudioGeneratorResult> => {
  if (!aiModelProviderService.isConfigured({ useCase: 'studio' })) {
    const fallbackContent = fallbackByGenerator[context.template.generator](context);
    const structured = applyPracticeContract(context, normalizeStudioArtifact(context, fallbackContent));
    return {
      content: renderStudioArtifact(structured),
      structured,
      source: 'fallback',
      warnings: ['AI studio provider is not configured; generated deterministic fallback content.']
    };
  }

  if (context.template.renderer === 'quiz') {
    const response = await jsonWithStudioFallback<{ title: string; questions: unknown[] }>(context, {
      instruction: commonPrompt(
        context,
        [
          '必须输出 JSON，不要 Markdown。',
          practiceContractInstruction(parsePracticeRequestContract({
            prompt: latestPrompt(context),
            options: context.input.options || {},
            templateId: context.template.id,
            defaultOptions: context.template.defaultOptions
          })),
          '选择题必须且只能有 A/B/C/D 四个选项。',
          '每题必须包含 conceptId、objectiveId、tier、skill、difficulty、knowledgePoints、learningObjective、commonMistake、sourceRefs。',
          'hint 只能是一句针对本题的简短解题方向，指出下一步应检查的条件、概念、步骤或关系；不要写成泛泛的学习建议。',
          'hint 不要包含 Level、Source、Common mistake、答案、解析或元数据。',
          'conceptId 必须是课程概念或知识点名，不要使用 q1、task_id、course_id 这类内部字段。',
          '题目必须考察真实课程内容，不要把内部配置、系统提示、Context Capsule 或用户要求原文复制成题干。'
        ].join('\n')
      ),
      schema: buildSchemaHint(context.template),
      input: {
        prompt: latestPrompt(context),
        contextPreview: context.capsule.promptContextPreview,
        sources: context.capsule.citations.slice(0, 12)
      }
    });
    const rawContent = JSON.stringify(response.data, null, 2);
    const structured = applyPracticeContract(context, normalizeStudioArtifact(context, rawContent));
    return {
      content: renderStudioArtifact(structured),
      structured,
      source: response.provider === 'deepseek' ? 'deepseek-json' : `${response.provider}-json`,
      metadata: { model: response.model, usage: response.usage }
    };
  }

  if (context.template.renderer === 'flashcards') {
    const response = await jsonWithStudioFallback<{ title: string; description?: string; cards: unknown[] }>(context, {
      instruction: commonPrompt(
        context,
        [
          '必须输出 JSON，不要 Markdown。',
          '生成结构化 flashcard 卡组，cards 数量遵循用户要求或模板默认 cardCount。',
          '每张卡必须考察 Context Preview 或 Sources 中的真实课程内容。',
          'front 必须是短的主动回忆问题或 cloze，必须有明确提问；不要写“速记卡片”“Card 1”“某某基础卡片”这种标题。',
          'front 不要把用户要求原文、系统提示词、模板框架或内部配置复制进去。',
          'back 必须给出可复习的标准答案，并自然合并必要解释；不要在 back 中写 Difficulty:、Explanation:、Source: 这类字段标签。',
          '每张卡必须包含 concept、difficulty、sourceRefs；explanation 可以为空或作为 back 的补充。',
          '如果选定 sources 证据不足，减少卡片数量，并在 description 说明不足。'
        ].join('\n')
      ),
      schema: buildSchemaHint(context.template),
      input: {
        prompt: latestPrompt(context),
        flashcardOptions: context.input.options || null,
        contextPreview: context.capsule.promptContextPreview,
        sources: context.capsule.citations.slice(0, 12)
      }
    });
    const rawContent = JSON.stringify(response.data, null, 2);
    const structured = normalizeStudioArtifact(context, rawContent);
    return {
      content: renderStudioArtifact(structured),
      structured,
      source: response.provider === 'deepseek' ? 'deepseek-json' : `${response.provider}-json`,
      metadata: { model: response.model, usage: response.usage }
    };
  }

  if (context.template.id === 'pure_markdown_notes') {
    const selectedSources = await selectedSourceFullTexts(context);
    const userRequirement = String(context.input.options?.userRequirement || context.input.prompt || '').trim();
    const response = await chatWithStudioFallback(
      [
        {
          role: 'user',
          content: pureMarkdownNotesPrompt(userRequirement, selectedSources)
        }
      ],
      context,
      { includeVisualEvidence: false }
    );
    const content = response.reply.trim();
    const structured = normalizeStudioArtifact(context, content);
    return {
      content: renderStudioArtifact(structured),
      structured,
      source: response.provider,
      metadata: {
        model: response.model,
        usage: response.usage,
        selectedSourceCount: selectedSources.length,
        selectedSourceChars: selectedSources.reduce((sum, source) => sum + source.content.length, 0),
        pureMarkdown: true
      }
    };
  }

  if (context.template.id === 'pagelm_cornell_notes') {
    const selectedSources = await selectedSourceFullTexts(context);
    const userRequirement = String(context.input.options?.userRequirement || context.input.prompt || '').trim();
    const response = await jsonWithStudioFallback<PageLmCornellNotesPayload>(context, {
      instruction: [
        'You are a Cornell-style study notes generator.',
        '',
        'Goal: produce detailed study notes from the selected source text and the user request.',
        '',
        'Output only valid JSON. Do not include Markdown fences or prose outside JSON.',
        '',
        'Schema:',
        '{"title":"string","notes":"string","summary":"string","questions":["string"],"answers":["string"]}',
        '',
        'Rules:',
        '- Use only the selected source text plus the user request.',
        '- The notes field should be detailed and useful for learning: include definitions, concepts, steps, examples, formulas, contrasts, and important details when present.',
        '- The summary field should be concise.',
        '- Each question must have the answer at the same index in answers.',
        '- If the sources do not contain enough information, say so in summary and keep the notes conservative.'
      ].join('\n'),
      schema: pageLmCornellNotesSchema,
      input: {
        userRequest: userRequirement,
        selectedSources: selectedSources.map((source, index) => ({
          index: index + 1,
          id: source.id,
          name: source.name,
          path: source.path,
          text: source.content
        }))
      }
    }, { includeVisualEvidence: false });
    const content = renderPageLmCornellMarkdown(context, response.data || {});
    const structured = normalizeStudioArtifact(context, content);
    return {
      content: renderStudioArtifact(structured),
      structured,
      source: response.provider === 'deepseek' ? 'deepseek-json' : `${response.provider}-json`,
      metadata: {
        model: response.model,
        usage: response.usage,
        selectedSourceCount: selectedSources.length,
        selectedSourceChars: selectedSources.reduce((sum, source) => sum + source.content.length, 0),
        pageLmStylePayload: response.data
      }
    };
  }

  if (context.template.renderer === 'visual_explainer') {
    const userPrompt = latestPrompt(context);
    const selectedSources = await selectedSourceFullTexts(context);
    const visualStages: VisualExplainerPipelineStage[] = [];
    let markdownDraft = '';
    let markdownDraftProvider = 'fallback';
    let markdownDraftModel = '';
    let markdownUsage: unknown = null;

    const markdownStartedAt = Date.now();
    try {
      const markdownResponse = await chatWithStudioFallback(
        [
          {
            role: 'user',
            content: selectedSources.length
              ? visualExplainerSelectedSourcesMarkdownPrompt(userPrompt, selectedSources)
              : visualExplainerMarkdownPrompt(userPrompt)
          }
        ],
        context,
        { includeVisualEvidence: false, timeoutMs: VISUAL_EXPLAINER_STAGE_TIMEOUT_MS }
      );
      markdownDraft = extractVisualExplainerMarkdownDraft(markdownResponse.reply.trim());
      markdownDraftProvider = markdownResponse.provider;
      markdownDraftModel = markdownResponse.model;
      markdownUsage = markdownResponse.usage;
      visualStages.push({
        id: 'markdown',
        label: 'Markdown Draft',
        status: 'completed',
        provider: markdownResponse.provider,
        model: markdownResponse.model,
        durationMs: Date.now() - markdownStartedAt,
        summary: selectedSources.length
          ? 'Generated raw Markdown answer from selected source text only.'
          : 'Generated raw Markdown answer from user prompt only.',
        fallbackErrors: fallbackErrorsFromUsage(markdownResponse.usage)
      });
    } catch (error) {
      markdownDraft = fallbackVisualMarkdownDraft(context);
      visualStages.push({
        id: 'markdown',
        label: 'Markdown Draft',
        status: 'fallback',
        durationMs: Date.now() - markdownStartedAt,
        summary: 'Used deterministic Markdown draft because model generation failed.',
        error: fallbackErrorText(error)
      });
    }

    const runVisualJsonStage = async <T>(
      id: string,
      label: string,
      instruction: string,
      schema: Record<string, unknown>,
      input: Record<string, unknown>,
      normalize: (value: unknown) => T
    ): Promise<T> => {
      const startedAt = Date.now();
      try {
        const response = await jsonWithStudioFallback<Record<string, unknown>>(context, {
          instruction,
          schema,
          input
        }, { includeVisualEvidence: false, timeoutMs: VISUAL_EXPLAINER_STAGE_TIMEOUT_MS });
        const value = normalize(response.data);
        visualStages.push({
          id,
          label,
          status: 'completed',
          provider: response.provider,
          model: response.model,
          durationMs: Date.now() - startedAt,
          summary: `${label} generated structured output.`,
          fallbackErrors: fallbackErrorsFromUsage(response.usage)
        });
        return value;
      } catch (error) {
        const value = normalize({});
        visualStages.push({
          id,
          label,
          status: 'fallback',
          durationMs: Date.now() - startedAt,
          summary: `${label} used local normalization fallback.`,
          error: fallbackErrorText(error)
        });
        return value;
      }
    };

    const contentMap = await runVisualJsonStage(
      'content_map',
      'Content Map',
      visualExplainerContentMapPrompt,
      VISUAL_EXPLAINER_CONTENT_MAP_SCHEMA_HINT,
      {
        userPrompt,
        markdownDraft
      },
      (value) => normalizeVisualExplainerContentMap(context, value, markdownDraft)
    );

    const markdownBlocks = buildVisualExplainerMarkdownSourceBlocks(markdownDraft);
    const markdownBlockReferences = markdownBlocks.map((block) => ({
      id: block.id,
      title: block.title,
      sourcePreview: block.sourcePreview,
      keyPoints: block.keyPoints
    }));

    const sectionPlan = await runVisualJsonStage(
      'section_plan',
      'Section Plan',
      visualExplainerSectionPlanPrompt,
      VISUAL_EXPLAINER_SECTION_PLAN_SCHEMA_HINT,
      {
        userPrompt,
        markdownBlocks: markdownBlockReferences,
        contentMap
      },
      (value) => normalizeVisualExplainerSectionPlan(context, value, markdownDraft, contentMap, markdownBlocks)
    );

    const slideText = await runVisualJsonStage(
      'slide_text',
      'Slide Text',
      visualExplainerSlideTextPrompt,
      VISUAL_EXPLAINER_SLIDE_TEXT_SCHEMA_HINT,
      {
        userPrompt,
        markdownDraft: clip(markdownDraft, 7000),
        contentMap,
        sectionPlan
      },
      (value) => normalizeVisualExplainerSlideText(value, sectionPlan)
    );

    const visualIntent = await runVisualJsonStage(
      'visual_intent',
      'Visual Intent',
      visualExplainerVisualIntentPrompt,
      VISUAL_EXPLAINER_VISUAL_INTENT_SCHEMA_HINT,
      {
        userPrompt,
        sectionPlan,
        slideText
      },
      (value) => normalizeVisualExplainerVisualIntent(value, sectionPlan, slideText)
    );

    const rendererBlocks = await runVisualJsonStage(
      'renderer_blocks',
      'Renderer Blocks',
      visualExplainerRendererBlocksPrompt,
      VISUAL_EXPLAINER_RENDERER_BLOCK_SCHEMA_HINT,
      {
        userPrompt,
        markdownDraft: clip(markdownDraft, 6000),
        contentMap,
        sectionPlan,
        slideText,
        visualIntent
      },
      (value) => normalizeVisualExplainerRendererBlocks(value, sectionPlan, slideText, visualIntent)
    );

    const validationStartedAt = Date.now();
    const payload = buildVisualExplainerFromStages(
      context,
      markdownDraft,
      contentMap,
      sectionPlan,
      slideText,
      visualIntent,
      rendererBlocks
    );
    const validation = validateVisualExplainerPayload(payload);
    visualStages.push({
      id: 'validation',
      label: 'Validation',
      status: validation.valid ? 'completed' : 'fallback',
      durationMs: Date.now() - validationStartedAt,
      summary: validation.valid
        ? 'Validated final visual explainer payload.'
        : `Validated with ${validation.warnings.length} warnings.`,
      error: validation.valid ? undefined : validation.warnings.slice(0, 3).join(' | ')
    });

    const rawContent = JSON.stringify(payload, null, 2);
    const structured = normalizeStudioArtifact(context, rawContent);
    const fallbackStages = visualStages.filter((stage) => stage.status === 'fallback').map((stage) => stage.id);
    return {
      content: renderStudioArtifact(structured),
      structured,
      source: `${markdownDraftProvider}-visual-pipeline${fallbackStages.length ? '-partial-fallback' : ''}`,
      warnings: [
        ...fallbackStages.map((stage) => `Visual Explainer stage used fallback: ${stage}`),
        ...validation.warnings
      ],
      metadata: {
        model: markdownDraftModel,
        usage: markdownUsage,
        markdownDraftProvider,
        markdownDraftModel,
        selectedResourceIds: selectedSources.map((source) => source.id),
        selectedSourceCount: selectedSources.length,
        selectedSourceChars: selectedSources.reduce((sum, source) => sum + source.content.length, 0),
        visualLessonSchemaVersion: payload.visualLesson?.schemaVersion || null,
        visualExplainerPipeline: {
          schemaVersion: 'visual_explainer.pipeline.v1',
          stages: visualStages,
          fallbackStages,
          validation
        }
      }
    };
  }

  if (
    context.template.renderer === 'interactive_html' ||
    context.template.renderer === 'manim_script' ||
    context.template.renderer === 'remotion_source'
  ) {
    const response = await jsonWithStudioFallback<Record<string, unknown>>(context, {
      instruction: commonPrompt(
        context,
        [
          '必须输出 JSON，不要 Markdown。',
          '先产出教学理解层 teachingPlan，再产出过程表示层 processTrace，最后产出渲染映射层 visualMapping。',
          'processTrace 必须是可回放的步骤轨迹：每一步包含 operation、statePatch、narration、observation、visualCues。',
          'visualMapping 只能使用通用视觉 primitive：sequence、graph、table、state_machine、formula、variables、text。',
          '不要直接输出 HTML、CSS、p5、Manim 或 Remotion 源码；输出中间 IR，由系统渲染。'
        ].join('\n')
      ),
      schema: buildSchemaHint(context.template),
      input: {
        prompt: latestPrompt(context),
        contextPreview: context.capsule.promptContextPreview,
        sources: context.capsule.citations.slice(0, 12)
      }
    });
    const rawContent = JSON.stringify(response.data, null, 2);
    const structured = normalizeStudioArtifact(context, rawContent);
    return {
      content: renderStudioArtifact(structured),
      structured,
      source: response.provider === 'deepseek' ? 'deepseek-json' : `${response.provider}-json`,
      metadata: { model: response.model, usage: response.usage }
    };
  }

  const response = await chatWithStudioFallback(
    [
      {
        role: 'user',
        content: commonPrompt(
          context,
          context.template.id === 'mind_map'
            ? [
                '输出格式：先给一个 ```mermaid 代码块，第一行必须是 mindmap。',
                'mindmap 要有 4-6 个一级分支，覆盖核心概念、结构关系、方法步骤、应用例子、易错点和复习抓手；每个节点尽量短。',
                '然后给一个 ```concept_graph JSON 代码块，节点来自 mindmap 的关键概念，links 表达横向关系，不要只做根节点放射。',
                '最后给 ## 大纲 和 ## 来源说明。',
                'Mermaid 节点不要出现 [S1]、S1、文件名、页码或章节号；来源只出现在来源说明。'
              ].join('\n')
            : context.template.renderer === 'mermaid'
            ? [
                '输出格式：先给一个 ```mermaid 代码块，第一行必须是 mindmap。',
                '然后给一个 ```concept_graph JSON 代码块。',
                '最后给 ## 大纲 和 ## 来源说明。',
                'Mermaid 节点不要出现 [S1]、S1 这类来源编号。'
              ].join('\n')
            : context.template.id === 'resource_to_notes'
              ? [
                  '输出必须是可直接保存为 BlockSuite Notes 的 Markdown，不要解释你将如何生成。',
                  '不要把用户要求、提示词、模板名或“把这个视频整理成笔记”这类指令当作标题。',
                  'H1 必须来自 source 的真实主题、课程标题、章节标题或核心内容；无法判断时使用“Resource Notes”。',
                  '结构必须像可继续编辑的学习笔记，而不是报告：来源、速览、关键概念、结构化笔记、例子/公式/步骤、待回看问题。',
                  '如果 source 是视频或转写内容，优先保留章节/时间线、关键片段、概念解释和待回看时间点。',
                  '如果 source 是 PDF/文档，优先保留章节层级、定义、公式、例子、页码/来源提示。',
                  '不要出现“用户要求”“生成要求”“模板框架”“Context Capsule”等内部字样。'
                ].join('\n')
              : context.template.id === 'resource_compare'
                ? [
                    '输出必须是可直接保存的 Markdown 资源对比笔记，不要解释你将如何生成。',
                    '重点比较不同 sources，而不是生成单一概念讲解。',
                    '必须包含：资源列表、对比维度表、共同点、差异点、冲突/缺口、推荐阅读顺序、合并后的笔记骨架、来源依据。',
                    '不要把用户要求、提示词或模板名当作标题。'
                  ].join('\n')
                : '输出必须是可直接保存的资源内容，不要解释你将如何生成。'
        )
      }
    ],
    context
  );

  const structured = applyPracticeContract(context, normalizeStudioArtifact(context, response.reply.trim()));
  return {
    content: renderStudioArtifact(structured),
    structured,
    source: response.provider,
    metadata: { model: response.model, usage: response.usage }
  };
};

export const studioGeneratorRegistry = {
  async generate(context: StudioGenerationContext): Promise<StudioGeneratorResult> {
    try {
      return await generateWithModel(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        isRecoverableModelError(error) ||
        /AI Studio (model|JSON) generation failed/i.test(message)
      ) {
        throw error;
      }
      const fallbackContent = fallbackByGenerator[context.template.generator](context);
      const structured = applyPracticeContract(context, normalizeStudioArtifact(context, fallbackContent));
      return {
        content: renderStudioArtifact(structured),
        structured,
        source: `fallback:${message}`,
        warnings: ['Model generation failed; fallback content was used.']
      };
    }
  },

  async review(context: StudioGenerationContext, generated: StudioGeneratorResult) {
    const structured = applyPracticeContract(context, generated.structured || normalizeStudioArtifact(context, generated.content));
    const review = reviewStudioArtifact(context, structured, generated.warnings || []);
    if (context.template.renderer !== 'quiz') return review;

    const payload = structured.payload as any;
    const questions = Array.isArray(payload?.questions) ? payload.questions : [];
    const quality = await quizQualityService.review({ title: structured.title, questions } as any, context.capsule);
    const qualityWarnings = [
      ...quality.report.warnings,
      ...quality.report.issues.slice(0, 8).map((issue) => `${issue.questionId}: ${issue.message}`)
    ];
    const revisedContent = renderStudioArtifact({
      ...structured,
      payload: {
        ...payload,
        questions: quality.quiz.questions,
        questionCount: quality.quiz.questions.length,
        qualityReport: quality.report
      }
    } as any);
    const score = Math.min(review.score, quality.report.score);
    return {
      ...review,
      score,
      passed: review.passed && quality.report.score >= 0.66,
      warnings: Array.from(new Set([...review.warnings, ...qualityWarnings])),
      revisedContent,
      summary: `${review.summary} Quiz quality score=${quality.report.score.toFixed(2)}, kept ${quality.report.keptCount}/${quality.report.keptCount + quality.report.removedCount}.`
    };
  }
};
