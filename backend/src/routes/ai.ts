import { Router } from 'express';
import { Request, Response } from 'express';
import { AiChatContext, deepseekService } from '../services/deepseekService';
import { learningContextBuilder } from '../services/learningContextBuilder';

const router = Router();

const getLatestUserMessage = (messages: any[]) =>
  [...messages]
    .reverse()
    .find((message) => message?.role === 'user' && typeof message.content === 'string' && message.content.trim())
    ?.content.trim() || '';

router.post('/chat', async (req: Request, res: Response) => {
  const { messages, context } = req.body ?? {};

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  if (!deepseekService.isConfigured()) {
    return res.status(503).json({
      error: 'DeepSeek API 未配置，请先在后端环境变量中设置 DEEPSEEK_API_KEY'
    });
  }

  try {
    let enrichedContext = context as AiChatContext | undefined;
    if (context?.workspaceId) {
      const learningContext = await learningContextBuilder.build({
        workspaceId: context.workspaceId,
        workbenchId: context.workbenchId,
        activeFileId: context.activeFile?.id,
        query: getLatestUserMessage(messages)
      });

      enrichedContext = {
        ...context,
        learningContext: {
          goal: learningContext.goal
            ? {
                title: learningContext.goal.title,
                goalText: learningContext.goal.goalText,
                skills: learningContext.goal.skills,
                weaknesses: learningContext.goal.weaknesses
              }
            : null,
          traces: learningContext.traces.map((trace) => ({
            summary: trace.summary,
            nextActions: trace.nextActions
          })),
          knowledge: learningContext.knowledge.map((item) => ({
            fileName: item.fileName,
            path: item.path,
            summary: item.summary,
            chunkText: item.chunkText
          }))
        }
      };
    }

    const result = await deepseekService.chat(messages, enrichedContext);
    return res.json(result);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'AI request failed';
    return res.status(502).json({ error: message });
  }
});

export default router;
