import { Injectable } from "@nestjs/common";
import { NotFoundException, WorkflowConflictException } from "../../../core/errors/app.exception";
import { requireTransition } from "../../../core/workflow/workflow-helper";
import type { Job } from "../../../infrastructure/database/schema";
import { EmployersRepository } from "../../auth/repositories/employers.repository";
import type {
  BusinessCareerListingInput,
  BusinessCareerListingUpdateInput,
} from "../dto/business-career-listing.dto";
import { buildCursorPage, CAREER_CURSOR_KINDS } from "../pagination/cursor-pagination";
import {
  type AdminJobListFilter,
  JobsRepository,
  type OwnJobListFilter,
  type PublicJobListFilter,
} from "../repositories/jobs.repository";

/**
 * API Contract v1.1 `CareerListingPublicView`: exact public projection for
 * API-CAR-001/002. The raw application target remains available only to
 * API-CAR-003 after its PUBLISHED-state check.
 */
function toPublicView(job: Job) {
  return {
    id: job.id,
    title: job.title,
    employerName: job.employerName,
    location: job.location,
    level: job.level,
    skills: job.skills,
    listingType: job.listingType,
    remoteUk: job.remoteUk,
    publishedAt: job.publishedAt,
  };
}

@Injectable()
export class CareerListingService {
  constructor(
    private readonly jobsRepository: JobsRepository,
    private readonly employersRepository: EmployersRepository,
  ) {}

  /** API-CAR-001. Public, PUBLISHED-only — never widened by any caller input. */
  async listPublished(filter: PublicJobListFilter) {
    const jobs = await this.jobsRepository.findPublishedList(filter);
    const page = buildCursorPage(
      jobs,
      filter.limit,
      CAREER_CURSOR_KINDS.jobPublished,
      (job) => job.publishedAt,
      (job) => job.id,
    );
    return { data: page.data.map(toPublicView), meta: page.meta };
  }

  /** API-CAR-002. Public — a non-PUBLISHED or missing listing is indistinguishable. */
  async getPublished(id: string) {
    const job = await this.jobsRepository.findById(id);
    if (job?.status !== "PUBLISHED") throw new NotFoundException();
    return toPublicView(job);
  }

  /**
   * API-CAR-003. "Validate published application URL then redirect" — the
   * redirect target is always the server-stored `applicationUrl` on an
   * already-PUBLISHED row; the client supplies only `listingId`, never a
   * URL, so there is no client-controlled open-redirect surface here.
   */
  async getOutboundUrl(id: string): Promise<string> {
    const job = await this.jobsRepository.findById(id);
    if (job?.status !== "PUBLISHED") throw new NotFoundException();
    return job.applicationUrl;
  }

  /**
   * API-BIZCAR-001. Creation IS the documented WF-LST-01 transition
   * (unlike InternshipProgramme's plain insert) — the initial status comes
   * from the registry's own `to`, never a hardcoded string.
   * `employerId` is the caller's own DB-loaded employer (never accepted
   * from the request body); `employerName` is the ORG's own profile
   * `companyName` snapshot, per the contract's "Employer display name
   * comes from ORG profile" rule.
   */
  async create(employerId: string, submittedByUserId: string, input: BusinessCareerListingInput) {
    const employer = await this.employersRepository.findById(employerId);
    if (!employer) throw new NotFoundException();

    const transition = requireTransition("CareerListing", "WF-LST-01");
    return this.jobsRepository.create({
      title: input.title,
      employerName: employer.companyName,
      employerId,
      submittedByUserId,
      location: input.location,
      level: input.level,
      skills: input.skills,
      applicationUrl: input.applicationUrl,
      listingType: input.listingType,
      remoteUk: input.remoteUk ?? false,
      status: transition.to as "SUBMITTED",
    });
  }

  /** API-BIZCAR-002. Own ORG, every lifecycle state. */
  async listOwn(employerId: string, filter: OwnJobListFilter) {
    const jobs = await this.jobsRepository.findOwnList(employerId, filter);
    return buildCursorPage(
      jobs,
      filter.limit,
      CAREER_CURSOR_KINDS.jobCreated,
      (job) => job.createdAt,
      (job) => job.id,
    );
  }

  /**
   * API-BIZCAR-003. Ownership was already proven by
   * `CareerResourceResolver` + the ORG scope check before this ever runs.
   */
  async getOwn(id: string) {
    const job = await this.jobsRepository.findById(id);
    if (!job) throw new NotFoundException();
    return job;
  }

  /**
   * API-BIZCAR-004. EDIT_GUARD: content edits only while REJECTED (§13's
   * corrected policy). Never accepts/changes `status`, `stateVersion`
   * (beyond the guard's own increment), `employerId`, `employerName`, or
   * `publishedAt`.
   */
  async update(id: string, input: BusinessCareerListingUpdateInput) {
    const { expectedStateVersion, ...patch } = input;
    const updated = await this.jobsRepository.updateWithGuard(
      id,
      ["REJECTED"],
      expectedStateVersion,
      patch,
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-BIZCAR-005. REJECTED -> SUBMITTED. */
  async resubmit(id: string, expectedStateVersion: number) {
    const transition = requireTransition("CareerListing", "WF-LST-05");
    const updated = await this.jobsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      {},
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-BIZCAR-006. PUBLISHED -> CLOSED, own ORG listing. */
  async close(id: string, expectedStateVersion: number) {
    return this.closeInternal(id, expectedStateVersion);
  }

  /** API-MOD-001. Every employer, every lifecycle state. */
  async listAdmin(filter: AdminJobListFilter) {
    const jobs = await this.jobsRepository.findAdminList(filter);
    return buildCursorPage(
      jobs,
      filter.limit,
      CAREER_CURSOR_KINDS.jobCreated,
      (job) => job.createdAt,
      (job) => job.id,
    );
  }

  /** API-MOD-CAR-01. SUBMITTED -> UNDER_REVIEW. */
  async startReview(id: string, expectedStateVersion: number) {
    const transition = requireTransition("CareerListing", "WF-LST-02");
    const updated = await this.jobsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      {},
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-MOD-CAR-02. UNDER_REVIEW -> PUBLISHED. */
  async publish(id: string, expectedStateVersion: number) {
    const transition = requireTransition("CareerListing", "WF-LST-03");
    const updated = await this.jobsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      { publishedAt: new Date() },
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-MOD-CAR-03. UNDER_REVIEW -> REJECTED; reason required. */
  async reject(id: string, expectedStateVersion: number, reason: string) {
    const transition = requireTransition("CareerListing", "WF-LST-04");
    const updated = await this.jobsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      { moderationReason: reason },
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-MOD-CAR-04. PUBLISHED -> CLOSED, admin-moderated. Same transition as API-BIZCAR-006. */
  async adminClose(id: string, expectedStateVersion: number) {
    return this.closeInternal(id, expectedStateVersion);
  }

  private async closeInternal(id: string, expectedStateVersion: number) {
    const transition = requireTransition("CareerListing", "WF-LST-06");
    const updated = await this.jobsRepository.transitionWithExtras(
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
    const current = await this.jobsRepository.findById(id);
    if (!current) throw new NotFoundException();
    throw new WorkflowConflictException();
  }
}
