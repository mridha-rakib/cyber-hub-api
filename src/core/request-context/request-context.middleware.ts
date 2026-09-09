import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { RequestContextService } from "./request-context.service";
import { createRequestId } from "./request-id.util";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(request: Request, response: Response, next: NextFunction) {
    const requestId = createRequestId(request.header("x-request-id"));

    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);

    this.requestContext.run({ requestId }, next);
  }
}
