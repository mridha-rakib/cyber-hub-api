import type { ArgumentsHost } from "@nestjs/common";
import {
  ConflictException,
  PermissionDeniedException,
  SecurityScopeNotAuthorizedException,
  StateVersionConflictException,
  WorkflowConflictException,
} from "../src/core/errors/app.exception";
import { ExceptionFilter } from "../src/core/errors/exception.filter";
import type { LoggerService } from "../src/core/logger/logger.service";
import { CareerListingService } from "../src/modules/career/services/career-listing.service";
import { EmployerOpportunityService } from "../src/modules/career/services/employer-opportunity.service";
import { ConsultingService } from "../src/modules/consulting/services/consulting.service";
import { InternshipApplicationService } from "../src/modules/internship/services/internship-application.service";
import { InternshipProgrammeService } from "../src/modules/internship/services/internship-programme.service";
import { SubmissionService } from "../src/modules/internship/services/submission.service";
import { SubmissionReviewService } from "../src/modules/internship/services/submission-review.service";

function stub<T>(members: Record<string, unknown>): T {
  return members as T;
}

describe("D-6 error contract", () => {
  it.each([
    [new WorkflowConflictException(), 409, "STATE_CONFLICT", undefined],
    [
      new StateVersionConflictException(7),
      409,
      "STATE_VERSION_CONFLICT",
      { currentStateVersion: 7 },
    ],
    [new SecurityScopeNotAuthorizedException(), 403, "SECURITY_SCOPE_NOT_AUTHORIZED", undefined],
    [new PermissionDeniedException(), 403, "FORBIDDEN", undefined],
    [new ConflictException(), 409, "CONFLICT", undefined],
  ])("serializes %s through the existing global envelope", (exception, status, code, details) => {
    const json = jest.fn();
    const response = { status: jest.fn().mockReturnValue({ json }) };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ requestId: "d6-request", method: "POST", path: "/test" }),
      }),
    } as unknown as ArgumentsHost;
    const logger = stub<LoggerService>({ warn: jest.fn(), error: jest.fn() });
    new ExceptionFilter(logger).catch(exception, host);
    expect(response.status).toHaveBeenCalledWith(status);
    expect(json).toHaveBeenCalledWith({
      error: { code, message: exception.message, ...(details ? { details } : {}) },
      requestId: "d6-request",
    });
  });

  const paths = [
    [
      "career",
      (repo: Record<string, unknown>) =>
        new CareerListingService(stub(repo), stub({})).startReview("id", 3),
    ],
    [
      "opportunity",
      (repo: Record<string, unknown>) =>
        new EmployerOpportunityService(stub(repo)).startReview("id", 3),
    ],
    [
      "programme",
      (repo: Record<string, unknown>) =>
        new InternshipProgrammeService(stub(repo), stub({})).publish("id", 3),
    ],
    [
      "application",
      (repo: Record<string, unknown>) =>
        new InternshipApplicationService(stub(repo), stub({}), stub({}), stub({})).startReview(
          "id",
          "reviewer",
          3,
        ),
    ],
    [
      "review",
      (repo: Record<string, unknown>) =>
        new SubmissionReviewService(stub(repo)).startReview("id", "reviewer", 3),
    ],
    [
      "submission",
      (repo: Record<string, unknown>) =>
        new SubmissionService(stub(repo), stub({}), stub({}), stub({})).resubmit("id", "owner", {
          expectedStateVersion: 3,
          evidenceText: "evidence",
        }),
    ],
    [
      "consulting",
      (repo: Record<string, unknown>) =>
        new ConsultingService(stub(repo), stub({}), stub({}), stub({}), stub({})).startReview(
          "id",
          3,
        ),
    ],
  ] as const;

  describe.each(paths)("%s CAS diagnostics", (_name, invoke) => {
    it.each([
      [3, "STATE_CONFLICT", undefined],
      [4, "STATE_VERSION_CONFLICT", { currentStateVersion: 4 }],
    ])(
      "distinguishes persisted version %s without another write",
      async (stateVersion, code, metadata) => {
        const repo = {
          findById: jest
            .fn()
            .mockResolvedValue({ stateVersion, userId: "owner", currentVersion: 1 }),
          transitionWithExtras: jest.fn().mockResolvedValue(null),
        };
        await expect(invoke(repo)).rejects.toMatchObject({ statusCode: 409, code, metadata });
        expect(repo.transitionWithExtras).toHaveBeenCalledTimes(1);
        // Resubmission reads ownership before CAS, then reads the latest version
        // again after failure; every other path already uses a post-CAS read.
        expect(repo.findById).toHaveBeenLastCalledWith("id");
      },
    );

    it("preserves missing-resource responses", async () => {
      await expect(
        invoke({
          findById: jest.fn().mockResolvedValue(null),
          transitionWithExtras: jest.fn().mockResolvedValue(null),
        }),
      ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
    });
  });

  it.each([3, 4])(
    "classifies blocked request completion at version %s without changing its predicate",
    async (stateVersion) => {
      const transitionWithExtras = jest.fn();
      const service = new ConsultingService(
        stub({
          hasOnlyCompletedLinkedWork: jest.fn().mockResolvedValue(false),
          findById: jest.fn().mockResolvedValue({ stateVersion }),
          transitionWithExtras,
        }),
        stub({}),
        stub({}),
        stub({}),
        stub({}),
      );
      await expect(service.complete("id", 3)).rejects.toMatchObject({
        statusCode: 409,
        code: stateVersion === 3 ? "STATE_CONFLICT" : "STATE_VERSION_CONFLICT",
      });
      expect(transitionWithExtras).not.toHaveBeenCalled();
    },
  );

  it("preserves concealed AUTH_SCOPE denial when scope is revoked between authorization and CAS", async () => {
    const service = new ConsultingService(
      stub({
        transitionWithExtras: jest.fn().mockResolvedValue(null),
        findById: jest.fn().mockResolvedValue({ stateVersion: 3, employerId: "employer" }),
      }),
      stub({}),
      stub({ getCurrent: jest.fn().mockResolvedValue(null) }),
      stub({}),
      stub({}),
    );
    await expect(service.startDelivery("id", 3)).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
      metadata: undefined,
    });
  });
});
