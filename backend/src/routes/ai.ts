import { Router } from 'express';
import { Request, Response } from 'express';
import { multiAgentOrchestrator } from '../services/multiAgentOrchestrator';
import { aiModelProviderService } from '../services/aiModelProviderService';

const router = Router();

const WELCOME_ICON_KEYS = new Set([
  'summary',
  'translate',
  'analysis',
  'task',
  'outline',
  'question',
  'compare',
  'search',
  'practice',
  'plan'
]);

const trimText = (value: unknown, maxLength: number) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

const pickWelcomeIcon = (label: string, requested?: unknown) => {
  if (typeof requested === 'string' && WELCOME_ICON_KEYS.has(requested)) return requested;
  if (/翻译|translate/i.test(label)) return 'translate';
  if (/任务|跟踪|计划|下一步|todo/i.test(label)) return 'task';
  if (/提纲|结构|框架|outline/i.test(label)) return 'outline';
  if (/追问|问题|考点|quiz|question/i.test(label)) return 'question';
  if (/比较|对比|关联|compare/i.test(label)) return 'compare';
  if (/查找|定位|搜索|find|search/i.test(label)) return 'search';
  if (/练习|自测|刷题|practice/i.test(label)) return 'practice';
  if (/剖析|分析|深度|why|analysis/i.test(label)) return 'analysis';
  return 'summary';
};

const parseJsonObject = (value: string) => {
  const direct = value.trim();
  const fenced = direct.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || direct.match(/\{[\s\S]*\}/)?.[0] || direct;
  return JSON.parse(candidate);
};

