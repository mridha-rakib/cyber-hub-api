import { Module } from "@nestjs/common";
import { WorkflowModule } from "../../core/workflow/workflow.module";
import { AuthModule } from "../auth/auth.module";
import { ConsultingModule } from "../consulting/consulting.module";
import { SecurityWorkModule } from "../security-work/security-work.module";
import { AdminReportController } from "./controllers/admin-report.controller";
import { BusinessReportController } from "./controllers/business-report.controller";
import { ReportController } from "./controllers/report.controller";
import { SecurityReportRepository } from "./repositories/security-report.repository";
import { ReportResourceResolver } from "./resolvers/report-resource.resolver";
import { BusinessReportService } from "./services/business-report.service";
import { SecurityReportService } from "./services/security-report.service";

/**
 * Wave 6B operational security reports (API-RPT-001..009, API-RPT-013).
 * Deliberately no AuthScopeModule: report operations never evaluate
 * AUTH_SCOPE (API Contract v1.3). Wave 6C adds the Business client-safe
 * released-report reads (API-RPT-010/011/012).
 */
@Module({
  imports: [SecurityWorkModule, ConsultingModule, AuthModule, WorkflowModule],
  controllers: [ReportController, AdminReportController, BusinessReportController],
  providers: [
    SecurityReportRepository,
    SecurityReportService,
    BusinessReportService,
    ReportResourceResolver,
  ],
  exports: [ReportResourceResolver],
})
export class SecurityReportModule {}
