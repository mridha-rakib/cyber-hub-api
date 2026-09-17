import { Injectable } from "@nestjs/common";
import type { ResourceContext } from "../../../core/security/authorization/authorization-context.types";
import type {
  ResourceContextResolver,
  ResourceResolutionInput,
} from "../../../core/security/authorization/resource-context-resolver";
import {
  portfolioAchievements,
  portfolioCertifications,
  portfolioEvidence,
  portfolioLinks,
  portfolioProjects,
  portfolioSkills,
} from "../../../infrastructure/database/schema";
import { PortfolioCertificatesRepository } from "../repositories/portfolio-certificates.repository";
import type { PortfolioItemTable } from "../repositories/portfolio-items.repository";
import { PortfolioItemsRepository } from "../repositories/portfolio-items.repository";
import { PortfoliosRepository } from "../repositories/portfolios.repository";

const ITEM_TABLES: readonly PortfolioItemTable[] = [
  portfolioProjects,
  portfolioLinks,
  portfolioSkills,
  portfolioCertifications,
  portfolioEvidence,
  portfolioAchievements,
];

/**
 * Resolves `ResourceContext` for the `"portfolio"` permission domain
 * (`portfolio.manage_own`, `portfolio.publish_control_own`,
 * `portfolio.public.read`). Route params across the 24 Portfolio operations
 * take three shapes: `publicSlug` (public read), `itemId` (one of the six
 * §7.12–7.17 child item types — the route alone doesn't say which, so this
 * checks each table by primary key; UUID collision across tables is not a
 * realistic concern), or `certificateId` (the §7.18 join table). No
 * locator at all means a collection/root endpoint (list, `/me/portfolio`,
 * `/me/portfolio/publication`, or an item's own create route) —
 * self-referential, same convention as the Internship resolvers.
 */
@Injectable()
export class PortfolioResourceResolver implements ResourceContextResolver {
  readonly resourceType = "portfolio";

  constructor(
    private readonly portfoliosRepository: PortfoliosRepository,
    private readonly itemsRepository: PortfolioItemsRepository,
    private readonly certificatesRepository: PortfolioCertificatesRepository,
  ) {}

  async resolve({ actor, routeParams }: ResourceResolutionInput): Promise<ResourceContext | null> {
    if (routeParams.publicSlug) {
      const portfolio = await this.portfoliosRepository.findByPublicSlug(routeParams.publicSlug);
      if (!portfolio) return null;
      return {
        resourceType: this.resourceType,
        resourceId: portfolio.id,
        isPublic: portfolio.isPublic,
      };
    }

    if (routeParams.itemId) {
      for (const table of ITEM_TABLES) {
        const item = await this.itemsRepository.findById(table, routeParams.itemId);
        if (item) {
          const portfolio = await this.portfoliosRepository.findById(String(item.portfolioId));
          if (!portfolio) return null;
          return {
            resourceType: this.resourceType,
            resourceId: String(item.id),
            ownerUserId: portfolio.userId,
          };
        }
      }
      return null;
    }

    if (routeParams.certificateId) {
      const portfolio = await this.portfoliosRepository.findByUserId(actor.userId);
      if (!portfolio) return null;
      const link = await this.certificatesRepository.findOne(
        portfolio.id,
        routeParams.certificateId,
      );
      // Not yet linked is a legitimate PUT-to-create target for the owner
      // (API-PORT-022 is idempotent add), not a "not found" — OWN passes
      // via the caller's own portfolio, the link itself doesn't need to
      // pre-exist.
      return {
        resourceType: this.resourceType,
        resourceId: link ? routeParams.certificateId : portfolio.id,
        ownerUserId: portfolio.userId,
      };
    }

    // Collection/root endpoints: self-referential.
    return {
      resourceType: this.resourceType,
      resourceId: actor.userId,
      ownerUserId: actor.userId,
    };
  }
}
