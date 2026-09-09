import { LoggerService } from "@core/logger/logger.service";
import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { RequestContextService } from "./request-context.service";
import { createRequestId } from "./request-id.util";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly logger: LoggerService,
  ) {}

  use(request: Request, response: Response, next: NextFunction) {
    const requestId = createRequestId(request.header("x-request-id"));
    const startedAt = process.hrtime.bigint();

    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);

    this.requestContext.run({ requestId }, () => {
      response.on("finish", () => {
        const responseTimeMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

        this.logger.log("HTTP request completed", {
          requestId,
          method: request.method,
          path: request.originalUrl,
          statusCode: response.statusCode,
          responseTime: Number(responseTimeMs.toFixed(2)),
          userId: request.userId,
          companyId: request.companyId,
        });
      });

      next();
    });
  }
}
