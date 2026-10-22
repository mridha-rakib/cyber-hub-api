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
 * Wave 7B — Admin account mutations (API-ADM-003/006/007) with the
 * USER-approved D7 (role governance) and D8 (record-only employer status)
 * decisions. Every account and employer touched here is created by this
 * suite under DOMAIN and removed in afterAll; no pre-existing Admin role or
 * employer status is read for assertions or changed.
 */
const DOMAIN = "wave7b-admin.test";
const PASSWORD = "password123";
let counter = 0;

type Actor = { userId: string; email: string; cookie: string; token: string };

const USER_VIEW_KEYS = [
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
const EMPLOYER_DETAIL_KEYS = [
  "companyName",
  "createdAt",
  "email",
  "id",
  "status",
  "updatedAt",
  "users",
].sort();

describe("Wave 7B Admin account mutations", () => {
  let app: INestApplication;
  let db: DatabaseConnection["db"];
  let admin: Actor;
  let mentor: Actor;
  let consultant: Actor;
  let businessA: Actor & { employerId: string };
  let businessB: Actor & { employerId: string };
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
    businessA = await registerBusiness("business-a");
    businessB = await registerBusiness("business-b");
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
  const server = () => app.getHttpServer();

  async function csrf(sessionCookie?: string) {
    const response = await request(server())
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
  async function login(userEmail: string) {
    const token = await csrf();
    const response = await request(server())
      .post("/api/v1/auth/sessions")
      .set("Cookie", token.cookie)
      .set("X-CSRF-Token", token.token)
      .send({ email: userEmail, password: PASSWORD })
      .expect(200);
    const cookies = response.headers["set-cookie"] as unknown as string[];
    const session = cookies.find((value) => value.startsWith("csh_session="));
    if (!session) throw new Error("Session cookie missing");
    return csrf(session.split(";")[0]);
  }
  async function registerLearner(label: string): Promise<Actor> {
    const userEmail = email(label);
    const token = await csrf();
    const response = await request(server())
      .post("/api/v1/auth/register/learner")
      .set("Cookie", token.cookie)
      .set("X-CSRF-Token", token.token)
      .send({ name: label, email: userEmail, password: PASSWORD })
      .expect(201);
    return {
      userId: response.body.data.accountId as string,
      email: userEmail,
      ...(await login(userEmail)),
    };
  }
  async function registerRole(
    label: string,
    role: "ROLE_ADMIN" | "ROLE_MENTOR" | "ROLE_CONSULTANT",
  ): Promise<Actor> {
    const learner = await registerLearner(label);
    // Fixture-only elevation of a test-owned account (same pattern as the
    // existing suites); it then logs in again to get a fresh session.
    await db.execute(
      sql`update users set role = ${role}, verified = true where id = ${learner.userId}`,
    );
    return { ...learner, ...(await login(learner.email)) };
  }
  async function registerBusiness(label: string) {
    const userEmail = email(label);
    const token = await csrf();
    const response = await request(server())
      .post("/api/v1/auth/register/business")
      .set("Cookie", token.cookie)
      .set("X-CSRF-Token", token.token)
      .send({
        name: `Business ${label}`,
        email: userEmail,
        password: PASSWORD,
        companyName: `Company ${label}`,
        businessEmail: email(`${label}-company`),
      })
      .expect(201);
    const userId = response.body.data.accountId as string;
    const row = await db.execute(sql`select employer_id from users where id = ${userId}`);
    return {
      userId,
      email: userEmail,
      employerId: (row.rows[0] as { employer_id: string }).employer_id,
      ...(await login(userEmail)),
    };
  }

  function patch(path: string, actor: Actor | undefined, body: unknown, withCsrf = true) {
    const req = request(server())
      .patch(`/api/v1${path}`)
      .set("Cookie", actor?.cookie ?? "");
    if (actor && withCsrf) req.set("X-CSRF-Token", actor.token);
    return req.send(body as object);
  }
  const userRow = async (id: string) =>
    (
      await db.execute(
        sql`select role, auth_version, employer_id, password_hash is not null as has_password from users where id = ${id}`,
      )
    ).rows[0] as { role: string; auth_version: number; employer_id: string | null };
  const employerRow = async (id: string) =>
    (
      await db.execute(
        sql`select company_name, email, status, profile::text as profile from employers where id = ${id}`,
      )
    ).rows[0] as { company_name: string; email: string; status: string; profile: string };
  const auditRows = async (action: string, entityId: string) =>
    (
      await db.execute(
        sql`select actor_user_id, actor_role, entity_type, user_id, employer_id, metadata from audit_logs where action = ${action} and entity_id = ${entityId} order by timestamp`,
      )
    ).rows as {
      actor_user_id: string;
      actor_role: string;
      entity_type: string;
      user_id: string | null;
      employer_id: string | null;
      metadata: Record<string, unknown>;
    }[];

  describe("API-ADM-003 role change", () => {
    it("changes a permitted role, bumps authVersion, invalidates old sessions and audits", async () => {
      const target = await registerLearner("target");
      const before = await userRow(target.userId);
      await request(server()).get("/api/v1/auth/session").set("Cookie", target.cookie).expect(200);

      const response = await patch(`/admin/users/${target.userId}/role`, admin, {
        role: "ROLE_MENTOR",
      }).expect(200);
      expect(Object.keys(response.body.data).sort()).toEqual(USER_VIEW_KEYS);
      expect(response.body.data).toMatchObject({ id: target.userId, role: "ROLE_MENTOR" });
      expect(JSON.stringify(response.body)).not.toMatch(/password|authVersion|token/i);

      const after = await userRow(target.userId);
      expect(after.role).toBe("ROLE_MENTOR");
      expect(after.auth_version).toBe(before.auth_version + 1);
      expect(after.employer_id).toBe(before.employer_id);

      const stale = await request(server())
        .get("/api/v1/auth/session")
        .set("Cookie", target.cookie)
        .expect(401);
      expect(stale.body.error.code).toBe("SESSION_EXPIRED");

      const fresh = await login(target.email);
      const session = await request(server())
        .get("/api/v1/auth/session")
        .set("Cookie", fresh.cookie)
        .expect(200);
      expect(JSON.stringify(session.body)).toContain("ROLE_MENTOR");

      const audits = await auditRows("admin.user.role_changed", target.userId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actor_user_id: admin.userId,
        actor_role: "ROLE_ADMIN",
        entity_type: "users",
        user_id: target.userId,
        metadata: { apiId: "API-ADM-003", oldRole: "ROLE_LEARNER", newRole: "ROLE_MENTOR" },
      });

      const listed = await request(server())
        .get(`/api/v1/admin/audit-logs?action=admin.user.role_changed&entityId=${target.userId}`)
        .set("Cookie", admin.cookie)
        .expect(200);
      expect(listed.body.data).toHaveLength(1);
      expect(listed.body.data[0].metadata).toEqual({
        apiId: "API-ADM-003",
        oldRole: "ROLE_LEARNER",
        newRole: "ROLE_MENTOR",
      });
      const detail = await request(server())
        .get(`/api/v1/admin/audit-logs/${listed.body.data[0].id}`)
        .set("Cookie", admin.cookie)
        .expect(200);
      expect(detail.body.data).toEqual(listed.body.data[0]);
    });

    it("treats a same-role request as a no-op without authVersion change or audit", async () => {
      const target = await registerLearner("noop");
      const before = await userRow(target.userId);
      const response = await patch(`/admin/users/${target.userId}/role`, admin, {
        role: "ROLE_LEARNER",
      }).expect(200);
      expect(response.body.data.role).toBe("ROLE_LEARNER");
      expect((await userRow(target.userId)).auth_version).toBe(before.auth_version);
      expect(await auditRows("admin.user.role_changed", target.userId)).toHaveLength(0);
      await request(server()).get("/api/v1/auth/session").set("Cookie", target.cookie).expect(200);
    });

    it("refuses self role changes without touching the account", async () => {
      const before = await userRow(admin.userId);
      for (const role of ["ROLE_LEARNER", "ROLE_ADMIN"]) {
        const response = await patch(`/admin/users/${admin.userId}/role`, admin, { role }).expect(
          403,
        );
        expect(response.body.error).toMatchObject({
          code: "FORBIDDEN",
          message: "Admins cannot change their own role.",
        });
      }
      expect(await userRow(admin.userId)).toEqual(before);
      expect(await auditRows("admin.user.role_changed", admin.userId)).toHaveLength(0);
    });

    it("never assigns or removes ROLE_BUSINESS and never touches employer linkage", async () => {
      const target = await registerLearner("to-business");
      const assign = await patch(`/admin/users/${target.userId}/role`, admin, {
        role: "ROLE_BUSINESS",
      }).expect(422);
      expect(assign.body.error.code).toBe("VALIDATION_ERROR");
      expect(await userRow(target.userId)).toMatchObject({
        role: "ROLE_LEARNER",
        employer_id: null,
      });

      const businessBefore = await userRow(businessA.userId);
      for (const role of ["ROLE_LEARNER", "ROLE_ADMIN", "ROLE_CONSULTANT"]) {
        const remove = await patch(`/admin/users/${businessA.userId}/role`, admin, { role }).expect(
          409,
        );
        expect(remove.body.error.code).toBe("STATE_CONFLICT");
      }
      expect(await userRow(businessA.userId)).toEqual(businessBefore);
      expect(businessBefore.employer_id).toBe(businessA.employerId);
      await request(server())
        .get("/api/v1/auth/session")
        .set("Cookie", businessA.cookie)
        .expect(200);
      expect(await auditRows("admin.user.role_changed", businessA.userId)).toHaveLength(0);
    });

    it("cannot lose all Admins when two Admins demote each other concurrently", async () => {
      for (let round = 0; round < 3; round++) {
        const first = await registerRole(`race-a-${round}`, "ROLE_ADMIN");
        const second = await registerRole(`race-b-${round}`, "ROLE_ADMIN");
        const [one, two] = await Promise.all([
          patch(`/admin/users/${second.userId}/role`, first, { role: "ROLE_LEARNER" }),
          patch(`/admin/users/${first.userId}/role`, second, { role: "ROLE_LEARNER" }),
        ]);
        const statuses = [one.status, two.status].sort();
        expect(statuses.filter((status) => status === 200)).toHaveLength(1);
        expect([401, 403]).toContain(statuses.find((status) => status !== 200));
        const roles = [(await userRow(first.userId)).role, (await userRow(second.userId)).role];
        expect(roles.filter((role) => role === "ROLE_ADMIN")).toHaveLength(1);
        expect(roles.filter((role) => role === "ROLE_LEARNER")).toHaveLength(1);
        const events =
          (await auditRows("admin.user.role_changed", first.userId)).length +
          (await auditRows("admin.user.role_changed", second.userId)).length;
        expect(events).toBe(1);
      }
    });

    it("serializes role changes on the locked Admin set", async () => {
      const target = await registerLearner("lock-wait");
      let settled = false;
      let pending: Promise<request.Response> | undefined;
      await db.transaction(async (tx) => {
        // Hold the same lock the service takes, from an independent transaction.
        await tx.execute(
          sql`select id from users where role = 'ROLE_ADMIN' order by id for update`,
        );
        pending = patch(`/admin/users/${target.userId}/role`, admin, { role: "ROLE_MENTOR" }).then(
          (response) => {
            settled = true;
            return response;
          },
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(settled).toBe(false);
        expect((await userRow(target.userId)).role).toBe("ROLE_LEARNER");
      });
      const response = await (pending as Promise<request.Response>);
      expect(response.status).toBe(200);
      expect((await userRow(target.userId)).role).toBe("ROLE_MENTOR");
    });

    it("validates the body strictly and rejects unknown targets", async () => {
      const target = await registerLearner("validation");
      const before = await userRow(target.userId);
      const bad: unknown[] = [
        {},
        { role: "ROLE_SUPERUSER" },
        { role: "role_mentor" },
        { role: "ROLE_MENTOR", authVersion: 99 },
        { role: "ROLE_MENTOR", employerId: businessA.employerId },
        { role: "ROLE_MENTOR", permissions: ["*"] },
        { role: "ROLE_MENTOR", isSuperuser: true },
        { role: ["ROLE_MENTOR"] },
      ];
      for (const body of bad) {
        const response = await patch(`/admin/users/${target.userId}/role`, admin, body);
        expect([JSON.stringify(body), response.status]).toEqual([JSON.stringify(body), 422]);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
      }
      expect(await userRow(target.userId)).toEqual(before);
      await patch("/admin/users/00000000-0000-4000-8000-000000000000/role", admin, {
        role: "ROLE_MENTOR",
      }).expect(404);
      await patch("/admin/users/not-a-uuid/role", admin, { role: "ROLE_MENTOR" }).expect(422);
    });
  });

  describe("API-ADM-006 employer profile", () => {
    it("updates only companyName and email, preserves everything else and audits field names", async () => {
      const before = await employerRow(businessB.employerId);
      const newEmail = email("updated-company");
      const response = await patch(`/admin/employers/${businessB.employerId}/profile`, admin, {
        companyName: "  Renamed Company Ltd  ",
        email: newEmail,
        profile: {},
      }).expect(200);
      expect(Object.keys(response.body.data).sort()).toEqual(EMPLOYER_DETAIL_KEYS);
      expect(response.body.data).toMatchObject({
        id: businessB.employerId,
        companyName: "Renamed Company Ltd",
        email: newEmail,
        status: before.status,
      });
      const after = await employerRow(businessB.employerId);
      expect(after).toEqual({
        ...before,
        company_name: "Renamed Company Ltd",
        email: newEmail,
      });
      const audits = await auditRows("admin.employer.profile_updated", businessB.employerId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actor_user_id: admin.userId,
        entity_type: "employers",
        employer_id: businessB.employerId,
        metadata: { apiId: "API-ADM-006", changedFields: ["companyName", "email"] },
      });
      expect(JSON.stringify(audits[0].metadata)).not.toContain("Renamed");

      await patch(`/admin/employers/${businessB.employerId}/profile`, admin, {
        companyName: "Renamed Company Ltd",
      }).expect(200);
      expect(await auditRows("admin.employer.profile_updated", businessB.employerId)).toHaveLength(
        1,
      );
    });

    it("rejects restricted, unknown and invalid fields without writing", async () => {
      const before = await employerRow(businessB.employerId);
      const bad: unknown[] = [
        {},
        { profile: {} },
        { status: "CLOSED" },
        { companyName: "X", status: "CLOSED" },
        { companyName: "X", id: businessA.employerId },
        { companyName: "X", ownerUserId: admin.userId },
        { companyName: "X", profile: { industry: "x" } },
        { companyName: "" },
        { companyName: "   " },
        { companyName: "x".repeat(201) },
        { email: "not-an-email" },
        { email: 42 },
      ];
      for (const body of bad) {
        const response = await patch(
          `/admin/employers/${businessB.employerId}/profile`,
          admin,
          body,
        );
        expect([JSON.stringify(body), response.status]).toEqual([JSON.stringify(body), 422]);
      }
      expect(await employerRow(businessB.employerId)).toEqual(before);
      await patch("/admin/employers/00000000-0000-4000-8000-000000000000/profile", admin, {
        companyName: "Nobody",
      }).expect(404);
    });
  });

  describe("API-ADM-007 employer status (D8 record only)", () => {
    it("records status changes without affecting Business sessions or access", async () => {
      for (const [from, to] of [
        ["ACTIVE", "SUSPENDED"],
        ["SUSPENDED", "CLOSED"],
      ]) {
        const response = await patch(`/admin/employers/${businessA.employerId}/status`, admin, {
          status: to,
        }).expect(200);
        expect(response.body.data.status).toBe(to);
        expect((await employerRow(businessA.employerId)).status).toBe(to);
        const audits = await auditRows("admin.employer.status_changed", businessA.employerId);
        expect(audits.at(-1)).toMatchObject({
          actor_user_id: admin.userId,
          entity_type: "employers",
          employer_id: businessA.employerId,
          metadata: { apiId: "API-ADM-007", from, to },
        });

        // D8: the same Business session keeps working on its own data.
        await request(server())
          .get("/api/v1/auth/session")
          .set("Cookie", businessA.cookie)
          .expect(200);
        await request(server())
          .get("/api/v1/business/consulting-requests")
          .set("Cookie", businessA.cookie)
          .expect(200);
        await request(server())
          .get("/api/v1/business/security/dashboard")
          .set("Cookie", businessA.cookie)
          .expect(200);
      }
      const businessUser = await userRow(businessA.userId);
      expect(businessUser.role).toBe("ROLE_BUSINESS");
      expect(businessUser.employer_id).toBe(businessA.employerId);
      // A new login is not blocked either.
      await login(businessA.email);
    });

    it("is a no-op for the current status and rejects invalid values", async () => {
      const count = (await auditRows("admin.employer.status_changed", businessA.employerId)).length;
      const current = (await employerRow(businessA.employerId)).status;
      await patch(`/admin/employers/${businessA.employerId}/status`, admin, {
        status: current,
      }).expect(200);
      expect(await auditRows("admin.employer.status_changed", businessA.employerId)).toHaveLength(
        count,
      );
      for (const body of [
        {},
        { status: "DELETED" },
        { status: "active" },
        { status: "ACTIVE", companyName: "x" },
      ]) {
        await patch(`/admin/employers/${businessA.employerId}/status`, admin, body).expect(422);
      }
      expect((await employerRow(businessA.employerId)).status).toBe(current);
    });
  });

  describe("authorization, CSRF and read-only regressions", () => {
    const mutations = () =>
      [
        [`/admin/users/${mentor.userId}/role`, { role: "ROLE_CONSULTANT" }],
        [`/admin/employers/${businessB.employerId}/profile`, { companyName: "Hijacked" }],
        [`/admin/employers/${businessB.employerId}/status`, { status: "CLOSED" }],
      ] as const;

    it("denies anonymous callers (401) and every non-Admin role (403) without writing", async () => {
      const learner = await registerLearner("denied-learner");
      const mentorBefore = await userRow(mentor.userId);
      const employerBefore = await employerRow(businessB.employerId);
      for (const [path, body] of mutations()) {
        const anonymous = await patch(path, undefined, body).expect(401);
        expect(anonymous.body.error.code).toBe("AUTH_REQUIRED");
        for (const actor of [learner, businessA, businessB, mentor, consultant]) {
          const response = await patch(path, actor, body);
          expect([path, response.status]).toEqual([path, 403]);
          expect(response.body.error.code).toBe("FORBIDDEN");
          expect(response.body.data).toBeUndefined();
        }
      }
      expect(await userRow(mentor.userId)).toEqual(mentorBefore);
      expect(await employerRow(businessB.employerId)).toEqual(employerBefore);
    });

    it("requires a matching CSRF token and an approved origin for Admin mutations", async () => {
      const mentorBefore = await userRow(mentor.userId);
      const employerBefore = await employerRow(businessB.employerId);
      for (const [path, body] of mutations()) {
        const missing = await patch(path, admin, body, false).expect(403);
        expect(missing.body.error.code).toBe("CSRF_INVALID");
        const wrong = await request(server())
          .patch(`/api/v1${path}`)
          .set("Cookie", admin.cookie)
          .set("X-CSRF-Token", "not-the-token")
          .send(body)
          .expect(403);
        expect(wrong.body.error.code).toBe("CSRF_INVALID");
        const foreignOrigin = await request(server())
          .patch(`/api/v1${path}`)
          .set("Cookie", admin.cookie)
          .set("X-CSRF-Token", admin.token)
          .set("Origin", "https://evil.example")
          .send(body)
          .expect(403);
        expect(foreignOrigin.body.error.code).toBe("CSRF_INVALID");
      }
      expect(await userRow(mentor.userId)).toEqual(mentorBefore);
      expect(await employerRow(businessB.employerId)).toEqual(employerBefore);
    });

    it("keeps Wave 7A reads safe and existing unrelated mutations protected", async () => {
      const user = await request(server())
        .get(`/api/v1/admin/users/${mentor.userId}`)
        .set("Cookie", admin.cookie)
        .expect(200);
      expect(Object.keys(user.body.data).sort()).toEqual(USER_VIEW_KEYS);
      const employer = await request(server())
        .get(`/api/v1/admin/employers/${businessA.employerId}`)
        .set("Cookie", admin.cookie)
        .expect(200);
      expect(Object.keys(employer.body.data).sort()).toEqual(EMPLOYER_DETAIL_KEYS);
      expect(JSON.stringify(employer.body)).not.toMatch(/password|authVersion|profile/);
      await request(server())
        .get(`/api/v1/admin/users/${mentor.userId}`)
        .set("Cookie", businessA.cookie)
        .expect(403);
      // An existing Admin-only mutation from another module still rejects Business.
      const assign = await request(server())
        .post(
          "/api/v1/admin/consulting-requests/00000000-0000-4000-8000-000000000000/assign-consultant",
        )
        .set("Cookie", businessA.cookie)
        .set("X-CSRF-Token", businessA.token)
        .send({ consultantUserId: consultant.userId });
      expect(assign.status).toBe(403);
    });
  });
});
