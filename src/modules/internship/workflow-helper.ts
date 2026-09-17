import type { WorkflowEntityType, WorkflowTransitionId } from "../../core/workflow/workflow.types";
import { getWorkflowDefinition } from "../../core/workflow/workflow-registry";

/**
 * Looks up one named transition's `from`/`to` straight from the Wave 0D-6
 * workflow registry — the single source of truth every internship service
 * uses instead of hardcoding state names. Throws only for a genuinely
 * unknown transition id, which would be a programming error (a route
 * calling a transition id that was never registered), not a runtime/user
 * condition.
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
