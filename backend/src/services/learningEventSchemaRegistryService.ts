import prisma from '../config/db';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const stringify = (value: unknown, fallback: unknown) => {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
};

export class LearningEventSchemaRegistryService {
  async list(input?: { workspaceId?: string | null; status?: string }) {
    const rows = await prisma.learningEventSchemaRegistry.findMany({
      where: {
        ...(input?.status ? { status: input.status } : {}),
        OR: [
          { workspaceId: null },
          ...(input?.workspaceId ? [{ workspaceId: input.workspaceId }] : [])
        ]
      },
      orderBy: [{ schemaKey: 'asc' }, { version: 'desc' }]
    });
    return rows.map((row) => ({
      id: row.id,
      schemaKey: row.schemaKey,
      version: row.version,
      status: row.status,
      scope: row.scope,
      description: row.description,
      sourceFramework: row.sourceFramework,
      eventFamilies: parseJson<string[]>(row.eventFamiliesJson, []),
      dialogueActs: parseJson<string[]>(row.dialogueActsJson, []),
      cognitiveSignals: parseJson<string[]>(row.cognitiveSignalsJson, []),
      schema: parseJson<Record<string, unknown>>(row.schemaJson, {}),
      governance: parseJson<Record<string, unknown>>(row.governanceJson, {}),
      workspaceId: row.workspaceId,
      updatedAt: row.updatedAt.toISOString()
    }));
  }

  async upsert(input: {
    schemaKey: string;
    version: string;
    workspaceId?: string | null;
    status?: string;
    scope?: string;
    description?: string;
    sourceFramework?: string;
    eventFamilies?: string[];
    dialogueActs?: string[];
    cognitiveSignals?: string[];
    schema?: Record<string, unknown>;
    governance?: Record<string, unknown>;
  }) {
    const data = {
      status: input.status || 'active',
      scope: input.scope || (input.workspaceId ? 'workspace' : 'global'),
      description: input.description || '',
      sourceFramework: input.sourceFramework || '',
      eventFamiliesJson: stringify(input.eventFamilies || [], []),
      dialogueActsJson: stringify(input.dialogueActs || [], []),
      cognitiveSignalsJson: stringify(input.cognitiveSignals || [], []),
      schemaJson: stringify(input.schema || {}, {}),
      governanceJson: stringify(input.governance || {}, {})
    };
    const existing = await prisma.learningEventSchemaRegistry.findFirst({
      where: {
        schemaKey: input.schemaKey,
        version: input.version,
        workspaceId: input.workspaceId || null
      }
    });
    if (existing) {
      return prisma.learningEventSchemaRegistry.update({
        where: { id: existing.id },
        data
      });
    }
    return prisma.learningEventSchemaRegistry.create({
      data: {
        schemaKey: input.schemaKey,
        version: input.version,
        workspaceId: input.workspaceId || null,
        ...data
      },
    });
  }
}

export const learningEventSchemaRegistryService = new LearningEventSchemaRegistryService();
