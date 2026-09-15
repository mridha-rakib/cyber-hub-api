import { Injectable, Logger } from "@nestjs/common";
import { AuthScopeEvaluator } from "./auth-scope-evaluator.service";
import type { AuthorizationContext, ResourceContext } from "./authorization-context.types";
import { ConditionRegistry } from "./condition-registry";
import { ResourceContextResolverRegistry } from "./resource-context-resolver";
import type { ScopeType } from "./scope.types";

export interface ScopeEvaluationResult {
  readonly allowed: boolean;
  /** Which specific scope check failed first, for internal logging only — never sent to the client. */
  readonly reason?: string;
  /**
   * Wave 0D-5 (Phase 6/7). Set to "NOT_FOUND" only when a registered
   * resolver actually ran and confirmed the resource does not exist — the
   * one case PermissionGuard maps to an UNCONDITIONAL 404, regardless of
   * the operation's disclosure policy. Every other `allowed: false` result
   * (no resolver registered, resolver failure, or any OWN/ORG/ASG/PUB/
   * COND/AUTH_SCOPE check failing on a resource that WAS found) leaves
   * this unset and is instead gated by the operation's
   * AuthorizationDisclosurePolicy (DISCLOSE_FORBIDDEN -> 403,
   * CONCEAL_EXISTENCE -> 404) — see disclosure-policy.ts.
   */
  readonly outcome?: "NOT_FOUND";
  /**
   * Wave 0D-7. The authoritative `ResourceContext` actually resolved via
   * `ResourceContextResolverRegistry` (OWN/ORG/ASG/PUB path only — AUTH_SCOPE
   * resolves its own separate evidence and never populates this field, by
   * design; see evaluateAuthScope). Present on BOTH allow and deny outcomes
   * whenever a resource was genuinely found, so the caller (PermissionGuard,
   * for authorization-decision audit logging) can read already-resolved
   * facts — entity id, tenant, owner — without issuing a second database
   * lookup purely to enrich an audit row. Never set from client input.
   */
  readonly resource?: ResourceContext;
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
 * Orchestrates OWN/ORG/ASG/PUB/COND/AUTH_SCOPE evaluation with AND
 * (all-mandatory) composition. OWN/ORG/ASG/PUB resolve resource context
 * via `ResourceContextResolverRegistry`; AUTH_SCOPE (Wave 0D-4B) resolves
 * its own authoritative context via `AuthScopeEvaluator`, backed by real
 * `security_assessments`/`security_scope_authorizations` rows — these are
 * two independent evidence sources that both compose into the same AND
 * loop, never merged or allowed to substitute for one another.
 */
@Injectable()
export class ScopeEvaluationService {
  private readonly logger = new Logger(ScopeEvaluationService.name);

  constructor(
    private readonly resolvers: ResourceContextResolverRegistry,
    private readonly conditions: ConditionRegistry,
    private readonly authScope: AuthScopeEvaluator,
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

    const needsResource = this.needsResource(scope, operation.resourceContextRequired);
    let resource: ResourceContext | null = null;
    if (needsResource) {
      const outcome = await this.resolvers.resolveOutcome(resourceType, { actor, routeParams });
      if (outcome.status === "NOT_FOUND") {
        // The resolver ran and affirmatively confirmed no such record
        // exists — safe to report as an unconditional, generic 404
        // regardless of the operation's disclosure policy.
        return {
          allowed: false,
          outcome: "NOT_FOUND",
          reason: `resource not found for resourceType "${resourceType}"`,
        };
      }
      if (outcome.status !== "FOUND") {
        // NO_RESOLVER / RESOLVER_FAILURE: unchanged fail-closed behavior —
        // never presented as a confirmed "does not exist" result, since
        // that would misrepresent a configuration/operational failure as
        // a factual non-disclosure outcome (Wave 0D-5 Phase 6).
        return {
          allowed: false,
          reason: `no resource context resolved for resourceType "${resourceType}"`,
        };
      }
      resource = outcome.resource;
    }

    return this.evaluate({ actor, operation, resource }, routeParams);
  }

  /**
   * Composition over an already-resolved `AuthorizationContext`. `resource`
   * (OWN/ORG/ASG/PUB) must already be resolved by the caller; AUTH_SCOPE
   * resolves its own context internally via `AuthScopeEvaluator`, using
   * `routeParams.assessmentId` strictly as a LOCATOR (Wave 0D-4B Phase 21
   * — it identifies which row to load, it never itself proves
   * authorization). Used directly by unit tests exercising composition
   * logic in isolation, and internally by `resolveAndEvaluate` above.
   */
  async evaluate(
    context: AuthorizationContext,
    routeParams: Readonly<Record<string, string>> = {},
  ): Promise<ScopeEvaluationResult> {
    const { actor, operation, resource } = context;
    const scope = operation.scope;

    if (scope.length === 0) return { allowed: true };

    if (this.needsResource(scope, operation.resourceContextRequired) && !resource) {
      return {
        allowed: false,
        reason: "resourceContextRequired but no resource context was resolved",
      };
    }

    for (const scopeType of scope) {
      const result = await this.evaluateSingle(
        scopeType,
        actor,
        resource,
        operation.conditionIds,
        routeParams,
      );
      if (!result.allowed) return resource ? { ...result, resource } : result;
    }

    return resource ? { allowed: true, resource } : { allowed: true };
  }

  private needsResource(scope: readonly ScopeType[], resourceContextRequired: boolean): boolean {
    const resourceDependent = scope.some(
      (s) => s === "OWN" || s === "ORG" || s === "ASG" || s === "PUB",
    );
    return resourceDependent || resourceContextRequired;
  }

  private async evaluateSingle(
    scopeType: ScopeType,
    actor: AuthorizationContext["actor"],
    resource: ResourceContext | null,
    conditionIds: readonly string[] | undefined,
    routeParams: Readonly<Record<string, string>>,
  ): Promise<ScopeEvaluationResult> {
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
        return this.evaluateAuthScope(routeParams);
      default:
        return {
          allowed: false,
          reason: `unknown scope type "${scopeType satisfies never as string}"`,
        };
    }
  }

  /**
   * AUTH_SCOPE (Wave 0D-4B). `routeParams.assessmentId` is used strictly as
   * a locator to pick which `security_assessments` row to load — it is
   * never itself treated as proof of authorization. Any missing locator,
   * missing/malformed persisted evidence, or a failed validity/linkage/
   * target/activity check denies.
   */
  private async evaluateAuthScope(
    routeParams: Readonly<Record<string, string>>,
  ): Promise<ScopeEvaluationResult> {
    const assessmentId = routeParams.assessmentId;
    if (!assessmentId) {
      this.logger.warn("AUTH_SCOPE required but no assessmentId route locator was present");
      return { allowed: false, reason: "AUTH_SCOPE: no assessmentId locator in route" };
    }

    const result = await this.authScope.evaluate({ assessmentId });
    if (!result.allowed) {
      this.logger.warn(
        `AUTH_SCOPE denied for assessment ${assessmentId}: ${result.reason ?? "unspecified"}`,
      );
    }
    return result;
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
