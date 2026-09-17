import { Injectable } from "@nestjs/common";
import { ConflictException, NotFoundException } from "../../../core/errors/app.exception";
import type { TaskUpdateInput, TaskWriteInput } from "../dto/task-write.dto";
import { InternshipsRepository } from "../repositories/internships.repository";
import { TasksRepository } from "../repositories/tasks.repository";

@Injectable()
export class TaskService {
  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly internshipsRepository: InternshipsRepository,
  ) {}

  /** API-TSK-002. */
  async listByInternship(internshipId: string) {
    const internship = await this.internshipsRepository.findById(internshipId);
    if (!internship) throw new NotFoundException();
    return this.tasksRepository.findByInternship(internshipId);
  }

  /** API-TSK-001. Task has no lifecycle status (§3.3) — a plain insert. */
  async create(internshipId: string, input: TaskWriteInput) {
    const internship = await this.internshipsRepository.findById(internshipId);
    if (!internship) throw new NotFoundException();

    return this.tasksRepository.create({
      internshipId,
      title: input.title,
      description: input.description,
      orderNo: input.orderNo,
      requirements: input.requirements,
    });
  }

  /** API-TSK-003. */
  async update(taskId: string, input: TaskUpdateInput) {
    const existing = await this.tasksRepository.findById(taskId);
    if (!existing) throw new NotFoundException();
    const updated = await this.tasksRepository.update(taskId, input);
    if (!updated) throw new NotFoundException();
    return updated;
  }

  /**
   * API-TSK-004. "Delete only unassigned/no-history task; otherwise reject"
   * — a 409, not a silent no-op or a destructive cascade over learner
   * evidence/history.
   */
  async delete(taskId: string) {
    const existing = await this.tasksRepository.findById(taskId);
    if (!existing) throw new NotFoundException();

    const hasHistory = await this.tasksRepository.hasAssignmentOrSubmissionHistory(taskId);
    if (hasHistory) {
      throw new ConflictException(
        "This task has assignments or submissions and cannot be deleted.",
      );
    }

    await this.tasksRepository.delete(taskId);
  }
}
