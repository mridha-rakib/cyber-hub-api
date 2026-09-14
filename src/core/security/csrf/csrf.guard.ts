import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { appConfig } from "../../config/app.config";
import { CsrfInvalidException } from "../../errors/app.exception";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../cookie/cookie.constants";
import { parseCookies } from "../cookie/cookie.util";
import { CsrfService } from "./csrf.service";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly csrfService: CsrfService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!UNSAFE_METHODS.has(request.method)) return true;

    const origin = request.headers.origin;
    if (origin && !appConfig.corsOrigins.includes(origin)) {
      throw new CsrfInvalidException("Request origin is not an approved frontend origin");
    }

    const cookies = parseCookies(request.headers.cookie);
    const cookieToken = cookies[CSRF_COOKIE_NAME];
    const headerToken = request.headers[CSRF_HEADER_NAME] as string | undefined;

    if (!this.csrfService.matches(cookieToken, headerToken)) {
      throw new CsrfInvalidException();
    }

    return true;
  }
}
