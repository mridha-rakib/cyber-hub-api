import { Injectable, Logger } from "@nestjs/common";
import type { AuthorizationContext, ResourceContext } from "./authorization-context.types";
import { ConditionRegistry } from "./condition-registry";
import { ResourceContextResolverRegistry } from "./resource-context-resolver";
import type { ScopeType } from "./scope.types";

export interface ScopeEvaluationResult {
  readonly allowed: boolean;
  /** Which specific scope check failed first, for internal logging only — never sent to the client. */
  readonly reason?: string;
}

/**
 * Individual scope checks. Each is a pure function over already-resolved,
 * authoritative `AuthorizationContext` — none of them ever look at the
 * request body/query/params. Exported individually so they can be unit
 * tested in isolation as well as through the composed service.
 */
export function evaluateOwn(
  actor: AuthorizationContext["actor"],
  resource: ResourceContext | null,
): boolean {
  if (!resource || typeof resource.ownerUserId !== "string" || resource.ownerUserId.length === 0)
    return false;
  return resource.ownerUserId === actor.userId;
}

export function evaluateOrg(
  actor: AuthorizationContext["actor"],
  resource: ResourceContext | null,
): boolean {
  if (!actor.employerId) return false;
  if (!resource || typeof resource.employerId !== "string" || resource.employerId.length === 0)
    return false;
  return resource.employerId === actor.employerId;
}

export function evaluateAsg(
  actor: AuthorizationContext["actor"],
  resource: ResourceContext | null,
): boolean {
  if (!resource?.assignedUserIds || resource.assignedUserIds.length === 0) return false;
  return resource.assignedUserIds.includes(actor.userId);
}

export function evaluatePub(resource: ResourceContext | null): boolean {
  if (!resource) return false;
  return resource.isPublic === true;
}

/**
 * Orchestrates OWN/ORG/ASG/PUB/COND evaluation with AND (all-mandatory)
 * composition, resolves resource context via the registry, and — this is
 * the load-bearing safety property of this Wave — forces DENY whenever
 * AUTH_SCOPE is among the required scopes, since AUTH_SCOPE enforcement
 * does not exist until Wave 0D-4. AUTH_SCOPE presence short-circuits
 * before any resource resolution is attempted: the outcome is identical
 * either way (deny), and skipping resolution avoids depending on a
 * resolver that may not exist yet for a route that can never be allowed
 * in this Wave regardless.
 */
@Injectable()
export class ScopeEvaluationService {
  private readonly logger = new Logger(ScopeEvaluationService.name);

  constructor(
    private readonly resolvers: ResourceContextResolverRegistry,
    private readonly conditions: ConditionRegistry,
  ) {}

  /**
   * Resolves resource context (when the operation needs it) via the
   * registry, then evaluates composition. This is what PermissionGuard
   * calls in the live request pipeline.
   */
  async resolveAndEvaluate(
    context: Omit<AuthorizationContext, "resource">,
    resourceType: string,
    routeParams: Readonly<Record<string, string>>,
  ): Promise<ScopeEvaluationResult> {
    const { actor, operation } = context;
    const scope = operation.scope;

    if (scope.length === 0) return { allowed: true };

    if (scope.includes("AUTH_SCOPE")) {
      return { allowed: false, reason: "AUTH_SCOPE required — not implemented until Wave 0D-4" };
    }

    const needsResource = this.needsResource(scope, operation.resourceContextRequired);
    let resource: ResourceContext | null = null;
    if (needsResource) {
      resource = await this.resolvers.resolve(resourceType, { actor, routeParams });
      if (!resource) {
        return {
          allowed: false,
          reason: `no resource context resolved for resourceType "${resourceType}"`,
        };
      }
    }

    return this.evaluate({ actor, operation, resource });
  }

