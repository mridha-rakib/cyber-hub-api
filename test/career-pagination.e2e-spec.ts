import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { employerOpportunities, jobs } from "../src/infrastructure/database/schema";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";

const TEST_EMAIL_DOMAIN = "wave3d-pagination.test";
const CAREER_LOCATION = "Wave3D Pagination Location";
const CAREER_SKILL = "wave3d-career-pagination";
const OPPORTUNITY_SKILL = "wave3d-opportunity-pagination";
const RECORD_COUNT = 26;
let emailCounter = 0;

const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${emailCounter++}@${TEST_EMAIL_DOMAIN}`;

interface Session {
  readonly userId: string;
  readonly csrfCookie: string;
  readonly csrfToken: string;
}

interface BusinessSession extends Session {
  readonly employerId: string;
}

describe("Wave 3D backend contract remediation", () => {
  let app: INestApplication;
  let db: DatabaseConnection["db"];
  let business: BusinessSession;
  let otherBusiness: BusinessSession;
  let admin: Session;
  let careerIds: string[];
  let opportunityIds: string[];
  let unpublishedCareerId: string;

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

    business = await registerBusiness("owner");
    otherBusiness = await registerBusiness("other");
    admin = await registerAdmin("admin");

    careerIds = Array.from({ length: RECORD_COUNT }, () => randomUUID());
    opportunityIds = Array.from({ length: RECORD_COUNT }, () => randomUUID());
    unpublishedCareerId = randomUUID();
    const sharedTimestamp = new Date("2026-09-30T12:00:00.000Z");

    await db.insert(jobs).values(
      careerIds.map((id, index) => ({
        id,
        title: `Wave3D Remediation Career ${index}`,
        employerName: "Wave3D Pagination Company",
        employerId: business.employerId,
        location: CAREER_LOCATION,
        level: "Senior",
        skills: [CAREER_SKILL, "security"],
        applicationUrl: `https://example.test/career/${index}`,
        listingType: "JOB" as const,
        remoteUk: true,
        status: "PUBLISHED" as const,
        stateVersion: 1,
        submittedByUserId: business.userId,
        publishedAt: sharedTimestamp,
        createdAt: sharedTimestamp,
        updatedAt: sharedTimestamp,
      })),
    );

    await db.insert(jobs).values({
      id: unpublishedCareerId,
      title: "Wave3D Remediation Unpublished Career",
      employerName: "Wave3D Pagination Company",
      employerId: business.employerId,
      location: CAREER_LOCATION,
      level: "Senior",
      skills: [CAREER_SKILL],
      applicationUrl: "https://example.test/unpublished",
      listingType: "JOB",
      remoteUk: true,
      status: "SUBMITTED",
      stateVersion: 1,
      submittedByUserId: business.userId,
      createdAt: sharedTimestamp,
      updatedAt: sharedTimestamp,
    });

    await db.insert(employerOpportunities).values(
      opportunityIds.map((id, index) => ({
        id,
        employerId: business.employerId,
        createdByUserId: business.userId,
        type: "INTERNSHIP_OPPORTUNITY" as const,
        title: `Wave3D Remediation Opportunity ${index}`,
        description: "Deterministic pagination record",
        requirements: { cohort: "wave3d" },
        skills: [OPPORTUNITY_SKILL, "security"],
        applicationUrl: `https://example.test/opportunity/${index}`,
        status: "PUBLISHED" as const,
        stateVersion: 1,
        publishedAt: sharedTimestamp,
        createdAt: sharedTimestamp,
        updatedAt: sharedTimestamp,
      })),
    );
  });

  afterAll(async () => {
    await queryRows(sql`delete from jobs where title like 'Wave3D Remediation%'`);
    await queryRows(sql`delete from employer_opportunities where title like 'Wave3D Remediation%'`);
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

  async function getCsrf() {
    const response = await request(app.getHttpServer()).get("/api/v1/auth/csrf-token").expect(200);
    const setCookie = response.headers["set-cookie"] as unknown as string[];
    const csrfCookie = setCookie.find((cookie) => cookie.startsWith("csh_csrf="));
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
    const csrfCookie = setCookie.find((cookie) => cookie.startsWith("csh_csrf="));
    if (!csrfCookie) throw new Error("CSRF cookie missing");
    return {
      cookieHeader: `${sessionCookie}; ${csrfCookie.split(";")[0]}`,
      token: response.body.data.csrfToken as string,
    };
  }

  async function login(email: string, password: string): Promise<Omit<Session, "userId">> {
    const csrf = await getCsrf();
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/sessions")
      .set("Cookie", csrf.cookieHeader)
      .set("X-CSRF-Token", csrf.token)
      .send({ email, password })
      .expect(200);
    const setCookie = response.headers["set-cookie"] as unknown as string[];
    const sessionCookie = (
      setCookie.find((cookie) => cookie.startsWith("csh_session=")) as string
    ).split(";")[0];
    const sessionCsrf = await getCsrfWithSession(sessionCookie);
    return { csrfCookie: sessionCsrf.cookieHeader, csrfToken: sessionCsrf.token };
  }

  async function registerBusiness(label: string): Promise<BusinessSession> {
    const email = uniqueEmail(label);
    const password = "password123";
    const csrf = await getCsrf();
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register/business")
      .set("Cookie", csrf.cookieHeader)
      .set("X-CSRF-Token", csrf.token)
      .send({
        name: `Wave3D Business ${label}`,
        email,
        password,
        companyName: `Wave3D Company ${label}`,
        businessEmail: uniqueEmail(`${label}-company`),
      })
      .expect(201);
    const userId = response.body.data.accountId as string;
    const [user] = await queryRows<{ employer_id: string }>(
      sql`select employer_id from users where id = ${userId}`,
    );
    return { userId, employerId: user.employer_id, ...(await login(email, password)) };
  }

  async function registerAdmin(label: string): Promise<Session> {
    const email = uniqueEmail(label);
    const password = "password123";
    const csrf = await getCsrf();
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register/learner")
      .set("Cookie", csrf.cookieHeader)
      .set("X-CSRF-Token", csrf.token)
      .send({ name: "Wave3D Admin", email, password })
      .expect(201);
    const userId = response.body.data.accountId as string;
    await queryRows(
      sql`update users set role = 'ROLE_ADMIN', verified = true where id = ${userId}`,
    );
    return { userId, ...(await login(email, password)) };
  }

  function get(path: string, session?: Session) {
    const operation = request(app.getHttpServer()).get(path);
    return session ? operation.set("Cookie", session.csrfCookie) : operation;
  }

  function expectPageEnvelope(response: request.Response, limit: number) {
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.meta.page.limit).toBe(limit);
    expect(typeof response.body.meta.page.hasMore).toBe("boolean");
    expect(
      response.body.meta.page.nextCursor === null ||
        typeof response.body.meta.page.nextCursor === "string",
    ).toBe(true);
    expect(typeof response.body.requestId).toBe("string");
  }

  async function expectTwoPageContinuity(
    path: string,
    expectedIds: readonly string[],
    session?: Session,
  ) {
    const first = await get(path, session).expect(200);
    expectPageEnvelope(first, 13);
    expect(first.body.data).toHaveLength(13);
    expect(first.body.meta.page.hasMore).toBe(true);
    expect(typeof first.body.meta.page.nextCursor).toBe("string");

    const second = await get(
      `${path}&cursor=${encodeURIComponent(first.body.meta.page.nextCursor as string)}`,
      session,
    ).expect(200);
    expectPageEnvelope(second, 13);
    expect(second.body.data).toHaveLength(13);
    expect(second.body.meta.page.hasMore).toBe(false);
    expect(second.body.meta.page.nextCursor).toBeNull();

    const ids = [...first.body.data, ...second.body.data].map((row) => row.id as string);
    expect(new Set(ids).size).toBe(RECORD_COUNT);
    expect(new Set(ids)).toEqual(new Set(expectedIds));
  }

  it("returns the exact Career public projection and preserves controlled outbound navigation", async () => {
    const list = await request(app.getHttpServer())
      .get("/api/v1/career-listings")
      .query({
        type: "JOB",
        location: CAREER_LOCATION,
        level: "Senior",
        skill: CAREER_SKILL,
        remoteUk: "true",
        limit: "1",
      })
      .expect(200);
    const item = list.body.data[0] as Record<string, unknown>;
    const approvedFields = [
      "employerName",
      "id",
      "level",
      "listingType",
      "location",
      "publishedAt",
      "remoteUk",
      "skills",
      "title",
    ];
    expect(Object.keys(item).sort()).toEqual(approvedFields);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/career-listings/${item.id as string}`)
      .expect(200);
    expect(Object.keys(detail.body.data).sort()).toEqual(approvedFields);
    for (const forbidden of [
      "applicationUrl",
      "status",
      "createdAt",
      "updatedAt",
      "employerId",
      "submittedByUserId",
      "moderationReason",
      "stateVersion",
    ]) {
      expect(detail.body.data[forbidden]).toBeUndefined();
    }

    const outbound = await request(app.getHttpServer())
      .get(`/api/v1/career-listings/${item.id as string}/outbound`)
      .expect(302);
    expect(outbound.headers.location).toMatch(/^https:\/\/example\.test\/career\//);
    await request(app.getHttpServer())
      .get(`/api/v1/career-listings/${unpublishedCareerId}`)
      .expect(404);
  });

  it("uses default limit 25 and a consistent empty-page envelope on all six list APIs", async () => {
    const populated = [
      { path: `/api/v1/career-listings?location=${encodeURIComponent(CAREER_LOCATION)}` },
      { path: "/api/v1/business/career-listings?status=PUBLISHED", session: business },
      {
        path: `/api/v1/admin/career-listings?status=PUBLISHED&employerId=${business.employerId}`,
        session: admin,
      },
      { path: `/api/v1/opportunities?skill=${OPPORTUNITY_SKILL}` },
      { path: "/api/v1/business/opportunities?status=PUBLISHED", session: business },
      {
        path: `/api/v1/admin/opportunities?status=PUBLISHED&employerId=${business.employerId}`,
        session: admin,
      },
    ];

    for (const entry of populated) {
      const response = await get(entry.path, entry.session).expect(200);
      expectPageEnvelope(response, 25);
      expect(response.body.data).toHaveLength(25);
      expect(response.body.meta.page.hasMore).toBe(true);
      expect(typeof response.body.meta.page.nextCursor).toBe("string");
    }

    const maximumLimit = await get(
      `/api/v1/career-listings?location=${encodeURIComponent(CAREER_LOCATION)}&limit=100`,
    ).expect(200);
    expectPageEnvelope(maximumLimit, 100);
    expect(maximumLimit.body.data).toHaveLength(RECORD_COUNT);
    expect(maximumLimit.body.meta.page).toEqual({
      limit: 100,
      nextCursor: null,
      hasMore: false,
    });

    for (const path of [
      "/api/v1/career-listings?location=Wave3D-No-Match",
      "/api/v1/opportunities?skill=wave3d-no-match",
    ]) {
      const response = await get(path).expect(200);
      expectPageEnvelope(response, 25);
      expect(response.body.data).toEqual([]);
      expect(response.body.meta.page).toEqual({ limit: 25, nextCursor: null, hasMore: false });
    }
  });

  it("provides duplicate-free, skip-free continuation for equal timestamps on all six APIs", async () => {
    await expectTwoPageContinuity(
      `/api/v1/career-listings?type=JOB&location=${encodeURIComponent(CAREER_LOCATION)}&level=Senior&skill=${CAREER_SKILL}&remoteUk=true&limit=13`,
      careerIds,
    );
    await expectTwoPageContinuity(
      "/api/v1/business/career-listings?status=PUBLISHED&limit=13",
      careerIds,
      business,
    );
    await expectTwoPageContinuity(
      `/api/v1/admin/career-listings?status=PUBLISHED&employerId=${business.employerId}&type=JOB&limit=13`,
      careerIds,
      admin,
    );
    await expectTwoPageContinuity(
      `/api/v1/opportunities?type=INTERNSHIP_OPPORTUNITY&skill=${OPPORTUNITY_SKILL}&limit=13`,
      opportunityIds,
    );
    await expectTwoPageContinuity(
      "/api/v1/business/opportunities?type=INTERNSHIP_OPPORTUNITY&status=PUBLISHED&limit=13",
      opportunityIds,
      business,
    );
    await expectTwoPageContinuity(
      `/api/v1/admin/opportunities?type=INTERNSHIP_OPPORTUNITY&status=PUBLISHED&employerId=${business.employerId}&limit=13`,
      opportunityIds,
      admin,
    );
  });

  it("rejects malformed public filters and every malformed cursor form with 422", async () => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const malformedCursors = [
      "not-a-cursor",
      "***",
      Buffer.from("not-json", "utf8").toString("base64url"),
      encode({ v: 1, k: "job-published-at", i: randomUUID() }),
      encode({ v: 1, k: "job-published-at", t: "not-a-date", i: randomUUID() }),
      encode({ v: 1, k: "job-published-at", t: new Date().toISOString(), i: "not-a-uuid" }),
    ];
    const invalidPaths = [
      "/api/v1/career-listings?type=INVALID",
      "/api/v1/career-listings?remoteUk=bogus",
      "/api/v1/career-listings?limit=bogus",
      "/api/v1/career-listings?limit=0",
      "/api/v1/career-listings?limit=101",
      "/api/v1/opportunities?type=INVALID",
      "/api/v1/opportunities?limit=-1",
      ...malformedCursors.map(
        (cursor) => `/api/v1/career-listings?cursor=${encodeURIComponent(cursor)}`,
      ),
    ];

    for (const path of invalidPaths) {
      const response = await get(path).expect(422);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(response.body)).not.toMatch(
        /postgres|career_listing_type|select\s|from\s+"jobs"|stack|drizzle/i,
      );
    }
  });

  it("rejects malformed business/admin list filters before repository execution", async () => {
    const invalidRequests = [
      { path: "/api/v1/business/career-listings?status=INVALID", session: business },
      { path: "/api/v1/business/career-listings?limit=1.5", session: business },
      { path: "/api/v1/admin/career-listings?type=INVALID", session: admin },
      { path: "/api/v1/admin/career-listings?employerId=not-a-uuid", session: admin },
      { path: "/api/v1/business/opportunities?status=INVALID", session: business },
      { path: "/api/v1/business/opportunities?type=INVALID", session: business },
      { path: "/api/v1/admin/opportunities?status=INVALID", session: admin },
      { path: "/api/v1/admin/opportunities?limit=999999", session: admin },
      { path: "/api/v1/admin/opportunities?cursor=not-a-cursor", session: admin },
    ];

    for (const entry of invalidRequests) {
      const response = await get(entry.path, entry.session).expect(422);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("keeps filters and ORG authority independent from cursor continuation state", async () => {
    const first = await get(
      "/api/v1/business/career-listings?status=PUBLISHED&limit=13",
      business,
    ).expect(200);
    const cursor = first.body.meta.page.nextCursor as string;

    const otherOrg = await get(
      `/api/v1/business/career-listings?status=PUBLISHED&limit=13&cursor=${encodeURIComponent(cursor)}`,
      otherBusiness,
    ).expect(200);
    expect(otherOrg.body.data).toEqual([]);
    expect(otherOrg.body.meta.page).toEqual({ limit: 13, nextCursor: null, hasMore: false });

    const wrongDomain = await get(
      `/api/v1/opportunities?cursor=${encodeURIComponent(cursor)}`,
    ).expect(422);
    expect(wrongDomain.body.error.code).toBe("VALIDATION_ERROR");
  });
});
