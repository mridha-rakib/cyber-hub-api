import { API_AUTHORIZATION_MAP } from "./api-authorization-map";

/**
 * Wave 0D-7 Phase 4/5. Recomputed, doc-grounded audit-requirement coverage
 * — locks in the exact counts so a future accidental change to
 * `auditRequired` metadata is caught by a failing test rather than
 * silently drifting.
 */
describe("209-operation auditRequired coverage — Wave 0D-7", () => {
  const auditRequiredOps = API_AUTHORIZATION_MAP.filter((op) => op.auditRequired);

  it("recomputes the exact TOTAL/AUDIT_REQUIRED/AUDIT_NOT_REQUIRED counts", () => {
    expect(API_AUTHORIZATION_MAP.length).toBe(209);
    expect(auditRequiredOps.length).toBe(83);
    expect(API_AUTHORIZATION_MAP.length - auditRequiredOps.length).toBe(126);
  });

  it("82 of the 83 audit-required operations are PERMISSION_PROTECTED — supportable by the central PermissionGuard authorization-decision pipeline this Wave", () => {
    const supportedThisWave = auditRequiredOps.filter(
      (op) => op.classification === "PERMISSION_PROTECTED",
    );
    expect(supportedThisWave.length).toBe(82);
  });

  it("exactly 1 audit-required operation (API-DON-003, the Stripe webhook) is PUBLIC/PROVIDER_SIGNATURE — outside the RBAC pipeline, deferred to its own future provider/domain handler, never faked through PermissionGuard", () => {
    const deferred = auditRequiredOps.filter((op) => op.classification !== "PERMISSION_PROTECTED");
    expect(deferred.map((op) => op.apiId)).toEqual(["API-DON-003"]);
    expect(deferred[0].verificationMode).toBe("PROVIDER_SIGNATURE");
  });

  it("no AUTHENTICATED_ONLY operation is audit-required (none currently need central authorization-decision auditing)", () => {
    const authenticatedOnlyAudited = auditRequiredOps.filter(
      (op) => op.classification === "AUTHENTICATED_ONLY",
    );
    expect(authenticatedOnlyAudited.length).toBe(0);
  });

  it("no CALLER_DOMAIN_PERMISSION operation is audit-required (API-FILE-001/002 remain fail-closed/deferred, never faked through this Wave's mechanism)", () => {
    const callerDomainAudited = auditRequiredOps.filter(
      (op) => op.authorizationMode === "CALLER_DOMAIN_PERMISSION",
    );
    expect(callerDomainAudited.length).toBe(0);
  });

  it("every PERMISSION_PROTECTED audit-required operation carries a real, registered permission key", () => {
    for (const op of auditRequiredOps) {
      if (op.classification !== "PERMISSION_PROTECTED") continue;
      expect(op.permissionKey).not.toBeNull();
    }
  });

  it("category breakdown sums to the exact 82 PERMISSION_PROTECTED audit-required operations", () => {
    const byPermissionKey: Record<string, number> = {};
    for (const op of auditRequiredOps) {
      if (op.classification !== "PERMISSION_PROTECTED" || !op.permissionKey) continue;
      byPermissionKey[op.permissionKey] = (byPermissionKey[op.permissionKey] ?? 0) + 1;
    }
    const total = Object.values(byPermissionKey).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(82);
    // Spot-check a representative category count from each of the source-
    // grounded groupings reported in the Wave 0D-7 final report.
    expect(byPermissionKey["assessment.manage_assigned"]).toBe(4);
    expect(byPermissionKey["finding.manage_assigned"]).toBe(5);
    expect(byPermissionKey["report.prepare_review_assigned"]).toBe(5);
    expect(byPermissionKey["report.release_client"]).toBe(2);
    expect(byPermissionKey["consulting.request.review_assigned"]).toBe(6);
    expect(byPermissionKey["account.role.assign_privileged"]).toBe(3);
  });
});
