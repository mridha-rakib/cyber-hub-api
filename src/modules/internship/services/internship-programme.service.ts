import { Injectable } from "@nestjs/common";
import {
  ConflictException,
  NotFoundException,
  WorkflowConflictException,
} from "../../../core/errors/app.exception";
import { requireTransition } from "../../../core/workflow/workflow-helper";
import type { InternshipUpdateInput, InternshipWriteInput } from "../dto/internship-write.dto";
import { InternshipApplicationsRepository } from "../repositories/internship-applications.repository";
import { InternshipsRepository } from "../repositories/internships.repository";

export interface ListParams {
  readonly cursor?: string;
  readonly limit: number;
}

export interface AdminListParams extends ListParams {
  readonly status?: string;
  readonly q?: string;
}

@Injectable()
export class InternshipProgrammeService {
  constructor(
    private readonly internshipsRepository: InternshipsRepository,
    private readonly applicationsRepository: InternshipApplicationsRepository,
  ) {}

  /** API-INT-001. Public, PUBLISHED-only — never widened by any caller input. */
  async listPublished(params: ListParams) {
    return this.internshipsRepository.findPublishedList(params);
  }

  /** API-INT-002. Public — a non-PUBLISHED or missing internship is indistinguishable. */
  async getPublished(id: string) {
    const internship = await this.internshipsRepository.findById(id);
    if (internship?.status !== "PUBLISHED") {
      throw new NotFoundException();
    }
    return internship;
  }

  /** API-INT-009. */
  async listAdmin(params: AdminListParams) {
    return this.internshipsRepository.findAdminList(params);
  }

  /** API-INT-010. */
  async getAdmin(id: string) {
    const internship = await this.internshipsRepository.findById(id);
    if (!internship) throw new NotFoundException();
    return internship;
  }

  /** API-INT-003. Plain insert — creation is not a workflow transition. */
  async create(input: InternshipWriteInput) {
    return this.internshipsRepository.create({
      title: input.title,
      description: input.description,
      requirements: input.requirements,
      duration: input.duration,
      completionCriteria: input.completionCriteria,
      status: "DRAFT",
    });
  }

  /** API-INT-004. EDIT_GUARD: content edits only while DRAFT. */
  async update(id: string, input: InternshipUpdateInput) {
    const { expectedStateVersion, ...patch } = input;
    const updated = await this.internshipsRepository.updateWithGuard(
      id,
      ["DRAFT"],
      expectedStateVersion,
      patch,
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-INT-005. */
  async publish(id: string, expectedStateVersion: number) {
    const transition = requireTransition("InternshipProgramme", "WF-PRG-01");
    const updated = await this.internshipsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      { publishedAt: new Date() },
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-INT-006. */
  async close(id: string, expectedStateVersion: number) {
    const transition = requireTransition("InternshipProgramme", "WF-PRG-02");
    const updated = await this.internshipsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      { closedAt: new Date() },
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /** API-INT-007. */
  async archive(id: string, expectedStateVersion: number) {
    const transition = requireTransition("InternshipProgramme", "WF-PRG-03");
    const updated = await this.internshipsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      {},
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  /**
   * API-INT-008. WF-PRG-04's documented guard ("allowed only before any
   * learner application exists") is a business rule outside the pure state
   * machine — enforced here, exactly like the registry's own comment for
   * this transition describes.
   */
  async returnToDraft(id: string, expectedStateVersion: number) {
    const existing = await this.internshipsRepository.findById(id);
    if (!existing) throw new NotFoundException();

    const applications = await this.applicationsRepository.findAdminList(
      undefined,
      id,
      undefined,
      1,
    );
    if (applications.length > 0) {
      throw new ConflictException(
        "This internship already has applications and can no longer be returned to draft.",
      );
    }

    const transition = requireTransition("InternshipProgramme", "WF-PRG-04");
    const updated = await this.internshipsRepository.transitionWithExtras(
      id,
      transition.from,
      transition.to,
      expectedStateVersion,
      { publishedAt: null },
    );
    if (updated) return updated;
    await this.assertExistsOrThrowConflict(id);
  }

  private async assertExistsOrThrowConflict(id: string): Promise<never> {
    const current = await this.internshipsRepository.findById(id);
    if (!current) throw new NotFoundException();
    throw new WorkflowConflictException();
  }
}
