import { promises as fs } from 'fs';
import path from 'path';
import prisma from '../config/db';
import { WorkbenchRecord } from '../types/workbench';

interface WorkbenchDatabase {
  workbenches: WorkbenchRecord[];
}

const DATA_FILE = path.resolve(__dirname, '../../data/workbenches.json');

const EMPTY_STATE = (workbenchId: string) => ({
  workbenchId,
  editors: [],
  layoutMode: 'freeform' as const,
  activeEditorId: null,
  activeEditorPaneId: null,
  version: 1
});

const parseState = (id: string, value?: string | null) => {
  if (!value) return EMPTY_STATE(id);

  try {
    return {
      ...EMPTY_STATE(id),
      ...JSON.parse(value),
      workbenchId: id
    };
  } catch {
    return EMPTY_STATE(id);
  }
};

const toIso = (value?: Date | string | null) => {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const buildFallbackRootPath = (title: string) => `/${title || 'Untitled Workbench'}`;

const mapWorkbench = (workbench: any): WorkbenchRecord => {
  const title = workbench.title || workbench.name || 'Untitled Workbench';

  return {
    id: workbench.id,
    workspaceId: workbench.workspaceId,
    title,
    description: workbench.description || '',
    rootPath: workbench.rootPath || buildFallbackRootPath(title),
    createdAt: toIso(workbench.createdAt),
    updatedAt: toIso(workbench.updatedAt),
    lastOpenedAt: toIso(workbench.lastOpenedAt || workbench.updatedAt || workbench.createdAt),
    state: parseState(workbench.id, workbench.stateJson)
  };
};

export class WorkbenchRepository {
  private legacyMigrationDone = false;

  private async persistRecord(record: WorkbenchRecord) {
    return prisma.workbench.upsert({
      where: { id: record.id },
      create: {
        id: record.id,
        workspaceId: record.workspaceId,
        name: record.title,
        title: record.title,
        description: record.description || '',
        rootPath: record.rootPath,
        stateJson: JSON.stringify(record.state),
        layout: record.state.editorLayout ? JSON.stringify(record.state.editorLayout) : null,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
        lastOpenedAt: new Date(record.lastOpenedAt)
      },
      update: {
        name: record.title,
        title: record.title,
        description: record.description || '',
        rootPath: record.rootPath,
        stateJson: JSON.stringify(record.state),
        layout: record.state.editorLayout ? JSON.stringify(record.state.editorLayout) : null,
        updatedAt: new Date(record.updatedAt),
        lastOpenedAt: new Date(record.lastOpenedAt)
      }
    });
  }

  private async migrateLegacyJsonStore() {
    if (this.legacyMigrationDone) return;
    this.legacyMigrationDone = true;

    let parsed: WorkbenchDatabase | null = null;
    try {
      const raw = await fs.readFile(DATA_FILE, 'utf-8');
      parsed = JSON.parse(raw) as WorkbenchDatabase;
    } catch {
      return;
    }

    if (!Array.isArray(parsed?.workbenches)) return;

    for (const record of parsed.workbenches) {
      if (!record?.id || !record.workspaceId) continue;
      const existing = await prisma.workbench.findUnique({ where: { id: record.id }, select: { id: true } });
      if (existing) continue;

      await this.persistRecord({
        ...record,
        title: record.title || 'Untitled Workbench',
        description: record.description || '',
        rootPath: record.rootPath || buildFallbackRootPath(record.title || 'Untitled Workbench'),
        createdAt: record.createdAt || new Date().toISOString(),
        updatedAt: record.updatedAt || new Date().toISOString(),
        lastOpenedAt: record.lastOpenedAt || record.updatedAt || record.createdAt || new Date().toISOString(),
        state: record.state || EMPTY_STATE(record.id)
      });
    }
  }

  async listByWorkspace(workspaceId: string): Promise<WorkbenchRecord[]> {
    await this.migrateLegacyJsonStore();
    const workbenches = await prisma.workbench.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' }
    });

    return workbenches.map(mapWorkbench);
  }

  async findById(id: string): Promise<WorkbenchRecord | null> {
    await this.migrateLegacyJsonStore();
    const workbench = await prisma.workbench.findUnique({ where: { id } });
    return workbench ? mapWorkbench(workbench) : null;
  }

  async save(record: WorkbenchRecord): Promise<WorkbenchRecord> {
    const saved = await this.persistRecord(record);

    return mapWorkbench(saved);
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.panel.deleteMany({ where: { workbenchId: id } });
      await prisma.learningEvent.deleteMany({ where: { workbenchId: id } });
      await prisma.learningTrace.deleteMany({ where: { workbenchId: id } });
      await prisma.workbench.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async deleteByWorkspace(workspaceId: string): Promise<void> {
    const workbenches = await prisma.workbench.findMany({
      where: { workspaceId },
      select: { id: true }
    });
    const ids = workbenches.map((workbench) => workbench.id);

    await prisma.panel.deleteMany({ where: { workbenchId: { in: ids } } });
    await prisma.learningEvent.deleteMany({ where: { workbenchId: { in: ids } } });
    await prisma.learningTrace.deleteMany({ where: { workbenchId: { in: ids } } });
    await prisma.workbench.deleteMany({ where: { workspaceId } });
  }
}

export const workbenchRepository = new WorkbenchRepository();
