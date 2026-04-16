// Domain error hierarchy — catch by type in controllers to map to HTTP status codes

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'INTERNAL_ERROR',
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 404, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class BookingError extends AppError {
  constructor(
    message: string,
    public readonly bookingCode: BookingErrorCode,
  ) {
    super(message, 422, bookingCode);
  }
}

export class BlacklistedCustomerError extends AppError {
  constructor(customerId: string) {
    super(`Customer ${customerId} is blacklisted`, 403, 'CUSTOMER_BLACKLISTED');
  }
}

export class LockTimeoutError extends AppError {
  constructor() {
    super('Could not acquire booking lock — please try again', 503, 'LOCK_TIMEOUT');
  }
}

export type BookingErrorCode =
  | 'RESTAURANT_CLOSED'
  | 'OUTSIDE_SERVICE_HOURS'
  | 'PAST_LAST_SEATING'
  | 'NO_TABLES_AVAILABLE'
  | 'CUSTOMER_BLACKLISTED'
  | 'PARTY_TOO_LARGE'
  | 'DOUBLE_BOOKING_DETECTED'
  | 'BOOKING_IN_PAST'
  | 'BOOKING_TOO_FAR_AHEAD';
