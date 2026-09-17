import { Injectable } from "@nestjs/common";
import { ConflictException, NotFoundException } from "../../../core/errors/app.exception";
import {
  portfolioAchievements,
  portfolioCertifications,
  portfolioEvidence,
  portfolioLinks,
  portfolioProjects,
  portfolioSkills,
} from "../../../infrastructure/database/schema";
import type { PortfolioPublicationInput } from "../dto/portfolio-publication.dto";
import { PortfolioCertificatesRepository } from "../repositories/portfolio-certificates.repository";
import { PortfolioItemsRepository } from "../repositories/portfolio-items.repository";
import { PortfoliosRepository } from "../repositories/portfolios.repository";

@Injectable()
export class PortfolioService {
  constructor(
    private readonly portfoliosRepository: PortfoliosRepository,
    private readonly itemsRepository: PortfolioItemsRepository,
    private readonly certificatesRepository: PortfolioCertificatesRepository,
  ) {}

  /** API-PORT-002. Full private projection: root + every child item regardless of its own isPublic. */
  async getOwn(userId: string) {
    const portfolio = await this.portfoliosRepository.getOrCreateForUser(userId);
    const [projects, links, skills, certifications, evidence, achievements, certificates] =
      await Promise.all([
        this.itemsRepository.findByPortfolio(portfolioProjects, portfolio.id),
        this.itemsRepository.findByPortfolio(portfolioLinks, portfolio.id),
        this.itemsRepository.findByPortfolio(portfolioSkills, portfolio.id),
        this.itemsRepository.findByPortfolio(portfolioCertifications, portfolio.id),
        this.itemsRepository.findByPortfolio(portfolioEvidence, portfolio.id),
        this.itemsRepository.findByPortfolio(portfolioAchievements, portfolio.id),
        this.certificatesRepository.findByPortfolioWithCertificateData(portfolio.id),
      ]);
    return {
      portfolio,
      projects,
      links,
      skills,
      certifications,
      evidence,
      achievements,
      certificates,
    };
  }

  /**
   * API-PORT-003. `isPublic`/`publicSlug` are the only two portfolio-level
   * publication fields the ERD documents (§7.11) — this is a plain field
   * update, not a named workflow (Wave 2 Phase 23: "a simple documented
   * visibility field without state machine").
   */
  async updatePublication(userId: string, input: PortfolioPublicationInput) {
    const portfolio = await this.portfoliosRepository.getOrCreateForUser(userId);

    if (input.publicSlug) {
      const existing = await this.portfoliosRepository.findByPublicSlug(input.publicSlug);
      if (existing && existing.id !== portfolio.id) {
        throw new ConflictException("This public URL is already in use.");
      }
    }

    const updated = await this.portfoliosRepository.updatePublication(portfolio.id, {
      isPublic: input.isPublic,
      publicSlug: input.publicSlug ?? portfolio.publicSlug,
      publishedAt: input.isPublic ? new Date() : portfolio.publishedAt,
    });
    if (!updated) throw new NotFoundException();
    return updated;
  }

  /**
   * API-PORT-001 (UI-PUB-019). Two-gate AND per the ERD's own
   * implementation note: "Public projection requires root is_public plus
   * per-item is_public. Hidden item metadata is omitted." — filtering
   * happens entirely server-side; nothing non-public is ever included in
   * the response for the client to hide.
   */
  async getPublicBySlug(publicSlug: string) {
    const portfolio = await this.portfoliosRepository.findByPublicSlug(publicSlug);
    if (!portfolio?.isPublic) throw new NotFoundException();

    const [projects, links, skills, certifications, evidence, achievements, certificates] =
      await Promise.all([
        this.itemsRepository.findPublicByPortfolio(portfolioProjects, portfolio.id),
        this.itemsRepository.findPublicByPortfolio(portfolioLinks, portfolio.id),
        this.itemsRepository.findPublicByPortfolio(portfolioSkills, portfolio.id),
        this.itemsRepository.findPublicByPortfolio(portfolioCertifications, portfolio.id),
        this.itemsRepository.findPublicByPortfolio(portfolioEvidence, portfolio.id),
        this.itemsRepository.findPublicByPortfolio(portfolioAchievements, portfolio.id),
        this.certificatesRepository.findPublicByPortfolioWithCertificateData(portfolio.id),
      ]);

    return {
      publicSlug: portfolio.publicSlug,
      projects,
      links,
      skills,
      certifications,
      evidence,
      achievements,
      certificates,
    };
  }
}
