import { Injectable } from "@nestjs/common";
import type {
  TransitionValidationResult,
  WorkflowEntityType,
  WorkflowState,
  WorkflowTransitionId,
} from "./workflow.types";
import { getWorkflowDefinition } from "./workflow-registry";

/**
 * Wave 0D-6 Phase 8. Pure, DB-free workflow validation: "is this named
 * transition valid from the resource's CURRENT persisted state?" Never
 * queries or mutates the database, never trusts a client-supplied target
 * state (the target always comes from the registry's own `to` field, not
 * from request input), and never silently coerces an unknown id or state.
 */
@Injectable()
export class WorkflowValidationService {
  /**
   * `currentState: null` represents the "(new)" pseudo-state for create
   * transitions (`from: []` in the registry) — there is no prior
   * persisted row to compare against.
   */
  validate(
    entityType: WorkflowEntityType,
    transitionId: WorkflowTransitionId,
    currentState: WorkflowState | null,
  ): TransitionValidationResult {
    const definition = getWorkflowDefinition(entityType);
    const transition = definition.transitions.find((t) => t.id === transitionId);

    if (!transition) {
      return {
        valid: false,
        reason: `unknown transition id "${transitionId}" for entity "${entityType}"`,
      };
    }

    const isCreateTransition = transition.from.length === 0;

    if (isCreateTransition) {
      if (currentState !== null) {
        return {
          valid: false,
          reason: `transition "${transitionId}" is a create-only transition but a current state was supplied`,
        };
      }
      return { valid: true, to: transition.to };
    }

    if (currentState === null) {
      return {
        valid: false,
        reason: `transition "${transitionId}" requires an existing resource but no current state was supplied`,
      };
    }

    if (!definition.states.includes(currentState)) {
      return {
        valid: false,
        reason: `current state "${currentState}" is not a valid state for entity "${entityType}"`,
      };
    }

    if (definition.terminalStates.includes(currentState)) {
      return {
        valid: false,
        reason: `entity "${entityType}" is in terminal state "${currentState}" — no further transition is documented`,
      };
    }

    if (!transition.from.includes(currentState)) {
      return {
        valid: false,
        reason: `transition "${transitionId}" is not valid from current state "${currentState}" (allowed: ${transition.from.join(", ")})`,
      };
    }

    return { valid: true, to: transition.to };
  }

  /**
   * Resolves which of several candidate transition ids (see
   * workflow-operation-map.ts — one API-level command can map to more
   * than one documented transition id when the valid FROM state differs,
   * e.g. WF-ASM-04 vs WF-ASM-05 for "cancel") actually applies to the
   * given current state. Returns the first candidate whose own `from` set
   * includes `currentState`, or null if none do (caller should report
   * INVALID_TRANSITION using the first candidate's validate() reason, or
   * a generic one, for logging — never inventing a state).
   */
  resolveCandidate(
    entityType: WorkflowEntityType,
    candidateTransitionIds: readonly WorkflowTransitionId[],
    currentState: WorkflowState | null,
  ): WorkflowTransitionId | null {
    const definition = getWorkflowDefinition(entityType);
    for (const id of candidateTransitionIds) {
      const transition = definition.transitions.find((t) => t.id === id);
      if (!transition) continue;
      const isCreateTransition = transition.from.length === 0;
      if (isCreateTransition && currentState === null) return id;
      if (!isCreateTransition && currentState !== null && transition.from.includes(currentState)) {
        return id;
      }
    }
    return null;
  }
}
