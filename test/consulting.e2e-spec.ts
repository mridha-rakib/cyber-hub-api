import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";

const DOMAIN = "wave4b-consulting.test";
let counter = 0;

describe("Wave 4B Consulting HTTP APIs", () => {
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

  afterAll(async () => {
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
    companyDetails: { name: `Wave 4B ${label}` },
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
  let requestId: string;
  let employerId: string;
  let currentScopeId: string;

  it("creates server-owned requests and enforces ORG projections and strict input", async () => {
    const created = await auth(
      request(app.getHttpServer()).post("/api/v1/business/consulting-requests"),
      businessA,
    )
      .send(requestBody("primary"))
      .expect(201);
    requestId = created.body.data.id;
    expect(created.body.data).toMatchObject({ status: "SUBMITTED", stateVersion: 1 });
    expect(created.body.data).not.toHaveProperty("employerId");
    expect(created.body.data).not.toHaveProperty("assignedConsultantId");

    const [row] = (
      await db.execute(
        sql`select employer_id, submitted_by_user_id from consulting_requests where id = ${requestId}`,
      )
    ).rows as Array<{ employer_id: string; submitted_by_user_id: string }>;
    employerId = row.employer_id;
    expect(row.submitted_by_user_id).toBe(businessA.userId);

    await auth(
      request(app.getHttpServer()).get(`/api/v1/business/consulting-requests/${requestId}`),
      businessA,
    ).expect(200);
    await auth(
      request(app.getHttpServer()).get(`/api/v1/business/consulting-requests/${requestId}`),
      businessB,
    ).expect(404);
    await auth(request(app.getHttpServer()).post("/api/v1/business/consulting-requests"), businessA)
      .send(requestBody("forged", { employerId }))
      .expect(422);
    await auth(request(app.getHttpServer()).post("/api/v1/business/consulting-requests"), businessA)
      .send(requestBody("unsupported", { requestedService: "OTHER" }))
      .expect(422);
  });

  it("versions explicit authorization, enforces attestation, and returns only own current scope", async () => {
    await auth(
      request(app.getHttpServer()).post(
        `/api/v1/business/consulting-requests/${requestId}/scope-authorizations`,
      ),
      businessA,
    )
      .send(scopeBody())
      .expect(201)
      .expect(({ body }) => expect(body.data.versionNo).toBe(1));
    const second = await auth(
      request(app.getHttpServer()).post(
        `/api/v1/business/consulting-requests/${requestId}/scope-authorizations`,
      ),
      businessA,
    )
      .send(scopeBody({ restrictions: ["second-version"] }))
      .expect(201);
    currentScopeId = second.body.data.id;
    expect(second.body.data.versionNo).toBe(2);
    const current = await auth(
      request(app.getHttpServer()).get(
        `/api/v1/business/consulting-requests/${requestId}/scope-authorizations/current`,
      ),
      businessA,
    ).expect(200);
    expect(current.body.data.id).toBe(currentScopeId);
    await auth(
      request(app.getHttpServer()).post(
        `/api/v1/business/consulting-requests/${requestId}/scope-authorizations`,
      ),
      businessA,
    )
      .send(scopeBody({ attestation: false }))
      .expect(422);
    await auth(
      request(app.getHttpServer()).get(
        `/api/v1/business/consulting-requests/${requestId}/scope-authorizations/current`,
      ),
      businessB,
    ).expect(404);
  });

  it("assigns/reassigns without workflow or AUTH_SCOPE mutation and enforces ASG", async () => {
    const assigned = await auth(
      request(app.getHttpServer()).post(
        `/api/v1/admin/consulting-requests/${requestId}/assign-consultant`,
      ),
      admin,
    )
      .send({ consultantUserId: consultantA.userId })
      .expect(200);
    expect(assigned.body.data).toMatchObject({ status: "SUBMITTED", stateVersion: 1 });
    const queue = await auth(
      request(app.getHttpServer()).get("/api/v1/consulting/requests"),
      consultantA,
    ).expect(200);
    expect(queue.body.data.map((row: { id: string }) => row.id)).toContain(requestId);
    await auth(
      request(app.getHttpServer()).get(`/api/v1/consulting/requests/${requestId}`),
      consultantB,
    ).expect(404);
    await auth(
      request(app.getHttpServer()).post(
        `/api/v1/admin/consulting-requests/${requestId}/assign-consultant`,
      ),
      admin,
    )
      .send({ consultantUserId: consultantA.userId })
      .expect(200);
  });

  it("uses atomic CAS and the centralized WF-REQ lifecycle", async () => {
    const calls = [
      auth(
        request(app.getHttpServer()).post(`/api/v1/consulting/requests/${requestId}/start-review`),
        consultantA,
      ).send({ expectedStateVersion: 1 }),
      auth(
        request(app.getHttpServer()).post(`/api/v1/consulting/requests/${requestId}/start-review`),
        consultantA,
      ).send({ expectedStateVersion: 1 }),
    ];
    const results = await Promise.all(calls);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    await auth(
      request(app.getHttpServer()).post(`/api/v1/consulting/requests/${requestId}/accept`),
      consultantA,
    )
      .send({ expectedStateVersion: 2 })
      .expect(200);
    await auth(
      request(app.getHttpServer()).post(`/api/v1/consulting/requests/${requestId}/start-delivery`),
      consultantA,
    )
      .send({ expectedStateVersion: 3, targetStatus: "IN_PROGRESS" })
      .expect(422);
    await auth(
      request(app.getHttpServer()).post(`/api/v1/consulting/requests/${requestId}/start-delivery`),
      consultantA,
    )
      .send({ expectedStateVersion: 3 })
      .expect(200);
  });

  it("proves authorization, internal-note privacy, and fail-closed completion", async () => {
    const note = await auth(
      request(app.getHttpServer()).post(`/api/v1/consulting/requests/${requestId}/notes`),
      consultantA,
    )
      .send({ body: "Internal operational note" })
      .expect(201);
    expect(note.body.data.body).toBe("Internal operational note");
    for (const body of ["Second internal note", "Third internal note"]) {
      await auth(
        request(app.getHttpServer()).post(`/api/v1/consulting/requests/${requestId}/notes`),
        consultantA,
      )
        .send({ body })
        .expect(201);
    }
    const notes = await auth(
      request(app.getHttpServer()).get(`/api/v1/consulting/requests/${requestId}/notes?limit=2`),
      consultantA,
    ).expect(200);
    expect(notes.body.data).toHaveLength(2);
    expect(notes.body.meta.page.hasMore).toBe(true);
    const nextNotes = await auth(
      request(app.getHttpServer()).get(
        `/api/v1/consulting/requests/${requestId}/notes?limit=2&cursor=${notes.body.meta.page.nextCursor}`,
      ),
      consultantA,
    ).expect(200);
    expect(nextNotes.body.data).toHaveLength(1);
    const businessView = await auth(
      request(app.getHttpServer()).get(`/api/v1/business/consulting-requests/${requestId}`),
      businessA,
    ).expect(200);
    expect(JSON.stringify(businessView.body.data)).not.toContain("Internal operational note");
    await auth(
      request(app.getHttpServer()).post(`/api/v1/consulting/requests/${requestId}/complete`),
      consultantA,
    )
      .send({ expectedStateVersion: 4 })
      .expect(409);

    await db.execute(
      sql`insert into security_assessments (employer_id, consulting_request_id, scope_authorization_id, service, scope_snapshot, assigned_consultant_id, status, completed_at) values (${employerId}, ${requestId}, ${currentScopeId}, 'VULNERABILITY_ASSESSMENT', ${JSON.stringify({ authorized: true })}::jsonb, ${consultantA.userId}, 'COMPLETED', now())`,
    );
    const completed = await auth(
      request(app.getHttpServer()).post(`/api/v1/consulting/requests/${requestId}/complete`),
      consultantA,
    )
      .send({ expectedStateVersion: 4 })
      .expect(200);
    expect(completed.body.data).toMatchObject({ status: "COMPLETED", stateVersion: 5 });
  });

  it("rejects assignment/acceptance/environment context as substitutes for AUTH_SCOPE", async () => {
    const created = await auth(
      request(app.getHttpServer()).post("/api/v1/business/consulting-requests"),
      businessA,
    )
      .send(requestBody("no-scope"))
      .expect(201);
    const id = created.body.data.id as string;
    await auth(
      request(app.getHttpServer()).post(
        `/api/v1/admin/consulting-requests/${id}/assign-consultant`,
      ),
      admin,
    )
      .send({ consultantUserId: consultantA.userId })
      .expect(200);
    await auth(
      request(app.getHttpServer()).post(`/api/v1/consulting/requests/${id}/start-review`),
      consultantA,
    )
      .send({ expectedStateVersion: 1 })
      .expect(200);
    await auth(
      request(app.getHttpServer()).post(`/api/v1/consulting/requests/${id}/accept`),
      consultantA,
    )
      .send({ expectedStateVersion: 2 })
      .expect(200);
    await auth(
      request(app.getHttpServer()).post(`/api/v1/consulting/requests/${id}/start-delivery`),
      consultantA,
    )
      .send({ expectedStateVersion: 3 })
      .expect(404);
    await auth(
      request(app.getHttpServer()).post(`/api/v1/consulting/requests/${id}/start-delivery`),
      admin,
    )
      .send({ expectedStateVersion: 3 })
      .expect(404);
    const deniedAudit = (
      await db.execute(
        sql`select action from audit_logs where metadata->>'apiId' = 'API-CON-012' and action = 'authorization.denied' order by "timestamp" desc limit 1`,
      )
    ).rows;
    expect(deniedAudit).toHaveLength(1);
  });

  it("rejects revoked, non-current, expired, and not-yet-valid scope while allowing Admin only with valid scope", async () => {
    async function fixture(
      label: string,
      options: { current?: boolean; revoked?: boolean; from: Date; until: Date },
    ) {
      const inserted = await db.execute(sql`insert into consulting_requests
        (employer_id, submitted_by_user_id, company_details, business_size, security_concern, requested_service, environment_details, contact_information, status, state_version, assigned_consultant_id, accepted_at)
        values (${employerId}, ${businessA.userId}, ${JSON.stringify({ name: label })}::jsonb, 'SME', 'scope test', 'VULNERABILITY_ASSESSMENT', ${JSON.stringify({ informationalOnly: true })}::jsonb, ${JSON.stringify({ email: `${label}@example.test` })}::jsonb, 'ACCEPTED', 3, ${consultantA.userId}, now()) returning id`);
      const id = (inserted.rows[0] as { id: string }).id;
      await db.execute(sql`insert into security_scope_authorizations
        (consulting_request_id, employer_id, version_no, authorized_targets, allowed_activities, restrictions, confirmed_by_user_id, confirmed_at, valid_from, valid_until, is_current, revoked_at)
        values (${id}, ${employerId}, 1, '["example.test"]'::jsonb, '["VULNERABILITY_ASSESSMENT"]'::jsonb, '[]'::jsonb, ${businessA.userId}, now(), ${options.from}, ${options.until}, ${options.current ?? true}, ${options.revoked ? new Date() : null})`);
      return id;
    }

    const now = Date.now();
    const denied = [
      await fixture("expired", { from: new Date(now - 120_000), until: new Date(now - 60_000) }),
      await fixture("future", { from: new Date(now + 60_000), until: new Date(now + 120_000) }),
      await fixture("revoked", {
        revoked: true,
        from: new Date(now - 60_000),
        until: new Date(now + 60_000),
      }),
      await fixture("non-current", {
        current: false,
        from: new Date(now - 60_000),
        until: new Date(now + 60_000),
      }),
    ];
    for (const id of denied) {
      await auth(
        request(app.getHttpServer()).post(`/api/v1/consulting/requests/${id}/start-delivery`),
        consultantA,
      )
        .send({ expectedStateVersion: 3 })
        .expect(404);
    }

    const valid = await fixture("admin-valid", {
      from: new Date(now - 60_000),
      until: new Date(now + 60_000),
    });
    await auth(
      request(app.getHttpServer()).post(`/api/v1/consulting/requests/${valid}/start-delivery`),
      admin,
    )
      .send({ expectedStateVersion: 3 })
      .expect(200);
  });

  it("supports stable opaque pagination with filters and rejects malformed/admin-only query input", async () => {
    const pageIds: string[] = [];
    for (let index = 0; index < 3; index++) {
      const created = await auth(
        request(app.getHttpServer()).post("/api/v1/business/consulting-requests"),
        businessA,
      )
        .send(requestBody(`page-${index}`))
        .expect(201);
      pageIds.push(created.body.data.id);
      await auth(
        request(app.getHttpServer()).post(
          `/api/v1/admin/consulting-requests/${created.body.data.id}/assign-consultant`,
        ),
        admin,
      )
        .send({ consultantUserId: consultantA.userId })
        .expect(200);
    }
    const first = await auth(
      request(app.getHttpServer()).get(
        "/api/v1/business/consulting-requests?status=SUBMITTED&limit=2",
      ),
      businessA,
    ).expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.page.hasMore).toBe(true);
    const second = await auth(
      request(app.getHttpServer()).get(
        `/api/v1/business/consulting-requests?status=SUBMITTED&limit=2&cursor=${first.body.meta.page.nextCursor}`,
      ),
      businessA,
    ).expect(200);
    expect(second.body.data.map((row: { id: string }) => row.id)).not.toContain(
      first.body.data[0].id,
    );
    const operationalFirst = await auth(
      request(app.getHttpServer()).get("/api/v1/consulting/requests?status=SUBMITTED&limit=2"),
      consultantA,
    ).expect(200);
    const operationalSecond = await auth(
      request(app.getHttpServer()).get(
        `/api/v1/consulting/requests?status=SUBMITTED&limit=2&cursor=${operationalFirst.body.meta.page.nextCursor}`,
      ),
      consultantA,
    ).expect(200);
    const operationalIds = [
      ...operationalFirst.body.data.map((row: { id: string }) => row.id),
      ...operationalSecond.body.data.map((row: { id: string }) => row.id),
    ];
    expect(pageIds.every((id) => operationalIds.includes(id))).toBe(true);
    await auth(
      request(app.getHttpServer()).get("/api/v1/business/consulting-requests?limit=101"),
      businessA,
    ).expect(422);
    await auth(
      request(app.getHttpServer()).get(`/api/v1/consulting/requests?employerId=${employerId}`),
      consultantA,
    ).expect(403);
    await auth(
      request(app.getHttpServer()).get(
        `/api/v1/consulting/requests/${requestId}/notes?cursor=${first.body.meta.page.nextCursor}`,
      ),
      consultantA,
    ).expect(422);
  });

  it("persists decline reason and all nine required safe authorization audits", async () => {
    const created = await auth(
      request(app.getHttpServer()).post("/api/v1/business/consulting-requests"),
      businessA,
    )
      .send(requestBody("decline"))
      .expect(201);
    const id = created.body.data.id as string;
    await auth(
      request(app.getHttpServer()).post(
        `/api/v1/admin/consulting-requests/${id}/assign-consultant`,
      ),
      admin,
    )
      .send({ consultantUserId: consultantA.userId })
      .expect(200);
    await auth(
      request(app.getHttpServer()).post(`/api/v1/consulting/requests/${id}/start-review`),
      consultantA,
    )
      .send({ expectedStateVersion: 1 })
      .expect(200);
    await auth(
      request(app.getHttpServer()).post(`/api/v1/consulting/requests/${id}/decline`),
      consultantA,
    )
      .send({ expectedStateVersion: 2, reason: "Outside supported engagement window" })
      .expect(200);
    const reasonRows = (
      await db.execute(
        sql`select metadata from audit_logs where entity_id = ${id} and action = 'consulting.request.declined'`,
      )
    ).rows as Array<{ metadata: { reason: string } }>;
    expect(reasonRows[0].metadata.reason).toBe("Outside supported engagement window");

    const required = [
      "API-CON-001",
      "API-CON-004",
      "API-CON-008",
      "API-CON-009",
      "API-CON-010",
      "API-CON-011",
      "API-CON-012",
      "API-CON-013",
      "API-CON-015",
    ];
    const rows = (
      await db.execute(
        sql`select metadata from audit_logs where metadata->>'apiId' like 'API-CON-%'`,
      )
    ).rows as Array<{ metadata: unknown }>;
    const found = new Set(rows.map((row) => (row.metadata as { apiId: string }).apiId));
    expect(required.every((apiId) => found.has(apiId))).toBe(true);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toMatch(
      /authorizedTargets|allowedActivities|securityConcern|contactInformation|Internal operational note/,
    );
  });

  it("validates all twelve requestId routes after authentication and before PostgreSQL", async () => {
    const cases: Array<
      ["get" | "post", string, typeof businessA | typeof consultantA | typeof admin, object?]
    > = [
      ["get", "/api/v1/business/consulting-requests/not-a-uuid", businessA],
      [
        "post",
        "/api/v1/business/consulting-requests/not-a-uuid/scope-authorizations",
        businessA,
        scopeBody(),
      ],
      [
        "get",
        "/api/v1/business/consulting-requests/not-a-uuid/scope-authorizations/current",
        businessA,
      ],
      ["get", "/api/v1/consulting/requests/not-a-uuid", consultantA],
      [
        "post",
        "/api/v1/admin/consulting-requests/not-a-uuid/assign-consultant",
        admin,
        { consultantUserId: consultantA.userId },
      ],
      [
        "post",
        "/api/v1/consulting/requests/not-a-uuid/start-review",
        consultantA,
        { expectedStateVersion: 1 },
      ],
      [
        "post",
        "/api/v1/consulting/requests/not-a-uuid/accept",
        consultantA,
        { expectedStateVersion: 1 },
      ],
      [
        "post",
        "/api/v1/consulting/requests/not-a-uuid/decline",
        consultantA,
        { expectedStateVersion: 1, reason: "x" },
      ],
      [
        "post",
        "/api/v1/consulting/requests/not-a-uuid/start-delivery",
        consultantA,
        { expectedStateVersion: 1 },
      ],
      [
        "post",
        "/api/v1/consulting/requests/not-a-uuid/complete",
        consultantA,
        { expectedStateVersion: 1 },
      ],
      ["get", "/api/v1/consulting/requests/not-a-uuid/notes", consultantA],
      ["post", "/api/v1/consulting/requests/not-a-uuid/notes", consultantA, { body: "x" }],
    ];
    for (const [method, path, actor, body] of cases) {
      let call = auth(request(app.getHttpServer())[method](path), actor);
      if (body) call = call.send(body);
      const response = await call.expect(422);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      await request(app.getHttpServer())
        [method](path)
        .send(body ?? {})
        .expect(401);
    }
  });
});
