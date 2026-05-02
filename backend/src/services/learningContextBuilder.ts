import prisma from '../config/db';
import { FileSystemService } from './fileSystemService';
import { knowledgeSearchService, KnowledgeSearchResult } from './knowledgeSearchService';

export interface LearningContext {
  workspace: {
    id: string;
    name: string;
    description?: string | null;
    major?: string | null;
  };
  workbench?: {
    id: string;
    title: string;
    description: string;
    rootPath?: string | null;
  } | null;
  goal?: {
    id: string;
    title: string;
    goalText: string;
    skills: string[];
    weaknesses: string[];
    mode: string;
    status: string;
    plan: Record<string, unknown>;
  } | null;
  recentEvents: Array<{ eventType: string; actor: string; payload: Record<string, unknown>; createdAt: string }>;
  traces: Array<{ summary: string; mastery: Record<string, unknown>; nextActions: string[]; updatedAt: string }>;
  activeFile?: { id: string; name: string; path: string; content?: string | null } | null;
  knowledge: KnowledgeSearchResult[];
}

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export class LearningContextBuilder {
  async build(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    activeFileId?: string | null;
    query?: string;
  }): Promise<LearningContext> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: input.workspaceId }
    });

    if (!workspace) {
      throw new Error('Workspace not found');
    }

    const workbench = input.workbenchId
      ? await prisma.workbench.findFirst({
          where: {
            id: input.workbenchId,
            workspaceId: input.workspaceId
          }
        })
      : null;

    const goalId = input.goalId || workbench?.learningGoalId || null;
    const goal = goalId
      ? await prisma.learningGoal.findFirst({
          where: {
            id: goalId,
            workspaceId: input.workspaceId
          }
        })
      : null;

    const [events, traces] = await Promise.all([
      prisma.learningEvent.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
          ...(goalId ? { goalId } : {})
        },
        orderBy: { createdAt: 'desc' },
        take: 8
      }),
      prisma.learningTrace.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
          ...(goalId ? { goalId } : {})
        },
        orderBy: { updatedAt: 'desc' },
        take: 4
      })
    ]);

    const activeFileRecord = input.activeFileId
      ? await prisma.fileSystemObject.findFirst({
          where: {
            id: input.activeFileId,
            workspaceId: input.workspaceId,
            nodeType: 'file'
          }
        })
      : null;

    const activeFile = activeFileRecord
      ? {
          id: activeFileRecord.id,
          name: activeFileRecord.name,
          path: activeFileRecord.path,
          content: await FileSystemService.getFileContent(input.workspaceId, activeFileRecord.id).catch(() => null)
        }
      : null;

    const query =
      input.query ||
      goal?.goalText ||
      activeFile?.content?.slice(0, 160) ||
      '';

    const knowledge = query
      ? await knowledgeSearchService.search({
          workspaceId: input.workspaceId,
          query,
          limit: 6
        })
      : [];

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        major: workspace.major
      },
      workbench: workbench
        ? {
            id: workbench.id,
            title: workbench.title || workbench.name,
            description: workbench.description || '',
            rootPath: workbench.rootPath
          }
        : null,
      goal: goal
        ? {
            id: goal.id,
            title: goal.title,
            goalText: goal.goalText,
            skills: parseJson<string[]>(goal.skillsJson, []),
            weaknesses: parseJson<string[]>(goal.weaknessesJson, []),
            mode: goal.mode,
            status: goal.status,
            plan: parseJson<Record<string, unknown>>(goal.planJson, {})
          }
        : null,
      recentEvents: events.map((event) => ({
        eventType: event.eventType,
        actor: event.actor,
        payload: parseJson<Record<string, unknown>>(event.payloadJson, {}),
        createdAt: event.createdAt.toISOString()
      })),
      traces: traces.map((trace) => ({
        summary: trace.summary,
        mastery: parseJson<Record<string, unknown>>(trace.masteryJson, {}),
        nextActions: parseJson<string[]>(trace.nextActionsJson, []),
        updatedAt: trace.updatedAt.toISOString()
      })),
      activeFile,
      knowledge
    };
  }
}

export const learningContextBuilder = new LearningContextBuilder();
