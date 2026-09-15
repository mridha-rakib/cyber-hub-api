import { Controller, Get, type INestApplication, Module } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import type { ResourceContext } from "../src/core/security/authorization/authorization-context.types";
import { AuthorizeOperation } from "../src/core/security/authorization/authorize-operation.decorator";
import { ConditionRegistry } from "../src/core/security/authorization/condition-registry";
import { RequirePermission } from "../src/core/security/authorization/require-permission.decorator";
import {
  RESOURCE_CONTEXT_RESOLVERS,
  type ResourceContextResolver,
} from "../src/core/security/authorization/resource-context-resolver";
import { EMAIL_PORT, type TransactionalEmailPort } from "../src/infrastructure/email/email.port";

// Mutable identity slots the test-only resolvers close over, filled in
// after real accounts are registered against the real DB-backed auth flow.
// This lets resolvers return genuinely authoritative facts (server-loaded,
// keyed only by the route's resourceId locator) without a real product
// table existing — exactly what Wave 0D-3 asks test-only resolvers to do.
const identities = {
  learnerUserId: "",
  otherUserId: "",
  businessEmployerId: "",
  otherEmployerId: "",
  mentorUserId: "",
};

const portfolioResolver: ResourceContextResolver = {
  resourceType: "portfolio",
  resolve: async ({ routeParams }) => {
    const table: Record<string, ResourceContext | null> = {
      own: {
        resourceType: "portfolio",
        resourceId: "own",
        ownerUserId: identities.learnerUserId,
        isPublic: false,
      },
      other: {
        resourceType: "portfolio",
        resourceId: "other",
        ownerUserId: identities.otherUserId,
        isPublic: false,
      },
      public: {
        resourceType: "portfolio",
        resourceId: "public",
        ownerUserId: identities.otherUserId,
        isPublic: true,
      },
      draft: {
        resourceType: "portfolio",
        resourceId: "draft",
        ownerUserId: identities.otherUserId,
        isPublic: false,
      },
      missing: null,
    };
    if (routeParams.id === "throws") throw new Error("simulated resolver failure");
    return table[routeParams.id] ?? null;
  },
};

const consultingResolver: ResourceContextResolver = {
  resourceType: "consulting",
  resolve: async ({ routeParams }) => {
    if (routeParams.id === "same-org") {
      return {
        resourceType: "consulting",
        resourceId: "same-org",
        employerId: identities.businessEmployerId,
      };
    }
    if (routeParams.id === "other-org") {
      return {
        resourceType: "consulting",
        resourceId: "other-org",
        employerId: identities.otherEmployerId,
      };
    }
    return null;
  },
};

const submissionResolver: ResourceContextResolver = {
  resourceType: "submission",
  resolve: async ({ routeParams }) => {
    if (routeParams.id === "assigned") {
      return {
        resourceType: "submission",
        resourceId: "assigned",
        assignedUserIds: [identities.mentorUserId],
      };
    }
    if (routeParams.id === "unassigned") {
      return {
        resourceType: "submission",
        resourceId: "unassigned",
        assignedUserIds: ["someone-else"],
      };
    }
    if (routeParams.id === "removed") {
      return { resourceType: "submission", resourceId: "removed", assignedUserIds: [] };
    }
    return null;
  },
};

const cvReviewResolver: ResourceContextResolver = {
  resourceType: "cv_review",
  resolve: async ({ routeParams }) => {
    if (routeParams.id === "own") {
      return {
        resourceType: "cv_review",
        resourceId: "own",
        ownerUserId: identities.learnerUserId,
        conditionFacts: {},
      };
    }
    return null;
  },
};

