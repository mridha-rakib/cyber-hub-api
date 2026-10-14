import { businessAssessmentListQuerySchema } from "../../security-work/dto/security-work.dto";
import { assessmentClientView } from "../../security-work/services/security-work.service";
import { hasReportContent } from "../services/security-report.service";
import { reportSummaryView } from "../services/security-report.views";
import {
  reportCreateInputSchema,
  reportFindingMembershipInputSchema,
  reportListQuerySchema,
  reportReleaseInputSchema,
  reportSupersedeInputSchema,
  reportUpdateInputSchema,
} from "./security-report.dto";

const ID = "6f1d3d1e-2c4b-4c8e-9f1a-0b1c2d3e4f5a";

describe("Wave 6B report DTOs and projections (API Contract v1.3)", () => {
  it("accepts only the documented ReportCreateInput fields", () => {
    expect(reportCreateInputSchema.safeParse({ draftContent: {} }).success).toBe(true);
    expect(
      reportCreateInputSchema.safeParse({ draftContent: { a: 1 }, findingIds: [ID] }).success,
    ).toBe(true);
    for (const draftContent of [[], null, "x", 1, undefined])
      expect(reportCreateInputSchema.safeParse({ draftContent }).success).toBe(false);
    for (const field of ["status", "versionNo", "employerId", "preparedByUserId", "reportPath"])
      expect(reportCreateInputSchema.safeParse({ draftContent: {}, [field]: ID }).success).toBe(
        false,
      );
    expect(reportCreateInputSchema.safeParse({ draftContent: {}, findingIds: ["x"] }).success).toBe(
      false,
    );
  });

  it("requires expectedStateVersion on every versioned input and rejects extras", () => {
    expect(reportUpdateInputSchema.safeParse({ expectedStateVersion: 1 }).success).toBe(true);
    expect(reportUpdateInputSchema.safeParse({ draftContent: {} }).success).toBe(false);
    expect(reportUpdateInputSchema.safeParse({ expectedStateVersion: 0 }).success).toBe(false);
    expect(
      reportFindingMembershipInputSchema.safeParse({ expectedStateVersion: 1, findingIds: [] })
        .success,
    ).toBe(true);
    expect(reportFindingMembershipInputSchema.safeParse({ expectedStateVersion: 1 }).success).toBe(
      false,
    );
    expect(
      reportReleaseInputSchema.safeParse({ expectedStateVersion: 1, storedObjectId: ID }).success,
    ).toBe(true);
    expect(
      reportReleaseInputSchema.safeParse({ expectedStateVersion: 1, storedObjectId: "x" }).success,
    ).toBe(false);
    expect(
      reportSupersedeInputSchema.safeParse({ expectedStateVersion: 1, replacementReportId: ID })
        .success,
    ).toBe(true);
    expect(
      reportSupersedeInputSchema.safeParse({
        expectedStateVersion: 1,
        replacementReportId: ID,
        status: "SUPERSEDED",
      }).success,
    ).toBe(false);
  });

  it("drops prototype keys from draft content", () => {
    const parsed = reportCreateInputSchema.parse(
      JSON.parse('{"draftContent":{"__proto__":{"polluted":true},"summary":"s"}}'),
    );
    expect(Object.keys(parsed.draftContent)).toEqual(["summary"]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("treats only a JSON object with at least one property as reviewable content", () => {
    expect(hasReportContent({ summary: "x" })).toBe(true);
    for (const value of [{}, [], ["x"], null, "x", 0]) expect(hasReportContent(value)).toBe(false);
  });

  it("keeps list queries strict with default 25 / max 100 and no employer filter", () => {
    expect(reportListQuerySchema.parse({}).limit).toBe(25);
    expect(businessAssessmentListQuerySchema.parse({}).limit).toBe(25);
    for (const query of [{ limit: "101" }, { employerId: ID }, { service: "X" }, { cursor: "x" }]) {
      expect(reportListQuerySchema.safeParse(query).success).toBe(false);
      expect(businessAssessmentListQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it("projects only the approved client and operational summary fields", () => {
    const row = {
      id: ID,
      service: "VULNERABILITY_ASSESSMENT" as const,
      status: "COMPLETED" as const,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      employerId: ID,
      scopeSnapshot: { secret: true },
      stateVersion: 3,
    };
    expect(Object.keys(assessmentClientView(row)).sort()).toEqual(
      ["completedAt", "createdAt", "id", "service", "startedAt", "status"].sort(),
    );
    const summary = reportSummaryView({
      id: ID,
      assessmentId: ID,
      status: "DRAFT",
      versionNo: 1,
      stateVersion: 1,
      supersedesReportId: null,
      releasedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...{ draftContent: { secret: true }, reportPath: "p", employerId: ID },
    } as Parameters<typeof reportSummaryView>[0]);
    expect(Object.keys(summary).sort()).toEqual(
      [
        "assessmentId",
        "createdAt",
        "id",
        "releasedAt",
        "stateVersion",
        "status",
        "supersedesReportId",
        "updatedAt",
        "versionNo",
      ].sort(),
    );
  });
});
