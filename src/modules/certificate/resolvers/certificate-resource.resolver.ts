import { Injectable } from "@nestjs/common";
import type { ResourceContext } from "../../../core/security/authorization/authorization-context.types";
import type {
  ResourceContextResolver,
  ResourceResolutionInput,
} from "../../../core/security/authorization/resource-context-resolver";
import { CertificatesRepository } from "../repositories/certificates.repository";

/**
 * Resolves `ResourceContext` for the `"certificate"` permission domain
 * (`certificate.read_own`). `certificate.issue_manage`/`certificate.revoke`
 * both declare `scope: []` in the API authorization map, so the guard never
 * calls a resolver for those two operations — ownership/existence checks
 * for issue/revoke are the service layer's own responsibility, not this
 * resolver's. `certificate.verify_public` is `@Public()` and bypasses the
 * permission pipeline entirely.
 */
@Injectable()
export class CertificateResourceResolver implements ResourceContextResolver {
  readonly resourceType = "certificate";

  constructor(private readonly certificatesRepository: CertificatesRepository) {}

  async resolve({ actor, routeParams }: ResourceResolutionInput): Promise<ResourceContext | null> {
    if (routeParams.certificateId) {
      const certificate = await this.certificatesRepository.findById(routeParams.certificateId);
      if (!certificate) return null;
      return {
        resourceType: this.resourceType,
        resourceId: certificate.id,
        ownerUserId: certificate.userId,
      };
    }

    // Collection endpoint (GET /me/certificates): self-referential so OWN
    // passes structurally; the service's own "WHERE user_id = actor" query
    // does the real filtering.
    return {
      resourceType: this.resourceType,
      resourceId: actor.userId,
      ownerUserId: actor.userId,
    };
  }
}
