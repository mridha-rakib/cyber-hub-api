import { DatabaseException } from "../../core/errors/app.exception";
import { reportClientView } from "../security-report/services/business-report.service";
import { findingClientView } from "../security-work/finding-client-view";
import {
  businessFindingListQuerySchema,
  businessScoreListQuerySchema,
  operationalScoreListQuerySchema,
  scoreCalculateInputSchema,
} from "./dto/security-score.dto";
import { type ScoreViewRow, scoreNumber, scoreView } from "./security-score.views";

const row = (overrides: Partial<ScoreViewRow> = {}): ScoreViewRow => ({
  id: "s",
  assessmentId: "a",
  overallScore: "87.50",
  websiteSecurityScore: null,
  networkSecurityScore: null,
  emailSecurityScore: null,
  authenticationSecurityScore: null,
  employeeAwarenessScore: null,
  cloudSecurityScore: null,
  backupRecoveryScore: null,
  methodologyVersion: "m",
  calculatedAt: new Date(0),
  ...overrides,
});

describe("Wave 6C client-safe projections (API Contract v1.4)", () => {
  it("serializes numeric(5,2) scores as exactly equivalent JSON numbers (D6C-3)", () => {
    expect(scoreNumber("0.00")).toBe(0);
    expect(scoreNumber("100.00")).toBe(100);
    expect(scoreNumber("87.50")).toBe(87.5);
    expect(scoreNumber("0.01")).toBe(0.01);
    expect(scoreNumber("99.99")).toBe(99.99);
    expect(scoreNumber(null)).toBeNull();
    for (let cents = 0; cents <= 10_000; cents++) {
      const text = (cents / 100).toFixed(2);
      expect(scoreNumber(text).toFixed(2)).toBe(text);
    }
    for (const bad of ["100.01", "-1.00", "NaN", "Infinity", "1e2", "", "abc"])
      expect(() => scoreNumber(bad)).toThrow(DatabaseException);
  });

  it("keeps nullable categories null, never zero, and exposes only SecurityScoreView keys", () => {
    const all = scoreView(
      row({
        overallScore: "0.00",
        websiteSecurityScore: "10.00",
        networkSecurityScore: "20.50",
        emailSecurityScore: "30.25",
        authenticationSecurityScore: "40.00",
        employeeAwarenessScore: "50.00",
        cloudSecurityScore: "60.00",
        backupRecoveryScore: "70.00",
      }),
    );
    expect(all).toMatchObject({
      overallScore: 0,
      networkSecurityScore: 20.5,
      emailSecurityScore: 30.25,
    });
    expect(JSON.parse(JSON.stringify(all)).overallScore).toBe(0);
    const partial = scoreView(row());
    expect(partial.websiteSecurityScore).toBeNull();
    expect(Object.keys(partial).sort()).toEqual(
      [
        "assessmentId",
        "authenticationSecurityScore",
        "backupRecoveryScore",
        "calculatedAt",
        "cloudSecurityScore",
        "emailSecurityScore",
        "employeeAwarenessScore",
        "id",
        "methodologyVersion",
        "networkSecurityScore",
        "overallScore",
        "websiteSecurityScore",
      ].sort(),
    );
  });

  it("projects FindingClientView with resolvedAt only while RESOLVED", () => {
    const base = {
      id: "f",
      title: "t",
      severity: "HIGH" as const,
      recommendation: "r",
      resolvedAt: null,
      createdAt: new Date(0),
    };
    expect(Object.keys(findingClientView({ ...base, status: "OPEN" })).sort()).toEqual(
      ["createdAt", "id", "recommendation", "severity", "status", "title"].sort(),
    );
    const resolved = findingClientView({ ...base, status: "RESOLVED", resolvedAt: new Date(1) });
    expect(resolved.resolvedAt).toEqual(new Date(1));
  });

  it("projects SecurityReportClientView with downloadAvailable false while GAP-013 is open", () => {
    const view = reportClientView({
      id: "r",
      assessmentId: "a",
      status: "RELEASED",
      versionNo: 1,
      releasedAt: new Date(0),
      createdAt: new Date(0),
    });
    expect(view).toEqual({
      id: "r",
      assessmentId: "a",
      status: "RELEASED",
      versionNo: 1,
      releasedAt: new Date(0),
      downloadAvailable: false,
    });
  });

  it("validates Wave 6C inputs strictly", () => {
    expect(scoreCalculateInputSchema.safeParse({ methodologyVersion: "v1" }).success).toBe(true);
    for (const body of [
      {},
      { methodologyVersion: " " },
      { methodologyVersion: "v1", overallScore: 1 },
    ])
      expect(scoreCalculateInputSchema.safeParse(body).success).toBe(false);
    expect(businessFindingListQuerySchema.parse({}).limit).toBe(25);
    for (const query of [
      { employerId: "x" },
      { severity: "INFO" },
      { limit: "101" },
      { cursor: "x" },
    ])
      expect(businessFindingListQuerySchema.safeParse(query).success).toBe(false);
    for (const schema of [businessScoreListQuerySchema, operationalScoreListQuerySchema]) {
      expect(schema.parse({}).limit).toBe(25);
      expect(schema.safeParse({ employerId: "x" }).success).toBe(false);
    }
  });
});
