import { CallHandler, ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { catchError, type Observable, tap, throwError } from "rxjs";
import { IdempotencyService } from "./idempotency.service";

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotencyService: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const key = request.idempotencyKey;

    if (!key) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((responseBody) => {
        void this.idempotencyService.complete(key, responseBody, response.statusCode);
      }),
      catchError((error: unknown) => {
        void this.idempotencyService.fail(key);
        return throwError(() => error);
      }),
    );
  }
}
