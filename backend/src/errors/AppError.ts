export class AppError extends Error {
  statusCode: number;
  code: string;
  expose: boolean;

  constructor(statusCode: number, message: string, code = 'APP_ERROR', expose = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.expose = expose;
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') => new AppError(400, message, code);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') => new AppError(401, message, code);
export const forbidden = (message = 'Forbidden', code = 'FORBIDDEN') => new AppError(403, message, code);
export const notFound = (message = 'Not found', code = 'NOT_FOUND') => new AppError(404, message, code);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, message, code);
export const tooManyRequests = (message = 'Too many requests. Please try again later.', code = 'RATE_LIMITED') =>
  new AppError(429, message, code);
