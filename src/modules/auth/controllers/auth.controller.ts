import { Body, Controller, Delete, Get, HttpCode, Post, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { AuthenticatedOnly } from "../../../common/decorators/authenticated-only.decorator";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { Public } from "../../../common/decorators/public.decorator";
import { RawResponse } from "../../../common/decorators/raw-response.decorator";
import { appConfig } from "../../../core/config/app.config";
import { BadRequestException } from "../../../core/errors/app.exception";
import {
  CSRF_COOKIE_NAME,
  csrfCookieOptions,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "../../../core/security/cookie/cookie.constants";
import { CsrfGuard } from "../../../core/security/csrf/csrf.guard";
import { CsrfService } from "../../../core/security/csrf/csrf.service";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import { emailActionRequestSchema } from "../dto/email-action-request.dto";
import { loginSchema } from "../dto/login.dto";
import { passwordResetConfirmSchema } from "../dto/password-reset-confirm.dto";
import { registerBusinessSchema } from "../dto/register-business.dto";
import { registerLearnerSchema } from "../dto/register-learner.dto";
import { tokenConfirmSchema } from "../dto/token-confirm.dto";
import { EmailVerificationService } from "../services/email-verification.service";
import { PasswordResetService } from "../services/password-reset.service";
import { RegistrationService } from "../services/registration.service";
import { SessionService } from "../services/session.service";
import type { AuthPrincipal } from "../services/session-authentication.types";
import { SessionViewBuilder } from "../services/session-view.builder";
import { InvalidTokenError } from "../services/token-lifecycle.service";

const AUTH_SENSITIVE_THROTTLE = {
  default: {
    limit: appConfig.auth.rateLimit.maxRequests,
    ttl: appConfig.auth.rateLimit.ttlSeconds * 1000,
  },
};

@UseGuards(CsrfGuard)
@Controller("auth")
export class AuthController {
  constructor(
    private readonly registrationService: RegistrationService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly sessionService: SessionService,
    private readonly passwordResetService: PasswordResetService,
    private readonly sessionViewBuilder: SessionViewBuilder,
    private readonly csrfService: CsrfService,
  ) {}

  @Public()
  @Get("csrf-token")
  issueCsrfToken(@Res({ passthrough: true }) response: Response) {
    const token = this.csrfService.generateToken();
    response.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions());
    return { csrfToken: token };
  }

  @Public()
  @Throttle(AUTH_SENSITIVE_THROTTLE)
  @Post("register/learner")
  @HttpCode(201)
  async registerLearner(@Body(new ValidationPipe(registerLearnerSchema)) body: unknown) {
    return this.registrationService.registerLearner(
      body as Parameters<RegistrationService["registerLearner"]>[0],
    );
  }

  @Public()
  @Throttle(AUTH_SENSITIVE_THROTTLE)
  @Post("register/business")
  @HttpCode(201)
  async registerBusiness(@Body(new ValidationPipe(registerBusinessSchema)) body: unknown) {
    return this.registrationService.registerBusiness(
      body as Parameters<RegistrationService["registerBusiness"]>[0],
    );
  }

  @Public()
  @Throttle(AUTH_SENSITIVE_THROTTLE)
  @Post("email-verification/request")
  @HttpCode(202)
  async requestEmailVerification(
    @Body(new ValidationPipe(emailActionRequestSchema)) body: { email: string },
  ) {
    await this.emailVerificationService.requestVerification(body.email);
    return {};
  }

  @Public()
  @Post("email-verification/confirm")
  @HttpCode(200)
  async confirmEmailVerification(
    @Body(new ValidationPipe(tokenConfirmSchema)) body: { token: string },
  ) {
    try {
      await this.emailVerificationService.confirm(body.token);
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    return { verified: true };
  }

  @Public()
  @Throttle(AUTH_SENSITIVE_THROTTLE)
  @Post("sessions")
  @HttpCode(200)
  async login(
    @Body(new ValidationPipe(loginSchema)) body: { email: string; password: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const { rawSessionSecret, user } = await this.sessionService.login(body.email, body.password);
    response.cookie(SESSION_COOKIE_NAME, rawSessionSecret, sessionCookieOptions());
    return this.sessionViewBuilder.build(user);
  }

  @AuthenticatedOnly()
  @Get("session")
  @HttpCode(200)
  async getCurrentSession(@CurrentUser() principal: AuthPrincipal) {
    return this.sessionViewBuilder.build(principal.user);
  }

  @AuthenticatedOnly()
  @RawResponse()
  @Delete("session")
  @HttpCode(204)
  async logout(
    @CurrentUser() principal: AuthPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.sessionService.logout(principal.sessionId, principal.userId);
    response.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
  }

  @Public()
  @Throttle(AUTH_SENSITIVE_THROTTLE)
  @Post("password-reset/request")
  @HttpCode(202)
  async requestPasswordReset(
    @Body(new ValidationPipe(emailActionRequestSchema)) body: { email: string },
  ) {
    await this.passwordResetService.requestReset(body.email);
    return {};
  }

  @Public()
  @Throttle(AUTH_SENSITIVE_THROTTLE)
  @Post("password-reset/confirm")
  @HttpCode(200)
  async confirmPasswordReset(
    @Body(new ValidationPipe(passwordResetConfirmSchema)) body: {
      token: string;
      newPassword: string;
    },
  ) {
    try {
      await this.passwordResetService.confirmReset(body.token, body.newPassword);
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    return {};
  }
}
