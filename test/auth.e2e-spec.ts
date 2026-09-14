import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { appConfig } from "../src/core/config/app.config";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";
import { AuthController } from "../src/modules/auth/controllers/auth.controller";

const TEST_EMAIL_DOMAIN = "wave0c-e2e.test";
let emailCounter = 0;
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${emailCounter++}@${TEST_EMAIL_DOMAIN}`;

describe("Wave 0C authentication", () => {
  let app: INestApplication;
  let db: DatabaseConnection["db"];
  const emailPort: TransactionalEmailPort = {
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
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
      sql`delete from audit_logs where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from sessions where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from auth_tokens where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(sql`delete from users where email like ${`%@${TEST_EMAIL_DOMAIN}`}`);
    await queryRows(sql`delete from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`}`);
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
    const cookieValue = csrfCookie.split(";")[0];
    return { cookieHeader: cookieValue, token: response.body.data.csrfToken as string };
  }

  describe("learner registration", () => {
    it("creates a ROLE_LEARNER account, hashes the password, and issues a hashed verification token", async () => {
      const { cookieHeader, token } = await getCsrf();
      const email = uniqueEmail("learner");

      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/register/learner")
        .set("Cookie", cookieHeader)
        .set("X-CSRF-Token", token)
        .send({ name: "Learner One", email, password: "correct horse battery" })
        .expect(201);

      expect(response.body.data).toMatchObject({ verificationRequired: true });
      expect(response.body.data.accountId).toEqual(expect.any(String));

      const [row] = await queryRows<{
        email_normalized: string;
        role: string;
        password_hash: string;
        verified: boolean;
        auth_version: number;
      }>(
        sql`select email_normalized, role, password_hash, verified, auth_version from users where id = ${response.body.data.accountId}`,
      );
      expect(row.email_normalized).toBe(email.toLowerCase());
      expect(row.role).toBe("ROLE_LEARNER");
      expect(row.password_hash).not.toContain("correct horse battery");
      expect(row.verified).toBe(false);
      expect(row.auth_version).toBe(1);

      const [tokenRow] = await queryRows<{ token_hash: string }>(
        sql`select token_hash from auth_tokens where user_id = ${response.body.data.accountId}`,
      );
      expect(tokenRow.token_hash).not.toContain("token=");
      expect(emailPort.sendEmailVerification).toHaveBeenCalledWith(
        expect.objectContaining({ to: email }),
      );
    });

    it("rejects a client-supplied role field", async () => {
      const { cookieHeader, token } = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/register/learner")
        .set("Cookie", cookieHeader)
        .set("X-CSRF-Token", token)
        .send({
          name: "X",
          email: uniqueEmail("hacker"),
          password: "password123",
          role: "ROLE_ADMIN",
        })
        .expect(422);
    });

    it("rejects duplicate email registration", async () => {
      const { cookieHeader, token } = await getCsrf();
      const email = uniqueEmail("dup");
      const payload = { name: "Dup", email, password: "password123" };

      await request(app.getHttpServer())
        .post("/api/v1/auth/register/learner")
        .set("Cookie", cookieHeader)
        .set("X-CSRF-Token", token)
        .send(payload)
        .expect(201);

      const second = await getCsrf();
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/register/learner")
        .set("Cookie", second.cookieHeader)
        .set("X-CSRF-Token", second.token)
        .send(payload)
        .expect(409);

      expect(response.body.error.code).toBe("UNIQUE_CONSTRAINT_CONFLICT");
    });
  });

  describe("business registration", () => {
    it("creates an employer and a ROLE_BUSINESS user atomically with the employer relation", async () => {
      const { cookieHeader, token } = await getCsrf();
      const email = uniqueEmail("biz-owner");
      const businessEmail = uniqueEmail("biz-contact");

      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/register/business")
        .set("Cookie", cookieHeader)
        .set("X-CSRF-Token", token)
        .send({
          name: "Owner",
          email,
          password: "password123",
          companyName: "Acme Co",
          businessEmail,
        })
        .expect(201);

      const [row] = await queryRows<{ role: string; employer_id: string }>(
        sql`select role, employer_id from users where id = ${response.body.data.accountId}`,
      );
      expect(row.role).toBe("ROLE_BUSINESS");
      expect(row.employer_id).toEqual(expect.any(String));

      const [employerRow] = await queryRows<{ company_name: string }>(
        sql`select company_name from employers where id = ${row.employer_id}`,
      );
      expect(employerRow.company_name).toBe("Acme Co");
    });

    it("rolls back the employer when the business email is already registered", async () => {
      const { cookieHeader, token } = await getCsrf();
      const email = uniqueEmail("biz-dup");
      const payload = {
        name: "Owner",
        email,
        password: "password123",
        companyName: "Should Not Persist",
        businessEmail: uniqueEmail("contact"),
      };

      await request(app.getHttpServer())
        .post("/api/v1/auth/register/business")
        .set("Cookie", cookieHeader)
        .set("X-CSRF-Token", token)
        .send(payload)
        .expect(201);

      const second = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/register/business")
        .set("Cookie", second.cookieHeader)
        .set("X-CSRF-Token", second.token)
        .send(payload)
        .expect(409);

      const countRows = await queryRows<{ count: string }>(
        sql`select count(*)::text as count from employers where company_name = 'Should Not Persist'`,
      );
      expect(countRows[0].count).toBe("1");
    });
  });

  describe("email verification", () => {
    it("verifies with a valid token and rejects reuse", async () => {
      const email = uniqueEmail("verify");
      const csrf1 = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/register/learner")
        .set("Cookie", csrf1.cookieHeader)
        .set("X-CSRF-Token", csrf1.token)
        .send({ name: "Verify Me", email, password: "password123" })
        .expect(201);

      const call = (emailPort.sendEmailVerification as jest.Mock).mock.calls.find(
        (args) => args[0].to === email,
      );
      const rawToken = new URL(call[0].verificationUrl).searchParams.get("token") as string;

      const csrf2 = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/email-verification/confirm")
        .set("Cookie", csrf2.cookieHeader)
        .set("X-CSRF-Token", csrf2.token)
        .send({ token: rawToken })
        .expect(200);

      const [row] = await queryRows<{ verified: boolean }>(
        sql`select verified from users where email = ${email}`,
      );
      expect(row.verified).toBe(true);

      const csrf3 = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/email-verification/confirm")
        .set("Cookie", csrf3.cookieHeader)
        .set("X-CSRF-Token", csrf3.token)
        .send({ token: rawToken })
        .expect(400);
    });

    it("rejects an invalid token", async () => {
      const csrf = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/email-verification/confirm")
        .set("Cookie", csrf.cookieHeader)
        .set("X-CSRF-Token", csrf.token)
        .send({ token: "not-a-real-token" })
        .expect(400);
    });
  });

  describe("login and session", () => {
    async function registerAndLogin() {
      const email = uniqueEmail("login");
      const password = "password123";
      const csrf1 = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/register/learner")
        .set("Cookie", csrf1.cookieHeader)
        .set("X-CSRF-Token", csrf1.token)
        .send({ name: "Login User", email, password })
        .expect(201);

      const csrf2 = await getCsrf();
      const loginResponse = await request(app.getHttpServer())
        .post("/api/v1/auth/sessions")
        .set("Cookie", csrf2.cookieHeader)
        .set("X-CSRF-Token", csrf2.token)
        .send({ email, password })
        .expect(200);

      const setCookie = loginResponse.headers["set-cookie"] as unknown as string[];
      const sessionCookie = setCookie.find((c) => c.startsWith("csh_session=")) as string;
      return { email, password, sessionCookie: sessionCookie.split(";")[0], csrf: csrf2 };
    }

    it("rejects invalid credentials without revealing account existence", async () => {
      const csrf = await getCsrf();
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/sessions")
        .set("Cookie", csrf.cookieHeader)
        .set("X-CSRF-Token", csrf.token)
        .send({ email: uniqueEmail("nobody"), password: "whatever123" })
        .expect(401);
      expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("logs in, stores only a session hash, returns a safe SessionView, and authenticates GET /auth/session", async () => {
      const { sessionCookie, email } = await registerAndLogin();

      const [row] = await queryRows<{ session_key_hash: string }>(
        sql`select session_key_hash from sessions where user_id = (select id from users where email = ${email})`,
      );
      const rawSecret = sessionCookie.split("=")[1];
      expect(row.session_key_hash).not.toBe(rawSecret);

      const sessionResponse = await request(app.getHttpServer())
        .get("/api/v1/auth/session")
        .set("Cookie", sessionCookie)
        .expect(200);

      expect(sessionResponse.body.data.user).toMatchObject({ email, role: "ROLE_LEARNER" });
      expect(sessionResponse.body.data.user.passwordHash).toBeUndefined();
    });

    it("rejects GET /auth/session without a session cookie", async () => {
      const response = await request(app.getHttpServer()).get("/api/v1/auth/session").expect(401);
      expect(response.body.error.code).toBe("AUTH_REQUIRED");
    });
  });

  describe("logout", () => {
    it("revokes the session so the old cookie can no longer be used", async () => {
      const email = uniqueEmail("logout");
      const password = "password123";
      const csrf1 = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/register/learner")
        .set("Cookie", csrf1.cookieHeader)
        .set("X-CSRF-Token", csrf1.token)
        .send({ name: "Logout User", email, password })
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

      const csrf3 = await getCsrf();
      await request(app.getHttpServer())
        .delete("/api/v1/auth/session")
        .set("Cookie", [sessionCookie, csrf3.cookieHeader].join("; "))
        .set("X-CSRF-Token", csrf3.token)
        .expect(204);

      await request(app.getHttpServer())
        .get("/api/v1/auth/session")
        .set("Cookie", sessionCookie)
        .expect(401);
    });
  });

  describe("forgot / reset password", () => {
    it("returns a generic 202 whether or not the account exists", async () => {
      const csrf1 = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/password-reset/request")
        .set("Cookie", csrf1.cookieHeader)
        .set("X-CSRF-Token", csrf1.token)
        .send({ email: uniqueEmail("no-such-account") })
        .expect(202);

      const email = uniqueEmail("reset-req");
      const csrf2 = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/register/learner")
        .set("Cookie", csrf2.cookieHeader)
        .set("X-CSRF-Token", csrf2.token)
        .send({ name: "Reset Req", email, password: "password123" })
        .expect(201);

      const csrf3 = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/password-reset/request")
        .set("Cookie", csrf3.cookieHeader)
        .set("X-CSRF-Token", csrf3.token)
        .send({ email })
        .expect(202);
    });

    it("resets the password, bumps auth_version, and invalidates the previous session", async () => {
      const email = uniqueEmail("reset-confirm");
      const oldPassword = "password123";
      const csrf1 = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/register/learner")
        .set("Cookie", csrf1.cookieHeader)
        .set("X-CSRF-Token", csrf1.token)
        .send({ name: "Reset Confirm", email, password: oldPassword })
        .expect(201);

      const csrfLogin = await getCsrf();
      const loginResponse = await request(app.getHttpServer())
        .post("/api/v1/auth/sessions")
        .set("Cookie", csrfLogin.cookieHeader)
        .set("X-CSRF-Token", csrfLogin.token)
        .send({ email, password: oldPassword })
        .expect(200);
      const setCookie = loginResponse.headers["set-cookie"] as unknown as string[];
      const sessionCookie = (setCookie.find((c) => c.startsWith("csh_session=")) as string).split(
        ";",
      )[0];

      const csrfReset = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/password-reset/request")
        .set("Cookie", csrfReset.cookieHeader)
        .set("X-CSRF-Token", csrfReset.token)
        .send({ email })
        .expect(202);

      const call = (emailPort.sendPasswordReset as jest.Mock).mock.calls.find(
        (args) => args[0].to === email,
      );
      const rawToken = new URL(call[0].resetUrl).searchParams.get("token") as string;
      const newPassword = "brand-new-password-456";

      const csrfConfirm = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/password-reset/confirm")
        .set("Cookie", csrfConfirm.cookieHeader)
        .set("X-CSRF-Token", csrfConfirm.token)
        .send({ token: rawToken, newPassword })
        .expect(200);

      await request(app.getHttpServer())
        .get("/api/v1/auth/session")
        .set("Cookie", sessionCookie)
        .expect(401);

      const csrfRelogin = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/sessions")
        .set("Cookie", csrfRelogin.cookieHeader)
        .set("X-CSRF-Token", csrfRelogin.token)
        .send({ email, password: newPassword })
        .expect(200);
    });
  });

  describe("CSRF protection", () => {
    it("issues a token via GET /auth/csrf-token", async () => {
      const { token } = await getCsrf();
      expect(token).toEqual(expect.any(String));
      expect(token.length).toBeGreaterThan(20);
    });

    it("rejects an unsafe request with a missing CSRF token", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/register/learner")
        .send({ name: "No CSRF", email: uniqueEmail("nocsrf"), password: "password123" })
        .expect(403);
      expect(response.body.error.code).toBe("CSRF_INVALID");
    });

    it("rejects an unsafe request with a CSRF token that does not match the cookie", async () => {
      const { cookieHeader } = await getCsrf();
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/register/learner")
        .set("Cookie", cookieHeader)
        .set("X-CSRF-Token", "completely-wrong-token-value-1234567890")
        .send({ name: "Bad CSRF", email: uniqueEmail("badcsrf"), password: "password123" })
        .expect(403);
      expect(response.body.error.code).toBe("CSRF_INVALID");
    });
  });

  describe("rate limiting", () => {
    it("registers ThrottlerGuard globally and overrides the default bucket's limit on every sensitive auth endpoint", () => {
      // ThrottlerGuard is bound app-wide via APP_GUARD in AppModule (see
      // app.module.ts), so every sensitive route only needs to override the
      // "default" bucket's limit/ttl via @Throttle, which is what this
      // asserts directly against the decorator's own metadata keys rather
      // than by exhausting the real limit against a shared e2e app (which
      // would be flaky/slow and would also throttle the other tests in this
      // file sharing the same IP).
      const sensitiveHandlers = [
        AuthController.prototype.registerLearner,
        AuthController.prototype.registerBusiness,
        AuthController.prototype.requestEmailVerification,
        AuthController.prototype.login,
        AuthController.prototype.requestPasswordReset,
        AuthController.prototype.confirmPasswordReset,
      ];
      for (const handler of sensitiveHandlers) {
        expect(Reflect.getMetadata("THROTTLER:LIMITdefault", handler)).toBe(
          appConfig.auth.rateLimit.maxRequests,
        );
        expect(Reflect.getMetadata("THROTTLER:TTLdefault", handler)).toBe(
          appConfig.auth.rateLimit.ttlSeconds * 1000,
        );
      }
    });
  });

  describe("audit logging", () => {
    it("records auth lifecycle events without raw secrets in metadata", async () => {
      const email = uniqueEmail("audit");
      const password = "password123";
      const csrf1 = await getCsrf();
      await request(app.getHttpServer())
        .post("/api/v1/auth/register/learner")
        .set("Cookie", csrf1.cookieHeader)
        .set("X-CSRF-Token", csrf1.token)
        .send({ name: "Audit User", email, password })
        .expect(201);

      const auditRows = await queryRows<{ action: string; metadata: unknown }>(
        sql`select action, metadata from audit_logs where user_id = (select id from users where email = ${email})`,
      );
      expect(auditRows.some((row) => row.action === "auth.learner.registered")).toBe(true);
      for (const row of auditRows) {
        const serialized = JSON.stringify(row.metadata);
        expect(serialized).not.toContain(password);
        expect(serialized.toLowerCase()).not.toContain("hash");
      }
    });
  });
});
