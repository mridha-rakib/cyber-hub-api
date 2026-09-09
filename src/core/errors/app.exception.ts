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
