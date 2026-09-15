import type { WorkflowDefinition, WorkflowEntityType } from "./workflow.types";

/**
 * Wave 0D-6. The complete, doc-grounded workflow contract — every state,
 * terminal state, and named transition transcribed exactly from State &
 * Workflow Specification v1.0 (§3-§8). Nothing here is inferred from a
 * status enum alone; every transition row cites its exact source ID
 * (e.g. "WF-REQ-03") and every state's terminality is exactly as the spec
 * describes it (a state is listed as terminal only when the spec has no
 * outbound row from it anywhere in this document).
 *
 * Two entities (ConsultingRequest, SecurityAssessment) currently have real
 * persisted tables (Wave 0D-4B) and get a live, DB-backed CAS transition
 * repository/service (see transition.repository.ts). Every other entity
 * here is POLICY ONLY — its product table/controller does not exist yet
 * (Wave 0D-6 Phase 30 explicitly forbids creating them) — the registry
 * still needs their full definitions so `workflow-operation-map.ts` can
 * validate all 60 workflow-sensitive API operations, and so a future wave
 * implementing the product table has an already-correct, tested contract
 * to build against rather than re-deriving it.
 *
 * Explicitly NOT modeled as a state machine here, per the spec's own text:
 * - Task Assignment Gate (§3.3): "Task itself is not given a source-defined
 *   status field" — a guard, not a lifecycle entity.
 * - Completion Eligibility Gate (§3.5): "a derived gate, not a Certificate
 *   status" — NOT_ELIGIBLE/ELIGIBLE is computed, never directly
 *   transitioned by a named client-facing command.
 * - Business Security Score (§6.5): "not treated as a mutable lifecycle
 *   entity" — an immutable snapshot history, not a state machine.
 */
