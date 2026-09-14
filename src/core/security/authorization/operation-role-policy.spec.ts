import { API_AUTHORIZATION_BY_ID } from "./api-authorization-map";
import {
  getOperationRolePolicy,
  OPERATION_ROLE_POLICIES,
  type OperationRolePolicies,
} from "./operation-role-policy";
import { ROLES } from "./role.types";
import { ScopeTypes } from "./scope.types";

const allEntries: readonly [string, OperationRolePolicies][] = Object.entries(
  OPERATION_ROLE_POLICIES,
).filter((entry): entry is [string, OperationRolePolicies] => entry[1] !== undefined);
const allPolicies: readonly OperationRolePolicies[] = allEntries.map(([, policies]) => policies);

describe("OPERATION_ROLE_POLICIES", () => {
  it("covers exactly the 36 operations identified by the Wave 0D-4 audit", () => {
    expect(Object.keys(OPERATION_ROLE_POLICIES).length).toBe(36);
  });

  it("every apiId is a real, known API_AUTHORIZATION_MAP entry", () => {
    for (const apiId of Object.keys(OPERATION_ROLE_POLICIES)) {
      expect(API_AUTHORIZATION_BY_ID.get(apiId)).toBeDefined();
    }
  });

  it("only references the exact 5 authenticated roles — no invented role", () => {
    for (const policies of allPolicies) {
      for (const role of Object.keys(policies)) {
        expect(ROLES).toContain(role);
      }
      expect(Object.keys(policies).length).toBeLessThanOrEqual(5);
    }
  });

  it("only lists roles that the underlying operation's flat `roles` field also lists", () => {
    for (const [apiId, policies] of allEntries) {
      const operation = API_AUTHORIZATION_BY_ID.get(apiId);
      expect(operation).toBeDefined();
      for (const role of Object.keys(policies)) {
        expect(operation?.roles).toContain(role);
      }
    }
  });

  it("only ever uses known scope tags", () => {
    for (const policies of allPolicies) {
      for (const policy of Object.values(policies)) {
        for (const scope of policy.scopes) {
          expect(ScopeTypes as readonly string[]).toContain(scope);
        }
      }
    }
  });

  it("every overridden operation's non-Admin role requires ASG; ROLE_ADMIN never does", () => {
    for (const policies of allPolicies) {
      for (const [role, policy] of Object.entries(policies)) {
        if (role === "ROLE_ADMIN") {
          expect(policy.scopes).not.toContain("ASG");
          expect(policy.assignmentRequired).toBe(false);
        } else {
          expect(policy.scopes).toContain("ASG");
          expect(policy.assignmentRequired).toBe(true);
        }
      }
    }
  });

  it("AUTH_SCOPE, where required, applies identically to both roles on the same operation (never an Admin exemption)", () => {
    for (const policies of allPolicies) {
      const entries = Object.values(policies);
      const authScopeFlags = new Set(entries.map((p) => p.authScopeRequired));
      // Every role on a given overridden operation must agree on whether
      // AUTH_SCOPE applies — it's a property of the operation being
      // technical, not of which role is calling it.
      expect(authScopeFlags.size).toBe(1);
    }
  });

  describe("getOperationRolePolicy", () => {
    it("API-ASM-002 (list assessments): Consultant needs ASG, Admin does not", () => {
      expect(getOperationRolePolicy("API-ASM-002", "ROLE_CONSULTANT")).toEqual({
        scopes: ["ASG"],
        assignmentRequired: true,
        authScopeRequired: false,
        resourceContextRequired: true,
      });
      expect(getOperationRolePolicy("API-ASM-002", "ROLE_ADMIN")).toEqual({
        scopes: [],
        assignmentRequired: false,
        authScopeRequired: false,
        resourceContextRequired: false,
      });
    });

    it("API-ASM-001 (create assessment): Consultant needs ASG+AUTH_SCOPE, Admin needs AUTH_SCOPE but not ASG", () => {
      expect(getOperationRolePolicy("API-ASM-001", "ROLE_CONSULTANT")?.scopes).toEqual([
        "ASG",
        "AUTH_SCOPE",
      ]);
      const adminPolicy = getOperationRolePolicy("API-ASM-001", "ROLE_ADMIN");
      expect(adminPolicy?.scopes).toEqual(["AUTH_SCOPE"]);
      expect(adminPolicy?.scopes).not.toContain("ASG");
    });

    it("API-REV-001 (mentor review queue): Mentor needs ASG, Admin does not", () => {
      expect(getOperationRolePolicy("API-REV-001", "ROLE_MENTOR")?.scopes).toEqual(["ASG"]);
      expect(getOperationRolePolicy("API-REV-001", "ROLE_ADMIN")?.scopes).toEqual([]);
    });

    it("returns undefined for an un-overridden operation", () => {
      expect(getOperationRolePolicy("API-PORT-002", "ROLE_LEARNER")).toBeUndefined();
    });

    it("returns undefined for a role not present in an overridden operation's policy", () => {
      expect(getOperationRolePolicy("API-ASM-002", "ROLE_LEARNER")).toBeUndefined();
    });
  });
});
