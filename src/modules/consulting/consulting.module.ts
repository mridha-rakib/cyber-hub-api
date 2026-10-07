import { Module } from "@nestjs/common";
import { AuditLogsRepository } from "../auth/repositories/audit-logs.repository";
import { ConsultingController } from "./controllers/consulting.controller";
import { ConsultingNotesRepository } from "./repositories/consulting-notes.repository";
import { ConsultingRequestsRepository } from "./repositories/consulting-requests.repository";
import { ScopeAuthorizationsRepository } from "./repositories/scope-authorizations.repository";
import { ConsultingResourceResolver } from "./resolvers/consulting-resource.resolver";
import { ConsultingService } from "./services/consulting.service";

@Module({
  controllers: [ConsultingController],
  providers: [
    ConsultingRequestsRepository,
    ConsultingNotesRepository,
    ScopeAuthorizationsRepository,
    ConsultingResourceResolver,
    ConsultingService,
    AuditLogsRepository,
  ],
  exports: [
    ConsultingRequestsRepository,
    ConsultingNotesRepository,
    ScopeAuthorizationsRepository,
    ConsultingResourceResolver,
  ],
})
export class ConsultingModule {}
