import { Router } from 'express';
import { Request, Response } from 'express';
import { aiStudioService, StudioResourceType } from '../services/aiStudioService';
import { studioV2Service } from '../services/studio/studioV2Service';
import { studioRenderJobService } from '../services/studio/renderJobService';
import { StudioGoalCategory } from '../services/studio/types';
import { STUDIO_VISUALIZATION_IR_JSON_SCHEMA } from '../services/studio/visualizationIr';

const router = Router();

const RESOURCE_TYPES = new Set<StudioResourceType>([
  'report',
  'slide_deck',
  'mind_map',
  'flashcards',
  'quiz',
  'data_table'
]);

const GOALS = new Set<StudioGoalCategory>([
  'understand',
  'map',
  'practice',
  'review',
  'lab',
  'visualize',
  'plan'
]);

router.get('/templates', (req: Request, res: Response) => {
  const rawGoal = typeof req.query.goal === 'string' ? req.query.goal : undefined;
  const goal = rawGoal && GOALS.has(rawGoal as StudioGoalCategory) ? rawGoal as StudioGoalCategory : undefined;
  return res.json(studioV2Service.listTemplates(goal));
});

router.get('/visualization-ir/schema', (_req: Request, res: Response) => {
  return res.json({
    schemaVersion: 'studio_visualization_schema_endpoint.v1',
    schema: STUDIO_VISUALIZATION_IR_JSON_SCHEMA
  });
});

router.post('/recommend', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, goal, context } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (!context || typeof context !== 'object') {
    return res.status(400).json({ error: 'context is required' });
  }

  if (goal && !GOALS.has(goal)) {
    return res.status(400).json({ error: 'goal is invalid' });
  }

  try {
    const result = await studioV2Service.recommend({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      goal: GOALS.has(goal) ? goal : undefined,
      context
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI Studio recommendation failed';
    return res.status(502).json({ error: message });
  }
});

router.get('/artifacts', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const artifacts = await studioV2Service.listArtifacts({
      workspaceId,
      workbenchId,
      limit: Number.isFinite(limit) ? limit : undefined
    });
    return res.json({ artifacts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI Studio artifacts failed';
    return res.status(502).json({ error: message });
  }
});

router.get('/render-capabilities', async (_req: Request, res: Response) => {
  try {
    return res.json(await studioRenderJobService.capabilities());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Studio render capabilities failed';
    return res.status(502).json({ error: message });
  }
});

router.get('/render-jobs', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const sourceFileObjectId = typeof req.query.sourceFileObjectId === 'string' ? req.query.sourceFileObjectId : null;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const jobs = await studioRenderJobService.list({
      workspaceId,
      workbenchId,
      sourceFileObjectId,
      limit: Number.isFinite(limit) ? limit : undefined
    });
    return res.json({ jobs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Studio render jobs failed';
    return res.status(502).json({ error: message });
  }
});

router.get('/render-jobs/:id', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const id = typeof req.params.id === 'string' ? req.params.id : '';

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }
  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }

  try {
    const job = await studioRenderJobService.get({ workspaceId, id });
    if (!job) return res.status(404).json({ error: 'Render job not found' });
    return res.json(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Studio render job failed';
    return res.status(502).json({ error: message });
  }
});

router.post('/render-jobs/:id/retry', async (req: Request, res: Response) => {
  const workspaceId = typeof req.body?.workspaceId === 'string'
    ? req.body.workspaceId
    : typeof req.query.workspaceId === 'string'
      ? req.query.workspaceId
      : '';
  const id = typeof req.params.id === 'string' ? req.params.id : '';

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }
  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }

  try {
    const existing = await studioRenderJobService.get({ workspaceId, id });
    if (!existing) return res.status(404).json({ error: 'Render job not found' });
    const job = await studioRenderJobService.run(id);
    return res.json(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Studio render retry failed';
    return res.status(502).json({ error: message });
  }
});

router.post('/generate', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, goal, templateId, resourceType, prompt, options, context } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (!context || typeof context !== 'object') {
    return res.status(400).json({ error: 'context is required' });
  }

  try {
    if (typeof templateId === 'string' && templateId.trim()) {
      if (goal && !GOALS.has(goal)) {
        return res.status(400).json({ error: 'goal is invalid' });
      }
      const result = await studioV2Service.generate({
        workspaceId,
        workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
        goal: GOALS.has(goal) ? goal : undefined,
        templateId,
        prompt: typeof prompt === 'string' ? prompt : '',
        options: options && typeof options === 'object' ? options : undefined,
        context
      });
      return res.status(201).json(result);
    }

    if (!RESOURCE_TYPES.has(resourceType)) {
      return res.status(400).json({ error: 'resourceType is invalid' });
    }

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
