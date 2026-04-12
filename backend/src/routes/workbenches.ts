import { Router } from 'express';
import { Request, Response } from 'express';
import { workbenchService } from '../services/workbenchService';

const router = Router();

const getSingleValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

router.get('/', async (req: Request, res: Response) => {
  const workspaceId = getSingleValue(req.query.workspaceId as string | string[] | undefined);

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  const workbenches = await workbenchService.listByWorkspace(workspaceId);
  return res.json({ workbenches });
});

router.post('/', async (req: Request, res: Response) => {
  const { workspaceId, title, description } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  const workbench = await workbenchService.create(workspaceId, { title, description });
  return res.status(201).json({ workbench });
});

router.get('/:id', async (req: Request, res: Response) => {
  const workbenchId = getSingleValue(req.params.id);
  if (!workbenchId) {
    return res.status(400).json({ error: 'Workbench id is required' });
  }

  const workbench = await workbenchService.getById(workbenchId, true);

  if (!workbench) {
    return res.status(404).json({ error: 'Workbench not found' });
  }

  return res.json({ workbench });
});

router.patch('/:id', async (req: Request, res: Response) => {
  const workbenchId = getSingleValue(req.params.id);
  if (!workbenchId) {
    return res.status(400).json({ error: 'Workbench id is required' });
  }

  const workbench = await workbenchService.updateMetadata(workbenchId, req.body ?? {});

  if (!workbench) {
    return res.status(404).json({ error: 'Workbench not found' });
  }

  return res.json({ workbench });
});

router.put('/:id/state', async (req: Request, res: Response) => {
  const workbenchId = getSingleValue(req.params.id);
  if (!workbenchId) {
    return res.status(400).json({ error: 'Workbench id is required' });
  }

  const workbench = await workbenchService.saveState(workbenchId, req.body ?? {});

  if (!workbench) {
    return res.status(404).json({ error: 'Workbench not found' });
  }

  return res.json({ workbench });
});

router.delete('/:id', async (req: Request, res: Response) => {
  const workbenchId = getSingleValue(req.params.id);
  if (!workbenchId) {
    return res.status(400).json({ error: 'Workbench id is required' });
  }

  const deleted = await workbenchService.delete(workbenchId);

  if (!deleted) {
    return res.status(404).json({ error: 'Workbench not found' });
  }

  return res.json({ success: true });
});

export default router;
