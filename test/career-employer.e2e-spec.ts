import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";

/**
 * Wave 3B: Career + Employer Backend — real HTTP, real Postgres, real
 * `CareerResourceResolver`/`EmployerOpportunityResourceResolver` wired in
 * `security.module.ts` (no override), exactly like `internship.e2e-spec.ts`.
 */
const TEST_EMAIL_DOMAIN = "wave3b-career-employer.test";
let emailCounter = 0;
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${emailCounter++}@${TEST_EMAIL_DOMAIN}`;

describe("Wave 3B Career + Employer Backend APIs", () => {
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
      sql`delete from jobs where employer_id in (select id from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(sql`delete from jobs where title like 'Wave3B E2E%'`);
    await queryRows(
      sql`delete from employer_opportunities where employer_id in (select id from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await queryRows(
      sql`delete from audit_logs where actor_user_id in (select id from users where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
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

  /**
   * Direct evidence for one `auditRequired: true` operation: queries the
   * real `audit_logs` table (not "same guard path, therefore assumed")
   * for the most recent row this actor produced for this exact apiId, and
   * proves the centralized `PermissionGuard` -> `AuthorizationAuditService`
   * path actually wrote it — correct `action`, correct `entity_type`, and
   * no secret/session/credential value anywhere in the stored metadata.
   */
  async function expectAudit(
    actorUserId: string,
    apiId: string,
    expectedAction: "authorization.allowed" | "authorization.denied",
    expectedEntityType?: string,
  ) {
    const rows = await queryRows<{
      action: string;
      entity_type: string;
      metadata: Record<string, unknown>;
    }>(
      sql`select action, entity_type, metadata from audit_logs where actor_user_id = ${actorUserId} and metadata->>'apiId' = ${apiId} order by "timestamp" desc limit 1`,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.action).toBe(expectedAction);
    if (expectedEntityType) expect(row.entity_type).toBe(expectedEntityType);

    const serializedMetadata = JSON.stringify(row.metadata);
    for (const secretPattern of [
      /password/i,
      /csh_session/,
      /csrf/i,
      /passwordHash/i,
      /sessionKey/i,
      /verification.?token/i,
      /reset.?token/i,
    ]) {
      expect(serializedMetadata).not.toMatch(secretPattern);
    }
    return row;
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

  async function registerBusiness(label: string) {
    const email = uniqueEmail(label);
    const password = "password123";
    const csrf = await getCsrf();
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register/business")
      .set("Cookie", csrf.cookieHeader)
      .set("X-CSRF-Token", csrf.token)
      .send({
        name: `Business ${label}`,
        email,
        password,
        companyName: `Wave3B Co ${label}`,
        businessEmail: uniqueEmail(`${label}-company`),
      })
      .expect(201);
    const session = await login(email, password);
    return { userId: response.body.data.accountId as string, email, password, ...session };
  }

  async function registerAndLoginLearner(label: string) {
    const email = uniqueEmail(label);
    const password = "password123";
    const csrf = await getCsrf();
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register/learner")
      .set("Cookie", csrf.cookieHeader)
      .set("X-CSRF-Token", csrf.token)
      .send({ name: "E2E Learner", email, password })
      .expect(201);
    return { userId: response.body.data.accountId as string, email, password };
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

  function auth(agent: request.Test, session: { csrfCookie: string; csrfToken: string }) {
    return agent.set("Cookie", session.csrfCookie).set("X-CSRF-Token", session.csrfToken);
  }

  const validListingBody = (overrides: Record<string, unknown> = {}) => ({
    title: "Wave3B E2E Security Engineer",
    location: "London",
    level: "Mid",
    skills: ["typescript", "security"],
    applicationUrl: "https://example.test/apply",
    listingType: "JOB",
    ...overrides,
  });

  describe("Career listings (jobs)", () => {
    it("runs the full business -> admin moderation lifecycle with server-derived ownership", async () => {
      const admin = await registerAdmin("car-admin");
      const business = await registerBusiness("car-biz");

      // CREATE: employerId/employerName are server-derived, never client input.
      const createResponse = await auth(
        request(app.getHttpServer()).post("/api/v1/business/career-listings"),
        business,
      )
        .send(validListingBody())
        .expect(201);
      const listingId = createResponse.body.data.id as string;
      expect(createResponse.body.data.status).toBe("SUBMITTED");
      expect(createResponse.body.data.employerName).toBe("Wave3B Co car-biz");
      expect(createResponse.body.data.stateVersion).toBe(1);

      // API-BIZCAR-001 is auditRequired: true — direct evidence, not "same
      // guard path, therefore assumed".
      await expectAudit(business.userId, "API-BIZCAR-001", "authorization.allowed", "career");

      // A forged employerId in the body is rejected outright by the strict DTO.
      await auth(request(app.getHttpServer()).post("/api/v1/business/career-listings"), business)
        .send(validListingBody({ employerId: "11111111-1111-1111-1111-111111111111" }))
        .expect(422);

      // Not yet published: absent from public list and detail.
      await request(app.getHttpServer()).get(`/api/v1/career-listings/${listingId}`).expect(404);
      const publicListSubmitted = await request(app.getHttpServer())
        .get("/api/v1/career-listings")
        .expect(200);
      expect(
        (publicListSubmitted.body.data as Array<{ id: string }>).some((j) => j.id === listingId),
      ).toBe(false);

      // PATCH while SUBMITTED is denied — REJECTED only (§13 corrected policy).
      await auth(
        request(app.getHttpServer()).patch(`/api/v1/business/career-listings/${listingId}`),
        business,
      )
        .send({ title: "Changed", expectedStateVersion: 1 })
        .expect(409);

      // Admin moderates: start-review -> publish.
      await auth(
        request(app.getHttpServer()).post(
          `/api/v1/admin/career-listings/${listingId}/start-review`,
        ),
        admin,
      )
        .send({ expectedStateVersion: 1 })
        .expect(200);
      await expectAudit(admin.userId, "API-MOD-CAR-01", "authorization.allowed", "authorization");

      const publishResponse = await auth(
        request(app.getHttpServer()).post(`/api/v1/admin/career-listings/${listingId}/publish`),
        admin,
      )
        .send({ expectedStateVersion: 2 })
        .expect(200);
      expect(publishResponse.body.data.status).toBe("PUBLISHED");
      expect(publishResponse.body.data.publishedAt).not.toBeNull();
      await expectAudit(admin.userId, "API-MOD-CAR-02", "authorization.allowed", "authorization");

      // Now publicly visible, with no leaked private fields.
      const publicDetail = await request(app.getHttpServer())
        .get(`/api/v1/career-listings/${listingId}`)
        .expect(200);
      expect(publicDetail.body.data.status).toBe("PUBLISHED");
      expect(publicDetail.body.data.moderationReason).toBeUndefined();

      const publicListPublished = await request(app.getHttpServer())
        .get("/api/v1/career-listings")
        .expect(200);
      expect(
        (publicListPublished.body.data as Array<{ id: string }>).some((j) => j.id === listingId),
      ).toBe(true);

      // Outbound redirect targets the server-stored applicationUrl.
      const redirectResponse = await request(app.getHttpServer())
        .get(`/api/v1/career-listings/${listingId}/outbound`)
        .expect(302);
      expect(redirectResponse.headers.location).toBe("https://example.test/apply");

      // Business closes its own published listing.
      const closeResponse = await auth(
        request(app.getHttpServer()).post(`/api/v1/business/career-listings/${listingId}/close`),
        business,
      )
        .send({ expectedStateVersion: 3 })
        .expect(200);
      expect(closeResponse.body.data.status).toBe("CLOSED");
      await expectAudit(business.userId, "API-BIZCAR-006", "authorization.allowed", "career");

      // CLOSED is no longer PUBLISHED, so it disappears from public discovery.
      await request(app.getHttpServer()).get(`/api/v1/career-listings/${listingId}`).expect(404);
    });

    it("enforces REJECTED-only editing and lets a corrected listing resubmit", async () => {
      const admin = await registerAdmin("car-reject-admin");
      const business = await registerBusiness("car-reject-biz");

      const createResponse = await auth(
        request(app.getHttpServer()).post("/api/v1/business/career-listings"),
        business,
      )
        .send(validListingBody({ title: "Wave3B E2E Reject Flow" }))
        .expect(201);
      const listingId = createResponse.body.data.id as string;

      await auth(
        request(app.getHttpServer()).post(
          `/api/v1/admin/career-listings/${listingId}/start-review`,
        ),
        admin,
      )
        .send({ expectedStateVersion: 1 })
        .expect(200);

      const rejectResponse = await auth(
        request(app.getHttpServer()).post(`/api/v1/admin/career-listings/${listingId}/reject`),
        admin,
      )
        .send({ expectedStateVersion: 2, reason: "Missing required detail" })
        .expect(200);
      expect(rejectResponse.body.data.status).toBe("REJECTED");
      await expectAudit(admin.userId, "API-MOD-CAR-03", "authorization.allowed", "authorization");

      // Business now reads its own moderation reason.
      const ownDetail = await auth(
        request(app.getHttpServer()).get(`/api/v1/business/career-listings/${listingId}`),
        business,
      ).expect(200);
      expect(ownDetail.body.data.moderationReason).toBe("Missing required detail");

      // Rejected listing is never publicly visible either.
      await request(app.getHttpServer()).get(`/api/v1/career-listings/${listingId}`).expect(404);

      // Correcting content while REJECTED succeeds.
      const patchResponse = await auth(
        request(app.getHttpServer()).patch(`/api/v1/business/career-listings/${listingId}`),
        business,
      )
        .send({ title: "Wave3B E2E Reject Flow — corrected", expectedStateVersion: 3 })
        .expect(200);
      expect(patchResponse.body.data.title).toBe("Wave3B E2E Reject Flow — corrected");
      expect(patchResponse.body.data.status).toBe("REJECTED");

      // A PATCH attempting to smuggle a status/stateVersion override is rejected by the strict DTO.
      await auth(
        request(app.getHttpServer()).patch(`/api/v1/business/career-listings/${listingId}`),
        business,
      )
        .send({ status: "PUBLISHED", expectedStateVersion: 4 })
        .expect(422);

      const resubmitResponse = await auth(
        request(app.getHttpServer()).post(`/api/v1/business/career-listings/${listingId}/resubmit`),
        business,
      )
        .send({ expectedStateVersion: 4 })
        .expect(200);
      expect(resubmitResponse.body.data.status).toBe("SUBMITTED");
      await expectAudit(business.userId, "API-BIZCAR-005", "authorization.allowed", "career");
    });

    it("conceals a private cross-org listing from another business and rejects a forged employerId path", async () => {
      const businessA = await registerBusiness("car-a");
      const businessB = await registerBusiness("car-b");

      const createResponse = await auth(
        request(app.getHttpServer()).post("/api/v1/business/career-listings"),
        businessA,
      )
        .send(validListingBody({ title: "Wave3B E2E Org A Private Listing" }))
        .expect(201);
      const listingId = createResponse.body.data.id as string;

      // Business B cannot see, edit, resubmit, or close Business A's private listing.
      await auth(
        request(app.getHttpServer()).get(`/api/v1/business/career-listings/${listingId}`),
        businessB,
      ).expect(404);
      await auth(
        request(app.getHttpServer()).patch(`/api/v1/business/career-listings/${listingId}`),
        businessB,
      )
        .send({ title: "hijacked", expectedStateVersion: 1 })
        .expect(404);
      await auth(
        request(app.getHttpServer()).post(`/api/v1/business/career-listings/${listingId}/close`),
        businessB,
      )
        .send({ expectedStateVersion: 1 })
        .expect(404);

      // Negative audit behavior: PermissionGuard's `auditDenyIfRequired`
      // fires for an auditRequired operation on DENY too, not only ALLOW —
      // API-BIZCAR-006 is auditRequired: true, so Business B's denied close
      // attempt above must still have produced a denied audit row.
      await expectAudit(businessB.userId, "API-BIZCAR-006", "authorization.denied", "career");

      // Business A's own list/detail never leaks into Business B's own-org list.
      const businessBOwnList = await auth(
        request(app.getHttpServer()).get("/api/v1/business/career-listings"),
        businessB,
      ).expect(200);
      expect(
        (businessBOwnList.body.data as Array<{ id: string }>).some((j) => j.id === listingId),
      ).toBe(false);
    });

    it("rejects wrong-role and unauthenticated access to business/admin routes", async () => {
      const learner = await registerAndLoginLearner("car-wrong-role");
      const learnerSession = await login(learner.email, learner.password);

      await auth(
        request(app.getHttpServer()).post("/api/v1/business/career-listings"),
        learnerSession,
      )
        .send(validListingBody())
        .expect(403);

      await auth(
        request(app.getHttpServer()).get("/api/v1/admin/career-listings"),
        learnerSession,
      ).expect(403);

      await request(app.getHttpServer()).get("/api/v1/business/career-listings").expect(401);
      await request(app.getHttpServer()).get("/api/v1/admin/career-listings").expect(401);
    });

    it("applies atomic CAS: stale stateVersion conflicts, and only one of two concurrent transitions wins", async () => {
      const admin = await registerAdmin("car-cas-admin");
      const business = await registerBusiness("car-cas-biz");

      const createResponse = await auth(
        request(app.getHttpServer()).post("/api/v1/business/career-listings"),
        business,
      )
        .send(validListingBody({ title: "Wave3B E2E CAS Flow" }))
        .expect(201);
      const listingId = createResponse.body.data.id as string;

      // Stale version (row is at version 1, client claims 5).
      await auth(
        request(app.getHttpServer()).post(
          `/api/v1/admin/career-listings/${listingId}/start-review`,
        ),
        admin,
      )
        .send({ expectedStateVersion: 5 })
        .expect(409);

      // Correct version succeeds and bumps to 2.
      await auth(
        request(app.getHttpServer()).post(
          `/api/v1/admin/career-listings/${listingId}/start-review`,
        ),
        admin,
      )
        .send({ expectedStateVersion: 1 })
        .expect(200);

      await auth(
        request(app.getHttpServer()).post(`/api/v1/admin/career-listings/${listingId}/reject`),
        admin,
      )
        .send({ expectedStateVersion: 2, reason: "for concurrency test" })
        .expect(200);

      const resubmitOnce = () =>
        auth(
          request(app.getHttpServer()).post(
            `/api/v1/business/career-listings/${listingId}/resubmit`,
          ),
          business,
        ).send({ expectedStateVersion: 3 });

      const [first, second] = await Promise.all([resubmitOnce(), resubmitOnce()]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const finalRow = await queryRows<{ state_version: number; status: string }>(
        sql`select state_version, status from jobs where id = ${listingId}`,
      );
      expect(finalRow[0].state_version).toBe(4);
      expect(finalRow[0].status).toBe("SUBMITTED");
    });

    it("verifies the audit row for API-MOD-CAR-04 (admin-moderated close) — the one Career auditRequired op not reachable via a business-owned close", async () => {
      const admin = await registerAdmin("car-admin-close");
      const business = await registerBusiness("car-admin-close-biz");

      const createResponse = await auth(
        request(app.getHttpServer()).post("/api/v1/business/career-listings"),
        business,
      )
        .send(validListingBody({ title: "Wave3B E2E Admin Close Flow" }))
        .expect(201);
      const listingId = createResponse.body.data.id as string;

      await auth(
        request(app.getHttpServer()).post(
          `/api/v1/admin/career-listings/${listingId}/start-review`,
        ),
        admin,
      )
        .send({ expectedStateVersion: 1 })
        .expect(200);
      await auth(
        request(app.getHttpServer()).post(`/api/v1/admin/career-listings/${listingId}/publish`),
        admin,
      )
        .send({ expectedStateVersion: 2 })
        .expect(200);

      const adminCloseResponse = await auth(
        request(app.getHttpServer()).post(`/api/v1/admin/career-listings/${listingId}/close`),
        admin,
      )
        .send({ expectedStateVersion: 3 })
        .expect(200);
      expect(adminCloseResponse.body.data.status).toBe("CLOSED");
      await expectAudit(admin.userId, "API-MOD-CAR-04", "authorization.allowed", "authorization");
    });
  });

  describe("Employer opportunities", () => {
    const validOpportunityBody = (overrides: Record<string, unknown> = {}) => ({
      type: "INTERNSHIP_OPPORTUNITY",
      title: "Wave3B E2E Internship Opportunity",
      description: "Security internship",
      ...overrides,
    });

    it("is always ORG-owned, conceals cross-org access, and becomes public only once PUBLISHED", async () => {
      const admin = await registerAdmin("opp-admin");
      const businessA = await registerBusiness("opp-a");
      const businessB = await registerBusiness("opp-b");

      const createResponse = await auth(
        request(app.getHttpServer()).post("/api/v1/business/opportunities"),
        businessA,
      )
        .send(validOpportunityBody())
        .expect(201);
      const opportunityId = createResponse.body.data.id as string;
      expect(createResponse.body.data.status).toBe("SUBMITTED");
      expect(createResponse.body.data.employerId).toBeTruthy();
      await expectAudit(businessA.userId, "API-BIZOPP-001", "authorization.allowed", "employer");

      // Cross-org: Business B cannot see or manage Business A's opportunity.
      await auth(
        request(app.getHttpServer()).get(`/api/v1/business/opportunities/${opportunityId}`),
        businessB,
      ).expect(404);

      // Unpublished: not visible on the public surface.
      await request(app.getHttpServer()).get(`/api/v1/opportunities/${opportunityId}`).expect(404);

      // Admin moderates to PUBLISHED.
      await auth(
        request(app.getHttpServer()).post(
          `/api/v1/admin/opportunities/${opportunityId}/start-review`,
        ),
        admin,
      )
        .send({ expectedStateVersion: 1 })
        .expect(200);
      await expectAudit(admin.userId, "API-MOD-OPP-01", "authorization.allowed", "authorization");

      await auth(
        request(app.getHttpServer()).post(`/api/v1/admin/opportunities/${opportunityId}/publish`),
        admin,
      )
        .send({ expectedStateVersion: 2 })
        .expect(200);
      await expectAudit(admin.userId, "API-MOD-OPP-02", "authorization.allowed", "authorization");

      const publicDetail = await request(app.getHttpServer())
        .get(`/api/v1/opportunities/${opportunityId}`)
        .expect(200);
      expect(publicDetail.body.data.status).toBe("PUBLISHED");
      expect(publicDetail.body.data.moderationReason).toBeUndefined();
    });

    it("verifies audit rows for the remaining auditRequired Employer operations: reject, resubmit, business close, admin close", async () => {
      const admin = await registerAdmin("opp-audit-admin");
      const business = await registerBusiness("opp-audit-biz");

      // Flow 1: create -> start-review -> reject -> resubmit -> start-review -> publish -> business close.
      const create1 = await auth(
        request(app.getHttpServer()).post("/api/v1/business/opportunities"),
        business,
      )
        .send(validOpportunityBody({ title: "Wave3B E2E Opportunity Audit Flow 1" }))
        .expect(201);
      const opp1 = create1.body.data.id as string;

      await auth(
        request(app.getHttpServer()).post(`/api/v1/admin/opportunities/${opp1}/start-review`),
        admin,
      )
        .send({ expectedStateVersion: 1 })
        .expect(200);

      const rejectResponse = await auth(
        request(app.getHttpServer()).post(`/api/v1/admin/opportunities/${opp1}/reject`),
        admin,
      )
        .send({ expectedStateVersion: 2, reason: "Needs more detail" })
        .expect(200);
      expect(rejectResponse.body.data.status).toBe("REJECTED");
      await expectAudit(admin.userId, "API-MOD-OPP-03", "authorization.allowed", "authorization");

      const resubmitResponse = await auth(
        request(app.getHttpServer()).post(`/api/v1/business/opportunities/${opp1}/resubmit`),
        business,
      )
        .send({ expectedStateVersion: 3 })
        .expect(200);
      expect(resubmitResponse.body.data.status).toBe("SUBMITTED");
      await expectAudit(business.userId, "API-BIZOPP-005", "authorization.allowed", "employer");

      await auth(
        request(app.getHttpServer()).post(`/api/v1/admin/opportunities/${opp1}/start-review`),
        admin,
      )
        .send({ expectedStateVersion: 4 })
        .expect(200);
      await auth(
        request(app.getHttpServer()).post(`/api/v1/admin/opportunities/${opp1}/publish`),
        admin,
      )
        .send({ expectedStateVersion: 5 })
        .expect(200);

      const businessCloseResponse = await auth(
        request(app.getHttpServer()).post(`/api/v1/business/opportunities/${opp1}/close`),
        business,
      )
        .send({ expectedStateVersion: 6 })
        .expect(200);
      expect(businessCloseResponse.body.data.status).toBe("CLOSED");
      await expectAudit(business.userId, "API-BIZOPP-006", "authorization.allowed", "employer");

      // Flow 2: a second, separate opportunity for the admin-moderated close
      // (API-MOD-OPP-04) — CLOSED is terminal, so this cannot share opp1.
      const create2 = await auth(
        request(app.getHttpServer()).post("/api/v1/business/opportunities"),
        business,
      )
        .send(validOpportunityBody({ title: "Wave3B E2E Opportunity Audit Flow 2" }))
        .expect(201);
      const opp2 = create2.body.data.id as string;

      await auth(
        request(app.getHttpServer()).post(`/api/v1/admin/opportunities/${opp2}/start-review`),
        admin,
      )
        .send({ expectedStateVersion: 1 })
        .expect(200);
      await auth(
        request(app.getHttpServer()).post(`/api/v1/admin/opportunities/${opp2}/publish`),
        admin,
      )
        .send({ expectedStateVersion: 2 })
        .expect(200);

      const adminCloseResponse = await auth(
        request(app.getHttpServer()).post(`/api/v1/admin/opportunities/${opp2}/close`),
        admin,
      )
        .send({ expectedStateVersion: 3 })
        .expect(200);
      expect(adminCloseResponse.body.data.status).toBe("CLOSED");
      await expectAudit(admin.userId, "API-MOD-OPP-04", "authorization.allowed", "authorization");
    });

    it("rejects admin moderation calls from a Business actor even with a mapped Business permission elsewhere", async () => {
      const business = await registerBusiness("opp-admin-block");
      await auth(request(app.getHttpServer()).get("/api/v1/admin/opportunities"), business).expect(
        403,
      );
    });
  });
});
