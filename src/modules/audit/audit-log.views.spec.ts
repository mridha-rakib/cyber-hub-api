import { minimizeAuditMetadata, toAuditLogView } from "./audit-log.views";

describe("AuditLogView projection (Wave 7A, API Contract v1.5 §18)", () => {
  it("keeps allow-listed scalar metadata and drops everything else", () => {
    const metadata = minimizeAuditMetadata({
      apiId: "API-RPT-006",
      from: "IN_REVIEW",
      to: "DRAFT",
      stateVersion: 3,
      authScopeRequired: false,
      findingIds: ["a", "b"],
      password: "hunter2",
      passwordHash: "$argon2id$...",
      sessionToken: "raw-session-secret",
      token: "raw-token",
      secret: "sk_live_x",
      authorization: "Bearer abc",
      draftContent: { executiveSummary: "restricted" },
    });
    expect(metadata).toEqual({
      apiId: "API-RPT-006",
      from: "IN_REVIEW",
      to: "DRAFT",
      stateVersion: 3,
      authScopeRequired: false,
      findingIds: ["a", "b"],
    });
  });

  it("never projects nested objects even under an allow-listed key", () => {
    expect(
      minimizeAuditMetadata({ reason: { raw: "payload" }, changedFields: [{ a: 1 }] }),
    ).toEqual({});
  });

  it("bounds string and array sizes", () => {
    const metadata = minimizeAuditMetadata({
      reason: "x".repeat(5000),
      findingIds: Array.from({ length: 500 }, (_, index) => String(index)),
    });
    expect((metadata.reason as string).length).toBe(1000);
    expect((metadata.findingIds as string[]).length).toBe(200);
  });

  it("returns an empty object for non-object metadata", () => {
    expect(minimizeAuditMetadata(null)).toEqual({});
    expect(minimizeAuditMetadata(["apiId"])).toEqual({});
    expect(minimizeAuditMetadata("apiId")).toEqual({});
  });

  it("maps exactly the AuditLogView fields", () => {
    const view = toAuditLogView({
      id: "11111111-1111-4111-8111-111111111111",
      actorUserId: null,
      actorRole: "ROLE_ADMIN",
      serviceContext: null,
      action: "authorization.denied",
      entityType: "authorization",
      entityId: null,
      userId: null,
      employerId: null,
      timestamp: new Date("2026-10-20T08:00:00.123Z"),
      metadata: { apiId: "API-AUD-001", token: "x" },
      requestId: "req-1",
    });
    expect(Object.keys(view).sort()).toEqual(
      [
        "action",
        "actorRole",
        "actorUserId",
        "employerId",
        "entityId",
        "entityType",
        "id",
        "metadata",
        "requestId",
        "serviceContext",
        "timestamp",
        "userId",
      ].sort(),
    );
    expect(view.timestamp).toBe("2026-10-20T08:00:00.123Z");
    expect(view.metadata).toEqual({ apiId: "API-AUD-001" });
  });
});
