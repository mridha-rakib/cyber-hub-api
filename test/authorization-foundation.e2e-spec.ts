import { Controller, Get, type INestApplication, Module } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { AuthenticatedOnly } from "../src/common/decorators/authenticated-only.decorator";
import { Public } from "../src/common/decorators/public.decorator";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { RequirePermission } from "../src/core/security/authorization/require-permission.decorator";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";

// A throwaway controller used only to exercise the global authorization
// pipeline end-to-end. Per Wave 0D-2 scope, no real product-domain
// controllers exist yet — this stands in for one without implementing any
// domain feature.
@Controller("test-authz")
class TestAuthzController {
  @Public()
  @Get("public")
  publicRoute() {
    return { ok: true };
  }

  @AuthenticatedOnly()
  @Get("authenticated-only")
  authenticatedOnlyRoute() {
    return { ok: true };
  }

  // No @Public()/@AuthenticatedOnly()/@RequirePermission() at all.
  @Get("unclassified")
  unclassifiedRoute() {
    return { ok: true };
  }

  // ROLE_ADMIN-only, empty scope — a pure role-level permission.
  @RequirePermission("resource.manage")
  @Get("admin-role-only")
  adminRoleOnlyRoute() {
    return { ok: true };
  }

  // ROLE_LEARNER-eligible, but scope = [OWN] — must fail closed regardless
  // of role since no OWN evaluator exists yet.
  @RequirePermission("portfolio.manage_own")
  @Get("scope-sensitive-own")
  scopeSensitiveOwnRoute() {
    return { ok: true };
  }

  // ROLE_CONSULTANT/ROLE_ADMIN-eligible, scope = [ASG, AUTH_SCOPE] — must
  // fail closed for every role since no ASG/AUTH_SCOPE evaluator exists yet.
  @RequirePermission("assessment.manage_assigned")
  @Get("consultant-technical")
  consultantTechnicalRoute() {
    return { ok: true };
  }
}

@Module({ controllers: [TestAuthzController] })
class TestAuthzModule {}

