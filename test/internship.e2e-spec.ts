import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";

/**
 * Wave 1: Internship Core Vertical Slice — real HTTP, real Postgres,
 * real resolvers (no `RESOURCE_CONTEXT_RESOLVERS` override, unlike the
 * Wave 0D-3 scope-framework tests — this exercises the actual
 * `InternshipResourceResolver`/`SubmissionResourceResolver`/
 * `CompletionResourceResolver` wired in `security.module.ts`).
 */
const TEST_EMAIL_DOMAIN = "wave1-e2e.test";
let emailCounter = 0;
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${emailCounter++}@${TEST_EMAIL_DOMAIN}`;

describe("Wave 1 Internship Core Vertical Slice", () => {
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
      sql`delete from tasks where internship_id in (select id from internships where title like 'Wave1 E2E%')`,
    );
    await queryRows(sql`delete from internships where title like 'Wave1 E2E%'`);
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

  async function registerAndLoginLearner(label: string) {
    const email = uniqueEmail(label);
    const password = "password123";
    const csrf1 = await getCsrf();
    const registerResponse = await request(app.getHttpServer())
      .post("/api/v1/auth/register/learner")
      .set("Cookie", csrf1.cookieHeader)
      .set("X-CSRF-Token", csrf1.token)
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
    const { cookieHeader: csrfCookie, token: csrfToken } = await getCsrfWithSession(sessionCookie);
    return { sessionCookie, csrfCookie, csrfToken };
  }

  async function getCsrfWithSession(sessionCookie: string) {
    const response = await request(app.getHttpServer())
      .get("/api/v1/auth/csrf-token")
      .set("Cookie", sessionCookie)
      .expect(200);
    const setCookie = response.headers["set-cookie"] as unknown as string[];
    const csrfCookie = setCookie.find((c) => c.startsWith("csh_csrf="));
    if (!csrfCookie) throw new Error("CSRF cookie missing");
    return {
      cookieHeader: `${sessionCookie}; ${csrfCookie.split(";")[0]}`,
      token: response.body.data.csrfToken as string,
    };
  }

  async function setRole(userId: string, role: string) {
    await queryRows(sql`update users set role = ${role}, verified = true where id = ${userId}`);
  }

  async function registerAdmin(label: string) {
    const learner = await registerAndLoginLearner(label);
    await setRole(learner.userId, "ROLE_ADMIN");
    const session = await login(learner.email, learner.password);
    return { userId: learner.userId, ...session };
  }

  async function registerMentor(label: string) {
    const learner = await registerAndLoginLearner(label);
    await setRole(learner.userId, "ROLE_MENTOR");
    const session = await login(learner.email, learner.password);
    return { userId: learner.userId, ...session };
  }

  it("runs the full learner -> admin -> mentor -> completion journey with correct authorization boundaries", async () => {
    const admin = await registerAdmin("admin");

    // PROGRAMME: create + publish (WF-PRG-01), unpublished never leaks via public routes.
    const createResponse = await request(app.getHttpServer())
      .post("/api/v1/admin/internships")
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({
        title: "Wave1 E2E Internship",
        description: "d",
        requirements: {},
        duration: {},
        completionCriteria: [],
      })
      .expect(201);
    const internshipId = createResponse.body.data.id as string;
    expect(createResponse.body.data.status).toBe("DRAFT");

    await request(app.getHttpServer()).get(`/api/v1/internships/${internshipId}`).expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/internships/${internshipId}/publish`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ expectedStateVersion: 1 })
      .expect(200);

    await request(app.getHttpServer()).get(`/api/v1/internships/${internshipId}`).expect(200);

    // Invalid role denied: a learner cannot publish/manage programmes.
    const learner = await registerAndLoginLearner("learner");
    const learnerSession = await login(learner.email, learner.password);
    await request(app.getHttpServer())
      .post("/api/v1/admin/internships")
      .set("Cookie", learnerSession.csrfCookie)
      .set("X-CSRF-Token", learnerSession.csrfToken)
      .send({
        title: "x",
        description: "x",
        requirements: {},
        duration: {},
        completionCriteria: [],
      })
      .expect(403);

    const taskResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/internships/${internshipId}/tasks`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ title: "Task 1", description: "d", orderNo: 0, requirements: {} })
      .expect(201);
    const taskId = taskResponse.body.data.id as string;

    // APPLICATION: role/identity fields in the body are ignored/rejected.
    await request(app.getHttpServer())
      .post(`/api/v1/internships/${internshipId}/applications`)
      .set("Cookie", learnerSession.csrfCookie)
      .set("X-CSRF-Token", learnerSession.csrfToken)
      .send({
        applicationData: {},
        status: "ACCEPTED",
        userId: "11111111-1111-1111-1111-111111111111",
      })
      .expect(422);

    const applyResponse = await request(app.getHttpServer())
      .post(`/api/v1/internships/${internshipId}/applications`)
      .set("Cookie", learnerSession.csrfCookie)
      .set("X-CSRF-Token", learnerSession.csrfToken)
      .send({ applicationData: { motivation: "x" } })
      .expect(201);
    const applicationId = applyResponse.body.data.id as string;
    expect(applyResponse.body.data.userId).toBe(learner.userId);
    expect(applyResponse.body.data.status).toBe("SUBMITTED");

    // Cross-user concealment: another learner reading this application sees a generic 404.
    const otherLearner = await registerAndLoginLearner("other");
    const otherSession = await login(otherLearner.email, otherLearner.password);
    const forbiddenRead = await request(app.getHttpServer())
      .get(`/api/v1/me/internship-applications/${applicationId}`)
      .set("Cookie", otherSession.sessionCookie)
      .expect(404);
    expect(forbiddenRead.body.error.code).toBe("NOT_FOUND");

    // WORKFLOW: SUBMITTED -> UNDER_REVIEW -> ACCEPTED, transactional enrollment creation.
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internship-applications/${applicationId}/start-review`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ expectedStateVersion: 1 })
      .expect(200);

    // Stale version -> 409, not 200/404.
    await request(app.getHttpServer())
      .post(`/api/v1/admin/internship-applications/${applicationId}/accept`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ expectedStateVersion: 1 })
      .expect(409);

    const acceptResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/internship-applications/${applicationId}/accept`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ expectedStateVersion: 2 })
      .expect(200);
    const enrollmentId = acceptResponse.body.data.enrollment.id as string;
    expect(acceptResponse.body.data.application.status).toBe("ACCEPTED");

    // TASK ASSIGNMENT GATE: admin assigns; learner sees only their own enrollment's assignments.
    const assignResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/internship-enrollments/${enrollmentId}/task-assignments`)
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ taskIds: [taskId] })
      .expect(201);
    const assignmentId = assignResponse.body.data[0].id as string;

    await request(app.getHttpServer())
      .get(`/api/v1/me/internship-enrollments/${enrollmentId}/task-assignments`)
      .set("Cookie", otherSession.sessionCookie)
      .expect(404);

    // SUBMISSION: owner-only create; other learner cannot see this assignment either.
    const submitResponse = await request(app.getHttpServer())
      .post(`/api/v1/me/task-assignments/${assignmentId}/submission`)
      .set("Cookie", learnerSession.csrfCookie)
      .set("X-CSRF-Token", learnerSession.csrfToken)
      .send({ evidenceText: "done" })
      .expect(201);
    const submissionId = submitResponse.body.data.id as string;

    // MENTOR REVIEW: ASG enforced — unassigned mentor gets concealed 404.
    const mentor = await registerMentor("mentor");
    const otherMentor = await registerMentor("mentor2");

    await request(app.getHttpServer())
      .post(`/api/v1/review/submissions/${submissionId}/start-review`)
      .set("Cookie", mentor.csrfCookie)
      .set("X-CSRF-Token", mentor.csrfToken)
      .send({ expectedStateVersion: 1 })
      .expect(200);

    const unassignedRead = await request(app.getHttpServer())
      .get(`/api/v1/review/submissions/${submissionId}`)
      .set("Cookie", otherMentor.sessionCookie)
      .expect(404);
    expect(unassignedRead.body.error.code).toBe("NOT_FOUND");

    await request(app.getHttpServer())
      .post(`/api/v1/review/submissions/${submissionId}/approve`)
      .set("Cookie", otherMentor.csrfCookie)
      .set("X-CSRF-Token", otherMentor.csrfToken)
      .send({ expectedStateVersion: 2 })
      .expect(404);

    const approveResponse = await request(app.getHttpServer())
      .post(`/api/v1/review/submissions/${submissionId}/approve`)
      .set("Cookie", mentor.csrfCookie)
      .set("X-CSRF-Token", mentor.csrfToken)
      .send({ expectedStateVersion: 2, reviewNote: "good" })
      .expect(200);
    expect(approveResponse.body.data.status).toBe("APPROVED");

    // COMPLETION: derived gate, server-computed regardless of client hint.
    const completionResponse = await request(app.getHttpServer())
      .post(`/api/v1/review/internship-enrollments/${enrollmentId}/evaluate-completion`)
      .set("Cookie", mentor.csrfCookie)
      .set("X-CSRF-Token", mentor.csrfToken)
      .send({ expectedEligibility: "ELIGIBLE" })
      .expect(200);
    expect(completionResponse.body.data.completionEligibility).toBe("ELIGIBLE");
  });

  it("resolves exactly one winner under concurrent identical transitions, final stateVersion = N+1 never N+2", async () => {
    const admin = await registerAdmin("concurrency-admin");
    const learner = await registerAndLoginLearner("concurrency-learner");
    const learnerSession = await login(learner.email, learner.password);

    const createResponse = await request(app.getHttpServer())
      .post("/api/v1/admin/internships")
      .set("Cookie", admin.csrfCookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({
        title: "Wave1 E2E Concurrency Internship",
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

    // Two concurrent identical "accept" transitions at expectedStateVersion=2.
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/admin/internship-applications/${applicationId}/accept`)
        .set("Cookie", admin.csrfCookie)
        .set("X-CSRF-Token", admin.csrfToken)
        .send({ expectedStateVersion: 2 }),
      request(app.getHttpServer())
        .post(`/api/v1/admin/internship-applications/${applicationId}/accept`)
        .set("Cookie", admin.csrfCookie)
        .set("X-CSRF-Token", admin.csrfToken)
        .send({ expectedStateVersion: 2 }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const [row] = await queryRows<{ status: string; state_version: number }>(
      sql`select status, state_version from internship_applications where id = ${applicationId}`,
    );
    expect(row.status).toBe("ACCEPTED");
    expect(row.state_version).toBe(3);
  });
});
