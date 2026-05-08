import { Router } from 'express';
import { Request, Response } from 'express';
import { multiAgentOrchestrator } from '../services/multiAgentOrchestrator';

const router = Router();

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

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await multiAgentOrchestrator.chatStream({ messages, context }, send);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'AI request failed';
    send('error', { error: message });
  } finally {
    res.end();
  }
});

export default router;