const WORKFLOW_DEFINITIONS: readonly WorkflowDefinition[] = [
  {
    entityType: "InternshipProgramme",
    states: ["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"],
    // ARCHIVED: "Historical read-only programme" — no outbound row exists (§3.1).
    terminalStates: ["ARCHIVED"],
    transitions: [
      {
        id: "WF-PRG-01",
        from: ["DRAFT"],
        to: "PUBLISHED",
        source: "State & Workflow Spec v1.0 §3.1",
      },
      {
        id: "WF-PRG-02",
        from: ["PUBLISHED"],
        to: "CLOSED",
        source: "State & Workflow Spec v1.0 §3.1",
      },
      {
        id: "WF-PRG-03",
        from: ["CLOSED"],
        to: "ARCHIVED",
        source: "State & Workflow Spec v1.0 §3.1",
      },
      {
        id: "WF-PRG-04",
        from: ["PUBLISHED"],
        to: "DRAFT",
        source:
          "State & Workflow Spec v1.0 §3.1 — 'Allowed only before any learner application exists; otherwise close instead' (application-existence guard is enforced by the calling service, not the pure state machine)",
      },
    ],
  },
  {
    entityType: "InternshipApplication",
    states: ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED"],
    // ACCEPTED/REJECTED: "Terminal decision" (§3.2 state table).
    terminalStates: ["ACCEPTED", "REJECTED"],
    transitions: [
      { id: "WF-APP-01", from: [], to: "SUBMITTED", source: "State & Workflow Spec v1.0 §3.2" },
      {
        id: "WF-APP-02",
        from: ["SUBMITTED"],
        to: "UNDER_REVIEW",
        source: "State & Workflow Spec v1.0 §3.2",
      },
      {
        id: "WF-APP-03",
        from: ["UNDER_REVIEW"],
        to: "ACCEPTED",
        source: "State & Workflow Spec v1.0 §3.2",
      },
      {
        id: "WF-APP-04",
        from: ["UNDER_REVIEW"],
        to: "REJECTED",
        source: "State & Workflow Spec v1.0 §3.2",
      },
    ],
  },
  {
    entityType: "Submission",
    states: ["SUBMITTED", "UNDER_REVIEW", "REVISION_REQUIRED", "APPROVED"],
    // APPROVED: "Terminal normal state; learner cannot edit" (§3.4 state table).
    terminalStates: ["APPROVED"],
    transitions: [
      { id: "WF-SUB-01", from: [], to: "SUBMITTED", source: "State & Workflow Spec v1.0 §3.4" },
      {
        id: "WF-SUB-02",
        from: ["SUBMITTED"],
        to: "UNDER_REVIEW",
        source: "State & Workflow Spec v1.0 §3.4",
      },
      {
        id: "WF-SUB-03",
        from: ["UNDER_REVIEW"],
        to: "APPROVED",
        source: "State & Workflow Spec v1.0 §3.4",
      },
      {
        id: "WF-SUB-04",
        from: ["UNDER_REVIEW"],
        to: "REVISION_REQUIRED",
        source: "State & Workflow Spec v1.0 §3.4",
      },
      {
        id: "WF-SUB-05",
        from: ["REVISION_REQUIRED"],
        to: "SUBMITTED",
        source: "State & Workflow Spec v1.0 §3.4",
      },
    ],
  },
  {
    entityType: "Certificate",
    states: ["ISSUED", "REVOKED"],
    // REVOKED: "Reissue rule" (§4) explicitly forbids flipping back to ISSUED.
    terminalStates: ["REVOKED"],
    transitions: [
      { id: "WF-CERT-01", from: [], to: "ISSUED", source: "State & Workflow Spec v1.0 §4" },
      {
        id: "WF-CERT-02",
        from: ["ISSUED"],
        to: "REVOKED",
        source: "State & Workflow Spec v1.0 §4",
      },
    ],
  },
  {
    entityType: "CareerListing",
    states: ["SUBMITTED", "UNDER_REVIEW", "PUBLISHED", "REJECTED", "CLOSED"],
    // CLOSED: "No longer accepting applications/interest", no outbound row (§5).
    terminalStates: ["CLOSED"],
    transitions: [
      { id: "WF-LST-01", from: [], to: "SUBMITTED", source: "State & Workflow Spec v1.0 §5" },
      {
        id: "WF-LST-02",
        from: ["SUBMITTED"],
        to: "UNDER_REVIEW",
        source: "State & Workflow Spec v1.0 §5",
      },
      {
        id: "WF-LST-03",
        from: ["UNDER_REVIEW"],
        to: "PUBLISHED",
        source: "State & Workflow Spec v1.0 §5",
      },
      {
        id: "WF-LST-04",
        from: ["UNDER_REVIEW"],
        to: "REJECTED",
        source: "State & Workflow Spec v1.0 §5",
      },
      {
        id: "WF-LST-05",
        from: ["REJECTED"],
        to: "SUBMITTED",
        source: "State & Workflow Spec v1.0 §5",
      },
      {
        id: "WF-LST-06",
        from: ["PUBLISHED"],
        to: "CLOSED",
        source: "State & Workflow Spec v1.0 §5",
      },
    ],
  },
  {
    // API Contract v1.1's employer "opportunities" surface (API-BIZOPP-*/
    // API-MOD-OPP-*) shares the exact same documented moderation lifecycle
    // as CareerListing (§5 covers "Employer Opportunity / Career Listing
    // Moderation" as one workflow) — represented as its own entity type
    // because it is a distinct persisted record, not an alias.
    entityType: "EmployerOpportunity",
    states: ["SUBMITTED", "UNDER_REVIEW", "PUBLISHED", "REJECTED", "CLOSED"],
    terminalStates: ["CLOSED"],
    transitions: [
      { id: "WF-LST-01", from: [], to: "SUBMITTED", source: "State & Workflow Spec v1.0 §5" },
      {
        id: "WF-LST-02",
        from: ["SUBMITTED"],
        to: "UNDER_REVIEW",
        source: "State & Workflow Spec v1.0 §5",
      },
      {
        id: "WF-LST-03",
        from: ["UNDER_REVIEW"],
        to: "PUBLISHED",
        source: "State & Workflow Spec v1.0 §5",
      },
      {
        id: "WF-LST-04",
        from: ["UNDER_REVIEW"],
        to: "REJECTED",
        source: "State & Workflow Spec v1.0 §5",
      },
      {
        id: "WF-LST-05",
        from: ["REJECTED"],
        to: "SUBMITTED",
        source: "State & Workflow Spec v1.0 §5",
      },
      {
        id: "WF-LST-06",
        from: ["PUBLISHED"],
        to: "CLOSED",
        source: "State & Workflow Spec v1.0 §5",
      },
    ],
  },
  {
    entityType: "ConsultingRequest",
    states: ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "DECLINED", "IN_PROGRESS", "COMPLETED"],
    // DECLINED: "Terminal normal state" (§6.1 state table). COMPLETED: end
    // of the documented request lifecycle — no outbound row.
    terminalStates: ["DECLINED", "COMPLETED"],
    transitions: [
      { id: "WF-REQ-01", from: [], to: "SUBMITTED", source: "State & Workflow Spec v1.0 §6.1" },
      {
        id: "WF-REQ-02",
        from: ["SUBMITTED"],
        to: "UNDER_REVIEW",
        source: "State & Workflow Spec v1.0 §6.1",
      },
      {
        id: "WF-REQ-03",
        from: ["UNDER_REVIEW"],
        to: "ACCEPTED",
        source: "State & Workflow Spec v1.0 §6.1",
      },
      {
        id: "WF-REQ-04",
        from: ["UNDER_REVIEW"],
        to: "DECLINED",
        source: "State & Workflow Spec v1.0 §6.1",
      },
      {
        id: "WF-REQ-05",
        from: ["ACCEPTED"],
        to: "IN_PROGRESS",
        source: "State & Workflow Spec v1.0 §6.1",
      },
      {
        id: "WF-REQ-06",
        from: ["IN_PROGRESS"],
        to: "COMPLETED",
        source: "State & Workflow Spec v1.0 §6.1",
      },
    ],
  },
  {
    entityType: "SecurityAssessment",
    states: ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
    // COMPLETED: "Findings/score/report may be finalized" — end state.
    // CANCELLED: "must not resume under this record" (§6.3 state table).
    terminalStates: ["COMPLETED", "CANCELLED"],
    transitions: [
      { id: "WF-ASM-01", from: [], to: "PLANNED", source: "State & Workflow Spec v1.0 §6.3" },
      {
        id: "WF-ASM-02",
        from: ["PLANNED"],
        to: "IN_PROGRESS",
        source: "State & Workflow Spec v1.0 §6.3",
      },
      {
        id: "WF-ASM-03",
        from: ["IN_PROGRESS"],
        to: "COMPLETED",
        source: "State & Workflow Spec v1.0 §6.3",
      },
      {
        id: "WF-ASM-04",
        from: ["PLANNED"],
        to: "CANCELLED",
        source: "State & Workflow Spec v1.0 §6.3",
      },
      {
        id: "WF-ASM-05",
        from: ["IN_PROGRESS"],
        to: "CANCELLED",
        source: "State & Workflow Spec v1.0 §6.3",
      },
    ],
  },
  {
    entityType: "Finding",
    states: ["OPEN", "REMEDIATION_IN_PROGRESS", "RESOLVED"],
    // No state here is terminal: RESOLVED can return to OPEN (WF-FND-05).
    terminalStates: [],
    transitions: [
      { id: "WF-FND-01", from: [], to: "OPEN", source: "State & Workflow Spec v1.0 §6.4" },
      {
        id: "WF-FND-02",
        from: ["OPEN"],
        to: "REMEDIATION_IN_PROGRESS",
        source: "State & Workflow Spec v1.0 §6.4",
      },
      {
        id: "WF-FND-03",
        from: ["OPEN"],
        to: "RESOLVED",
        source: "State & Workflow Spec v1.0 §6.4",
      },
      {
        id: "WF-FND-04",
        from: ["REMEDIATION_IN_PROGRESS"],
        to: "RESOLVED",
        source: "State & Workflow Spec v1.0 §6.4",
      },
      {
        id: "WF-FND-05",
        from: ["RESOLVED"],
        to: "OPEN",
        source: "State & Workflow Spec v1.0 §6.4",
      },
    ],
  },
  {
    entityType: "Report",
    states: ["DRAFT", "IN_REVIEW", "READY_FOR_RELEASE", "RELEASED", "SUPERSEDED"],
    // SUPERSEDED: "Historical authorised read only; no mutation" (§7 state table).
    terminalStates: ["SUPERSEDED"],
    transitions: [
      { id: "WF-RPT-01", from: [], to: "DRAFT", source: "State & Workflow Spec v1.0 §7" },
      {
        id: "WF-RPT-02",
        from: ["DRAFT"],
        to: "IN_REVIEW",
        source: "State & Workflow Spec v1.0 §7",
      },
      {
        id: "WF-RPT-03",
        from: ["IN_REVIEW"],
        to: "DRAFT",
        source: "State & Workflow Spec v1.0 §7",
      },
      {
        id: "WF-RPT-04",
        from: ["IN_REVIEW"],
        to: "READY_FOR_RELEASE",
        source: "State & Workflow Spec v1.0 §7",
      },
      {
        id: "WF-RPT-05",
        from: ["READY_FOR_RELEASE"],
        to: "DRAFT",
        source: "State & Workflow Spec v1.0 §7",
      },
      {
        id: "WF-RPT-06",
        from: ["READY_FOR_RELEASE"],
        to: "RELEASED",
        source: "State & Workflow Spec v1.0 §7 — RBAC-DEC-008",
      },
      {
        id: "WF-RPT-07",
        from: ["RELEASED"],
        to: "SUPERSEDED",
        source: "State & Workflow Spec v1.0 §7",
      },
    ],
  },
  {
    // Post-core (§8): frozen now so a later implementation does not
    // improvise, but explicitly out of the MVP acceptance boundary — see
    // workflow-operation-map.ts, which maps its operations but the
    // underlying table/service remains undeployed.
    entityType: "MonitoringSubscription",
    states: ["REQUESTED", "ACTIVE", "PAUSED", "CANCELLED"],
    terminalStates: ["CANCELLED"],
    transitions: [
      { id: "WF-MON-01", from: [], to: "REQUESTED", source: "State & Workflow Spec v1.0 §8" },
      {
        id: "WF-MON-02",
        from: ["REQUESTED"],
        to: "ACTIVE",
        source: "State & Workflow Spec v1.0 §8",
      },
      { id: "WF-MON-03", from: ["ACTIVE"], to: "PAUSED", source: "State & Workflow Spec v1.0 §8" },
      { id: "WF-MON-04", from: ["PAUSED"], to: "ACTIVE", source: "State & Workflow Spec v1.0 §8" },
      {
        id: "WF-MON-05",
        from: ["REQUESTED"],
        to: "CANCELLED",
        source: "State & Workflow Spec v1.0 §8",
      },
      {
        id: "WF-MON-06",
        from: ["ACTIVE"],
        to: "CANCELLED",
        source: "State & Workflow Spec v1.0 §8",
      },
      {
        id: "WF-MON-07",
        from: ["PAUSED"],
        to: "CANCELLED",
        source: "State & Workflow Spec v1.0 §8",
      },
    ],
  },
];

export const WORKFLOW_REGISTRY: ReadonlyMap<WorkflowEntityType, WorkflowDefinition> = new Map(
  WORKFLOW_DEFINITIONS.map((def) => [def.entityType, def]),
);

export function getWorkflowDefinition(entityType: WorkflowEntityType): WorkflowDefinition {
  const def = WORKFLOW_REGISTRY.get(entityType);
  if (!def) {
    throw new Error(`No WorkflowDefinition registered for entity type "${entityType}"`);
  }
  return def;
}
