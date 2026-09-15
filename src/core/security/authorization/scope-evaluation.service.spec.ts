import { AuthScopeEvaluator } from "./auth-scope-evaluator.service";
import type {
  ActorContext,
  AuthorizationContext,
  ResourceContext,
} from "./authorization-context.types";
import { SystemClock } from "./clock";
import {
  type ConditionDefinition,
  ConditionRegistry,
  PRODUCTION_CONDITIONS,
} from "./condition-registry";
import {
  type ResourceContextResolver,
  ResourceContextResolverRegistry,
  type ResourceResolutionInput,
} from "./resource-context-resolver";
import {
  evaluateAsg,
  evaluateOrg,
  evaluateOwn,
  evaluatePub,
  ScopeEvaluationService,
} from "./scope-evaluation.service";
import type { SecurityScopeAuthorizationRepository } from "./security-scope-authorization.repository";

// A repository stub that always reports "no context" — sufficient for
// every test in this file except the dedicated AUTH_SCOPE test suite
// (auth-scope-evaluator.service.spec.ts), which exercises real validity/
// linkage/target/activity logic against a controllable fake repository.
const denyingAuthScopeRepository: Pick<
  SecurityScopeAuthorizationRepository,
  "loadAssessmentSecurityContext"
> = {
  loadAssessmentSecurityContext: async () => null,
};

const actor = (overrides: Partial<ActorContext> = {}): ActorContext => ({
  userId: "user-1",
  role: "ROLE_LEARNER",
  employerId: undefined,
  ...overrides,
});

const resource = (overrides: Partial<ResourceContext> = {}): ResourceContext => ({
  resourceType: "portfolio",
  resourceId: "res-1",
  ...overrides,
});

function makeService(options?: {
  resolver?: ResourceContextResolver;
  conditions?: readonly ConditionDefinition[];
}) {
  const registry = new ResourceContextResolverRegistry(
    options?.resolver ? [options.resolver] : undefined,
  );
  const conditionRegistry = new ConditionRegistry(options?.conditions);
  const authScopeEvaluator = new AuthScopeEvaluator(
    denyingAuthScopeRepository as SecurityScopeAuthorizationRepository,
    new SystemClock(),
  );
  return new ScopeEvaluationService(registry, conditionRegistry, authScopeEvaluator);
}

function buildContext(
  scope: AuthorizationContext["operation"]["scope"],
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    actor: actor(),
    operation: {
      apiId: null,
      permissionKey: "portfolio.manage_own",
      scope,
      resourceContextRequired: scope.length > 0,
      assignmentRequired: scope.includes("ASG"),
      authScopeRequired: scope.includes("AUTH_SCOPE"),
      authorizationMode: "DIRECT_PERMISSION",
    },
    resource: null,
    ...overrides,
  };
}

