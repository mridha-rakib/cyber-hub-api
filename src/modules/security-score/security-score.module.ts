import { Module } from "@nestjs/common";
import { AuthScopeModule } from "../../core/security/authorization/auth-scope.module";
import { AuthModule } from "../auth/auth.module";
import { ConsultingModule } from "../consulting/consulting.module";
import { SecurityWorkModule } from "../security-work/security-work.module";
import { BusinessSecurityController } from "./controllers/business-security.controller";
import { ScoreController } from "./controllers/score.controller";
import { SecurityScoreRepository } from "./repositories/security-score.repository";
import { SecurityScoreResourceResolver } from "./resolvers/security-score-resource.resolver";
import { BusinessSecurityService } from "./services/business-security.service";
import { SecurityScoreService } from "./services/security-score.service";

/**
 * Wave 6C security scores and Business security reads (API-SCR-001..005).
 * No score methodology exists (GAP-009): API-SCR-001 is a gated, audited
 * rejection and nothing in this module writes a security_scores row.
 */
@Module({
  imports: [SecurityWorkModule, ConsultingModule, AuthModule, AuthScopeModule],
  controllers: [ScoreController, BusinessSecurityController],
  providers: [
    SecurityScoreRepository,
    SecurityScoreService,
    BusinessSecurityService,
    SecurityScoreResourceResolver,
  ],
  exports: [SecurityScoreResourceResolver],
})
export class SecurityScoreModule {}
