import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
type Target = 'body' | 'query' | 'params';
export declare function validate(schema: ZodSchema, target?: Target): (req: Request, res: Response, next: NextFunction) => void;
export {};
//# sourceMappingURL=validate.d.ts.map