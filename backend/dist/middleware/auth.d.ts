import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
export interface AuthPayload {
    userId: string;
    restaurantId: string;
    role: UserRole;
    email: string;
}
declare global {
    namespace Express {
        interface Request {
            auth: AuthPayload;
        }
    }
}
export declare function authenticate(req: Request, res: Response, next: NextFunction): void;
export declare function requireRole(...roles: UserRole[]): (req: Request, res: Response, next: NextFunction) => void;
export declare function scopeToRestaurant(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map