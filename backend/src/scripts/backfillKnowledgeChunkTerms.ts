import prisma from '../config/db';
import { ensureSqlitePerformanceSchema } from '../config/ensureSqlitePerformanceSchema';
import { documentChunkStore } from '../services/documentChunkStore';

const argValue = (name: string) => {
  const prefix = `--${name}=`;
  const matched = process.argv.find((arg) => arg.startsWith(prefix));
  return matched ? matched.slice(prefix.length) : undefined;
};

const main = async () => {
  await ensureSqlitePerformanceSchema();

  const workspaceId = argValue('workspaceId');
  const fileObjectId = argValue('fileObjectId');
  const batchSize = Number(argValue('batchSize') || process.env.KNOWLEDGE_INVERTED_BACKFILL_BATCH || 200);

  const result = await documentChunkStore.backfillInvertedIndex({
    workspaceId,
    fileObjectId,
    batchSize
  });

  console.log(`Backfilled KnowledgeChunkTerm rows for ${result.indexedChunks} chunks.`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
