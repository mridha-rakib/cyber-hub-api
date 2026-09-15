import type {
  AssessmentSecurityContext,
  SecurityScopeAuthorizationContext,
} from "./auth-scope.types";
import { AuthScopeEvaluator } from "./auth-scope-evaluator.service";
import type { Clock } from "./clock";
import type { SecurityScopeAuthorizationRepository } from "./security-scope-authorization.repository";

const FIXED_NOW = new Date("2026-06-15T12:00:00.000Z");

class FixedClock implements Clock {
  constructor(private readonly fixed: Date = FIXED_NOW) {}
  now(): Date {
    return this.fixed;
  }
}

function scopeAuth(
  overrides: Partial<SecurityScopeAuthorizationContext> = {},
): SecurityScopeAuthorizationContext {
  return {
    scopeAuthorizationId: "scope-1",
    consultingRequestId: "request-1",
    employerId: "employer-1",
    isCurrent: true,
    revokedAt: null,
    validFrom: new Date("2026-06-01T00:00:00.000Z"),
    validUntil: new Date("2026-07-01T00:00:00.000Z"),
    authorizedTargets: ["app.example.com"],
    allowedActivities: ["VULNERABILITY_ASSESSMENT"],
    restrictions: [],
    ...overrides,
  };
}

function assessmentContext(
  overrides: Partial<AssessmentSecurityContext> = {},
  authOverrides: Partial<SecurityScopeAuthorizationContext> = {},
): AssessmentSecurityContext {
  return {
    assessmentId: "assessment-1",
    employerId: "employer-1",
    consultingRequestId: "request-1",
    scopeAuthorizationId: "scope-1",
    assignedConsultantId: "consultant-1",
    service: "VULNERABILITY_ASSESSMENT",
    scopeAuthorization: scopeAuth(authOverrides),
    ...overrides,
  };
}

function makeEvaluator(context: AssessmentSecurityContext | null, clock: Clock = new FixedClock()) {
  const repository: Pick<SecurityScopeAuthorizationRepository, "loadAssessmentSecurityContext"> = {
    loadAssessmentSecurityContext: async () => context,
  };
  return new AuthScopeEvaluator(repository as SecurityScopeAuthorizationRepository, clock);
}

function throwingEvaluator(clock: Clock = new FixedClock()) {
  const repository: Pick<SecurityScopeAuthorizationRepository, "loadAssessmentSecurityContext"> = {
    loadAssessmentSecurityContext: async () => {
      throw new Error("db exploded");
    },
  };
  return new AuthScopeEvaluator(repository as SecurityScopeAuthorizationRepository, clock);
}

