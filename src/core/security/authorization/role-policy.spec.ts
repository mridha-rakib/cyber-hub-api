import { PERMISSION_KEYS, PERMISSION_REGISTRY } from "./permission-registry";
import { getRolePolicy, ROLE_POLICIES } from "./role-policy";
import { ScopeTypes } from "./scope.types";

describe("ROLE_POLICIES", () => {
  it("has an entry for every one of the 60 permission keys", () => {
    for (const key of PERMISSION_KEYS) {
      expect(ROLE_POLICIES[key]).toBeDefined();
    }
    expect(Object.keys(ROLE_POLICIES).length).toBe(60);
  });

  it("only lists roles that PERMISSION_REGISTRY.allowedRoles also grants for that key", () => {
    for (const key of PERMISSION_KEYS) {
      const definition = PERMISSION_REGISTRY[key];
      const policyRoles = Object.keys(ROLE_POLICIES[key]);
      for (const role of policyRoles) {
        expect(definition.allowedRoles).toContain(role);
      }
    }
  });

  it("gives every role in PERMISSION_REGISTRY.allowedRoles a policy entry (no silent gaps)", () => {
    for (const key of PERMISSION_KEYS) {
      const definition = PERMISSION_REGISTRY[key];
      if (definition.systemOnly) continue; // audit.event.write_system: no human role, no policy needed
      for (const role of definition.allowedRoles) {
        expect(ROLE_POLICIES[key][role]).toBeDefined();
      }
    }
  });

  it("only ever uses known scope tags", () => {
    for (const policies of Object.values(ROLE_POLICIES)) {
      for (const policy of Object.values(policies)) {
        for (const scope of policy.scopes) {
          expect(ScopeTypes as readonly string[]).toContain(scope);
        }
      }
    }
  });

  describe("account.profile.read_update_own — the canonical per-role-alternative example", () => {
    it("ROLE_LEARNER requires OWN only", () => {
      expect(ROLE_POLICIES["account.profile.read_update_own"].ROLE_LEARNER).toEqual({
        scopes: ["OWN"],
      });
    });
    it("ROLE_BUSINESS requires ORG only — never merged with Learner's OWN", () => {
      expect(ROLE_POLICIES["account.profile.read_update_own"].ROLE_BUSINESS).toEqual({
        scopes: ["ORG"],
      });
    });
    it("ROLE_MENTOR requires OWN only", () => {
      expect(ROLE_POLICIES["account.profile.read_update_own"].ROLE_MENTOR).toEqual({
        scopes: ["OWN"],
      });
    });
    it("ROLE_CONSULTANT requires OWN only", () => {
      expect(ROLE_POLICIES["account.profile.read_update_own"].ROLE_CONSULTANT).toEqual({
        scopes: ["OWN"],
      });
    });
    it("ROLE_ADMIN has a plain management grant — no OWN or ORG requirement", () => {
      expect(ROLE_POLICIES["account.profile.read_update_own"].ROLE_ADMIN).toEqual({ scopes: [] });
    });
  });

  describe("account.delete.request_own — the canonical role-specific COND example", () => {
    it("ROLE_LEARNER is unconditional (OWN only, no COND)", () => {
      expect(ROLE_POLICIES["account.delete.request_own"].ROLE_LEARNER).toEqual({ scopes: ["OWN"] });
    });
    it("ROLE_BUSINESS is conditional on the deferred data-lifecycle policy", () => {
      expect(ROLE_POLICIES["account.delete.request_own"].ROLE_BUSINESS).toEqual({
        scopes: ["COND"],
        conditionIds: ["ACCOUNT_DELETION_NON_LEARNER_POLICY"],
      });
    });
    it("ROLE_MENTOR is conditional on the deferred data-lifecycle policy", () => {
      expect(ROLE_POLICIES["account.delete.request_own"].ROLE_MENTOR).toEqual({
        scopes: ["COND"],
        conditionIds: ["ACCOUNT_DELETION_NON_LEARNER_POLICY"],
      });
    });
    it("ROLE_CONSULTANT is conditional on the deferred data-lifecycle policy", () => {
      expect(ROLE_POLICIES["account.delete.request_own"].ROLE_CONSULTANT).toEqual({
        scopes: ["COND"],
        conditionIds: ["ACCOUNT_DELETION_NON_LEARNER_POLICY"],
      });
    });
    it("ROLE_ADMIN has a plain management grant — never subject to the deferred deletion condition", () => {
      expect(ROLE_POLICIES["account.delete.request_own"].ROLE_ADMIN).toEqual({ scopes: [] });
    });
  });

  describe("cv_review.use_own — role policies are opposites, never unioned", () => {
    it("ROLE_LEARNER requires OWN only (no COND)", () => {
      expect(ROLE_POLICIES["cv_review.use_own"].ROLE_LEARNER).toEqual({ scopes: ["OWN"] });
    });
    it("ROLE_ADMIN requires COND only (no OWN)", () => {
      expect(ROLE_POLICIES["cv_review.use_own"].ROLE_ADMIN).toEqual({
        scopes: ["COND"],
        conditionIds: ["CV_REVIEW_WORKFLOW_DEFINED"],
      });
    });
  });

  describe("AUTH_SCOPE cross-cutting keys — applies to Consultant AND Admin, not just Consultant", () => {
    const authScopeKeys = [
      "assessment.manage_assigned",
      "finding.manage_assigned",
      "security_score.calculate_assigned",
    ] as const;

    it.each(authScopeKeys)("%s: ROLE_CONSULTANT requires ASG + AUTH_SCOPE (AND, not OR)", (key) => {
      expect(ROLE_POLICIES[key].ROLE_CONSULTANT?.scopes).toEqual(
        expect.arrayContaining(["ASG", "AUTH_SCOPE"]),
      );
    });

    it.each(authScopeKeys)(
      "%s: ROLE_ADMIN also requires AUTH_SCOPE (no undocumented bypass), but not ASG (Admin isn't 'assigned')",
      (key) => {
        const adminPolicy = ROLE_POLICIES[key].ROLE_ADMIN;
        expect(adminPolicy?.scopes).toContain("AUTH_SCOPE");
        expect(adminPolicy?.scopes).not.toContain("ASG");
      },
    );
  });

  describe("getRolePolicy", () => {
    it("returns undefined for a role with no entry (unknown role policy => caller must deny)", () => {
      expect(getRolePolicy("portfolio.manage_own", "ROLE_ADMIN")).toBeUndefined();
    });
    it("returns the exact policy for a granted role", () => {
      expect(getRolePolicy("portfolio.manage_own", "ROLE_LEARNER")).toEqual({ scopes: ["OWN"] });
    });
  });

  describe("monitoring COND keys — Admin's own grant is condition-free except monitoring.admin_manage", () => {
    it("monitoring.read_choose_own: ROLE_BUSINESS is ORG+COND, ROLE_ADMIN has no COND", () => {
      expect(ROLE_POLICIES["monitoring.read_choose_own"].ROLE_BUSINESS).toEqual({
        scopes: ["ORG", "COND"],
        conditionIds: ["MONITORING_SUBSCRIPTION_ACTIVE"],
      });
      expect(ROLE_POLICIES["monitoring.read_choose_own"].ROLE_ADMIN).toEqual({ scopes: [] });
    });

    it("monitoring.admin_manage: ROLE_ADMIN itself is the conditional one (COND only)", () => {
      expect(ROLE_POLICIES["monitoring.admin_manage"].ROLE_ADMIN).toEqual({
        scopes: ["COND"],
        conditionIds: ["MONITORING_ADMIN_FEATURE_ENABLED"],
      });
    });
  });
});
