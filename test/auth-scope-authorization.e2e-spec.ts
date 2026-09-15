import { Controller, Get, type INestApplication, Module } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import type { ResourceContext } from "../src/core/security/authorization/authorization-context.types";
import { RequirePermission } from "../src/core/security/authorization/require-permission.decorator";
import {
  RESOURCE_CONTEXT_RESOLVERS,
  type ResourceContextResolver,
} from "../src/core/security/authorization/resource-context-resolver";
import {
  consultingRequests,
  securityAssessments,
  securityScopeAuthorizations,
} from "../src/infrastructure/database/schema";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";

// Assigned by beforeAll before any request runs; the resolvers below close
// over this binding (not a snapshot), so they read whatever `db` holds at
// REQUEST time, long after beforeAll has finished.
let db: DatabaseConnection["db"];

// Real, DB-backed resolvers (Wave 0D-4B Phase 25). Unlike the plain
// in-memory fixtures in resource-scope-authorization.e2e-spec.ts, these
// resolve ASG/ORG facts by reading the SAME real consulting_requests /
// security_assessments rows that AuthScopeEvaluator itself reads, proving
// ASG and AUTH_SCOPE compose over genuinely persisted, independent
// evidence — never merged, never allowed to substitute for one another.
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

const consultingResolver: ResourceContextResolver = {
  resourceType: "consulting",
  resolve: async ({ routeParams }) => {
    const assessmentId = routeParams.assessmentId;
    if (!assessmentId) return null;
    const rows = await db.execute(
      sql`select cr.employer_id, cr.assigned_consultant_id
          from security_assessments sa
          join consulting_requests cr on cr.id = sa.consulting_request_id
          where sa.id = ${assessmentId}`,
    );
    const row = rows.rows[0] as
      | { employer_id: string; assigned_consultant_id: string | null }
      | undefined;
    if (!row) return null;
    const context: ResourceContext = {
      resourceType: "consulting",
      resourceId: assessmentId,
      employerId: row.employer_id,
      assignedUserIds: row.assigned_consultant_id ? [row.assigned_consultant_id] : [],
    };
    return context;
  },
};

@Controller("test-auth-scope")
class TestAuthScopeController {
  // ROLE_CONSULTANT: [ASG, AUTH_SCOPE] — ROLE_ADMIN: [AUTH_SCOPE] only.
  @RequirePermission("assessment.manage_assigned")
  @Get("assessment/:assessmentId")
  assessmentRoute() {
    return { ok: true };
  }

  // ROLE_ADMIN: scopes: [] (plain role-only grant, ORG for Business) — no
  // AUTH_SCOPE at all. Proves non-technical operations on the same
  // "assessment" domain are completely unaffected by the AUTH_SCOPE
  // machinery wired in for assessment.manage_assigned.
  @RequirePermission("assessment.read_client")
  @Get("assessment-read/:assessmentId")
  assessmentReadRoute() {
    return { ok: true };
  }

  // ROLE_CONSULTANT/ROLE_ADMIN: [ASG] only — no AUTH_SCOPE. Proves a
  // genuinely ASG-only operation is unaffected by AUTH_SCOPE.
  @RequirePermission("consulting.internal_note.manage")
  @Get("note/:assessmentId")
  noteRoute() {
    return { ok: true };
  }
}

@Module({ controllers: [TestAuthScopeController] })
class TestAuthScopeModule {}

