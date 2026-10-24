import { Injectable } from "@nestjs/common";
import type { ResourceContext } from "../../../core/security/authorization/authorization-context.types";
import type {
  ResourceContextResolver,
  ResourceResolutionInput,
} from "../../../core/security/authorization/resource-context-resolver";
import { ResourcesRepository } from "../repositories/resources.repository";

/**
 * Resolves `ResourceContext` for the `"resource"` permission domain
 * (`resource.read`, `resource.manage`). Route param `resourceId` is only a
 * locator; publication comes from the stored row (`isPublic` only while
 * PUBLISHED), never from the request.
 *
 * With the current API authorization map the Admin operations carry
 * `scope: []` (a role-only ADMIN grant, so PermissionGuard does not call a
 * resolver) and the public reads are `@Public()` with PUBLISHED-only SQL —
 * the same wiring as the career and internship modules. This resolver is
 * registered so any scoped evaluation of the domain resolves authoritative
 * facts and fails closed: no id, or no row, yields null (deny).
 */
@Injectable()
export class ResourceContextResolverImpl implements ResourceContextResolver {
  readonly resourceType = "resource";

  constructor(private readonly resources: ResourcesRepository) {}

  async resolve({ routeParams }: ResourceResolutionInput): Promise<ResourceContext | null> {
    const resourceId = routeParams.resourceId;
    if (!resourceId) return null;
    const row = await this.resources.findById(resourceId);
    if (!row) return null;
    return {
      resourceType: this.resourceType,
      resourceId: row.id,
      isPublic: row.status === "PUBLISHED",
    };
  }
}
