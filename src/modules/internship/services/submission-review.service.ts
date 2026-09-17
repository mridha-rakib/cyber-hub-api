import { Injectable } from "@nestjs/common";
import { NotFoundException, WorkflowConflictException } from "../../../core/errors/app.exception";
import { requireTransition } from "../../../core/workflow/workflow-helper";
import type { ReviewApprovalInput, RevisionRequestInput } from "../dto/review.dto";
import { SubmissionsRepository } from "../repositories/submissions.repository";
import type { ListParams } from "./internship-programme.service";

@Injectable()
export class SubmissionReviewService {
  constructor(private readonly submissionsRepository: SubmissionsRepository) {}

  /**
   * API-REV-001. Admin sees every submission (optionally filtered by
   * status); a Mentor sees only submissions already assigned to them
   * (`reviewerId = actor`) — an unclaimed submission does not appear in
   * anyone's queue until claimed via `start-review`.
   */
  async list(
    actorRole: "ROLE_MENTOR" | "ROLE_ADMIN",
    actorUserId: string,
    status: string | undefined,
    params: ListParams,
  ) {
    const reviewerId = actorRole === "ROLE_MENTOR" ? actorUserId : undefined;
    return this.submissionsRepository.findReviewList(
      reviewerId,
      status,
      undefined,
      params.cursor,
      params.limit,
    );
  }

  /** API-REV-002. Defense in depth alongside the guard's ASG/concealment enforcement. */
  async getForReview(id: string, actorRole: "ROLE_MENTOR" | "ROLE_ADMIN", actorUserId: string) {
    const submission = await this.submissionsRepository.findById(id);
    if (!submission) throw new NotFoundException();
    if (
      actorRole === "ROLE_MENTOR" &&
      submission.reviewerId !== null &&
      submission.reviewerId !== actorUserId
    ) {
      throw new NotFoundException();
    }
    return submission;
  }

  /** API-REV-003. Claims an unclaimed submission for review. */
  async startReview(id: string, reviewerId: string, expectedStateVersion: number) {
    const transition = requireTransition("Submission", "WF-SUB-02");
    const updated = await this.submissionsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      { reviewerId, reviewStartedAt: new Date() },
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-REV-004. */
  async approve(id: string, expectedStateVersion: number, input: ReviewApprovalInput) {
    const transition = requireTransition("Submission", "WF-SUB-03");
    const updated = await this.submissionsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      { approvedAt: new Date(), reviewFeedback: input.reviewNote ?? null },
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-REV-005. */
  async requestRevision(id: string, expectedStateVersion: number, input: RevisionRequestInput) {
    const transition = requireTransition("Submission", "WF-SUB-04");
    const updated = await this.submissionsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      { reviewFeedback: input.feedback },
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  private async assertExistsOrThrowConflict(id: string): Promise<never> {
    const current = await this.submissionsRepository.findById(id);
    if (!current) throw new NotFoundException();
    throw new WorkflowConflictException();
  }
}
