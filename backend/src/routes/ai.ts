import { Router } from 'express';
import { Request, Response } from 'express';
import { deepseekService } from '../services/deepseekService';

const router = Router();

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
    const result = await deepseekService.chat(messages, context);
    return res.json(result);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'AI request failed';
    return res.status(502).json({ error: message });
  }
});

export default router;
