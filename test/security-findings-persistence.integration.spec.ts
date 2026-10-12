import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseModule } from "../src/core/database/database.module";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { LoggerModule } from "../src/core/logger/logger.module";
import { FindingWorkflowService } from "../src/core/workflow/finding-workflow.service";
import { WorkflowModule } from "../src/core/workflow/workflow.module";
import { workflowConflictForCas } from "../src/core/workflow/workflow-helper";
import {
  consultingRequests,
  employers,
  securityAssessments,
  securityScopeAuthorizations,
  users,
  vulnerabilityFindings,
} from "../src/infrastructure/database/schema";

/**
 * Wave 5A. Real PostgreSQL verification of the ERD §7.31
 * vulnerability_findings persistence foundation: FK integrity, enum and
 * NOT NULL constraints, state_version CAS behaviour (WF-FND), governed
 * delete protection, and the ORG/ASG context Wave 5B authorization reads.
 */
describe("Wave 5A security findings persistence — real PostgreSQL", () => {
  let moduleRef: TestingModule;
  let db: DatabaseConnection["db"];
  let findingWorkflow: FindingWorkflowService;

  const TEST_DOMAIN = "wave5a-findings.test";
  let counter = 0;
  const uniqueEmail = (label: string) => `${label}-${Date.now()}-${counter++}@${TEST_DOMAIN}`;
  const testEmployers = sql`select id from employers where email like ${`%@${TEST_DOMAIN}`}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, DatabaseModule, WorkflowModule],
    }).compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION).db;
    findingWorkflow = moduleRef.get(FindingWorkflowService);
  });

  afterAll(async () => {
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
    role: "ROLE_BUSINESS" | "ROLE_CONSULTANT",
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

  /** Accepted, assigned request + current scope + PLANNED assessment for one employer. */
  async function seedAssessment(label: string) {
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
        status: "ACCEPTED",
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
        status: "PLANNED",
      })
      .returning({ id: securityAssessments.id });
    return {
      employerId: employer.id,
      consultantId,
      scopeId: scope.id,
      assessmentId: assessment.id,
    };
  }

  async function seedFinding(
    context: { employerId: string; consultantId: string; assessmentId: string },
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = "HIGH",
  ) {
    const [finding] = await db
      .insert(vulnerabilityFindings)
      .values({
        assessmentId: context.assessmentId,
        employerId: context.employerId,
        title: "Outdated TLS configuration",
        severity,
        recommendation: "Disable TLS 1.0/1.1 on the public endpoint.",
        status: "OPEN",
        createdByUserId: context.consultantId,
      })
      .returning();
    return finding;
  }

  it("persists an OPEN finding linked to its assessment with state_version 1 and no resolution", async () => {
    const context = await seedAssessment("create");
    const finding = await seedFinding(context, "CRITICAL");
    expect(finding).toMatchObject({
      assessmentId: context.assessmentId,
      employerId: context.employerId,
      severity: "CRITICAL",
      status: "OPEN",
      stateVersion: 1,
      resolvedAt: null,
      description: null,
      evidenceSummary: null,
      createdByUserId: context.consultantId,
    });
    expect(finding.createdAt).toBeInstanceOf(Date);
    expect(finding.updatedAt).toBeInstanceOf(Date);
  });

  it("rejects findings whose assessment, employer or author does not exist", async () => {
    const context = await seedAssessment("fk");
    const insert = (overrides: Record<string, string>) =>
      db.execute(sql`insert into vulnerability_findings
        (assessment_id, employer_id, title, severity, recommendation, status, created_by_user_id)
        values (${overrides.assessmentId ?? context.assessmentId},
                ${overrides.employerId ?? context.employerId},
                'Title', 'LOW', 'Fix it', 'OPEN',
                ${overrides.createdByUserId ?? context.consultantId})`);
    await expectRejectionMatching(
      insert({ assessmentId: randomUUID() }),
      /vulnerability_findings_assessment_id_security_assessments_id_fk/,
    );
    await expectRejectionMatching(
      insert({ employerId: randomUUID() }),
      /vulnerability_findings_employer_id_employers_id_fk/,
    );
    await expectRejectionMatching(
      insert({ createdByUserId: randomUUID() }),
      /vulnerability_findings_created_by_user_id_users_id_fk/,
    );
  });

  it("rejects values outside the exact severity and status enums, validated independently", async () => {
    const context = await seedAssessment("enum");
    const insert = (severity: string, status: string) =>
      db.execute(sql`insert into vulnerability_findings
        (assessment_id, employer_id, title, severity, recommendation, status, created_by_user_id)
        values (${context.assessmentId}, ${context.employerId}, 'Title', ${severity}, 'Fix it',
                ${status}, ${context.consultantId})`);
    await expectRejectionMatching(
      insert("INFORMATIONAL", "OPEN"),
      /invalid input value for enum finding_severity/i,
    );
    await expectRejectionMatching(
      insert("LOW", "CLOSED"),
      /invalid input value for enum finding_status/i,
    );
  });

  it("rejects findings missing source-required title, recommendation or status", async () => {
    const context = await seedAssessment("required");
    for (const column of ["title", "recommendation", "status"]) {
      await expectRejectionMatching(
        db.execute(sql`insert into vulnerability_findings
          (assessment_id, employer_id, title, severity, recommendation, status, created_by_user_id)
          values (${context.assessmentId}, ${context.employerId},
                  ${column === "title" ? null : "Title"}, 'LOW',
                  ${column === "recommendation" ? null : "Fix it"},
                  ${column === "status" ? null : "OPEN"}, ${context.consultantId})`),
        new RegExp(`null value in column "${column}"`),
      );
    }
  });

  it("protects governed history: an assessment with findings cannot be deleted", async () => {
    const context = await seedAssessment("restrict");
    await seedFinding(context);
    await expectRejectionMatching(
      db.execute(sql`delete from security_assessments where id = ${context.assessmentId}`),
      /vulnerability_findings_assessment_id_security_assessments_id_fk/,
    );
  });

  it("runs WF-FND transitions as state_version compare-and-set updates", async () => {
    const context = await seedAssessment("cas");
    const finding = await seedFinding(context);

    const started = await findingWorkflow.transition({
      resourceId: finding.id,
      transitionIds: ["WF-FND-02"],
      expectedStateVersion: 1,
    });
    expect(started).toEqual({
      outcome: "UPDATED",
      toState: "REMEDIATION_IN_PROGRESS",
      newVersion: 2,
    });

    // A stale actor still holding version 1 cannot overwrite the first change.
    const stale = await findingWorkflow.transition({
      resourceId: finding.id,
      transitionIds: ["WF-FND-03", "WF-FND-04"],
      expectedStateVersion: 1,
    });
    expect(stale).toMatchObject({
      outcome: "CONFLICT",
      staleVersionSuspected: true,
      currentStateVersion: 2,
    });
    if (stale.outcome !== "CONFLICT") throw new Error("Expected failed CAS");
    expect(workflowConflictForCas(stale)).toMatchObject({
      code: "STATE_VERSION_CONFLICT",
      metadata: { currentStateVersion: 2 },
    });

    const resolved = await findingWorkflow.transition({
      resourceId: finding.id,
      transitionIds: ["WF-FND-03", "WF-FND-04"],
      expectedStateVersion: 2,
    });
    expect(resolved).toEqual({ outcome: "UPDATED", toState: "RESOLVED", newVersion: 3 });

    const reopened = await findingWorkflow.transition({
      resourceId: finding.id,
      transitionIds: ["WF-FND-05"],
      expectedStateVersion: 3,
    });
    expect(reopened).toEqual({ outcome: "UPDATED", toState: "OPEN", newVersion: 4 });

    const [row] = await db
      .select({
        status: vulnerabilityFindings.status,
        stateVersion: vulnerabilityFindings.stateVersion,
      })
      .from(vulnerabilityFindings)
      .where(eq(vulnerabilityFindings.id, finding.id));
    expect(row).toEqual({ status: "OPEN", stateVersion: 4 });
  });

  it("refuses undocumented transitions and reports a missing finding as NOT_FOUND", async () => {
    const context = await seedAssessment("invalid");
    const finding = await seedFinding(context);

    // WF-FND-05 is only valid from RESOLVED; the finding is OPEN.
    const reopenOpen = await findingWorkflow.transition({
      resourceId: finding.id,
      transitionIds: ["WF-FND-05"],
      expectedStateVersion: 1,
    });
    expect(reopenOpen).toMatchObject({ outcome: "CONFLICT", invalidStateSuspected: true });
    if (reopenOpen.outcome !== "CONFLICT") throw new Error("Expected failed CAS");
    expect(workflowConflictForCas(reopenOpen)).toMatchObject({
      code: "STATE_CONFLICT",
      statusCode: 409,
    });

    // WF-FND-01 is a creation transition, never applicable to an existing row.
    const recreate = await findingWorkflow.transition({
      resourceId: finding.id,
      transitionIds: ["WF-FND-01"],
      expectedStateVersion: 1,
    });
    expect(recreate).toMatchObject({ outcome: "CONFLICT", invalidStateSuspected: true });

    const missing = await findingWorkflow.transition({
      resourceId: randomUUID(),
      transitionIds: ["WF-FND-02"],
      expectedStateVersion: 1,
    });
    expect(missing).toEqual({ outcome: "NOT_FOUND" });

    const [row] = await db
      .select({
        status: vulnerabilityFindings.status,
        stateVersion: vulnerabilityFindings.stateVersion,
      })
      .from(vulnerabilityFindings)
      .where(eq(vulnerabilityFindings.id, finding.id));
    expect(row).toEqual({ status: "OPEN", stateVersion: 1 });
  });

  it("supports ORG and ASG + AUTH_SCOPE context predicates without cross-tenant leakage", async () => {
    const tenantA = await seedAssessment("tenant-a");
    const tenantB = await seedAssessment("tenant-b");
    const findingA = await seedFinding(tenantA);
    const findingB = await seedFinding(tenantB);

    // ORG (ERD §11): WHERE employer_id = current_user.employer_id.
    const orgRows = await db
      .select({ id: vulnerabilityFindings.id })
      .from(vulnerabilityFindings)
      .where(eq(vulnerabilityFindings.employerId, tenantA.employerId));
    expect(orgRows.map((row) => row.id)).toEqual([findingA.id]);

    // ASG + AUTH_SCOPE (ERD §11): the parent assessment carries the
    // assigned consultant and the exact scope authorization version.
    const asgRows = await db
      .select({
        id: vulnerabilityFindings.id,
        scopeAuthorizationId: securityAssessments.scopeAuthorizationId,
      })
      .from(vulnerabilityFindings)
      .innerJoin(
        securityAssessments,
        eq(securityAssessments.id, vulnerabilityFindings.assessmentId),
      )
      .where(
        and(
          eq(securityAssessments.assignedConsultantId, tenantA.consultantId),
          eq(vulnerabilityFindings.id, findingB.id),
        ),
      );
    expect(asgRows).toEqual([]);

    const [ownAsg] = await db
      .select({ scopeAuthorizationId: securityAssessments.scopeAuthorizationId })
      .from(vulnerabilityFindings)
      .innerJoin(
        securityAssessments,
        eq(securityAssessments.id, vulnerabilityFindings.assessmentId),
      )
      .where(
        and(
          eq(securityAssessments.assignedConsultantId, tenantA.consultantId),
          eq(vulnerabilityFindings.id, findingA.id),
        ),
      );
    expect(ownAsg).toEqual({ scopeAuthorizationId: tenantA.scopeId });
  });

  it("has the ERD-defined findings and corrected assessment indexes in PostgreSQL", async () => {
    const result = await db.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes
      where tablename in ('vulnerability_findings', 'security_assessments')
    `);
    const definitions = new Map(result.rows.map((row) => [row.indexname, row.indexdef]));
    expect(definitions.get("vulnerability_findings_assessment_severity_status_idx")).toContain(
      "(assessment_id, severity, status)",
    );
    expect(definitions.get("vulnerability_findings_employer_status_severity_idx")).toContain(
      "(employer_id, status, severity)",
    );
    expect(definitions.get("vulnerability_findings_created_by_created_desc_idx")).toContain(
      "(created_by_user_id, created_at DESC",
    );
    expect(definitions.get("security_assessments_employer_status_created_idx")).toContain(
      "(employer_id, status, created_at DESC",
    );
  });
});