// resource.progress.manage_own grants ONLY ROLE_LEARNER, with a genuine
// single-role multi-scope requirement: scopes: [OWN, COND] (RBAC v1.0 §6:
// "C/V/U OWN COND" — "Optional feature only"). This is the correct
// within-role AND composition fixture for this closure pass, replacing
// the old account.profile.read_update_own-based demo (that permission's
// ROLE_BUSINESS policy is ORG-only, not OWN+ORG — it never genuinely
// required both for one role, so using it to demonstrate AND composition
// was itself an artifact of the pre-closure role-blind flattening bug).
const resourceProgressResolver: ResourceContextResolver = {
  resourceType: "resource",
  resolve: async ({ routeParams }) => {
    if (routeParams.id === "own") {
      return {
        resourceType: "resource",
        resourceId: "own",
        ownerUserId: identities.learnerUserId,
        conditionFacts: {},
      };
    }
    if (routeParams.id === "other") {
      return {
        resourceType: "resource",
        resourceId: "other",
        ownerUserId: identities.otherUserId,
        conditionFacts: {},
      };
    }
    return null;
  },
};

const CV_REVIEW_CONDITION_ID = "CV_REVIEW_WORKFLOW_DEFINED";
const LEARNING_PROGRESS_CONDITION_ID = "LEARNING_PROGRESS_FEATURE_ENABLED";

@Controller("test-scope")
class TestScopeController {
  @RequirePermission("portfolio.manage_own")
  @Get("portfolio/own/:id")
  ownRoute() {
    return { ok: true };
  }

  @RequirePermission("portfolio.public.read")
  @Get("portfolio/pub/:id")
  pubRoute() {
    return { ok: true };
  }

  @RequirePermission("consulting.request.read_own")
  @Get("consulting/org/:id")
  orgRoute() {
    return { ok: true };
  }

  @RequirePermission("submission.review_assigned")
  @Get("submission/asg/:id")
  asgRoute() {
    return { ok: true };
  }

  // cv_review.use_own: ROLE_LEARNER's policy is [OWN] only (RBAC v1.0 §6:
  // "C/V/U OWN"); ROLE_ADMIN's policy is [COND] only (§6: "COND" — the
  // undefined review workflow). Same route, same permission key, two
  // completely different per-role requirements — proves scopes are never
  // merged across roles (Wave 0D-3 Closure Pass Phase 12 test #6).
  @RequirePermission("cv_review.use_own")
  @Get("cvreview/policy/:id")
  cvReviewRoute() {
    return { ok: true };
  }

  // resource.progress.manage_own: ROLE_LEARNER-only, [OWN, COND] — a
  // genuine single-role AND composition (see resolver comment above).
  @RequirePermission("resource.progress.manage_own")
  @Get("resource-progress/own-cond/:id")
  resourceProgressRoute() {
    return { ok: true };
  }

  // No resolver is registered for the "career" resourceType anywhere in
  // this test module — proves "no resolver registered" fails closed even
  // for a role that legitimately holds the permission.
  @RequirePermission("career.submit_own")
  @Get("career/no-resolver/:id")
  noResolverRoute() {
    return { ok: true };
  }

  // Demonstrates @AuthorizeOperation supplying operation-level metadata
  // (API-PORT-002: permissionKey "portfolio.manage_own", scope ["OWN"]).
  @AuthorizeOperation("API-PORT-002")
  @RequirePermission("portfolio.manage_own")
  @Get("operation-level/:id")
  operationLevelRoute() {
    return { ok: true };
  }

  // Wave 0D-4 Part A: API-REV-001's role-ALTERNATIVE policy override.
  // API Contract v1.1: "Role-scoped review queue: Mentor ASG only; Admin
  // permitted oversight." — Mentor needs ASG, Admin does not, even though
  // both are listed on the same operation with permission key
  // submission.review_assigned.
  @AuthorizeOperation("API-REV-001")
  @RequirePermission("submission.review_assigned")
  @Get("operation-role-alternation/:id")
  operationRoleAlternationRoute() {
    return { ok: true };
  }

  // CALLER_DOMAIN_PERMISSION safety: these must never become reachable.
  @AuthorizeOperation("API-FILE-001")
  @Get("file-upload")
  fileUploadRoute() {
    return { ok: true };
  }

