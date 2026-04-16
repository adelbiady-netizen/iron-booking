"use strict";
// Domain error hierarchy — catch by type in controllers to map to HTTP status codes
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockTimeoutError = exports.BlacklistedCustomerError = exports.BookingError = exports.ConflictError = exports.ValidationError = exports.NotFoundError = exports.AppError = void 0;
class AppError extends Error {
    statusCode;
    code;
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.AppError = AppError;
class NotFoundError extends AppError {
    constructor(resource, id) {
        super(`${resource} not found: ${id}`, 404, 'NOT_FOUND');
    }
}
exports.NotFoundError = NotFoundError;
class ValidationError extends AppError {
    constructor(message) {
        super(message, 400, 'VALIDATION_ERROR');
    }
}
exports.ValidationError = ValidationError;
class ConflictError extends AppError {
    constructor(message) {
        super(message, 409, 'CONFLICT');
    }
}
exports.ConflictError = ConflictError;
class BookingError extends AppError {
    bookingCode;
    constructor(message, bookingCode) {
        super(message, 422, bookingCode);
        this.bookingCode = bookingCode;
    }
}
exports.BookingError = BookingError;
class BlacklistedCustomerError extends AppError {
    constructor(customerId) {
        super(`Customer ${customerId} is blacklisted`, 403, 'CUSTOMER_BLACKLISTED');
    }
}
exports.BlacklistedCustomerError = BlacklistedCustomerError;
class LockTimeoutError extends AppError {
    constructor() {
        super('Could not acquire booking lock — please try again', 503, 'LOCK_TIMEOUT');
    }
}
exports.LockTimeoutError = LockTimeoutError;