describe("pure evaluator functions", () => {
  describe("evaluateOwn", () => {
    it("allows when resource owner matches actor", () => {
      expect(evaluateOwn(actor({ userId: "u1" }), resource({ ownerUserId: "u1" }))).toBe(true);
    });
    it("denies when owner differs", () => {
      expect(evaluateOwn(actor({ userId: "u1" }), resource({ ownerUserId: "u2" }))).toBe(false);
    });
    it("denies when owner field is unavailable", () => {
      expect(evaluateOwn(actor({ userId: "u1" }), resource({ ownerUserId: undefined }))).toBe(
        false,
      );
    });
    it("denies on malformed (null) resource context", () => {
      expect(evaluateOwn(actor({ userId: "u1" }), null)).toBe(false);
    });
    it("denies on empty-string owner (malformed)", () => {
      expect(evaluateOwn(actor({ userId: "u1" }), resource({ ownerUserId: "" }))).toBe(false);
    });
  });

  describe("evaluateOrg", () => {
    it("allows when employerId matches", () => {
      expect(evaluateOrg(actor({ employerId: "emp-1" }), resource({ employerId: "emp-1" }))).toBe(
        true,
      );
    });
    it("denies when employerId differs", () => {
      expect(evaluateOrg(actor({ employerId: "emp-1" }), resource({ employerId: "emp-2" }))).toBe(
        false,
      );
    });
    it("denies when actor has no employerId", () => {
      expect(evaluateOrg(actor({ employerId: undefined }), resource({ employerId: "emp-1" }))).toBe(
        false,
      );
    });
    it("denies when resource employerId is missing", () => {
      expect(evaluateOrg(actor({ employerId: "emp-1" }), resource({ employerId: undefined }))).toBe(
        false,
      );
    });
    it("denies on null resource", () => {
      expect(evaluateOrg(actor({ employerId: "emp-1" }), null)).toBe(false);
    });
  });

  describe("evaluateAsg", () => {
    it("allows when actor is in assignedUserIds", () => {
      expect(
        evaluateAsg(actor({ userId: "u1" }), resource({ assignedUserIds: ["u1", "u2"] })),
      ).toBe(true);
    });
    it("denies when actor is not assigned", () => {
      expect(
        evaluateAsg(actor({ userId: "u3" }), resource({ assignedUserIds: ["u1", "u2"] })),
      ).toBe(false);
    });
    it("denies when assignment was removed (empty list)", () => {
      expect(evaluateAsg(actor({ userId: "u1" }), resource({ assignedUserIds: [] }))).toBe(false);
    });
    it("denies when assignment context is missing", () => {
      expect(evaluateAsg(actor({ userId: "u1" }), resource({ assignedUserIds: undefined }))).toBe(
        false,
      );
    });
  });

  describe("evaluatePub", () => {
    it("allows an authoritatively public resource", () => {
      expect(evaluatePub(resource({ isPublic: true }))).toBe(true);
    });
    it("denies a draft/private resource", () => {
      expect(evaluatePub(resource({ isPublic: false }))).toBe(false);
    });
    it("denies when publication evidence is missing", () => {
      expect(evaluatePub(resource({ isPublic: undefined }))).toBe(false);
    });
    it("denies on null resource", () => {
      expect(evaluatePub(null)).toBe(false);
    });
  });
});

