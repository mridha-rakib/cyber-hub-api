import { Injectable } from "@nestjs/common";
import { NotFoundException } from "../../../core/errors/app.exception";
import type { CompletionEvaluationInput } from "../dto/review.dto";
import { InternshipEnrollmentsRepository } from "../repositories/internship-enrollments.repository";
import { SubmissionsRepository } from "../repositories/submissions.repository";
import { TaskAssignmentsRepository } from "../repositories/task-assignments.repository";

/**
 * Completion Eligibility (State & Workflow Spec v1.0 §3.5) is a derived
 * gate, not a state machine — there is no named transition command for it,
 * and the caller can never force `ELIGIBLE` (`CompletionEvaluationInput.expectedEligibility`
 * is documented as "Optional UI expectation only; server computes
 * authoritative eligibility").
 *
 * The documented `internships.completion_criteria` column is an opaque,
 * "programme-defined", source-limited JSON structure with no further leaf
 * schema — this Wave has no documented interpreter for arbitrary criteria
 * content. Per the Wave 1 brief's own instruction ("Unknown/undefined
 * eligibility rule: fail closed"), the one concrete, always-available
 * signal is task completion: eligibility requires every task assigned to
 * the enrollment to have an APPROVED submission. Zero assigned tasks is
 * NOT_ELIGIBLE (fails closed), never vacuously ELIGIBLE. This is an
 * explicit, documented judgment call — see the Wave 1 report's "Completion
 * eligibility" section — not an invented product rule beyond what the gate
 * itself requires ("all defined completion criteria are satisfied").
 */
@Injectable()
export class CompletionService {
  constructor(
    private readonly enrollmentsRepository: InternshipEnrollmentsRepository,
    private readonly taskAssignmentsRepository: TaskAssignmentsRepository,
    private readonly submissionsRepository: SubmissionsRepository,
  ) {}

  /** API-COMP-001. */
  async get(enrollmentId: string) {
    const enrollment = await this.enrollmentsRepository.findById(enrollmentId);
    if (!enrollment) throw new NotFoundException();
    return enrollment;
  }

  /** API-COMP-002. */
  async evaluate(enrollmentId: string, _input: CompletionEvaluationInput) {
    const enrollment = await this.enrollmentsRepository.findById(enrollmentId);
    if (!enrollment) throw new NotFoundException();

    const assignments = await this.taskAssignmentsRepository.findByEnrollment(enrollmentId);
    let eligible = assignments.length > 0;
    for (const assignment of assignments) {
      const submission = await this.submissionsRepository.findByTaskAssignmentId(assignment.id);
      if (submission?.status !== "APPROVED") {
        eligible = false;
        break;
      }
    }

    const eligibility = eligible ? "ELIGIBLE" : "NOT_ELIGIBLE";
    return this.enrollmentsRepository.updateEligibility(
      enrollmentId,
      eligibility,
      eligible ? new Date() : null,
    );
  }
}
