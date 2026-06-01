import { PrismaClient } from '@prisma/client';

const DEFAULT_SQLITE_URL = 'file:./dev.db?connection_limit=1&pool_timeout=30';
const SQLITE_BUSY_TIMEOUT_MS = Number(process.env.SQLITE_BUSY_TIMEOUT_MS || 30000);

const buildDatasourceUrl = () => {
  const configuredUrl = process.env.DATABASE_URL || DEFAULT_SQLITE_URL;
  if (!configuredUrl.startsWith('file:')) return configuredUrl;

  const [base, query = ''] = configuredUrl.split('?');
  const params = new URLSearchParams(query);
  if (!params.has('connection_limit')) params.set('connection_limit', process.env.SQLITE_CONNECTION_LIMIT || '1');
  if (!params.has('pool_timeout')) params.set('pool_timeout', process.env.PRISMA_POOL_TIMEOUT_SECONDS || '30');
  return `${base}?${params.toString()}`;
};

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: buildDatasourceUrl()
    }
  }
});

export const configureSqliteConnection = async () => {
  const datasourceUrl = buildDatasourceUrl();
  if (!datasourceUrl.startsWith('file:')) return;

  await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
};

export const isPrismaTimeoutError = (error: unknown) => {
  const anyError = error as { code?: string; message?: string };
  const message = anyError?.message || '';
  return (
    anyError?.code === 'P2024' ||
    message.includes('Operations timed out') ||
    message.includes('database failed to respond') ||
    message.includes('Timed out fetching a new connection')
  );
};

export const withPrismaRetry = async <T>(
  operation: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> => {
  const retries = options.retries ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 150;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isPrismaTimeoutError(error) || attempt === retries) break;
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
};

export default prisma;
