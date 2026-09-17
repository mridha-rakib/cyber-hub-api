import { Injectable } from "@nestjs/common";
import { NotFoundException } from "../../../core/errors/app.exception";
import type { TaskAssignmentInput } from "../dto/task-assignment.dto";
import { InternshipEnrollmentsRepository } from "../repositories/internship-enrollments.repository";
import { TaskAssignmentsRepository } from "../repositories/task-assignments.repository";
import { TasksRepository } from "../repositories/tasks.repository";
import type { ListParams } from "./internship-programme.service";

@Injectable()
export class InternshipEnrollmentService {
  constructor(
    private readonly enrollmentsRepository: InternshipEnrollmentsRepository,
    private readonly taskAssignmentsRepository: TaskAssignmentsRepository,
    private readonly tasksRepository: TasksRepository,
  ) {}

  /** API-ENR-001. */
  async listOwn(userId: string, params: ListParams) {
    return this.enrollmentsRepository.findOwnList(userId, params.cursor, params.limit);
  }

  /** API-ENR-002. Defense in depth alongside the guard's OWN/concealment enforcement. */
  async getOwn(id: string, userId: string) {
    const enrollment = await this.enrollmentsRepository.findById(id);
    if (!enrollment || enrollment.userId !== userId) throw new NotFoundException();
    return enrollment;
  }

  /**
   * API-ENR-003. Learner sees only their own enrollment's assignments —
   * `enrollmentId` is a locator into a row the guard has already verified
   * belongs to this learner (OWN), never a free `?learnerId=` filter.
   */
  async listOwnTaskAssignments(enrollmentId: string, userId: string) {
    const enrollment = await this.enrollmentsRepository.findById(enrollmentId);
    if (!enrollment || enrollment.userId !== userId) throw new NotFoundException();
    return this.taskAssignmentsRepository.findByEnrollment(enrollmentId);
  }

  /** API-ENR-005. */
  async getAdmin(id: string) {
    const enrollment = await this.enrollmentsRepository.findById(id);
    if (!enrollment) throw new NotFoundException();
    return enrollment;
  }

  /**
   * API-ENR-004. The Task Assignment Gate (§3.3) is a relation, not a
   * state machine — this is a plain insert guarded by the
   * `UNIQUE(enrollment_id,task_id)` constraint, not a workflow transition.
   * Every task id must belong to the same programme as the enrollment;
   * assigning a task from a different internship would silently violate
   * the gate's own premise (learner only sees tasks for their own
   * programme).
   */
  async assignTasks(enrollmentId: string, assignedByUserId: string, input: TaskAssignmentInput) {
    const enrollment = await this.enrollmentsRepository.findById(enrollmentId);
    if (!enrollment) throw new NotFoundException();

    const tasks = await this.tasksRepository.findByIds(input.taskIds);
    const validTaskIds = new Set(
      tasks.filter((task) => task.internshipId === enrollment.internshipId).map((task) => task.id),
    );

    const dueAtByTask = input.dueAtByTask ?? {};
    const inserts = input.taskIds
      .filter((taskId) => validTaskIds.has(taskId))
      .map((taskId) => ({
        enrollmentId,
        taskId,
        assignedByUserId,
        dueAt: dueAtByTask[taskId] ? new Date(dueAtByTask[taskId]) : undefined,
      }));

    return this.taskAssignmentsRepository.createMany(inserts);
  }
}
