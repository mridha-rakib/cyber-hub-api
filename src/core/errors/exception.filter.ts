import type { LoggerService } from "@core/logger/logger.service";
import {
  type ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter as NestExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
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

    this.logger.error(
      errorResponse.message,
      exception instanceof Error ? exception.stack : undefined,
      {
        code: errorResponse.code,
        method: request.method,
        path: request.url,
        requestId,
        statusCode: errorResponse.statusCode,
      },
    );

    response.status(errorResponse.statusCode).json({
      success: false,
      code: errorResponse.code,
      message: errorResponse.message,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(errorResponse.metadata ? { metadata: errorResponse.metadata } : {}),
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
