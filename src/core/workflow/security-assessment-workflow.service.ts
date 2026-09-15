import { Injectable, Logger } from "@nestjs/common";
import { securityAssessments } from "../../infrastructure/database/schema";
import { TransactionManager } from "../database/transaction.manager";
import { type CasTransitionOutcome, executeCasTransition } from "./transition.repository";
import type { WorkflowTransitionId } from "./workflow.types";
import { getWorkflowDefinition } from "./workflow-registry";

export interface SecurityAssessmentTransitionInput {
  readonly resourceId: string;
  /**
   * One or more candidate transition ids for the same API-level command
   * (e.g. ["WF-ASM-04", "WF-ASM-05"] for "cancel", which is documented as
   * valid from either PLANNED or IN_PROGRESS). All candidates passed here
   * MUST target the same `to` state — this is asserted, never assumed —
   * so the union of their `from` sets can be used in a single atomic
   * UPDATE without any prior read deciding which one applies.
   */
  readonly transitionIds: readonly WorkflowTransitionId[];
  readonly expectedStateVersion: number;
}

/**
 * Wave 0D-6 Phase 17. Real, DB-backed workflow transition support for
 * `security_assessments`. See `ConsultingRequestWorkflowService` for the
 * shared design rationale (no controller wires this yet; tested directly).
 */
@Injectable()
export class SecurityAssessmentWorkflowService {
  private readonly logger = new Logger(SecurityAssessmentWorkflowService.name);

  constructor(private readonly transactionManager: TransactionManager) {}

  async transition(input: SecurityAssessmentTransitionInput): Promise<CasTransitionOutcome> {
    const definition = getWorkflowDefinition("SecurityAssessment");
    const transitions = input.transitionIds
      .map((id) => definition.transitions.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined && t.from.length > 0);

    if (transitions.length === 0) {
      this.logger.warn(
        `SecurityAssessment.transition: none of [${input.transitionIds.join(", ")}] is a valid existing-resource transition`,
      );
      return { outcome: "CONFLICT", staleVersionSuspected: false, invalidStateSuspected: true };
    }

    const toStates = new Set(transitions.map((t) => t.to));
    if (toStates.size > 1) {
      // Programming error, not a runtime input error: candidates for one
      // logical command must never disagree on the destination state —
      // fail closed rather than silently picking one.
      this.logger.error(
        `SecurityAssessment.transition: candidates [${input.transitionIds.join(", ")}] target different states — refusing to guess`,
      );
      return { outcome: "CONFLICT", staleVersionSuspected: false, invalidStateSuspected: true };
    }

    const allowedFromStates = [...new Set(transitions.flatMap((t) => t.from))];
    const toState = transitions[0].to;

    const db = this.transactionManager.getExecutor();
    return executeCasTransition(
      db,
      {
        table: securityAssessments,
        idColumn: securityAssessments.id,
        statusColumn: securityAssessments.status,
        stateVersionColumn: securityAssessments.stateVersion,
        updatedAtColumn: securityAssessments.updatedAt,
      },
      {
        resourceId: input.resourceId,
        allowedFromStates,
        toState,
        expectedStateVersion: input.expectedStateVersion,
      },
    );
  }
}