  @AuthorizeOperation("API-FILE-002")
  @Get("file-download/:id")
  fileDownloadRoute() {
    return { ok: true };
  }
}

@Module({ controllers: [TestScopeController] })
class TestScopeModule {}

const TEST_EMAIL_DOMAIN = "wave0d3-e2e.test";
let emailCounter = 0;
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${emailCounter++}@${TEST_EMAIL_DOMAIN}`;

describe("Wave 0D-3 resource scope authorization", () => {
  let app: INestApplication;
  let db: DatabaseConnection["db"];
  const emailPort: TransactionalEmailPort = {
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const testConditions = new ConditionRegistry([
      {
        id: CV_REVIEW_CONDITION_ID,
        description: "test-only override to prove the COND framework end-to-end",
        status: "IMPLEMENTED",
        evaluate: () => true,
      },
      {
        id: LEARNING_PROGRESS_CONDITION_ID,
        description: "test-only override to prove within-role AND composition end-to-end",
        status: "IMPLEMENTED",
        evaluate: () => true,
      },
    ]);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, TestScopeModule],
    })
      .overrideProvider(EMAIL_PORT)
      .useValue(emailPort)
      .overrideProvider(RESOURCE_CONTEXT_RESOLVERS)
      .useValue([
        portfolioResolver,
        consultingResolver,
        submissionResolver,
        cvReviewResolver,
        resourceProgressResolver,
      ])
      .overrideProvider(ConditionRegistry)
      .useValue(testConditions)
      .compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.init();
    db = app.get<DatabaseConnection>(DATABASE_CONNECTION).db;

    const learner = await registerAndLoginLearner("own");
    identities.learnerUserId = learner.userId;
    const other = await registerAndLoginLearner("other");
    identities.otherUserId = other.userId;
    const business = await registerAndLoginBusiness("biz");
    identities.businessEmployerId = business.employerId;
    const otherBusiness = await registerAndLoginBusiness("other-biz");
    identities.otherEmployerId = otherBusiness.employerId;
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

  describe("OWN", () => {
    it("allows the owning learner and denies a different learner for the same resource as a generic 404 (portfolio.manage_own is CONCEAL_EXISTENCE, Wave 0D-5)", async () => {
      const owner = await registerAndLoginLearner("own-real");
      identities.learnerUserId = owner.userId;
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/portfolio/own/own")
        .set("Cookie", owner.sessionCookie)
        .expect(200);

      const stranger = await registerAndLoginLearner("stranger");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/portfolio/own/own")
        .set("Cookie", stranger.sessionCookie)
        .expect(404);
    });

    it("denies when the resource is owned by someone else — as 404, never confirming another learner's private portfolio exists", async () => {
      const { sessionCookie } = await registerAndLoginLearner("own-other");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/portfolio/own/other")
        .set("Cookie", sessionCookie)
        .expect(404);
    });

    it("denies when the resolver returns null (missing resource) — unconditional 404 regardless of disclosure policy", async () => {
      const { sessionCookie } = await registerAndLoginLearner("own-missing");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/portfolio/own/missing")
        .set("Cookie", sessionCookie)
        .expect(404);
    });

    it("denies when the resolver throws (malformed/failed resolution) — fails closed via disclosure policy (CONCEAL_EXISTENCE -> 404), never masquerading as a confirmed-allow", async () => {
      const { sessionCookie } = await registerAndLoginLearner("own-throws");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/portfolio/own/throws")
        .set("Cookie", sessionCookie)
        .expect(404);
    });

    it("Admin does not get an OWN bypass — must still match the authoritative owner", async () => {
      const admin = await registerAndLoginLearner("own-admin");
      await setRole(admin.userId, "ROLE_ADMIN");
      // portfolio.manage_own is not even granted to ROLE_ADMIN in the
      // registry, so this denies at the role-check stage already.
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/portfolio/own/other")
        .set("Cookie", admin.sessionCookie)
        .expect(403);
    });
  });

  describe("PUB", () => {
    it("allows an authoritatively public resource", async () => {
      const { sessionCookie } = await registerAndLoginLearner("pub-allow");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/portfolio/pub/public")
        .set("Cookie", sessionCookie)
        .expect(200);
    });

    it("denies a draft/private resource even though the permission role-matches", async () => {
      const { sessionCookie } = await registerAndLoginLearner("pub-draft");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/portfolio/pub/draft")
        .set("Cookie", sessionCookie)
        .expect(403);
    });

    it("a spoofed public=true query string cannot substitute for authoritative publication state", async () => {
      const { sessionCookie } = await registerAndLoginLearner("pub-spoof");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/portfolio/pub/draft?public=true&isPublic=true")
        .set("Cookie", sessionCookie)
        .expect(403);
    });
  });

  describe("ORG", () => {
    it("allows when actor and resource share the same employer", async () => {
      const business = await registerAndLoginBusiness("org-allow");
      identities.businessEmployerId = business.employerId;
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/consulting/org/same-org")
        .set("Cookie", business.sessionCookie)
        .expect(200);
    });

    it("denies when the resource belongs to a different employer — as 404, never confirming another employer's private consulting request exists (tenant isolation, Wave 0D-5)", async () => {
      const business = await registerAndLoginBusiness("org-deny");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/consulting/org/other-org")
        .set("Cookie", business.sessionCookie)
        .expect(404);
    });

    it("honors ROLE_ADMIN's own documented management-grant policy (no ORG requirement) rather than inheriting Business's ORG requirement", async () => {
      // consulting.request.read_own grants ROLE_BUSINESS "V ORG" (RBAC v1.0
      // §6) and ROLE_ADMIN "V/M" — a plain role-level management grant with
      // NO scope suffix. Wave 0D-3's original flat model incorrectly forced
      // Admin through the same ORG check as Business; the Wave 0D-3 Closure
      // Pass fixes this via role-specific policy — Admin is correctly
      // allowed here without ever needing an employerId, because its own
      // documented policy (ROLE_POLICIES["consulting.request.read_own"].ROLE_ADMIN
      // = { scopes: [] }) never required ORG in the first place. This is
      // NOT a bypass: it's the documented Admin alternative path (Phase 8).
      const admin = await registerAndLoginLearner("org-admin-policy");
      await setRole(admin.userId, "ROLE_ADMIN");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/consulting/org/same-org")
        .set("Cookie", admin.sessionCookie)
        .expect(200);
    });

    it("still fails closed for an ORG-scoped role whose employerId is missing (data-integrity edge case)", async () => {
      // A genuine ORG-requiring role (Business) with a corrupted/missing
      // employerId must still deny — this proves ORG's "actor has no
      // employerId -> deny" rule independently of the Admin-policy fix
      // above, using a role whose real policy DOES require ORG.
      const business = await registerAndLoginBusiness("org-broken-employer");
      await queryRows(sql`update users set employer_id = null where id = ${business.userId}`);
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/consulting/org/same-org")
        .set("Cookie", business.sessionCookie)
        .expect(404);
    });

    it("a spoofed employerId in the query string cannot establish ORG access — still 404, never confirming the other employer's resource exists", async () => {
      const business = await registerAndLoginBusiness("org-spoof");
      await request(app.getHttpServer())
        .get(
          `/api/v1/test-scope/consulting/org/other-org?employerId=${identities.businessEmployerId}`,
        )
        .set("Cookie", business.sessionCookie)
        .expect(404);
    });
  });

  describe("ASG", () => {
    it("allows the assigned mentor", async () => {
      const mentor = await registerAndLoginLearner("asg-allow");
      await setRole(mentor.userId, "ROLE_MENTOR");
      identities.mentorUserId = mentor.userId;
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/submission/asg/assigned")
        .set("Cookie", mentor.sessionCookie)
        .expect(200);
    });

    it("denies an unassigned mentor — as 404, never confirming another mentor's assigned submission exists (assignment-only concealment, Wave 0D-5)", async () => {
      const mentor = await registerAndLoginLearner("asg-deny");
      await setRole(mentor.userId, "ROLE_MENTOR");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/submission/asg/unassigned")
        .set("Cookie", mentor.sessionCookie)
        .expect(404);
    });

    it("denies when the assignment has been removed (empty assignedUserIds)", async () => {
      const mentor = await registerAndLoginLearner("asg-removed");
      await setRole(mentor.userId, "ROLE_MENTOR");
      identities.mentorUserId = mentor.userId;
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/submission/asg/removed")
        .set("Cookie", mentor.sessionCookie)
        .expect(404);
    });

    it("a spoofed reviewerId/assigned=true body field cannot establish assignment — still 404", async () => {
      const mentor = await registerAndLoginLearner("asg-spoof");
      await setRole(mentor.userId, "ROLE_MENTOR");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/submission/asg/unassigned?assigned=true&reviewerId=self")
        .set("Cookie", mentor.sessionCookie)
        .expect(404);
    });
  });

  describe("COND — role-specific applicability (cv_review.use_own)", () => {
    it("Learner: allowed via OWN alone (Learner's policy has no COND at all)", async () => {
      const learner = await registerAndLoginLearner("cond-learner-own");
      identities.learnerUserId = learner.userId;
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/cvreview/policy/own")
        .set("Cookie", learner.sessionCookie)
        .expect(200);
    });

    it("Learner: denied when OWN fails — COND is irrelevant to this role's policy", async () => {
      const stranger = await registerAndLoginLearner("cond-learner-stranger");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/cvreview/policy/own")
        .set("Cookie", stranger.sessionCookie)
        .expect(403);
    });

    it("Admin: allowed via COND alone (test-only IMPLEMENTED), with no OWN requirement at all", async () => {
      // Admin's ROLE_POLICIES entry for cv_review.use_own is { scopes:
      // ["COND"] } only — no OWN. It must be able to pass regardless of
      // who owns the resource (here, a resource id the resolver doesn't
      // even recognize — proving OWN is never evaluated for this role).
      const admin = await registerAndLoginLearner("cond-admin-allow");
      await setRole(admin.userId, "ROLE_ADMIN");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/cvreview/policy/not-owned-by-anyone")
        .set("Cookie", admin.sessionCookie)
        .expect(200);
    });

    it("Admin's COND requirement is never satisfied by Learner's unrelated OWN pass, and vice versa (roles never merged)", async () => {
      // A Learner who legitimately owns "own" is still evaluated only
      // against the Learner policy (OWN) — this is implicitly proven by
      // the first test above returning 200 without a condition override
      // for a non-Admin caller; this test makes the cross-role isolation
      // explicit by confirming a Learner cannot "borrow" COND to access a
      // resource it doesn't own, even though COND is test-configured true.
      const stranger = await registerAndLoginLearner("cond-no-merge");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/cvreview/policy/own")
        .set("Cookie", stranger.sessionCookie)
        .expect(403);
    });
  });

  describe("composition — OWN + COND within a single role (resource.progress.manage_own, ROLE_LEARNER only)", () => {
    it("allows when both OWN and COND pass", async () => {
      const learner = await registerAndLoginLearner("comp-allow");
      identities.learnerUserId = learner.userId;
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/resource-progress/own-cond/own")
        .set("Cookie", learner.sessionCookie)
        .expect(200);
    });

    it("denies when OWN fails even though COND would pass (AND composition, not OR) — as 404, resource.progress.manage_own is CONCEAL_EXISTENCE", async () => {
      const stranger = await registerAndLoginLearner("comp-own-fails");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/resource-progress/own-cond/other")
        .set("Cookie", stranger.sessionCookie)
        .expect(404);
    });
  });

  describe("resolver failures", () => {
    it("denies when no resolver is registered for the resource's domain — via disclosure policy (career.submit_own is CONCEAL_EXISTENCE), never masquerading as a confirmed allow", async () => {
      const business = await registerAndLoginBusiness("no-resolver");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/career/no-resolver/anything")
        .set("Cookie", business.sessionCookie)
        .expect(404);
    });
  });

  describe("wrong role is denied before any scope check could help", () => {
    it("denies a Learner calling a Business/Admin-only permission, regardless of resolver truth", async () => {
      const learner = await registerAndLoginLearner("wrong-role");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/consulting/org/same-org")
        .set("Cookie", learner.sessionCookie)
        .expect(403);
    });
  });

  describe("@AuthorizeOperation operation-level metadata", () => {
    it("resolves operation-level scope and behaves identically to the registry-level fallback", async () => {
      const owner = await registerAndLoginLearner("op-level-allow");
      identities.learnerUserId = owner.userId;
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/operation-level/own")
        .set("Cookie", owner.sessionCookie)
        .expect(200);

      const stranger = await registerAndLoginLearner("op-level-deny");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/operation-level/own")
        .set("Cookie", stranger.sessionCookie)
        .expect(403);
    });
  });

  describe("Wave 0D-4 Part A — operation-level role alternation (API-REV-001)", () => {
    it("Mentor is denied without assignment (ASG required for Mentor) — as 404, submission.review_assigned is CONCEAL_EXISTENCE", async () => {
      const mentor = await registerAndLoginLearner("op-alt-mentor-deny");
      await setRole(mentor.userId, "ROLE_MENTOR");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/operation-role-alternation/unassigned")
        .set("Cookie", mentor.sessionCookie)
        .expect(404);
    });

    it("Mentor is allowed once assigned", async () => {
      const mentor = await registerAndLoginLearner("op-alt-mentor-allow");
      await setRole(mentor.userId, "ROLE_MENTOR");
      identities.mentorUserId = mentor.userId;
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/operation-role-alternation/assigned")
        .set("Cookie", mentor.sessionCookie)
        .expect(200);
    });

    it("Admin is allowed without any assignment — Admin's documented operation policy never requires ASG here", async () => {
      const admin = await registerAndLoginLearner("op-alt-admin-allow");
      await setRole(admin.userId, "ROLE_ADMIN");
      // "unassigned" resource — would deny a Mentor, but Admin's own
      // OPERATION_ROLE_POLICIES entry for API-REV-001 has scopes: [],
      // so this must be a role-only allow, never inheriting Mentor's ASG.
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/operation-role-alternation/unassigned")
        .set("Cookie", admin.sessionCookie)
        .expect(200);
    });

    it("Admin's role-only allow is never granted to Mentor (roles never merged in either direction) — as 404", async () => {
      const mentor = await registerAndLoginLearner("op-alt-no-merge");
      await setRole(mentor.userId, "ROLE_MENTOR");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/operation-role-alternation/unassigned")
        .set("Cookie", mentor.sessionCookie)
        .expect(404);
    });
  });

  describe("CALLER_DOMAIN_PERMISSION file safety (API-FILE-001/002)", () => {
    it("never allows API-FILE-001 to become session-only reachable, for any role", async () => {
      const learner = await registerAndLoginLearner("file-001-learner");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/file-upload")
        .set("Cookie", learner.sessionCookie)
        .expect(403);

      const admin = await registerAndLoginLearner("file-001-admin");
      await setRole(admin.userId, "ROLE_ADMIN");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/file-upload")
        .set("Cookie", admin.sessionCookie)
        .expect(403);
    });

    it("never allows API-FILE-002 to become generic public file access", async () => {
      const learner = await registerAndLoginLearner("file-002-learner");
      await request(app.getHttpServer())
        .get("/api/v1/test-scope/file-download/anything")
        .set("Cookie", learner.sessionCookie)
        .expect(403);

      await request(app.getHttpServer())
        .get("/api/v1/test-scope/file-download/anything")
        .expect(401);
    });
  });
});
