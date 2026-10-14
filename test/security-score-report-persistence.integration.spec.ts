import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import { eq, sql } from "drizzle-orm";
import { DatabaseModule } from "../src/core/database/database.module";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { LoggerModule } from "../src/core/logger/logger.module";
import {
  consultingRequests,
  employers,
  securityAssessments,
  securityReportFindings,
  securityReports,
  securityScopeAuthorizations,
  securityScores,
  users,
  vulnerabilityFindings,
} from "../src/infrastructure/database/schema";

/**
 * Wave 6A. Real PostgreSQL verification of the ERD v2.2 §7.32-7.34
 * persistence foundation: insert-only score history, report versioning and
 * lineage, report-finding membership as live references, FK/enum/CHECK
 * integrity and governed (non-cascading) deletes. Report lifecycle commands,
 * D6-5 guards, supersede execution and Business visibility reads are
 * Wave 6B/6C and are deliberately not exercised here.
 */
describe("Wave 6A security score + report persistence — real PostgreSQL", () => {
  let moduleRef: TestingModule;
  let db: DatabaseConnection["db"];

  const TEST_DOMAIN = "wave6a-score-report.test";
  let counter = 0;
  const uniqueEmail = (label: string) => `${label}-${Date.now()}-${counter++}@${TEST_DOMAIN}`;
  const testEmployers = sql`select id from employers where email like ${`%@${TEST_DOMAIN}`}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, DatabaseModule],
    }).compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION).db;
  });

  afterAll(async () => {
    await db.execute(sql`delete from security_report_findings where report_id in
      (select id from security_reports where employer_id in (${testEmployers}))`);
    // One statement removes lineage rows together, so NO ACTION is satisfied.
    await db.execute(sql`delete from security_reports where employer_id in (${testEmployers})`);
    await db.execute(sql`delete from security_scores where employer_id in (${testEmployers})`);
    await db.execute(
      sql`delete from vulnerability_findings where employer_id in (${testEmployers})`,
    );
    await db.execute(sql`delete from security_assessments where employer_id in (${testEmployers})`);
    await db.execute(
      sql`delete from security_scope_authorizations where employer_id in (${testEmployers})`,
    );
    await db.execute(sql`delete from consulting_requests where employer_id in (${testEmployers})`);
    await db.execute(sql`delete from users where email like ${`%@${TEST_DOMAIN}`}`);
    await db.execute(sql`delete from employers where email like ${`%@${TEST_DOMAIN}`}`);
    await moduleRef.close();
  });

  async function expectRejectionMatching(promise: Promise<unknown>, pattern: RegExp) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const messages: string[] = [];
    let current: unknown = caught;
    while (current instanceof Error) {
      messages.push(current.message);
      current = (current as { cause?: unknown }).cause;
    }
    expect(messages.some((message) => pattern.test(message))).toBe(true);
  }

  async function seedUser(
    label: string,
    role: "ROLE_BUSINESS" | "ROLE_CONSULTANT" | "ROLE_ADMIN",
    employerId: string | null,
  ) {
    const email = uniqueEmail(label);
    const [user] = await db
      .insert(users)
      .values({
        name: label,
        email,
        emailNormalized: email.toLowerCase(),
        passwordHash: "not-a-real-hash",
        role,
        employerId,
      })
      .returning({ id: users.id });
    return user.id;
  }

  /** Employer + assigned request + scope + COMPLETED assessment + one finding. */
  async function seedContext(label: string) {
    const [employer] = await db
      .insert(employers)
      .values({
        companyName: `${label} Ltd`,
        email: uniqueEmail(`${label}-employer`),
        status: "ACTIVE",
      })
      .returning({ id: employers.id });
    const businessId = await seedUser(`${label}-business`, "ROLE_BUSINESS", employer.id);
    const consultantId = await seedUser(`${label}-consultant`, "ROLE_CONSULTANT", null);
    const adminId = await seedUser(`${label}-admin`, "ROLE_ADMIN", null);
    const [request] = await db
      .insert(consultingRequests)
      .values({
        employerId: employer.id,
        submittedByUserId: businessId,
        companyDetails: { name: `${label} Ltd` },
        businessSize: "SMALL",
        securityConcern: "Public web exposure",
        requestedService: "WEBSITE_ASSESSMENT",
        contactInformation: { email: "security@example.test" },
        status: "IN_PROGRESS",
        assignedConsultantId: consultantId,
      })
      .returning({ id: consultingRequests.id });
    const [scope] = await db
      .insert(securityScopeAuthorizations)
      .values({
        consultingRequestId: request.id,
        employerId: employer.id,
        versionNo: 1,
        authorizedTargets: ["app.example.test"],
        allowedActivities: ["WEBSITE_ASSESSMENT"],
        confirmedByUserId: businessId,
        confirmedAt: new Date(),
        validFrom: new Date(Date.now() - 60_000),
      })
      .returning({ id: securityScopeAuthorizations.id });
    const [assessment] = await db
      .insert(securityAssessments)
      .values({
        employerId: employer.id,
        consultingRequestId: request.id,
        scopeAuthorizationId: scope.id,
        service: "WEBSITE_ASSESSMENT",
        scopeSnapshot: { targets: ["app.example.test"] },
        assignedConsultantId: consultantId,
        status: "COMPLETED",
      })
      .returning({ id: securityAssessments.id });
    const finding = await seedFinding(assessment.id, employer.id, consultantId);
    return {
      employerId: employer.id,
      consultantId,
      adminId,
      assessmentId: assessment.id,
      findingId: finding.id,
    };
  }

  async function seedFinding(assessmentId: string, employerId: string, authorId: string) {
    const [finding] = await db
      .insert(vulnerabilityFindings)
      .values({
        assessmentId,
        employerId,
        title: "Outdated TLS configuration",
        severity: "HIGH",
        recommendation: "Disable TLS 1.0/1.1 on the public endpoint.",
        status: "OPEN",
        createdByUserId: authorId,
      })
      .returning({ id: vulnerabilityFindings.id });
    return finding;
  }

  async function seedReport(
    context: { assessmentId: string; employerId: string; consultantId: string },
    overrides: Partial<typeof securityReports.$inferInsert> = {},
  ) {
    const [report] = await db
      .insert(securityReports)
      .values({
        assessmentId: context.assessmentId,
        employerId: context.employerId,
        draftContent: { executiveSummary: "Summary", sections: [{ heading: "Findings" }] },
        status: "DRAFT",
        versionNo: 1,
        preparedByUserId: context.consultantId,
        ...overrides,
      })
      .returning();
    return report;
  }

  // ---------------------------------------------------------------- scores

  it("keeps insert-only score snapshot history: many rows per assessment, no state_version", async () => {
    const context = await seedContext("score-history");
    const rows = await db
      .insert(securityScores)
      .values([
        {
          employerId: context.employerId,
          assessmentId: context.assessmentId,
          overallScore: "72.50",
          websiteSecurityScore: "80.00",
          methodologyVersion: "test-methodology-a",
          calculatedByUserId: context.consultantId,
        },
        {
          employerId: context.employerId,
          assessmentId: context.assessmentId,
          overallScore: "75.25",
          methodologyVersion: "test-methodology-a",
        },
      ])
      .returning();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      overallScore: "72.50",
      websiteSecurityScore: "80.00",
      networkSecurityScore: null,
      backupRecoveryScore: null,
      calculatedByUserId: context.consultantId,
    });
    expect(rows[1].calculatedByUserId).toBeNull();
    expect(rows[0].calculatedAt).toBeInstanceOf(Date);
    expect(Object.keys(rows[0])).not.toContain("stateVersion");

    const history = await db
      .select({ id: securityScores.id })
      .from(securityScores)
      .where(eq(securityScores.assessmentId, context.assessmentId));
    expect(history).toHaveLength(2);
  });

  it("bounds overall and category scores to 0-100 and accepts both boundaries", async () => {
    const context = await seedContext("score-range");
    const insert = (overall: string, cloud: string | null = null) =>
      db.execute(sql`insert into security_scores
        (employer_id, assessment_id, overall_score, cloud_security_score, methodology_version)
        values (${context.employerId}, ${context.assessmentId}, ${overall}, ${cloud}, 'test-methodology-a')`);
    await insert("0");
    await insert("100", "100");
    await expectRejectionMatching(insert("100.01"), /security_scores_overall_score_check/);
    await expectRejectionMatching(insert("-0.01"), /security_scores_overall_score_check/);
    await expectRejectionMatching(
      insert("50", "101"),
      /security_scores_cloud_security_score_check/,
    );
  });

  it("requires overall_score and methodology_version", async () => {
    const context = await seedContext("score-required");
    for (const column of ["overall_score", "methodology_version"]) {
      await expectRejectionMatching(
        db.execute(sql`insert into security_scores
          (employer_id, assessment_id, overall_score, methodology_version)
          values (${context.employerId}, ${context.assessmentId},
                  ${column === "overall_score" ? null : "10"},
                  ${column === "methodology_version" ? null : "test-methodology-a"})`),
        new RegExp(`null value in column "${column}"`),
      );
    }
  });

  it("rejects scores whose employer, assessment or calculating user does not exist", async () => {
    const context = await seedContext("score-fk");
    const insert = (overrides: Record<string, string>) =>
      db.execute(sql`insert into security_scores
        (employer_id, assessment_id, overall_score, methodology_version, calculated_by_user_id)
        values (${overrides.employerId ?? context.employerId},
                ${overrides.assessmentId ?? context.assessmentId}, '10', 'test-methodology-a',
                ${overrides.calculatedByUserId ?? context.consultantId})`);
    await expectRejectionMatching(
      insert({ employerId: randomUUID() }),
      /security_scores_employer_id_employers_id_fk/,
    );
    await expectRejectionMatching(
      insert({ assessmentId: randomUUID() }),
      /security_scores_assessment_id_security_assessments_id_fk/,
    );
    await expectRejectionMatching(
      insert({ calculatedByUserId: randomUUID() }),
      /security_scores_calculated_by_user_id_users_id_fk/,
    );
  });

  // --------------------------------------------------------------- reports

  it("persists a DRAFT report with state_version 1, JSON draft content and no release metadata", async () => {
    const context = await seedContext("report-draft");
    const report = await seedReport(context);
    expect(report).toMatchObject({
      assessmentId: context.assessmentId,
      employerId: context.employerId,
      draftContent: { executiveSummary: "Summary", sections: [{ heading: "Findings" }] },
      status: "DRAFT",
      stateVersion: 1,
      versionNo: 1,
      reportPath: null,
      supersedesReportId: null,
      preparedByUserId: context.consultantId,
      reviewedByUserId: null,
      releasedByUserId: null,
      generatedAt: null,
      releasedAt: null,
    });
    expect(report.createdAt).toBeInstanceOf(Date);
    expect(report.updatedAt).toBeInstanceOf(Date);
    for (const forbidden of ["clientContent", "clientVisible", "isVisible", "published"]) {
      expect(Object.keys(report)).not.toContain(forbidden);
    }
  });

  it("enforces UNIQUE(assessment_id, version_no) per assessment and version_no >= 1", async () => {
    const first = await seedContext("report-version-a");
    const second = await seedContext("report-version-b");
    await seedReport(first, { versionNo: 1 });
    await seedReport(first, { versionNo: 2 });
    // Version numbers are per assessment, not global.
    await seedReport(second, { versionNo: 1 });
    await expectRejectionMatching(
      seedReport(first, { versionNo: 2 }),
      /security_reports_assessment_version_key/,
    );
    await expectRejectionMatching(
      seedReport(first, { versionNo: 0 }),
      /security_reports_version_no_check/,
    );
  });

  it("requires draft_content, status, version_no and preparer; rejects undocumented statuses", async () => {
    const context = await seedContext("report-required");
    const insert = (column: string) =>
      db.execute(sql`insert into security_reports
        (assessment_id, employer_id, draft_content, status, version_no, prepared_by_user_id)
        values (${context.assessmentId}, ${context.employerId},
                ${column === "draft_content" ? null : JSON.stringify({ summary: "x" })}::jsonb,
                ${column === "status" ? null : "DRAFT"}::report_status,
                ${column === "version_no" ? null : 1},
                ${column === "prepared_by_user_id" ? null : context.consultantId})`);
    for (const column of ["draft_content", "status", "version_no", "prepared_by_user_id"]) {
      await expectRejectionMatching(insert(column), new RegExp(`null value in column "${column}"`));
    }
    await expectRejectionMatching(
      db.execute(sql`insert into security_reports
        (assessment_id, employer_id, draft_content, status, version_no, prepared_by_user_id)
        values (${context.assessmentId}, ${context.employerId}, '{}'::jsonb, 'APPROVED', 1,
                ${context.consultantId})`),
      /invalid input value for enum report_status/i,
    );
  });

  it("rejects reports whose assessment, employer, actors or predecessor do not exist", async () => {
    const context = await seedContext("report-fk");
    const insert = (overrides: Record<string, string>) =>
      db.execute(sql`insert into security_reports
        (assessment_id, employer_id, draft_content, status, version_no, prepared_by_user_id,
         reviewed_by_user_id, released_by_user_id, supersedes_report_id)
        values (${overrides.assessmentId ?? context.assessmentId},
                ${overrides.employerId ?? context.employerId}, '{}'::jsonb, 'DRAFT',
                ${counter++ + 10},
                ${overrides.preparedByUserId ?? context.consultantId},
                ${overrides.reviewedByUserId ?? null}, ${overrides.releasedByUserId ?? null},
                ${overrides.supersedesReportId ?? null})`);
    await expectRejectionMatching(
      insert({ assessmentId: randomUUID() }),
      /security_reports_assessment_id_security_assessments_id_fk/,
    );
    await expectRejectionMatching(
      insert({ employerId: randomUUID() }),
      /security_reports_employer_id_employers_id_fk/,
    );
    await expectRejectionMatching(
      insert({ preparedByUserId: randomUUID() }),
      /security_reports_prepared_by_user_id_users_id_fk/,
    );
    await expectRejectionMatching(
      insert({ reviewedByUserId: randomUUID() }),
      /security_reports_reviewed_by_user_id_users_id_fk/,
    );
    await expectRejectionMatching(
      insert({ releasedByUserId: randomUUID() }),
      /security_reports_released_by_user_id_users_id_fk/,
    );
    await expectRejectionMatching(
      insert({ supersedesReportId: randomUUID() }),
      /security_reports_supersedes_report_id_security_reports_id_fk/,
    );
  });

  it("stores supersede lineage as a self-reference and never supersedes automatically (D6-8)", async () => {
    const context = await seedContext("report-lineage");
    const released = { reviewedByUserId: context.consultantId, releasedByUserId: context.adminId };
    const v1 = await seedReport(context, {
      versionNo: 1,
      status: "RELEASED",
      releasedAt: new Date(),
      ...released,
    });
    const v2 = await seedReport(context, {
      versionNo: 2,
      status: "RELEASED",
      releasedAt: new Date(),
      supersedesReportId: v1.id,
      ...released,
    });
    expect(v2.supersedesReportId).toBe(v1.id);

    // Temporary coexistence of two RELEASED versions is schema-valid; the
    // older row is untouched until an explicit API-RPT-009 command (Wave 6B).
    const rows = await db
      .select({
        id: securityReports.id,
        status: securityReports.status,
        stateVersion: securityReports.stateVersion,
      })
      .from(securityReports)
      .where(eq(securityReports.assessmentId, context.assessmentId));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "RELEASED" && row.stateVersion === 1)).toBe(true);

    // Lineage protects history: a referenced predecessor cannot be deleted.
    await expectRejectionMatching(
      db.execute(sql`delete from security_reports where id = ${v1.id}`),
      /security_reports_supersedes_report_id_security_reports_id_fk/,
    );
  });

  it("makes report_path unique only when present", async () => {
    const context = await seedContext("report-path");
    await seedReport(context, { versionNo: 1 });
    await seedReport(context, { versionNo: 2 });
    const path = `/reports/${randomUUID()}`;
    await seedReport(context, { versionNo: 3, reportPath: path });
    await expectRejectionMatching(
      seedReport(context, { versionNo: 4, reportPath: path }),
      /security_reports_report_path_unique/,
    );
  });

  // ------------------------------------------------- report-finding membership

  it("stores membership as live references with default ordering and no copied content (D6-7)", async () => {
    const context = await seedContext("membership");
    const report = await seedReport(context);
    const second = await seedFinding(
      context.assessmentId,
      context.employerId,
      context.consultantId,
    );
    const [first] = await db
      .insert(securityReportFindings)
      .values({ reportId: report.id, findingId: context.findingId })
      .returning();
    expect(Object.keys(first).sort()).toEqual(["findingId", "includedAt", "reportId", "sortOrder"]);
    expect(first.sortOrder).toBe(0);
    expect(first.includedAt).toBeInstanceOf(Date);
    await db
      .insert(securityReportFindings)
      .values({ reportId: report.id, findingId: second.id, sortOrder: 1 });

    // A later finding change is visible through the membership join.
    await db
      .update(vulnerabilityFindings)
      .set({ status: "RESOLVED", resolvedAt: new Date() })
      .where(eq(vulnerabilityFindings.id, context.findingId));
    const joined = await db
      .select({ findingId: securityReportFindings.findingId, status: vulnerabilityFindings.status })
      .from(securityReportFindings)
      .innerJoin(
        vulnerabilityFindings,
        eq(vulnerabilityFindings.id, securityReportFindings.findingId),
      )
      .where(eq(securityReportFindings.reportId, report.id))
      .orderBy(securityReportFindings.sortOrder);
    expect(joined).toEqual([
      { findingId: context.findingId, status: "RESOLVED" },
      { findingId: second.id, status: "OPEN" },
    ]);
  });

  it("rejects duplicate membership and unknown reports or findings", async () => {
    const context = await seedContext("membership-keys");
    const report = await seedReport(context);
    await db
      .insert(securityReportFindings)
      .values({ reportId: report.id, findingId: context.findingId });
    await expectRejectionMatching(
      db
        .insert(securityReportFindings)
        .values({ reportId: report.id, findingId: context.findingId }),
      /security_report_findings_report_id_finding_id_pk/,
    );
    await expectRejectionMatching(
      db
        .insert(securityReportFindings)
        .values({ reportId: randomUUID(), findingId: context.findingId }),
      /security_report_findings_report_id_security_reports_id_fk/,
    );
    // PostgreSQL truncates this generated name to 63 characters (as for other existing FKs).
    await expectRejectionMatching(
      db.insert(securityReportFindings).values({ reportId: report.id, findingId: randomUUID() }),
      /security_report_findings_finding_id_vulnerability_findings_id_f/,
    );
  });

  it("protects governed history: no cascade from reports, findings or assessments", async () => {
    const context = await seedContext("history");
    const report = await seedReport(context);
    await db
      .insert(securityReportFindings)
      .values({ reportId: report.id, findingId: context.findingId });
    await db.insert(securityScores).values({
      employerId: context.employerId,
      assessmentId: context.assessmentId,
      overallScore: "60.00",
      methodologyVersion: "test-methodology-a",
    });
    await expectRejectionMatching(
      db.execute(sql`delete from security_reports where id = ${report.id}`),
      /security_report_findings_report_id_security_reports_id_fk/,
    );
    await expectRejectionMatching(
      db.execute(sql`delete from vulnerability_findings where id = ${context.findingId}`),
      /security_report_findings_finding_id_vulnerability_findings_id_f/,
    );
    await expectRejectionMatching(
      db.execute(sql`delete from security_assessments where id = ${context.assessmentId}`),
      /(security_scores|security_reports|vulnerability_findings)_assessment_id_security_assessments_id_fk/,
    );
  });

  // ------------------------------------------------------- relations + metadata

  it("resolves the new Drizzle relations", async () => {
    const context = await seedContext("relations");
    const v1 = await seedReport(context, { versionNo: 1 });
    const v2 = await seedReport(context, { versionNo: 2, supersedesReportId: v1.id });
    await db
      .insert(securityReportFindings)
      .values({ reportId: v2.id, findingId: context.findingId });
    await db.insert(securityScores).values({
      employerId: context.employerId,
      assessmentId: context.assessmentId,
      overallScore: "55.00",
      methodologyVersion: "test-methodology-a",
      calculatedByUserId: context.adminId,
    });

    const report = await db.query.securityReports.findFirst({
      where: eq(securityReports.id, v2.id),
      with: {
        assessment: { columns: { id: true } },
        preparedByUser: { columns: { id: true } },
        supersedesReport: { columns: { id: true } },
        findings: { with: { finding: { columns: { id: true } } } },
      },
    });
    expect(report?.assessment.id).toBe(context.assessmentId);
    expect(report?.preparedByUser.id).toBe(context.consultantId);
    expect(report?.supersedesReport?.id).toBe(v1.id);
    expect(report?.findings.map((membership) => membership.finding.id)).toEqual([
      context.findingId,
    ]);

    const predecessor = await db.query.securityReports.findFirst({
      where: eq(securityReports.id, v1.id),
      with: { supersededByReports: { columns: { id: true } } },
    });
    expect(predecessor?.supersededByReports.map((row) => row.id)).toEqual([v2.id]);

    const assessment = await db.query.securityAssessments.findFirst({
      where: eq(securityAssessments.id, context.assessmentId),
      with: { scores: { with: { calculatedByUser: { columns: { id: true } } } }, reports: true },
    });
    expect(assessment?.scores.map((score) => score.calculatedByUser?.id)).toEqual([
      context.adminId,
    ]);
    expect(assessment?.reports).toHaveLength(2);
  });

  it("matches ERD v2.2 in PostgreSQL metadata and adds no forbidden columns", async () => {
    const enumRows = await db.execute<{ label: string }>(sql`
      select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'report_status' order by e.enumsortorder`);
    expect(enumRows.rows.map((row) => row.label)).toEqual([
      "DRAFT",
      "IN_REVIEW",
      "READY_FOR_RELEASE",
      "RELEASED",
      "SUPERSEDED",
    ]);

    const columnRows = await db.execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('security_scores', 'security_reports', 'security_report_findings',
                           'vulnerability_findings')`);
    const forbidden =
      /visib|published|released_flag|is_current|client_content|snapshot|score_visible/;
    expect(columnRows.rows.filter((row) => forbidden.test(row.column_name))).toEqual([]);

    const storage = await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = 'stored_objects'`);
    expect(storage.rows).toEqual([]);

    const indexRows = await db.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes
      where tablename in ('security_scores', 'security_reports', 'security_report_findings')`);
    const definitions = new Map(indexRows.rows.map((row) => [row.indexname, row.indexdef]));
    expect(definitions.get("security_scores_employer_calculated_desc_idx")).toContain(
      "(employer_id, calculated_at DESC",
    );
    expect(definitions.get("security_scores_assessment_calculated_desc_idx")).toContain(
      "(assessment_id, calculated_at DESC",
    );
    expect(definitions.get("security_scores_methodology_version_idx")).toContain(
      "(methodology_version)",
    );
    expect(definitions.get("security_reports_employer_status_released_desc_idx")).toContain(
      "(employer_id, status, released_at DESC",
    );
    expect(definitions.get("security_reports_prepared_by_status_idx")).toContain(
      "(prepared_by_user_id, status)",
    );
    expect(definitions.get("security_reports_report_path_unique")).toContain(
      "WHERE (report_path IS NOT NULL)",
    );
    expect(definitions.get("security_reports_assessment_version_key")).toContain(
      "(assessment_id, version_no)",
    );
    expect(definitions.get("security_report_findings_report_sort_order_idx")).toContain(
      "(report_id, sort_order)",
    );
    expect(definitions.get("security_report_findings_finding_id_idx")).toContain("(finding_id)");
  });
});