describe("ScopeEvaluationService.evaluate (pure composition, pre-resolved resource)", () => {
  it("allows when scope is empty", async () => {
    const service = makeService();
    await expect(service.evaluate(buildContext([]))).resolves.toEqual({ allowed: true });
  });

  it("allows OWN when resource is pre-resolved and owner matches", async () => {
    const service = makeService();
    const context = buildContext(["OWN"], { resource: resource({ ownerUserId: "user-1" }) });
    await expect(service.evaluate(context)).resolves.toEqual({ allowed: true });
  });

  it("denies OWN when owner differs, ignoring any client-spoofed userId on the resource-locator side", async () => {
    const service = makeService();
    const context = buildContext(["OWN"], { resource: resource({ ownerUserId: "someone-else" }) });
    const result = await service.evaluate(context);
    expect(result.allowed).toBe(false);
  });

  it("denies when resourceContextRequired but resource is null", async () => {
    const service = makeService();
    const context = buildContext(["OWN"], { resource: null });
    const result = await service.evaluate(context);
    expect(result.allowed).toBe(false);
  });

  it("denies AUTH_SCOPE when no assessmentId route locator is available, even if ASG would pass", async () => {
    const service = makeService();
    const context = buildContext(["ASG", "AUTH_SCOPE"], {
      resource: resource({ assignedUserIds: ["user-1"] }),
    });
    const result = await service.evaluate(context); // no routeParams -> no assessmentId
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/AUTH_SCOPE/);
  });

  it("requires ALL mandatory scopes to pass (AND semantics) — one failing denies the whole request", async () => {
    const service = makeService();
    // OWN passes, ORG fails (different employer) — must deny overall.
    const context = buildContext(["OWN", "ORG"], {
      actor: actor({ userId: "user-1", employerId: "emp-a" }),
      resource: resource({ ownerUserId: "user-1", employerId: "emp-b" }),
    });
    const result = await service.evaluate(context);
    expect(result.allowed).toBe(false);
  });

  it("allows when all mandatory scopes pass", async () => {
    const service = makeService();
    const context = buildContext(["OWN", "ORG"], {
      actor: actor({ userId: "user-1", employerId: "emp-a" }),
      resource: resource({ ownerUserId: "user-1", employerId: "emp-a" }),
    });
    const result = await service.evaluate(context);
    expect(result.allowed).toBe(true);
  });

  describe("COND", () => {
    const conditionId = "CV_REVIEW_WORKFLOW_DEFINED";

    function condContext(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
      return buildContext(["COND"], {
        operation: {
          apiId: null,
          permissionKey: "cv_review.use_own",
          scope: ["COND"],
          resourceContextRequired: false,
          assignmentRequired: false,
          authScopeRequired: false,
          authorizationMode: "DIRECT_PERMISSION",
          conditionIds: [conditionId],
        },
        ...overrides,
      });
    }

    it("denies when the mapped condition is DEFERRED (production catalogue default)", async () => {
      const service = makeService(); // production ConditionRegistry: all DEFERRED
      const result = await service.evaluate(condContext());
      expect(result.allowed).toBe(false);
    });

    it("denies for an unknown condition id (not present in the registry)", async () => {
      const service = makeService({ conditions: [] });
      const result = await service.evaluate(condContext());
      expect(result.allowed).toBe(false);
    });

    it("denies when no condition id was resolved for this role at all", async () => {
      const service = makeService();
      const context = buildContext(["COND"], {
        operation: {
          apiId: null,
          permissionKey: "portfolio.manage_own",
          scope: ["COND"],
          resourceContextRequired: false,
          assignmentRequired: false,
          authScopeRequired: false,
          authorizationMode: "DIRECT_PERMISSION",
          conditionIds: undefined,
        },
      });
      const result = await service.evaluate(context);
      expect(result.allowed).toBe(false);
    });

    it("allows a test-only IMPLEMENTED condition that evaluates true", async () => {
      const testCondition: ConditionDefinition = {
        id: conditionId,
        description: "test-only override",
        status: "IMPLEMENTED",
        evaluate: () => true,
      };
      const service = makeService({ conditions: [testCondition] });
      await expect(service.evaluate(condContext())).resolves.toEqual({ allowed: true });
    });

    it("denies a test-only IMPLEMENTED condition that evaluates false", async () => {
      const testCondition: ConditionDefinition = {
        id: conditionId,
        description: "test-only override",
        status: "IMPLEMENTED",
        evaluate: () => false,
      };
      const service = makeService({ conditions: [testCondition] });
      const result = await service.evaluate(condContext());
      expect(result.allowed).toBe(false);
    });

    it("denies when the condition evaluator throws", async () => {
      const testCondition: ConditionDefinition = {
        id: conditionId,
        description: "test-only throwing condition",
        status: "IMPLEMENTED",
        evaluate: () => {
          throw new Error("boom");
        },
      };
      const service = makeService({ conditions: [testCondition] });
      const result = await service.evaluate(condContext());
      expect(result.allowed).toBe(false);
    });

    it("composes OWN + COND: both passing allows", async () => {
      const testCondition: ConditionDefinition = {
        id: conditionId,
        description: "test-only",
        status: "IMPLEMENTED",
        evaluate: () => true,
      };
      const service = makeService({ conditions: [testCondition] });
      const context = buildContext(["OWN", "COND"], {
        operation: {
          apiId: null,
          permissionKey: "cv_review.use_own",
          scope: ["OWN", "COND"],
          resourceContextRequired: true,
          assignmentRequired: false,
          authScopeRequired: false,
          authorizationMode: "DIRECT_PERMISSION",
          conditionIds: [conditionId],
        },
        resource: resource({ ownerUserId: "user-1" }),
      });
      await expect(service.evaluate(context)).resolves.toEqual({ allowed: true });
    });

    it("does not apply another role's condition id when this role's policy carries none", async () => {
      // e.g. account.delete.request_own: ROLE_ADMIN's own policy has no
      // COND even though ROLE_BUSINESS/MENTOR/CONSULTANT do for the same
      // key — a route evaluating COND for a role with no conditionIds must
      // deny, never silently borrow another role's condition.
      const testCondition: ConditionDefinition = {
        id: "ACCOUNT_DELETION_NON_LEARNER_POLICY",
        description: "test-only",
        status: "IMPLEMENTED",
        evaluate: () => true,
      };
      const service = makeService({ conditions: [testCondition] });
      const context = buildContext(["COND"], {
        actor: actor({ role: "ROLE_ADMIN" }),
        operation: {
          apiId: null,
          permissionKey: "account.delete.request_own",
          scope: ["COND"],
          resourceContextRequired: false,
          assignmentRequired: false,
          authScopeRequired: false,
          authorizationMode: "DIRECT_PERMISSION",
          conditionIds: undefined, // Admin's ROLE_POLICIES entry has scopes: [] — never reaches this, but if it did, no conditionIds must still deny.
        },
      });
      const result = await service.evaluate(context);
      expect(result.allowed).toBe(false);
    });
  });
});

