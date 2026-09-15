import { Body, Controller, type INestApplication, Module, Param, Post } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { NotFoundException, WorkflowConflictException } from "../src/core/errors/app.exception";
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

/**
 * Wave 0D-6 Phase 12/27/28. Proves the mandatory precedence order end to
 * end against real Postgres, using a test-only controller (no consulting/
 * assessment product controller exists yet — Phase 30 forbids building
 * one here). The controller method body only ever runs AFTER
 * PermissionGuard (role + ASG + AUTH_SCOPE + Wave 0D-5 disclosure mapping)
 * has already succeeded — this is enforced structurally by Nest's guard-
 * before-handler execution, not re-implemented here. If PermissionGuard
 * denies, the workflow service is never even called, so a caller who
 * should receive 401/403/404 can never receive 409 by construction.
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

@Controller("test-workflow")
class TestWorkflowController {
  constructor(private readonly assessmentWorkflow: SecurityAssessmentWorkflowService) {}

  // assessment.manage_assigned: ROLE_CONSULTANT [ASG, AUTH_SCOPE] (CONCEAL_EXISTENCE),
  // ROLE_ADMIN [AUTH_SCOPE] only. Authorization (role/ASG/AUTH_SCOPE/disclosure)
  // is fully resolved by PermissionGuard before this method ever executes.
  @RequirePermission("assessment.manage_assigned")
  @Post("assessment/:assessmentId/cancel")
  async cancelAssessment(
    @Param("assessmentId") assessmentId: string,
    @Body("expectedStateVersion") expectedStateVersion: number,
  ) {
    const result = await this.assessmentWorkflow.transition({
      resourceId: assessmentId,
      transitionIds: ["WF-ASM-04", "WF-ASM-05"],
      expectedStateVersion,
    });

    if (result.outcome === "NOT_FOUND") throw new NotFoundException();
    if (result.outcome === "CONFLICT") throw new WorkflowConflictException();
    return { ok: true, status: result.toState, stateVersion: result.newVersion };
  }
}

@Module({ imports: [WorkflowModule], controllers: [TestWorkflowController] })
class TestWorkflowModule {}

const TEST_EMAIL_DOMAIN = "wave0d6-workflow-e2e.test";
let emailCounter = 0;
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${emailCounter++}@${TEST_EMAIL_DOMAIN}`;

describe("Wave 0D-6 authorization/disclosure/workflow precedence (real Postgres)", () => {
  let app: INestApplication;
  const emailPort: TransactionalEmailPort = {
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, TestWorkflowModule],
    })
      .overrideProvider(EMAIL_PORT)
      .useValue(emailPort)
      .overrideProvider(RESOURCE_CONTEXT_RESOLVERS)
      .useValue([assessmentResolver])
      .compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.init();
    db = app.get<DatabaseConnection>(DATABASE_CONNECTION).db;
  });

  afterAll(async () => {
    await queryRows(
      sql`delete from security_assessments where employer_id in (select id from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from security_scope_authorizations where employer_id in (select id from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from consulting_requests where employer_id in (select id from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
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
      .send({ name: "Workflow Tester", email, password })
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

  async function registerAndLoginBusiness(label: string) {
    const email = uniqueEmail(`${label}-owner`);
    const businessEmail = uniqueEmail(`${label}-contact`);
    const password = "password123";
    const csrf1 = await getCsrf();
    const registerResponse = await request(app.getHttpServer())
      .post("/api/v1/auth/register/business")
      .set("Cookie", csrf1.cookieHeader)
      .set("X-CSRF-Token", csrf1.token)
      .send({ name: "Owner", email, password, companyName: `Co ${label}`, businessEmail })
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
    status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" = "PLANNED",
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

  it("anonymous protected route -> 401 (workflow layer never even considered)", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/test-workflow/assessment/00000000-0000-0000-0000-000000000000/cancel")
      .send({ expectedStateVersion: 1 })
      .expect(401);
  });

  it("sensitive resource, unauthorized (unassigned consultant) + invalid workflow state would apply -> 404, NEVER 409", async () => {
    const business = await registerAndLoginBusiness("precedence-conceal-biz");
    const assignedConsultant = await registerAndLoginLearner("precedence-conceal-assigned");
    await setRole(assignedConsultant.userId, "ROLE_CONSULTANT");
    const otherConsultant = await registerAndLoginLearner("precedence-conceal-other");
    await setRole(otherConsultant.userId, "ROLE_CONSULTANT");
    // Already COMPLETED (terminal — a workflow attempt here would be 409
    // for an authorized caller), but this caller is NOT assigned.
    const { assessmentId, stateVersion } = await seedAssessment(
      business.employerId,
      business.userId,
      assignedConsultant.userId,
      business.userId,
      "COMPLETED",
    );

    await request(app.getHttpServer())
      .post(`/api/v1/test-workflow/assessment/${assessmentId}/cancel`)
      .set("Cookie", otherConsultant.sessionCookie)
      .send({ expectedStateVersion: stateVersion })
      .expect(404);
  });

  it("authorized (assigned consultant, valid AUTH_SCOPE) + invalid current state (already COMPLETED) -> 409", async () => {
    const business = await registerAndLoginBusiness("precedence-invalid-biz");
    const consultant = await registerAndLoginLearner("precedence-invalid-consultant");
    await setRole(consultant.userId, "ROLE_CONSULTANT");
    const { assessmentId, stateVersion } = await seedAssessment(
      business.employerId,
      business.userId,
      consultant.userId,
      business.userId,
      "COMPLETED",
    );

    await request(app.getHttpServer())
      .post(`/api/v1/test-workflow/assessment/${assessmentId}/cancel`)
      .set("Cookie", consultant.sessionCookie)
      .send({ expectedStateVersion: stateVersion })
      .expect(409);
  });

  it("authorized + stale stateVersion -> 409", async () => {
    const business = await registerAndLoginBusiness("precedence-stale-biz");
    const consultant = await registerAndLoginLearner("precedence-stale-consultant");
    await setRole(consultant.userId, "ROLE_CONSULTANT");
    const { assessmentId, stateVersion } = await seedAssessment(
      business.employerId,
      business.userId,
      consultant.userId,
      business.userId,
      "PLANNED",
    );

    await request(app.getHttpServer())
      .post(`/api/v1/test-workflow/assessment/${assessmentId}/cancel`)
      .set("Cookie", consultant.sessionCookie)
      .send({ expectedStateVersion: stateVersion + 5 })
      .expect(409);
  });

  it("authorized + valid state + correct version -> success (200)", async () => {
    const business = await registerAndLoginBusiness("precedence-success-biz");
    const consultant = await registerAndLoginLearner("precedence-success-consultant");
    await setRole(consultant.userId, "ROLE_CONSULTANT");
    const { assessmentId, stateVersion } = await seedAssessment(
      business.employerId,
      business.userId,
      consultant.userId,
      business.userId,
      "PLANNED",
    );

    const response = await request(app.getHttpServer())
      .post(`/api/v1/test-workflow/assessment/${assessmentId}/cancel`)
      .set("Cookie", consultant.sessionCookie)
      .send({ expectedStateVersion: stateVersion })
      .expect(201);
    expect(response.body.data.status).toBe("CANCELLED");
    expect(response.body.data.stateVersion).toBe(2);
  });

  describe("Admin workflow boundary (Wave 0D-6 Phase 13/28)", () => {
    it("Admin valid permission + valid transition + correct version -> success", async () => {
      const business = await registerAndLoginBusiness("admin-success-biz");
      const consultant = await registerAndLoginLearner("admin-success-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const admin = await registerAndLoginLearner("admin-success-admin");
      await setRole(admin.userId, "ROLE_ADMIN");
      const { assessmentId, stateVersion } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId, // Admin is not the assigned consultant — irrelevant for Admin's AUTH_SCOPE-only policy
        business.userId,
        "PLANNED",
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/test-workflow/assessment/${assessmentId}/cancel`)
        .set("Cookie", admin.sessionCookie)
        .send({ expectedStateVersion: stateVersion })
        .expect(201);
      expect(response.body.data.status).toBe("CANCELLED");
    });

    it("Admin valid permission + invalid transition (already terminal) -> 409, not a silent bypass", async () => {
      const business = await registerAndLoginBusiness("admin-invalid-biz");
      const consultant = await registerAndLoginLearner("admin-invalid-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const admin = await registerAndLoginLearner("admin-invalid-admin");
      await setRole(admin.userId, "ROLE_ADMIN");
      const { assessmentId, stateVersion } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
        "COMPLETED",
      );

      await request(app.getHttpServer())
        .post(`/api/v1/test-workflow/assessment/${assessmentId}/cancel`)
        .set("Cookie", admin.sessionCookie)
        .send({ expectedStateVersion: stateVersion })
        .expect(409);
    });

    it("Admin stale stateVersion -> 409, Admin gets no stateVersion bypass", async () => {
      const business = await registerAndLoginBusiness("admin-stale-biz");
      const consultant = await registerAndLoginLearner("admin-stale-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const admin = await registerAndLoginLearner("admin-stale-admin");
      await setRole(admin.userId, "ROLE_ADMIN");
      const { assessmentId, stateVersion } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
        "PLANNED",
      );

      await request(app.getHttpServer())
        .post(`/api/v1/test-workflow/assessment/${assessmentId}/cancel`)
        .set("Cookie", admin.sessionCookie)
        .send({ expectedStateVersion: stateVersion + 100 })
        .expect(409);
    });

    it("Admin technical action missing AUTH_SCOPE (revoked) -> authorization denial BEFORE workflow (403, not 409 — Admin's AUTH_SCOPE-only policy carries no ASG/resource-context requirement, so this is the established DISCLOSE_FORBIDDEN/NOT_APPLICABLE path from Wave 0D-5, not a regression)", async () => {
      const business = await registerAndLoginBusiness("admin-noauthscope-biz");
      const consultant = await registerAndLoginLearner("admin-noauthscope-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const admin = await registerAndLoginLearner("admin-noauthscope-admin");
      await setRole(admin.userId, "ROLE_ADMIN");
      const { assessmentId, stateVersion } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
        "PLANNED",
      );
      // Revoke the scope authorization AFTER seeding — Admin's AUTH_SCOPE
      // requirement must still deny even though the transition itself
      // (PLANNED -> CANCELLED) would otherwise be perfectly valid.
      await queryRows(
        sql`update security_scope_authorizations set revoked_at = now() where consulting_request_id = (select consulting_request_id from security_assessments where id = ${assessmentId})`,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/test-workflow/assessment/${assessmentId}/cancel`)
        .set("Cookie", admin.sessionCookie)
        .send({ expectedStateVersion: stateVersion })
        .expect(403);
    });
  });
});
