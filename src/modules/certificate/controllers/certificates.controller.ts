import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { Public } from "../../../common/decorators/public.decorator";
import { IdempotencyGuard } from "../../../core/idempotency/idempotency.guard";
import { IdempotencyInterceptor } from "../../../core/idempotency/idempotency.interceptor";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import { type CertificateIssueInput, certificateIssueSchema } from "../dto/certificate-issue.dto";
import {
  type CertificateRevokeInput,
  certificateRevokeSchema,
} from "../dto/certificate-revoke.dto";
import { CertificateService } from "../services/certificate.service";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(limit?: string): number {
  const parsed = limit ? Number.parseInt(limit, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

@Controller()
export class CertificatesController {
  constructor(private readonly certificateService: CertificateService) {}

  @Public()
  @Get("certificates/verify/:verificationPath")
  verifyPublic(@Param("verificationPath") verificationPath: string) {
    return this.certificateService.verifyPublic(verificationPath);
  }

  @AuthorizeOperation("API-CER-003")
  @Get("me/certificates")
  listOwn(
    @CurrentUser() principal: AuthPrincipal,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.certificateService.listOwn(principal.userId, { cursor, limit: clampLimit(limit) });
  }

  @AuthorizeOperation("API-CER-004")
  @Get("me/certificates/:certificateId")
  getOwn(@Param("certificateId") certificateId: string, @CurrentUser() principal: AuthPrincipal) {
    return this.certificateService.getOwn(certificateId, principal.userId);
  }

  @AuthorizeOperation("API-CER-002")
  @UseGuards(IdempotencyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @Post("admin/internship-enrollments/:enrollmentId/certificate")
  issue(
    @Param("enrollmentId") enrollmentId: string,
    @Body(new ValidationPipe(certificateIssueSchema)) body: CertificateIssueInput,
  ) {
    return this.certificateService.issue(enrollmentId, body);
  }

  @AuthorizeOperation("API-CER-006")
  @HttpCode(200)
  @Post("admin/certificates/:certificateId/revoke")
  revoke(
    @Param("certificateId") certificateId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(certificateRevokeSchema)) body: CertificateRevokeInput,
  ) {
    return this.certificateService.revoke(certificateId, principal.userId, body.reason);
  }
}
