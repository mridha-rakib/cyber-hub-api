import { Injectable } from "@nestjs/common";
import {
  ConflictException,
  NotFoundException,
  WorkflowConflictException,
} from "../../../core/errors/app.exception";
import { requireTransition } from "../../../core/workflow/workflow-helper";
import type { SubmissionCreateInput, SubmissionResubmitInput } from "../dto/submission.dto";
import { InternshipEnrollmentsRepository } from "../repositories/internship-enrollments.repository";
import { SubmissionVersionsRepository } from "../repositories/submission-versions.repository";
import { SubmissionsRepository } from "../repositories/submissions.repository";
import { TaskAssignmentsRepository } from "../repositories/task-assignments.repository";

@Injectable()
export class SubmissionService {
  constructor(
    private readonly submissionsRepository: SubmissionsRepository,
    private readonly submissionVersionsRepository: SubmissionVersionsRepository,
    private readonly taskAssignmentsRepository: TaskAssignmentsRepository,
    private readonly enrollmentsRepository: InternshipEnrollmentsRepository,
  ) {}

  /**
   * API-SUB-001. The Task Assignment Gate is re-verified here (not just by
   * the resolver): the assignment must exist, belong to the caller's own
   * enrollment, and have no existing submission yet (`UNIQUE(task_assignment_id)`
   * is the persisted guard — this check gives a clean 409 instead of a raw
   * constraint-violation error).
   */
  async create(assignmentId: string, userId: string, input: SubmissionCreateInput) {
    const assignment = await this.taskAssignmentsRepository.findById(assignmentId);
    if (!assignment) throw new NotFoundException();

    const enrollment = await this.enrollmentsRepository.findById(assignment.enrollmentId);
    if (!enrollment || enrollment.userId !== userId) throw new NotFoundException();

    const existing = await this.submissionsRepository.findByTaskAssignmentId(assignmentId);
    if (existing) {
      throw new ConflictException("A submission already exists for this task.");
    }

    requireTransition("Submission", "WF-SUB-01");
    const submission = await this.submissionsRepository.create({
      taskId: assignment.taskId,
      taskAssignmentId: assignmentId,
      userId,
      status: "SUBMITTED",
    });

    await this.submissionVersionsRepository.create({
      submissionId: submission.id,
      versionNo: 1,
      evidenceText: input.evidenceText,
      evidenceMetadata: input.evidenceMetadata ?? {},
      createdByUserId: userId,
    });

    return submission;
  }

  /** API-SUB-002. Defense in depth alongside the guard's OWN/concealment enforcement. */
  async getOwn(id: string, userId: string) {
    const submission = await this.submissionsRepository.findById(id);
    if (!submission || submission.userId !== userId) throw new NotFoundException();
    const versions = await this.submissionVersionsRepository.findBySubmission(id);
    return { submission, versions };
  }

  /** API-SUB-003. Appends an immutable version rather than editing history in place. */
  async resubmit(id: string, userId: string, input: SubmissionResubmitInput) {
    const existing = await this.submissionsRepository.findById(id);
    if (!existing || existing.userId !== userId) throw new NotFoundException();

    const transition = requireTransition("Submission", "WF-SUB-05");
    const nextVersion = existing.currentVersion + 1;
    const updated = await this.submissionsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      input.expectedStateVersion,
      { currentVersion: nextVersion, submittedAt: new Date() },
    );
    if (!updated) {
      throw new WorkflowConflictException();
    }

    await this.submissionVersionsRepository.create({
      submissionId: id,
      versionNo: nextVersion,
      evidenceText: input.evidenceText,
      evidenceMetadata: input.evidenceMetadata ?? {},
      createdByUserId: userId,
    });

    return updated;
  }
}
