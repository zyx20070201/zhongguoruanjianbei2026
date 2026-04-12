import { Request, Response } from 'express';
import prisma from '../config/db';
import { workbenchService } from '../services/workbenchService';

const getSingleValue = (value: any): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const createWorkspace = async (req: Request, res: Response) => {
  const { name, description, major, userId } = req.body;

  const workspace = await prisma.workspace.create({
    data: {
      name,
      description,
      major,
      userId,
    },
  });

  res.json({ workspace });
};

export const updateWorkspace = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, major } = req.body;

  const workspaceId = getSingleValue(id);
  if (!workspaceId) {
    return res.status(400).json({ error: 'Invalid workspace id' });
  }

  const workspace = await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      name,
      description,
      major,
    },
  });

  res.json({ workspace });
};

export const deleteWorkspace = async (req: Request, res: Response) => {
  const { id } = req.params;

  const workspaceId = getSingleValue(id);
  if (!workspaceId) {
    return res.status(400).json({ error: 'Invalid workspace id' });
  }

  // Delete related records first (or rely on cascade if configured, but SQLite/Prisma needs manual or explicit cascade)
  // For simplicity in this task, we'll just delete the workspace. 
  // In a real app, we'd handle cascading deletes for workbenches, fileObjects, etc.
  
  await prisma.workbench.deleteMany({ where: { workspaceId: workspaceId } });
  await prisma.fileSystemObject.deleteMany({ where: { workspaceId: workspaceId } });
  await workbenchService.deleteByWorkspace(workspaceId);
  
  await prisma.workspace.delete({
    where: { id: workspaceId },
  });

  res.json({ success: true });
};

export const duplicateWorkspace = async (req: Request, res: Response) => {
  const { id } = req.params;

  const workspaceId = getSingleValue(id);
  if (!workspaceId) {
    return res.status(400).json({ error: 'Invalid workspace id' });
  }

  const sourceWorkspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      fileObjects: true,
      workbenches: true,
    },
  });

  if (!sourceWorkspace) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  const newWorkspace = await prisma.workspace.create({
    data: {
      name: `${sourceWorkspace.name} (Copy)`,
      description: sourceWorkspace.description,
      major: sourceWorkspace.major,
      userId: sourceWorkspace.userId,
    },
  });

  // Duplicate file structure (simplified)
  for (const fileObj of sourceWorkspace.fileObjects) {
    await prisma.fileSystemObject.create({
      data: {
        name: fileObj.name,
        nodeType: fileObj.nodeType,
        fileCategory: fileObj.fileCategory,
        tags: (fileObj as any).tags,
        extension: fileObj.extension,
        size: fileObj.size,
        isBinary: fileObj.isBinary,
        path: fileObj.path,
        content: fileObj.content,
        mimeType: fileObj.mimeType,
        storageKey: fileObj.storageKey,
        workspaceId: newWorkspace.id,
      },
    });
  }

  res.json({ workspace: newWorkspace });
};

export const getWorkspaces = async (req: Request, res: Response) => {
  const { userId } = req.query;

  const parsedUserId = getSingleValue(userId);
  if (!parsedUserId) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  const workspaces = await prisma.workspace.findMany({
    where: { userId: parsedUserId },
    include: {
      fileObjects: {
        orderBy: { updatedAt: 'desc' },
        take: 1,
      },
      _count: {
        select: { workbenches: true, fileObjects: true }
      }
    },
    orderBy: { updatedAt: 'desc' }
  });

  const enrichedWorkspaces = await Promise.all(
    workspaces.map(async (workspace) => {
      const workbenches = await workbenchService.listByWorkspace(workspace.id);

      return {
        ...workspace,
        workbenches,
        _count: {
          ...workspace._count,
          workbenches: workbenches.length
        }
      };
    })
  );

  res.json({ workspaces: enrichedWorkspaces });
};

export const getWorkspace = async (req: Request, res: Response) => {
  const { id } = req.params;

  const workspaceId = getSingleValue(id);
  if (!workspaceId) {
    return res.status(400).json({ error: 'Invalid workspace id' });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      fileObjects: true,
    },
  });

  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  const workbenches = await workbenchService.listByWorkspace(workspaceId);

  res.json({
    workspace: {
      ...workspace,
      workbenches
    }
  });
};
