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
   */
  async resolve(
    resourceType: string,
    input: ResourceResolutionInput,
  ): Promise<ResourceContext | null> {
    const resolver = this.resolversByType.get(resourceType);
    if (!resolver) {
      this.logger.warn(`No ResourceContextResolver registered for resourceType "${resourceType}"`);
      return null;
    }

    try {
      const resource = await resolver.resolve(input);
      if (!resource) return null;
      if (resource.resourceType !== resourceType) {
        // A resolver returning a mismatched resourceType is a resolver bug,
        // not a legitimate resource — never trust it.
        this.logger.error(
          `ResourceContextResolver for "${resourceType}" returned mismatched resourceType "${resource.resourceType}"`,
        );
        return null;
      }
      return resource;
    } catch (error) {
      this.logger.error(
        `ResourceContextResolver for "${resourceType}" threw — failing closed`,
        error as Error,
      );
      return null;
    }
  }
}
