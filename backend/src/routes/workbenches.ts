import { Router } from 'express';
import { Request, Response } from 'express';
import { workbenchService } from '../services/workbenchService';
import { requireAuth, requireWorkbenchAccess, requireWorkspaceAccess } from '../middleware/auth';

const router = Router();

const getSingleValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

router.use(requireAuth);

router.get('/', requireWorkspaceAccess, async (req: Request, res: Response) => {
  const workspaceId = getSingleValue(req.query.workspaceId as string | string[] | undefined);

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  const workbenches = await workbenchService.listByWorkspace(workspaceId);
  return res.json({ workbenches });
});

router.post('/', requireWorkspaceAccess, async (req: Request, res: Response) => {
  const { workspaceId, title, description } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  const workbench = await workbenchService.create(workspaceId, { title, description });
  return res.status(201).json({ workbench });
});

router.get('/:id', requireWorkbenchAccess, async (req: Request, res: Response) => {
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

router.get('/:id/resource-groups', requireWorkbenchAccess, async (req: Request, res: Response) => {
  const workbenchId = getSingleValue(req.params.id);
  if (!workbenchId) {
    return res.status(400).json({ error: 'Workbench id is required' });
  }

  const groups = await workbenchService.getResourceGroups(workbenchId);

  if (!groups) {
    return res.status(404).json({ error: 'Workbench not found' });
  }

  return res.json(groups);
});

router.patch('/:id/resource-order', requireWorkbenchAccess, async (req: Request, res: Response) => {
  const workbenchId = getSingleValue(req.params.id);
  const orderedIds = Array.isArray(req.body?.orderedIds)
    ? req.body.orderedIds.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  if (!workbenchId) {
    return res.status(400).json({ error: 'Workbench id is required' });
  }

  const groups = await workbenchService.reorderResources(workbenchId, orderedIds);
  if (!groups) {
    return res.status(404).json({ error: 'Workbench not found' });
  }

  return res.json(groups);
});

router.patch('/:id', requireWorkbenchAccess, async (req: Request, res: Response) => {
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

router.put('/:id/state', requireWorkbenchAccess, async (req: Request, res: Response) => {
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

router.delete('/:id', requireWorkbenchAccess, async (req: Request, res: Response) => {
  const workbenchId = getSingleValue(req.params.id);
  if (!workbenchId) {
    return res.status(400).json({ error: 'Workbench id is required' });
  }

  try {
    const deleted = await workbenchService.delete(workbenchId);

    if (!deleted) {
      return res.status(404).json({ error: 'Workbench not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error(`Failed to delete workbench ${workbenchId}:`, error);
    return res.status(500).json({ error: 'Failed to delete workbench' });
  }
});

export default router;
