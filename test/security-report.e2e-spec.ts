import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import {
  securityAssessments,
  securityReports,
  vulnerabilityFindings,
} from "../src/infrastructure/database/schema";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";

/**
 * Wave 6B — Business assessment reads (API-ASM-007/008) and the operational
 * report backend (API-RPT-001..009, API-RPT-013) against real local Postgres.
 * RELEASED fixtures are seeded directly in this isolated test database because
 * API-RPT-008 can never succeed while GAP-013 is open (D6-3); no bypass
 * endpoint exists.
 */
const DOMAIN = "wave6b-report.test";
let counter = 0;
const SECRET = "RESTRICTED_DRAFT_CONTENT_MARKER";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Wave 6B Business assessment reads + operational report backend", () => {
  let app: INestApplication;
  let db: DatabaseConnection["db"];
  const emailPort: TransactionalEmailPort = {
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "");
    // Mutating integration tests run only against the approved local database.
    expect(`${target.hostname}:${target.port}${target.pathname}`).toBe("localhost:5432/cyber_hub");
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PORT)
      .useValue(emailPort)
      .compile();
    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.init();
    db = app.get<DatabaseConnection>(DATABASE_CONNECTION).db;
    businessA = await registerBusiness("business-a");
    businessB = await registerBusiness("business-b");
    consultantA = await registerRole("consultant-a", "ROLE_CONSULTANT");
    consultantB = await registerRole("consultant-b", "ROLE_CONSULTANT");
    admin = await registerRole("admin", "ROLE_ADMIN");
  });

  beforeEach(() => {
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
  });

  afterAll(async () => {
    const employers = sql`(select id from employers where email like ${`%@${DOMAIN}`})`;
    await db.execute(
      sql`delete from security_report_findings where report_id in (select id from security_reports where employer_id in ${employers})`,
    );
    await db.execute(
      sql`update security_reports set supersedes_report_id = null where employer_id in ${employers}`,
    );
    await db.execute(sql`delete from security_reports where employer_id in ${employers}`);
    await db.execute(sql`delete from vulnerability_findings where employer_id in ${employers}`);
    await db.execute(sql`delete from security_assessments where employer_id in ${employers}`);
    await db.execute(
      sql`delete from consulting_notes where consulting_request_id in (select id from consulting_requests where employer_id in ${employers})`,
    );
    await db.execute(
      sql`delete from security_scope_authorizations where employer_id in ${employers}`,
    );
    await db.execute(
      sql`delete from audit_logs where actor_user_id in (select id from users where email like ${`%@${DOMAIN}`}) or employer_id in ${employers}`,
    );
    await db.execute(sql`delete from consulting_requests where employer_id in ${employers}`);
    await db.execute(
      sql`delete from sessions where user_id in (select id from users where email like ${`%@${DOMAIN}`})`,
    );
    await db.execute(
      sql`delete from auth_tokens where user_id in (select id from users where email like ${`%@${DOMAIN}`})`,
    );
    await db.execute(sql`delete from users where email like ${`%@${DOMAIN}`}`);
    await db.execute(sql`delete from employers where email like ${`%@${DOMAIN}`}`);
    await app.close();
  });

  const email = (label: string) => `${label}-${Date.now()}-${counter++}@${DOMAIN}`;

  async function csrf(sessionCookie?: string) {
    const response = await request(app.getHttpServer())
      .get("/api/v1/auth/csrf-token")
      .set("Cookie", sessionCookie ?? "")
      .expect(200);
    const cookies = response.headers["set-cookie"] as unknown as string[];
    const tokenCookie = cookies.find((value) => value.startsWith("csh_csrf="));
    if (!tokenCookie) throw new Error("CSRF cookie missing");
    return {
      cookie: [sessionCookie, tokenCookie.split(";")[0]].filter(Boolean).join("; "),
      token: response.body.data.csrfToken as string,
    };
  }
  async function login(userEmail: string, password: string) {
    const token = await csrf();
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/sessions")
      .set("Cookie", token.cookie)
      .set("X-CSRF-Token", token.token)
      .send({ email: userEmail, password })
      .expect(200);
    const cookies = response.headers["set-cookie"] as unknown as string[];
    const session = cookies.find((value) => value.startsWith("csh_session="));
    if (!session) throw new Error("Session cookie missing");
    return csrf(session.split(";")[0]);
  }
  async function registerBusiness(label: string) {
    const userEmail = email(label);
    const password = "password123";
    const token = await csrf();
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register/business")
      .set("Cookie", token.cookie)
      .set("X-CSRF-Token", token.token)
      .send({
        name: `Business ${label}`,
        email: userEmail,
        password,
        companyName: `Company ${label}`,
        businessEmail: email(`${label}-company`),
      })
      .expect(201);
    return {
      userId: response.body.data.accountId as string,
      ...(await login(userEmail, password)),
    };
  }
  async function registerRole(label: string, role: "ROLE_ADMIN" | "ROLE_CONSULTANT") {
    const userEmail = email(label);
    const password = "password123";
    const token = await csrf();
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register/learner")
      .set("Cookie", token.cookie)
      .set("X-CSRF-Token", token.token)
      .send({ name: label, email: userEmail, password })
      .expect(201);
    const userId = response.body.data.accountId as string;
    await db.execute(sql`update users set role = ${role}, verified = true where id = ${userId}`);
    return { userId, ...(await login(userEmail, password)) };
  }

  type Actor = { userId: string; cookie: string; token: string };
  type ParentState = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  type ReportState = "DRAFT" | "IN_REVIEW" | "READY_FOR_RELEASE" | "RELEASED" | "SUPERSEDED";
  let businessA: Actor;
  let businessB: Actor;
  let consultantA: Actor;
  let consultantB: Actor;
  let admin: Actor;

  function http(
    method: "get" | "post" | "patch" | "put",
    path: string,
    actor: Actor = consultantA,
  ) {
    return request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set("Cookie", actor.cookie)
      .set("X-CSRF-Token", actor.token);
  }

  async function fixture(parent: ParentState = "IN_PROGRESS", business: Actor = businessA) {
    const created = await http("post", "/business/consulting-requests", business)
      .send({
        companyDetails: { name: "Wave 6B" },
        businessSize: "SME",
        securityConcern: "Validate external exposure",
        requestedService: "VULNERABILITY_ASSESSMENT",
        environmentDetails: { informationalOnly: true },
        contactInformation: { email: "wave6b@example.test" },
      })
      .expect(201);
    const requestId = created.body.data.id as string;
    await http("post", `/admin/consulting-requests/${requestId}/assign-consultant`, admin)
      .send({ consultantUserId: consultantA.userId })
      .expect(200);
    await http("post", `/business/consulting-requests/${requestId}/scope-authorizations`, business)
      .send({
        authorizedTargets: ["example.test"],
        allowedActivities: ["VULNERABILITY_ASSESSMENT"],
        restrictions: ["production-safe"],
        validFrom: new Date(Date.now() - 60_000).toISOString(),
        validUntil: new Date(Date.now() + 3_600_000).toISOString(),
        attestation: true,
      })
      .expect(201);
    await db.execute(
      sql`update consulting_requests set status = 'ACCEPTED', state_version = 3 where id = ${requestId}`,
    );
    const assessment = (
      await http("post", `/consulting/requests/${requestId}/assessments`).send({}).expect(201)
    ).body.data as { id: string; employerId: string; scopeAuthorizationId: string };
    await setParent(assessment.id, parent);
    return { ...assessment, requestId };
  }
  async function setParent(assessmentId: string, status: ParentState) {
    await db
      .update(securityAssessments)
      .set({ status })
      .where(eq(securityAssessments.id, assessmentId));
  }
  async function finding(assessment: { id: string; employerId: string }, status = "OPEN") {
    const [row] = await db
      .insert(vulnerabilityFindings)
      .values({
        title: "Exposure",
        severity: "HIGH",
        description: "RESTRICTED_DESCRIPTION",
        evidenceSummary: "RESTRICTED_EVIDENCE",
        recommendation: "Limit access",
        status: status as "OPEN",
        assessmentId: assessment.id,
        employerId: assessment.employerId,
        createdByUserId: consultantA.userId,
        resolvedAt: status === "RESOLVED" ? new Date() : null,
      })
      .returning();
    return row.id;
  }
  async function createReport(
    assessmentId: string,
    body: Record<string, unknown> = { draftContent: { summary: SECRET } },
    actor: Actor = consultantA,
  ) {
    return (
      await http("post", `/assessments/${assessmentId}/reports`, actor).send(body).expect(201)
    ).body.data as { id: string; stateVersion: number; versionNo: number };
  }
  async function forceReport(id: string, status: ReportState, extra: Record<string, unknown> = {}) {
    await db
      .update(securityReports)
      .set({ status, ...(status === "RELEASED" ? { releasedAt: new Date() } : {}), ...extra })
      .where(eq(securityReports.id, id));
  }
  async function reportRow(id: string) {
    return (await db.execute(sql`select * from security_reports where id = ${id}`)).rows[0];
  }
  async function reportAudits(id: string) {
    return (
      await db.execute(
        sql`select * from audit_logs where entity_id = ${id} and action = 'security.report.mutated' order by timestamp, id`,
      )
    ).rows as { metadata: Record<string, unknown>; employer_id: string; actor_user_id: string }[];
  }
  /** Ready report: COMPLETED parent, content, one finding, READY_FOR_RELEASE. */
  async function readyReport() {
    const f = await fixture("IN_PROGRESS");
    const findingId = await finding(f);
    const report = await createReport(f.id, {
      draftContent: { summary: SECRET },
      findingIds: [findingId],
    });
    await http("post", `/reports/${report.id}/submit-review`)
      .send({ expectedStateVersion: 1 })
      .expect(200);
    await setParent(f.id, "COMPLETED");
    await http("post", `/reports/${report.id}/mark-ready`)
      .send({ expectedStateVersion: 2 })
      .expect(200);
    return { f, findingId, report: { ...report, stateVersion: 3 } };
  }
  async function waitForLockWaiter() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] = (
        await db.execute(
          sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
        )
      ).rows as { n: number }[];
      if (row.n > 0) return;
      await sleep(50);
    }
    throw new Error("no request ever waited on the held lock");
  }

  describe("API-ASM-007/008 Business assessment reads", () => {
    it("returns only the exact AssessmentClientView for own ORG and conceals everything else", async () => {
      const f = await fixture("IN_PROGRESS");
      const detail = await http("get", `/business/security/assessments/${f.id}`, businessA).expect(
        200,
      );
      expect(Object.keys(detail.body.data).sort()).toEqual(
        ["completedAt", "createdAt", "id", "service", "startedAt", "status"].sort(),
      );
      expect(detail.body.data).toMatchObject({
        id: f.id,
        service: "VULNERABILITY_ASSESSMENT",
        status: "IN_PROGRESS",
      });
      const list = await http("get", "/business/security/assessments?limit=100", businessA).expect(
        200,
      );
      for (const row of list.body.data)
        expect(Object.keys(row).sort()).toEqual(
          ["completedAt", "createdAt", "id", "service", "startedAt", "status"].sort(),
        );
      const serialized = JSON.stringify([detail.body, list.body]);
      for (const restricted of [
        "employerId",
        "consultingRequestId",
        "scopeSnapshot",
        "scopeAuthorizationId",
        "assignedConsultantId",
        "stateVersion",
        "cancelledAt",
        "updatedAt",
        "example.test",
      ])
        expect(serialized).not.toContain(restricted);
      // Cross-ORG and missing are indistinguishable concealed 404s.
      await http("get", `/business/security/assessments/${f.id}`, businessB).expect(404);
      await http(
        "get",
        "/business/security/assessments/00000000-0000-4000-8000-000000000000",
        businessA,
      ).expect(404);
      const other = await http("get", "/business/security/assessments?limit=100", businessB).expect(
        200,
      );
      expect(other.body.data.map((row: { id: string }) => row.id)).not.toContain(f.id);
      // Wrong roles never reach Business reads.
      for (const actor of [consultantA, admin]) {
        await http("get", "/business/security/assessments", actor).expect(403);
        await http("get", `/business/security/assessments/${f.id}`, actor).expect(403);
      }
      await request(app.getHttpServer()).get("/api/v1/business/security/assessments").expect(401);
      await http("get", "/business/security/assessments/not-a-uuid", businessA).expect(422);
    });

    it("conceals an assessment whose request belongs to another employer", async () => {
      const f = await fixture("IN_PROGRESS");
      const other = await fixture("IN_PROGRESS", businessB);
      await db
        .update(securityAssessments)
        .set({ employerId: other.employerId })
        .where(eq(securityAssessments.id, f.id));
      await http("get", `/business/security/assessments/${f.id}`, businessA).expect(404);
      await http("get", `/business/security/assessments/${f.id}`, businessB).expect(404);
      const list = await http("get", "/business/security/assessments?limit=100", businessB).expect(
        200,
      );
      expect(list.body.data.map((row: { id: string }) => row.id)).not.toContain(f.id);
    });

    it("validates filters strictly and paginates own-ORG rows by createdAt/id with per-kind cursors", async () => {
      const business = await registerBusiness("business-pages");
      const ids: string[] = [];
      for (const status of ["PLANNED", "IN_PROGRESS", "COMPLETED"] as const)
        ids.push((await fixture(status, business)).id);
      for (const query of [
        "employerId=00000000-0000-4000-8000-000000000000",
        "employer_id=x",
        "organizationId=x",
        "service=VULNERABILITY_ASSESSMENT",
        "status=UNKNOWN",
        "limit=0",
        "limit=101",
        "cursor=not-a-cursor",
        "unexpected=1",
      ])
        await http("get", `/business/security/assessments?${query}`, business)
          .expect(422)
          .expect(({ body }) => expect(body.error.code).toBe("VALIDATION_ERROR"));
      const first = await http("get", "/business/security/assessments?limit=2", business).expect(
        200,
      );
      expect(first.body.data.map((row: { id: string }) => row.id)).toEqual([ids[2], ids[1]]);
      expect(first.body.meta.page).toMatchObject({ limit: 2, hasMore: true });
      const cursor = first.body.meta.page.nextCursor as string;
      const second = await http(
        "get",
        `/business/security/assessments?limit=2&cursor=${cursor}`,
        business,
      ).expect(200);
      expect(second.body.data.map((row: { id: string }) => row.id)).toEqual([ids[0]]);
      expect(second.body.meta.page).toEqual({ limit: 2, hasMore: false, nextCursor: null });
      // The cursor carries only a position: another ORG reusing it still sees only its rows.
      const replay = await http(
        "get",
        `/business/security/assessments?limit=100&cursor=${cursor}`,
        businessB,
      ).expect(200);
      for (const id of ids)
        expect(replay.body.data.map((row: { id: string }) => row.id)).not.toContain(id);
      // A Business cursor is never accepted by report discovery, and vice versa.
      await http("get", `/assessments/${ids[1]}/reports?cursor=${cursor}`, admin).expect(422);
      const filtered = await http(
        "get",
        "/business/security/assessments?status=COMPLETED",
        business,
      ).expect(200);
      expect(filtered.body.data.map((row: { id: string }) => row.id)).toEqual([ids[2]]);
      const defaults = await http("get", "/business/security/assessments", business).expect(200);
      expect(defaults.body.meta.page.limit).toBe(25);
    });

    it("keeps existing Consultant/Admin assessment collection reads working", async () => {
      const f = await fixture("IN_PROGRESS");
      const consultant = await http("get", "/assessments?limit=100").expect(200);
      expect(consultant.body.data.map((row: { id: string }) => row.id)).toContain(f.id);
      await http("get", "/assessments?limit=100", consultantB)
        .expect(200)
        .expect(({ body }) =>
          expect(body.data.map((row: { id: string }) => row.id)).not.toContain(f.id),
        );
      await http("get", `/assessments?employerId=${f.employerId}`, admin).expect(200);
      await http("get", "/assessments", businessA).expect(403);
    });
  });

  describe("API-RPT-001 creation and version allocation", () => {
    it.each(["IN_PROGRESS", "COMPLETED"] as const)(
      "creates a DRAFT under a %s parent with server-derived fields, ordered findings and an audit event",
      async (parent) => {
        const f = await fixture(parent);
        const first = await finding(f);
        const resolved = await finding(f, "RESOLVED");
        const created = await http("post", `/assessments/${f.id}/reports`)
          .send({ draftContent: {}, findingIds: [resolved, first] })
          .expect(201);
        expect(created.body.data).toMatchObject({
          assessmentId: f.id,
          employerId: f.employerId,
          draftContent: {},
          status: "DRAFT",
          stateVersion: 1,
          versionNo: 1,
          supersedesReportId: null,
          preparedByUserId: consultantA.userId,
          reviewedByUserId: null,
          releasedByUserId: null,
          reportPath: null,
          releasedAt: null,
        });
        expect(
          created.body.data.includedFindings.map((m: { findingId: string; sortOrder: number }) => [
            m.findingId,
            m.sortOrder,
          ]),
        ).toEqual([
          [resolved, 0],
          [first, 1],
        ]);
        const audits = await reportAudits(created.body.data.id);
        expect(audits).toHaveLength(1);
        expect(audits[0].metadata).toMatchObject({
          apiId: "API-RPT-001",
          transitionId: "WF-RPT-01",
          to: "DRAFT",
          versionNo: 1,
          findingIds: [resolved, first],
        });
        const admins = await createReport(f.id, { draftContent: { a: 1 } }, admin);
        expect(admins.versionNo).toBe(2);
      },
    );

    it.each(["PLANNED", "CANCELLED"] as const)(
      "rejects creation under a %s parent with STATE_CONFLICT for every role",
      async (parent) => {
        const f = await fixture(parent);
        for (const actor of [consultantA, admin])
          await http("post", `/assessments/${f.id}/reports`, actor)
            .send({ draftContent: {} })
            .expect(409)
            .expect(({ body }) => expect(body.error.code).toBe("STATE_CONFLICT"));
        expect(
          (await db.execute(sql`select id from security_reports where assessment_id = ${f.id}`))
            .rows,
        ).toHaveLength(0);
      },
    );

    it("rejects server-controlled fields, non-object content and unlinked findings without writing anything", async () => {
      const f = await fixture("IN_PROGRESS");
      const other = await fixture("IN_PROGRESS");
      const crossOrg = await fixture("IN_PROGRESS", businessB);
      const own = await finding(f);
      for (const field of [
        "status",
        "versionNo",
        "employerId",
        "stateVersion",
        "preparedByUserId",
        "reviewedByUserId",
        "releasedByUserId",
        "reportPath",
        "supersedesReportId",
        "generatedAt",
        "releasedAt",
        "assessmentId",
      ])
        await http("post", `/assessments/${f.id}/reports`)
          .send({ draftContent: {}, [field]: f.id })
          .expect(422);
      for (const draftContent of [[], ["x"], null, "text", 1])
        await http("post", `/assessments/${f.id}/reports`).send({ draftContent }).expect(422);
      await http("post", `/assessments/${f.id}/reports`).send({}).expect(422);
      const foreign = [
        [await finding(other)],
        [await finding(crossOrg)],
        ["00000000-0000-4000-8000-000000000000"],
        [own, own],
      ];
      const messages = new Set<string>();
      for (const findingIds of foreign) {
        const response = await http("post", `/assessments/${f.id}/reports`)
          .send({ draftContent: {}, findingIds })
          .expect(422);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
        expect(response.body.error.details).toBeUndefined();
        messages.add(response.body.error.message);
      }
      // One generic answer: no oracle about which finding exists or where.
      expect(messages.size).toBe(1);
      await http("post", `/assessments/${f.id}/reports`)
        .send({ draftContent: {}, findingIds: ["not-a-uuid"] })
        .expect(422);
      expect(
        (await db.execute(sql`select id from security_reports where assessment_id = ${f.id}`)).rows,
      ).toHaveLength(0);
    });

    it("allocates distinct contiguous versions to parallel creations (real Postgres locking)", async () => {
      const f = await fixture("IN_PROGRESS");
      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          http("post", `/assessments/${f.id}/reports`, index % 2 ? admin : consultantA).send({
            draftContent: { index },
          }),
        ),
      );
      expect(responses.map((response) => response.status)).toEqual(Array(6).fill(201));
      const versions = responses
        .map((response) => response.body.data.versionNo as number)
        .sort((a, b) => a - b);
      expect(versions).toEqual([1, 2, 3, 4, 5, 6]);
      const rows = (
        await db.execute(
          sql`select id, version_no from security_reports where assessment_id = ${f.id}`,
        )
      ).rows as { id: string }[];
      expect(rows).toHaveLength(6);
      for (const row of rows) expect(await reportAudits(row.id)).toHaveLength(1);
    });

    it("re-checks dual ASG under the request lock: a reassignment committed while creation waits denies it", async () => {
      const f = await fixture("IN_PROGRESS");
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holder = db.transaction(async (tx) => {
        await tx.execute(
          sql`select id from consulting_requests where id = ${f.requestId} for update`,
        );
        await gate;
        await tx.execute(
          sql`update consulting_requests set assigned_consultant_id = ${consultantB.userId} where id = ${f.requestId}`,
        );
      });
      const pending = http("post", `/assessments/${f.id}/reports`).send({ draftContent: {} });
      const result = pending.then((response) => response);
      await waitForLockWaiter();
      release();
      await holder;
      expect((await result).status).toBe(404);
      expect(
        (await db.execute(sql`select id from security_reports where assessment_id = ${f.id}`)).rows,
      ).toHaveLength(0);
    });
  });

  describe("report authorization (D6-6) and AUTH_SCOPE independence", () => {
    it("enforces dual ASG, explicit Admin grants and Business denial on every operation", async () => {
      const f = await fixture("IN_PROGRESS");
      const report = await createReport(f.id);
      await http("get", `/reports/${report.id}`).expect(200);
      await http("get", `/reports/${report.id}`, admin).expect(200);
      await http("get", `/assessments/${f.id}/reports`, admin).expect(200);
      for (const [method, path, body] of [
        ["get", `/reports/${report.id}`, undefined],
        ["get", `/assessments/${f.id}/reports`, undefined],
        ["post", `/assessments/${f.id}/reports`, { draftContent: {} }],
        ["patch", `/reports/${report.id}`, { expectedStateVersion: 1 }],
        ["put", `/reports/${report.id}/findings`, { findingIds: [], expectedStateVersion: 1 }],
        ["post", `/reports/${report.id}/submit-review`, { expectedStateVersion: 1 }],
        ["post", `/reports/${report.id}/return-to-draft`, { expectedStateVersion: 1, reason: "x" }],
        ["post", `/reports/${report.id}/mark-ready`, { expectedStateVersion: 1 }],
      ] as const) {
        // Unassigned Consultant: concealed 404. Business: role denial 403.
        await http(method, path, consultantB)
          .send(body)
          .expect(404)
          .expect(({ body: response }) => expect(response.error.code).toBe("NOT_FOUND"));
        await http(method, path, businessA).send(body).expect(403);
      }
      for (const path of [
        `/admin/reports/${report.id}/release`,
        `/admin/reports/${report.id}/supersede`,
      ]) {
        await http("post", path, consultantA)
          .send({
            expectedStateVersion: 1,
            storedObjectId: report.id,
            replacementReportId: report.id,
          })
          .expect(403);
        await http("post", path, businessA).send({}).expect(403);
      }
      // Admin never submits for review or marks ready (separation of duties).
      await http("post", `/reports/${report.id}/submit-review`, admin)
        .send({ expectedStateVersion: 1 })
        .expect(403);
      await http("post", `/reports/${report.id}/mark-ready`, admin)
        .send({ expectedStateVersion: 1 })
        .expect(403);
      await http("get", "/reports/00000000-0000-4000-8000-000000000000", admin).expect(404);
      await http("get", "/reports/not-a-uuid", admin).expect(422);
      await request(app.getHttpServer()).get(`/api/v1/reports/${report.id}`).expect(401);
      // No global report list exists.
      await http("get", "/reports", admin).expect(404);
    });

    it.each([
      ["request", "consulting_requests"],
      ["assessment", "security_assessments"],
    ] as const)(
      "loses Consultant access when only the %s assignment changes (dual ASG)",
      async (_label, table) => {
        const f = await fixture("IN_PROGRESS");
        const report = await createReport(f.id);
        const id = table === "consulting_requests" ? f.requestId : f.id;
        await db.execute(
          sql`update ${sql.identifier(table)} set assigned_consultant_id = ${consultantB.userId} where id = ${id}`,
        );
        await http("get", `/reports/${report.id}`).expect(404);
        await http("get", `/reports/${report.id}`, consultantB).expect(404);
        await http("patch", `/reports/${report.id}`)
          .send({ expectedStateVersion: 1, draftContent: { changed: true } })
          .expect(404);
        await http("get", `/assessments/${f.id}/reports`).expect(404);
        expect((await reportRow(report.id)).state_version).toBe(1);
        await http("get", `/reports/${report.id}`, admin).expect(200);
      },
    );

    it("denies a write whose guard check passed before a reassignment committed (lock re-check)", async () => {
      const f = await fixture("IN_PROGRESS");
      const report = await createReport(f.id);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holder = db.transaction(async (tx) => {
        await tx.execute(
          sql`select id from consulting_requests where id = ${f.requestId} for update`,
        );
        await gate;
        await tx.execute(
          sql`update consulting_requests set assigned_consultant_id = ${consultantB.userId} where id = ${f.requestId}`,
        );
      });
      const result = http("patch", `/reports/${report.id}`)
        .send({ expectedStateVersion: 1, draftContent: { late: true } })
        .then((response) => response);
      await waitForLockWaiter();
      release();
      await holder;
      expect((await result).status).toBe(404);
      expect((await reportRow(report.id)).state_version).toBe(1);
    });

    it.each(["expired", "revoked"])(
      "continues report operations after the assessment AUTH_SCOPE is %s",
      async (kind) => {
        const f = await fixture("IN_PROGRESS");
        const findingId = await finding(f);
        await db.execute(
          kind === "expired"
            ? sql`update security_scope_authorizations set valid_from = now() - interval '2 hours', valid_until = now() - interval '1 hour' where id = ${f.scopeAuthorizationId}`
            : sql`update security_scope_authorizations set revoked_at = now() where id = ${f.scopeAuthorizationId}`,
        );
        // A technical action still requires AUTH_SCOPE (unchanged Wave 5B behaviour) ...
        await http("post", `/assessments/${f.id}/findings`)
          .send({ title: "t", severity: "LOW", recommendation: "r" })
          .expect(404);
        // ... while report operations do not (API Contract v1.3).
        const report = await createReport(f.id, {
          draftContent: { summary: "x" },
          findingIds: [findingId],
        });
        await http("patch", `/reports/${report.id}`)
          .send({ expectedStateVersion: 1, draftContent: { summary: "y" } })
          .expect(200);
        await http("post", `/reports/${report.id}/submit-review`)
          .send({ expectedStateVersion: 2 })
          .expect(200);
        await http("get", `/assessments/${f.id}/reports`).expect(200);
      },
    );
  });

  describe("API-RPT-002 / API-RPT-013 operational reads", () => {
    it("returns full internal detail with ordered membership, and summaries without draft content", async () => {
      const f = await fixture("IN_PROGRESS");
      const findingId = await finding(f);
      const report = await createReport(f.id, {
        draftContent: { summary: SECRET },
        findingIds: [findingId],
      });
      const detail = await http("get", `/reports/${report.id}`).expect(200);
      expect(detail.body.data.draftContent).toEqual({ summary: SECRET });
      expect(detail.body.data.includedFindings).toEqual([
        expect.objectContaining({
          findingId,
          sortOrder: 0,
          finding: expect.objectContaining({ id: findingId, title: "Exposure" }),
        }),
      ]);
      const list = await http("get", `/assessments/${f.id}/reports`).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(Object.keys(list.body.data[0]).sort()).toEqual(
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
      expect(JSON.stringify(list.body)).not.toContain(SECRET);
    });

    it("paginates one assessment's reports with status filter, strict query and a report-only cursor", async () => {
      const f = await fixture("IN_PROGRESS");
      const other = await fixture("IN_PROGRESS");
      const ids: string[] = [];
      for (let index = 0; index < 3; index++) ids.push((await createReport(f.id)).id);
      const foreign = await createReport(other.id);
      await forceReport(ids[0], "IN_REVIEW");
      const first = await http("get", `/assessments/${f.id}/reports?limit=2`).expect(200);
      expect(first.body.data.map((row: { id: string }) => row.id)).toEqual([ids[2], ids[1]]);
      expect(first.body.meta.page.hasMore).toBe(true);
      const second = await http(
        "get",
        `/assessments/${f.id}/reports?limit=2&cursor=${first.body.meta.page.nextCursor}`,
      ).expect(200);
      expect(second.body.data.map((row: { id: string }) => row.id)).toEqual([ids[0]]);
      // Reusing the cursor on another assessment never crosses into this one.
      const crossed = await http(
        "get",
        `/assessments/${other.id}/reports?cursor=${first.body.meta.page.nextCursor}`,
      ).expect(200);
      expect(crossed.body.data.map((row: { id: string }) => row.id)).not.toContain(ids[0]);
      const filtered = await http("get", `/assessments/${f.id}/reports?status=IN_REVIEW`).expect(
        200,
      );
      expect(filtered.body.data.map((row: { id: string }) => row.id)).toEqual([ids[0]]);
      const all = await http("get", `/assessments/${f.id}/reports?limit=100`, admin).expect(200);
      expect(all.body.data.map((row: { id: string }) => row.id)).not.toContain(foreign.id);
      for (const query of ["status=BAD", "limit=101", "cursor=abc", "employerId=x", "x=1"])
        await http("get", `/assessments/${f.id}/reports?${query}`).expect(422);
      const business = await http(
        "get",
        "/business/security/assessments?limit=1",
        businessA,
      ).expect(200);
      if (business.body.meta.page.nextCursor)
        await http(
          "get",
          `/business/security/assessments?cursor=${first.body.meta.page.nextCursor}`,
          businessA,
        ).expect(422);
      await http("get", "/assessments/00000000-0000-4000-8000-000000000000/reports", admin).expect(
        404,
      );
    });
  });

  describe("API-RPT-003/004 draft editing and membership", () => {
    it("patches DRAFT content with CAS, counts empty patches, and audits field names only", async () => {
      const f = await fixture("IN_PROGRESS");
      const report = await createReport(f.id);
      const patched = await http("patch", `/reports/${report.id}`)
        .send({ expectedStateVersion: 1, draftContent: { summary: `${SECRET}-2` } })
        .expect(200);
      expect(patched.body.data).toMatchObject({
        stateVersion: 2,
        draftContent: { summary: `${SECRET}-2` },
      });
      const empty = await http("patch", `/reports/${report.id}`, admin)
        .send({ expectedStateVersion: 2 })
        .expect(200);
      expect(empty.body.data.stateVersion).toBe(3);
      await http("patch", `/reports/${report.id}`)
        .send({ expectedStateVersion: 1, draftContent: {} })
        .expect(409)
        .expect(({ body }) =>
          expect(body.error).toMatchObject({
            code: "STATE_VERSION_CONFLICT",
            details: { currentStateVersion: 3 },
          }),
        );
      for (const field of [
        "status",
        "versionNo",
        "preparedByUserId",
        "supersedesReportId",
        "employerId",
      ])
        await http("patch", `/reports/${report.id}`)
          .send({ expectedStateVersion: 3, [field]: "x" })
          .expect(422);
      await forceReport(report.id, "IN_REVIEW");
      await http("patch", `/reports/${report.id}`)
        .send({ expectedStateVersion: 3, draftContent: {} })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe("STATE_CONFLICT"));
      const audits = await reportAudits(report.id);
      expect(audits.map((a) => a.metadata.changedFields)).toEqual([
        undefined,
        ["draftContent"],
        [],
      ]);
      expect(JSON.stringify(audits)).not.toContain(SECRET);
    });

    it("replaces membership atomically, preserving includedAt and following input order", async () => {
      const f = await fixture("IN_PROGRESS");
      const [a, b, c] = [await finding(f), await finding(f), await finding(f, "RESOLVED")];
      const report = await createReport(f.id, { draftContent: {}, findingIds: [a, b] });
      const before = (await http("get", `/reports/${report.id}`).expect(200)).body.data
        .includedFindings as { findingId: string; includedAt: string }[];
      const replaced = await http("put", `/reports/${report.id}/findings`)
        .send({ expectedStateVersion: 1, findingIds: [c, a] })
        .expect(200);
      expect(replaced.body.data.stateVersion).toBe(2);
      const after = replaced.body.data.includedFindings as {
        findingId: string;
        sortOrder: number;
        includedAt: string;
      }[];
      expect(after.map((m) => [m.findingId, m.sortOrder])).toEqual([
        [c, 0],
        [a, 1],
      ]);
      expect(after.find((m) => m.findingId === a)?.includedAt).toBe(
        before.find((m) => m.findingId === a)?.includedAt,
      );
      // Unchanged membership still advances the version (versioned mutation).
      await http("put", `/reports/${report.id}/findings`, admin)
        .send({ expectedStateVersion: 2, findingIds: [c, a] })
        .expect(200)
        .expect(({ body }) => expect(body.data.stateVersion).toBe(3));
      const emptied = await http("put", `/reports/${report.id}/findings`)
        .send({ expectedStateVersion: 3, findingIds: [] })
        .expect(200);
      expect(emptied.body.data.includedFindings).toEqual([]);
      const audits = (await reportAudits(report.id)).slice(1);
      expect(audits.map((x) => x.metadata.addedFindingIds)).toEqual([[c], [], []]);
      expect(audits[0].metadata.removedFindingIds).toEqual([b]);
      expect(audits[1].metadata.removedFindingIds).toEqual([]);
      expect([...(audits[2].metadata.removedFindingIds as string[])].sort()).toEqual([a, c].sort());
      expect(JSON.stringify(audits)).not.toContain("RESTRICTED_");
    });

    it("rejects invalid membership with one generic 422 and leaves the report untouched", async () => {
      const f = await fixture("IN_PROGRESS");
      const crossOrg = await fixture("IN_PROGRESS", businessB);
      const own = await finding(f);
      const report = await createReport(f.id, { draftContent: {}, findingIds: [own] });
      for (const findingIds of [
        [own, own],
        [await finding(crossOrg)],
        ["00000000-0000-4000-8000-000000000000"],
      ])
        await http("put", `/reports/${report.id}/findings`)
          .send({ expectedStateVersion: 1, findingIds })
          .expect(422)
          .expect(({ body }) =>
            expect(body.error).toEqual(expect.objectContaining({ code: "VALIDATION_ERROR" })),
          );
      await http("put", `/reports/${report.id}/findings`)
        .send({ expectedStateVersion: 1 })
        .expect(422);
      await http("put", `/reports/${report.id}/findings`)
        .send({ expectedStateVersion: 9, findingIds: [] })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe("STATE_VERSION_CONFLICT"));
      const row = await reportRow(report.id);
      expect(row.state_version).toBe(1);
      expect(
        (
          await db.execute(
            sql`select finding_id from security_report_findings where report_id = ${report.id}`,
          )
        ).rows,
      ).toEqual([{ finding_id: own }]);
      await forceReport(report.id, "IN_REVIEW");
      await http("put", `/reports/${report.id}/findings`)
        .send({ expectedStateVersion: 1, findingIds: [] })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe("STATE_CONFLICT"));
    });

    it("lets exactly one of concurrent PUT / PATCH / submit with the same version win (no lost update)", async () => {
      const f = await fixture("IN_PROGRESS");
      const [a, b] = [await finding(f), await finding(f)];
      const report = await createReport(f.id, { draftContent: { s: 1 }, findingIds: [a] });
      const responses = await Promise.all([
        http("put", `/reports/${report.id}/findings`).send({
          expectedStateVersion: 1,
          findingIds: [b],
        }),
        http("patch", `/reports/${report.id}`).send({
          expectedStateVersion: 1,
          draftContent: { s: 2 },
        }),
        http("post", `/reports/${report.id}/submit-review`).send({ expectedStateVersion: 1 }),
      ]);
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([200, 409, 409]);
      for (const response of responses.filter((r) => r.status === 409))
        expect(response.body.error.code).toBe("STATE_VERSION_CONFLICT");
      expect((await reportRow(report.id)).state_version).toBe(2);
      expect(await reportAudits(report.id)).toHaveLength(2);
    });
  });

  describe("API-RPT-005/006/007 review workflow and D6-5 guards", () => {
    it("runs DRAFT -> IN_REVIEW -> READY_FOR_RELEASE with reviewer recorded and Admin-only READY return", async () => {
      const { f, report } = await readyReport();
      const ready = (await http("get", `/reports/${report.id}`).expect(200)).body.data;
      expect(ready).toMatchObject({
        status: "READY_FOR_RELEASE",
        stateVersion: 3,
        reviewedByUserId: consultantA.userId,
      });
      // A Consultant may not return a READY report (report.release_client).
      await http("post", `/reports/${report.id}/return-to-draft`)
        .send({ expectedStateVersion: 3, reason: "fix" })
        .expect(403);
      await http("post", `/reports/${report.id}/return-to-draft`)
        .send({ expectedStateVersion: 99, reason: "fix" })
        .expect(403);
      for (const reason of [undefined, "", "   "])
        await http("post", `/reports/${report.id}/return-to-draft`, admin)
          .send({ expectedStateVersion: 3, reason })
          .expect(422);
      await http("post", `/reports/${report.id}/return-to-draft`, admin)
        .send({ expectedStateVersion: 2, reason: "fix" })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe("STATE_VERSION_CONFLICT"));
      const returned = await http("post", `/reports/${report.id}/return-to-draft`, admin)
        .send({ expectedStateVersion: 3, reason: "Needs correction" })
        .expect(200);
      expect(returned.body.data).toMatchObject({
        status: "DRAFT",
        stateVersion: 4,
        reviewedByUserId: consultantA.userId,
      });
      await http("post", `/reports/${report.id}/return-to-draft`, admin)
        .send({ expectedStateVersion: 4, reason: "again" })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe("STATE_CONFLICT"));
      await http("post", `/reports/${report.id}/submit-review`)
        .send({ expectedStateVersion: 4 })
        .expect(200);
      // IN_REVIEW -> DRAFT is open to the assigned Consultant too.
      await http("post", `/reports/${report.id}/return-to-draft`)
        .send({ expectedStateVersion: 5, reason: "Consultant correction" })
        .expect(200);
      const audits = await reportAudits(report.id);
      expect(audits.map((a) => a.metadata.transitionId)).toEqual([
        "WF-RPT-01",
        "WF-RPT-02",
        "WF-RPT-04",
        "WF-RPT-05",
        "WF-RPT-02",
        "WF-RPT-03",
      ]);
      expect(audits[3].metadata).toMatchObject({
        reason: "Needs correction",
        from: "READY_FOR_RELEASE",
        to: "DRAFT",
      });
      expect(audits.every((a) => a.employer_id === f.employerId)).toBe(true);
      expect(JSON.stringify(audits)).not.toContain(SECRET);
    });

    it("requires non-empty content and at least one finding before submit and mark-ready", async () => {
      const f = await fixture("IN_PROGRESS");
      const findingId = await finding(f);
      const empty = await createReport(f.id, { draftContent: {}, findingIds: [findingId] });
      await http("post", `/reports/${empty.id}/submit-review`)
        .send({ expectedStateVersion: 1 })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe("STATE_CONFLICT"));
      const noFindings = await createReport(f.id, { draftContent: { s: 1 } });
      await http("post", `/reports/${noFindings.id}/submit-review`)
        .send({ expectedStateVersion: 1 })
        .expect(409);
      await http("post", `/reports/${noFindings.id}/submit-review`)
        .send({ expectedStateVersion: 7 })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe("STATE_VERSION_CONFLICT"));
      // Mark-ready re-checks content after review began.
      const report = await createReport(f.id, { draftContent: { s: 1 }, findingIds: [findingId] });
      await http("post", `/reports/${report.id}/submit-review`)
        .send({ expectedStateVersion: 1 })
        .expect(200);
      await setParent(f.id, "COMPLETED");
      await db.execute(sql`delete from security_report_findings where report_id = ${report.id}`);
      await http("post", `/reports/${report.id}/mark-ready`)
        .send({ expectedStateVersion: 2 })
        .expect(409);
      await http("post", `/reports/${report.id}/mark-ready`).send({}).expect(422);
      expect((await reportRow(report.id)).status).toBe("IN_REVIEW");
    });

    it("applies the parent assessment matrix, including the CANCELLED special case", async () => {
      // IN_PROGRESS: submit yes, mark-ready no.
      const f = await fixture("IN_PROGRESS");
      const findingId = await finding(f);
      const report = await createReport(f.id, { draftContent: { s: 1 }, findingIds: [findingId] });
      await http("post", `/reports/${report.id}/submit-review`)
        .send({ expectedStateVersion: 1 })
        .expect(200);
      await http("post", `/reports/${report.id}/mark-ready`)
        .send({ expectedStateVersion: 2 })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe("STATE_CONFLICT"));
      // CANCELLED: a DRAFT stays editable, nothing progresses, IN_REVIEW may return.
      const draft = await createReport(f.id, { draftContent: { s: 1 }, findingIds: [findingId] });
      await setParent(f.id, "CANCELLED");
      await http("patch", `/reports/${draft.id}`)
        .send({ expectedStateVersion: 1, draftContent: { s: 2 } })
        .expect(200);
      await http("put", `/reports/${draft.id}/findings`)
        .send({ expectedStateVersion: 2, findingIds: [findingId] })
        .expect(200);
      await http("post", `/reports/${draft.id}/submit-review`)
        .send({ expectedStateVersion: 3 })
        .expect(409);
      await http("post", `/reports/${report.id}/mark-ready`)
        .send({ expectedStateVersion: 2 })
        .expect(409);
      await http("post", `/reports/${report.id}/return-to-draft`)
        .send({ expectedStateVersion: 2, reason: "Assessment cancelled" })
        .expect(200);
      await http("post", `/assessments/${f.id}/reports`).send({ draftContent: {} }).expect(409);
      // A READY report under a later-COMPLETED parent can never be released by anyone.
      await forceReport(report.id, "READY_FOR_RELEASE");
      await http("post", `/admin/reports/${report.id}/release`, admin)
        .send({ expectedStateVersion: 3, storedObjectId: report.id })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe("STATE_CONFLICT"));
    });

    it("serializes mark-ready against a concurrent parent lifecycle change", async () => {
      const f = await fixture("IN_PROGRESS");
      const findingId = await finding(f);
      const report = await createReport(f.id, { draftContent: { s: 1 }, findingIds: [findingId] });
      await http("post", `/reports/${report.id}/submit-review`)
        .send({ expectedStateVersion: 1 })
        .expect(200);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      // Hold the assessment row while it is being completed; mark-ready must wait and then see COMPLETED.
      const holder = db.transaction(async (tx) => {
        await tx.execute(sql`select id from security_assessments where id = ${f.id} for update`);
        await gate;
        await tx.execute(
          sql`update security_assessments set status = 'COMPLETED' where id = ${f.id}`,
        );
      });
      const result = http("post", `/reports/${report.id}/mark-ready`)
        .send({ expectedStateVersion: 2 })
        .then((response) => response);
      await waitForLockWaiter();
      release();
      await holder;
      expect((await result).status).toBe(200);
      expect((await reportRow(report.id)).status).toBe("READY_FOR_RELEASE");
    });
  });

  describe("API-RPT-008 release gate (GAP-013 open)", () => {
    it("rejects a valid release with FILE_POLICY_NOT_CONFIGURED and changes nothing", async () => {
      const { report } = await readyReport();
      const before = await reportRow(report.id);
      const auditsBefore = (await reportAudits(report.id)).length;
      const response = await http("post", `/admin/reports/${report.id}/release`, admin)
        .send({ expectedStateVersion: 3, storedObjectId: "00000000-0000-4000-8000-000000000001" })
        .expect(409);
      expect(response.body.error.code).toBe("FILE_POLICY_NOT_CONFIGURED");
      expect(await reportRow(report.id)).toEqual(before);
      expect(await reportAudits(report.id)).toHaveLength(auditsBefore);
      expect(
        (
          await db.execute(
            sql`select count(*)::int as n from audit_logs where entity_id = ${report.id} and metadata->>'apiId' = 'API-RPT-008'`,
          )
        ).rows[0],
      ).toEqual({ n: 0 });
      expect(
        (
          await db.execute(
            sql`select count(*)::int as n from information_schema.tables where table_name = 'stored_objects'`,
          )
        ).rows[0],
      ).toEqual({ n: 0 });
      expect(
        (
          await db.execute(
            sql`select count(*)::int as n from security_reports where status = 'RELEASED' and id = ${report.id}`,
          )
        ).rows[0],
      ).toEqual({ n: 0 });
    });

    it("keeps authorization, validation, version and state errors ahead of the file-policy gate", async () => {
      const { report } = await readyReport();
      const draft = await createReport((await fixture("COMPLETED")).id);
      const body = {
        expectedStateVersion: 3,
        storedObjectId: "00000000-0000-4000-8000-000000000001",
      };
      await http("post", `/admin/reports/${report.id}/release`, consultantA).send(body).expect(403);
      await http("post", "/admin/reports/00000000-0000-4000-8000-000000000000/release", admin)
        .send(body)
        .expect(404);
      for (const invalid of [
        {},
        { expectedStateVersion: 3 },
        { ...body, storedObjectId: "nope" },
        { ...body, extra: 1 },
      ])
        await http("post", `/admin/reports/${report.id}/release`, admin).send(invalid).expect(422);
      await http("post", `/admin/reports/${report.id}/release`, admin)
        .send({ ...body, expectedStateVersion: 2 })
        .expect(409)
        .expect(({ body: error }) =>
          expect(error.error).toMatchObject({
            code: "STATE_VERSION_CONFLICT",
            details: { currentStateVersion: 3 },
          }),
        );
      await http("post", `/admin/reports/${draft.id}/release`, admin)
        .send({ ...body, expectedStateVersion: 1 })
        .expect(409)
        .expect(({ body: error }) => expect(error.error.code).toBe("STATE_CONFLICT"));
    });
  });

  describe("API-RPT-009 explicit supersede (D6-8)", () => {
    async function releasedPair() {
      const f = await fixture("COMPLETED");
      const old = await createReport(f.id, { draftContent: { v: 1 } }, admin);
      const replacement = await createReport(f.id, { draftContent: { v: 2 } }, admin);
      await forceReport(old.id, "RELEASED");
      await forceReport(replacement.id, "RELEASED");
      return { f, old, replacement };
    }

    it("supersedes atomically: old -> SUPERSEDED (+1), lineage on the replacement only, audited", async () => {
      const { old, replacement } = await releasedPair();
      const replacementBefore = await reportRow(replacement.id);
      const response = await http("post", `/admin/reports/${old.id}/supersede`, admin)
        .send({ expectedStateVersion: 1, replacementReportId: replacement.id })
        .expect(200);
      expect(response.body.data).toMatchObject({
        id: old.id,
        status: "SUPERSEDED",
        stateVersion: 2,
      });
      const replacementAfter = await reportRow(replacement.id);
      expect(replacementAfter).toEqual({ ...replacementBefore, supersedes_report_id: old.id });
      const audits = await reportAudits(old.id);
      expect(audits.at(-1)?.metadata).toMatchObject({
        apiId: "API-RPT-009",
        transitionId: "WF-RPT-07",
        from: "RELEASED",
        to: "SUPERSEDED",
        oldReportId: old.id,
        replacementReportId: replacement.id,
        stateVersion: 2,
      });
      // SUPERSEDED is terminal and the replacement cannot be reused.
      await http("post", `/admin/reports/${old.id}/supersede`, admin)
        .send({ expectedStateVersion: 2, replacementReportId: replacement.id })
        .expect(409);
    });

    it("rejects every invalid replacement with STATE_CONFLICT and leaves both rows unchanged", async () => {
      const { f, old, replacement } = await releasedPair();
      const otherAssessment = await fixture("COMPLETED");
      const foreign = await createReport(otherAssessment.id, { draftContent: {} }, admin);
      await forceReport(foreign.id, "RELEASED");
      const notReleased = await createReport(f.id, { draftContent: {} }, admin);
      const crossOrg = await fixture("COMPLETED", businessB);
      const crossOrgReport = await createReport(crossOrg.id, { draftContent: {} }, admin);
      await forceReport(crossOrgReport.id, "RELEASED");
      const before = [await reportRow(old.id), await reportRow(replacement.id)];
      for (const replacementReportId of [
        old.id,
        foreign.id,
        notReleased.id,
        crossOrgReport.id,
        "00000000-0000-4000-8000-000000000000",
      ])
        await http("post", `/admin/reports/${old.id}/supersede`, admin)
          .send({ expectedStateVersion: 1, replacementReportId })
          .expect(409)
          .expect(({ body }) => {
            expect(body.error.code).toBe("STATE_CONFLICT");
            expect(body.error.details).toBeUndefined();
          });
      // Lower version cannot supersede a higher one.
      await http("post", `/admin/reports/${replacement.id}/supersede`, admin)
        .send({ expectedStateVersion: 1, replacementReportId: old.id })
        .expect(409);
      // Stale version is reported before replacement checks.
      await http("post", `/admin/reports/${old.id}/supersede`, admin)
        .send({ expectedStateVersion: 5, replacementReportId: replacement.id })
        .expect(409)
        .expect(({ body }) =>
          expect(body.error).toMatchObject({
            code: "STATE_VERSION_CONFLICT",
            details: { currentStateVersion: 1 },
          }),
        );
      await http("post", `/admin/reports/${notReleased.id}/supersede`, admin)
        .send({ expectedStateVersion: 1, replacementReportId: replacement.id })
        .expect(409);
      await http("post", `/admin/reports/${old.id}/supersede`, admin)
        .send({ expectedStateVersion: 1, replacementReportId: "bad" })
        .expect(422);
      expect([await reportRow(old.id), await reportRow(replacement.id)]).toEqual(before);
      expect(
        (await reportAudits(old.id)).filter((a) => a.metadata.apiId === "API-RPT-009"),
      ).toHaveLength(0);
    });

    it("allows exactly one of two concurrent supersedes of the same old report", async () => {
      const { f, old, replacement } = await releasedPair();
      const third = await createReport(f.id, { draftContent: {} }, admin);
      await forceReport(third.id, "RELEASED");
      const responses = await Promise.all([
        http("post", `/admin/reports/${old.id}/supersede`, admin).send({
          expectedStateVersion: 1,
          replacementReportId: replacement.id,
        }),
        http("post", `/admin/reports/${old.id}/supersede`, admin).send({
          expectedStateVersion: 1,
          replacementReportId: third.id,
        }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      const linked = (
        await db.execute(
          sql`select id from security_reports where supersedes_report_id = ${old.id}`,
        )
      ).rows;
      expect(linked).toHaveLength(1);
      expect((await reportRow(old.id)).state_version).toBe(2);
    });

    it("never links one replacement to two predecessors, even concurrently", async () => {
      const f = await fixture("COMPLETED");
      const ids: string[] = [];
      for (let index = 0; index < 3; index++) {
        const created = await createReport(f.id, { draftContent: {} }, admin);
        await forceReport(created.id, "RELEASED");
        ids.push(created.id);
      }
      const [v1, v2, v3] = ids;
      const responses = await Promise.all([
        http("post", `/admin/reports/${v1}/supersede`, admin).send({
          expectedStateVersion: 1,
          replacementReportId: v3,
        }),
        http("post", `/admin/reports/${v2}/supersede`, admin).send({
          expectedStateVersion: 1,
          replacementReportId: v3,
        }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      const rows = (
        await db.execute(
          sql`select id, status, supersedes_report_id from security_reports where assessment_id = ${f.id} order by version_no`,
        )
      ).rows as { status: string; supersedes_report_id: string | null }[];
      expect(rows.filter((r) => r.status === "SUPERSEDED")).toHaveLength(1);
      expect(rows.filter((r) => r.status === "RELEASED")).toHaveLength(2);
      expect(rows[2].supersedes_report_id).not.toBeNull();
    });
  });
});
