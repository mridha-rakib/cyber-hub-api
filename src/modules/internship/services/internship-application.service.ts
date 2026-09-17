import { Injectable } from "@nestjs/common";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  ConflictException,
  NotFoundException,
  WorkflowConflictException,
} from "../../../core/errors/app.exception";
import type { InternshipApplicationInput } from "../dto/application.dto";
import { InternshipApplicationsRepository } from "../repositories/internship-applications.repository";
import { InternshipEnrollmentsRepository } from "../repositories/internship-enrollments.repository";
import { InternshipsRepository } from "../repositories/internships.repository";
import { requireTransition } from "../workflow-helper";
import type { ListParams } from "./internship-programme.service";

@Injectable()
export class InternshipApplicationService {
  constructor(
    private readonly applicationsRepository: InternshipApplicationsRepository,
    private readonly internshipsRepository: InternshipsRepository,
    private readonly enrollmentsRepository: InternshipEnrollmentsRepository,
    private readonly transactionManager: TransactionManager,
  ) {}

  /**
   * API-APP-001. `userId` and `internshipId` never come from the request
   * body — the actor is the session principal, the programme is the route
   * locator. No duplicate-application check: the ERD explicitly defers that
   * policy ("No UNIQUE(user_id,internship_id) until duplicate/reapplication
   * policy is explicitly approved") — inventing one here would silently add
   * a business rule the source doesn't define.
   */
  async create(internshipId: string, userId: string, input: InternshipApplicationInput) {
    const internship = await this.internshipsRepository.findById(internshipId);
    if (!internship) throw new NotFoundException();
    if (internship.status !== "PUBLISHED") {
      throw new ConflictException("This internship is not currently accepting applications.");
    }

    requireTransition("InternshipApplication", "WF-APP-01");
    return this.applicationsRepository.create({
      internshipId,
      userId,
      status: "SUBMITTED",
      applicationData: input.applicationData,
    });
  }

  /** API-APP-002 / API-ENR-001 share this ownership model. */
  async listOwn(userId: string, status: string | undefined, params: ListParams) {
    return this.applicationsRepository.findOwnList(userId, status, params.cursor, params.limit);
  }

  /** API-APP-003. Defense in depth alongside the guard's own OWN/concealment enforcement. */
  async getOwn(id: string, userId: string) {
    const application = await this.applicationsRepository.findById(id);
    if (!application || application.userId !== userId) throw new NotFoundException();
    return application;
  }

  /** API-APP-004. */
  async listAdmin(
    status: string | undefined,
    internshipId: string | undefined,
    params: ListParams,
  ) {
    return this.applicationsRepository.findAdminList(
      status,
      internshipId,
      params.cursor,
      params.limit,
    );
  }

  /** API-APP-005. */
  async getAdmin(id: string) {
    const application = await this.applicationsRepository.findById(id);
    if (!application) throw new NotFoundException();
    return application;
  }

  /** API-APP-006. */
  async startReview(id: string, reviewerId: string, expectedStateVersion: number) {
    const transition = requireTransition("InternshipApplication", "WF-APP-02");
    const updated = await this.applicationsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      { reviewerId, reviewStartedAt: new Date() },
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /**
   * API-APP-007. Transactional: ACCEPTED transition + the one enrollment
   * row it creates, atomically — exactly as API Contract v1.1 §9.1
   * documents ("Transaction: application UNDER_REVIEW -> ACCEPTED + create
   * internship_enrollments row + AuditLog").
   */
  async accept(id: string, expectedStateVersion: number) {
    return this.transactionManager.runInTransaction(async () => {
      const transition = requireTransition("InternshipApplication", "WF-APP-03");
      const application = await this.applicationsRepository.transitionWithExtras(
        id,
        transition.from,
        transition.to,
        expectedStateVersion,
        { reviewedAt: new Date() },
      );
      if (!application) await this.assertExistsOrThrowConflict(id);

      const existingEnrollment = await this.enrollmentsRepository.findByApplicationId(
        application.id,
      );
      const enrollment =
        existingEnrollment ??
        (await this.enrollmentsRepository.create({
          applicationId: application.id,
          internshipId: application.internshipId,
          userId: application.userId,
        }));

      return { application, enrollment };
    });
  }

  /** API-APP-008. */
  async reject(id: string, expectedStateVersion: number, reason: string) {
    const transition = requireTransition("InternshipApplication", "WF-APP-04");
    const updated = await this.applicationsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      { reviewedAt: new Date(), decisionReason: reason },
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  private async assertExistsOrThrowConflict(id: string): Promise<never> {
    const current = await this.applicationsRepository.findById(id);
    if (!current) throw new NotFoundException();
    throw new WorkflowConflictException();
  }
}
