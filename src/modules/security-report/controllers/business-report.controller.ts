import { Controller, Get, Param, Query } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ValidateUuidRouteParams } from "../../../common/decorators/validate-uuid-route-params.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  type BusinessReportListQuery,
  businessReportListQuerySchema,
} from "../dto/security-report.dto";
import { BusinessReportService } from "../services/business-report.service";

/** Business client-safe released-report reads (API-RPT-010/011/012, own ORG only). */
@Controller()
export class BusinessReportController {
  constructor(private readonly reports: BusinessReportService) {}
  @AuthorizeOperation("API-RPT-010")
  @Get("business/security/reports")
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query(new ValidationPipe(businessReportListQuerySchema)) query: BusinessReportListQuery,
  ) {
    return this.reports.list(principal, query);
  }
  @AuthorizeOperation("API-RPT-011")
  @ValidateUuidRouteParams("reportId")
  @Get("business/security/reports/:reportId")
  get(@Param("reportId") id: string, @CurrentUser() principal: AuthPrincipal) {
    return this.reports.get(id, principal);
  }
  @AuthorizeOperation("API-RPT-012")
  @ValidateUuidRouteParams("reportId")
  @Get("business/security/reports/:reportId/download")
  download(@Param("reportId") id: string, @CurrentUser() principal: AuthPrincipal) {
    return this.reports.download(id, principal);
  }
}
