import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db';

export const ensureWorkspaceOwnership = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = String(req.params.id || req.params.workspaceId || req.body?.workspaceId || req.query.workspaceId || '').trim();
  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, userId: true }
  });

  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  if (!req.authUser || workspace.userId !== req.authUser.id) {
    return res.status(403).json({ error: 'You do not have access to this workspace' });
  }

  req.workspaceAccess = workspace;
  return next();
};