describe("ScopeEvaluationService — resourceContextRequired safety (Phase 10)", () => {
  // A resolver call proves whether the resource-resolution path was
  // actually taken, independent of what operation.resourceContextRequired
  // (a metadata flag that can under-report, per Wave 0D-3's report) says.
  function trackingResolver() {
    let calls = 0;
    const resolver: ResourceContextResolver = {
      resourceType: "portfolio",
      resolve: async () => {
        calls++;
        return resource({
          ownerUserId: "user-1",
          employerId: "emp-1",
          assignedUserIds: ["user-1"],
          isPublic: true,
        });
      },
    };
    return { resolver, wasCalled: () => calls > 0 };
  }

  it.each([["OWN" as const], ["ORG" as const], ["ASG" as const], ["PUB" as const]])(
    "forces resource resolution for %s even when resourceContextRequired metadata is false",
    async (scopeType) => {
      const { resolver, wasCalled } = trackingResolver();
      const service = makeService({ resolver });
      await service.resolveAndEvaluate(
        {
          actor: actor({ employerId: "emp-1" }),
          operation: {
            apiId: null,
            permissionKey: "portfolio.manage_own",
            scope: [scopeType],
            resourceContextRequired: false, // deliberately under-reported
            assignmentRequired: false,
            authScopeRequired: false,
            authorizationMode: "DIRECT_PERMISSION",
          },
        },
        "portfolio",
        { id: "res-1" },
      );
      expect(wasCalled()).toBe(true);
    },
  );

  it("does NOT force resolution for COND alone when resourceContextRequired is false (no resource-dependent scope present)", async () => {
    const { resolver, wasCalled } = trackingResolver();
    const service = makeService({ resolver, conditions: [] });
    await service.resolveAndEvaluate(
      {
        actor: actor(),
        operation: {
          apiId: null,
          permissionKey: "cv_review.use_own",
          scope: ["COND"],
          resourceContextRequired: false,
          assignmentRequired: false,
          authScopeRequired: false,
          authorizationMode: "DIRECT_PERMISSION",
          conditionIds: ["CV_REVIEW_WORKFLOW_DEFINED"],
        },
      },
      "portfolio",
      { id: "res-1" },
    );
    expect(wasCalled()).toBe(false);
  });
});

