import {
  type ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter as NestExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { LoggerService } from "../logger/logger.service";
import { AppException } from "./app.exception";
import { ErrorCodes } from "./error.codes";

@Catch()
export class ExceptionFilter implements NestExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId ?? response.getHeader("x-request-id")?.toString() ?? "";
    const errorResponse = this.normalizeException(exception);

    const fields = {
      err: exception instanceof Error ? exception : undefined,
      code: errorResponse.code,
      method: request.method,
      path: request.path,
      requestId,
      statusCode: errorResponse.statusCode,
    };
    if (errorResponse.statusCode >= 500) this.logger.error("HTTP exception", fields);
    else this.logger.warn("HTTP exception", fields);

    response.status(errorResponse.statusCode).json({
      error: {
        code: errorResponse.code,
        message: errorResponse.statusCode >= 500 ? "Internal server error" : errorResponse.message,
        ...(errorResponse.statusCode < 500 && errorResponse.metadata
          ? { details: errorResponse.metadata }
          : {}),
      },
      requestId,
    });
  }

  private normalizeException(exception: unknown) {
    if (exception instanceof AppException) {
      return {
        statusCode: exception.statusCode,
        code: exception.code,
        message: exception.message,
        metadata: exception.metadata,
      };
    }

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const bodyObject =
        typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

      return {
        statusCode: exception.getStatus(),
        code: typeof bodyObject.code === "string" ? bodyObject.code : ErrorCodes.BAD_REQUEST,
        message: typeof bodyObject.message === "string" ? bodyObject.message : exception.message,
        metadata: typeof bodyObject.errors === "object" ? { errors: bodyObject.errors } : undefined,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCodes.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
    };
  }
}
