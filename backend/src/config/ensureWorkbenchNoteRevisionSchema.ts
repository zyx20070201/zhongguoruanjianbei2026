import prisma from './db';

const statements = [
  `CREATE TABLE IF NOT EXISTS "WorkbenchNoteRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "workbenchId" TEXT,
    "fileObjectId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "actionType" TEXT NOT NULL DEFAULT 'ai_note_edit',
    "actor" TEXT NOT NULL DEFAULT 'ai',
    "summary" TEXT,
    "baseContentHash" TEXT,
    "beforeContent" TEXT NOT NULL,
    "beforeContentHash" TEXT NOT NULL,
    "afterContent" TEXT NOT NULL,
    "afterContentHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkbenchNoteRevision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkbenchNoteRevision_workbenchId_fkey" FOREIGN KEY ("workbenchId") REFERENCES "Workbench" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkbenchNoteRevision_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "FileSystemObject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "WorkbenchNoteRevision_fileObjectId_revisionNumber_key" ON "WorkbenchNoteRevision"("fileObjectId", "revisionNumber")`,
  `CREATE INDEX IF NOT EXISTS "WorkbenchNoteRevision_workspaceId_fileObjectId_createdAt_idx" ON "WorkbenchNoteRevision"("workspaceId", "fileObjectId", "createdAt")`
];

export const ensureWorkbenchNoteRevisionSchema = async () => {
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
};