const TEST_EMAIL_DOMAIN = "wave0d4b-e2e.test";
let emailCounter = 0;
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${emailCounter++}@${TEST_EMAIL_DOMAIN}`;

describe("Wave 0D-4B AUTH_SCOPE persistence + runtime enforcement", () => {
  let app: INestApplication;
  const emailPort: TransactionalEmailPort = {
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, TestAuthScopeModule],
    })
      .overrideProvider(EMAIL_PORT)
      .useValue(emailPort)
      .overrideProvider(RESOURCE_CONTEXT_RESOLVERS)
      .useValue([assessmentResolver, consultingResolver])
      .compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.init();
    // Assigns the module-scoped `db` the resolvers above close over — safe
    // because `resolve()` only ever runs later, during an it() block, long
    // after this assignment has completed.
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
      .send({ name: "Scope Learner", email, password })
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

  interface ScopeOptions {
    isCurrent?: boolean;
    revoked?: boolean;
    validFrom?: Date;
    validUntil?: Date | null;
    authorizedTargets?: string[];
    allowedActivities?: string[];
    employerIdOverride?: string;
  }

  /** Creates a full, real, persisted chain: consulting_request -> security_scope_authorization -> security_assessment. */
  async function seedAssessment(
    employerId: string,
    submittedByUserId: string,
    assignedConsultantId: string,
    confirmedByUserId: string,
    opts: ScopeOptions = {},
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
        status: "ACCEPTED",
        assignedConsultantId,
      })
      .returning({ id: consultingRequests.id });

    const [scopeRow] = await db
      .insert(securityScopeAuthorizations)
      .values({
        consultingRequestId: crRow.id,
        employerId: opts.employerIdOverride ?? employerId,
        versionNo: 1,
        authorizedTargets: opts.authorizedTargets ?? ["app.acme.test"],
        allowedActivities: opts.allowedActivities ?? ["VULNERABILITY_ASSESSMENT"],
        confirmedByUserId,
        confirmedAt: new Date(),
        validFrom: opts.validFrom ?? new Date(Date.now() - 24 * 60 * 60 * 1000),
        validUntil:
          opts.validUntil === undefined
            ? new Date(Date.now() + 24 * 60 * 60 * 1000)
            : opts.validUntil,
        isCurrent: opts.isCurrent ?? true,
        revokedAt: opts.revoked ? new Date() : null,
      })
      .returning({ id: securityScopeAuthorizations.id });

    const [assessmentRow] = await db
      .insert(securityAssessments)
      .values({
        employerId,
        consultingRequestId: crRow.id,
        scopeAuthorizationId: scopeRow.id,
        service: "VULNERABILITY_ASSESSMENT",
        scopeSnapshot: { targets: opts.authorizedTargets ?? ["app.acme.test"] },
        assignedConsultantId,
        status: "PLANNED",
      })
      .returning({ id: securityAssessments.id });

    return {
      consultingRequestId: crRow.id,
      scopeAuthorizationId: scopeRow.id,
      assessmentId: assessmentRow.id,
    };
  }

  describe("AUTH_SCOPE + ASG composition (assessment.manage_assigned)", () => {
    it("Consultant: allowed when assigned AND scope is current/valid/covers target+activity", async () => {
      const business = await registerAndLoginBusiness("valid-biz");
      const consultant = await registerAndLoginLearner("valid-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
      );

      await request(app.getHttpServer())
        .get(`/api/v1/test-auth-scope/assessment/${assessmentId}`)
        .set("Cookie", consultant.sessionCookie)
        .expect(200);
    });

    it("Consultant: denied when a DIFFERENT consultant (not assigned) calls — ASG fails independently of AUTH_SCOPE", async () => {
      const business = await registerAndLoginBusiness("unassigned-biz");
      const assignedConsultant = await registerAndLoginLearner("unassigned-assigned");
      await setRole(assignedConsultant.userId, "ROLE_CONSULTANT");
      const otherConsultant = await registerAndLoginLearner("unassigned-other");
      await setRole(otherConsultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        assignedConsultant.userId,
        business.userId,
      );

      await request(app.getHttpServer())
        .get(`/api/v1/test-auth-scope/assessment/${assessmentId}`)
        .set("Cookie", otherConsultant.sessionCookie)
        .expect(403);
    });

    it("Consultant: denied when the scope authorization has been revoked, even though assigned", async () => {
      const business = await registerAndLoginBusiness("revoked-biz");
      const consultant = await registerAndLoginLearner("revoked-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
        { revoked: true },
      );

      await request(app.getHttpServer())
        .get(`/api/v1/test-auth-scope/assessment/${assessmentId}`)
        .set("Cookie", consultant.sessionCookie)
        .expect(403);
    });

    it("Consultant: denied when the scope authorization has expired (valid_until in the past)", async () => {
      const business = await registerAndLoginBusiness("expired-biz");
      const consultant = await registerAndLoginLearner("expired-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
        { validUntil: new Date(Date.now() - 60 * 60 * 1000) },
      );

      await request(app.getHttpServer())
        .get(`/api/v1/test-auth-scope/assessment/${assessmentId}`)
        .set("Cookie", consultant.sessionCookie)
        .expect(403);
    });

    it("Consultant: denied when the scope authorization is not yet valid (valid_from in the future)", async () => {
      const business = await registerAndLoginBusiness("notyet-biz");
      const consultant = await registerAndLoginLearner("notyet-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
        { validFrom: new Date(Date.now() + 60 * 60 * 1000) },
      );

      await request(app.getHttpServer())
        .get(`/api/v1/test-auth-scope/assessment/${assessmentId}`)
        .set("Cookie", consultant.sessionCookie)
        .expect(403);
    });

    it("Consultant: denied when the authorization is no longer current (superseded)", async () => {
      const business = await registerAndLoginBusiness("notcurrent-biz");
      const consultant = await registerAndLoginLearner("notcurrent-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
        { isCurrent: false },
      );

      await request(app.getHttpServer())
        .get(`/api/v1/test-auth-scope/assessment/${assessmentId}`)
        .set("Cookie", consultant.sessionCookie)
        .expect(403);
    });

    it("Consultant: denied when the activity performed is not covered by allowedActivities", async () => {
      const business = await registerAndLoginBusiness("wrongact-biz");
      const consultant = await registerAndLoginLearner("wrongact-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
        { allowedActivities: ["PHISHING_AWARENESS"] }, // assessment.service is VULNERABILITY_ASSESSMENT
      );

      await request(app.getHttpServer())
        .get(`/api/v1/test-auth-scope/assessment/${assessmentId}`)
        .set("Cookie", consultant.sessionCookie)
        .expect(403);
    });

    it("Consultant: denied when authorized_targets is empty (no coverage evidence — treated as incomplete)", async () => {
      const business = await registerAndLoginBusiness("notarget-biz");
      const consultant = await registerAndLoginLearner("notarget-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
        { authorizedTargets: [] },
      );

      await request(app.getHttpServer())
        .get(`/api/v1/test-auth-scope/assessment/${assessmentId}`)
        .set("Cookie", consultant.sessionCookie)
        .expect(403);
    });

    it("Consultant: denied when the linked authorization's employer disagrees with the assessment's own employer (data-integrity edge case)", async () => {
      const business = await registerAndLoginBusiness("wrongemployer-biz");
      const otherBusiness = await registerAndLoginBusiness("wrongemployer-other");
      const consultant = await registerAndLoginLearner("wrongemployer-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
        { employerIdOverride: otherBusiness.employerId },
      );

      await request(app.getHttpServer())
        .get(`/api/v1/test-auth-scope/assessment/${assessmentId}`)
        .set("Cookie", consultant.sessionCookie)
        .expect(403);
    });

    it("Consultant: denied when no assessment exists for the given locator (nonexistent id — fails closed, not 404-vs-403 information leak)", async () => {
      const consultant = await registerAndLoginLearner("nonexistent-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");

      await request(app.getHttpServer())
        .get("/api/v1/test-auth-scope/assessment/00000000-0000-0000-0000-000000000000")
        .set("Cookie", consultant.sessionCookie)
        .expect(403);
    });

    it("Admin: allowed via AUTH_SCOPE alone when scope is valid — no ASG/assignment required for Admin", async () => {
      const business = await registerAndLoginBusiness("admin-valid-biz");
      const consultant = await registerAndLoginLearner("admin-valid-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const admin = await registerAndLoginLearner("admin-valid-admin");
      await setRole(admin.userId, "ROLE_ADMIN");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId, // Admin is NOT the assigned consultant
        business.userId,
      );

      await request(app.getHttpServer())
        .get(`/api/v1/test-auth-scope/assessment/${assessmentId}`)
        .set("Cookie", admin.sessionCookie)
        .expect(200);
    });

    it("Admin: still denied when the scope authorization is revoked — Admin never bypasses AUTH_SCOPE, role alone is insufficient", async () => {
      const business = await registerAndLoginBusiness("admin-revoked-biz");
      const consultant = await registerAndLoginLearner("admin-revoked-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const admin = await registerAndLoginLearner("admin-revoked-admin");
      await setRole(admin.userId, "ROLE_ADMIN");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
        { revoked: true },
      );

      await request(app.getHttpServer())
        .get(`/api/v1/test-auth-scope/assessment/${assessmentId}`)
        .set("Cookie", admin.sessionCookie)
        .expect(403);
    });
  });

  describe("non-technical operations are unaffected by the AUTH_SCOPE machinery", () => {
    it("Admin: assessment.read_client (scopes: [], no AUTH_SCOPE) is allowed even for a nonexistent assessment id", async () => {
      const admin = await registerAndLoginLearner("unaffected-admin");
      await setRole(admin.userId, "ROLE_ADMIN");

      await request(app.getHttpServer())
        .get("/api/v1/test-auth-scope/assessment-read/00000000-0000-0000-0000-000000000000")
        .set("Cookie", admin.sessionCookie)
        .expect(200);
    });

    it("Consultant: consulting.internal_note.manage (ASG only, no AUTH_SCOPE) allows the assigned consultant regardless of scope-authorization state", async () => {
      const business = await registerAndLoginBusiness("note-biz");
      const consultant = await registerAndLoginLearner("note-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
        { revoked: true }, // AUTH_SCOPE would deny this, but this route never checks it
      );

      await request(app.getHttpServer())
        .get(`/api/v1/test-auth-scope/note/${assessmentId}`)
        .set("Cookie", consultant.sessionCookie)
        .expect(200);
    });

    it("Consultant: consulting.internal_note.manage still denies an unassigned consultant (ASG independently enforced)", async () => {
      const business = await registerAndLoginBusiness("note-deny-biz");
      const assignedConsultant = await registerAndLoginLearner("note-deny-assigned");
      await setRole(assignedConsultant.userId, "ROLE_CONSULTANT");
      const otherConsultant = await registerAndLoginLearner("note-deny-other");
      await setRole(otherConsultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        assignedConsultant.userId,
        business.userId,
      );

      await request(app.getHttpServer())
        .get(`/api/v1/test-auth-scope/note/${assessmentId}`)
        .set("Cookie", otherConsultant.sessionCookie)
        .expect(403);
    });
  });

  describe("spoofing resistance", () => {
    it("a spoofed body/query claiming a different target/activity/consultant cannot flip a denied AUTH_SCOPE decision to allowed", async () => {
      const business = await registerAndLoginBusiness("spoof-deny-biz");
      const consultant = await registerAndLoginLearner("spoof-deny-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
        { revoked: true },
      );

      await request(app.getHttpServer())
        .get(
          `/api/v1/test-auth-scope/assessment/${assessmentId}?target=app.acme.test&activity=VULNERABILITY_ASSESSMENT&authorized=true&isCurrent=true&revokedAt=null`,
        )
        .set("Cookie", consultant.sessionCookie)
        .send({
          target: "app.acme.test",
          activity: "VULNERABILITY_ASSESSMENT",
          assignedConsultantId: consultant.userId,
          revokedAt: null,
          isCurrent: true,
        })
        .expect(403);
    });

    it("a spoofed body/query cannot substitute for a genuinely valid decision either — the real DB state alone determines the outcome (still 200 on real valid data)", async () => {
      const business = await registerAndLoginBusiness("spoof-allow-biz");
      const consultant = await registerAndLoginLearner("spoof-allow-consultant");
      await setRole(consultant.userId, "ROLE_CONSULTANT");
      const { assessmentId } = await seedAssessment(
        business.employerId,
        business.userId,
        consultant.userId,
        business.userId,
      );

      await request(app.getHttpServer())
        .get(
          `/api/v1/test-auth-scope/assessment/${assessmentId}?target=something-unauthorized.test`,
        )
        .set("Cookie", consultant.sessionCookie)
        .send({ target: "something-unauthorized.test" })
        .expect(200);
    });
  });
});
