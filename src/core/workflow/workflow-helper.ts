import { StateVersionConflictException, WorkflowConflictException } from "../errors/app.exception";
import type { CasTransitionOutcome } from "./transition.repository";
import type { WorkflowEntityType, WorkflowTransitionId } from "./workflow.types";
import { getWorkflowDefinition } from "./workflow-registry";

/** Classifies a failed atomic write using a diagnostic read, after authorization. */
export function workflowConflictForVersion(
  currentStateVersion: number,
  expectedStateVersion: number,
) {
  return currentStateVersion !== expectedStateVersion
    ? new StateVersionConflictException(currentStateVersion)
    : new WorkflowConflictException();
}

/** Shared HTTP exception mapping for the existing workflow foundations. */
export function workflowConflictForCas(
  result: Extract<CasTransitionOutcome, { outcome: "CONFLICT" }>,
) {
  return result.staleVersionSuspected
    ? new StateVersionConflictException(result.currentStateVersion)
    : new WorkflowConflictException();
}

/**
 * Looks up one named transition's `from`/`to` straight from the Wave 0D-6
 * workflow registry — the single source of truth every product service
 * uses instead of hardcoding state names. Throws only for a genuinely
 * unknown transition id, which would be a programming error (a route
 * calling a transition id that was never registered), not a runtime/user
 * condition. Shared across product modules (Internship, Certificate, ...)
 * rather than duplicated per module.
 */
export function requireTransition(
  entityType: WorkflowEntityType,
  transitionId: WorkflowTransitionId,
) {
  const definition = getWorkflowDefinition(entityType);
  const transition = definition.transitions.find((t) => t.id === transitionId);
  if (!transition) {
    throw new Error(`Unknown transition "${transitionId}" for entity "${entityType}"`);
  }
  return transition;
}
