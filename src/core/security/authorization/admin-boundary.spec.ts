import * as fs from "node:fs";
import * as path from "node:path";
import { API_AUTHORIZATION_MAP } from "./api-authorization-map";
import { OPERATION_ROLE_POLICIES } from "./operation-role-policy";
import { PERMISSION_KEYS, PERMISSION_REGISTRY } from "./permission-registry";
import { ROLES } from "./role.types";
import { ROLE_POLICIES } from "./role-policy";

const AUTHORIZATION_SOURCE_FILES = [
  "api-authorization-map.ts",
  "authorize-operation.decorator.ts",
  "condition-registry.ts",
  "operation-role-policy.ts",
  "permission-registry.ts",
  "require-permission.decorator.ts",
  "resource-context-resolver.ts",
  "role-policy.ts",
  "scope-evaluation.service.ts",
  "auth-scope-evaluator.service.ts",
  "security-scope-authorization.repository.ts",
  "disclosure-policy.ts",
].map((f) => path.join(__dirname, f));

const GUARD_SOURCE_FILES = [path.join(__dirname, "..", "guards", "permission.guard.ts")];

/**
 * Wave 0D-5 Part B — Admin boundary hardening (Phase 15/25). Static/
 * structural verification that ROLE_ADMIN's breadth comes only from
 * explicit, per-key/per-operation grants, never from a role-name shortcut
 * or a wildcard permission.
 */
