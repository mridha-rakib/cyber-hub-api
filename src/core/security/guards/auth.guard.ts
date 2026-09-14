import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_ROUTE } from "../../../common/decorators/public.decorator";
import { SessionService } from "../../../modules/auth/services/session.service";
import { AuthRequiredException, SessionExpiredException } from "../../errors/app.exception";
import { SESSION_COOKIE_NAME } from "../cookie/cookie.constants";
import { parseCookies } from "../cookie/cookie.util";

export interface AuthenticatedRequest extends Request {
  principal?: Awaited<ReturnType<SessionService["authenticate"]>>;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = parseCookies(request.headers.cookie);
    const sessionSecret = cookies[SESSION_COOKIE_NAME];
    if (!sessionSecret) throw new AuthRequiredException();

    const principal = await this.sessionService.authenticate(sessionSecret);
    if (!principal) throw new SessionExpiredException();

    request.principal = principal;
    return true;
  }
}
