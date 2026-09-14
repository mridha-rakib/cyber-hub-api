import { Injectable } from "@nestjs/common";
import type { ActorContext, ResourceContext } from "./authorization-context.types";

export type ConditionStatus = "IMPLEMENTED" | "DEFERRED";

export interface ConditionEvaluationInput {
  readonly actor: ActorContext;
  readonly resource: ResourceContext | null;
}

/**
 * COND is a finite, explicit, centrally-controlled catalogue — never an
 * arbitrary `(ctx) => boolean` callback a controller can inject. A
 * condition is either IMPLEMENTED (with a real, centrally-owned evaluator)
 * or DEFERRED (documented in RBAC v1.0 but the underlying product policy
 * is not yet specified/approved — see Wave 0D-1's COND catalogue). Any
 * production authorization attempt that depends on a DEFERRED condition
 * fails closed; there is no "evaluate" function for it to bypass through.
 */
export interface ConditionDefinition {
  readonly id: string;
  readonly description: string;
  readonly status: ConditionStatus;
  readonly evaluate?: (input: ConditionEvaluationInput) => boolean;
}

/**
 * The documented-but-currently-unresolved COND cases identified across
 * Wave 0D-1/0D-2 (RBAC v1.0 §6 + §4 COND catalogue). Every one of these
 * ships DEFERRED — no product policy is invented here. A future wave may
 * flip one to IMPLEMENTED once the corresponding product decision has
 * actually been made and approved, at which point it gets a real
 * `evaluate` function reviewed on its own merits.
 */
export const PRODUCTION_CONDITIONS: readonly ConditionDefinition[] = [
  {
    id: "ACCOUNT_DELETION_NON_LEARNER_POLICY",
    description:
      "account.delete.request_own for ROLE_BUSINESS/ROLE_MENTOR/ROLE_CONSULTANT — RBAC v1.0: 'subject to later data-lifecycle policy', not yet defined.",
    status: "DEFERRED",
  },
  {
    id: "LEARNING_PROGRESS_FEATURE_ENABLED",
    description:
      "resource.progress.manage_own — RBAC v1.0: 'Optional feature only'; no documented enablement mechanism.",
    status: "DEFERRED",
  },
  {
    id: "CV_REVIEW_WORKFLOW_DEFINED",
    description:
      "cv_review.use_own (Admin) — RBAC v1.0: 'Exact reviewer workflow deferred to use-case spec'; API-GAP-001 explicitly blocks production implementation.",
    status: "DEFERRED",
  },
  {
    id: "EMPLOYER_COMMUNICATION_PARTICIPANT",
    description:
      "employer.communication.participate — RBAC v1.0: 'exact message model/use cases TBD'.",
    status: "DEFERRED",
  },
  {
    id: "MONITORING_SUBSCRIPTION_ACTIVE",
    description:
      "monitoring.read_choose_own — post-core feature, subscription model not yet implemented.",
    status: "DEFERRED",
  },
  {
    id: "MONITORING_ASSIGNED_PLAN_ACTIVE",
    description:
      "monitoring.perform_assigned — post-core feature, subscription model not yet implemented.",
    status: "DEFERRED",
  },
  {
    id: "MONITORING_ADMIN_FEATURE_ENABLED",
    description:
      "monitoring.admin_manage — post-core feature, subscription model not yet implemented.",
    status: "DEFERRED",
  },
];

/**
 * Central COND lookup. Production instances are seeded with
 * `PRODUCTION_CONDITIONS` only (all DEFERRED — see above); tests may
 * construct a registry with additional IMPLEMENTED conditions to exercise
 * the framework without inventing real product policy in production code.
 */
@Injectable()
export class ConditionRegistry {
  private readonly conditionsById: ReadonlyMap<string, ConditionDefinition>;

  constructor(conditions: readonly ConditionDefinition[] = PRODUCTION_CONDITIONS) {
    const map = new Map<string, ConditionDefinition>();
    for (const condition of conditions) {
      if (map.has(condition.id)) {
        throw new Error(`Duplicate ConditionDefinition id "${condition.id}"`);
      }
      map.set(condition.id, condition);
    }
    this.conditionsById = map;
  }

  get(id: string): ConditionDefinition | undefined {
    return this.conditionsById.get(id);
  }
}
