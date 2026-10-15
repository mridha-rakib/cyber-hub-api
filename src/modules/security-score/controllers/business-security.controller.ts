import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  type BusinessFindingListQuery,
  type BusinessScoreListQuery,
  businessFindingListQuerySchema,
  businessScoreListQuerySchema,
} from "../dto/security-score.dto";
import { BusinessSecurityService } from "../services/business-security.service";

/** Business security dashboard, findings and score history (API-SCR-003/004/005). */
@Controller()
export class BusinessSecurityController {
  constructor(private readonly security: BusinessSecurityService) {}
  @AuthorizeOperation("API-SCR-003")
  @Get("business/security/dashboard")
  dashboard(@CurrentUser() principal: AuthPrincipal) {
    return this.security.dashboard(principal);
  }
  @AuthorizeOperation("API-SCR-004")
  @Get("business/security/findings")
  findings(
    @CurrentUser() principal: AuthPrincipal,
    @Query(new ValidationPipe(businessFindingListQuerySchema)) query: BusinessFindingListQuery,
  ) {
    return this.security.findings(principal, query);
  }
  @AuthorizeOperation("API-SCR-005")
  @Get("business/security/scores")
  scores(
    @CurrentUser() principal: AuthPrincipal,
    @Query(new ValidationPipe(businessScoreListQuerySchema)) query: BusinessScoreListQuery,
  ) {
    return this.security.scoreHistory(principal, query);
  }
}
