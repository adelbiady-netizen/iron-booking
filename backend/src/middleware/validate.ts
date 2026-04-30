import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

type Target = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, target: Target = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const flatten = result.error.flatten();
      const fieldParts = Object.entries(flatten.fieldErrors)
        .flatMap(([field, errs]) => ((errs as string[] | undefined) ?? []).map((e: string) => `${field}: ${e}`));
      const message = fieldParts.length > 0
        ? fieldParts.join('; ')
        : (flatten.formErrors[0] ?? 'Request validation failed');
      res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message,
          details: flatten,
        },
      });
      return;
    }
    // req.query is a getter-only property on IncomingMessage in Express 5.
    // Direct assignment throws "has only a getter". Shadow it on the instance
    // with a configurable own property so downstream code reads Zod-parsed data.
    Object.defineProperty(req, target, {
      value: result.data,
      writable: true,
      configurable: true,
    });
    next();
  };
}
