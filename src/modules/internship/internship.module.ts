import { Module } from "@nestjs/common";
import { InternshipApplicationsController } from "./controllers/internship-applications.controller";
import { InternshipEnrollmentsController } from "./controllers/internship-enrollments.controller";
import { InternshipsController } from "./controllers/internships.controller";
import { ReviewController } from "./controllers/review.controller";
import { SubmissionsController } from "./controllers/submissions.controller";
import { InternshipApplicationsRepository } from "./repositories/internship-applications.repository";
import { InternshipEnrollmentsRepository } from "./repositories/internship-enrollments.repository";
import { InternshipsRepository } from "./repositories/internships.repository";
import { SubmissionVersionsRepository } from "./repositories/submission-versions.repository";
import { SubmissionsRepository } from "./repositories/submissions.repository";
import { TaskAssignmentsRepository } from "./repositories/task-assignments.repository";
import { TasksRepository } from "./repositories/tasks.repository";
import { CompletionResourceResolver } from "./resolvers/completion-resource.resolver";
import { InternshipResourceResolver } from "./resolvers/internship-resource.resolver";
import { SubmissionResourceResolver } from "./resolvers/submission-resource.resolver";
import { CompletionService } from "./services/completion.service";
import { InternshipApplicationService } from "./services/internship-application.service";
import { InternshipEnrollmentService } from "./services/internship-enrollment.service";
import { InternshipProgrammeService } from "./services/internship-programme.service";
import { SubmissionService } from "./services/submission.service";
import { SubmissionReviewService } from "./services/submission-review.service";
import { TaskService } from "./services/task.service";

/**
 * Wave 1: Internship Core Vertical Slice. Reuses the Wave 0D authorization
 * (AuthGuard/PermissionGuard, both global), workflow (registry + CAS
 * transition executor), and audit foundations as-is — this module supplies
 * only the persistence, business logic, and the three `ResourceContextResolver`
 * implementations the "internship"/"submission"/"completion" permission
 * domains need (see `security.module.ts` for how they're wired into the
 * global `RESOURCE_CONTEXT_RESOLVERS` provider — Nest has no `multi: true`
 * for plain providers, so the resolver array is composed there via a
 * factory, not re-declared per feature module).
 */
@Module({
  controllers: [
    InternshipsController,
    InternshipApplicationsController,
    InternshipEnrollmentsController,
    SubmissionsController,
    ReviewController,
  ],
  providers: [
    InternshipsRepository,
    InternshipApplicationsRepository,
    InternshipEnrollmentsRepository,
    TasksRepository,
    TaskAssignmentsRepository,
    SubmissionsRepository,
    SubmissionVersionsRepository,
    InternshipProgrammeService,
    TaskService,
    InternshipApplicationService,
    InternshipEnrollmentService,
    SubmissionService,
    SubmissionReviewService,
    CompletionService,
    InternshipResourceResolver,
    SubmissionResourceResolver,
    CompletionResourceResolver,
  ],
  exports: [InternshipResourceResolver, SubmissionResourceResolver, CompletionResourceResolver],
})
export class InternshipModule {}
