import { NextFunction, Request, Response } from 'express';
import { tooManyRequests } from '../errors/AppError';

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export const createRateLimit = (options: { windowMs: number; max: number; keyPrefix: string; keyFn?: (req: Request) => string }) => {
  const cleanup = () => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  };

  setInterval(cleanup, Math.max(30_000, Math.min(options.windowMs, 5 * 60_000))).unref?.();

  return (req: Request, res: Response, next: NextFunction) => {
    cleanup();

    const key = `${options.keyPrefix}:${options.keyFn ? options.keyFn(req) : req.ip || 'unknown'}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (bucket.count >= options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return next(tooManyRequests());
    }

    bucket.count += 1;
    return next();
  };
};
