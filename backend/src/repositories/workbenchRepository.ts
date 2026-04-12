import { promises as fs } from 'fs';
import path from 'path';
import { WorkbenchRecord } from '../types/workbench';

interface WorkbenchDatabase {
  workbenches: WorkbenchRecord[];
}

const DATA_DIR = path.resolve(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'workbenches.json');

const EMPTY_DB: WorkbenchDatabase = {
  workbenches: []
};

export class WorkbenchRepository {
  private async ensureStore() {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
      await fs.access(DATA_FILE);
    } catch {
      await fs.writeFile(DATA_FILE, JSON.stringify(EMPTY_DB, null, 2), 'utf-8');
    }
  }

  private async readStore(): Promise<WorkbenchDatabase> {
    await this.ensureStore();
    const raw = await fs.readFile(DATA_FILE, 'utf-8');

    try {
      const parsed = JSON.parse(raw) as WorkbenchDatabase;
      if (!Array.isArray(parsed.workbenches)) {
        return EMPTY_DB;
      }
      return parsed;
    } catch {
      return EMPTY_DB;
    }
  }

  private async writeStore(data: WorkbenchDatabase) {
    await this.ensureStore();
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  async listByWorkspace(workspaceId: string): Promise<WorkbenchRecord[]> {
    const store = await this.readStore();
    return store.workbenches
      .filter((workbench) => workbench.workspaceId === workspaceId)
      .map((workbench) => ({
        ...workbench,
        rootPath: workbench.rootPath || `/${workbench.title || 'Untitled Workbench'}`
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async findById(id: string): Promise<WorkbenchRecord | null> {
    const store = await this.readStore();
    const workbench = store.workbenches.find((item) => item.id === id) ?? null;
    if (!workbench) return null;

    return {
      ...workbench,
      rootPath: workbench.rootPath || `/${workbench.title || 'Untitled Workbench'}`
    };
  }

  async save(record: WorkbenchRecord): Promise<WorkbenchRecord> {
    const store = await this.readStore();
    const existingIndex = store.workbenches.findIndex((workbench) => workbench.id === record.id);

    if (existingIndex >= 0) {
      store.workbenches[existingIndex] = record;
    } else {
      store.workbenches.push(record);
    }

    await this.writeStore(store);
    return record;
  }

  async delete(id: string): Promise<boolean> {
    const store = await this.readStore();
    const next = store.workbenches.filter((workbench) => workbench.id !== id);
    const changed = next.length !== store.workbenches.length;

    if (changed) {
      await this.writeStore({ workbenches: next });
    }

    return changed;
  }

  async deleteByWorkspace(workspaceId: string): Promise<void> {
    const store = await this.readStore();
    const next = store.workbenches.filter((workbench) => workbench.workspaceId !== workspaceId);

    if (next.length !== store.workbenches.length) {
      await this.writeStore({ workbenches: next });
    }
  }
}

export const workbenchRepository = new WorkbenchRepository();