const TEST_EMAIL_DOMAIN = "wave0d2-e2e.test";
let emailCounter = 0;
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${emailCounter++}@${TEST_EMAIL_DOMAIN}`;

describe("Wave 0D-2 authorization foundation", () => {
  let app: INestApplication;
  let db: DatabaseConnection["db"];
  const emailPort: TransactionalEmailPort = {
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, TestAuthzModule],
    })
      .overrideProvider(EMAIL_PORT)
      .useValue(emailPort)
      .compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.init();
    db = app.get<DatabaseConnection>(DATABASE_CONNECTION).db;
  });

  afterAll(async () => {
    await queryRows(
      sql`delete from sessions where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from auth_tokens where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from audit_logs where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(sql`delete from users where email like ${`%@${TEST_EMAIL_DOMAIN}`}`);
    await app?.close();
  });

  async function queryRows<T>(query: Parameters<typeof db.execute>[0]): Promise<T[]> {
    const result = await db.execute(query);
    return result.rows as T[];
  }

  async function getCsrf() {
    const response = await request(app.getHttpServer()).get("/api/v1/auth/csrf-token").expect(200);
    const setCookie = response.headers["set-cookie"] as unknown as string[];
    const csrfCookie = setCookie.find((c) => c.startsWith("csh_csrf="));
    if (!csrfCookie) throw new Error("CSRF cookie missing");
    return {
      cookieHeader: csrfCookie.split(";")[0],
      token: response.body.data.csrfToken as string,
    };
  }

  async function registerAndLoginLearner() {
    const email = uniqueEmail("learner");
    const password = "password123";
    const csrf1 = await getCsrf();
    const registerResponse = await request(app.getHttpServer())
      .post("/api/v1/auth/register/learner")
      .set("Cookie", csrf1.cookieHeader)
      .set("X-CSRF-Token", csrf1.token)
      .send({ name: "Authz Learner", email, password })
      .expect(201);

    const csrf2 = await getCsrf();
    const loginResponse = await request(app.getHttpServer())
      .post("/api/v1/auth/sessions")
      .set("Cookie", csrf2.cookieHeader)
      .set("X-CSRF-Token", csrf2.token)
      .send({ email, password })
      .expect(200);

    const setCookie = loginResponse.headers["set-cookie"] as unknown as string[];
    const sessionCookie = (setCookie.find((c) => c.startsWith("csh_session=")) as string).split(
      ";",
    )[0];
    return { userId: registerResponse.body.data.accountId as string, sessionCookie };
  }

  async function promoteToAdmin(userId: string) {
    await queryRows(sql`update users set role = 'ROLE_ADMIN' where id = ${userId}`);
  }

  describe("PUBLIC routes", () => {
    it("allows an unauthenticated request to a @Public() route", async () => {
      await request(app.getHttpServer()).get("/api/v1/test-authz/public").expect(200);
    });
  });

  describe("AUTHENTICATED_ONLY routes", () => {
    it("rejects an unauthenticated request with 401", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/test-authz/authenticated-only")
        .expect(401);
      expect(response.body.error.code).toBe("AUTH_REQUIRED");
    });

    it("allows a request with a valid session and no permission key required", async () => {
      const { sessionCookie } = await registerAndLoginLearner();
      await request(app.getHttpServer())
        .get("/api/v1/test-authz/authenticated-only")
        .set("Cookie", sessionCookie)
        .expect(200);
    });
  });

  describe("missing route classification", () => {
    it("denies a non-public route that declares neither @AuthenticatedOnly() nor @RequirePermission()", async () => {
      const { sessionCookie } = await registerAndLoginLearner();
      const response = await request(app.getHttpServer())
        .get("/api/v1/test-authz/unclassified")
        .set("Cookie", sessionCookie)
        .expect(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    });

    it("also denies an unauthenticated request to the unclassified route (auth is still required first)", async () => {
      await request(app.getHttpServer()).get("/api/v1/test-authz/unclassified").expect(401);
    });
  });

  describe("role-level permission enforcement", () => {
    it("denies a role without the permission key", async () => {
      const { sessionCookie } = await registerAndLoginLearner();
      const response = await request(app.getHttpServer())
        .get("/api/v1/test-authz/admin-role-only")
        .set("Cookie", sessionCookie)
        .expect(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    });

    it("allows a role with the permission key when the permission has no resource scope", async () => {
      const { userId, sessionCookie } = await registerAndLoginLearner();
      await promoteToAdmin(userId);
      await request(app.getHttpServer())
        .get("/api/v1/test-authz/admin-role-only")
        .set("Cookie", sessionCookie)
        .expect(200);
    });

    it("never allows ROLE_ADMIN a permission it was not explicitly granted (no universal bypass)", async () => {
      // resource.manage is ROLE_ADMIN-only; portfolio.manage_own is not
      // granted to ROLE_ADMIN at all in the registry. Even as Admin, the
      // OWN-scoped route must still be denied — first for not being
      // Admin-granted, and even if it were, the scope-sensitive gate below
      // would still deny it.
      const { userId, sessionCookie } = await registerAndLoginLearner();
      await promoteToAdmin(userId);
      const response = await request(app.getHttpServer())
        .get("/api/v1/test-authz/scope-sensitive-own")
        .set("Cookie", sessionCookie)
        .expect(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("scope-sensitive permissions fail closed absent a real resolver (ASG/AUTH_SCOPE still unwired for this fixture's domain; OWN now has a real Wave 2 'portfolio' resolver)", () => {
    it("allows the OWN-scoped permission for the exact role it's granted to, now that Wave 2 wires a real 'portfolio' resolver — this fixture route has no resource-id locator, so it hits the same self-referential 'collection endpoint' convention as the real /me/portfolio routes, and OWN passes structurally", async () => {
      const { sessionCookie } = await registerAndLoginLearner();
      await request(app.getHttpServer())
        .get("/api/v1/test-authz/scope-sensitive-own")
        .set("Cookie", sessionCookie)
        .expect(200);
    });

    it("denies the ASG+AUTH_SCOPE-scoped permission for ROLE_ADMIN too", async () => {
      const { userId, sessionCookie } = await registerAndLoginLearner();
      await promoteToAdmin(userId);
      const response = await request(app.getHttpServer())
        .get("/api/v1/test-authz/consultant-technical")
        .set("Cookie", sessionCookie)
        .expect(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    });

    it("denies the ASG+AUTH_SCOPE-scoped permission for a role that isn't even granted it", async () => {
      const { sessionCookie } = await registerAndLoginLearner();
      await request(app.getHttpServer())
        .get("/api/v1/test-authz/consultant-technical")
        .set("Cookie", sessionCookie)
        .expect(403);
    });
  });
});
