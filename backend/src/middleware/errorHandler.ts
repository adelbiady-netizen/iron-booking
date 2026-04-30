import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';
import { ZodError } from 'zod';

const IS_DEV = process.env.NODE_ENV === 'development';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.flatten(),
      },
    });
    return;
  }

  // Prisma unique constraint violation
  if (isP2002(err)) {
    res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'A record with these values already exists',
        details: (err as any).meta,
      },
    });
    return;
  }

  // Prisma record not found
  if (isP2025(err)) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Record not found',
      },
    });
    return;
  }

  console.error('[UnhandledError]', err);

  // In development, surface the real error so it is easy to diagnose.
  // In production this stays opaque.
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: IS_DEV
        ? ((err as any)?.message ?? String(err))
        : 'An unexpected error occurred',
      ...(IS_DEV && { stack: ((err as any)?.stack ?? '').split('\n').slice(0, 6) }),
    },
  });
}

function isP2002(err: unknown): boolean {
  return (err as any)?.code === 'P2002';
}

function isP2025(err: unknown): boolean {
  return (err as any)?.code === 'P2025';
}
