import { Module } from "@nestjs/common";
import { WorkflowModule } from "../../core/workflow/workflow.module";
import { AuditLogsRepository } from "../auth/repositories/audit-logs.repository";
import { ResourcesController } from "./controllers/resources.controller";
import { ResourcesRepository } from "./repositories/resources.repository";
import { ResourceContextResolverImpl } from "./resolvers/resource-context.resolver";
import { ResourceService } from "./services/resource.service";

/**
 * Wave 7C (G4-B): learning resources — public catalogue (API-RES-001/002)
 * and Admin management (API-ADMRES-001..007) over the migration-0008
 * `resources` table. Reuses the global security chain, the G4-A workflow
 * registry/operation map (via WorkflowValidationService) and the existing
 * audit_logs writer; exports its resolver for SecurityModule's registry.
 */
@Module({
  imports: [WorkflowModule],
  controllers: [ResourcesController],
  providers: [
    ResourcesRepository,
    ResourceService,
    AuditLogsRepository,
    ResourceContextResolverImpl,
  ],
  exports: [ResourceContextResolverImpl],
})
export class ResourcesModule {}
