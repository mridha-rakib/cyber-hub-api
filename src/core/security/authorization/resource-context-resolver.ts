import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { ActorContext, ResourceContext } from "./authorization-context.types";

/**
 * Input available to a resolver: the trusted actor plus raw route
 * identifiers (e.g. `{ id: "abc-123" }` from `/portfolio/:id`). Route
 * params may be used ONLY as a locator ("load the record with this id"),
 * never as proof of ownership/tenant/assignment/publication — the
 * resolver's job is to go load the authoritative facts server-side.
 */
export interface ResourceResolutionInput {
  readonly actor: ActorContext;
  readonly routeParams: Readonly<Record<string, string>>;
}

/**
 * Implemented per resource type by whichever product module owns that
 * table. Wave 0D-3 ships the registry/contract only — no domain resolvers
 * are registered in production wiring yet, because the underlying product
 * tables (portfolios, applications, submissions, consulting requests,
 * assessments, findings, reports, ...) do not exist in the schema yet.
 * Every real resolver call in this Wave therefore fails closed with "no
 * resolver registered" until a future product-module wave supplies one.
 */
export interface ResourceContextResolver {
  /** Matches `PermissionDefinition.domain` (e.g. "portfolio", "internship"). */
  readonly resourceType: string;
  /**
   * Returns the authoritative resource facts, or `null` if the resource
   * does not exist / cannot be resolved for this actor. Must never throw
   * for an ordinary "not found" — reserve exceptions for genuine resolver
   * failures (DB errors etc.), which the registry also treats as a deny.
   */
  resolve(input: ResourceResolutionInput): Promise<ResourceContext | null>;
}

export const RESOURCE_CONTEXT_RESOLVERS = Symbol("RESOURCE_CONTEXT_RESOLVERS");

/**
 * Wave 0D-5 internal outcome model (Phase 6). `resolve()` below still
 * collapses every failure mode to `null` for full backward compatibility
 * with every existing resolver implementation/test — but the guard/
 * evaluation layer needs to tell "the resolver ran and confirmed the
 * record genuinely does not exist" (safe to expose as an unconditional
 * 404) apart from "no resolver is even wired up" / "the resolver itself
 * failed" (must keep failing closed the way it already does, and must
 * never be presented to the client as proof the resource is absent —
 * that would misrepresent an operational/configuration failure as a
 * factual non-disclosure result).
 */
export type ResourceResolutionOutcome =
  | { readonly status: "FOUND"; readonly resource: ResourceContext }
  | { readonly status: "NOT_FOUND" }
  | { readonly status: "NO_RESOLVER" }
  | { readonly status: "RESOLVER_FAILURE" };

/**
 * Small typed registry over one resolver per resource type — deliberately
 * not a giant switch statement. Resolvers register themselves via the
 * `RESOURCE_CONTEXT_RESOLVERS` multi-provider token; this service just
 * indexes them by `resourceType` and fails closed whenever a lookup or a
 * resolve() call cannot produce authoritative resource context.
 */
@Injectable()
export class ResourceContextResolverRegistry {
  private readonly logger = new Logger(ResourceContextResolverRegistry.name);
  private readonly resolversByType: ReadonlyMap<string, ResourceContextResolver>;

  constructor(
    @Optional()
    @Inject(RESOURCE_CONTEXT_RESOLVERS)
    resolvers: ResourceContextResolver[] | undefined,
  ) {
    const map = new Map<string, ResourceContextResolver>();
    for (const resolver of resolvers ?? []) {
      if (map.has(resolver.resourceType)) {
        throw new Error(
          `Duplicate ResourceContextResolver registered for resourceType "${resolver.resourceType}"`,
        );
      }
      map.set(resolver.resourceType, resolver);
    }
    this.resolversByType = map;
  }

  /**
   * Resolves authoritative resource context, or returns `null` if no
   * resolver is registered, the resolver reports the resource doesn't
   * exist, or the resolver throws. Every one of these outcomes is treated
   * identically (fail closed) by the caller — this method never throws.
   * Kept for backward compatibility; prefer `resolveOutcome` in new code
   * that needs to distinguish genuine not-found from resolver failure.
   */
  async resolve(
    resourceType: string,
    input: ResourceResolutionInput,
  ): Promise<ResourceContext | null> {
    const outcome = await this.resolveOutcome(resourceType, input);
    return outcome.status === "FOUND" ? outcome.resource : null;
  }

  /**
   * Same resolution as `resolve()`, but reports which specific failure
   * mode occurred instead of collapsing them all to `null`. This method
   * also never throws — every failure mode is a normal return value.
   */
  async resolveOutcome(
    resourceType: string,
    input: ResourceResolutionInput,
  ): Promise<ResourceResolutionOutcome> {
    const resolver = this.resolversByType.get(resourceType);
    if (!resolver) {
      this.logger.warn(`No ResourceContextResolver registered for resourceType "${resourceType}"`);
      return { status: "NO_RESOLVER" };
    }

    try {
      const resource = await resolver.resolve(input);
      if (!resource) return { status: "NOT_FOUND" };
      if (resource.resourceType !== resourceType) {
        // A resolver returning a mismatched resourceType is a resolver bug,
        // not a legitimate "confirmed absent" result — never trust it, and
        // never let it masquerade as a genuine not-found.
        this.logger.error(
          `ResourceContextResolver for "${resourceType}" returned mismatched resourceType "${resource.resourceType}"`,
        );
        return { status: "RESOLVER_FAILURE" };
      }
      return { status: "FOUND", resource };
    } catch (error) {
      this.logger.error(
        `ResourceContextResolver for "${resourceType}" threw — failing closed`,
        error as Error,
      );
      return { status: "RESOLVER_FAILURE" };
    }
  }
}
