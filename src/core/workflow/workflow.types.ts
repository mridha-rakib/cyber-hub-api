/**
 * Wave 0D-6. Core typed vocabulary for the workflow/state-machine
 * foundation, grounded exactly in State & Workflow Specification v1.0
 * (GAP-007 resolution). No state or transition name here may be invented —
 * every entry in `workflow-registry.ts` must trace to a specific
 * documented table row (e.g. "WF-REQ-03").
 *
 * Authorization ("may this actor attempt this operation?") and workflow
 * validation ("is this named transition valid from the resource's current
 * persisted state and version?") are deliberately separate concerns — see
 * `workflow-validation.service.ts` for the pure, DB-free transition check
 * and `transition.repository.ts` for the atomic persistence layer.
 */

/** Stable domain entity type, matching the spec's "entityType" column (§2.1). */
export type WorkflowEntityType =
  | "InternshipProgramme"
  | "InternshipApplication"
  | "Submission"
  | "Certificate"
  | "CareerListing"
  | "EmployerOpportunity"
  | "ConsultingRequest"
  | "SecurityAssessment"
  | "Finding"
  | "Report"
  | "MonitoringSubscription";

/** A persisted lifecycle value for one entity type. Never client-settable. */
export type WorkflowState = string;

/** A stable transition code, e.g. "WF-REQ-03", exactly as named in the spec. */
export type WorkflowTransitionId = string;

/**
 * One named, documented transition. `from` is a set (not a single value)
 * because some documented commands (e.g. WF-ASM-04/WF-ASM-05, both named
 * "cancel" in the API surface) are valid from more than one source state —
 * modeling `from` as a set lets the registry keep one row per documented
 * ID while still letting `workflow-operation-map.ts` resolve a single
 * API-level command to "whichever transition id actually matches the
 * resource's current state" without inventing a merged, non-traceable ID.
 */
export interface WorkflowTransitionDefinition {
  readonly id: WorkflowTransitionId;
  readonly from: readonly WorkflowState[];
  readonly to: WorkflowState;
  /** Free-text citation back to the spec section, for audit/traceability only. */
  readonly source: string;
}

export interface WorkflowDefinition {
  readonly entityType: WorkflowEntityType;
  readonly states: readonly WorkflowState[];
  /**
   * States with no documented outbound transition. A transition attempt
   * FROM a terminal state is always INVALID_TRANSITION unless the spec
   * explicitly documents an outbound row from it (none currently do for
   * a state listed here — see workflow-registry.spec.ts).
   */
  readonly terminalStates: readonly WorkflowState[];
  readonly transitions: readonly WorkflowTransitionDefinition[];
}

export type TransitionValidationResult =
  | { readonly valid: true; readonly to: WorkflowState }
  | { readonly valid: false; readonly reason: string };