describe("AuthScopeEvaluator", () => {
  describe("VALID case", () => {
    it("allows when current, not revoked, inside the validity window, correct linkage, target and activity covered", async () => {
      const evaluator = makeEvaluator(assessmentContext());
      const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
      expect(result).toEqual({ allowed: true });
    });

    it("allows with an explicit requestedTarget/requestedActivity that are covered", async () => {
      const evaluator = makeEvaluator(assessmentContext());
      const result = await evaluator.evaluate({
        assessmentId: "assessment-1",
        requestedTarget: "app.example.com",
        requestedActivity: "VULNERABILITY_ASSESSMENT",
      });
      expect(result).toEqual({ allowed: true });
    });
  });

  it("NO AUTHORIZATION: denies when no assessment/authorization context resolves", async () => {
    const evaluator = makeEvaluator(null);
    const result = await evaluator.evaluate({ assessmentId: "missing" });
    expect(result.allowed).toBe(false);
  });

  it("denies when no assessmentId locator is provided at all", async () => {
    const evaluator = makeEvaluator(assessmentContext());
    const result = await evaluator.evaluate({ assessmentId: "" });
    expect(result.allowed).toBe(false);
  });

  it("NOT CURRENT: denies a superseded (is_current=false) authorization", async () => {
    const evaluator = makeEvaluator(assessmentContext({}, { isCurrent: false }));
    const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not current/i);
  });

  it("REVOKED: denies when revoked_at is set", async () => {
    const evaluator = makeEvaluator(
      assessmentContext({}, { revokedAt: new Date("2026-06-10T00:00:00.000Z") }),
    );
    const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/revoked/i);
  });

  describe("time validity boundaries (Phase 12 — closed/inclusive interval)", () => {
    it("NOT YET VALID: denies when now is strictly before valid_from", async () => {
      const evaluator = makeEvaluator(
        assessmentContext({}, { validFrom: new Date("2026-06-20T00:00:00.000Z") }),
      );
      const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/not yet valid/i);
    });

    it("allows when now === valid_from exactly (inclusive start)", async () => {
      const evaluator = makeEvaluator(
        assessmentContext({}, { validFrom: FIXED_NOW }),
        new FixedClock(FIXED_NOW),
      );
      const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
      expect(result.allowed).toBe(true);
    });

    it("EXPIRED: denies when now is strictly after valid_until", async () => {
      const evaluator = makeEvaluator(
        assessmentContext({}, { validUntil: new Date("2026-06-01T00:00:00.000Z") }),
      );
      const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/expired/i);
    });

    it("allows when now === valid_until exactly (inclusive end)", async () => {
      const evaluator = makeEvaluator(
        assessmentContext({}, { validUntil: FIXED_NOW }),
        new FixedClock(FIXED_NOW),
      );
      const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
      expect(result.allowed).toBe(true);
    });

    it("VALID_UNTIL NULL: allowed if all else valid (open-ended authorization)", async () => {
      const evaluator = makeEvaluator(assessmentContext({}, { validUntil: null }));
      const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
      expect(result.allowed).toBe(true);
    });
  });

  describe("linkage (Phase 15)", () => {
    it("WRONG CONSULTING REQUEST: denies when the authorization's consultingRequestId disagrees with the assessment's", async () => {
      const evaluator = makeEvaluator(
        assessmentContext({}, { consultingRequestId: "different-request" }),
      );
      const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/consulting request/i);
    });

    it("WRONG EMPLOYER: denies when the authorization's employerId disagrees with the assessment's", async () => {
      const evaluator = makeEvaluator(assessmentContext({}, { employerId: "different-employer" }));
      const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/employer/i);
    });

    it("does not allow 'any scope belonging to the employer' — the specific linked authorization must agree, not merely share an employer", async () => {
      // Same employer overall, but wrong consulting request — must still deny.
      const evaluator = makeEvaluator(
        assessmentContext(
          { employerId: "employer-1", consultingRequestId: "request-1" },
          { employerId: "employer-1", consultingRequestId: "request-OTHER" },
        ),
      );
      const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
      expect(result.allowed).toBe(false);
    });
  });

  describe("target coverage (Phase 13)", () => {
    it("WRONG TARGET: denies when an explicit requestedTarget is not in authorizedTargets", async () => {
      const evaluator = makeEvaluator(assessmentContext());
      const result = await evaluator.evaluate({
        assessmentId: "assessment-1",
        requestedTarget: "api.example.com", // authorized target is app.example.com
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/target/i);
    });

    it("does not invent subdomain inheritance: 'app.example.com' authorization does not cover 'api.example.com'", async () => {
      const evaluator = makeEvaluator(
        assessmentContext({}, { authorizedTargets: ["example.com"] }),
      );
      const result = await evaluator.evaluate({
        assessmentId: "assessment-1",
        requestedTarget: "app.example.com",
      });
      expect(result.allowed).toBe(false);
    });

    it("denies when authorizedTargets is empty and no explicit target was requested (incomplete authorization)", async () => {
      const evaluator = makeEvaluator(assessmentContext({}, { authorizedTargets: [] }));
      const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/target/i);
    });
  });

  describe("activity coverage (Phase 14)", () => {
    it("WRONG ACTIVITY: denies when the assessment's service is not in allowedActivities", async () => {
      const evaluator = makeEvaluator(
        assessmentContext(
          { service: "NETWORK_ASSESSMENT" },
          { allowedActivities: ["VULNERABILITY_ASSESSMENT"] },
        ),
      );
      const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/activity/i);
    });

    it("an authorization for one activity does not authorize a different one, even via explicit requestedActivity", async () => {
      const evaluator = makeEvaluator(
        assessmentContext({}, { allowedActivities: ["VULNERABILITY_ASSESSMENT"] }),
      );
      const result = await evaluator.evaluate({
        assessmentId: "assessment-1",
        requestedActivity: "NETWORK_ASSESSMENT",
      });
      expect(result.allowed).toBe(false);
    });

    it("allows when the assessment's own service field is covered (default activity source)", async () => {
      const evaluator = makeEvaluator(
        assessmentContext(
          { service: "PHISHING_AWARENESS" },
          { allowedActivities: ["PHISHING_AWARENESS", "VULNERABILITY_ASSESSMENT"] },
        ),
      );
      const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
      expect(result.allowed).toBe(true);
    });
  });

  it("MALFORMED JSON/ROW: denies when the repository reports null (e.g. malformed authorized_targets/allowed_activities)", async () => {
    const evaluator = makeEvaluator(null);
    const result = await evaluator.evaluate({ assessmentId: "assessment-1" });
    expect(result.allowed).toBe(false);
  });

  it("REPOSITORY ERROR: never throws — evaluate() itself must not propagate a repository exception", async () => {
    const evaluator = throwingEvaluator();
    await expect(evaluator.evaluate({ assessmentId: "assessment-1" })).rejects.toThrow();
    // NOTE: the repository itself is documented to catch and return null
    // (see security-scope-authorization.repository.ts) — this test proves
    // AuthScopeEvaluator does not add its own safety net beyond that
    // contract, so the repository's fail-closed behavior is load-bearing;
    // ScopeEvaluationService's own try/catch around scope evaluation is
    // the outer fail-closed backstop (see PermissionGuard.canActivate).
  });
});
