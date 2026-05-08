import { Router } from 'express';
import { Request, Response } from 'express';
import { mclOrchestrator } from '../services/mclOrchestrator';
import { learningStateBuilder } from '../services/learningStateBuilder';

const router = Router();

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'MCL request failed');

router.post('/execute', async (req: Request, res: Response) => {
  const {
    workspaceId,
    workbenchId,
    goalId,
    intent,
    userInput,
    messages,
    resourceType,
    options,
    capability,
    capabilityInput,
    context,
    previousPlan
  } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const input = {
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      goalId: typeof goalId === 'string' ? goalId : null,
      intent: typeof intent === 'string' ? intent : undefined,
      userInput: typeof userInput === 'string' ? userInput : undefined,
      messages: Array.isArray(messages) ? messages : undefined,
      resourceType,
      options: options && typeof options === 'object' ? options : undefined,
      capability,
      capabilityInput: capabilityInput && typeof capabilityInput === 'object' ? capabilityInput : undefined,
      context: context && typeof context === 'object' ? context : undefined,
      previousPlan: previousPlan && typeof previousPlan === 'object' ? previousPlan : undefined
    };
    const resolvedIntent = typeof intent === 'string' ? intent : undefined;
    const result = resolvedIntent === 'planning'
      ? await mclOrchestrator.startPlanningRun(input)
      : await mclOrchestrator.execute(input);
    return res.json(result);
  } catch (error) {
    return res.status(502).json({ error: errorMessage(error) });
  }
});

router.post('/state', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, goalId, intent, userInput, resourceType, context } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const result = await learningStateBuilder.build({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      goalId: typeof goalId === 'string' ? goalId : null,
      intent: typeof intent === 'string' ? intent : 'state',
      userInput: typeof userInput === 'string' ? userInput : undefined,
      resourceType: typeof resourceType === 'string' ? resourceType : undefined,
      context: context && typeof context === 'object' ? context : undefined
    });
    return res.json(result);
  } catch (error) {
    return res.status(502).json({ error: errorMessage(error) });
  }
});

export default router;
