import prisma from './db';

const statements = [
  `CREATE TABLE IF NOT EXISTS "StudioArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "artifactKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "goal" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "generatorKind" TEXT NOT NULL,
    "generatorVersion" TEXT NOT NULL,
    "renderer" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'unknown',
    "structuredJson" TEXT NOT NULL DEFAULT '{}',
    "renderedContent" TEXT NOT NULL DEFAULT '',
    "sourceRefsJson" TEXT NOT NULL DEFAULT '[]',
    "reviewJson" TEXT NOT NULL DEFAULT '{}',
    "recommendationJson" TEXT NOT NULL DEFAULT '{}',
    "workflowTraceJson" TEXT NOT NULL DEFAULT '[]',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "parentArtifactId" TEXT,
    "derivedFromJson" TEXT NOT NULL DEFAULT '[]',
    "usageStatsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT NOT NULL,
    "workbenchId" TEXT,
    "fileObjectId" TEXT,
    "runId" TEXT,
    CONSTRAINT "StudioArtifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudioArtifact_workbenchId_fkey" FOREIGN KEY ("workbenchId") REFERENCES "Workbench" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StudioArtifact_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "FileSystemObject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "StudioArtifact_workspaceId_artifactKey_key" ON "StudioArtifact"("workspaceId", "artifactKey")`,
  `CREATE INDEX IF NOT EXISTS "StudioArtifact_workspaceId_goal_updatedAt_idx" ON "StudioArtifact"("workspaceId", "goal", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "StudioArtifact_workspaceId_templateId_updatedAt_idx" ON "StudioArtifact"("workspaceId", "templateId", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "StudioArtifact_workbenchId_updatedAt_idx" ON "StudioArtifact"("workbenchId", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "StudioArtifact_fileObjectId_idx" ON "StudioArtifact"("fileObjectId")`,
  `CREATE TABLE IF NOT EXISTS "StudioRenderJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "templateId" TEXT NOT NULL,
    "renderer" TEXT NOT NULL,
    "framework" TEXT,
    "kind" TEXT NOT NULL,
    "inputJson" TEXT NOT NULL DEFAULT '{}',
    "outputJson" TEXT NOT NULL DEFAULT '{}',
    "logsJson" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "workspaceId" TEXT NOT NULL,
    "workbenchId" TEXT,
    "artifactId" TEXT,
    "sourceFileObjectId" TEXT,
    "outputFileObjectId" TEXT,
    CONSTRAINT "StudioRenderJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudioRenderJob_workbenchId_fkey" FOREIGN KEY ("workbenchId") REFERENCES "Workbench" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StudioRenderJob_sourceFileObjectId_fkey" FOREIGN KEY ("sourceFileObjectId") REFERENCES "FileSystemObject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StudioRenderJob_outputFileObjectId_fkey" FOREIGN KEY ("outputFileObjectId") REFERENCES "FileSystemObject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "StudioRenderJob_workspaceId_createdAt_idx" ON "StudioRenderJob"("workspaceId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "StudioRenderJob_sourceFileObjectId_idx" ON "StudioRenderJob"("sourceFileObjectId")`,
  `CREATE INDEX IF NOT EXISTS "StudioRenderJob_artifactId_idx" ON "StudioRenderJob"("artifactId")`
];

const expectedColumns: Array<{ name: string; ddl: string }> = [
  { name: 'summary', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "summary" TEXT NOT NULL DEFAULT ''` },
  { name: 'status', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ready'` },
  { name: 'templateVersion', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "templateVersion" TEXT NOT NULL DEFAULT '1.0.0'` },
  { name: 'generatorVersion', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "generatorVersion" TEXT NOT NULL DEFAULT '1.0.0'` },
  { name: 'schemaVersion', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "schemaVersion" TEXT NOT NULL DEFAULT 'studio_artifact.v1'` },
  { name: 'structuredJson', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "structuredJson" TEXT NOT NULL DEFAULT '{}'` },
  { name: 'renderedContent', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "renderedContent" TEXT NOT NULL DEFAULT ''` },
  { name: 'sourceRefsJson', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "sourceRefsJson" TEXT NOT NULL DEFAULT '[]'` },
  { name: 'reviewJson', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "reviewJson" TEXT NOT NULL DEFAULT '{}'` },
  { name: 'recommendationJson', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "recommendationJson" TEXT NOT NULL DEFAULT '{}'` },
  { name: 'workflowTraceJson', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "workflowTraceJson" TEXT NOT NULL DEFAULT '[]'` },
  { name: 'metadataJson', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "metadataJson" TEXT NOT NULL DEFAULT '{}'` },
  { name: 'parentArtifactId', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "parentArtifactId" TEXT` },
  { name: 'derivedFromJson', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "derivedFromJson" TEXT NOT NULL DEFAULT '[]'` },
  { name: 'usageStatsJson', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "usageStatsJson" TEXT NOT NULL DEFAULT '{}'` },
  { name: 'fileObjectId', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "fileObjectId" TEXT` },
  { name: 'runId', ddl: `ALTER TABLE "StudioArtifact" ADD COLUMN "runId" TEXT` }
];

export const ensureStudioArtifactSchema = async () => {
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("StudioArtifact")`);
  const columnNames = new Set(columns.map((column) => column.name));
  for (const column of expectedColumns) {
    if (!columnNames.has(column.name)) {
      await prisma.$executeRawUnsafe(column.ddl);
    }
  }
};
