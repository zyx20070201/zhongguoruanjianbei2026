const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || 'http://localhost:8081';
const RERANKER_BASE_URL = process.env.RERANKER_BASE_URL || 'http://localhost:8082';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'BAAI/bge-m3';
const RERANKER_MODEL = process.env.RERANKER_MODEL || 'BAAI/bge-reranker-v2-m3';
const EMBEDDING_TIMEOUT_MS = Number(process.env.EMBEDDING_TIMEOUT_MS || 30000);
const RERANKER_TIMEOUT_MS = Number(process.env.RERANKER_TIMEOUT_MS || 30000);
const RETRY_ATTEMPTS = Number(process.env.EMBEDDING_RETRY_ATTEMPTS || 2);
const RETRY_DELAY_MS = Number(process.env.EMBEDDING_RETRY_DELAY_MS || 800);

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

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promise;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const postJson = async <T>(baseUrl: string, path: string, body: unknown, timeoutMs: number): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt >= RETRY_ATTEMPTS || !isRetryableError(error)) throw error;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const normalizeEmbeddingResponse = (value: any): number[] => {
  if (Array.isArray(value) && typeof value[0] === 'number') return value;
  if (Array.isArray(value) && Array.isArray(value[0])) return value[0];
  if (Array.isArray(value?.data) && Array.isArray(value.data[0]?.embedding)) return value.data[0].embedding;
  if (Array.isArray(value?.embeddings) && Array.isArray(value.embeddings[0])) return value.embeddings[0];
  throw new Error('Embedding service returned an unsupported response shape');
};

const normalizeBatchEmbeddingResponse = (value: any): number[][] => {
  if (Array.isArray(value) && Array.isArray(value[0])) return value;
  if (Array.isArray(value?.data)) return value.data.map((item: any) => item.embedding).filter(Array.isArray);
  if (Array.isArray(value?.embeddings)) return value.embeddings.filter((item: unknown) => Array.isArray(item));
  const single = normalizeEmbeddingResponse(value);
  return [single];
};

const normalizeRerankResponse = (value: any): Array<{ index: number; score: number }> => {
  if (Array.isArray(value?.scores)) {
    return value.scores
      .map((score: unknown, index: number) => ({ index, score: Number(score) }))
      .filter((item: { index: number; score: number }) => Number.isFinite(item.score));
  }

  const rawItems = Array.isArray(value) ? value : Array.isArray(value?.results) ? value.results : Array.isArray(value?.data) ? value.data : [];
  return rawItems
    .map((item: any, fallbackIndex: number) => ({
      index: Number(item.index ?? item.document?.index ?? fallbackIndex),
      score: Number(item.score ?? item.relevance_score ?? item.relevanceScore ?? 0)
    }))
    .filter((item: { index: number; score: number }) => Number.isFinite(item.index) && Number.isFinite(item.score));
};

export class EmbeddingService {
  async health() {
    const startedAt = Date.now();
    const embedding = await this.embed('health check').then((vector) => ({
      ok: vector.length > 0,
      dimension: vector.length,
      latencyMs: Date.now() - startedAt,
      model: EMBEDDING_MODEL,
      baseUrl: EMBEDDING_BASE_URL
    })).catch((error) => ({
      ok: false,
      dimension: 0,
      latencyMs: Date.now() - startedAt,
      model: EMBEDDING_MODEL,
      baseUrl: EMBEDDING_BASE_URL,
      error: error instanceof Error ? error.message : String(error)
    }));

    const rerankStartedAt = Date.now();
    const reranker = await this.rerank({ query: 'health', documents: ['health check document'] }).then((scores) => ({
      ok: scores.length > 0,
      latencyMs: Date.now() - rerankStartedAt,
      model: RERANKER_MODEL,
      baseUrl: RERANKER_BASE_URL
    })).catch((error) => ({
      ok: false,
      latencyMs: Date.now() - rerankStartedAt,
      model: RERANKER_MODEL,
      baseUrl: RERANKER_BASE_URL,
      error: error instanceof Error ? error.message : String(error)
    }));

    return { embedding, reranker };
  }

  async embed(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const response = await withTimeout(
      postJson<any>(
        EMBEDDING_BASE_URL,
        '/embed',
        {
          inputs: [trimmed],
          model: EMBEDDING_MODEL,
          normalize: true
        },
        EMBEDDING_TIMEOUT_MS
      ),
      EMBEDDING_TIMEOUT_MS + 500,
      'Embedding request'
    );

    return normalizeEmbeddingResponse(response);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const inputs = texts.map((text) => text.trim()).filter(Boolean);
    if (inputs.length === 0) return [];

    const response = await withTimeout(
      postJson<any>(
        EMBEDDING_BASE_URL,
        '/embed',
        {
          inputs,
          model: EMBEDDING_MODEL,
          normalize: true
        },
        EMBEDDING_TIMEOUT_MS
      ),
      EMBEDDING_TIMEOUT_MS + 500,
      'Batch embedding request'
    );

    return normalizeBatchEmbeddingResponse(response);
  }

  async rerank(input: { query: string; documents: string[] }): Promise<Array<{ index: number; score: number }>> {
    const query = input.query.trim();
    const documents = input.documents.map((document) => document.trim());
    if (!query || documents.length === 0) return [];

    const response = await withTimeout(
      postJson<any>(
        RERANKER_BASE_URL,
        '/rerank',
        {
          query,
          texts: documents,
          documents,
          model: RERANKER_MODEL,
          normalize: true
        },
        RERANKER_TIMEOUT_MS
      ),
      RERANKER_TIMEOUT_MS + 500,
      'Reranker request'
    );

    return normalizeRerankResponse(response);
  }
}

export const embeddingService = new EmbeddingService();
