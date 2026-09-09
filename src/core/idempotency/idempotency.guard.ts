import { createHash } from "node:crypto";
import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import { IdempotencyService } from "./idempotency.service";

@Injectable()
export class IdempotencyGuard implements CanActivate {
  constructor(private readonly idempotencyService: IdempotencyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const key = request.header("Idempotency-Key");

    if (!key) {
      return true;
    }

    const requestHash = createHash("sha256")
      .update(`${request.method}:${request.originalUrl}:${JSON.stringify(request.body ?? {})}`)
      .digest("hex");

    const existing = await this.idempotencyService.getCompleted(key);

    if (existing) {
      response.status(existing.statusCode ?? 200).json(existing.responseBody);
      return false;
    }

    await this.idempotencyService.reserve(key, requestHash);
    request.idempotencyKey = key;
    return true;
  }
}
