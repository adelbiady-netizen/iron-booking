"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessRuleError = exports.UnauthorizedError = exports.ForbiddenError = exports.ValidationError = exports.ConflictError = exports.NotFoundError = exports.AppError = void 0;
class AppError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, code, message, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.name = 'AppError';
        Object.setPrototypeOf(this, AppError.prototype);
    }
}
exports.AppError = AppError;
class NotFoundError extends AppError {
    constructor(resource, id) {
        super(404, 'NOT_FOUND', id ? `${resource} '${id}' not found` : `${resource} not found`);
    }
}
exports.NotFoundError = NotFoundError;
class ConflictError extends AppError {
    constructor(message, details) {
        super(409, 'CONFLICT', message, details);
    }
}
exports.ConflictError = ConflictError;
class ValidationError extends AppError {
    constructor(message, details) {
        super(422, 'VALIDATION_ERROR', message, details);
    }
}
exports.ValidationError = ValidationError;
class ForbiddenError extends AppError {
    constructor(message = 'Forbidden') {
        super(403, 'FORBIDDEN', message);
    }
}
exports.ForbiddenError = ForbiddenError;
class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized') {
        super(401, 'UNAUTHORIZED', message);
    }
}
exports.UnauthorizedError = UnauthorizedError;
class BusinessRuleError extends AppError {
    constructor(message, details) {
        super(400, 'BUSINESS_RULE_VIOLATION', message, details);
    }
}
exports.BusinessRuleError = BusinessRuleError;
//# sourceMappingURL=errors.js.map