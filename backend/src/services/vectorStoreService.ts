import { DocumentChunkRecord } from './documentChunkStore';
import { embeddingService } from './embeddingService';

export interface VectorSearchResult {
  chunkId: string;
  score: number;
  payload: Record<string, any>;
}

const QDRANT_BASE_URL = process.env.QDRANT_BASE_URL || 'http://localhost:6333';
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'workspace_knowledge_chunks';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || '';
const VECTOR_SIZE = Number(process.env.EMBEDDING_DIMENSION || 1024);
const VECTOR_DISTANCE = process.env.QDRANT_DISTANCE || 'Cosine';
const VECTOR_BATCH_SIZE = Number(process.env.VECTOR_INDEX_BATCH_SIZE || 16);
const QDRANT_RETRY_ATTEMPTS = Number(process.env.QDRANT_RETRY_ATTEMPTS || 2);
const QDRANT_RETRY_DELAY_MS = Number(process.env.QDRANT_RETRY_DELAY_MS || 800);

const pointIdFromChunkId = (chunkId: string) => chunkId.replace(/[^a-zA-Z0-9_-]/g, '_');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorMessage = (error: unknown) => {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) return `${error.message}: ${cause.message}`;
  return error.message;
};

const isRetryableError = (error: unknown) => {
  const message = errorMessage(error).toLowerCase();
  return /fetch failed|socket|econnreset|econnrefused|etimedout|terminated|timeout|und_err/i.test(message);
};

const qdrantFetch = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= QDRANT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${QDRANT_BASE_URL.replace(/\/$/, '')}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(QDRANT_API_KEY ? { 'api-key': QDRANT_API_KEY } : {}),
          ...(init.headers || {})
        }
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Qdrant HTTP ${response.status}: ${text || response.statusText}`);
      }

      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt >= QDRANT_RETRY_ATTEMPTS || !isRetryableError(error)) throw error;
      await sleep(QDRANT_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const chunkPayload = (chunk: DocumentChunkRecord) => ({
  chunkId: chunk.chunkId,
  workspaceId: chunk.workspaceId,
  fileId: chunk.fileId,
  fileObjectId: chunk.fileObjectId,
  parentId: chunk.parentId,
  chunkType: chunk.chunkType,
  fileName: chunk.fileName,
  filePath: chunk.filePath,
  chunkIndex: chunk.chunkIndex,
  text: chunk.text,
  summary: chunk.summary,
  headingPath: chunk.headingPath,
  sourceHash: chunk.sourceHash,
  tokenEstimate: chunk.tokenEstimate,
  locator: chunk.locator,
  metadata: chunk.metadata,
  updatedAt: chunk.updatedAt?.toISOString()
});

export class VectorStoreService {
  private collectionReady = false;

  async health() {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${QDRANT_BASE_URL.replace(/\/$/, '')}/collections/${QDRANT_COLLECTION}`, {
        headers: QDRANT_API_KEY ? { 'api-key': QDRANT_API_KEY } : undefined,
        signal: AbortSignal.timeout(Number(process.env.QDRANT_HEALTH_TIMEOUT_MS || 3000))
      });
      if (response.status === 404) {
        return {
          ok: false,
          reachable: true,
          collectionReady: false,
          latencyMs: Date.now() - startedAt,
          baseUrl: QDRANT_BASE_URL,
          collection: QDRANT_COLLECTION,
          error: 'Collection not found'
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          reachable: false,
          collectionReady: false,
          latencyMs: Date.now() - startedAt,
          baseUrl: QDRANT_BASE_URL,
          collection: QDRANT_COLLECTION,
          error: `HTTP ${response.status}`
        };
      }
      return {
        ok: true,
        reachable: true,
        collectionReady: true,
        latencyMs: Date.now() - startedAt,
        baseUrl: QDRANT_BASE_URL,
        collection: QDRANT_COLLECTION
      };
    } catch (error) {
      return {
        ok: false,
        reachable: false,
        collectionReady: false,
        latencyMs: Date.now() - startedAt,
        baseUrl: QDRANT_BASE_URL,
        collection: QDRANT_COLLECTION,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async ensureCollection() {
    if (this.collectionReady) return;

    const exists = await fetch(`${QDRANT_BASE_URL.replace(/\/$/, '')}/collections/${QDRANT_COLLECTION}`, {
      headers: QDRANT_API_KEY ? { 'api-key': QDRANT_API_KEY } : undefined
    });

    if (exists.status === 404) {
      await qdrantFetch(`/collections/${QDRANT_COLLECTION}`, {
        method: 'PUT',
        body: JSON.stringify({
          vectors: {
            size: VECTOR_SIZE,
            distance: VECTOR_DISTANCE
          }
        })
      });
    } else if (!exists.ok) {
      const text = await exists.text().catch(() => '');
      throw new Error(`Qdrant collection check failed: HTTP ${exists.status}: ${text || exists.statusText}`);
    }

    this.collectionReady = true;
  }

  async replaceFileChunks(input: { workspaceId: string; fileObjectId: string; chunks: DocumentChunkRecord[] }) {
    await this.ensureCollection();

    const pointBatches: Array<Array<{ id: string; vector: number[]; payload: Record<string, any> }>> = [];
    for (let index = 0; index < input.chunks.length; index += VECTOR_BATCH_SIZE) {
      const batch = input.chunks.slice(index, index + VECTOR_BATCH_SIZE);
      const vectors = await embeddingService.embedBatch(batch.map((chunk) => `${chunk.summary || ''}\n${chunk.text}`));
      pointBatches.push(batch.map((chunk, batchIndex) => ({
        id: pointIdFromChunkId(chunk.chunkId),
        vector: vectors[batchIndex],
        payload: chunkPayload(chunk)
      })));
    }

    await qdrantFetch(`/collections/${QDRANT_COLLECTION}/points/delete`, {
      method: 'POST',
      body: JSON.stringify({
        filter: {
          must: [
            { key: 'workspaceId', match: { value: input.workspaceId } },
            { key: 'fileObjectId', match: { value: input.fileObjectId } }
          ]
        }
      })
    });

    for (const points of pointBatches) {
      await qdrantFetch(`/collections/${QDRANT_COLLECTION}/points?wait=true`, {
        method: 'PUT',
        body: JSON.stringify({ points })
      });
    }
  }

  async search(input: {
    workspaceId: string;
    query: string;
    fileIds?: string[];
    limit?: number;
  }): Promise<VectorSearchResult[]> {
    await this.ensureCollection();
    const vector = await embeddingService.embed(input.query);
    if (!vector.length) return [];

    const must: Array<Record<string, unknown>> = [{ key: 'workspaceId', match: { value: input.workspaceId } }];
    if (input.fileIds?.length) {
      must.push({ key: 'fileObjectId', match: { any: input.fileIds } });
    }

    const body = {
      vector,
      limit: Math.min(Math.max(input.limit || 20, 1), 100),
      with_payload: true,
      with_vector: false,
      filter: { must }
    };

    const response = await qdrantFetch<any>(`/collections/${QDRANT_COLLECTION}/points/search`, {
      method: 'POST',
      body: JSON.stringify(body)
    });

    return (response.result || []).map((item: any) => ({
      chunkId: String(item.payload?.chunkId || item.id),
      score: Number(item.score || 0),
      payload: item.payload || {}
    }));
  }
}

export const vectorStoreService = new VectorStoreService();
