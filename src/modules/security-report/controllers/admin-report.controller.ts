import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ValidateUuidRouteParams } from "../../../common/decorators/validate-uuid-route-params.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  type ReportReleaseInput,
  type ReportSupersedeInput,
  reportReleaseInputSchema,
  reportSupersedeInputSchema,
} from "../dto/security-report.dto";
import { SecurityReportService } from "../services/security-report.service";

/** Admin-only report release (gated by GAP-013) and explicit supersede. */
@Controller()
export class AdminReportController {
  constructor(private readonly reports: SecurityReportService) {}
  @AuthorizeOperation("API-RPT-008")
  @ValidateUuidRouteParams("reportId")
  @Post("admin/reports/:reportId/release")
  @HttpCode(200)
  release(
    @Param("reportId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(reportReleaseInputSchema)) body: ReportReleaseInput,
  ) {
    return this.reports.release(id, principal, body);
  }
  @AuthorizeOperation("API-RPT-009")
  @ValidateUuidRouteParams("reportId")
  @Post("admin/reports/:reportId/supersede")
  @HttpCode(200)
  supersede(
    @Param("reportId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(reportSupersedeInputSchema)) body: ReportSupersedeInput,
  ) {
    return this.reports.supersede(id, principal, body);
  }
}
