import { Module } from "@nestjs/common";
import { WorkflowModule } from "../../core/workflow/workflow.module";
import { AuthModule } from "../auth/auth.module";
import { ConsultingModule } from "../consulting/consulting.module";
import { SecurityWorkModule } from "../security-work/security-work.module";
import { AdminReportController } from "./controllers/admin-report.controller";
import { ReportController } from "./controllers/report.controller";
import { SecurityReportRepository } from "./repositories/security-report.repository";
import { ReportResourceResolver } from "./resolvers/report-resource.resolver";
import { SecurityReportService } from "./services/security-report.service";

/**
 * Wave 6B operational security reports (API-RPT-001..009, API-RPT-013).
 * Deliberately no AuthScopeModule: report operations never evaluate
 * AUTH_SCOPE (API Contract v1.3). Business client-safe report reads are
 * Wave 6C.
 */
@Module({
  imports: [SecurityWorkModule, ConsultingModule, AuthModule, WorkflowModule],
  controllers: [ReportController, AdminReportController],
  providers: [SecurityReportRepository, SecurityReportService, ReportResourceResolver],
  exports: [ReportResourceResolver],
})
export class SecurityReportModule {}
