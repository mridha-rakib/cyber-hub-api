import { Module } from "@nestjs/common";
import { AuthScopeModule } from "../../core/security/authorization/auth-scope.module";
import { AuthModule } from "../auth/auth.module";
import { ConsultingModule } from "../consulting/consulting.module";
import { AssessmentController } from "./controllers/assessment.controller";
import { FindingController } from "./controllers/finding.controller";
import { SecurityWorkRepository } from "./repositories/security-work.repository";
import {
  AssessmentResourceResolver,
  FindingResourceResolver,
} from "./resolvers/security-work-resource.resolver";
import { SecurityWorkService } from "./services/security-work.service";

@Module({
  imports: [ConsultingModule, AuthModule, AuthScopeModule],
  controllers: [AssessmentController, FindingController],
  providers: [
    SecurityWorkRepository,
    SecurityWorkService,
    AssessmentResourceResolver,
    FindingResourceResolver,
  ],
  exports: [AssessmentResourceResolver, FindingResourceResolver],
})
export class SecurityWorkModule {}