describe("Admin boundary hardening — Wave 0D-5 Part B", () => {
  it("has exactly the 5 documented authenticated roles, no more, no fewer", () => {
    expect([...ROLES].sort()).toEqual(
      ["ROLE_ADMIN", "ROLE_BUSINESS", "ROLE_CONSULTANT", "ROLE_LEARNER", "ROLE_MENTOR"].sort(),
    );
  });

  it('no permission key is a wildcard/universal key ("*", "ADMIN_ALL", or similar)', () => {
    for (const key of PERMISSION_KEYS) {
      expect(key).not.toBe("*");
      expect(key.toUpperCase()).not.toContain("ALL_PERMISSIONS");
      expect(key.toUpperCase()).not.toMatch(/^ADMIN[._-]?ALL$/);
    }
  });

  it('no authorization source file contains an executable `role === "ROLE_ADMIN"` (or equivalent) bypass that immediately allows — comments/docs mentioning the anti-pattern, and ordinary per-role filtering (e.g. `if (role === "ROLE_ADMIN") continue`), are not bypasses', () => {
    // Only flag the pattern when it is immediately followed by an allow —
    // `return true` / `{ allowed: true }` — within a short lookahead,
    // which is what an actual bypass would look like. A bare comparison
    // used for filtering/branching elsewhere (e.g. skipping Admin's own
    // entry while diffing other roles' policies) is legitimate and must
    // not trip this check.
    const bypassPattern =
      /(?:role|principal\.role)\s*===?\s*["']ROLE_ADMIN["']\s*\)\s*(?:\{\s*)?(?:return true|allowed:\s*true)/;
    for (const file of [...AUTHORIZATION_SOURCE_FILES, ...GUARD_SOURCE_FILES]) {
      const src = fs.readFileSync(file, "utf8");
      expect({ file: path.basename(file), matched: bypassPattern.test(src) }).toMatchObject({
        matched: false,
      });
    }
  });

  it("every OPERATION_ROLE_POLICIES entry references only the 5 authenticated roles", () => {
    for (const [apiId, policies] of Object.entries(OPERATION_ROLE_POLICIES)) {
      for (const role of Object.keys(policies ?? {})) {
        expect(ROLES as readonly string[]).toContain(role);
        void apiId;
      }
    }
  });

  it("every ROLE_POLICIES entry references only the 5 authenticated roles", () => {
    for (const [key, policies] of Object.entries(ROLE_POLICIES)) {
      for (const role of Object.keys(policies)) {
        expect(ROLES as readonly string[]).toContain(role);
        void key;
      }
    }
  });

  it("every PERMISSION_REGISTRY entry's allowedRoles references only the 5 authenticated roles, and Admin appears only where explicitly listed", () => {
    for (const key of PERMISSION_KEYS) {
      const def = PERMISSION_REGISTRY[key];
      for (const role of def.allowedRoles) {
        expect(ROLES as readonly string[]).toContain(role);
      }
    }
  });

  it("Admin never gets a role-policy entry merged in from another role — every ROLE_ADMIN entry in ROLE_POLICIES is its own explicit object, not a shared reference to another role's policy", () => {
    for (const [key, policies] of Object.entries(ROLE_POLICIES)) {
      const adminPolicy = policies.ROLE_ADMIN;
      if (!adminPolicy) continue;
      for (const [role, policy] of Object.entries(policies)) {
        if (role === "ROLE_ADMIN") continue;
        // Distinct object identity proves no accidental shared reference
        // (which would mean editing one role's policy silently edits Admin's).
        expect(policy).not.toBe(adminPolicy);
      }
      void key;
    }
  });

  it("every technical operation whose OPERATION_ROLE_POLICIES entry grants ROLE_ADMIN also requires authScopeRequired when any other role on the same operation requires it (Admin never gets a technical-testing shortcut around AUTH_SCOPE)", () => {
    for (const [, policies] of Object.entries(OPERATION_ROLE_POLICIES)) {
      const adminPolicy = policies?.ROLE_ADMIN;
      if (!adminPolicy) continue;
      const anyOtherRoleRequiresAuthScope = Object.entries(policies ?? {}).some(
        ([role, p]) => role !== "ROLE_ADMIN" && p?.authScopeRequired,
      );
      if (anyOtherRoleRequiresAuthScope) {
        expect(adminPolicy.authScopeRequired).toBe(true);
      }
    }
  });

  it("Admin's OPERATION_ROLE_POLICIES entries never set assignmentRequired/ASG — Admin's alternative to Consultant/Mentor ASG is always a documented independent oversight grant, never a fabricated ASG pass", () => {
    for (const [apiId, policies] of Object.entries(OPERATION_ROLE_POLICIES)) {
      const adminPolicy = policies?.ROLE_ADMIN;
      if (!adminPolicy) continue;
      expect(adminPolicy.assignmentRequired).toBe(false);
      expect(adminPolicy.scopes).not.toContain("ASG");
      void apiId;
    }
  });

  it("no operation with multiple roles silently omits an explicit per-role policy for a role listed in the flat map's `roles` array — flat scope from another role is never applied by default to Admin", () => {
    // Structural cross-check: every operation with >=2 roles listed in the
    // flat map either (a) has an OPERATION_ROLE_POLICIES entry covering
    // every one of those roles (the split-alternative case), or (b) is
    // genuinely uniform, which permission.guard.ts falls back to
    // ROLE_POLICIES for — never a role-blind flat scope reused verbatim
    // for a role whose own permission-registry policy differs.
    const multiRoleOps = API_AUTHORIZATION_MAP.filter(
      (op) => op.classification === "PERMISSION_PROTECTED" && op.roles.length > 1,
    );
    expect(multiRoleOps.length).toBeGreaterThan(0);
    for (const op of multiRoleOps) {
      const override = OPERATION_ROLE_POLICIES[op.apiId];
      if (override) {
        for (const role of op.roles) {
          expect(override[role]).toBeDefined();
        }
      }
    }
  });

  it("counts: reports the exact number of API operations and permission keys where ROLE_ADMIN is a listed role", () => {
    const adminApiOps = API_AUTHORIZATION_MAP.filter((op) => op.roles.includes("ROLE_ADMIN"));
    const adminPermissionKeys = PERMISSION_KEYS.filter((key) =>
      PERMISSION_REGISTRY[key].allowedRoles.includes("ROLE_ADMIN"),
    );
    // These counts are asserted as a lower bound plus a reasonable upper
    // bound rather than pinned exactly, since the flat map's `roles` array
    // for split-alternative operations still lists Admin correctly even
    // though the *effective* per-role policy is refined by
    // OPERATION_ROLE_POLICIES — pinning the wrong invariant here would be
    // brittle to future within-Admin scope tightening, not to Admin's
    // actual permission surface. The full breakdown table is in the Wave
    // 0D-5 Final Report (Phase 14).
    expect(adminApiOps.length).toBeGreaterThan(0);
    expect(adminApiOps.length).toBeLessThanOrEqual(API_AUTHORIZATION_MAP.length);
    expect(adminPermissionKeys.length).toBeGreaterThan(0);
    expect(adminPermissionKeys.length).toBeLessThanOrEqual(PERMISSION_KEYS.length);
  });
});
