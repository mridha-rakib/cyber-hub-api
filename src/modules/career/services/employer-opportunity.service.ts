import { Injectable } from "@nestjs/common";
import { NotFoundException, WorkflowConflictException } from "../../../core/errors/app.exception";
import { requireTransition } from "../../../core/workflow/workflow-helper";
import type { EmployerOpportunity } from "../../../infrastructure/database/schema";
import type {
  EmployerOpportunityInput,
  EmployerOpportunityUpdateInput,
} from "../dto/employer-opportunity.dto";
import {
  type AdminOpportunityListFilter,
  EmployerOpportunitiesRepository,
  type OwnOpportunityListFilter,
  type PublicOpportunityListFilter,
} from "../repositories/employer-opportunities.repository";

/**
 * §30 data minimization: the public surface (API-EMP-001/002) never
 * exposes `employerId`/`createdByUserId` (internal ownership FKs) or
 * `moderationReason`/`stateVersion` — same rationale as
 * `career-listing.service.ts`'s `toPublicView`. Unlike `jobs`, the ERD
 * defines no employer-display-name snapshot column on
 * `employer_opportunities` (§7.10), so no employer identity is invented
 * for this public view either — see the Wave 3B report's UX contract note.
 */
function toPublicView(opportunity: EmployerOpportunity) {
  return {
    id: opportunity.id,
    type: opportunity.type,
    title: opportunity.title,
    description: opportunity.description,
    requirements: opportunity.requirements,
    skills: opportunity.skills,
    applicationUrl: opportunity.applicationUrl,
    status: opportunity.status,
    publishedAt: opportunity.publishedAt,
    createdAt: opportunity.createdAt,
    updatedAt: opportunity.updatedAt,
  };
}

@Injectable()
export class EmployerOpportunityService {
  constructor(private readonly opportunitiesRepository: EmployerOpportunitiesRepository) {}

  /** API-EMP-001. Public, PUBLISHED-only — never widened by any caller input. */
  async listPublished(filter: PublicOpportunityListFilter) {
    const opportunities = await this.opportunitiesRepository.findPublishedList(filter);
    return opportunities.map(toPublicView);
  }

  /** API-EMP-002. Public — a non-PUBLISHED or missing opportunity is indistinguishable. */
  async getPublished(id: string) {
    const opportunity = await this.opportunitiesRepository.findById(id);
    if (opportunity?.status !== "PUBLISHED") throw new NotFoundException();
    return toPublicView(opportunity);
  }

  /**
   * API-BIZOPP-001. Creation IS the documented WF-LST-01 transition. Every
   * opportunity is ORG-owned (§7.10 requires `employer_id` NOT NULL) —
   * `employerId`/`createdByUserId` are the caller's own DB-loaded identity,
   * never accepted from the request body.
   */
  async create(employerId: string, createdByUserId: string, input: EmployerOpportunityInput) {
    const transition = requireTransition("EmployerOpportunity", "WF-LST-01");
    return this.opportunitiesRepository.create({
      employerId,
      createdByUserId,
      type: input.type,
      title: input.title,
      description: input.description,
      requirements: input.requirements,
      skills: input.skills,
      applicationUrl: input.applicationUrl,
      status: transition.to as "SUBMITTED",
    });
  }

  /** API-BIZOPP-002. Own ORG, every lifecycle state. */
  async listOwn(employerId: string, filter: OwnOpportunityListFilter) {
    return this.opportunitiesRepository.findOwnList(employerId, filter);
  }

  /**
   * API-BIZOPP-003. Ownership was already proven by
   * `EmployerOpportunityResourceResolver` + the ORG scope check before
   * this ever runs.
   */
  async getOwn(id: string) {
    const opportunity = await this.opportunitiesRepository.findById(id);
    if (!opportunity) throw new NotFoundException();
    return opportunity;
  }

  /**
   * API-BIZOPP-004. EDIT_GUARD: content edits only while REJECTED (§13's
   * corrected policy). Never accepts/changes `status`, `stateVersion`
   * (beyond the guard's own increment), `employerId`, `createdByUserId`,
   * or `publishedAt`.
   */
  async update(id: string, input: EmployerOpportunityUpdateInput) {
    const { expectedStateVersion, ...patch } = input;
    const updated = await this.opportunitiesRepository.updateWithGuard(
      id,
      ["REJECTED"],
      expectedStateVersion,
      patch,
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-BIZOPP-005. REJECTED -> SUBMITTED. */
  async resubmit(id: string, expectedStateVersion: number) {
    const transition = requireTransition("EmployerOpportunity", "WF-LST-05");
    const updated = await this.opportunitiesRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      {},
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-BIZOPP-006. PUBLISHED -> CLOSED, own ORG opportunity. */
  async close(id: string, expectedStateVersion: number) {
    return this.closeInternal(id, expectedStateVersion);
  }

  /** API-MOD-002. Every employer, every lifecycle state. */
  async listAdmin(filter: AdminOpportunityListFilter) {
    return this.opportunitiesRepository.findAdminList(filter);
  }

  /** API-MOD-OPP-01. SUBMITTED -> UNDER_REVIEW. */
  async startReview(id: string, expectedStateVersion: number) {
    const transition = requireTransition("EmployerOpportunity", "WF-LST-02");
    const updated = await this.opportunitiesRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      {},
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-MOD-OPP-02. UNDER_REVIEW -> PUBLISHED. */
  async publish(id: string, expectedStateVersion: number) {
    const transition = requireTransition("EmployerOpportunity", "WF-LST-03");
    const updated = await this.opportunitiesRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      { publishedAt: new Date() },
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-MOD-OPP-03. UNDER_REVIEW -> REJECTED; reason required. */
  async reject(id: string, expectedStateVersion: number, reason: string) {
    const transition = requireTransition("EmployerOpportunity", "WF-LST-04");
    const updated = await this.opportunitiesRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      { moderationReason: reason },
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-MOD-OPP-04. PUBLISHED -> CLOSED, admin-moderated. Same transition as API-BIZOPP-006. */
  async adminClose(id: string, expectedStateVersion: number) {
    return this.closeInternal(id, expectedStateVersion);
  }

  private async closeInternal(id: string, expectedStateVersion: number) {
    const transition = requireTransition("EmployerOpportunity", "WF-LST-06");
    const updated = await this.opportunitiesRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      {},
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  private async assertExistsOrThrowConflict(id: string): Promise<never> {
    const current = await this.opportunitiesRepository.findById(id);
    if (!current) throw new NotFoundException();
    throw new WorkflowConflictException();
  }
}
