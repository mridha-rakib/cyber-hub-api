import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";

/**
 * Wave 7A — Admin governance reads (API-AUD-001/002, API-ADM-001/002/004/005)
 * against real local Postgres. Fixtures are scoped to DOMAIN and removed in
 * afterAll; seeded audit rows use the test admin as actor and a unique
 * action so no pre-existing development row is read, asserted on or changed.
 */
const DOMAIN = "wave7a-admin.test";
const SECRET = "WAVE7A_SECRET_MARKER";
const ACTION = `wave7a.test.${Date.now()}`;
let counter = 0;

type Actor = { userId: string; cookie: string; token: string };

describe("Wave 7A Admin governance reads", () => {
  let app: INestApplication;
  let db: DatabaseConnection["db"];
  let admin: Actor;
  let learner: Actor;
  let mentor: Actor;
  let consultant: Actor;
  let businessA: Actor & { employerId: string };
  let businessB: Actor & { employerId: string };
  const seeded: { id: string; timestamp: string }[] = [];
  let sensitiveId: string;
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

    admin = await registerRole("admin", "ROLE_ADMIN");
    mentor = await registerRole("mentor", "ROLE_MENTOR");
    consultant = await registerRole("consultant", "ROLE_CONSULTANT");
    learner = await registerLearner("learner");
    businessA = await registerBusiness("business-a");
    businessB = await registerBusiness("business-b");
    await db.execute(
      sql`update employers set status = 'SUSPENDED' where id = ${businessB.employerId}`,
    );

    // Five rows share one exact microsecond (id tie-break) and three share
    // one millisecond with different microseconds (precision boundary).
    const timestamps = [
      ...Array.from({ length: 5 }, () => "2001-02-03T04:05:06.123456Z"),
      "2001-02-03T04:05:07.500100Z",
      "2001-02-03T04:05:07.500200Z",
      "2001-02-03T04:05:07.500300Z",
      "2001-02-03T04:05:08.000000Z",
    ];
    for (const timestamp of timestamps) {
      const result = await db.execute(sql`
        insert into audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, employer_id, timestamp, metadata)
        values (${admin.userId}, 'ROLE_ADMIN', ${ACTION}, 'wave7a-entity', ${businessA.userId}, ${businessA.employerId},
                ${timestamp}::timestamptz, ${JSON.stringify({ apiId: "API-TEST-001", from: "A", to: "B" })}::jsonb)
        returning id`);
      seeded.push({ id: (result.rows[0] as { id: string }).id, timestamp });
    }
    const sensitive = await db.execute(sql`
      insert into audit_logs (actor_user_id, actor_role, action, entity_type, timestamp, metadata)
      values (${admin.userId}, 'ROLE_ADMIN', ${`${ACTION}.sensitive`}, 'wave7a-entity', '2001-02-03T04:05:09Z'::timestamptz,
              ${JSON.stringify({ apiId: "API-TEST-002", password: SECRET, token: SECRET, passwordHash: SECRET, nested: { secret: SECRET } })}::jsonb)
      returning id`);
    sensitiveId = (sensitive.rows[0] as { id: string }).id;
  });

  beforeEach(() => {
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
  });

  afterAll(async () => {
    const testUsers = sql`(select id from users where email like ${`%@${DOMAIN}`})`;
    const testEmployers = sql`(select id from employers where email like ${`%@${DOMAIN}`})`;
    await db.execute(
      sql`delete from audit_logs where actor_user_id in ${testUsers} or user_id in ${testUsers} or employer_id in ${testEmployers}`,
    );
    await db.execute(sql`delete from sessions where user_id in ${testUsers}`);
    await db.execute(sql`delete from auth_tokens where user_id in ${testUsers}`);
    await db.execute(sql`delete from users where email like ${`%@${DOMAIN}`}`);
    await db.execute(sql`delete from employers where email like ${`%@${DOMAIN}`}`);
    await app.close();
  });

  const email = (label: string) => `${label}-${Date.now()}-${counter++}@${DOMAIN}`;
  const get = (path: string, actor?: Actor) =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set("Cookie", actor?.cookie ?? "");

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
  async function registerLearner(label: string) {
    const userEmail = email(label);
    const token = await csrf();
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register/learner")
      .set("Cookie", token.cookie)
      .set("X-CSRF-Token", token.token)
      .send({ name: label, email: userEmail, password: "password123" })
      .expect(201);
    return {
      userId: response.body.data.accountId as string,
      ...(await login(userEmail, "password123")),
    };
  }
  async function registerRole(
    label: string,
    role: "ROLE_ADMIN" | "ROLE_MENTOR" | "ROLE_CONSULTANT",
  ) {
    const userEmail = email(label);
    const token = await csrf();
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register/learner")
      .set("Cookie", token.cookie)
      .set("X-CSRF-Token", token.token)
      .send({ name: label, email: userEmail, password: "password123" })
      .expect(201);
    const userId = response.body.data.accountId as string;
    await db.execute(sql`update users set role = ${role}, verified = true where id = ${userId}`);
    return { userId, ...(await login(userEmail, "password123")) };
  }
  async function registerBusiness(label: string) {
    const userEmail = email(label);
    const token = await csrf();
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register/business")
      .set("Cookie", token.cookie)
      .set("X-CSRF-Token", token.token)
      .send({
        name: `Business ${label}`,
        email: userEmail,
        password: "password123",
        companyName: `Company ${label}`,
        businessEmail: email(`${label}-company`),
      })
      .expect(201);
    const userId = response.body.data.accountId as string;
    const row = await db.execute(sql`select employer_id from users where id = ${userId}`);
    return {
      userId,
      employerId: (row.rows[0] as { employer_id: string }).employer_id,
      ...(await login(userEmail, "password123")),
    };
  }

  /** Follows nextCursor until exhausted, asserting the page meta contract on every page. */
  async function collect(path: string, limit: number) {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let pageNo = 0; pageNo < 50; pageNo++) {
      const separator = path.includes("?") ? "&" : "?";
      const url: string = `${path}${separator}limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`;
      const response: request.Response = await get(url, admin).expect(200);
      expect(response.body.meta.page.limit).toBe(limit);
      expect(response.body.data.length).toBeLessThanOrEqual(limit);
      ids.push(...response.body.data.map((row: { id: string }) => row.id));
      cursor = response.body.meta.page.nextCursor;
      expect(response.body.meta.page.hasMore).toBe(cursor !== null);
      if (!cursor) return ids;
    }
    throw new Error("pagination did not terminate");
  }

  describe("API-AUD-001 / API-AUD-002 audit logs", () => {
    it("pages deterministically by timestamp DESC, id DESC with no gaps or duplicates", async () => {
      const expected = await db.execute(
        sql`select id from audit_logs where action = ${ACTION} order by timestamp desc, id desc`,
      );
      const expectedIds = (expected.rows as { id: string }[]).map((row) => row.id);
      expect(expectedIds).toHaveLength(9);
      for (const limit of [1, 2, 4]) {
        expect(await collect(`/admin/audit-logs?action=${ACTION}`, limit)).toEqual(expectedIds);
      }
    });

    it("returns the AuditLogView shape and an exact detail", async () => {
      const list = await get(`/admin/audit-logs?action=${ACTION}&limit=1`, admin).expect(200);
      const [item] = list.body.data;
      expect(Object.keys(item).sort()).toEqual(
        [
          "action",
          "actorRole",
          "actorUserId",
          "employerId",
          "entityId",
          "entityType",
          "id",
          "metadata",
          "requestId",
          "serviceContext",
          "timestamp",
          "userId",
        ].sort(),
      );
      expect(item).toMatchObject({
        id: seeded[8].id,
        action: ACTION,
        actorUserId: admin.userId,
        timestamp: "2001-02-03T04:05:08.000Z",
        metadata: { apiId: "API-TEST-001", from: "A", to: "B" },
      });
      const detail = await get(`/admin/audit-logs/${item.id}`, admin).expect(200);
      expect(detail.body.data).toEqual(item);
    });

    it("filters by actor, action, entity, employer and inclusive date range", async () => {
      const byActor = await get(`/admin/audit-logs?actorUserId=${learner.userId}`, admin).expect(
        200,
      );
      expect(byActor.body.data.length).toBeGreaterThanOrEqual(2);
      expect(
        byActor.body.data.every(
          (row: { actorUserId: string }) => row.actorUserId === learner.userId,
        ),
      ).toBe(true);
      expect(byActor.body.data.map((row: { action: string }) => row.action)).toEqual(
        expect.arrayContaining(["auth.learner.registered", "auth.login.success"]),
      );

      const byEntity = await get(
        `/admin/audit-logs?entityType=wave7a-entity&entityId=${businessA.userId}`,
        admin,
      ).expect(200);
      expect(byEntity.body.data).toHaveLength(9);

      const byEmployer = await get(
        `/admin/audit-logs?employerId=${businessB.employerId}`,
        admin,
      ).expect(200);
      expect(byEmployer.body.data.length).toBeGreaterThanOrEqual(1);
      expect(
        byEmployer.body.data.every(
          (row: { employerId: string }) => row.employerId === businessB.employerId,
        ),
      ).toBe(true);
      expect(byEmployer.body.data.map((row: { action: string }) => row.action)).toContain(
        "auth.business.registered",
      );

      const ranged = await get(
        `/admin/audit-logs?action=${ACTION}&from=2001-02-03T04:05:07.500200Z&to=2001-02-03T04:05:08Z`,
        admin,
      ).expect(200);
      expect(ranged.body.data.map((row: { id: string }) => row.id)).toEqual([
        seeded[8].id,
        seeded[7].id,
        seeded[6].id,
      ]);
    });

    it("rejects invalid ranges, limits, cursors and unknown parameters with 422", async () => {
      const bad = [
        "from=2001-02-04T00:00:00Z&to=2001-02-03T00:00:00Z",
        "from=yesterday",
        "limit=101",
        "limit=0",
        "limit=abc",
        "actorUserId=not-a-uuid",
        "sort=timestamp",
        "orderBy=id",
        "foo=bar",
        "cursor=not-a-cursor",
        "action=",
      ];
      for (const query of bad) {
        const response = await get(`/admin/audit-logs?${query}`, admin);
        expect([query, response.status]).toEqual([query, 422]);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
      }
      const usersPage = await get("/admin/users?limit=1", admin).expect(200);
      const foreignCursor = usersPage.body.meta.page.nextCursor as string;
      expect(foreignCursor).toBeTruthy();
      await get(`/admin/audit-logs?cursor=${foreignCursor}`, admin).expect(422);
    });

    it("defaults to 25 rows and never exceeds 100", async () => {
      const response = await get("/admin/audit-logs", admin).expect(200);
      expect(response.body.meta.page.limit).toBe(25);
      expect(response.body.data.length).toBeLessThanOrEqual(25);
      const max = await get("/admin/audit-logs?limit=100", admin).expect(200);
      expect(max.body.data.length).toBeLessThanOrEqual(100);
    });

    it("never returns non-allow-listed metadata", async () => {
      const detail = await get(`/admin/audit-logs/${sensitiveId}`, admin).expect(200);
      expect(detail.body.data.metadata).toEqual({ apiId: "API-TEST-002" });
      expect(JSON.stringify(detail.body)).not.toContain(SECRET);
      const list = await get(`/admin/audit-logs?action=${ACTION}.sensitive`, admin).expect(200);
      expect(JSON.stringify(list.body)).not.toContain(SECRET);
    });

    it("returns 404 for a missing log and 422 for a malformed id", async () => {
      const missing = await get(
        "/admin/audit-logs/00000000-0000-4000-8000-000000000000",
        admin,
      ).expect(404);
      expect(missing.body.error.code).toBe("NOT_FOUND");
      await get("/admin/audit-logs/not-a-uuid", admin).expect(422);
    });
  });

  describe("API-ADM-001 / API-ADM-002 users", () => {
    const userKeys = [
      "createdAt",
      "deletionRequestedAt",
      "email",
      "employerId",
      "id",
      "name",
      "role",
      "updatedAt",
      "verified",
      "verifiedAt",
    ].sort();

    it("lists users with the safe projection only", async () => {
      const response = await get("/admin/users", admin).expect(200);
      expect(response.body.meta.page.limit).toBe(25);
      for (const row of response.body.data) expect(Object.keys(row).sort()).toEqual(userKeys);
      const raw = JSON.stringify(response.body);
      for (const forbidden of [
        "passwordHash",
        "password_hash",
        "$argon2",
        "authVersion",
        "emailNormalized",
        "tokenHash",
        "profile",
      ]) {
        expect(raw).not.toContain(forbidden);
      }
    });

    it("filters by role and verified", async () => {
      const mentors = await get("/admin/users?role=ROLE_MENTOR&limit=100", admin).expect(200);
      expect(mentors.body.data.every((row: { role: string }) => row.role === "ROLE_MENTOR")).toBe(
        true,
      );
      expect(mentors.body.data.map((row: { id: string }) => row.id)).toContain(mentor.userId);

      const unverified = await get("/admin/users?verified=false&limit=100", admin).expect(200);
      expect(
        unverified.body.data.every((row: { verified: boolean }) => row.verified === false),
      ).toBe(true);
      expect(unverified.body.data.map((row: { id: string }) => row.id)).toContain(learner.userId);

      const verifiedConsultants = await get(
        "/admin/users?role=ROLE_CONSULTANT&verified=true&limit=100",
        admin,
      ).expect(200);
      expect(
        verifiedConsultants.body.data.every(
          (row: { role: string; verified: boolean }) =>
            row.role === "ROLE_CONSULTANT" && row.verified,
        ),
      ).toBe(true);
      expect(verifiedConsultants.body.data.map((row: { id: string }) => row.id)).toContain(
        consultant.userId,
      );

      for (const query of [
        "role=ROLE_SUPERUSER",
        "verified=yes",
        "status=ACTIVE",
        "q=admin",
        "limit=500",
      ]) {
        await get(`/admin/users?${query}`, admin).expect(422);
      }
    });

    it("pages users by createdAt DESC, id DESC without duplicates", async () => {
      const expected = await db.execute(
        sql`select id from users where role = 'ROLE_ADMIN' order by created_at desc, id desc`,
      );
      expect(await collect("/admin/users?role=ROLE_ADMIN", 2)).toEqual(
        (expected.rows as { id: string }[]).map((row) => row.id),
      );
    });

    it("reads one user and conceals nothing beyond 404 for a missing id", async () => {
      const detail = await get(`/admin/users/${businessA.userId}`, admin).expect(200);
      expect(Object.keys(detail.body.data).sort()).toEqual(userKeys);
      expect(detail.body.data).toMatchObject({
        id: businessA.userId,
        role: "ROLE_BUSINESS",
        employerId: businessA.employerId,
      });
      expect(JSON.stringify(detail.body)).not.toContain("password");
      await get("/admin/users/00000000-0000-4000-8000-000000000000", admin).expect(404);
      await get("/admin/users/123", admin).expect(422);
    });
  });

  describe("API-ADM-004 / API-ADM-005 employers", () => {
    const employerKeys = ["companyName", "createdAt", "email", "id", "status", "updatedAt"].sort();

    it("lists employers and filters by status", async () => {
      const all = await get("/admin/employers", admin).expect(200);
      for (const row of all.body.data) expect(Object.keys(row).sort()).toEqual(employerKeys);

      const suspended = await get("/admin/employers?status=SUSPENDED&limit=100", admin).expect(200);
      const suspendedIds = suspended.body.data.map((row: { id: string }) => row.id);
      expect(
        suspended.body.data.every((row: { status: string }) => row.status === "SUSPENDED"),
      ).toBe(true);
      expect(suspendedIds).toContain(businessB.employerId);
      expect(suspendedIds).not.toContain(businessA.employerId);

      const active = await get("/admin/employers?status=ACTIVE&limit=100", admin).expect(200);
      expect(active.body.data.every((row: { status: string }) => row.status === "ACTIVE")).toBe(
        true,
      );
      for (const query of ["status=DELETED", "status=active", "companyName=x"]) {
        await get(`/admin/employers?${query}`, admin).expect(422);
      }
    });

    it("pages employers by createdAt DESC, id DESC without duplicates", async () => {
      const expected = await db.execute(
        sql`select id from employers order by created_at desc, id desc`,
      );
      expect(await collect("/admin/employers", 3)).toEqual(
        (expected.rows as { id: string }[]).map((row) => row.id),
      );
    });

    it("reads one employer with its linked accounts and no internal fields", async () => {
      const detail = await get(`/admin/employers/${businessA.employerId}`, admin).expect(200);
      expect(Object.keys(detail.body.data).sort()).toEqual([...employerKeys, "users"].sort());
      expect(detail.body.data.status).toBe("ACTIVE");
      expect(detail.body.data.users).toHaveLength(1);
      expect(Object.keys(detail.body.data.users[0]).sort()).toEqual(
        ["createdAt", "email", "id", "name", "role", "verified"].sort(),
      );
      expect(detail.body.data.users[0]).toMatchObject({
        id: businessA.userId,
        role: "ROLE_BUSINESS",
      });
      const raw = JSON.stringify(detail.body);
      for (const forbidden of ["password", "profile", "authVersion", "emailNormalized"]) {
        expect(raw).not.toContain(forbidden);
      }
      await get("/admin/employers/00000000-0000-4000-8000-000000000000", admin).expect(404);
    });
  });

  describe("RBAC and read-only guarantees", () => {
    const paths = () => [
      "/admin/audit-logs",
      `/admin/audit-logs/${seeded[0].id}`,
      "/admin/users",
      `/admin/users/${learner.userId}`,
      "/admin/employers",
      `/admin/employers/${businessA.employerId}`,
    ];

    it("denies anonymous callers with 401", async () => {
      for (const path of paths()) {
        const response = await get(path);
        expect([path, response.status]).toEqual([path, 401]);
        expect(response.body.error.code).toBe("AUTH_REQUIRED");
      }
    });

    it("denies every non-admin role with 403 and leaks no data", async () => {
      for (const actor of [learner, businessA, mentor, consultant]) {
        for (const path of paths()) {
          const response = await get(path, actor);
          expect([path, response.status]).toEqual([path, 403]);
          expect(response.body.error.code).toBe("FORBIDDEN");
          expect(response.body.data).toBeUndefined();
        }
      }
      // A Business actor cannot read even its own employer or user through Admin routes.
      await get(`/admin/employers/${businessA.employerId}`, businessA).expect(403);
      await get(`/admin/users/${businessA.userId}`, businessA).expect(403);
    });

    it("exposes no write method on the new routes", async () => {
      const before = await db.execute(
        sql`select role, auth_version from users where id = ${learner.userId}`,
      );
      const attempts: [string, string][] = [
        ["post", "/admin/audit-logs"],
        ["delete", `/admin/audit-logs/${seeded[0].id}`],
        ["patch", `/admin/users/${learner.userId}`],
        ["patch", `/admin/users/${learner.userId}/role`],
        ["delete", `/admin/users/${learner.userId}`],
        ["patch", `/admin/employers/${businessA.employerId}/status`],
        ["patch", `/admin/employers/${businessA.employerId}/profile`],
      ];
      for (const [method, path] of attempts) {
        const agent = request(app.getHttpServer()) as unknown as Record<
          string,
          (url: string) => request.Test
        >;
        const response = await agent[method](`/api/v1${path}`)
          .set("Cookie", admin.cookie)
          .set("X-CSRF-Token", admin.token)
          .send({ role: "ROLE_ADMIN", status: "CLOSED" });
        expect([method, path, response.status >= 400]).toEqual([method, path, true]);
      }
      const after = await db.execute(
        sql`select role, auth_version from users where id = ${learner.userId}`,
      );
      expect(after.rows).toEqual(before.rows);
      const employer = await db.execute(
        sql`select status from employers where id = ${businessA.employerId}`,
      );
      expect(employer.rows).toEqual([{ status: "ACTIVE" }]);
      const auditRow = await db.execute(
        sql`select count(*)::int as n from audit_logs where id = ${seeded[0].id}`,
      );
      expect(auditRow.rows).toEqual([{ n: 1 }]);
    });
  });
});