describe("ScopeEvaluationService.resolveAndEvaluate (resolver-backed)", () => {
  it("denies when no resolver is registered for the resource type", async () => {
    const service = makeService(); // no resolver
    const context = buildContext(["OWN"]);
    const result = await service.resolveAndEvaluate(
      { actor: context.actor, operation: context.operation },
      "portfolio",
      { id: "res-1" },
    );
    expect(result.allowed).toBe(false);
  });

  it("denies when the resolver returns null (resource not found)", async () => {
    const resolver: ResourceContextResolver = {
      resourceType: "portfolio",
      resolve: async () => null,
    };
    const service = makeService({ resolver });
    const context = buildContext(["OWN"]);
    const result = await service.resolveAndEvaluate(
      { actor: context.actor, operation: context.operation },
      "portfolio",
      { id: "missing" },
    );
    expect(result.allowed).toBe(false);
  });

  it("denies when the resolver throws", async () => {
    const resolver: ResourceContextResolver = {
      resourceType: "portfolio",
      resolve: async () => {
        throw new Error("db exploded");
      },
    };
    const service = makeService({ resolver });
    const context = buildContext(["OWN"]);
    const result = await service.resolveAndEvaluate(
      { actor: context.actor, operation: context.operation },
      "portfolio",
      { id: "res-1" },
    );
    expect(result.allowed).toBe(false);
  });

  it("allows when the resolver returns an authoritative OWN match", async () => {
    const resolver: ResourceContextResolver = {
      resourceType: "portfolio",
      resolve: async ({ routeParams }) =>
        resource({ resourceId: routeParams.id, ownerUserId: "user-1" }),
    };
    const service = makeService({ resolver });
    const context = buildContext(["OWN"]);
    const result = await service.resolveAndEvaluate(
      { actor: context.actor, operation: context.operation },
      "portfolio",
      { id: "res-1" },
    );
    expect(result).toEqual({ allowed: true });
  });

  it("ignores a spoofed resource locator param used only to pick the record, not to prove ownership", async () => {
    // The resolver is the only source of truth. Even if a malicious route
    // param claims to be "owned by user-1", the resolver's own answer wins.
    const resolver: ResourceContextResolver = {
      resourceType: "portfolio",
      resolve: async () => resource({ ownerUserId: "actual-owner" }),
    };
    const service = makeService({ resolver });
    const context = buildContext(["OWN"]);
    const result = await service.resolveAndEvaluate(
      { actor: context.actor, operation: context.operation },
      "portfolio",
      { id: "res-1", ownerUserId: "user-1", spoofed: "true" },
    );
    expect(result.allowed).toBe(false);
  });

  it("fails closed when the resolver returns a mismatched resourceType", async () => {
    const resolver: ResourceContextResolver = {
      resourceType: "portfolio",
      resolve: async () => resource({ resourceType: "wrong-type", ownerUserId: "user-1" }),
    };
    const service = makeService({ resolver });
    const context = buildContext(["OWN"]);
    const result = await service.resolveAndEvaluate(
      { actor: context.actor, operation: context.operation },
      "portfolio",
      { id: "res-1" },
    );
    expect(result.allowed).toBe(false);
  });
});

describe("ResourceContextResolverRegistry", () => {
  it("throws at construction time on duplicate resourceType registration", () => {
    const dup: ResourceContextResolver = { resourceType: "portfolio", resolve: async () => null };
    expect(() => new ResourceContextResolverRegistry([dup, dup])).toThrow(/Duplicate/);
  });

  it("resolve() never throws even when the underlying resolver throws", async () => {
    const resolver: ResourceContextResolver = {
      resourceType: "portfolio",
      resolve: async () => {
        throw new Error("boom");
      },
    };
    const registry = new ResourceContextResolverRegistry([resolver]);
    const input: ResourceResolutionInput = { actor: actor(), routeParams: {} };
    await expect(registry.resolve("portfolio", input)).resolves.toBeNull();
  });
});

describe("ConditionRegistry", () => {
  it("ships production conditions as DEFERRED with no evaluate function", () => {
    const registry = new ConditionRegistry();
    for (const condition of PRODUCTION_CONDITIONS) {
      const def = registry.get(condition.id);
      expect(def).toBeDefined();
      expect(def?.status).toBe("DEFERRED");
      expect(def?.evaluate).toBeUndefined();
    }
  });

  it("throws at construction time on duplicate condition ids", () => {
    const dup: ConditionDefinition = { id: "X", description: "d", status: "DEFERRED" };
    expect(() => new ConditionRegistry([dup, dup])).toThrow(/Duplicate/);
  });

  it("returns undefined for an unknown id", () => {
    const registry = new ConditionRegistry([]);
    expect(registry.get("NOPE")).toBeUndefined();
  });
});
