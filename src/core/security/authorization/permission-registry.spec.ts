import { PERMISSION_KEYS, PERMISSION_REGISTRY } from "./permission-registry";
import { ROLES } from "./role.types";
import { ScopeTypes } from "./scope.types";

describe("PERMISSION_REGISTRY", () => {
  it("defines exactly 60 unique permission keys (doc-verified count, corrected from the Wave 0D-1 report's '47' summary error)", () => {
    expect(PERMISSION_KEYS.length).toBe(60);
    expect(new Set(PERMISSION_KEYS).size).toBe(60);
  });

  it("has no wildcard or universal-admin key", () => {
    for (const key of PERMISSION_KEYS) {
      expect(key).not.toBe("*");
      expect(key.toLowerCase()).not.toContain("admin_all");
    }
  });

  it("has exactly one registry entry per declared key, with no extras", () => {
    const registryKeys = Object.keys(PERMISSION_REGISTRY).sort();
    expect(registryKeys).toEqual([...PERMISSION_KEYS].sort());
  });

  it("only ever grants roles from the exact 5 authenticated DB roles", () => {
    for (const definition of Object.values(PERMISSION_REGISTRY)) {
      for (const role of definition.allowedRoles) {
        expect(ROLES).toContain(role);
      }
    }
  });

  it("only ever attaches known scope types", () => {
    for (const definition of Object.values(PERMISSION_REGISTRY)) {
      for (const scope of definition.scope) {
        expect(ScopeTypes as readonly string[]).toContain(scope);
      }
    }
  });

  it("grants ROLE_ADMIN permissions only via explicit registry rows, never a blanket bypass", () => {
    const adminGrantedKeys = Object.values(PERMISSION_REGISTRY).filter((definition) =>
      definition.allowedRoles.includes("ROLE_ADMIN"),
    );
    const adminDeniedKeys = Object.values(PERMISSION_REGISTRY).filter(
      (definition) => !definition.allowedRoles.includes("ROLE_ADMIN"),
    );

    // Per RBAC v1.0, Admin is not granted the pure self-service / peer-only keys.
    expect(adminDeniedKeys.map((d) => d.key)).toEqual(
      expect.arrayContaining([
        "resource.bookmark.manage_own",
        "resource.progress.manage_own",
        "career.submit_own",
        "portfolio.manage_own",
        "portfolio.publish_control_own",
        "internship.application.create_own",
        "employer.opportunity.submit_own",
        "consulting.request.create_own",
        "audit.event.write_system",
      ]),
    );
    expect(adminGrantedKeys.length).toBeGreaterThan(0);
    expect(adminGrantedKeys.length).toBeLessThan(PERMISSION_KEYS.length);
  });

  it("marks audit.event.write_system as system-only (not a directly checkable human-role permission)", () => {
    expect(PERMISSION_REGISTRY["audit.event.write_system"].systemOnly).toBe(true);
    expect(PERMISSION_REGISTRY["audit.event.write_system"].allowedRoles).toEqual([]);
  });

  it("flags every documented COND permission as conditional", () => {
    const expectedConditional = [
      "account.delete.request_own",
      "resource.progress.manage_own",
      "cv_review.use_own",
      "employer.communication.participate",
      "monitoring.read_choose_own",
      "monitoring.perform_assigned",
      "monitoring.admin_manage",
    ];
    for (const key of expectedConditional) {
      expect(PERMISSION_REGISTRY[key as keyof typeof PERMISSION_REGISTRY].conditional).toBe(true);
    }
  });

  it("attaches AUTH_SCOPE only to the 3 documented technical consultant permission keys", () => {
    const authScopeKeys = Object.values(PERMISSION_REGISTRY)
      .filter((d) => d.scope.includes("AUTH_SCOPE"))
      .map((d) => d.key)
      .sort();
    expect(authScopeKeys).toEqual(
      [
        "assessment.manage_assigned",
        "finding.manage_assigned",
        "security_score.calculate_assigned",
      ].sort(),
    );
  });
});
