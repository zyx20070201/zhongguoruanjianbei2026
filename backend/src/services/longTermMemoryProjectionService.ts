import { savedMemoryService } from './savedMemoryService';
import { LearnerProfileEntry } from './learnerProfileReadModel';

export class LongTermMemoryProjectionService {
  async project(input: { workspaceId: string; workbenchId?: string | null; limit?: number }) {
    const memories = await savedMemoryService.list({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      limit: input.limit || 40
    });

    const savedMemoryEntries: LearnerProfileEntry[] = memories.map((memory) => ({
      id: memory.id,
      dimension: memory.category || 'savedMemory',
      label: memory.category || 'Saved Memory',
      value: memory.text,
      confidence: memory.confidence,
      status: memory.status,
      evidenceCount: 0,
      source: 'saved_memory',
      observedAt: memory.updatedAt,
      rationale: memory.source
    }));

    return { memories, savedMemoryEntries };
  }
}

export const longTermMemoryProjectionService = new LongTermMemoryProjectionService();
