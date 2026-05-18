import prisma from './db';

const statements = [
  `CREATE TABLE IF NOT EXISTS "WorkbenchTableProperty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'custom',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "widthPx" INTEGER NOT NULL DEFAULT 220,
    "optionsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkbenchTableProperty_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "WorkbenchTableProperty_workspaceId_name_key" ON "WorkbenchTableProperty"("workspaceId", "name")`,
  `CREATE INDEX IF NOT EXISTS "WorkbenchTableProperty_workspaceId_orderIndex_idx" ON "WorkbenchTableProperty"("workspaceId", "orderIndex")`,
  `CREATE TABLE IF NOT EXISTS "WorkbenchTablePropertyValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "workbenchId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL DEFAULT 'null',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkbenchTablePropertyValue_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkbenchTablePropertyValue_workbenchId_fkey" FOREIGN KEY ("workbenchId") REFERENCES "Workbench" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkbenchTablePropertyValue_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "WorkbenchTableProperty" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "WorkbenchTablePropertyValue_workbenchId_propertyId_key" ON "WorkbenchTablePropertyValue"("workbenchId", "propertyId")`,
  `CREATE INDEX IF NOT EXISTS "WorkbenchTablePropertyValue_workspaceId_propertyId_idx" ON "WorkbenchTablePropertyValue"("workspaceId", "propertyId")`
];

export const ensureWorkbenchTableSchema = async () => {
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("WorkbenchTableProperty")`);
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has('widthPx')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkbenchTableProperty" ADD COLUMN "widthPx" INTEGER NOT NULL DEFAULT 220`);
  }
};