  /**
   * Pure composition over an already-resolved `AuthorizationContext` — no
   * resolver call. Used directly by unit tests exercising evaluator
   * composition logic in isolation (per-evaluator fixtures), and internally
   * by `resolveAndEvaluate` above.
   */
  evaluate(context: AuthorizationContext): ScopeEvaluationResult {
    const { actor, operation, resource } = context;
    const scope = operation.scope;

    if (scope.length === 0) return { allowed: true };

    if (scope.includes("AUTH_SCOPE")) {
      return { allowed: false, reason: "AUTH_SCOPE required — not implemented until Wave 0D-4" };
    }

    if (this.needsResource(scope, operation.resourceContextRequired) && !resource) {
      return {
        allowed: false,
        reason: "resourceContextRequired but no resource context was resolved",
      };
    }

    for (const scopeType of scope) {
      const result = this.evaluateSingle(scopeType, actor, resource, operation.conditionIds);
      if (!result.allowed) return result;
    }

    return { allowed: true };
  }

  private needsResource(scope: readonly ScopeType[], resourceContextRequired: boolean): boolean {
    const resourceDependent = scope.some(
      (s) => s === "OWN" || s === "ORG" || s === "ASG" || s === "PUB",
    );
    return resourceDependent || resourceContextRequired;
  }

  private evaluateSingle(
    scopeType: ScopeType,
    actor: AuthorizationContext["actor"],
    resource: ResourceContext | null,
    conditionIds: readonly string[] | undefined,
  ): ScopeEvaluationResult {
    switch (scopeType) {
      case "OWN":
        return evaluateOwn(actor, resource)
          ? { allowed: true }
          : { allowed: false, reason: "OWN: resource owner does not match actor" };
      case "ORG":
        return evaluateOrg(actor, resource)
          ? { allowed: true }
          : { allowed: false, reason: "ORG: resource employerId does not match actor employerId" };
      case "ASG":
        return evaluateAsg(actor, resource)
          ? { allowed: true }
          : { allowed: false, reason: "ASG: actor is not in resource.assignedUserIds" };
      case "PUB":
        return evaluatePub(resource)
          ? { allowed: true }
          : { allowed: false, reason: "PUB: resource is not authoritatively public" };
      case "COND":
        return this.evaluateCond(conditionIds, actor, resource);
      case "AUTH_SCOPE":
        // Unreachable: filtered out by the short-circuit above. Kept as an
        // explicit fail-closed branch rather than an unchecked default.
        return {
          allowed: false,
          reason: "AUTH_SCOPE reached evaluateSingle — should be unreachable",
        };
      default:
        return {
          allowed: false,
          reason: `unknown scope type "${scopeType satisfies never as string}"`,
        };
    }
  }

  /**
   * Evaluates COND using the condition id(s) already resolved for the
   * CURRENT ROLE's own policy (Wave 0D-3 Closure Pass) — never a different
   * role's condition mapping for the same permission key. All mapped
   * condition ids must be IMPLEMENTED and pass (AND) for COND to allow;
   * absent/empty `conditionIds` for a role whose scope includes COND is a
   * data-consistency bug and fails closed.
   */
  private evaluateCond(
    conditionIds: readonly string[] | undefined,
    actor: AuthorizationContext["actor"],
    resource: ResourceContext | null,
  ): ScopeEvaluationResult {
    if (!conditionIds || conditionIds.length === 0) {
      this.logger.warn(
        "COND required but no condition id was resolved for this role — failing closed",
      );
      return { allowed: false, reason: "COND: no condition id resolved for this role" };
    }

    for (const conditionId of conditionIds) {
      const definition = this.conditions.get(conditionId);
      if (!definition) {
        this.logger.warn(
          `COND id "${conditionId}" not found in ConditionRegistry — failing closed`,
        );
        return { allowed: false, reason: `COND: unknown condition id "${conditionId}"` };
      }

      if (definition.status !== "IMPLEMENTED" || !definition.evaluate) {
        return {
          allowed: false,
          reason: `COND: condition "${conditionId}" is ${definition.status}`,
        };
      }

      try {
        const passed = definition.evaluate({ actor, resource });
        if (!passed) {
          return { allowed: false, reason: `COND: condition "${conditionId}" evaluated false` };
        }
      } catch (error) {
        this.logger.error(
          `COND evaluator for "${conditionId}" threw — failing closed`,
          error as Error,
        );
        return { allowed: false, reason: `COND: condition "${conditionId}" evaluator threw` };
      }
    }

    return { allowed: true };
  }
}
