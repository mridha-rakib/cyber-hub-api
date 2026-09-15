import { Body, Controller, type INestApplication, Module, Param, Post } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { NotFoundException, WorkflowConflictException } from "../src/core/errors/app.exception";
import { AuthorizeOperation } from "../src/core/security/authorization/authorize-operation.decorator";
import { RequirePermission } from "../src/core/security/authorization/require-permission.decorator";
import {
  RESOURCE_CONTEXT_RESOLVERS,
  type ResourceContextResolver,
} from "../src/core/security/authorization/resource-context-resolver";
import { SecurityAssessmentWorkflowService } from "../src/core/workflow/security-assessment-workflow.service";
import { WorkflowModule } from "../src/core/workflow/workflow.module";
import {
  consultingRequests,
  securityAssessments,
  securityScopeAuthorizations,
} from "../src/infrastructure/database/schema";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";
import { AuditLogsRepository } from "../src/modules/auth/repositories/audit-logs.repository";

/**
 * Wave 0D-7. Real PostgreSQL e2e coverage for centralized authorization-
 * decision audit logging, using the SAME real security_assessments/
 * consulting_requests/security_scope_authorizations chain established in
 * Waves 0D-4B/0D-5/0D-6 — API-ASM-004 (assessment.manage_assigned "start")
 * is auditRequired: true, workflowValidationRequired: true, ASG +
 * AUTH_SCOPE, and CONCEAL_EXISTENCE — the single richest fixture available
 * without inventing a product controller.
 */
let db: DatabaseConnection["db"];

const assessmentResolver: ResourceContextResolver = {
  resourceType: "assessment",
  resolve: async ({ routeParams }) => {
    const assessmentId = routeParams.assessmentId;
    if (!assessmentId) return null;
    const rows = await db.execute(
      sql`select employer_id, assigned_consultant_id from security_assessments where id = ${assessmentId}`,
    );
    const row = rows.rows[0] as { employer_id: string; assigned_consultant_id: string } | undefined;
    if (!row) return null;
    return {
      resourceType: "assessment",
      resourceId: assessmentId,
      employerId: row.employer_id,
      assignedUserIds: [row.assigned_consultant_id],
    };
  },
};

@Controller("test-audit")
class TestAuditController {
  constructor(private readonly assessmentWorkflow: SecurityAssessmentWorkflowService) {}

  // API-ASM-004: assessment.manage_assigned "start". auditRequired: true,
  // workflowValidationRequired: true, ASG + AUTH_SCOPE, CONCEAL_EXISTENCE.
  @AuthorizeOperation("API-ASM-004")
  @RequirePermission("assessment.manage_assigned")
  @Post("assessment/:assessmentId/start")
  async startAssessment(
    @Param("assessmentId") assessmentId: string,
    @Body("expectedStateVersion") expectedStateVersion: number,
  ) {
    const result = await this.assessmentWorkflow.transition({
      resourceId: assessmentId,
      transitionIds: ["WF-ASM-02"],
      expectedStateVersion,
    });
    if (result.outcome === "NOT_FOUND") throw new NotFoundException();
    if (result.outcome === "CONFLICT") throw new WorkflowConflictException();
    return { ok: true, status: result.toState, stateVersion: result.newVersion };
  }

  // API-ASM-008: assessment.read_client. auditRequired: false.
  @AuthorizeOperation("API-ASM-008")
  @RequirePermission("assessment.read_client")
  @Post("assessment-read/:assessmentId")
  readAssessment() {
    return { ok: true };
  }
}

@Module({ imports: [WorkflowModule], controllers: [TestAuditController] })
class TestAuditModule {}

