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
  securityReportFindings,
  securityReports,
  securityScores,
  vulnerabilityFindings,
} from "../src/infrastructure/database/schema";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";

/**
 * Wave 6C — Business security reads (API-SCR-003/004/005, API-RPT-010/011/012)
 * and operational score operations (API-SCR-001/002) against real local
 * Postgres. RELEASED/SUPERSEDED reports and score snapshots are seeded only in
 * this isolated test database: release is gated (GAP-013) and no methodology
 * exists (GAP-009), so neither can be produced through the API.
 */
const DOMAIN = "wave6c-security.test";
const SECRET = "RESTRICTED_DRAFT_MARKER_6C";
let counter = 0;

describe("Wave 6C Business security reads + operational score API", () => {
  let app: INestApplication;
  let db: DatabaseConnection["db"];
  const emailPort: TransactionalEmailPort = {
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "");
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
    await db.execute(sql`delete from security_scores where employer_id in ${employers}`);
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
  type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  type FindingState = "OPEN" | "REMEDIATION_IN_PROGRESS" | "RESOLVED";
  type Assessment = {
    id: string;
    employerId: string;
    scopeAuthorizationId: string;
    requestId: string;
  };
  let businessA: Actor;
  let businessB: Actor;
  let consultantA: Actor;
  let consultantB: Actor;
  let admin: Actor;

  function http(method: "get" | "post", path: string, actor: Actor) {
    return request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set("Cookie", actor.cookie)
      .set("X-CSRF-Token", actor.token);
  }

  async function fixture(parent: ParentState = "COMPLETED", business: Actor = businessA) {
    const created = await http("post", "/business/consulting-requests", business)
      .send({
        companyDetails: { name: "Wave 6C" },
        businessSize: "SME",
        securityConcern: "Validate external exposure",
        requestedService: "VULNERABILITY_ASSESSMENT",
        environmentDetails: { informationalOnly: true },
        contactInformation: { email: "wave6c@example.test" },
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
      await http("post", `/consulting/requests/${requestId}/assessments`, consultantA)
        .send({})
        .expect(201)
    ).body.data as Omit<Assessment, "requestId">;
    await db
      .update(securityAssessments)
      .set({ status: parent })
      .where(eq(securityAssessments.id, assessment.id));
    return { ...assessment, requestId } as Assessment;
  }
  async function finding(
    a: Assessment,
    severity: Severity = "HIGH",
    status: FindingState = "OPEN",
    createdAt?: Date,
  ) {
    const [row] = await db
      .insert(vulnerabilityFindings)
      .values({
        title: `Finding ${counter++}`,
        severity,
        description: "RESTRICTED_DESCRIPTION",
        evidenceSummary: "RESTRICTED_EVIDENCE",
        recommendation: "Limit access",
        status,
        assessmentId: a.id,
        employerId: a.employerId,
        createdByUserId: consultantA.userId,
        resolvedAt: status === "RESOLVED" ? new Date() : null,
        ...(createdAt ? { createdAt } : {}),
      })
      .returning();
    return row.id;
  }
  const versions = new Map<string, number>();
  async function report(a: Assessment, status: ReportState, findingIds: string[] = []) {
    const versionNo = (versions.get(a.id) ?? 0) + 1;
    versions.set(a.id, versionNo);
    const [row] = await db
      .insert(securityReports)
      .values({
        assessmentId: a.id,
        employerId: a.employerId,
        draftContent: { summary: SECRET },
        status,
        versionNo,
        preparedByUserId: consultantA.userId,
        reviewedByUserId: consultantA.userId,
        ...(status === "RELEASED" || status === "SUPERSEDED"
          ? { releasedAt: new Date(), releasedByUserId: admin.userId }
          : {}),
      })
      .returning();
    if (findingIds.length)
      await db
        .insert(securityReportFindings)
        .values(
          findingIds.map((findingId, sortOrder) => ({ reportId: row.id, findingId, sortOrder })),
        );
    return row.id;
  }
  async function score(
    a: Assessment,
    overall: string,
    calculatedAt: Date,
    categories: Partial<
      Record<"websiteSecurityScore" | "networkSecurityScore", string | null>
    > = {},
  ) {
    const [row] = await db
      .insert(securityScores)
      .values({
        employerId: a.employerId,
        assessmentId: a.id,
        overallScore: overall,
        methodologyVersion: "isolated-test-fixture",
        calculatedAt,
        ...categories,
      })
      .returning();
    return row.id;
  }
  const ids = (body: { data: { id: string }[] }) => body.data.map((row) => row.id);
  const FINDING_KEYS = ["createdAt", "id", "recommendation", "severity", "status", "title"];
  const SCORE_KEYS = [
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
  ];
  const RESTRICTED = [
    SECRET,
    "RESTRICTED_",
    "draftContent",
    "reportPath",
    "stateVersion",
    "preparedByUserId",
    "reviewedByUserId",
    "releasedByUserId",
    "supersedesReportId",
    "evidenceSummary",
    "description",
    "createdByUserId",
    "employerId",
    "calculatedByUserId",
    "scopeSnapshot",
  ];
  const expectNoRestricted = (body: unknown) => {
    const text = JSON.stringify(body);
    for (const token of RESTRICTED) expect(text).not.toContain(token);
  };

  describe("API-RPT-010/011/012 Business released-report reads", () => {
    it("shows only own RELEASED/SUPERSEDED reports with the exact client projection and live findings", async () => {
      const business = await registerBusiness("reports");
      const a = await fixture("COMPLETED", business);
      const f1 = await finding(a, "CRITICAL");
      const f2 = await finding(a, "LOW");
      const released = await report(a, "RELEASED", [f2, f1]);
      const superseded = await report(a, "SUPERSEDED", [f1]);
      const hidden = [
        await report(a, "DRAFT", [f1]),
        await report(a, "IN_REVIEW", [f1]),
        await report(a, "READY_FOR_RELEASE", [f1]),
      ];
      const list = await http("get", "/business/security/reports", business).expect(200);
      expect(ids(list.body).sort()).toEqual([released, superseded].sort());
      for (const row of list.body.data) {
        expect(Object.keys(row).sort()).toEqual(
          ["assessmentId", "downloadAvailable", "id", "releasedAt", "status", "versionNo"].sort(),
        );
        expect(row.downloadAvailable).toBe(false);
      }
      const detail = await http("get", `/business/security/reports/${released}`, business).expect(
        200,
      );
      expect(detail.body.data).toMatchObject({
        id: released,
        status: "RELEASED",
        downloadAvailable: false,
      });
      expect(detail.body.data.includedFindings.map((x: { id: string }) => x.id)).toEqual([f2, f1]);
      for (const item of detail.body.data.includedFindings)
        expect(Object.keys(item).sort()).toEqual(FINDING_KEYS.sort());
      expectNoRestricted([list.body, detail.body]);
      // Live values (D6-7): a later resolution shows on the historical report.
      await db
        .update(vulnerabilityFindings)
        .set({ status: "RESOLVED", resolvedAt: new Date() })
        .where(eq(vulnerabilityFindings.id, f1));
      const live = await http("get", `/business/security/reports/${superseded}`, business).expect(
        200,
      );
      expect(live.body.data.status).toBe("SUPERSEDED");
      expect(live.body.data.includedFindings[0]).toMatchObject({ id: f1, status: "RESOLVED" });
      expect(live.body.data.includedFindings[0].resolvedAt).toBeTruthy();
      for (const id of hidden) {
        await http("get", `/business/security/reports/${id}`, business).expect(404);
        await http("get", `/business/security/reports/${id}/download`, business).expect(404);
      }
      // Cross-ORG and missing are indistinguishable.
      await http("get", `/business/security/reports/${released}`, businessB).expect(404);
      await http("get", `/business/security/reports/${released}/download`, businessB).expect(404);
      expect(ids((await http("get", "/business/security/reports", businessB)).body)).not.toContain(
        released,
      );
      await http(
        "get",
        "/business/security/reports/00000000-0000-4000-8000-000000000000",
        business,
      ).expect(404);
      for (const actor of [consultantA, admin]) {
        await http("get", "/business/security/reports", actor).expect(403);
        await http("get", `/business/security/reports/${released}`, actor).expect(403);
        await http("get", `/business/security/reports/${released}/download`, actor).expect(403);
      }
      await http("get", "/business/security/reports/not-a-uuid", business).expect(422);
      await request(app.getHttpServer()).get("/api/v1/business/security/reports").expect(401);
    });

    it("gates every visible download with FILE_POLICY_NOT_CONFIGURED after visibility checks and changes nothing", async () => {
      const a = await fixture("COMPLETED");
      const released = await report(a, "RELEASED");
      const superseded = await report(a, "SUPERSEDED");
      for (const id of [released, superseded]) {
        const before = (await db.execute(sql`select * from security_reports where id = ${id}`))
          .rows;
        const auditsBefore = (
          await db.execute(sql`select count(*)::int as n from audit_logs where entity_id = ${id}`)
        ).rows;
        await http("get", `/business/security/reports/${id}/download`, businessA)
          .expect(409)
          .expect(({ body }) => {
            expect(body.error.code).toBe("FILE_POLICY_NOT_CONFIGURED");
            expect(body.error.details).toBeUndefined();
          });
        expect(
          (await db.execute(sql`select * from security_reports where id = ${id}`)).rows,
        ).toEqual(before);
        expect(
          (await db.execute(sql`select count(*)::int as n from audit_logs where entity_id = ${id}`))
            .rows,
        ).toEqual(auditsBefore);
      }
      await http(
        "get",
        "/business/security/reports/00000000-0000-4000-8000-000000000000/download",
        businessA,
      ).expect(404);
    });

    it("conceals reports whose report/assessment/request employer linkage is broken", async () => {
      const a = await fixture("COMPLETED");
      const other = await fixture("COMPLETED", businessB);
      const id = await report(a, "RELEASED");
      await db
        .update(securityReports)
        .set({ employerId: other.employerId })
        .where(eq(securityReports.id, id));
      for (const actor of [businessA, businessB]) {
        await http("get", `/business/security/reports/${id}`, actor).expect(404);
        expect(
          ids((await http("get", "/business/security/reports?limit=100", actor)).body),
        ).not.toContain(id);
      }
    });

    it("paginates with a report-only cursor and rejects unknown filters", async () => {
      const business = await registerBusiness("report-pages");
      const a = await fixture("COMPLETED", business);
      const created = [
        await report(a, "RELEASED"),
        await report(a, "SUPERSEDED"),
        await report(a, "RELEASED"),
      ];
      const first = await http("get", "/business/security/reports?limit=2", business).expect(200);
      expect(ids(first.body)).toEqual([created[2], created[1]]);
      expect(first.body.meta.page).toMatchObject({ limit: 2, hasMore: true });
      const cursor = first.body.meta.page.nextCursor as string;
      const second = await http(
        "get",
        `/business/security/reports?limit=2&cursor=${cursor}`,
        business,
      ).expect(200);
      expect(ids(second.body)).toEqual([created[0]]);
      expect(second.body.meta.page).toEqual({ limit: 2, hasMore: false, nextCursor: null });
      await http("get", `/business/security/findings?cursor=${cursor}`, business).expect(422);
      await http("get", `/business/security/scores?cursor=${cursor}`, business).expect(422);
      for (const query of [
        "employerId=x",
        "organizationId=x",
        "status=RELEASED",
        "limit=101",
        "cursor=x",
      ])
        await http("get", `/business/security/reports?${query}`, business).expect(422);
      const replay = await http(
        "get",
        `/business/security/reports?cursor=${cursor}&limit=100`,
        businessB,
      ).expect(200);
      for (const id of created) expect(ids(replay.body)).not.toContain(id);
    });
  });

  describe("API-SCR-004 Business findings (D-1)", () => {
    it("lists each RELEASED/SUPERSEDED-reported own finding exactly once with live values", async () => {
      const business = await registerBusiness("findings");
      const a = await fixture("COMPLETED", business);
      const twoReleased = await finding(a, "CRITICAL");
      const releasedAndSuperseded = await finding(a, "HIGH", "REMEDIATION_IN_PROGRESS");
      const twoSuperseded = await finding(a, "MEDIUM", "RESOLVED");
      const draftOnly = await finding(a, "LOW");
      const unreported = await finding(a, "LOW");
      await report(a, "RELEASED", [twoReleased, releasedAndSuperseded]);
      await report(a, "RELEASED", [twoReleased]);
      await report(a, "SUPERSEDED", [releasedAndSuperseded, twoSuperseded]);
      await report(a, "SUPERSEDED", [twoSuperseded]);
      await report(a, "DRAFT", [draftOnly]);
      await report(a, "READY_FOR_RELEASE", [draftOnly, unreported]);
      const other = await fixture("COMPLETED", businessB);
      const foreign = await finding(other, "CRITICAL");
      await report(other, "RELEASED", [foreign]);

      const list = await http("get", "/business/security/findings?limit=100", business).expect(200);
      expect(ids(list.body).sort()).toEqual(
        [twoReleased, releasedAndSuperseded, twoSuperseded].sort(),
      );
      for (const row of list.body.data) {
        const keys = row.status === "RESOLVED" ? [...FINDING_KEYS, "resolvedAt"] : FINDING_KEYS;
        expect(Object.keys(row).sort()).toEqual(keys.sort());
      }
      expectNoRestricted(list.body);
      const severity = await http(
        "get",
        "/business/security/findings?severity=CRITICAL",
        business,
      ).expect(200);
      expect(ids(severity.body)).toEqual([twoReleased]);
      const resolved = await http(
        "get",
        "/business/security/findings?status=RESOLVED",
        business,
      ).expect(200);
      expect(ids(resolved.body)).toEqual([twoSuperseded]);
      // Unique-row pagination: no duplicates across pages.
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: request.Response = await http(
          "get",
          `/business/security/findings?limit=1${cursor ? `&cursor=${cursor}` : ""}`,
          business,
        ).expect(200);
        seen.push(...ids(page.body));
        cursor = page.body.meta.page.nextCursor;
      } while (cursor);
      expect(seen).toHaveLength(3);
      expect(new Set(seen).size).toBe(3);
      for (const query of [
        "employerId=x",
        "organizationId=x",
        "severity=INFO",
        "status=X",
        "foo=1",
      ])
        await http("get", `/business/security/findings?${query}`, business).expect(422);
      for (const actor of [consultantA, admin])
        await http("get", "/business/security/findings", actor).expect(403);
    });
  });

  describe("API-SCR-005 score history and SCR-003 current score (D6-2, D6C-3)", () => {
    it("returns only release-eligible snapshots as JSON numbers, newest first, with null categories", async () => {
      const business = await registerBusiness("scores");
      const current = await fixture("COMPLETED", business);
      const historical = await fixture("COMPLETED", business);
      const unreleased = await fixture("COMPLETED", business);
      await report(current, "RELEASED");
      await report(current, "RELEASED");
      await report(historical, "SUPERSEDED");
      await report(unreleased, "READY_FOR_RELEASE");
      const t = Date.now();
      const s1 = await score(current, "87.50", new Date(t - 30_000), {
        websiteSecurityScore: "100.00",
        networkSecurityScore: "0.01",
      });
      const s2 = await score(current, "0.00", new Date(t - 20_000));
      const s3 = await score(historical, "99.99", new Date(t - 10_000));
      await score(unreleased, "50.00", new Date(t));

      const history = await http("get", "/business/security/scores", business).expect(200);
      expect(ids(history.body)).toEqual([s3, s2, s1]);
      for (const row of history.body.data)
        expect(Object.keys(row).sort()).toEqual(SCORE_KEYS.sort());
      const byId = Object.fromEntries(history.body.data.map((r: { id: string }) => [r.id, r]));
      expect(byId[s1]).toMatchObject({
        overallScore: 87.5,
        websiteSecurityScore: 100,
        networkSecurityScore: 0.01,
        emailSecurityScore: null,
      });
      expect(byId[s2].overallScore).toBe(0);
      expect(byId[s3].overallScore).toBe(99.99);
      expect(JSON.stringify(history.body)).not.toMatch(/"overallScore":"/);
      expectNoRestricted(history.body);

      // Current score: SUPERSEDED-only s3 is excluded; the genuine 0 is not null.
      const dashboard = await http("get", "/business/security/dashboard", business).expect(200);
      expect(dashboard.body.data.currentScore).toMatchObject({ id: s2, overallScore: 0 });
      expect(Object.keys(dashboard.body.data.currentScore).sort()).toEqual(SCORE_KEYS.sort());

      const first = await http("get", "/business/security/scores?limit=2", business).expect(200);
      expect(first.body.meta.page.hasMore).toBe(true);
      const rest = await http(
        "get",
        `/business/security/scores?limit=2&cursor=${first.body.meta.page.nextCursor}`,
        business,
      ).expect(200);
      expect([...ids(first.body), ...ids(rest.body)]).toEqual([s3, s2, s1]);
      expect(
        ids((await http("get", "/business/security/scores?limit=100", businessB)).body),
      ).not.toContain(s1);
      for (const query of ["employerId=x", "limit=0", "assessmentId=x"])
        await http("get", `/business/security/scores?${query}`, business).expect(422);
      await http("get", "/business/security/scores", consultantA).expect(403);
    });

    it("breaks calculatedAt ties by id descending and returns null with no eligible snapshot", async () => {
      const business = await registerBusiness("score-ties");
      const a = await fixture("COMPLETED", business);
      await report(a, "RELEASED");
      const at = new Date(Date.now() - 5_000);
      const tied = [await score(a, "10.00", at), await score(a, "20.00", at)].sort().reverse();
      const history = await http("get", "/business/security/scores", business).expect(200);
      expect(ids(history.body)).toEqual(tied);
      const dashboard = await http("get", "/business/security/dashboard", business).expect(200);
      expect(dashboard.body.data.currentScore.id).toBe(tied[0]);

      const none = await registerBusiness("score-none");
      const b = await fixture("COMPLETED", none);
      await report(b, "SUPERSEDED");
      await score(b, "75.00", new Date());
      const empty = await http("get", "/business/security/dashboard", none).expect(200);
      expect(empty.body.data.currentScore).toBeNull();
    });
  });

  describe("API-SCR-003 Business security dashboard (D6C-1)", () => {
    it("returns exactly the four-property empty payload for a Business with no data", async () => {
      const fresh = await registerBusiness("empty");
      const response = await http("get", "/business/security/dashboard", fresh).expect(200);
      expect(response.body.data).toEqual({
        currentScore: null,
        openRiskCounts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
        recentAssessments: [],
        recommendedActions: [],
      });
      for (const actor of [consultantA, admin])
        await http("get", "/business/security/dashboard", actor).expect(403);
      await request(app.getHttpServer()).get("/api/v1/business/security/dashboard").expect(401);
    });

    it("counts distinct currently-RELEASED open findings and orders bounded previews deterministically", async () => {
      const business = await registerBusiness("dashboard");
      const a = await fixture("COMPLETED", business);
      const base = Date.now() - 100_000;
      const at = (offset: number) => new Date(base + offset);
      const critical = await finding(a, "CRITICAL", "OPEN", at(1));
      const highOld = await finding(a, "HIGH", "REMEDIATION_IN_PROGRESS", at(2));
      const highNew = await finding(a, "HIGH", "OPEN", at(3));
      const medium = await finding(a, "MEDIUM", "OPEN", at(4));
      const low1 = await finding(a, "LOW", "OPEN", at(5));
      const low2 = await finding(a, "LOW", "OPEN", at(6));
      const resolved = await finding(a, "CRITICAL", "RESOLVED", at(7));
      const supersededOnly = await finding(a, "CRITICAL", "OPEN", at(8));
      const draftOnly = await finding(a, "HIGH", "OPEN", at(9));
      await report(a, "RELEASED", [critical, highOld, highNew, medium, low1, low2, resolved]);
      await report(a, "RELEASED", [critical, highNew]);
      await report(a, "SUPERSEDED", [supersededOnly, critical]);
      await report(a, "DRAFT", [draftOnly]);
      // Assessments of any status, no release dependency, at most 5.
      for (const status of ["PLANNED", "IN_PROGRESS", "CANCELLED", "COMPLETED", "PLANNED"] as const)
        await fixture(status, business);

      const response = await http("get", "/business/security/dashboard", business).expect(200);
      const data = response.body.data;
      expect(Object.keys(data).sort()).toEqual(
        ["currentScore", "openRiskCounts", "recentAssessments", "recommendedActions"].sort(),
      );
      expect(data.openRiskCounts).toEqual({ CRITICAL: 1, HIGH: 2, MEDIUM: 1, LOW: 2 });
      expect(data.currentScore).toBeNull();
      expect(data.recommendedActions.map((x: { id: string }) => x.id)).toEqual([
        critical,
        highNew,
        highOld,
        medium,
        low2,
      ]);
      for (const item of data.recommendedActions)
        expect(Object.keys(item).sort()).toEqual(FINDING_KEYS.sort());
      expect(data.recentAssessments).toHaveLength(5);
      expect(data.recentAssessments.map((x: { id: string }) => x.id)).not.toContain(a.id);
      for (const item of data.recentAssessments)
        expect(Object.keys(item).sort()).toEqual(
          ["completedAt", "createdAt", "id", "service", "startedAt", "status"].sort(),
        );
      const times = data.recentAssessments.map((x: { createdAt: string }) =>
        Date.parse(x.createdAt),
      );
      expect([...times].sort((x, y) => y - x)).toEqual(times);
      expectNoRestricted(response.body);
      // Another ORG sees none of it.
      const other = await http("get", "/business/security/dashboard", businessB).expect(200);
      expect(JSON.stringify(other.body)).not.toContain(critical);
    });

    it("drops SUPERSEDED-only history from current counts while keeping it in historical lists", async () => {
      const business = await registerBusiness("superseded-only");
      const a = await fixture("COMPLETED", business);
      const f = await finding(a, "CRITICAL", "OPEN");
      await report(a, "SUPERSEDED", [f]);
      await score(a, "40.00", new Date());
      const dashboard = await http("get", "/business/security/dashboard", business).expect(200);
      expect(dashboard.body.data.openRiskCounts).toEqual({
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
      });
      expect(dashboard.body.data.recommendedActions).toEqual([]);
      expect(dashboard.body.data.currentScore).toBeNull();
      expect(dashboard.body.data.recentAssessments.map((x: { id: string }) => x.id)).toEqual([
        a.id,
      ]);
      expect(ids((await http("get", "/business/security/findings", business)).body)).toEqual([f]);
      expect((await http("get", "/business/security/scores", business)).body.data).toHaveLength(1);
    });
  });

  describe("API-SCR-001 methodology gate and API-SCR-002 operational history", () => {
    const scoreRows = async (assessmentId: string) =>
      (
        (
          await db.execute(
            sql`select count(*)::int as n from security_scores where assessment_id = ${assessmentId}`,
          )
        ).rows[0] as { n: number }
      ).n;
    const rejections = async (assessmentId: string) =>
      (
        await db.execute(
          sql`select * from audit_logs where entity_id = ${assessmentId} and action = 'security.score.calculation_rejected' order by timestamp`,
        )
      ).rows as {
        actor_user_id: string;
        actor_role: string;
        employer_id: string;
        metadata: unknown;
      }[];

    it("audits and rejects authorised calculations with 409 and writes no score row", async () => {
      const a = await fixture("COMPLETED");
      for (const actor of [consultantA, admin])
        await http("post", `/assessments/${a.id}/security-scores/calculate`, actor)
          .send({ methodologyVersion: "v1" })
          .expect(409)
          .expect(({ body }) => expect(body.error.code).toBe("SCORE_METHODOLOGY_NOT_CONFIGURED"));
      const audits = await rejections(a.id);
      expect(audits.map((x) => [x.actor_user_id, x.actor_role])).toEqual([
        [consultantA.userId, "ROLE_CONSULTANT"],
        [admin.userId, "ROLE_ADMIN"],
      ]);
      for (const x of audits) {
        expect(x.employer_id).toBe(a.employerId);
        expect(x.metadata).toEqual({
          apiId: "API-SCR-001",
          assessmentId: a.id,
          reason: "SCORE_METHODOLOGY_NOT_CONFIGURED",
        });
      }
      expect(await scoreRows(a.id)).toBe(0);
    });

    it.each(["expired", "revoked", "missing"])(
      "denies a %s AUTH_SCOPE before the methodology gate, without a rejection audit",
      async (kind) => {
        const a = await fixture("COMPLETED");
        await db.execute(
          kind === "expired"
            ? sql`update security_scope_authorizations set valid_from = now() - interval '2 hours', valid_until = now() - interval '1 hour' where id = ${a.scopeAuthorizationId}`
            : kind === "revoked"
              ? sql`update security_scope_authorizations set revoked_at = now() where id = ${a.scopeAuthorizationId}`
              : sql`update security_scope_authorizations set is_current = false where id = ${a.scopeAuthorizationId}`,
        );
        for (const actor of [consultantA, admin]) {
          const response = await http(
            "post",
            `/assessments/${a.id}/security-scores/calculate`,
            actor,
          ).send({ methodologyVersion: "v1" });
          // security_score.calculate_assigned is CONCEAL_EXISTENCE: the established
          // Wave 5B precedence conceals AUTH_SCOPE denial as 404 for both roles.
          expect(response.status).toBe(404);
          expect(response.body.error.code).toBe("NOT_FOUND");
        }
        expect(await rejections(a.id)).toHaveLength(0);
        expect(await scoreRows(a.id)).toBe(0);
        // The operational history read carries no AUTH_SCOPE requirement.
        await http("get", `/assessments/${a.id}/security-scores`, consultantA).expect(200);
      },
    );

    it("enforces role, dual ASG, DTO and existence ahead of the methodology gate", async () => {
      const a = await fixture("COMPLETED");
      const path = `/assessments/${a.id}/security-scores/calculate`;
      await http("post", path, consultantB).send({ methodologyVersion: "v1" }).expect(404);
      for (const actor of [businessA, businessB])
        await http("post", path, actor).send({ methodologyVersion: "v1" }).expect(403);
      for (const body of [
        {},
        { methodologyVersion: "" },
        { methodologyVersion: "v1", overallScore: 90 },
      ])
        await http("post", path, consultantA).send(body).expect(422);
      await http(
        "post",
        "/assessments/00000000-0000-4000-8000-000000000000/security-scores/calculate",
        admin,
      )
        .send({ methodologyVersion: "v1" })
        .expect(404);
      await db.execute(
        sql`update consulting_requests set assigned_consultant_id = ${consultantB.userId} where id = ${a.requestId}`,
      );
      await http("post", path, consultantA).send({ methodologyVersion: "v1" }).expect(404);
      expect(await rejections(a.id)).toHaveLength(0);
      expect(await scoreRows(a.id)).toBe(0);
    });

    it("lists an assessment's snapshots for dual-ASG Consultant and Admin only", async () => {
      const a = await fixture("COMPLETED");
      const t = Date.now();
      const older = await score(a, "12.50", new Date(t - 2_000));
      const newer = await score(a, "100.00", new Date(t - 1_000));
      const list = await http("get", `/assessments/${a.id}/security-scores`, consultantA).expect(
        200,
      );
      expect(ids(list.body)).toEqual([newer, older]);
      expect(list.body.data[0].overallScore).toBe(100);
      expect(list.body.data[1].overallScore).toBe(12.5);
      for (const row of list.body.data) expect(Object.keys(row).sort()).toEqual(SCORE_KEYS.sort());
      const page = await http("get", `/assessments/${a.id}/security-scores?limit=1`, admin).expect(
        200,
      );
      const next = await http(
        "get",
        `/assessments/${a.id}/security-scores?limit=1&cursor=${page.body.meta.page.nextCursor}`,
        admin,
      ).expect(200);
      expect([...ids(page.body), ...ids(next.body)]).toEqual([newer, older]);
      // A cursor never widens scope to another assessment.
      const b = await fixture("COMPLETED");
      expect(
        ids(
          (
            await http(
              "get",
              `/assessments/${b.id}/security-scores?cursor=${page.body.meta.page.nextCursor}`,
              admin,
            )
          ).body,
        ),
      ).toEqual([]);
      await http("get", `/assessments/${a.id}/security-scores`, consultantB).expect(404);
      await http("get", `/assessments/${a.id}/security-scores`, businessA).expect(403);
      await http("get", `/assessments/${a.id}/security-scores?cursor=abc`, admin).expect(422);
      await http("get", `/assessments/${a.id}/security-scores?employerId=x`, admin).expect(422);
      await db.execute(
        sql`update security_assessments set assigned_consultant_id = ${consultantB.userId} where id = ${a.id}`,
      );
      await http("get", `/assessments/${a.id}/security-scores`, consultantA).expect(404);
      await http("get", `/assessments/${a.id}/security-scores`, consultantB).expect(404);
      await http("get", `/assessments/${a.id}/security-scores`, admin).expect(200);
    });
  });
});