router.post('/chat/welcome', async (req: Request, res: Response) => {
  const { context } = req.body ?? {};

  if (!context?.workspaceId) {
    return res.status(400).json({ error: 'context.workspaceId is required' });
  }

  const activePanel =
    Array.isArray(context.openPanels)
      ? context.openPanels.find((panel: any) => panel?.panelId === context.activePanelId) ||
        context.openPanels.find((panel: any) => panel?.fileId === context.activeFileId) ||
        context.openPanels[0]
      : null;
  const visibleContent = trimText(activePanel?.visibleContent || context.activeFileContent, 1200);
  const selectedText = trimText(activePanel?.selectedText || context.selectedText, 800);
  const prompt = [
    '为学习型 Workbench 的 AI Chat 起始页生成自然、友好、可点击的中文文案。',
    '只输出 JSON，不要 Markdown，不要解释。',
    'JSON 结构：{"greeting":"一句欢迎语","actions":[{"label":"动作文案","icon":"summary|translate|analysis|task|outline|question|compare|search|practice|plan"}]}',
    '要求：',
    '- greeting 像一个可靠的学习/研究助手，18 个中文字以内，可以每次略有变化。',
    '- actions 生成 3 到 4 条，每条 8 到 18 个中文字，必须能直接作为用户给 AI 的指令。',
    '- action 不要出现“当前文件”这种空泛词，尽量结合文件名、选区、可见内容或学习目标。',
    '- icon 必须和 label 语义匹配。',
    '- 不要使用全大写英文。',
    '',
    `Workbench：${trimText(context.workbenchTitle, 80) || '未命名'}`,
    context.workbenchDescription ? `说明：${trimText(context.workbenchDescription, 160)}` : '',
    activePanel?.fileName ? `当前文件：${trimText(activePanel.fileName, 120)}` : '',
    activePanel?.panelType ? `内容类型：${trimText(activePanel.panelType, 40)}` : '',
    selectedText ? `选区：${selectedText}` : '',
    visibleContent ? `可见内容：${visibleContent}` : '',
    Array.isArray(context.openPanels) && context.openPanels.length > 1
      ? `已打开资源：${context.openPanels.map((panel: any) => panel?.fileName).filter(Boolean).slice(0, 5).join('、')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const result = await aiModelProviderService.chat(
      [{ role: 'user', content: prompt }],
      undefined,
      { timeoutMs: 8000, useCase: 'chat' }
    );
    const parsed = parseJsonObject(result.reply);
    const greeting = trimText(parsed?.greeting, 32);
    const actions = Array.isArray(parsed?.actions)
      ? parsed.actions
          .map((item: any) => {
            const label = trimText(item?.label, 40);
            return label ? { label, icon: pickWelcomeIcon(label, item?.icon) } : null;
          })
          .filter(Boolean)
          .slice(0, 4)
      : [];

    if (!greeting || actions.length === 0) {
      return res.status(502).json({ error: 'AI welcome generation returned incomplete content' });
    }

    return res.json({
      greeting,
      actions,
      generatedAt: new Date().toISOString()
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'AI welcome generation failed';
    return res.status(502).json({ error: message });
  }
});

router.get('/models', (_req: Request, res: Response) => {
  return res.json({
    models: aiModelProviderService.configuredChatModels()
  });
});

router.post('/note-edit', async (req: Request, res: Response) => {
  const { action, workspaceId, workbenchId, file, selection, documentContext } = req.body ?? {};

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  const selectedText = String(selection?.text || '').trim();
  if (!selectedText) {
    return res.status(400).json({ error: 'selection.text is required' });
  }

  const actionLabels: Record<string, string> = {
    proofread: '校对错别字、语法和标点，只修正表达错误，尽量保持原意和长度。',
    improve: '提升写作质量，让表达更清晰、自然、有条理，保留原意。',
    explain: '把选区解释得更清楚，适合学习笔记阅读；保留原信息，必要时补充简短说明，但不要虚构事实。',
    reformat: '重新格式化为更易读的 Markdown，可以调整列表、标题和段落结构。',
    shorten: '缩短文字，保留关键信息，删除冗余表达。',
    expand: '扩写文字，补充必要解释和衔接，但不要虚构事实。',
    summarize: '把选区整理成简洁摘要，突出核心信息。',
    outline: '把选区整理成 Markdown 大纲，层级清晰。'
  };

  const instruction = [
    '你是企业级笔记产品中的 AI 文档编辑器。',
    '请只编辑用户明确选中的文本，不要改写全文，不要添加选区外的内容。',
    '如果需要结合上下文，只能用于理解选区，不得把上下文原文直接塞进 replacement。',
    '返回的 replacement 必须是可直接替换选区的 Markdown 文本。',
    'summary 用一句中文说明做了什么。',
    'warnings 用于说明不确定性，例如“选区缺少上下文”。'
  ].join('\n');

  try {
    const result = await aiModelProviderService.json<{
      replacement: string;
      summary: string;
      warnings?: string[];
    }>({
      instruction,
      schema: {
        type: 'object',
        required: ['replacement', 'summary'],
        properties: {
          replacement: { type: 'string' },
          summary: { type: 'string' },
          warnings: { type: 'array', items: { type: 'string' } }
        }
      },
      input: {
        action,
        actionInstruction: actionLabels[action] || actionLabels.improve,
        workspaceId,
        workbenchId,
        file: {
          id: file?.id,
          name: file?.name,
          path: file?.path
        },
        selection: {
          text: selectedText,
          surroundingText: String(selection?.surroundingText || '').slice(0, 5000)
        },
        documentContext: {
          title: documentContext?.title,
          nearbyHeadings: Array.isArray(documentContext?.nearbyHeadings)
            ? documentContext.nearbyHeadings.slice(0, 8)
            : [],
          visibleContent: String(documentContext?.visibleContent || '').slice(0, 5000)
        }
      },
      timeoutMs: 45000,
      useCase: 'chat',
      systemPrompt: 'You are a precise markdown editing engine. Edit only the selected passage.'
    });

    const replacement = String(result.data?.replacement || '').trim();
    if (!replacement) {
      return res.status(502).json({ error: 'AI note edit returned empty replacement' });
    }

    return res.json({
      replacement,
      summary: trimText(result.data?.summary, 240) || 'AI edited the selected note text',
      warnings: Array.isArray(result.data?.warnings)
        ? result.data.warnings.map((item) => trimText(item, 240)).filter(Boolean).slice(0, 5)
        : [],
      model: result.model,
      provider: result.provider,
      usage: result.usage || null
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'AI note edit failed';
    return res.status(502).json({ error: message });
  }
});

router.post('/chat', async (req: Request, res: Response) => {
  const { messages, context } = req.body ?? {};

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  if (!context?.workspaceId) {
    return res.status(400).json({ error: 'context.workspaceId is required' });
  }

  try {
    const result = await multiAgentOrchestrator.chat({ messages, context });
    return res.json(result);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'AI request failed';
    return res.status(502).json({ error: message });
  }
});

router.post('/chat/stream', async (req: Request, res: Response) => {
  const { messages, context } = req.body ?? {};

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  if (!context?.workspaceId) {
    return res.status(400).json({ error: 'context.workspaceId is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const controller = new AbortController();
  let ended = false;

  req.on('close', () => {
    if (!ended) controller.abort();
  });

  const send = (event: string, data: unknown) => {
    if (controller.signal.aborted || res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await multiAgentOrchestrator.chatStream({ messages, context }, send, { signal: controller.signal });
  } catch (error: any) {
    if (controller.signal.aborted || error?.name === 'AbortError') return;
    const message = error instanceof Error ? error.message : 'AI request failed';
    send('error', { error: message });
  } finally {
    ended = true;
    if (!res.writableEnded) res.end();
  }
});

export default router;
