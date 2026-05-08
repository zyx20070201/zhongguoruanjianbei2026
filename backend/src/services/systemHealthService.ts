import prisma from '../config/db';
import { backgroundJobService } from './backgroundJobService';
import { deepseekService } from './deepseekService';
import { embeddingService } from './embeddingService';
import { vectorStoreService } from './vectorStoreService';

export class SystemHealthService {
  async check() {
    const dbStartedAt = Date.now();
    const database = await prisma.$queryRaw`SELECT 1 as ok`.then(() => ({
      ok: true,
      latencyMs: Date.now() - dbStartedAt
    })).catch((error) => ({
      ok: false,
      latencyMs: Date.now() - dbStartedAt,
      error: error instanceof Error ? error.message : String(error)
    }));

    const [llm, embeddingStack, qdrant] = await Promise.all([
      deepseekService.health(),
      embeddingService.health(),
      vectorStoreService.health()
    ]);

    const semanticRetrievalMode =
      embeddingStack.embedding.ok && embeddingStack.reranker.ok
        ? 'full'
        : embeddingStack.embedding.ok
          ? 'embedding_only'
          : 'keyword_fallback';

    const ok = Boolean(database.ok && llm.ok && embeddingStack.embedding.ok);
    return {
      ok,
      checkedAt: new Date().toISOString(),
      semanticRetrievalMode,
      services: {
        database,
        llm,
        embedding: embeddingStack.embedding,
        reranker: embeddingStack.reranker,
        qdrant,
        backgroundJobs: backgroundJobService.stats()
      }
    };
  }
}

export const systemHealthService = new SystemHealthService();
