import { CallHandler, ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import type { Request } from "express";
import { map, type Observable } from "rxjs";
import { RAW_RESPONSE } from "../../common/decorators/raw-response.decorator";
import type { ApiResponse } from "./api.response";

interface ResponsePayload<TData = unknown, TMeta = unknown> {
  message?: string;
  data?: TData;
  meta?: TMeta;
}

@Injectable()
export class ResponseInterceptor<TData> implements NestInterceptor<TData, ApiResponse<TData>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<TData>> {
    if (Reflect.getMetadata(RAW_RESPONSE, context.getHandler())) {
      return next.handle() as Observable<ApiResponse<TData>>;
    }
    const request = context.switchToHttp().getRequest<Request & { requestId?: string }>();
    return next.handle().pipe(
      map((payload: TData | ResponsePayload<TData>) => {
        const normalized = this.normalizePayload(payload);

        return {
          success: true,
          message: normalized.message,
          data: normalized.data,
          ...(normalized.meta ? { meta: normalized.meta } : {}),
          requestId: request.requestId ?? "",
        };
      }),
    );
  }

  private normalizePayload(payload: TData | ResponsePayload<TData>) {
    if (payload && typeof payload === "object" && ("data" in payload || "message" in payload)) {
      const responsePayload = payload as ResponsePayload<TData>;

      return {
        message: responsePayload.message ?? "Success",
        data: responsePayload.data as TData,
        meta: responsePayload.meta,
      };
    }

    return {
      message: "Success",
      data: payload as TData,
    };
  }
}
