import { Request, Response } from 'express';
import prisma from '../config/db';
import { workbenchService } from '../services/workbenchService';

const getSingleValue = (value: any): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const fileObjectSummarySelect = {
  id: true,
  name: true,
  nodeType: true,
  fileCategory: true,
  resourceType: true,
  scope: true,
  origin: true,
  metadataJson: true,
  tags: true,
  extension: true,
  size: true,
  isBinary: true,
  path: true,
  mimeType: true,
  storageKey: true,
  createdAt: true,
  updatedAt: true,
  workspaceId: true,
  ownerWorkbenchId: true,
  parentId: true,
} as const;

export const createWorkspace = async (req: Request, res: Response) => {
  const { name, description, major } = req.body;
  const userId = req.authUser?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

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
  const { name, description, major, aiTerminalConfig } = req.body;

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
      aiTerminalConfig,
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

  await prisma.$transaction(async (tx) => {
    const [workbenches, files, runs, cards, learnerCores] = await Promise.all([
      tx.workbench.findMany({ where: { workspaceId }, select: { id: true } }),
      tx.fileSystemObject.findMany({ where: { workspaceId }, select: { id: true } }),
      tx.learningRun.findMany({ where: { workspaceId }, select: { id: true } }),
      tx.flashcard.findMany({ where: { workspaceId }, select: { id: true } }),
      tx.learnerStateCore.findMany({ where: { workspaceId }, select: { id: true } })
    ]);

    const workbenchIds = workbenches.map((workbench) => workbench.id);
    const fileIds = files.map((file) => file.id);
    const runIds = runs.map((run) => run.id);
    const cardIds = cards.map((card) => card.id);
    const learnerCoreIds = learnerCores.map((core) => core.id);

    await tx.learningRunStep.deleteMany({ where: { runId: { in: runIds } } });
    await tx.flashcardReviewLog.deleteMany({ where: { OR: [{ workspaceId }, { cardId: { in: cardIds } }] } });
    await tx.workbenchTablePropertyValue.deleteMany({ where: { workspaceId } });
    await tx.workbenchTableProperty.deleteMany({ where: { workspaceId } });

    await tx.panel.deleteMany({
      where: {
        OR: [
          { workbenchId: { in: workbenchIds } },
          { fileObjectId: { in: fileIds } }
        ]
      }
    });
    await tx.workbenchResource.deleteMany({
      where: {
        OR: [
          { workbenchId: { in: workbenchIds } },
          { fileObjectId: { in: fileIds } }
        ]
      }
    });
    await tx.generatedResource.deleteMany({ where: { fileObjectId: { in: fileIds } } });
    await tx.$executeRawUnsafe('DELETE FROM "StudioArtifact" WHERE "workspaceId" = ?', workspaceId);

    await tx.conversationMessage.deleteMany({ where: { workspaceId } });
    await tx.conversationSession.deleteMany({ where: { workspaceId } });
    await tx.savedMemory.deleteMany({ where: { workspaceId } });

    await tx.learningEvent.deleteMany({ where: { workspaceId } });
    await tx.learningEventSequencePattern.deleteMany({ where: { workspaceId } });
    await tx.learningEventSchemaRegistry.deleteMany({ where: { workspaceId } });
    await tx.learningTrace.deleteMany({ where: { workspaceId } });
    await tx.learningPlan.updateMany({ where: { workspaceId }, data: { previousPlanId: null } });
    await tx.learningPlan.deleteMany({ where: { workspaceId } });

    await tx.learnerStateTransition.deleteMany({ where: { workspaceId } });
    await tx.learnerEvidence.deleteMany({ where: { workspaceId } });
    await tx.learnerMemoryControl.deleteMany({ where: { workspaceId } });
    await tx.learnerStateSnapshotVersion.deleteMany({ where: { workspaceId } });
    await tx.learnerObservation.deleteMany({ where: { workspaceId } });
    await tx.learnerStateSignal.deleteMany({
      where: {
        OR: [
          { workspaceId },
          { learnerStateCoreId: { in: learnerCoreIds } }
        ]
      }
    });
    await tx.learnerStateCore.deleteMany({ where: { workspaceId } });

    await tx.flashcard.deleteMany({ where: { workspaceId } });
    await tx.flashcardDeck.deleteMany({ where: { workspaceId } });

    await tx.courseKnowledgeBinding.deleteMany({ where: { workspaceId } });
    await tx.courseKnowledgeGovernanceLog.deleteMany({ where: { workspaceId } });
    await tx.courseKnowledgeLearnerState.deleteMany({ where: { workspaceId } });
    await tx.courseKnowledgeActivation.deleteMany({ where: { workspaceId } });
    await tx.courseKnowledgeMisconception.deleteMany({ where: { workspaceId } });
    await tx.courseKnowledgeRelation.deleteMany({ where: { workspaceId } });
    await tx.courseKnowledgeConcept.deleteMany({ where: { workspaceId } });

    await tx.knowledgeChunk.deleteMany({ where: { workspaceId } });
    await tx.knowledgeIndexJob.deleteMany({ where: { workspaceId } });
    await tx.learningRun.deleteMany({ where: { workspaceId } });
    await tx.learningGoal.deleteMany({ where: { workspaceId } });
    await tx.profile.deleteMany({ where: { workspaceId } });

    await tx.fileSystemObject.updateMany({ where: { workspaceId }, data: { parentId: null, ownerWorkbenchId: null } });
    await tx.workbench.updateMany({ where: { workspaceId }, data: { learningGoalId: null } });
    await tx.workbench.deleteMany({ where: { workspaceId } });
    await tx.fileSystemObject.deleteMany({ where: { workspaceId } });

    await tx.workspace.delete({
      where: { id: workspaceId },
    });
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
  const parsedUserId = req.authUser?.id;
  if (!parsedUserId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const workspaces = await prisma.workspace.findMany({
    where: { userId: parsedUserId },
    include: {
      fileObjects: {
        select: fileObjectSummarySelect,
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
      fileObjects: {
        select: fileObjectSummarySelect,
        orderBy: { updatedAt: 'desc' },
      },
    },
  });

  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  if (req.authUser?.id !== workspace.userId) {
    return res.status(403).json({ error: 'You do not have access to this workspace' });
  }

  const workbenches = await workbenchService.listByWorkspace(workspaceId);

  res.json({
    workspace: {
      ...workspace,
      workbenches
    }
  });
};
