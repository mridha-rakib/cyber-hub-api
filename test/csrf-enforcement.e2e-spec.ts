import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { appConfig } from "../src/core/config/app.config";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";

/**
 * Post-Wave 7B API-wide CSRF remediation (API Contract v1.5 API-DEC-004,
 * §3.2/§3.3/§4.2, API-AC-002). CsrfGuard is a global APP_GUARD registered
 * after AuthGuard and PermissionGuard, so every unsafe method needs the
 * double-submit token (and an approved Origin when one is sent) while 401
 * and role/scope 403 keep their precedence. Representative routes cover the
 * Learner, Business, Consultant and Admin domains. Every account and record
 * is created here under DOMAIN and removed in afterAll.
 */
const DOMAIN = "csrf-enforcement.test";
const PASSWORD = "password123";
let counter = 0;

type Actor = { userId: string; email: string; session: string; csrfCookie: string; token: string };

describe("Global CSRF enforcement (API-DEC-004)", () => {
  let app: INestApplication;
  let db: DatabaseConnection["db"];
  let learner: Actor;
  let consultant: Actor;
  let admin: Actor;
  let businessA: Actor & { employerId: string };
  let businessB: Actor & { employerId: string };
  let requestId: string;
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

    learner = await registerLearner("learner");
    consultant = await registerRole("consultant", "ROLE_CONSULTANT");
    admin = await registerRole("admin", "ROLE_ADMIN");
    businessA = await registerBusiness("business-a");
    businessB = await registerBusiness("business-b");

    const created = await send("post", "/business/consulting-requests", businessA)
      .send(consultingBody("seed"))
      .expect(201);
    requestId = created.body.data.id;
    await send("post", `/admin/consulting-requests/${requestId}/assign-consultant`, admin)
      .send({ consultantUserId: consultant.userId })
      .expect(200);
  });

  beforeEach(() => {
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
  });

  afterAll(async () => {
    const testUsers = sql`(select id from users where email like ${`%@${DOMAIN}`})`;
    const testEmployers = sql`(select id from employers where email like ${`%@${DOMAIN}`})`;
    const testRequests = sql`(select id from consulting_requests where employer_id in ${testEmployers})`;
    await db.execute(
      sql`delete from consulting_notes where consulting_request_id in ${testRequests}`,
    );
    await db.execute(
      sql`delete from audit_logs where actor_user_id in ${testUsers} or user_id in ${testUsers} or employer_id in ${testEmployers}`,
    );
    await db.execute(sql`delete from consulting_requests where employer_id in ${testEmployers}`);
    await db.execute(
      sql`delete from portfolio_projects where portfolio_id in (select id from portfolios where user_id in ${testUsers})`,
    );
    await db.execute(sql`delete from portfolios where user_id in ${testUsers}`);
    await db.execute(sql`delete from sessions where user_id in ${testUsers}`);
    await db.execute(sql`delete from auth_tokens where user_id in ${testUsers}`);
    await db.execute(sql`delete from users where email like ${`%@${DOMAIN}`}`);
    await db.execute(sql`delete from employers where email like ${`%@${DOMAIN}`}`);
    await app.close();
  });

  const email = (label: string) => `${label}-${Date.now()}-${counter++}@${DOMAIN}`;
  const server = () => app.getHttpServer();
  const consultingBody = (label: string) => ({
    companyDetails: { name: `CSRF ${label}` },
    businessSize: "SME",
    securityConcern: "Validate external exposure",
    requestedService: "VULNERABILITY_ASSESSMENT",
    contactInformation: { email: `${label}@example.test` },
  });

  async function csrfPair() {
    const response = await request(server()).get("/api/v1/auth/csrf-token").expect(200);
    const cookies = response.headers["set-cookie"] as unknown as string[];
    const cookie = cookies.find((value) => value.startsWith("csh_csrf="));
    if (!cookie) throw new Error("CSRF cookie missing");
    return { cookie: cookie.split(";")[0], token: response.body.data.csrfToken as string };
  }
  async function login(userEmail: string) {
    const pair = await csrfPair();
    const response = await request(server())
      .post("/api/v1/auth/sessions")
      .set("Cookie", pair.cookie)
      .set("X-CSRF-Token", pair.token)
      .send({ email: userEmail, password: PASSWORD })
      .expect(200);
    const cookies = response.headers["set-cookie"] as unknown as string[];
    const session = cookies.find((value) => value.startsWith("csh_session="));
    if (!session) throw new Error("Session cookie missing");
    const fresh = await csrfPair();
    return { session: session.split(";")[0], csrfCookie: fresh.cookie, token: fresh.token };
  }
  async function register(path: string, body: Record<string, unknown>) {
    const pair = await csrfPair();
    const response = await request(server())
      .post(`/api/v1${path}`)
      .set("Cookie", pair.cookie)
      .set("X-CSRF-Token", pair.token)
      .send(body)
      .expect(201);
    return response.body.data.accountId as string;
  }
  async function registerLearner(label: string): Promise<Actor> {
    const userEmail = email(label);
    const userId = await register("/auth/register/learner", {
      name: label,
      email: userEmail,
      password: PASSWORD,
    });
    return { userId, email: userEmail, ...(await login(userEmail)) };
  }
  async function registerRole(label: string, role: "ROLE_CONSULTANT" | "ROLE_ADMIN") {
    const actor = await registerLearner(label);
    await db.execute(
      sql`update users set role = ${role}, verified = true where id = ${actor.userId}`,
    );
    return { ...actor, ...(await login(actor.email)) };
  }
  async function registerBusiness(label: string) {
    const userEmail = email(label);
    const userId = await register("/auth/register/business", {
      name: `Business ${label}`,
      email: userEmail,
      password: PASSWORD,
      companyName: `CSRF Co ${label}`,
      businessEmail: email(`${label}-company`),
    });
    const row = await db.execute(sql`select employer_id from users where id = ${userId}`);
    return {
      userId,
      email: userEmail,
      employerId: (row.rows[0] as { employer_id: string }).employer_id,
      ...(await login(userEmail)),
    };
  }

  type Method = "post" | "patch" | "put" | "delete";
  /** A legitimate browser-shaped request: session + CSRF cookie + matching header. */
  function send(method: Method, path: string, actor: Actor) {
    return request(server())
      [method](`/api/v1${path}`)
      .set("Cookie", `${actor.session}; ${actor.csrfCookie}`)
      .set("X-CSRF-Token", actor.token);
  }
  /** Same session, but no CSRF cookie and no header. */
  function sendWithoutCsrf(method: Method, path: string, actor: Actor) {
    return request(server())[method](`/api/v1${path}`).set("Cookie", actor.session);
  }
  const count = async (query: ReturnType<typeof sql>) =>
    Number(((await db.execute(query)).rows[0] as { n: string | number }).n);
  const projectCount = () =>
    count(
      sql`select count(*) as n from portfolio_projects where portfolio_id in (select id from portfolios where user_id = ${learner.userId})`,
    );

  describe("CSRF token enforcement on representative unsafe routes", () => {
    it("rejects missing, wrong and mismatched tokens across every domain without writing", async () => {
      const otherPair = await csrfPair();
      const projectsBefore = await projectCount();
      const requestsBefore = await count(
        sql`select count(*) as n from consulting_requests where employer_id = ${businessA.employerId}`,
      );
      const notesBefore = await count(
        sql`select count(*) as n from consulting_notes where consulting_request_id = ${requestId}`,
      );
      const cases: [Method, string, Actor, unknown][] = [
        ["post", "/me/portfolio/projects", learner, { title: "Blocked" }],
        ["post", "/business/consulting-requests", businessA, consultingBody("blocked")],
        ["post", `/consulting/requests/${requestId}/notes`, consultant, { body: "Blocked note" }],
        [
          "post",
          `/admin/consulting-requests/${requestId}/assign-consultant`,
          admin,
          { consultantUserId: consultant.userId },
        ],
        ["patch", `/admin/employers/${businessB.employerId}/profile`, admin, { companyName: "X" }],
      ];
      for (const [method, path, actor, body] of cases) {
        const missing = await sendWithoutCsrf(method, path, actor).send(body as object);
        expect([path, "missing", missing.status, missing.body.error?.code]).toEqual([
          path,
          "missing",
          403,
          "CSRF_INVALID",
        ]);
        const headerOnly = await request(server())
          [method](`/api/v1${path}`)
          .set("Cookie", actor.session)
          .set("X-CSRF-Token", actor.token)
          .send(body as object);
        expect([path, "header-only", headerOnly.status, headerOnly.body.error?.code]).toEqual([
          path,
          "header-only",
          403,
          "CSRF_INVALID",
        ]);
        const wrong = await request(server())
          [method](`/api/v1${path}`)
          .set("Cookie", `${actor.session}; ${actor.csrfCookie}`)
          .set("X-CSRF-Token", "not-the-token")
          .send(body as object);
        expect([path, "wrong", wrong.status, wrong.body.error?.code]).toEqual([
          path,
          "wrong",
          403,
          "CSRF_INVALID",
        ]);
        const mismatched = await request(server())
          [method](`/api/v1${path}`)
          .set("Cookie", `${actor.session}; ${actor.csrfCookie}`)
          .set("X-CSRF-Token", otherPair.token)
          .send(body as object);
        expect([path, "mismatched", mismatched.status, mismatched.body.error?.code]).toEqual([
          path,
          "mismatched",
          403,
          "CSRF_INVALID",
        ]);
      }
      expect(await projectCount()).toBe(projectsBefore);
      expect(
        await count(
          sql`select count(*) as n from consulting_requests where employer_id = ${businessA.employerId}`,
        ),
      ).toBe(requestsBefore);
      expect(
        await count(
          sql`select count(*) as n from consulting_notes where consulting_request_id = ${requestId}`,
        ),
      ).toBe(notesBefore);
      expect(
        (
          await db.execute(
            sql`select company_name from employers where id = ${businessB.employerId}`,
          )
        ).rows[0],
      ).toEqual({ company_name: "CSRF Co business-b" });
    });

    it("rejects PATCH and DELETE without a token and accepts them with one", async () => {
      const created = await send("post", "/me/portfolio/projects", learner)
        .send({ title: "Editable" })
        .expect(201);
      const itemId = created.body.data.id as string;
      const patched = await sendWithoutCsrf("patch", `/me/portfolio/projects/${itemId}`, learner)
        .send({ title: "Changed" })
        .expect(403);
      expect(patched.body.error.code).toBe("CSRF_INVALID");
      const deleted = await sendWithoutCsrf(
        "delete",
        `/me/portfolio/projects/${itemId}`,
        learner,
      ).expect(403);
      expect(deleted.body.error.code).toBe("CSRF_INVALID");
      const title = await db.execute(
        sql`select title from portfolio_projects where id = ${itemId}`,
      );
      expect(title.rows).toEqual([{ title: "Editable" }]);

      await send("patch", `/me/portfolio/projects/${itemId}`, learner)
        .send({ title: "Changed" })
        .expect(200);
      const removed = await send("delete", `/me/portfolio/projects/${itemId}`, learner);
      expect([200, 204]).toContain(removed.status);
    });

    it("rejects URL-encoded form posts without a token; the parser itself is unchanged", async () => {
      const before = await projectCount();
      const form = await request(server())
        .post("/api/v1/me/portfolio/projects")
        .set("Cookie", learner.session)
        .type("form")
        .send("title=Form%20submission")
        .expect(403);
      expect(form.body.error.code).toBe("CSRF_INVALID");
      expect(await projectCount()).toBe(before);

      // With the double-submit pair the same URL-encoded body is still parsed
      // and accepted (URL-encoded parsing deliberately left as is, Decision 2).
      await request(server())
        .post("/api/v1/me/portfolio/projects")
        .set("Cookie", `${learner.session}; ${learner.csrfCookie}`)
        .set("X-CSRF-Token", learner.token)
        .type("form")
        .send("title=Form%20with%20token")
        .expect(201);
      expect(await projectCount()).toBe(before + 1);
    });

    it("rejects a foreign Origin and accepts an approved or absent Origin with a valid token", async () => {
      const foreign = await send("post", "/me/portfolio/projects", learner)
        .set("Origin", "http://localhost:3000.evil.example")
        .send({ title: "Foreign origin" })
        .expect(403);
      expect(foreign.body.error.code).toBe("CSRF_INVALID");
      const sibling = await send("post", "/me/portfolio/projects", learner)
        .set("Origin", "http://localhost:3999")
        .send({ title: "Sibling origin" })
        .expect(403);
      expect(sibling.body.error.code).toBe("CSRF_INVALID");
      await send("post", "/me/portfolio/projects", learner)
        .set("Origin", appConfig.corsOrigins[0])
        .send({ title: "Approved origin" })
        .expect(201);
      // Existing CsrfGuard behaviour: Origin is validated when supplied; the
      // token remains mandatory either way.
      await send("post", "/me/portfolio/projects", learner)
        .send({ title: "No origin header" })
        .expect(201);
    });

    it("leaves safe methods untouched", async () => {
      await request(server())
        .get("/api/v1/me/portfolio")
        .set("Cookie", learner.session)
        .expect(200);
      await request(server())
        .get(`/api/v1/business/consulting-requests/${requestId}`)
        .set("Cookie", businessA.session)
        .expect(200);
      await request(server())
        .get("/api/v1/admin/users?limit=1")
        .set("Cookie", admin.session)
        .expect(200);
    });
  });

  describe("precedence: CSRF never replaces authentication or RBAC", () => {
    it("returns 401 to anonymous callers with or without a token", async () => {
      const pair = await csrfPair();
      for (const path of ["/me/portfolio/projects", "/business/consulting-requests"]) {
        const bare = await request(server()).post(`/api/v1${path}`).send({}).expect(401);
        expect(bare.body.error.code).toBe("AUTH_REQUIRED");
        const tokenOnly = await request(server())
          .post(`/api/v1${path}`)
          .set("Cookie", pair.cookie)
          .set("X-CSRF-Token", pair.token)
          .send({})
          .expect(401);
        expect(tokenOnly.body.error.code).toBe("AUTH_REQUIRED");
      }
    });

    it("keeps role and tenant denials ahead of CSRF and never lets a token grant access", async () => {
      for (const withToken of [true, false]) {
        const call = withToken ? send : sendWithoutCsrf;
        const wrongRole = await call(
          "post",
          `/admin/consulting-requests/${requestId}/assign-consultant`,
          learner,
        ).send({ consultantUserId: consultant.userId });
        expect([withToken, wrongRole.status, wrongRole.body.error.code]).toEqual([
          withToken,
          403,
          "FORBIDDEN",
        ]);
        const crossTenant = await call(
          "post",
          `/business/consulting-requests/${requestId}/scope-authorizations`,
          businessB,
        ).send({});
        expect([withToken, crossTenant.status]).toEqual([withToken, 404]);
      }
      const notes = await count(
        sql`select count(*) as n from consulting_notes where consulting_request_id = ${requestId}`,
      );
      const outsider = await registerRole("outsider-consultant", "ROLE_CONSULTANT");
      const unassigned = await send(
        "post",
        `/consulting/requests/${requestId}/notes`,
        outsider,
      ).send({
        body: "Not assigned",
      });
      expect([403, 404]).toContain(unassigned.status);
      expect(
        await count(
          sql`select count(*) as n from consulting_notes where consulting_request_id = ${requestId}`,
        ),
      ).toBe(notes);
    });

    it("keeps validation errors after a valid token", async () => {
      const invalid = await send("post", "/me/portfolio/projects", learner).send({}).expect(422);
      expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("legitimate workflows still succeed with the shared double-submit pair", () => {
    it("Learner, Business, Consultant and Admin mutations succeed", async () => {
      await send("post", "/me/portfolio/projects", learner)
        .send({ title: "Learner project" })
        .expect(201);
      await send("post", "/business/consulting-requests", businessA)
        .send(consultingBody("legit"))
        .expect(201);
      await send("post", `/consulting/requests/${requestId}/notes`, consultant)
        .send({ body: "Consultant note" })
        .expect(201);
      const profile = await send("patch", `/admin/employers/${businessB.employerId}/profile`, admin)
        .send({ companyName: "CSRF Co renamed" })
        .expect(200);
      expect(profile.body.data.companyName).toBe("CSRF Co renamed");
      const audit = await db.execute(
        sql`select count(*) as n from audit_logs where action = 'admin.employer.profile_updated' and entity_id = ${businessB.employerId}`,
      );
      expect(Number((audit.rows[0] as { n: string }).n)).toBe(1);
    });
  });

  describe("session lifecycle", () => {
    it("requires the token for logout, then rejects the ended session", async () => {
      const temp = await registerLearner("logout");
      const refused = await sendWithoutCsrf("delete", "/auth/session", temp).expect(403);
      expect(refused.body.error.code).toBe("CSRF_INVALID");
      await request(server()).get("/api/v1/auth/session").set("Cookie", temp.session).expect(200);

      await send("delete", "/auth/session", temp).expect(204);
      const expired = await send("post", "/me/portfolio/projects", temp)
        .send({ title: "After logout" })
        .expect(401);
      expect(expired.body.error.code).toBe("SESSION_EXPIRED");
    });
  });
});