const TEST_EMAIL_DOMAIN = "wave0d7-audit-e2e.test";
let emailCounter = 0;
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${emailCounter++}@${TEST_EMAIL_DOMAIN}`;

describe("Wave 0D-7 authorization decision audit logging (real Postgres)", () => {
  let app: INestApplication;
  const emailPort: TransactionalEmailPort = {
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  };

  async function buildApp(overrideAuditRepository?: Partial<AuditLogsRepository>) {
    const builder = Test.createTestingModule({
      imports: [AppModule, TestAuditModule],
    })
      .overrideProvider(EMAIL_PORT)
      .useValue(emailPort)
      .overrideProvider(RESOURCE_CONTEXT_RESOLVERS)
      .useValue([assessmentResolver]);

    if (overrideAuditRepository) {
      builder.overrideProvider(AuditLogsRepository).useValue(overrideAuditRepository);
    }

    const moduleFixture: TestingModule = await builder.compile();
    const application = moduleFixture.createNestApplication({ bodyParser: false });
    configureApplication(application);
    await application.init();
    return application;
  }

  beforeAll(async () => {
    app = await buildApp();
    db = app.get<DatabaseConnection>(DATABASE_CONNECTION).db;
  });

  afterAll(async () => {
    await cleanupTestData(db);
    await app?.close();
  });

  async function cleanupTestData(connection: DatabaseConnection["db"]) {
    await connection.execute(
      sql`delete from audit_logs where request_id in (select request_id from audit_logs where actor_user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`}))`,
    );
    await connection.execute(
      sql`delete from security_assessments where employer_id in (select id from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await connection.execute(
      sql`delete from security_scope_authorizations where employer_id in (select id from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await connection.execute(
      sql`delete from consulting_requests where employer_id in (select id from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await connection.execute(
      sql`delete from sessions where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await connection.execute(
      sql`delete from auth_tokens where user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await connection.execute(
      sql`delete from audit_logs where actor_user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await connection.execute(sql`delete from users where email like ${`%@${TEST_EMAIL_DOMAIN}`}`);
    await connection.execute(
      sql`delete from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`}`,
    );
  }

  async function queryRows<T>(query: Parameters<typeof db.execute>[0]): Promise<T[]> {
    const result = await db.execute(query);
    return result.rows as T[];
  }

  async function getCsrf(server: ReturnType<INestApplication["getHttpServer"]>) {
    const response = await request(server).get("/api/v1/auth/csrf-token").expect(200);
    const setCookie = response.headers["set-cookie"] as unknown as string[];
    const csrfCookie = setCookie.find((c) => c.startsWith("csh_csrf="));
    if (!csrfCookie) throw new Error("CSRF cookie missing");
    return {
      cookieHeader: csrfCookie.split(";")[0],
      token: response.body.data.csrfToken as string,
    };
  }

  async function registerAndLoginLearner(application: INestApplication, label: string) {
    const server = application.getHttpServer();
    const email = uniqueEmail(label);
    const password = "password123";
    const csrf1 = await getCsrf(server);
    const registerResponse = await request(server)
      .post("/api/v1/auth/register/learner")
      .set("Cookie", csrf1.cookieHeader)
      .set("X-CSRF-Token", csrf1.token)
      .send({ name: "Audit Tester", email, password })
      .expect(201);

    const csrf2 = await getCsrf(server);
    const loginResponse = await request(server)
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

  async function registerAndLoginBusiness(application: INestApplication, label: string) {
    const server = application.getHttpServer();
    const email = uniqueEmail(`${label}-owner`);
    const businessEmail = uniqueEmail(`${label}-contact`);
    const password = "password123";
    const csrf1 = await getCsrf(server);
    const registerResponse = await request(server)
      .post("/api/v1/auth/register/business")
      .set("Cookie", csrf1.cookieHeader)
      .set("X-CSRF-Token", csrf1.token)
      .send({ name: "Owner", email, password, companyName: `Co ${label}`, businessEmail })
      .expect(201);

    const csrf2 = await getCsrf(server);
    const loginResponse = await request(server)
      .post("/api/v1/auth/sessions")
      .set("Cookie", csrf2.cookieHeader)
      .set("X-CSRF-Token", csrf2.token)
      .send({ email, password })
      .expect(200);

    const setCookie = loginResponse.headers["set-cookie"] as unknown as string[];
    const sessionCookie = (setCookie.find((c) => c.startsWith("csh_session=")) as string).split(
      ";",
    )[0];
    const [row] = await queryRows<{ employer_id: string }>(
      sql`select employer_id from users where id = ${registerResponse.body.data.accountId}`,
    );
    return {
      userId: registerResponse.body.data.accountId as string,
      employerId: row.employer_id,
      sessionCookie,
    };
  }

  async function setRole(userId: string, role: string) {
    await queryRows(sql`update users set role = ${role} where id = ${userId}`);
  }

  async function seedAssessment(
    employerId: string,
    submittedByUserId: string,
    assignedConsultantId: string,
    confirmedByUserId: string,
    status: "PLANNED" | "IN_PROGRESS" = "PLANNED",
  ) {
    const [crRow] = await db
      .insert(consultingRequests)
      .values({
        employerId,
        submittedByUserId,
        companyDetails: { name: "Acme" },
        businessSize: "SMALL",
        securityConcern: "Vulnerability exposure",
        requestedService: "VULNERABILITY_ASSESSMENT",
        contactInformation: { email: "contact@acme.test" },
        status: "IN_PROGRESS",
        assignedConsultantId,
      })
      .returning({ id: consultingRequests.id });

    const [scopeRow] = await db
      .insert(securityScopeAuthorizations)
      .values({
        consultingRequestId: crRow.id,
        employerId,
        versionNo: 1,
        authorizedTargets: ["app.acme.test"],
        allowedActivities: ["VULNERABILITY_ASSESSMENT"],
        confirmedByUserId,
        confirmedAt: new Date(),
        validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
        isCurrent: true,
      })
      .returning({ id: securityScopeAuthorizations.id });

    const [assessmentRow] = await db
      .insert(securityAssessments)
      .values({
        employerId,
        consultingRequestId: crRow.id,
        scopeAuthorizationId: scopeRow.id,
        service: "VULNERABILITY_ASSESSMENT",
        scopeSnapshot: { targets: ["app.acme.test"] },
        assignedConsultantId,
        status,
      })
      .returning({ id: securityAssessments.id, stateVersion: securityAssessments.stateVersion });

    return { assessmentId: assessmentRow.id, stateVersion: assessmentRow.stateVersion };
  }

  async function latestAuditRow(requestId: string) {
    const rows = await queryRows<{
      action: string;
      actor_user_id: string;
      actor_role: string;
      entity_type: string;
      entity_id: string | null;
      user_id: string | null;
      employer_id: string | null;
      metadata: Record<string, unknown>;
      request_id: string;
    }>(
      sql`select * from audit_logs where request_id = ${requestId} order by "timestamp" desc limit 5`,
    );
    return rows;
  }

  describe("ALLOW auditing", () => {
    it("audit-required authorized request persists exactly one ALLOW row with correct actor/apiId/metadata", async () => {
      const business = await registerAndLoginBusiness(app, "allow-biz");
      const consultant = await registerAndLoginLearner(app, "allow-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId, stateVersion } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/test-audit/assessment/${assessmentId}/start`)
        .set("Cookie", consultant.sessionCookie)
        .send({ expectedStateVersion: stateVersion })
        .expect(201);

      const requestId = response.headers["x-request-id"] as string;
      expect(requestId).toBeTruthy();

      const rows = await latestAuditRow(requestId);
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.action).toBe("authorization.allowed");
      expect(row.actor_user_id).toBe(consultant.userId);
      expect(row.actor_role).toBe("ROLE_CONSULTANT");
      expect(row.entity_type).toBe("assessment");
      expect(row.entity_id).toBe(assessmentId);
      expect(row.employer_id).toBe(business.employerId);
      expect(row.request_id).toBe(requestId);
      expect(row.metadata.apiId).toBe("API-ASM-004");
      expect(row.metadata.decision).toBe("ALLOW");
      // No AUTH_SCOPE target/activity/restriction detail anywhere in metadata.
      const serialized = JSON.stringify(row.metadata);
      expect(serialized).not.toContain("app.acme.test");
      expect(serialized).not.toContain("VULNERABILITY_ASSESSMENT");
    });

    it("does NOT claim business success — a later workflow 409 (stale version) still leaves the ALLOW audit row intact", async () => {
      const business = await registerAndLoginBusiness(app, "workflow-biz");
      const consultant = await registerAndLoginLearner(app, "workflow-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId, stateVersion } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/test-audit/assessment/${assessmentId}/start`)
        .set("Cookie", consultant.sessionCookie)
        .send({ expectedStateVersion: stateVersion + 99 }) // stale
        .expect(409);

      const requestId = response.headers["x-request-id"] as string;
      const rows = await latestAuditRow(requestId);
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe("authorization.allowed");
      expect(rows[0].metadata.decision).toBe("ALLOW");
    });
  });

  describe("DENY auditing — disclose-safe (role denial)", () => {
    it("Business calling a Consultant/Admin-only technical operation -> 403, DENY audit row persisted with ROLE_NOT_ALLOWED", async () => {
      const business = await registerAndLoginBusiness(app, "role-deny-biz");
      const response = await request(app.getHttpServer())
        .post(`/api/v1/test-audit/assessment/00000000-0000-0000-0000-000000000000/start`)
        .set("Cookie", business.sessionCookie)
        .send({ expectedStateVersion: 1 })
        .expect(403);

      const requestId = response.headers["x-request-id"] as string;
      const rows = await latestAuditRow(requestId);
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe("authorization.denied");
      expect(rows[0].metadata.reasonCode).toBe("ROLE_NOT_ALLOWED");
      expect(rows[0].entity_id).toBeNull();
    });
  });

  describe("DENY auditing — concealed sensitive denial", () => {
    it("unassigned Consultant -> external 404, internal DENY audit row with ASG_SCOPE_DENIED, never exposed externally", async () => {
      const business = await registerAndLoginBusiness(app, "conceal-biz");
      const assigned = await registerAndLoginLearner(app, "conceal-assigned");
      await setRole(assigned.userId, "ROLE_CONSULTANT");
      const other = await registerAndLoginLearner(app, "conceal-other");
      await setRole(other.userId, "ROLE_CONSULTANT");
      const { assessmentId, stateVersion } = await seedAssessment(
        business.employerId,
        business.userId,
        assigned.userId,
        business.userId,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/test-audit/assessment/${assessmentId}/start`)
        .set("Cookie", other.sessionCookie)
        .send({ expectedStateVersion: stateVersion })
        .expect(404);

      expect(JSON.stringify(response.body)).not.toMatch(/ASG|assigned|scope|forbidden/i);
      expect(response.body.error.message).toBe("Resource not found");

      const requestId = response.headers["x-request-id"] as string;
      const rows = await latestAuditRow(requestId);
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe("authorization.denied");
      expect(rows[0].metadata.reasonCode).toBe("ASG_SCOPE_DENIED");
      expect(rows[0].metadata.disclosurePolicy).toBe("CONCEAL_EXISTENCE");
    });

    it("nonexistent assessment id -> external 404, NOT falsely recorded as a verified entity id", async () => {
      const consultant = await registerAndLoginLearner(app, "notfound-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");

      const response = await request(app.getHttpServer())
        .post("/api/v1/test-audit/assessment/00000000-0000-0000-0000-000000000000/start")
        .set("Cookie", consultant.sessionCookie)
        .send({ expectedStateVersion: 1 })
        .expect(404);

      const requestId = response.headers["x-request-id"] as string;
      const rows = await latestAuditRow(requestId);
      expect(rows.length).toBe(1);
      expect(rows[0].metadata.reasonCode).toBe("RESOURCE_NOT_FOUND");
      expect(rows[0].entity_id).toBeNull();
    });
  });

  describe("auditRequired: false is not over-audited", () => {
    it("assessment.read_client (auditRequired: false) writes no authorization audit row", async () => {
      const business = await registerAndLoginBusiness(app, "noaudit-biz");
      const consultant = await registerAndLoginLearner(app, "noaudit-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/test-audit/assessment-read/${assessmentId}`)
        .set("Cookie", business.sessionCookie)
        .send({})
        .expect(201);

      const requestId = response.headers["x-request-id"] as string;
      const rows = await latestAuditRow(requestId);
      expect(rows.length).toBe(0);
    });
  });

  describe("Admin boundary", () => {
    it("Admin audit-required ALLOW is logged — no Admin audit bypass", async () => {
      const business = await registerAndLoginBusiness(app, "admin-allow-biz");
      const consultant = await registerAndLoginLearner(app, "admin-allow-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const admin = await registerAndLoginLearner(app, "admin-allow-admin");
      await setRole(admin.userId, "ROLE_ADMIN");
      const { assessmentId, stateVersion } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/test-audit/assessment/${assessmentId}/start`)
        .set("Cookie", admin.sessionCookie)
        .send({ expectedStateVersion: stateVersion })
        .expect(201);

      const requestId = response.headers["x-request-id"] as string;
      const rows = await latestAuditRow(requestId);
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe("authorization.allowed");
      expect(rows[0].actor_role).toBe("ROLE_ADMIN");
    });

    it("Admin technical AUTH_SCOPE DENY is logged safely (revoked scope)", async () => {
      const business = await registerAndLoginBusiness(app, "admin-deny-biz");
      const consultant = await registerAndLoginLearner(app, "admin-deny-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const admin = await registerAndLoginLearner(app, "admin-deny-admin");
      await setRole(admin.userId, "ROLE_ADMIN");
      const { assessmentId, stateVersion } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
      );
      await queryRows(
        sql`update security_scope_authorizations set revoked_at = now() where consulting_request_id = (select consulting_request_id from security_assessments where id = ${assessmentId})`,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/test-audit/assessment/${assessmentId}/start`)
        .set("Cookie", admin.sessionCookie)
        .send({ expectedStateVersion: stateVersion })
        .expect(404);

      const requestId = response.headers["x-request-id"] as string;
      const rows = await latestAuditRow(requestId);
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe("authorization.denied");
      expect(rows[0].metadata.reasonCode).toBe("AUTH_SCOPE_DENIED");
    });
  });

  describe("Metadata leak test", () => {
    it("secret sentinel values in body/query/headers/cookie/authorization never appear in the audit row", async () => {
      const business = await registerAndLoginBusiness(app, "leak-biz");
      const consultant = await registerAndLoginLearner(app, "leak-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId, stateVersion } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
      );

      const sentinel = "DO_NOT_LOG_SECRET_9f8e7d6c5b4a";
      const response = await request(app.getHttpServer())
        .post(`/api/v1/test-audit/assessment/${assessmentId}/start?token=${sentinel}`)
        .set("Cookie", `${consultant.sessionCookie}; extra=${sentinel}`)
        .set("Authorization", `Bearer ${sentinel}`)
        .set("X-CSRF-Token", sentinel)
        .send({ expectedStateVersion: stateVersion, password: sentinel, secret: sentinel })
        .expect(201);

      const requestId = response.headers["x-request-id"] as string;
      const rows = await latestAuditRow(requestId);
      expect(rows.length).toBe(1);
      const serialized = JSON.stringify(rows[0]);
      expect(serialized).not.toContain(sentinel);

      const metadataKeys = Object.keys(rows[0].metadata);
      for (const forbidden of [
        "password",
        "token",
        "cookie",
        "authorization",
        "authorizedTargets",
        "allowedActivities",
        "restrictions",
        "body",
        "query",
        "headers",
      ]) {
        expect(metadataKeys.map((k) => k.toLowerCase())).not.toContain(forbidden.toLowerCase());
      }
    });
  });

  describe("Duplicate protection", () => {
    it("one HTTP request produces exactly one authorization audit row", async () => {
      const business = await registerAndLoginBusiness(app, "dup-biz");
      const consultant = await registerAndLoginLearner(app, "dup-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId, stateVersion } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/test-audit/assessment/${assessmentId}/start`)
        .set("Cookie", consultant.sessionCookie)
        .send({ expectedStateVersion: stateVersion })
        .expect(201);

      const requestId = response.headers["x-request-id"] as string;
      const rows = await latestAuditRow(requestId);
      expect(rows.length).toBe(1);
    });
  });

  describe("Audit persistence failure policy", () => {
    let failingApp: INestApplication;

    beforeAll(async () => {
      failingApp = await buildApp({
        record: async () => {
          throw new Error("simulated audit persistence failure");
        },
      });
      db = failingApp.get<DatabaseConnection>(DATABASE_CONNECTION).db;
    });

    afterAll(async () => {
      await failingApp?.close();
      db = app.get<DatabaseConnection>(DATABASE_CONNECTION).db;
    });

    it("audit-required ALLOW path: audit write failure fails CLOSED — handler never executes, safe internal error, never ALLOW", async () => {
      // Register/login through the WORKING app (its own Wave 0C audit
      // events must not be broken by the failing-audit override); only the
      // actual protected request under test goes through `failingApp`.
      const business = await registerAndLoginBusiness(app, "fail-allow-biz");
      const consultant = await registerAndLoginLearner(app, "fail-allow-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId, stateVersion } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
      );

      await request(failingApp.getHttpServer())
        .post(`/api/v1/test-audit/assessment/${assessmentId}/start`)
        .set("Cookie", consultant.sessionCookie)
        .send({ expectedStateVersion: stateVersion })
        .expect(500);

      // The workflow transition (handler body) must never have executed —
      // status/version must remain exactly as seeded.
      const [row] = await queryRows<{ status: string; state_version: number }>(
        sql`select status, state_version from security_assessments where id = ${assessmentId}`,
      );
      expect(row).toEqual({ status: "PLANNED", state_version: 1 });
    });

    it("concealed DENY path: audit write failure never converts a 404 into a 500 (no existence side-channel)", async () => {
      const business = await registerAndLoginBusiness(app, "fail-conceal-biz");
      const assigned = await registerAndLoginLearner(app, "fail-conceal-assigned");
      await setRole(assigned.userId, "ROLE_CONSULTANT");
      const other = await registerAndLoginLearner(app, "fail-conceal-other");
      await setRole(other.userId, "ROLE_CONSULTANT");
      const { assessmentId, stateVersion } = await seedAssessment(
        business.employerId,
        business.userId,
        assigned.userId,
        business.userId,
      );

      const response = await request(failingApp.getHttpServer())
        .post(`/api/v1/test-audit/assessment/${assessmentId}/start`)
        .set("Cookie", other.sessionCookie)
        .send({ expectedStateVersion: stateVersion })
        .expect(404);
      expect(response.body.error.message).toBe("Resource not found");
    });

    it("disclose-safe 403 DENY path: audit write failure never converts a 403 into a 500", async () => {
      const business = await registerAndLoginBusiness(app, "fail-403-biz");
      await request(failingApp.getHttpServer())
        .post("/api/v1/test-audit/assessment/00000000-0000-0000-0000-000000000000/start")
        .set("Cookie", business.sessionCookie)
        .send({ expectedStateVersion: 1 })
        .expect(403);
    });

    it("auditRequired: false operation is entirely unaffected by audit subsystem failure", async () => {
      const business = await registerAndLoginBusiness(app, "fail-noaudit-biz");
      const consultant = await registerAndLoginLearner(app, "fail-noaudit-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
      );

      await request(failingApp.getHttpServer())
        .post(`/api/v1/test-audit/assessment-read/${assessmentId}`)
        .set("Cookie", business.sessionCookie)
        .send({})
        .expect(201);
    });
  });

  describe("Wave 0C authentication audit regression", () => {
    it("existing auth.login.success events are still written and unaffected by Wave 0D-7's new authorization.* actions", async () => {
      const learner = await registerAndLoginLearner(app, "regression-learner");
      const [row] = await queryRows<{ action: string }>(
        sql`select action from audit_logs where actor_user_id = ${learner.userId} and action = 'auth.login.success'`,
      );
      expect(row.action).toBe("auth.login.success");
    });
  });
});
