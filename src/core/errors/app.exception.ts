import { HttpStatus } from "@nestjs/common";
import { type ErrorCode, ErrorCodes } from "./error.codes";

export interface AppExceptionOptions {
  code: ErrorCode;
  statusCode: HttpStatus;
  message: string;
  metadata?: Record<string, unknown>;
}

export class AppException extends Error {
  readonly code: ErrorCode;
  readonly statusCode: HttpStatus;
  readonly metadata?: Record<string, unknown>;

  constructor(options: AppExceptionOptions) {
    super(options.message);
    this.name = this.constructor.name;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.metadata = options.metadata;
  }
}

export class BadRequestException extends AppException {
  constructor(message = "Bad request", metadata?: Record<string, unknown>) {
    super({ code: ErrorCodes.BAD_REQUEST, statusCode: HttpStatus.BAD_REQUEST, message, metadata });
  }
}

export class UnauthorizedException extends AppException {
  constructor(message = "Unauthorized", metadata?: Record<string, unknown>) {
    super({
      code: ErrorCodes.UNAUTHORIZED,
      statusCode: HttpStatus.UNAUTHORIZED,
      message,
      metadata,
    });
  }
}

export class ForbiddenException extends AppException {
  constructor(message = "Forbidden", metadata?: Record<string, unknown>) {
    super({ code: ErrorCodes.FORBIDDEN, statusCode: HttpStatus.FORBIDDEN, message, metadata });
  }
}

export class NotFoundException extends AppException {
  constructor(message = "Resource not found", metadata?: Record<string, unknown>) {
    super({ code: ErrorCodes.NOT_FOUND, statusCode: HttpStatus.NOT_FOUND, message, metadata });
  }
}

export class ConflictException extends AppException {
  constructor(message = "Conflict", metadata?: Record<string, unknown>) {
    super({ code: ErrorCodes.CONFLICT, statusCode: HttpStatus.CONFLICT, message, metadata });
  }
}

export class DatabaseException extends AppException {
  constructor(message = "Database operation failed", metadata?: Record<string, unknown>) {
    super({
      code: ErrorCodes.DATABASE_ERROR,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message,
      metadata,
    });
  }
}

export class AuthRequiredException extends AppException {
  constructor(message = "Authentication required", metadata?: Record<string, unknown>) {
    super({
      code: ErrorCodes.AUTH_REQUIRED,
      statusCode: HttpStatus.UNAUTHORIZED,
      message,
      metadata,
    });
  }
}

export class InvalidCredentialsException extends AppException {
  constructor(message = "Invalid email or password", metadata?: Record<string, unknown>) {
    super({
      code: ErrorCodes.INVALID_CREDENTIALS,
      statusCode: HttpStatus.UNAUTHORIZED,
      message,
      metadata,
    });
  }
}

export class SessionExpiredException extends AppException {
  constructor(message = "Session expired or revoked", metadata?: Record<string, unknown>) {
    super({
      code: ErrorCodes.SESSION_EXPIRED,
      statusCode: HttpStatus.UNAUTHORIZED,
      message,
      metadata,
    });
  }
}

export class PermissionDeniedException extends AppException {
  constructor(
    message = "You do not have permission to perform this action",
    metadata?: Record<string, unknown>,
  ) {
    super({ code: ErrorCodes.FORBIDDEN, statusCode: HttpStatus.FORBIDDEN, message, metadata });
  }
}

export class AuthorizationMisconfiguredException extends AppException {
  constructor(
    message = "This route is not authorized for access",
    metadata?: Record<string, unknown>,
  ) {
    super({ code: ErrorCodes.FORBIDDEN, statusCode: HttpStatus.FORBIDDEN, message, metadata });
  }
}

export class CsrfInvalidException extends AppException {
  constructor(message = "Missing or invalid CSRF token", metadata?: Record<string, unknown>) {
    super({ code: ErrorCodes.CSRF_INVALID, statusCode: HttpStatus.FORBIDDEN, message, metadata });
  }
}

export class RateLimitedException extends AppException {
  constructor(message = "Too many requests", metadata?: Record<string, unknown>) {
    super({
      code: ErrorCodes.RATE_LIMITED,
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message,
      metadata,
    });
  }
}

export class UniqueConstraintConflictException extends AppException {
  constructor(message = "Resource already exists", metadata?: Record<string, unknown>) {
    super({
      code: ErrorCodes.UNIQUE_CONSTRAINT_CONFLICT,
      statusCode: HttpStatus.CONFLICT,
      message,
      metadata,
    });
  }
}
