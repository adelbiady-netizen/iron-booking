"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.requireRole = requireRole;
exports.scopeToRestaurant = scopeToRestaurant;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const errors_1 = require("../lib/errors");
function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        next(new errors_1.UnauthorizedError('Missing or invalid authorization header'));
        return;
    }
    const token = header.slice(7);
    try {
        const payload = jsonwebtoken_1.default.verify(token, config_1.config.jwtSecret);
        req.auth = payload;
        next();
    }
    catch {
        next(new errors_1.UnauthorizedError('Invalid or expired token'));
    }
}
// Middleware factory: require minimum role level
const roleHierarchy = {
    ADMIN: 4,
    MANAGER: 3,
    HOST: 2,
    SERVER: 1,
};
function requireRole(...roles) {
    return (req, res, next) => {
        const userLevel = roleHierarchy[req.auth.role] ?? 0;
        const minRequired = Math.min(...roles.map((r) => roleHierarchy[r]));
        if (userLevel < minRequired) {
            next(new errors_1.ForbiddenError(`Requires role: ${roles.join(' or ')}`));
            return;
        }
        next();
    };
}
// Ensure request restaurantId param matches the JWT restaurantId
function scopeToRestaurant(req, res, next) {
    const paramId = req.params.restaurantId ?? req.query.restaurantId;
    if (paramId && paramId !== req.auth.restaurantId) {
        next(new errors_1.ForbiddenError('Cross-restaurant access denied'));
        return;
    }
    next();
}
//# sourceMappingURL=auth.js.map