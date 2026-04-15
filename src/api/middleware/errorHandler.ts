import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error('\n========== ERROR HANDLER ==========');
  console.error(err);
  console.error('message:', err?.message);
  console.error('code:', err?.code);
  console.error('statusCode:', err?.statusCode);
  console.error('stack:', err?.stack);
  console.error('===================================\n');

  return res.status(err?.statusCode || 500).json({
    error: {
      code: err?.code || 'INTERNAL_ERROR',
      message: err?.message || 'An unexpected error occurred',
    },
  });
}