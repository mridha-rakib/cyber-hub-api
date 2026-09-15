import { Injectable, Logger } from "@nestjs/common";
import { consultingRequests } from "../../infrastructure/database/schema";
import { TransactionManager } from "../database/transaction.manager";
import { type CasTransitionOutcome, executeCasTransition } from "./transition.repository";
import type { WorkflowTransitionId } from "./workflow.types";
import { getWorkflowDefinition } from "./workflow-registry";

export interface ConsultingRequestTransitionInput {
  readonly resourceId: string;
  readonly transitionId: WorkflowTransitionId;
  readonly expectedStateVersion: number;
}

/**
 * Wave 0D-6 Phase 17. Real, DB-backed workflow transition support for
 * `consulting_requests` (one of the two currently-implemented, non-
 * AUTH_SCOPE lifecycle entities — `security_assessments` gets its own
 * equivalent service). No controller wires this yet (no consulting-request
 * product module exists); it is exercised directly by service/integration
 * tests per Phase 17's "test-only integration routes or direct service
 * tests" instruction, and is ready for a future product-module wave to
 * call as-is.
 *
 * Never trusts a client-supplied current or target state: the allowed
 * FROM states and the resulting TO state both come from the shared
 * workflow registry, never from request input. The caller supplies only
 * the resource locator, the transition id to attempt, and the expected
 * stateVersion.
 */
@Injectable()
export class ConsultingRequestWorkflowService {
  private readonly logger = new Logger(ConsultingRequestWorkflowService.name);

  constructor(private readonly transactionManager: TransactionManager) {}

  async transition(input: ConsultingRequestTransitionInput): Promise<CasTransitionOutcome> {
    const definition = getWorkflowDefinition("ConsultingRequest");
    const transition = definition.transitions.find((t) => t.id === input.transitionId);

    // A create-only transition (from: []) or a genuinely unknown id has no
    // existing row to compare against — fail closed as a conflict rather
    // than attempting an UPDATE with an empty allowed-states set (which
    // Postgres would reject/never match anyway, but we want an explicit,
    // logged reason rather than relying on that incidental behavior).
    if (!transition || transition.from.length === 0) {
      this.logger.warn(
        `ConsultingRequest.transition: "${input.transitionId}" is not a valid existing-resource transition`,
      );
      return { outcome: "CONFLICT", staleVersionSuspected: false, invalidStateSuspected: true };
    }

    const db = this.transactionManager.getExecutor();
    return executeCasTransition(
      db,
      {
        table: consultingRequests,
        idColumn: consultingRequests.id,
        statusColumn: consultingRequests.status,
        stateVersionColumn: consultingRequests.stateVersion,
        updatedAtColumn: consultingRequests.updatedAt,
      },
      {
        resourceId: input.resourceId,
        allowedFromStates: transition.from,
        toState: transition.to,
        expectedStateVersion: input.expectedStateVersion,
      },
    );
  }
}
