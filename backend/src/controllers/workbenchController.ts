import { Request, Response } from 'express';
import prisma from '../config/db';

const getSingleParam = (value: string | string[] | undefined | null): string => {
  if (Array.isArray(value)) return value[0];
  if (value == null) return '';
  return String(value);
};

export const createWorkbench = async (req: Request, res: Response) => {
  const { name, title, description, layout, workspaceId } = req.body;
  const resolvedTitle = title || name || 'Untitled Workbench';
  const workbench = await prisma.workbench.create({
    data: {
      name: resolvedTitle,
      title: resolvedTitle,
      description: description || '',
      layout,
      workspaceId
    }
  });
  res.json({ workbench });
};

export const getWorkbenches = async (req: Request, res: Response) => {
  const workspaceId = getSingleParam(req.query.workspaceId as any);
  const workbenches = await prisma.workbench.findMany({
    where: { workspaceId },
    include: {
      panels: true
    }
  });
  res.json({ workbenches });
};

export const getWorkbench = async (req: Request, res: Response) => {
  const id = getSingleParam(req.params.id);
  const workbench = await prisma.workbench.findUnique({
    where: { id },
    include: {
      panels: {
        include: {
          fileObject: true
        }
      }
    }
  });
  res.json({ workbench });
};

export const createPanel = async (req: Request, res: Response) => {
  const { title, panelType, config, layoutInfo, workbenchId, fileObjectId } = req.body;
  const panel = await prisma.panel.create({
    data: {
      title,
      panelType,
      config,
      layoutInfo,
      workbenchId,
      fileObjectId
    }
  });
  res.json({ panel });
};

export const updateWorkbench = async (req: Request, res: Response) => {
  const id = getSingleParam(req.params.id);
  const { name, title, description, layout } = req.body;
  const resolvedTitle = title || name;
  try {
    const workbench = await prisma.workbench.update({
      where: { id },
      data: {
        ...(resolvedTitle ? { name: resolvedTitle, title: resolvedTitle } : {}),
        ...(description !== undefined ? { description } : {}),
        layout,
      },
    });
    res.json({ workbench });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteWorkbench = async (req: Request, res: Response) => {
  const id = getSingleParam(req.params.id);
  try {
    // Delete panels first to avoid foreign key constraints
    await prisma.panel.deleteMany({
      where: { workbenchId: id }
    });
    await prisma.learningEvent.deleteMany({
      where: { workbenchId: id }
    });
    await prisma.learningTrace.deleteMany({
      where: { workbenchId: id }
    });
    await prisma.workbench.delete({
      where: { id },
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updatePanel = async (req: Request, res: Response) => {
  const id = getSingleParam(req.params.id);
  const { title, config, layoutInfo, fileObjectId } = req.body;
  try {
    const panel = await prisma.panel.update({
      where: { id },
      data: {
        title,
        config,
        layoutInfo,
        fileObjectId
      },
    });
    res.json({ panel });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deletePanel = async (req: Request, res: Response) => {
  const id = getSingleParam(req.params.id);
  try {
    await prisma.panel.delete({
      where: { id },
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
