import { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError';

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found', code: 'NOT_FOUND', path: req.path });
};

export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: error.expose ? error.message : 'Request failed',
      code: error.code
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error('Unhandled request error:', error);

  return res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
    code: 'INTERNAL_SERVER_ERROR'
  });
};
