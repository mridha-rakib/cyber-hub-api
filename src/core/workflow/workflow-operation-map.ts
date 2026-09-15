import type { ApiId } from "../security/authorization/api-authorization-map";
import type { WorkflowEntityType, WorkflowState, WorkflowTransitionId } from "./workflow.types";

/**
 * Wave 0D-6 Phase 7. Centralized API-operation -> workflow-command mapping
 * — the single place transition ids are wired to concrete HTTP operations.
 * No controller/service should hardcode a transition id inline.
 *
 * Two mapping kinds, both doc-grounded and both required for every one of
 * the 60 `workflowValidationRequired` operations (see
 * `workflow-operation-map.spec.ts` for the structural proof that coverage
 * is complete and that no non-workflow operation is accidentally mapped):
 *
 * - TRANSITION: the operation executes a named state-changing command.
 *   `transitionIds` may list more than one candidate when a single
 *   API-level command name (e.g. "cancel") is documented as valid from
 *   more than one source state under separate transition IDs (WF-ASM-04
 *   vs WF-ASM-05) — `WorkflowValidationService.resolveCandidate` picks
 *   whichever one actually matches the resource's current state.
 * - EDIT_GUARD: the operation mutates record CONTENT (not lifecycle
 *   state) but the spec only allows that content mutation while the
 *   record is in specific state(s) — e.g. a report's findings may only be
 *   edited while DRAFT (State & Workflow Spec v1.0 §7's own transition
 *   graph implies content edits happen in DRAFT; WF-RPT-03 formally
 *   returns a report to DRAFT specifically so it becomes editable again).
 *   No transition id/target state applies; `allowedStates` is the full
 *   doc-grounded set of states the mutation may occur in. stateVersion
 *   optimistic concurrency still applies to the underlying row.
 */
export type WorkflowOperationMapping =
  | {
      readonly kind: "TRANSITION";
      readonly entityType: WorkflowEntityType;
      readonly transitionIds: readonly WorkflowTransitionId[];
    }
  | {
      readonly kind: "EDIT_GUARD";
      readonly entityType: WorkflowEntityType;
      readonly allowedStates: readonly WorkflowState[];
    };

