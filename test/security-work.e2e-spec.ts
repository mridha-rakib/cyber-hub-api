import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { securityAssessments, vulnerabilityFindings } from "../src/infrastructure/database/schema";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";
import { AuthModule } from "../src/modules/auth/auth.module";
import { AuditLogsRepository } from "../src/modules/auth/repositories/audit-logs.repository";
import { ConsultingRequestsRepository } from "../src/modules/consulting/repositories/consulting-requests.repository";

const DOMAIN = "wave5b-security.test";
let counter = 0;

describe("Wave 5B security operational HTTP APIs", () => {
  let app: INestApplication;
  let db: DatabaseConnection["db"];
  const emailPort: TransactionalEmailPort = {
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
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
    // Each case keeps the real rate limiter, with a fresh in-memory window.
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
  });

  afterAll(async () => {
    await db.execute(
      sql`delete from vulnerability_findings where employer_id in (select id from employers where email like ${`%@${DOMAIN}`} )`,
    );
    await db.execute(
      sql`delete from security_assessments where employer_id in (select id from employers where email like ${`%@${DOMAIN}`})`,
    );
    await db.execute(
      sql`delete from consulting_notes where consulting_request_id in (select id from consulting_requests where employer_id in (select id from employers where email like ${`%@${DOMAIN}`}))`,
    );
    await db.execute(
      sql`delete from security_scope_authorizations where employer_id in (select id from employers where email like ${`%@${DOMAIN}`})`,
    );
    await db.execute(
      sql`delete from audit_logs where actor_user_id in (select id from users where email like ${`%@${DOMAIN}`}) or employer_id in (select id from employers where email like ${`%@${DOMAIN}`})`,
    );
    await db.execute(
      sql`delete from consulting_requests where employer_id in (select id from employers where email like ${`%@${DOMAIN}`})`,
    );
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

  function auth(test: request.Test, actor: { cookie: string; token: string }) {
    return test.set("Cookie", actor.cookie).set("X-CSRF-Token", actor.token);
  }

  const requestBody = (label: string, extra: Record<string, unknown> = {}) => ({
    companyDetails: { name: `Wave 5B ${label}` },
    businessSize: "SME",
    securityConcern: "Validate external exposure",
    requestedService: "VULNERABILITY_ASSESSMENT",
    environmentDetails: { informationalOnly: true },
    contactInformation: { email: `${label}@example.test` },
    ...extra,
  });

  const scopeBody = (extra: Record<string, unknown> = {}) => ({
    authorizedTargets: ["example.test"],
    allowedActivities: ["VULNERABILITY_ASSESSMENT"],
    restrictions: ["production-safe"],
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    attestation: true,
    ...extra,
  });

  let businessA: Awaited<ReturnType<typeof registerBusiness>>;
  let businessB: Awaited<ReturnType<typeof registerBusiness>>;
  let consultantA: Awaited<ReturnType<typeof registerRole>>;
  let consultantB: Awaited<ReturnType<typeof registerRole>>;
  let admin: Awaited<ReturnType<typeof registerRole>>;

  type Actor = { userId: string; cookie: string; token: string };
  type ParentState = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  type FindingState = "OPEN" | "REMEDIATION_IN_PROGRESS" | "RESOLVED";
  const findingBody = {
    title: "Exposure",
    severity: "HIGH",
    description: "RESTRICTED_DESCRIPTION",
    evidenceSummary: "RESTRICTED_EVIDENCE",
    recommendation: "Limit access",
  };
  function http(method: "get" | "post" | "patch", path: string, actor: Actor = consultantA) {
    return auth(request(app.getHttpServer())[method](`/api/v1${path}`), actor);
  }
  async function fixture(parent: ParentState = "PLANNED", finding?: FindingState) {
    const created = await http("post", "/business/consulting-requests", businessA)
      .send(requestBody("fixture"))
      .expect(201);
    const requestId = created.body.data.id as string;
    await http("post", `/admin/consulting-requests/${requestId}/assign-consultant`, admin)
      .send({ consultantUserId: consultantA.userId })
      .expect(200);
    await http("post", `/business/consulting-requests/${requestId}/scope-authorizations`, businessA)
      .send(scopeBody())
      .expect(201);
    await db.execute(
      sql`update consulting_requests set status = 'ACCEPTED', state_version = 3 where id = ${requestId}`,
    );
    const assessment = (
      await http("post", `/consulting/requests/${requestId}/assessments`).send({}).expect(201)
    ).body.data;
    await db
      .update(securityAssessments)
      .set({ status: parent })
      .where(eq(securityAssessments.id, assessment.id));
    let findingId: string | undefined;
    if (finding) {
      const [row] = await db
        .insert(vulnerabilityFindings)
        .values({
          ...findingBody,
          severity: "HIGH",
          status: finding,
          assessmentId: assessment.id,
          employerId: assessment.employerId,
          createdByUserId: consultantA.userId,
          resolvedAt: finding === "RESOLVED" ? new Date() : null,
        })
        .returning();
      findingId = row.id;
    }
    return { ...assessment, requestId, findingId } as {
      id: string;
      employerId: string;
      scopeAuthorizationId: string;
      requestId: string;
      findingId?: string;
    };
  }
  async function domainAudits(id: string) {
    return (
      await db.execute(
        sql`select * from audit_logs where entity_id = ${id} and action in ('security.assessment.mutated', 'security.finding.mutated') order by timestamp, id`,
      )
    ).rows;
  }
  async function invalidScope(id: string, kind: string) {
    if (kind === "missing") {
      await db.execute(
        sql`update security_scope_authorizations set is_current = false where id = ${id}`,
      );
    } else if (kind === "expired") {
      await db.execute(
        sql`update security_scope_authorizations set valid_from = now() - interval '2 hours', valid_until = now() - interval '1 hour' where id = ${id}`,
      );
    } else if (kind === "future") {
      await db.execute(
        sql`update security_scope_authorizations set valid_from = now() + interval '1 hour', valid_until = now() + interval '2 hours' where id = ${id}`,
      );
    } else if (kind === "revoked") {
      await db.execute(
        sql`update security_scope_authorizations set revoked_at = now() where id = ${id}`,
      );
    } else if (kind === "targets") {
      await db.execute(
        sql`update security_scope_authorizations set authorized_targets = '[]'::jsonb where id = ${id}`,
      );
    } else if (kind === "activity") {
      await db.execute(
        sql`update security_scope_authorizations set allowed_activities = '["CLOUD_REVIEW"]'::jsonb where id = ${id}`,
      );
    } else {
      const other = await fixture();
      await db
        .update(securityAssessments)
        .set({ scopeAuthorizationId: other.scopeAuthorizationId })
        .where(eq(securityAssessments.scopeAuthorizationId, id));
    }
  }

  it("derives assessment fields, supports Admin creation, conceals unassigned access, and rejects forged fields", async () => {
    const f = await fixture();
    const created = await http("post", `/consulting/requests/${f.requestId}/assessments`, admin)
      .send({})
      .expect(201);
    expect(created.body.data).toMatchObject({
      status: "PLANNED",
      stateVersion: 1,
      employerId: f.employerId,
      service: "VULNERABILITY_ASSESSMENT",
      assignedConsultantId: consultantA.userId,
      scopeAuthorizationId: f.scopeAuthorizationId,
    });
    await http("post", `/consulting/requests/${f.requestId}/assessments`, consultantB)
      .send({})
      .expect(404);
    for (const field of [
      "employerId",
      "consultingRequestId",
      "scopeAuthorizationId",
      "assignedConsultantId",
      "service",
      "scopeSnapshot",
      "status",
      "stateVersion",
      "startedAt",
    ]) {
      await http("post", `/consulting/requests/${f.requestId}/assessments`)
        .send({ [field]: f.id })
        .expect(422);
    }
    await http("get", `/assessments/${f.id}`, admin).expect(200);
    await http("get", `/assessments/${f.id}`, businessA).expect(403);
    await http("get", `/assessments/${f.id}`, businessB).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/assessments/${f.id}`).expect(401);
    await http("get", "/assessments/not-a-uuid").expect(422);
  });
  it.each(["SUBMITTED", "UNDER_REVIEW", "DECLINED", "IN_PROGRESS", "COMPLETED"])(
    "rejects creation from request state %s",
    async (status) => {
      const f = await fixture();
      await db.execute(
        sql`update consulting_requests set status = ${status} where id = ${f.requestId}`,
      );
      const response = await http("post", `/consulting/requests/${f.requestId}/assessments`)
        .send({})
        .expect(409);
      expect(response.body.error.code).toBe("STATE_CONFLICT");
    },
  );
  it.each(["missing", "expired", "future", "revoked", "targets", "activity"])(
    "denies scope %s on creation/start/complete/finding writes for both operational roles",
    async (kind) => {
      const f = await fixture("IN_PROGRESS", "RESOLVED");
      await invalidScope(f.scopeAuthorizationId, kind);
      for (const actor of [consultantA, admin]) {
        await http("post", `/consulting/requests/${f.requestId}/assessments`, actor)
          .send({})
          .expect(404);
        await http("post", `/assessments/${f.id}/start`, actor)
          .send({ expectedStateVersion: 1 })
          .expect(404);
        await http("post", `/assessments/${f.id}/complete`, actor)
          .send({ expectedStateVersion: 1 })
          .expect(404);
        await http("post", `/assessments/${f.id}/findings`, actor).send(findingBody).expect(404);
        await http("patch", `/findings/${f.findingId}`, actor)
          .send({ expectedStateVersion: 1, title: "Changed" })
          .expect(404);
        await http("post", `/findings/${f.findingId}/resolve`, actor)
          .send({ expectedStateVersion: 1, verificationNote: "Verified" })
          .expect(404);
        await http("post", `/findings/${f.findingId}/reopen`, actor)
          .send({ expectedStateVersion: 1, reason: "Recurred" })
          .expect(404);
        await http("get", `/assessments/${f.id}`, actor).expect(200);
        await http("get", `/findings/${f.findingId}`, actor).expect(200);
      }
    },
  );
  it("uses the exact linked scope and never treats snapshot or other employer scope as authority", async () => {
    const f = await fixture("IN_PROGRESS", "OPEN");
    await invalidScope(f.scopeAuthorizationId, "wrong-link");
    await http("post", `/assessments/${f.id}/complete`)
      .send({ expectedStateVersion: 1 })
      .expect(404);
    await http("post", `/findings/${f.findingId}/resolve`)
      .send({ expectedStateVersion: 1, verificationNote: "Verified" })
      .expect(404);
    const other = await fixture();
    await http(
      "post",
      `/business/consulting-requests/${other.requestId}/scope-authorizations`,
      businessA,
    )
      .send(scopeBody())
      .expect(201);
    await http("post", `/assessments/${other.id}/start`)
      .send({ expectedStateVersion: 1 })
      .expect(404);
  });
  it("starts and completes with server timestamps, named audit transitions and typed conflicts", async () => {
    const f = await fixture();
    await http("post", `/assessments/${f.id}/complete`)
      .send({ expectedStateVersion: 1 })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("STATE_CONFLICT"));
    const started = await http("post", `/assessments/${f.id}/start`)
      .send({ expectedStateVersion: 1 })
      .expect(200);
    expect(started.body.data.startedAt).toBeTruthy();
    expect(started.body.data.stateVersion).toBe(2);
    await http("post", `/assessments/${f.id}/start`)
      .send({ expectedStateVersion: 2 })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("STATE_CONFLICT"));
    await http("post", `/assessments/${f.id}/complete`)
      .send({ expectedStateVersion: 1 })
      .expect(409)
      .expect(({ body }) =>
        expect(body.error).toMatchObject({
          code: "STATE_VERSION_CONFLICT",
          details: { currentStateVersion: 2 },
        }),
      );
    const completed = await http("post", `/assessments/${f.id}/complete`)
      .send({ expectedStateVersion: 2 })
      .expect(200);
    expect(completed.body.data).toMatchObject({ status: "COMPLETED", stateVersion: 3 });
    expect(completed.body.data.completedAt).toBeTruthy();
    await http("post", `/assessments/${f.id}/complete`)
      .send({ expectedStateVersion: 3 })
      .expect(409);
    const audits = await domainAudits(f.id);
    expect(audits.map((r) => (r.metadata as { transitionId: string }).transitionId)).toEqual([
      "WF-ASM-01",
      "WF-ASM-02",
      "WF-ASM-03",
    ]);
    for (const row of audits)
      expect(row).toMatchObject({
        actor_user_id: consultantA.userId,
        actor_role: "ROLE_CONSULTANT",
        entity_type: "assessment",
        employer_id: f.employerId,
        request_id: expect.any(String),
      });
  });
  it.each(["PLANNED", "IN_PROGRESS"] as ParentState[])(
    "cancels %s only as Admin with reason even after scope revocation",
    async (parent) => {
      const f = await fixture(parent);
      await http("post", `/admin/assessments/${f.id}/cancel`)
        .send({ expectedStateVersion: 1, reason: "Stopped" })
        .expect(403);
      await http("post", `/admin/assessments/${f.id}/cancel`, admin)
        .send({ expectedStateVersion: 1 })
        .expect(422);
      await invalidScope(f.scopeAuthorizationId, "revoked");
      const cancelled = await http("post", `/admin/assessments/${f.id}/cancel`, admin)
        .send({ expectedStateVersion: 1, reason: "Stopped" })
        .expect(200);
      expect(cancelled.body.data.cancelledAt).toBeTruthy();
      expect(cancelled.body.data.status).toBe("CANCELLED");
      await http("post", `/admin/assessments/${f.id}/cancel`, admin)
        .send({ expectedStateVersion: 1, reason: "Again" })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe("STATE_VERSION_CONFLICT"));
      const audits = await domainAudits(f.id);
      expect(audits.at(-1)?.metadata).toMatchObject({
        reason: "Stopped",
        transitionId: parent === "PLANNED" ? "WF-ASM-04" : "WF-ASM-05",
      });
    },
  );
  it.each(["COMPLETED", "CANCELLED"] as ParentState[])(
    "rejects cancellation from terminal %s",
    async (parent) => {
      const f = await fixture(parent);
      await http("post", `/admin/assessments/${f.id}/cancel`, admin)
        .send({ expectedStateVersion: 1, reason: "Stopped" })
        .expect(409);
    },
  );
  it("enforces dual assignment for assessments/findings and propagates only active reassignment with safe audit", async () => {
    const f = await fixture("IN_PROGRESS", "OPEN");
    const active = await fixture("PLANNED");
    const completed = await fixture("COMPLETED");
    const cancelled = await fixture("CANCELLED");
    await db
      .update(securityAssessments)
      .set({ consultingRequestId: f.requestId })
      .where(sql`${securityAssessments.id} in (${active.id}, ${completed.id}, ${cancelled.id})`);
    await http("post", `/admin/consulting-requests/${f.requestId}/assign-consultant`, consultantB)
      .send({ consultantUserId: consultantB.userId })
      .expect(403);
    await http("post", `/admin/consulting-requests/${f.requestId}/assign-consultant`, admin)
      .send({ consultantUserId: consultantB.userId })
      .expect(200);
    const rows = (
      await db.execute(
        sql`select id, assigned_consultant_id from security_assessments where consulting_request_id = ${f.requestId}`,
      )
    ).rows;
    expect(
      rows
        .filter((r) => [f.id, active.id].includes(r.id as string))
        .every((r) => r.assigned_consultant_id === consultantB.userId),
    ).toBe(true);
    expect(
      rows
        .filter((r) => [completed.id, cancelled.id].includes(r.id as string))
        .every((r) => r.assigned_consultant_id === consultantA.userId),
    ).toBe(true);
    await http("get", `/assessments/${f.id}`).expect(404);
    await http("get", `/findings/${f.findingId}`).expect(404);
    await http("get", `/assessments/${f.id}`, consultantB).expect(200);
    await http("get", `/findings/${f.findingId}`, consultantB).expect(200);
    for (const actor of [consultantA, consultantB])
      await http("get", `/assessments/${completed.id}`, actor).expect(404);
    await http("get", `/assessments/${completed.id}`, admin).expect(200);
    const audit = (
      await db.execute(
        sql`select metadata from audit_logs where entity_id = ${f.requestId} and action = 'consulting.request.consultant_assigned' order by timestamp desc limit 1`,
      )
    ).rows[0];
    expect(audit.metadata).toMatchObject({
      oldConsultantId: consultantA.userId,
      newConsultantId: consultantB.userId,
      affectedAssessmentIds: expect.arrayContaining([f.id, active.id]),
    });
    expect(
      (audit.metadata as { affectedAssessmentIds: string[] }).affectedAssessmentIds,
    ).toHaveLength(2);
  });
  it("rolls back request assignment and active assessments if propagation fails", async () => {
    const f = await fixture();
    const repository = app.get(ConsultingRequestsRepository);
    const original = repository.propagateActiveAssignment.bind(repository);
    const spy = jest
      .spyOn(repository, "propagateActiveAssignment")
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error("Injected propagation failure");
      });
    try {
      await http("post", `/admin/consulting-requests/${f.requestId}/assign-consultant`, admin)
        .send({ consultantUserId: consultantB.userId })
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    const row = await repository.findById(f.requestId);
    expect(row?.assignedConsultantId).toBe(consultantA.userId);
    const [assessment] = await db
      .select()
      .from(securityAssessments)
      .where(eq(securityAssessments.id, f.id));
    expect(assessment.assignedConsultantId).toBe(consultantA.userId);
  });
  it.each([
    ["COMPLETED", undefined, 200],
    ["COMPLETED", "CANCELLED", 200],
    ["CANCELLED", undefined, 409],
    ["COMPLETED", "PLANNED", 409],
    ["COMPLETED", "IN_PROGRESS", 409],
  ] as const)("D-5 completion with %s + %s returns %s", async (first, second, code) => {
    const f = await fixture(first);
    if (second) {
      const other = await fixture(second);
      await db
        .update(securityAssessments)
        .set({ consultingRequestId: f.requestId })
        .where(eq(securityAssessments.id, other.id));
    }
    await db.execute(
      sql`update consulting_requests set status = 'IN_PROGRESS' where id = ${f.requestId}`,
    );
    await http("post", `/consulting/requests/${f.requestId}/complete`)
      .send({ expectedStateVersion: 3 })
      .expect(code);
  });
  it.each(["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as ParentState[])(
    "finding creation enforces parent %s and server ownership",
    async (parent) => {
      const f = await fixture(parent);
      const result = await http("post", `/assessments/${f.id}/findings`)
        .send(findingBody)
        .expect(parent === "IN_PROGRESS" ? 201 : 409);
      if (parent === "IN_PROGRESS")
        expect(result.body.data).toMatchObject({
          status: "OPEN",
          stateVersion: 1,
          employerId: f.employerId,
          assessmentId: f.id,
          createdByUserId: consultantA.userId,
        });
      await http("post", `/assessments/${f.id}/findings`, consultantB)
        .send(findingBody)
        .expect(404);
      if (parent === "IN_PROGRESS") {
        for (const field of [
          "employerId",
          "assessmentId",
          "createdByUserId",
          "status",
          "stateVersion",
          "resolvedAt",
        ]) {
          await http("post", `/assessments/${f.id}/findings`)
            .send({ ...findingBody, [field]: f.id })
            .expect(422);
        }
      }
    },
  );
  it.each(
    (["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as ParentState[]).flatMap((parent) =>
      (["OPEN", "REMEDIATION_IN_PROGRESS", "RESOLVED"] as FindingState[]).map(
        (state) => [parent, state] as const,
      ),
    ),
  )("PATCH D-3 parent %s finding %s applies equally to Admin", async (parent, state) => {
    const f = await fixture(parent, state);
    const allowed = parent === "IN_PROGRESS" && state !== "RESOLVED";
    const response = await http("patch", `/findings/${f.findingId}`, admin)
      .send({ expectedStateVersion: 1, title: "Changed" })
      .expect(allowed ? 200 : 409);
    if (allowed) {
      expect(response.body.data).toMatchObject({
        title: "Changed",
        stateVersion: 2,
        status: state,
      });
      const audit = (await domainAudits(f.findingId as string)).at(-1);
      expect(audit?.metadata).toMatchObject({ changedFields: ["title"] });
      expect(JSON.stringify(audit)).not.toContain("Changed");
    }
  });
  it("rejects forged PATCH fields and reports stale version without modifying evidence", async () => {
    const f = await fixture("IN_PROGRESS", "OPEN");
    for (const field of [
      "employerId",
      "assessmentId",
      "createdByUserId",
      "status",
      "stateVersion",
      "resolvedAt",
      "createdAt",
    ]) {
      await http("patch", `/findings/${f.findingId}`)
        .send({ expectedStateVersion: 1, [field]: f.id })
        .expect(422);
    }
    await http("patch", `/findings/${f.findingId}`).send({ title: "Changed" }).expect(422);
    await http("patch", `/findings/${f.findingId}`)
      .send({ expectedStateVersion: 1, severity: "CRITICAL" })
      .expect(200);
    await http("patch", `/findings/${f.findingId}`)
      .send({ expectedStateVersion: 1, title: "Changed" })
      .expect(409)
      .expect(({ body }) =>
        expect(body.error).toMatchObject({
          code: "STATE_VERSION_CONFLICT",
          details: { currentStateVersion: 2 },
        }),
      );
    await http("patch", `/findings/${f.findingId}`)
      .send({ expectedStateVersion: 2, severity: "UNKNOWN" })
      .expect(422);
  });
  it.each(
    (["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as ParentState[]).flatMap((parent) =>
      ["start-remediation", "resolve", "reopen"].map((command) => [parent, command] as const),
    ),
  )("finding command %s / %s enforces parent matrix including Admin", async (parent, command) => {
    const f = await fixture(parent, command === "reopen" ? "RESOLVED" : "OPEN");
    const body = {
      expectedStateVersion: 1,
      ...(command === "resolve"
        ? { verificationNote: "Verified remediation" }
        : command === "reopen"
          ? { reason: "Recurred" }
          : {}),
    };
    const response = await http("post", `/findings/${f.findingId}/${command}`, admin)
      .send(body)
      .expect(["IN_PROGRESS", "COMPLETED"].includes(parent) ? 200 : 409);
    if (["IN_PROGRESS", "COMPLETED"].includes(parent)) {
      expect(response.body.data.stateVersion).toBe(2);
      expect(response.body.data.status).toBe(
        command === "resolve"
          ? "RESOLVED"
          : command === "reopen"
            ? "OPEN"
            : "REMEDIATION_IN_PROGRESS",
      );
      expect(response.body.data.resolvedAt)[command === "resolve" ? "toBeTruthy" : "toBeNull"]();
      expect((await domainAudits(f.findingId as string)).at(-1)?.metadata).toHaveProperty(
        "transitionId",
      );
    }
  });
  it("resolves remediation, reopens clearing resolvedAt, preserves audit history and requires command notes", async () => {
    const f = await fixture("COMPLETED", "REMEDIATION_IN_PROGRESS");
    await http("post", `/findings/${f.findingId}/resolve`)
      .send({ expectedStateVersion: 1 })
      .expect(422);
    const resolved = await http("post", `/findings/${f.findingId}/resolve`)
      .send({ expectedStateVersion: 1, verificationNote: "Verified fix" })
      .expect(200);
    expect(resolved.body.data.resolvedAt).toBeTruthy();
    await http("post", `/findings/${f.findingId}/reopen`)
      .send({ expectedStateVersion: 2 })
      .expect(422);
    await http("post", `/findings/${f.findingId}/reopen`)
      .send({ expectedStateVersion: 1, reason: "Recurred" })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("STATE_VERSION_CONFLICT"));
    await http("post", `/findings/${f.findingId}/reopen`)
      .send({ expectedStateVersion: 2, reason: "Recurred" })
      .expect(200)
      .expect(({ body }) =>
        expect(body.data).toMatchObject({ status: "OPEN", resolvedAt: null, stateVersion: 3 }),
      );
    const rows = await domainAudits(f.findingId as string);
    expect(rows.map((r) => (r.metadata as { transitionId: string }).transitionId)).toEqual([
      "WF-FND-04",
      "WF-FND-05",
    ]);
    expect(rows[0].metadata).toMatchObject({ verificationNote: "Verified fix" });
    expect(rows[1].metadata).toMatchObject({ reason: "Recurred" });
    expect(JSON.stringify(rows)).not.toMatch(
      /RESTRICTED_EVIDENCE|RESTRICTED_DESCRIPTION|scopeSnapshot|authorizedTargets/,
    );
  });
  it("does not require AUTH_SCOPE for start-remediation, and still requires current assignment", async () => {
    const f = await fixture("COMPLETED", "OPEN");
    await invalidScope(f.scopeAuthorizationId, "revoked");
    await http("post", `/findings/${f.findingId}/start-remediation`, consultantB)
      .send({ expectedStateVersion: 1 })
      .expect(404);
    await http("post", `/findings/${f.findingId}/start-remediation`)
      .send({ expectedStateVersion: 1 })
      .expect(200);
    await http("post", `/findings/${f.findingId}/start-remediation`)
      .send({ expectedStateVersion: 1 })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("STATE_VERSION_CONFLICT"));
    await http("post", `/findings/${f.findingId}/start-remediation`)
      .send({ expectedStateVersion: 2 })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("STATE_CONFLICT"));
  });
  it("rolls back finding PATCH and creation when required domain audit fails", async () => {
    const f = await fixture("IN_PROGRESS", "OPEN");
    const audits = app.select(AuthModule).get(AuditLogsRepository, { strict: true });
    const original = audits.record.bind(audits);
    const spy = jest.spyOn(audits, "record").mockImplementation(async (entry) => {
      if (entry.action === "security.finding.mutated") throw new Error("Injected audit failure");
      return original(entry);
    });
    try {
      await http("patch", `/findings/${f.findingId}`)
        .send({ expectedStateVersion: 1, title: "Must rollback" })
        .expect(500);
      await http("post", `/assessments/${f.id}/findings`).send(findingBody).expect(500);
    } finally {
      spy.mockRestore();
    }
    const rows = await db
      .select()
      .from(vulnerabilityFindings)
      .where(eq(vulnerabilityFindings.assessmentId, f.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: findingBody.title, stateVersion: 1 });
    expect(await domainAudits(f.findingId as string)).toHaveLength(0);
  });
  it("allows only one concurrent assessment command and one concurrent finding PATCH", async () => {
    const f = await fixture("PLANNED", "OPEN");
    const responses = await Promise.all(
      [1, 2].map(() =>
        http("post", `/assessments/${f.id}/start`).send({ expectedStateVersion: 1 }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(responses.find((r) => r.status === 409)?.body.error).toMatchObject({
      code: "STATE_VERSION_CONFLICT",
      details: { currentStateVersion: 2 },
    });
    const writes = await Promise.all(
      [1, 2].map((n) =>
        http("patch", `/findings/${f.findingId}`).send({
          expectedStateVersion: 1,
          title: `Write ${n}`,
        }),
      ),
    );
    expect(writes.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await domainAudits(f.findingId as string)).toHaveLength(1);
  });
  it("filters and paginates operational lists without assignment or tenant leakage", async () => {
    const f = await fixture("IN_PROGRESS", "OPEN");
    for (let i = 0; i < 2; i++)
      await http("post", `/assessments/${f.id}/findings`)
        .send({ ...findingBody, title: `Page ${i}` })
        .expect(201);
    const first = await http(
      "get",
      `/assessments/${f.id}/findings?severity=HIGH&status=OPEN&limit=2`,
    ).expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.page.hasMore).toBe(true);
    const second = await http(
      "get",
      `/assessments/${f.id}/findings?severity=HIGH&status=OPEN&limit=2&cursor=${first.body.meta.page.nextCursor}`,
    ).expect(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    const assessments = await http(
      "get",
      `/assessments?status=IN_PROGRESS&service=VULNERABILITY_ASSESSMENT&limit=2`,
    ).expect(200);
    expect(assessments.body.meta.page.hasMore).toBe(true);
    await http("get", `/assessments?employerId=${f.employerId}`).expect(403);
    await http("get", `/assessments?employerId=${f.employerId}`, admin).expect(200);
    await http("get", `/assessments/${f.id}/findings`, consultantB).expect(404);
    await http(
      "get",
      `/assessments/${f.id}/findings?cursor=${assessments.body.meta.page.nextCursor}`,
    ).expect(422);
    for (const query of [
      "limit=101",
      "limit=0",
      "cursor=broken",
      "status=INVALID",
      "assignedConsultantId=spoof",
    ]) {
      await http("get", `/assessments?${query}`).expect(422);
    }
    const otherList = await http("get", "/assessments?limit=100", consultantB).expect(200);
    expect(otherList.body.data.map((r: { id: string }) => r.id)).not.toContain(f.id);
  });

  it.each(["assignment", "cancellation", "scope-replacement"])(
    "rechecks %s after the permission guard before a finding PATCH",
    async (change) => {
      const f = await fixture("IN_PROGRESS", "OPEN");
      const repository = app.get(ConsultingRequestsRepository);
      const original = repository.lockById.bind(repository);
      let unblock = () => {};
      let notify = () => {};
      const paused = new Promise<void>((resolve) => {
        notify = resolve;
      });
      const release = new Promise<void>((resolve) => {
        unblock = resolve;
      });
      const spy = jest.spyOn(repository, "lockById").mockImplementationOnce(async (id) => {
        notify();
        await release;
        return original(id);
      });
      const pending = http("patch", `/findings/${f.findingId}`)
        .send({ expectedStateVersion: 1, title: "Forbidden race write" })
        .then((response) => response);
      try {
        await paused;
        if (change === "assignment") {
          await http("post", `/admin/consulting-requests/${f.requestId}/assign-consultant`, admin)
            .send({ consultantUserId: consultantB.userId })
            .expect(200);
        } else if (change === "cancellation") {
          await http("post", `/admin/assessments/${f.id}/cancel`, admin)
            .send({ expectedStateVersion: 1, reason: "Stopped" })
            .expect(200);
        } else {
          await http(
            "post",
            `/business/consulting-requests/${f.requestId}/scope-authorizations`,
            businessA,
          )
            .send(scopeBody())
            .expect(201);
        }
      } finally {
        unblock();
      }
      const result = await pending;
      spy.mockRestore();
      expect(result.status).toBe(change === "cancellation" ? 409 : 404);
      const [row] = await db
        .select()
        .from(vulnerabilityFindings)
        .where(eq(vulnerabilityFindings.id, f.findingId as string));
      expect(row).toMatchObject({ title: findingBody.title, stateVersion: 1 });
      expect(await domainAudits(row.id)).toHaveLength(0);
    },
  );
  it("denies mismatched assessment/request assignment even when either side alone matches", async () => {
    const f = await fixture("IN_PROGRESS", "OPEN");
    await db
      .update(securityAssessments)
      .set({ assignedConsultantId: consultantB.userId })
      .where(eq(securityAssessments.id, f.id));
    for (const actor of [consultantA, consultantB]) {
      await http("get", `/assessments/${f.id}`, actor).expect(404);
      await http("get", `/findings/${f.findingId}`, actor).expect(404);
      await http("post", `/assessments/${f.id}/findings`, actor).send(findingBody).expect(404);
      const list = await http("get", "/assessments?limit=100", actor).expect(200);
      expect(list.body.data.map((r: { id: string }) => r.id)).not.toContain(f.id);
    }
  });
  it("conceals inconsistent employer linkage for operational detail and finding list", async () => {
    const f = await fixture("IN_PROGRESS", "OPEN");
    const other = (
      await db.execute(sql`select employer_id from users where id = ${businessB.userId}`)
    ).rows[0].employer_id as string;
    await db
      .update(vulnerabilityFindings)
      .set({ employerId: other })
      .where(eq(vulnerabilityFindings.id, f.findingId as string));
    await http("get", `/findings/${f.findingId}`, admin).expect(404);
    const list = await http("get", `/assessments/${f.id}/findings`, admin).expect(200);
    expect(list.body.data).toHaveLength(0);
    await db
      .update(securityAssessments)
      .set({ employerId: other })
      .where(eq(securityAssessments.id, f.id));
    await http("get", `/assessments/${f.id}`, admin).expect(404);
  });
  it("does not create assessments without an assigned consultant or complete requests without linked completed work", async () => {
    const f = await fixture();
    await db.execute(
      sql`update consulting_requests set assigned_consultant_id = null where id = ${f.requestId}`,
    );
    await http("post", `/consulting/requests/${f.requestId}/assessments`, admin)
      .send({})
      .expect(409);
    await db.delete(securityAssessments).where(eq(securityAssessments.id, f.id));
    await db.execute(
      sql`update consulting_requests set status = 'IN_PROGRESS', assigned_consultant_id = ${consultantA.userId} where id = ${f.requestId}`,
    );
    await http("post", `/consulting/requests/${f.requestId}/complete`)
      .send({ expectedStateVersion: 3 })
      .expect(409);
  });
  it.each(["start-remediation", "resolve", "reopen"])(
    "finding command %s rejects the wrong finding state at the current version",
    async (command) => {
      const f = await fixture("IN_PROGRESS", command === "reopen" ? "OPEN" : "RESOLVED");
      await http("post", `/findings/${f.findingId}/${command}`)
        .send({
          expectedStateVersion: 1,
          ...(command === "resolve"
            ? { verificationNote: "Verified" }
            : command === "reopen"
              ? { reason: "Recurred" }
              : {}),
        })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe("STATE_CONFLICT"));
    },
  );
  it("keeps severity independent of lifecycle throughout resolution and reopening", async () => {
    const f = await fixture("IN_PROGRESS", "OPEN");
    let version = 1;
    for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
      await http("patch", `/findings/${f.findingId}`)
        .send({ expectedStateVersion: version++, severity })
        .expect(200)
        .expect(({ body }) => expect(body.data).toMatchObject({ status: "OPEN", severity }));
    }
    await http("post", `/findings/${f.findingId}/resolve`)
      .send({ expectedStateVersion: version++, verificationNote: "Verified" })
      .expect(200)
      .expect(({ body }) => expect(body.data.severity).toBe("LOW"));
    await http("post", `/findings/${f.findingId}/reopen`)
      .send({ expectedStateVersion: version, reason: "Recurred" })
      .expect(200)
      .expect(({ body }) => expect(body.data).toMatchObject({ severity: "LOW", status: "OPEN" }));
  });
  it("rolls back assessment start and its timestamp on domain audit failure", async () => {
    const f = await fixture();
    const audits = app.select(AuthModule).get(AuditLogsRepository, { strict: true });
    const original = audits.record.bind(audits);
    const spy = jest.spyOn(audits, "record").mockImplementation(async (entry) => {
      if (entry.action === "security.assessment.mutated") throw new Error("Injected audit failure");
      return original(entry);
    });
    try {
      await http("post", `/assessments/${f.id}/start`)
        .send({ expectedStateVersion: 1 })
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    const [row] = await db
      .select()
      .from(securityAssessments)
      .where(eq(securityAssessments.id, f.id));
    expect(row).toMatchObject({ status: "PLANNED", stateVersion: 1, startedAt: null });
    expect(await domainAudits(f.id)).toHaveLength(1);
  });

  it("rechecks request assignment under the D-5 completion lock after reassignment", async () => {
    const f = await fixture("COMPLETED");
    await db.execute(
      sql`update consulting_requests set status = 'IN_PROGRESS' where id = ${f.requestId}`,
    );
    const repository = app.get(ConsultingRequestsRepository);
    const original = repository.lockById.bind(repository);
    let unblock = () => {};
    let notify = () => {};
    const paused = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const release = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const spy = jest.spyOn(repository, "lockById").mockImplementationOnce(async (id) => {
      notify();
      await release;
      return original(id);
    });
    const pending = http("post", `/consulting/requests/${f.requestId}/complete`)
      .send({ expectedStateVersion: 3 })
      .then((response) => response);
    try {
      await paused;
      await http("post", `/admin/consulting-requests/${f.requestId}/assign-consultant`, admin)
        .send({ consultantUserId: consultantB.userId })
        .expect(200);
    } finally {
      unblock();
    }
    const result = await pending;
    spy.mockRestore();
    expect(result.status).toBe(404);
    expect(await repository.findById(f.requestId)).toMatchObject({
      status: "IN_PROGRESS",
      stateVersion: 3,
      completedAt: null,
    });
  });
});
