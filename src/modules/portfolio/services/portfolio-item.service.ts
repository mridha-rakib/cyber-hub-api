import { Injectable } from "@nestjs/common";
import { NotFoundException } from "../../../core/errors/app.exception";
import type { PortfolioItemTable } from "../repositories/portfolio-items.repository";
import { PortfolioItemsRepository } from "../repositories/portfolio-items.repository";
import { PortfoliosRepository } from "../repositories/portfolios.repository";

/**
 * One generic service for all six §7.12–7.17 portfolio child item types
 * (projects/links/skills/certifications/evidence/achievements) — their
 * create/update/delete semantics are identical (owner-only, scoped to the
 * caller's own lazily-materialized portfolio row); only the table and the
 * already-Zod-validated field shape differ per call site.
 */
@Injectable()
export class PortfolioItemService {
  constructor(
    private readonly itemsRepository: PortfolioItemsRepository,
    private readonly portfoliosRepository: PortfoliosRepository,
  ) {}

  async create<T extends PortfolioItemTable>(
    table: T,
    userId: string,
    input: Record<string, unknown>,
  ) {
    const portfolio = await this.portfoliosRepository.getOrCreateForUser(userId);
    return this.itemsRepository.create(table, { ...input, portfolioId: portfolio.id });
  }

  async update<T extends PortfolioItemTable>(
    table: T,
    userId: string,
    itemId: string,
    patch: Record<string, unknown>,
  ) {
    const portfolio = await this.portfoliosRepository.getOrCreateForUser(userId);
    const updated = await this.itemsRepository.update(table, itemId, portfolio.id, patch);
    if (!updated) throw new NotFoundException();
    return updated;
  }

  async delete<T extends PortfolioItemTable>(table: T, userId: string, itemId: string) {
    const portfolio = await this.portfoliosRepository.getOrCreateForUser(userId);
    const deleted = await this.itemsRepository.delete(table, itemId, portfolio.id);
    if (!deleted) throw new NotFoundException();
  }
}