export const WORKFLOW_OPERATION_MAP: Readonly<Partial<Record<ApiId, WorkflowOperationMapping>>> = {
  // Internship application (State & Workflow Spec v1.0 §3.2)
  "API-APP-001": {
    kind: "TRANSITION",
    entityType: "InternshipApplication",
    transitionIds: ["WF-APP-01"],
  },
  "API-APP-006": {
    kind: "TRANSITION",
    entityType: "InternshipApplication",
    transitionIds: ["WF-APP-02"],
  },
  "API-APP-007": {
    kind: "TRANSITION",
    entityType: "InternshipApplication",
    transitionIds: ["WF-APP-03"],
  },
  "API-APP-008": {
    kind: "TRANSITION",
    entityType: "InternshipApplication",
    transitionIds: ["WF-APP-04"],
  },

  // Security assessment (§6.3) — real persistence exists (Wave 0D-4B).
  "API-ASM-001": {
    kind: "TRANSITION",
    entityType: "SecurityAssessment",
    transitionIds: ["WF-ASM-01"],
  },
  "API-ASM-004": {
    kind: "TRANSITION",
    entityType: "SecurityAssessment",
    transitionIds: ["WF-ASM-02"],
  },
  "API-ASM-005": {
    kind: "TRANSITION",
    entityType: "SecurityAssessment",
    transitionIds: ["WF-ASM-03"],
  },
  "API-ASM-006": {
    kind: "TRANSITION",
    entityType: "SecurityAssessment",
    transitionIds: ["WF-ASM-04", "WF-ASM-05"],
  },

  // Career listing (§5) — business-owned side.
  "API-BIZCAR-001": {
    kind: "TRANSITION",
    entityType: "CareerListing",
    transitionIds: ["WF-LST-01"],
  },
  "API-BIZCAR-004": {
    kind: "EDIT_GUARD",
    entityType: "CareerListing",
    allowedStates: ["SUBMITTED", "REJECTED"],
  },
  "API-BIZCAR-005": {
    kind: "TRANSITION",
    entityType: "CareerListing",
    transitionIds: ["WF-LST-05"],
  },
  "API-BIZCAR-006": {
    kind: "TRANSITION",
    entityType: "CareerListing",
    transitionIds: ["WF-LST-06"],
  },

  // Employer opportunity (§5) — business-owned side, same moderation graph.
  "API-BIZOPP-001": {
    kind: "TRANSITION",
    entityType: "EmployerOpportunity",
    transitionIds: ["WF-LST-01"],
  },
  "API-BIZOPP-004": {
    kind: "EDIT_GUARD",
    entityType: "EmployerOpportunity",
    allowedStates: ["SUBMITTED", "REJECTED"],
  },
  "API-BIZOPP-005": {
    kind: "TRANSITION",
    entityType: "EmployerOpportunity",
    transitionIds: ["WF-LST-05"],
  },
  "API-BIZOPP-006": {
    kind: "TRANSITION",
    entityType: "EmployerOpportunity",
    transitionIds: ["WF-LST-06"],
  },

  // Certificate (§4).
  "API-CER-002": { kind: "TRANSITION", entityType: "Certificate", transitionIds: ["WF-CERT-01"] },
  "API-CER-006": { kind: "TRANSITION", entityType: "Certificate", transitionIds: ["WF-CERT-02"] },

  // Consulting request (§6.1) — real persistence exists (Wave 0D-4B).
  "API-CON-001": {
    kind: "TRANSITION",
    entityType: "ConsultingRequest",
    transitionIds: ["WF-REQ-01"],
  },
  "API-CON-009": {
    kind: "TRANSITION",
    entityType: "ConsultingRequest",
    transitionIds: ["WF-REQ-02"],
  },
  "API-CON-010": {
    kind: "TRANSITION",
    entityType: "ConsultingRequest",
    transitionIds: ["WF-REQ-03"],
  },
  "API-CON-011": {
    kind: "TRANSITION",
    entityType: "ConsultingRequest",
    transitionIds: ["WF-REQ-04"],
  },
  "API-CON-012": {
    kind: "TRANSITION",
    entityType: "ConsultingRequest",
    transitionIds: ["WF-REQ-05"],
  },
  "API-CON-013": {
    kind: "TRANSITION",
    entityType: "ConsultingRequest",
    transitionIds: ["WF-REQ-06"],
  },

  // Vulnerability/security finding (§6.4).
  "API-FND-001": { kind: "TRANSITION", entityType: "Finding", transitionIds: ["WF-FND-01"] },
  "API-FND-004": {
    // No documented state restriction on editing finding content
    // (severity/description/evidence); Finding also has zero terminal
    // states (§6.4), so all 3 states are conservatively allowed rather
    // than inventing a narrower undocumented rule.
    kind: "EDIT_GUARD",
    entityType: "Finding",
    allowedStates: ["OPEN", "REMEDIATION_IN_PROGRESS", "RESOLVED"],
  },
  "API-FND-005": { kind: "TRANSITION", entityType: "Finding", transitionIds: ["WF-FND-02"] },
  "API-FND-006": {
    kind: "TRANSITION",
    entityType: "Finding",
    transitionIds: ["WF-FND-03", "WF-FND-04"],
  },
  "API-FND-007": { kind: "TRANSITION", entityType: "Finding", transitionIds: ["WF-FND-05"] },

  // Internship programme (§3.1).
  "API-INT-004": {
    // "DRAFT | ... Admin-only configuration" (§3.1 state table) — content
    // edits belong to the pre-publication configuration phase.
    kind: "EDIT_GUARD",
    entityType: "InternshipProgramme",
    allowedStates: ["DRAFT"],
  },
  "API-INT-005": {
    kind: "TRANSITION",
    entityType: "InternshipProgramme",
    transitionIds: ["WF-PRG-01"],
  },
  "API-INT-006": {
    kind: "TRANSITION",
    entityType: "InternshipProgramme",
    transitionIds: ["WF-PRG-02"],
  },
  "API-INT-007": {
    kind: "TRANSITION",
    entityType: "InternshipProgramme",
    transitionIds: ["WF-PRG-03"],
  },
  "API-INT-008": {
    kind: "TRANSITION",
    entityType: "InternshipProgramme",
    transitionIds: ["WF-PRG-04"],
  },

  // Career listing moderation (§5) — admin side of the same graph.
  "API-MOD-CAR-01": {
    kind: "TRANSITION",
    entityType: "CareerListing",
    transitionIds: ["WF-LST-02"],
  },
  "API-MOD-CAR-02": {
    kind: "TRANSITION",
    entityType: "CareerListing",
    transitionIds: ["WF-LST-03"],
  },
  "API-MOD-CAR-03": {
    kind: "TRANSITION",
    entityType: "CareerListing",
    transitionIds: ["WF-LST-04"],
  },
  "API-MOD-CAR-04": {
    kind: "TRANSITION",
    entityType: "CareerListing",
    transitionIds: ["WF-LST-06"],
  },

  // Employer opportunity moderation (§5) — admin side.
  "API-MOD-OPP-01": {
    kind: "TRANSITION",
    entityType: "EmployerOpportunity",
    transitionIds: ["WF-LST-02"],
  },
  "API-MOD-OPP-02": {
    kind: "TRANSITION",
    entityType: "EmployerOpportunity",
    transitionIds: ["WF-LST-03"],
  },
  "API-MOD-OPP-03": {
    kind: "TRANSITION",
    entityType: "EmployerOpportunity",
    transitionIds: ["WF-LST-04"],
  },
  "API-MOD-OPP-04": {
    kind: "TRANSITION",
    entityType: "EmployerOpportunity",
    transitionIds: ["WF-LST-06"],
  },

  // Recurring monitoring (§8, post-core; policy frozen, not deployed).
  "API-MON-001": {
    kind: "TRANSITION",
    entityType: "MonitoringSubscription",
    transitionIds: ["WF-MON-01"],
  },
  "API-MON-006": {
    kind: "TRANSITION",
    entityType: "MonitoringSubscription",
    transitionIds: ["WF-MON-02"],
  },
  "API-MON-007": {
    kind: "TRANSITION",
    entityType: "MonitoringSubscription",
    transitionIds: ["WF-MON-03"],
  },
  "API-MON-008": {
    kind: "TRANSITION",
    entityType: "MonitoringSubscription",
    transitionIds: ["WF-MON-04"],
  },
  "API-MON-009": {
    kind: "TRANSITION",
    entityType: "MonitoringSubscription",
    transitionIds: ["WF-MON-05", "WF-MON-06", "WF-MON-07"],
  },

  // Submission review (§3.4).
  "API-REV-003": { kind: "TRANSITION", entityType: "Submission", transitionIds: ["WF-SUB-02"] },
  "API-REV-004": { kind: "TRANSITION", entityType: "Submission", transitionIds: ["WF-SUB-03"] },
  "API-REV-005": { kind: "TRANSITION", entityType: "Submission", transitionIds: ["WF-SUB-04"] },

  // Client security report (§7).
  "API-RPT-001": { kind: "TRANSITION", entityType: "Report", transitionIds: ["WF-RPT-01"] },
  "API-RPT-003": { kind: "EDIT_GUARD", entityType: "Report", allowedStates: ["DRAFT"] },
  "API-RPT-004": { kind: "EDIT_GUARD", entityType: "Report", allowedStates: ["DRAFT"] },
  "API-RPT-005": { kind: "TRANSITION", entityType: "Report", transitionIds: ["WF-RPT-02"] },
  "API-RPT-006": { kind: "TRANSITION", entityType: "Report", transitionIds: ["WF-RPT-03"] },
  "API-RPT-007": { kind: "TRANSITION", entityType: "Report", transitionIds: ["WF-RPT-04"] },
  "API-RPT-008": { kind: "TRANSITION", entityType: "Report", transitionIds: ["WF-RPT-06"] },
  "API-RPT-009": { kind: "TRANSITION", entityType: "Report", transitionIds: ["WF-RPT-07"] },

  // Evidence submission (§3.4) — create/resubmit.
  "API-SUB-001": { kind: "TRANSITION", entityType: "Submission", transitionIds: ["WF-SUB-01"] },
  "API-SUB-003": { kind: "TRANSITION", entityType: "Submission", transitionIds: ["WF-SUB-05"] },
};

export function getWorkflowOperationMapping(apiId: ApiId): WorkflowOperationMapping | undefined {
  return WORKFLOW_OPERATION_MAP[apiId];
}
