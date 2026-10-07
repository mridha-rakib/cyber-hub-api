import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { z } from "zod";
import { UUID_ROUTE_PARAMS_METADATA } from "../../common/decorators/validate-uuid-route-params.decorator";
import { ValidationPipe } from "./validation.pipe";

const uuidParamPipe = new ValidationPipe(z.uuid());

/**
 * Validates explicitly marked UUID route parameters before PermissionGuard can
 * resolve resource context through a repository. AuthGuard intentionally runs
 * first so protected routes retain their existing unauthenticated 401 response.
 */
@Injectable()
export class UuidRouteParamGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const paramNames = this.reflector.getAllAndOverride<string[]>(UUID_ROUTE_PARAMS_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!paramNames?.length) return true;

    const request = context.switchToHttp().getRequest<Request>();
    for (const paramName of paramNames) {
      uuidParamPipe.transform(request.params[paramName], {
        type: "param",
        data: paramName,
      });
    }
    return true;
  }
}
