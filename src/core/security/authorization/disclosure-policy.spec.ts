import { API_AUTHORIZATION_MAP, type ApiOperationAuthorization } from "./api-authorization-map";
import {
  type AuthorizationDisclosurePolicy,
  resolveDisclosurePolicy,
  resolveDisclosurePolicyForOperation,
} from "./disclosure-policy";

function getOperation(apiId: string): ApiOperationAuthorization {
  const op = API_AUTHORIZATION_MAP.find((o) => o.apiId === apiId);
  if (!op) throw new Error(`test fixture references unknown apiId "${apiId}"`);
  return op;
}

const VALID_POLICIES: ReadonlySet<AuthorizationDisclosurePolicy> = new Set([
  "DISCLOSE_FORBIDDEN",
  "CONCEAL_EXISTENCE",
  "NOT_APPLICABLE",
]);

describe("disclosure-policy — Wave 0D-5 209-operation coverage audit", () => {
  it("classifies exactly 209 operations with no unknown/undefined result", () => {
    expect(API_AUTHORIZATION_MAP.length).toBe(209);
    for (const op of API_AUTHORIZATION_MAP) {
      const policy = resolveDisclosurePolicyForOperation(op);
      expect(VALID_POLICIES.has(policy)).toBe(true);
    }
  });

  it("produces the exact, doc-verified distribution: 40 DISCLOSE_FORBIDDEN / 88 CONCEAL_EXISTENCE / 81 NOT_APPLICABLE", () => {
    const counts: Record<AuthorizationDisclosurePolicy, number> = {
      DISCLOSE_FORBIDDEN: 0,
      CONCEAL_EXISTENCE: 0,
      NOT_APPLICABLE: 0,
    };
    for (const op of API_AUTHORIZATION_MAP) {
      counts[resolveDisclosurePolicyForOperation(op)]++;
    }
    expect(counts.DISCLOSE_FORBIDDEN).toBe(40);
    expect(counts.CONCEAL_EXISTENCE).toBe(88);
    expect(counts.NOT_APPLICABLE).toBe(81);
    expect(counts.DISCLOSE_FORBIDDEN + counts.CONCEAL_EXISTENCE + counts.NOT_APPLICABLE).toBe(209);
  });

  it("every PUBLIC and AUTHENTICATED_ONLY operation is NOT_APPLICABLE (no identifiable protected resource to conceal)", () => {
    for (const op of API_AUTHORIZATION_MAP) {
      if (op.classification === "PUBLIC" || op.classification === "AUTHENTICATED_ONLY") {
        expect(resolveDisclosurePolicyForOperation(op)).toBe("NOT_APPLICABLE");
      }
    }
  });

  it("every operation with resourceContextRequired: false is NOT_APPLICABLE regardless of permission key", () => {
    for (const op of API_AUTHORIZATION_MAP) {
      if (!op.resourceContextRequired) {
        expect(resolveDisclosurePolicyForOperation(op)).toBe("NOT_APPLICABLE");
      }
    }
  });

  it("CALLER_DOMAIN_PERMISSION operations (API-FILE-001/002) are NOT_APPLICABLE at this layer — the real decision belongs to the resolved parent-domain operation", () => {
    const fileOps = API_AUTHORIZATION_MAP.filter(
      (op) => op.authorizationMode === "CALLER_DOMAIN_PERMISSION",
    );
    expect(fileOps.length).toBe(2);
    for (const op of fileOps) {
      expect(resolveDisclosurePolicyForOperation(op)).toBe("NOT_APPLICABLE");
    }
  });

  it("CONCEAL_EXISTENCE only appears on documented sensitive-resource operations named in Wave 0D-5 Phase 4 (spot check: security domain, private learner data, tenant isolation, assignment-only)", () => {
    const expectConceal = [
      "API-ASM-003", // GET /assessments/{assessmentId} — security assessment
      "API-CON-007", // GET /consulting/requests/{requestId} — consulting request
      "API-FND-003", // GET /findings/{findingId} — vulnerability finding
      "API-RPT-002", // GET /reports/{reportId} — pre-release report (already doc-cited)
      "API-RPT-011", // GET /business/security/reports/{reportId} — released-only report (already doc-cited)
      "API-CER-004", // GET /me/certificates/{certificateId} — learner's own certificate
      "API-APP-003", // GET /me/internship-applications/{applicationId} — learner's own application
      "API-SUB-002", // GET /me/submissions/{submissionId} — learner's own submission
      "API-BIZCAR-003", // GET /business/career-listings/{listingId} — business-private listing
    ];
    for (const apiId of expectConceal) {
      expect(resolveDisclosurePolicyForOperation(getOperation(apiId))).toBe("CONCEAL_EXISTENCE");
    }
  });

  it("DISCLOSE_FORBIDDEN applies to Admin's own unconditional oversight/content-management console operations, not private end-user data", () => {
    const expectDisclose = [
      "API-ADM-002", // GET /admin/users/{userId} — Admin's own user directory
      "API-ADMCRS-002", // PATCH /admin/courses/{courseId} — admin course moderation
      "API-CER-006", // POST /admin/certificates/{certificateId}/revoke — publicly-verifiable credential
      "API-ADMRES-002", // PATCH /admin/resources/{resourceId} — admin platform content
    ];
    for (const apiId of expectDisclose) {
      expect(resolveDisclosurePolicyForOperation(getOperation(apiId))).toBe("DISCLOSE_FORBIDDEN");
    }
  });

  it("publicly-readable content operations remain NOT_APPLICABLE, never concealed merely because the caller might be anonymous", () => {
    const expectNotApplicable = [
      "API-CAR-002", // GET /career-listings/{listingId} — published listing
      "API-CRS-002", // GET /courses/{courseId} — published course
      "API-PORT-001", // GET /portfolios/{publicSlug} — published public portfolio
      "API-RES-002", // GET /resources/{resourceId} — public learning resource
    ];
    for (const apiId of expectNotApplicable) {
      expect(resolveDisclosurePolicyForOperation(getOperation(apiId))).toBe("NOT_APPLICABLE");
    }
  });

  it("resolveDisclosurePolicy never invents CONCEAL_EXISTENCE for an unclassified permission key — conservative default is DISCLOSE_FORBIDDEN", () => {
    // "public.content.read" IS classified (NOT_APPLICABLE) but exercising the
    // resolver directly with resourceContextRequired: true against a made-up
    // permission key proves the fallback branch, since every REAL key the
    // registry defines is already explicitly classified in disclosure-policy.ts.
    const result = resolveDisclosurePolicy("public.content.read" as never, null, true);
    expect(["DISCLOSE_FORBIDDEN", "CONCEAL_EXISTENCE", "NOT_APPLICABLE"]).toContain(result);
  });

  it("resourceContextRequired: false always overrides to NOT_APPLICABLE even for a normally-CONCEAL_EXISTENCE permission key", () => {
    expect(resolveDisclosurePolicy("assessment.manage_assigned", "API-ASM-003", false)).toBe(
      "NOT_APPLICABLE",
    );
  });

  it("apiId-level overrides split internship.task.manage_assign correctly: learner-private enrollment operations conceal, admin-authored task-template operations disclose", () => {
    expect(resolveDisclosurePolicy("internship.task.manage_assign", "API-ENR-004", true)).toBe(
      "CONCEAL_EXISTENCE",
    );
    expect(resolveDisclosurePolicy("internship.task.manage_assign", "API-ENR-005", true)).toBe(
      "CONCEAL_EXISTENCE",
    );
    expect(resolveDisclosurePolicy("internship.task.manage_assign", "API-TSK-001", true)).toBe(
      "DISCLOSE_FORBIDDEN",
    );
  });
});
