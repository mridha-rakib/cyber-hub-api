import { Injectable, Logger } from "@nestjs/common";
import { vulnerabilityFindings } from "../../infrastructure/database/schema";
import { TransactionManager } from "../database/transaction.manager";
import { type CasTransitionOutcome, executeCasTransition } from "./transition.repository";
import type { WorkflowTransitionId } from "./workflow.types";
import { getWorkflowDefinition } from "./workflow-registry";

export interface FindingTransitionInput {
  readonly resourceId: string;
  /**
   * One or more candidate transition ids for the same API-level command
   * (e.g. ["WF-FND-03", "WF-FND-04"] for "resolve", which is documented as
   * valid from either OPEN or REMEDIATION_IN_PROGRESS). All candidates
   * MUST target the same `to` state — asserted, never assumed.
   */
  readonly transitionIds: readonly WorkflowTransitionId[];
  readonly expectedStateVersion: number;
}

/**
 * Wave 5A. Real, DB-backed workflow transition support for
 * `vulnerability_findings` (ERD §7.31, WF-FND). Same design as
 * `SecurityAssessmentWorkflowService`; no controller wires this yet —
 * the API-FND commands, their AUTH_SCOPE/ASG guards and audit events are
 * Wave 5B.
 */
@Injectable()
export class FindingWorkflowService {
  private readonly logger = new Logger(FindingWorkflowService.name);

  constructor(private readonly transactionManager: TransactionManager) {}

  async transition(input: FindingTransitionInput): Promise<CasTransitionOutcome> {
    const definition = getWorkflowDefinition("Finding");
    const transitions = input.transitionIds
      .map((id) => definition.transitions.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined && t.from.length > 0);

    if (transitions.length === 0) {
      this.logger.warn(
        `Finding.transition: none of [${input.transitionIds.join(", ")}] is a valid existing-resource transition`,
      );
      return { outcome: "CONFLICT", staleVersionSuspected: false, invalidStateSuspected: true };
    }

    const toStates = new Set(transitions.map((t) => t.to));
    if (toStates.size > 1) {
      this.logger.error(
        `Finding.transition: candidates [${input.transitionIds.join(", ")}] target different states — refusing to guess`,
      );
      return { outcome: "CONFLICT", staleVersionSuspected: false, invalidStateSuspected: true };
    }

    const allowedFromStates = [...new Set(transitions.flatMap((t) => t.from))];
    const toState = transitions[0].to;

    const db = this.transactionManager.getExecutor();
    return executeCasTransition(
      db,
      {
        table: vulnerabilityFindings,
        idColumn: vulnerabilityFindings.id,
        statusColumn: vulnerabilityFindings.status,
        stateVersionColumn: vulnerabilityFindings.stateVersion,
        updatedAtColumn: vulnerabilityFindings.updatedAt,
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
