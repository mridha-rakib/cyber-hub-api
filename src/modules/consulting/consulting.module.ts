import { Module } from "@nestjs/common";
import { ConsultingNotesRepository } from "./repositories/consulting-notes.repository";
import { ConsultingRequestsRepository } from "./repositories/consulting-requests.repository";
import { ScopeAuthorizationsRepository } from "./repositories/scope-authorizations.repository";
import { ConsultingResourceResolver } from "./resolvers/consulting-resource.resolver";

/** Wave 4A persistence-only module: deliberately has no controllers. */
@Module({
  providers: [
    ConsultingRequestsRepository,
    ConsultingNotesRepository,
    ScopeAuthorizationsRepository,
    ConsultingResourceResolver,
  ],
  exports: [
    ConsultingRequestsRepository,
    ConsultingNotesRepository,
    ScopeAuthorizationsRepository,
    ConsultingResourceResolver,
  ],
})
export class ConsultingModule {}
