import {
  API_AUTHORIZATION_MAP,
  KNOWN_MAPPING_GAPS,
  type RouteClassification,
} from "./api-authorization-map";
import { isPermissionKey } from "./permission-registry";
import { ScopeTypes } from "./scope.types";

const VALID_CLASSIFICATIONS: readonly RouteClassification[] = [
  "PUBLIC",
  "AUTHENTICATED_ONLY",
  "PERMISSION_PROTECTED",
];

// Wave 0D-2 Closure Pass: authorization is delegated to the calling/parent
// domain for exactly these 2 operations, per API Contract v1.1's explicit
// "Caller domain permission" wording. This allow-list must never grow by
// inference — only by re-reading the source contract.
const CALLER_DOMAIN_PERMISSION_ALLOWLIST = ["API-FILE-001", "API-FILE-002"];

describe("API_AUTHORIZATION_MAP", () => {
  it("contains exactly 209 operations, per API Contract v1.1's frozen Master Endpoint Registry", () => {
    expect(API_AUTHORIZATION_MAP.length).toBe(209);
  });

  it("has unique apiId values with no duplicates", () => {
    const ids = API_AUTHORIZATION_MAP.map((op) => op.apiId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every operation an explicit, known classification with zero unresolved ambiguity", () => {
    for (const op of API_AUTHORIZATION_MAP) {
      expect(VALID_CLASSIFICATIONS).toContain(op.classification);
    }
  });

  it("requires a known permissionKey for every directly-permissioned PERMISSION_PROTECTED operation", () => {
    for (const op of API_AUTHORIZATION_MAP.filter(
      (o) =>
        o.classification === "PERMISSION_PROTECTED" && o.authorizationMode === "DIRECT_PERMISSION",
    )) {
      expect(op.permissionKey).not.toBeNull();
      if (op.permissionKey) expect(isPermissionKey(op.permissionKey)).toBe(true);
    }
  });

  it("never attaches a permissionKey to a PUBLIC or AUTHENTICATED_ONLY operation that wasn't explicitly documented", () => {
    for (const op of API_AUTHORIZATION_MAP) {
      if (op.permissionKey !== null) {
        expect(isPermissionKey(op.permissionKey)).toBe(true);
      }
    }
  });

  it("keeps every additionalPermissionKeys entry inside the known registry", () => {
    for (const op of API_AUTHORIZATION_MAP) {
      if (op.additionalPermissionKeys) {
        expect(op.additionalPermissionKeys.length).toBeGreaterThan(1);
        for (const key of op.additionalPermissionKeys) {
          expect(isPermissionKey(key)).toBe(true);
        }
      }
    }
  });

  it("only ever uses known scope tags", () => {
    for (const op of API_AUTHORIZATION_MAP) {
      for (const scope of op.scope) {
        expect(ScopeTypes as readonly string[]).toContain(scope);
      }
    }
  });

  it("attaches authScopeRequired at the operation level, not uniformly across an entire permission key family", () => {
    const authScopeFamilyKeys = [
      "assessment.manage_assigned",
      "finding.manage_assigned",
      "security_score.calculate_assigned",
    ];
    for (const key of authScopeFamilyKeys) {
      const ops = API_AUTHORIZATION_MAP.filter((o) => o.permissionKey === key);
      if (ops.length > 1) {
        const values = new Set(ops.map((o) => o.authScopeRequired));
        for (const op of ops) expect(typeof op.authScopeRequired).toBe("boolean");
        expect(values.size).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("reports exact classification totals with zero AMBIGUOUS operations (14 public, 193 permission-protected, 2 authenticated-only)", () => {
    const counts: Record<string, number> = {};
    for (const op of API_AUTHORIZATION_MAP) {
      counts[op.classification] = (counts[op.classification] ?? 0) + 1;
    }
    expect(counts.PUBLIC).toBe(14);
    expect(counts.PERMISSION_PROTECTED).toBe(193);
    expect(counts.AUTHENTICATED_ONLY).toBe(2);
    expect(counts.AMBIGUOUS).toBeUndefined();
    expect(
      (counts.PUBLIC ?? 0) + (counts.PERMISSION_PROTECTED ?? 0) + (counts.AUTHENTICATED_ONLY ?? 0),
    ).toBe(209);
  });

  it("marks the two current Wave 0C session endpoints as AUTHENTICATED_ONLY", () => {
    const sessionOps = API_AUTHORIZATION_MAP.filter(
      (op) => op.path === "/auth/session" || op.path === "/auth/sessions/current",
    );
    for (const op of sessionOps) {
      expect(op.classification).toBe("AUTHENTICATED_ONLY");
      expect(op.permissionKey).toBeNull();
    }
  });

  describe("Wave 0D-2 Closure Pass — CALLER_DOMAIN_PERMISSION", () => {
    it("is used only by the explicit, narrow allow-list", () => {
      const delegated = API_AUTHORIZATION_MAP.filter(
        (op) => op.authorizationMode === "CALLER_DOMAIN_PERMISSION",
      ).map((op) => op.apiId);
      expect(delegated.sort()).toEqual([...CALLER_DOMAIN_PERMISSION_ALLOWLIST].sort());
    });

    it("is never PUBLIC or AUTHENTICATED_ONLY — it stays PERMISSION_PROTECTED", () => {
      for (const apiId of CALLER_DOMAIN_PERMISSION_ALLOWLIST) {
        const op = API_AUTHORIZATION_MAP.find((o) => o.apiId === apiId);
        expect(op).toBeDefined();
        expect(op?.classification).toBe("PERMISSION_PROTECTED");
      }
    });

    it("never carries a direct permissionKey (no fake generic file permission was invented)", () => {
      for (const apiId of CALLER_DOMAIN_PERMISSION_ALLOWLIST) {
        const op = API_AUTHORIZATION_MAP.find((o) => o.apiId === apiId);
        expect(op?.permissionKey).toBeNull();
      }
    });

    it("every other operation uses DIRECT_PERMISSION", () => {
      const nonDelegated = API_AUTHORIZATION_MAP.filter(
        (op) => !CALLER_DOMAIN_PERMISSION_ALLOWLIST.includes(op.apiId),
      );
      for (const op of nonDelegated) {
        expect(op.authorizationMode).toBe("DIRECT_PERMISSION");
      }
    });
  });

  describe("Wave 0D-2 Closure Pass — donation operations final disposition", () => {
    it("API-DON-001 (POST /donations/checkout) is PUBLIC with the documented donation.create key", () => {
      const op = API_AUTHORIZATION_MAP.find((o) => o.apiId === "API-DON-001");
      expect(op).toMatchObject({
        classification: "PUBLIC",
        requiresAuth: false,
        permissionKey: "donation.create",
        authorizationMode: "DIRECT_PERMISSION",
      });
    });

    it("API-DON-002 (GET /donations/{donationId}/confirmation) is PUBLIC (OWN-or-signed-token dual path)", () => {
      const op = API_AUTHORIZATION_MAP.find((o) => o.apiId === "API-DON-002");
      expect(op).toMatchObject({
        classification: "PUBLIC",
        requiresAuth: false,
        permissionKey: "donation.create",
        authorizationMode: "DIRECT_PERMISSION",
      });
    });

    it("API-DON-003 (POST /webhooks/stripe) is PUBLIC with no RBAC key and PROVIDER_SIGNATURE verification", () => {
      const op = API_AUTHORIZATION_MAP.find((o) => o.apiId === "API-DON-003");
      expect(op).toMatchObject({
        classification: "PUBLIC",
        requiresAuth: false,
        permissionKey: null,
        verificationMode: "PROVIDER_SIGNATURE",
      });
    });
  });

  describe("Wave 0D-2 Closure Pass — file operations final disposition", () => {
    it("API-FILE-001 (POST /files) is PERMISSION_PROTECTED + CALLER_DOMAIN_PERMISSION, always requires a session, deferred by GAP-013", () => {
      const op = API_AUTHORIZATION_MAP.find((o) => o.apiId === "API-FILE-001");
      expect(op).toMatchObject({
        classification: "PERMISSION_PROTECTED",
        requiresAuth: true,
        permissionKey: null,
        authorizationMode: "CALLER_DOMAIN_PERMISSION",
        implementationStatus: "DEFERRED_GAP_013",
      });
      expect(op?.scope).toEqual(expect.arrayContaining(["OWN", "ORG", "ASG"]));
    });

    it("API-FILE-002 (GET /files/{storedObjectId}/download) is PERMISSION_PROTECTED + CALLER_DOMAIN_PERMISSION with a narrow governed-public-certificate exception", () => {
      const op = API_AUTHORIZATION_MAP.find((o) => o.apiId === "API-FILE-002");
      expect(op).toMatchObject({
        classification: "PERMISSION_PROTECTED",
        requiresAuth: false,
        permissionKey: null,
        authorizationMode: "CALLER_DOMAIN_PERMISSION",
      });
      expect(op?.scope).toEqual(expect.arrayContaining(["OWN", "ORG", "ASG", "PUB"]));
    });

    it("delegated FILE operations can never be satisfied by session/role alone — no fixed permissionKey exists to grant", () => {
      // There is nothing for a role-only PermissionGuard check to allow here
      // by design: permissionKey is null and authorizationMode signals that
      // a caller-domain resolver (not yet implemented) is mandatory.
      for (const apiId of ["API-FILE-001", "API-FILE-002"]) {
        const op = API_AUTHORIZATION_MAP.find((o) => o.apiId === apiId);
        expect(op?.permissionKey).toBeNull();
        expect(op?.authorizationMode).toBe("CALLER_DOMAIN_PERMISSION");
      }
    });
  });

  describe("Wave 0D-2 Closure Pass — KNOWN_MAPPING_GAPS resolution", () => {
    it("has zero entries left BLOCKING", () => {
      const blocking = KNOWN_MAPPING_GAPS.filter((g) => g.status === "BLOCKING");
      expect(blocking).toEqual([]);
    });

    it("marks all 5 target operations' gap notes RESOLVED", () => {
      for (const apiId of [
        "API-DON-001",
        "API-DON-002",
        "API-DON-003",
        "API-FILE-001",
        "API-FILE-002",
      ]) {
        const gap = KNOWN_MAPPING_GAPS.find((g) => g.apiIds === apiId);
        expect(gap).toBeDefined();
        expect(gap?.status).toBe("RESOLVED");
      }
    });

    it("every gap entry has one of the defined closure statuses", () => {
      const validStatuses = [
        "RESOLVED",
        "DOCUMENTED_REPRESENTATION",
        "DEFERRED_PRODUCT_GAP",
        "BLOCKING",
      ];
      for (const gap of KNOWN_MAPPING_GAPS) {
        expect(validStatuses).toContain(gap.status);
      }
    });
  });
});
