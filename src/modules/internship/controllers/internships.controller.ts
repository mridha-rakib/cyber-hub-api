import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { Public } from "../../../common/decorators/public.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import {
  type InternshipUpdateInput,
  type InternshipWriteInput,
  internshipUpdateSchema,
  internshipWriteSchema,
} from "../dto/internship-write.dto";
import {
  type TaskUpdateInput,
  type TaskWriteInput,
  taskUpdateSchema,
  taskWriteSchema,
} from "../dto/task-write.dto";
import { type TransitionInput, transitionSchema } from "../dto/transition.dto";
import { InternshipProgrammeService } from "../services/internship-programme.service";
import { TaskService } from "../services/task.service";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(limit?: string): number {
  const parsed = limit ? Number.parseInt(limit, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

@Controller()
export class InternshipsController {
  constructor(
    private readonly programmeService: InternshipProgrammeService,
    private readonly taskService: TaskService,
  ) {}

  @Public()
  @Get("internships")
  listPublished(@Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.programmeService.listPublished({ cursor, limit: clampLimit(limit) });
  }

  @Public()
  @Get("internships/:internshipId")
  getPublished(@Param("internshipId") internshipId: string) {
    return this.programmeService.getPublished(internshipId);
  }

  @AuthorizeOperation("API-INT-009")
  @Get("admin/internships")
  listAdmin(
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.programmeService.listAdmin({ status, q, cursor, limit: clampLimit(limit) });
  }

  @AuthorizeOperation("API-INT-010")
  @Get("admin/internships/:internshipId")
  getAdmin(@Param("internshipId") internshipId: string) {
    return this.programmeService.getAdmin(internshipId);
  }

  @AuthorizeOperation("API-INT-003")
  @Post("admin/internships")
  @HttpCode(201)
  create(@Body(new ValidationPipe(internshipWriteSchema)) body: InternshipWriteInput) {
    return this.programmeService.create(body);
  }

  @AuthorizeOperation("API-INT-004")
  @Patch("admin/internships/:internshipId")
  update(
    @Param("internshipId") internshipId: string,
    @Body(new ValidationPipe(internshipUpdateSchema)) body: InternshipUpdateInput,
  ) {
    return this.programmeService.update(internshipId, body);
  }

  @AuthorizeOperation("API-INT-005")
  @HttpCode(200)
  @Post("admin/internships/:internshipId/publish")
  publish(
    @Param("internshipId") internshipId: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.programmeService.publish(internshipId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-INT-006")
  @HttpCode(200)
  @Post("admin/internships/:internshipId/close")
  close(
    @Param("internshipId") internshipId: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.programmeService.close(internshipId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-INT-007")
  @HttpCode(200)
  @Post("admin/internships/:internshipId/archive")
  archive(
    @Param("internshipId") internshipId: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.programmeService.archive(internshipId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-INT-008")
  @HttpCode(200)
  @Post("admin/internships/:internshipId/return-to-draft")
  returnToDraft(
    @Param("internshipId") internshipId: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.programmeService.returnToDraft(internshipId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-TSK-002")
  @Get("admin/internships/:internshipId/tasks")
  listTasks(@Param("internshipId") internshipId: string) {
    return this.taskService.listByInternship(internshipId);
  }

  @AuthorizeOperation("API-TSK-001")
  @Post("admin/internships/:internshipId/tasks")
  @HttpCode(201)
  createTask(
    @Param("internshipId") internshipId: string,
    @Body(new ValidationPipe(taskWriteSchema)) body: TaskWriteInput,
  ) {
    return this.taskService.create(internshipId, body);
  }

  @AuthorizeOperation("API-TSK-003")
  @Patch("admin/tasks/:taskId")
  updateTask(
    @Param("taskId") taskId: string,
    @Body(new ValidationPipe(taskUpdateSchema)) body: TaskUpdateInput,
  ) {
    return this.taskService.update(taskId, body);
  }

  @AuthorizeOperation("API-TSK-004")
  @Delete("admin/tasks/:taskId")
  @HttpCode(204)
  async deleteTask(@Param("taskId") taskId: string) {
    await this.taskService.delete(taskId);
  }
}
