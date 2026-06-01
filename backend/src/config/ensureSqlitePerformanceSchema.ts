import prisma from './db';

const statements = [
  'CREATE INDEX IF NOT EXISTS "KnowledgeChunk_workspaceId_fileObjectId_idx" ON "KnowledgeChunk"("workspaceId", "fileObjectId")',
  'CREATE INDEX IF NOT EXISTS "KnowledgeChunk_workspaceId_fileObjectId_updatedAt_idx" ON "KnowledgeChunk"("workspaceId", "fileObjectId", "updatedAt")',
  'CREATE INDEX IF NOT EXISTS "KnowledgeChunk_workspaceId_updatedAt_idx" ON "KnowledgeChunk"("workspaceId", "updatedAt")',
  `CREATE TABLE IF NOT EXISTS "KnowledgeChunkTerm" (
    "workspaceId" TEXT NOT NULL,
    "fileObjectId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "termFrequency" INTEGER NOT NULL DEFAULT 0,
    "fieldWeight" REAL NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("chunkId", "term")
  )`,
  'CREATE INDEX IF NOT EXISTS "KnowledgeChunkTerm_workspaceId_term_idx" ON "KnowledgeChunkTerm"("workspaceId", "term")',
  'CREATE INDEX IF NOT EXISTS "KnowledgeChunkTerm_workspaceId_fileObjectId_term_idx" ON "KnowledgeChunkTerm"("workspaceId", "fileObjectId", "term")',
  'CREATE INDEX IF NOT EXISTS "KnowledgeChunkTerm_workspaceId_fileObjectId_idx" ON "KnowledgeChunkTerm"("workspaceId", "fileObjectId")',
  'CREATE INDEX IF NOT EXISTS "KnowledgeIndexJob_status_updatedAt_idx" ON "KnowledgeIndexJob"("status", "updatedAt")',
  'CREATE INDEX IF NOT EXISTS "KnowledgeIndexJob_workspaceId_fileObjectId_status_idx" ON "KnowledgeIndexJob"("workspaceId", "fileObjectId", "status")',
  'CREATE INDEX IF NOT EXISTS "LearningRun_workspaceId_updatedAt_idx" ON "LearningRun"("workspaceId", "updatedAt")'
];

export const ensureSqlitePerformanceSchema = async () => {
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
};
