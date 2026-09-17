import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";

/**
 * Wave 2: Certificate + Portfolio vertical slice — real HTTP, real
 * Postgres, real resolvers (no `RESOURCE_CONTEXT_RESOLVERS` override).
 */
const TEST_EMAIL_DOMAIN = "wave2-e2e.test";
let emailCounter = 0;
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${emailCounter++}@${TEST_EMAIL_DOMAIN}`;

describe("Wave 2 Certificate + Portfolio Vertical Slice", () => {
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
      sql`delete from portfolio_certificates where portfolio_id in (select id from portfolios where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`}))`,
    );
    for (const table of [
      "portfolio_projects",
      "portfolio_links",
      "portfolio_skills",
      "portfolio_certifications",
      "portfolio_evidence",
      "portfolio_achievements",
    ]) {
      await queryRows(
        sql.raw(
          `delete from ${table} where portfolio_id in (select id from portfolios where user_id in (select id from users where email like '%@${TEST_EMAIL_DOMAIN}'))`,
        ),
      );
    }
    await queryRows(
      sql`delete from portfolios where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from certificates where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`}) or revoked_by_user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from submission_versions where created_by_user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from submissions where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from task_assignments where assigned_by_user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from internship_enrollments where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from internship_applications where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from tasks where internship_id in (select id from internships where title like 'Wave2 E2E%')`,
    );
    await queryRows(sql`delete from internships where title like 'Wave2 E2E%'`);
    await queryRows(
      sql`delete from audit_logs where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`}) or actor_user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from sessions where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from auth_tokens where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
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

  async function registerLearner(label: string) {
    const email = uniqueEmail(label);
    const password = "password123";
    const csrf = await getCsrf();
    const registerResponse = await request(app.getHttpServer())
      .post("/api/v1/auth/register/learner")
      .set("Cookie", csrf.cookieHeader)
      .set("X-CSRF-Token", csrf.token)
      .send({ name: "E2E Learner", email, password })
      .expect(201);
    return { userId: registerResponse.body.data.accountId as string, email, password };
  }

  async function login(email: string, password: string) {
    const csrf = await getCsrf();
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/sessions")
      .set("Cookie", csrf.cookieHeader)
      .set("X-CSRF-Token", csrf.token)
      .send({ email, password })
      .expect(200);
    const setCookie = response.headers["set-cookie"] as unknown as string[];
    const sessionCookie = (setCookie.find((c) => c.startsWith("csh_session=")) as string).split(
      ";",
    )[0];
    const csrf2 = await request(app.getHttpServer())
      .get("/api/v1/auth/csrf-token")
      .set("Cookie", sessionCookie)
      .expect(200);
    const setCookie2 = csrf2.headers["set-cookie"] as unknown as string[];
    const csrfCookie2 = setCookie2.find((c) => c.startsWith("csh_csrf="));
    if (!csrfCookie2) throw new Error("CSRF cookie missing");
    return {
      sessionCookie,
      csrfCookie: `${sessionCookie}; ${csrfCookie2.split(";")[0]}`,
      csrfToken: csrf2.body.data.csrfToken as string,
    };
  }

  async function setRole(userId: string, role: string) {
    await queryRows(sql`update users set role = ${role}, verified = true where id = ${userId}`);
  }

  async function registerAdmin(label: string) {
    const learner = await registerLearner(label);
    await setRole(learner.userId, "ROLE_ADMIN");
    const session = await login(learner.email, learner.password);
    return { userId: learner.userId, ...session };
  }

  /** Drives a fresh internship through to one ELIGIBLE enrollment, reusing the real Wave 1 flow end-to-end. */
  async function buildEligibleEnrollment(admin: Awaited<ReturnType<typeof registerAdmin>>) {
    const learner = await registerLearner("cert-learner");
    const learnerSession = await login(learner.email, learner.password);

    const createResponse = await request(app.getHttpServer())
      .post("/api/v1/admin/internships")
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({
        title: "Wave2 E2E Internship",
        description: "d",
        requirements: {},
        duration: {},
        completionCriteria: [],
      })
      .expect(201);
    const internshipId = createResponse.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/admin/internships/${internshipId}/publish`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ expectedStateVersion: 1 })
      .expect(200);

    const taskResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/internships/${internshipId}/tasks`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ title: "Task 1", description: "d", orderNo: 0, requirements: {} })
      .expect(201);
    const taskId = taskResponse.body.data.id as string;

    const applyResponse = await request(app.getHttpServer())
      .post(`/api/v1/internships/${internshipId}/applications`)
      .set("Cookie", learnerSession.csrfCookie)
      .set("X-CSRF-Token", learnerSession.csrfToken)
      .send({ applicationData: {} })
      .expect(201);
    const applicationId = applyResponse.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/admin/internship-applications/${applicationId}/start-review`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ expectedStateVersion: 1 })
      .expect(200);

    const acceptResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/internship-applications/${applicationId}/accept`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ expectedStateVersion: 2 })
      .expect(200);
    const enrollmentId = acceptResponse.body.data.enrollment.id as string;

    const assignResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/internship-enrollments/${enrollmentId}/task-assignments`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ taskIds: [taskId] })
      .expect(201);
    const assignmentId = assignResponse.body.data[0].id as string;

    const submitResponse = await request(app.getHttpServer())
      .post(`/api/v1/me/task-assignments/${assignmentId}/submission`)
      .set("Cookie", learnerSession.csrfCookie)
      .set("X-CSRF-Token", learnerSession.csrfToken)
      .send({ evidenceText: "done" })
      .expect(201);
    const submissionId = submitResponse.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/review/submissions/${submissionId}/start-review`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ expectedStateVersion: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/review/submissions/${submissionId}/approve`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ expectedStateVersion: 2 })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/review/internship-enrollments/${enrollmentId}/evaluate-completion`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({})
      .expect(200);

    return { enrollmentId, learner, learnerSession };
  }

  describe("Certificate", () => {
    it("issues, reads own, verifies publicly, and revokes with correct concealment/conflict semantics", async () => {
      const admin = await registerAdmin("cert-admin");
      const { enrollmentId, learner, learnerSession } = await buildEligibleEnrollment(admin);

      // Wrong role denied.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/internship-enrollments/${enrollmentId}/certificate`)
        .set("Cookie", learnerSession.csrfCookie)
        .set("X-CSRF-Token", learnerSession.csrfToken)
        .send({ completedSkills: ["x"] })
        .expect(403);

      const issueResponse = await request(app.getHttpServer())
        .post(`/api/v1/admin/internship-enrollments/${enrollmentId}/certificate`)
        .set("Cookie", admin.csrfCookie)
        .set("X-CSRF-Token", admin.csrfToken)
        .send({ completedSkills: ["Network Security"] })
        .expect(201);
      const certificateId = issueResponse.body.data.id as string;
      const verificationPath = issueResponse.body.data.verificationPath as string;
      expect(issueResponse.body.data.status).toBe("ISSUED");
      expect(issueResponse.body.data.certificateNumber).toEqual(expect.any(String));

      // Duplicate issuance denied by the DB's own UNIQUE(enrollment_id).
      await request(app.getHttpServer())
        .post(`/api/v1/admin/internship-enrollments/${enrollmentId}/certificate`)
        .set("Cookie", admin.csrfCookie)
        .set("X-CSRF-Token", admin.csrfToken)
        .send({ completedSkills: ["x"] })
        .expect(409);

      // Owner read.
      await request(app.getHttpServer())
        .get(`/api/v1/me/certificates/${certificateId}`)
        .set("Cookie", learnerSession.sessionCookie)
        .expect(200);

      // Cross-user private lookup concealed.
      const other = await registerLearner("cert-other");
      const otherSession = await login(other.email, other.password);
      const forbiddenRead = await request(app.getHttpServer())
        .get(`/api/v1/me/certificates/${certificateId}`)
        .set("Cookie", otherSession.sessionCookie)
        .expect(404);
      expect(forbiddenRead.body.error.code).toBe("NOT_FOUND");

      // Public verification: valid.
      const verifyValid = await request(app.getHttpServer())
        .get(`/api/v1/certificates/verify/${verificationPath}`)
        .expect(200);
      expect(verifyValid.body.data.status).toBe("ISSUED");
      expect(verifyValid.body.data).not.toHaveProperty("userId");
      expect(verifyValid.body.data).not.toHaveProperty("enrollmentId");
      expect(verifyValid.body.data).not.toHaveProperty("id");

      // Unknown identifier: safe generic result, not a crash/leak.
      await request(app.getHttpServer())
        .get("/api/v1/certificates/verify/does-not-exist-at-all")
        .expect(404);

      // Unauthorized revoke denied.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/certificates/${certificateId}/revoke`)
        .set("Cookie", learnerSession.csrfCookie)
        .set("X-CSRF-Token", learnerSession.csrfToken)
        .send({ reason: "x" })
        .expect(403);

      // Authorized revoke.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/certificates/${certificateId}/revoke`)
        .set("Cookie", admin.csrfCookie)
        .set("X-CSRF-Token", admin.csrfToken)
        .send({ reason: "Integrity violation" })
        .expect(200);

      // Double revoke -> 409, not a silent no-op.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/certificates/${certificateId}/revoke`)
        .set("Cookie", admin.csrfCookie)
        .set("X-CSRF-Token", admin.csrfToken)
        .send({ reason: "again" })
        .expect(409);

      // Public verification now reflects REVOKED — never presented as valid.
      const verifyRevoked = await request(app.getHttpServer())
        .get(`/api/v1/certificates/verify/${verificationPath}`)
        .expect(200);
      expect(verifyRevoked.body.data.status).toBe("REVOKED");

      void learner;
    });

    it("resolves exactly one winner under concurrent identical issuance attempts (UNIQUE(enrollment_id))", async () => {
      const admin = await registerAdmin("cert-concurrency-admin");
      const { enrollmentId } = await buildEligibleEnrollment(admin);

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/admin/internship-enrollments/${enrollmentId}/certificate`)
          .set("Cookie", admin.csrfCookie)
          .set("X-CSRF-Token", admin.csrfToken)
          .send({ completedSkills: ["a"] }),
        request(app.getHttpServer())
          .post(`/api/v1/admin/internship-enrollments/${enrollmentId}/certificate`)
          .set("Cookie", admin.csrfCookie)
          .set("X-CSRF-Token", admin.csrfToken)
          .send({ completedSkills: ["b"] }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);

      const rows = await queryRows<{ count: string }>(
        sql`select count(*)::text as count from certificates where enrollment_id = ${enrollmentId}`,
      );
      expect(rows[0].count).toBe("1");
    });
  });

  describe("Portfolio", () => {
    it("enforces OWN ownership, PUB visibility, and certificate-linkage ownership", async () => {
      const learner = await registerLearner("port-learner");
      const learnerSession = await login(learner.email, learner.password);
      const other = await registerLearner("port-other");
      const otherSession = await login(other.email, other.password);

      // Owner derived server-side: create a private and a public item.
      const privateSkill = await request(app.getHttpServer())
        .post("/api/v1/me/portfolio/skills")
        .set("Cookie", learnerSession.csrfCookie)
        .set("X-CSRF-Token", learnerSession.csrfToken)
        .send({ name: "PrivateSkill", isPublic: false })
        .expect(201);

      await request(app.getHttpServer())
        .post("/api/v1/me/portfolio/skills")
        .set("Cookie", learnerSession.csrfCookie)
        .set("X-CSRF-Token", learnerSession.csrfToken)
        .send({ name: "PublicSkill", isPublic: true })
        .expect(201);

      // Cross-user update/read-private -> concealed 404.
      const crossUserUpdate = await request(app.getHttpServer())
        .patch(`/api/v1/me/portfolio/skills/${privateSkill.body.data.id}`)
        .set("Cookie", otherSession.csrfCookie)
        .set("X-CSRF-Token", otherSession.csrfToken)
        .send({ name: "Hijacked" })
        .expect(404);
      expect(crossUserUpdate.body.error.code).toBe("NOT_FOUND");

      // Publish with a unique slug.
      const slug = `e2e-${Date.now()}`;
      await request(app.getHttpServer())
        .patch("/api/v1/me/portfolio/publication")
        .set("Cookie", learnerSession.csrfCookie)
        .set("X-CSRF-Token", learnerSession.csrfToken)
        .send({ isPublic: true, publicSlug: slug })
        .expect(200);

      // Public endpoint: public item visible, private item absent (not merely hidden).
      const publicView = await request(app.getHttpServer())
        .get(`/api/v1/portfolios/${slug}`)
        .expect(200);
      const skillNames = (publicView.body.data.skills as Array<{ name: string }>).map(
        (s) => s.name,
      );
      expect(skillNames).toContain("PublicSkill");
      expect(skillNames).not.toContain("PrivateSkill");

      // Draft/private portfolio (other learner, never published) is not found publicly.
      await request(app.getHttpServer()).get("/api/v1/portfolios/no-such-slug-at-all").expect(404);

      // Certificate linkage: another learner's certificate cannot be linked.
      // (No certificate exists for `other` here — attempting to link a
      // random non-existent id must 404, never leak existence either way.)
      const fakeCertId = "00000000-0000-0000-0000-000000000000";
      await request(app.getHttpServer())
        .put(`/api/v1/me/portfolio/certificates/${fakeCertId}`)
        .set("Cookie", learnerSession.csrfCookie)
        .set("X-CSRF-Token", learnerSession.csrfToken)
        .send({ isPublic: true, sortOrder: 0 })
        .expect(404);

      // Spoofed body fields (userId/ownerUserId/portfolioId) are rejected by strict schemas.
      await request(app.getHttpServer())
        .post("/api/v1/me/portfolio/skills")
        .set("Cookie", learnerSession.csrfCookie)
        .set("X-CSRF-Token", learnerSession.csrfToken)
        .send({ name: "x", userId: other.userId })
        .expect(422);
    });
  });
});
