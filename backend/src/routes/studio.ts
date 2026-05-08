import { Router } from 'express';
import { Request, Response } from 'express';
import { aiStudioService, StudioResourceType } from '../services/aiStudioService';

const router = Router();

const RESOURCE_TYPES = new Set<StudioResourceType>([
  'report',
  'slide_deck',
  'mind_map',
  'flashcards',
  'quiz',
  'data_table'
]);

router.post('/generate', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, resourceType, prompt, options, context } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (!RESOURCE_TYPES.has(resourceType)) {
    return res.status(400).json({ error: 'resourceType is invalid' });
  }

  if (!context || typeof context !== 'object') {
    return res.status(400).json({ error: 'context is required' });
  }

  try {
    const result = await aiStudioService.generate({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      resourceType,
      prompt: typeof prompt === 'string' ? prompt : '',
      options: options && typeof options === 'object' ? options : undefined,
      context
    });
    return res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI Studio generation failed';
    return res.status(502).json({ error: message });
  }
});

router.post('/judge-quiz', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, question, userAnswer } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (!question || typeof question !== 'object') {
    return res.status(400).json({ error: 'question is required' });
  }

  if (typeof userAnswer !== 'string') {
    return res.status(400).json({ error: 'userAnswer is required' });
  }

  try {
    const result = await aiStudioService.judgeQuizAnswer({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      question,
      userAnswer
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quiz judging failed';
    return res.status(502).json({ error: message });
  }
});

router.post('/quiz-question-assistant', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, question, userMessage, userAnswer } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (!question || typeof question !== 'object') {
    return res.status(400).json({ error: 'question is required' });
  }

  if (typeof userMessage !== 'string' || !userMessage.trim()) {
    return res.status(400).json({ error: 'userMessage is required' });
  }

  try {
    const result = await aiStudioService.assistQuizQuestion({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      question,
      userMessage,
      userAnswer: typeof userAnswer === 'string' ? userAnswer : undefined
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quiz assistant failed';
    return res.status(502).json({ error: message });
  }
});

export default router;
