import type { AuditLogsRepository } from "../../../modules/auth/repositories/audit-logs.repository";
import type { RequestContextService } from "../../request-context/request-context.service";
import { AuthorizationAuditService } from "./authorization-audit.service";
import type { AuthorizationDecision } from "./authorization-decision.types";

function makeDecision(overrides: Partial<AuthorizationDecision> = {}): AuthorizationDecision {
  return {
    decision: "ALLOW",
    apiId: "API-ASM-004",
    permissionKey: "assessment.manage_assigned",
    actorUserId: "actor-1",
    actorRole: "ROLE_CONSULTANT",
    evaluatedScopes: ["ASG", "AUTH_SCOPE"],
    disclosurePolicy: "CONCEAL_EXISTENCE",
    workflowSensitive: true,
    authScopeRequired: true,
    ...overrides,
  };
}

describe("AuthorizationAuditService — Wave 0D-7", () => {
  function makeService() {
    const record = jest.fn().mockResolvedValue(undefined);
    const repository = { record } as unknown as AuditLogsRepository;
    const requestContext = {
      getRequestId: jest.fn().mockReturnValue("req-123"),
    } as unknown as RequestContextService;
    const service = new AuthorizationAuditService(repository, requestContext);
    return { service, record, requestContext };
  }

  it("writes action 'authorization.allowed' for ALLOW decisions", async () => {
    const { service, record } = makeService();
    await service.recordDecision(makeDecision({ decision: "ALLOW" }));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0].action).toBe("authorization.allowed");
  });

  it("writes action 'authorization.denied' for DENY decisions", async () => {
    const { service, record } = makeService();
    await service.recordDecision(
      makeDecision({ decision: "DENY", reasonCode: "ASG_SCOPE_DENIED" }),
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0].action).toBe("authorization.denied");
  });

  it("uses actor fields authoritatively (actorUserId/actorRole), never a subject fallback", async () => {
    const { service, record } = makeService();
    await service.recordDecision(makeDecision({ actorUserId: "admin-1", actorRole: "ROLE_ADMIN" }));
    const row = record.mock.calls[0][0];
    expect(row.actorUserId).toBe("admin-1");
    expect(row.actorRole).toBe("ROLE_ADMIN");
  });

  it("entity_type defaults to 'authorization' when no resource was resolved", async () => {
    const { service, record } = makeService();
    await service.recordDecision(makeDecision({ resource: undefined }));
    const row = record.mock.calls[0][0];
    expect(row.entityType).toBe("authorization");
    expect(row.entityId).toBeUndefined();
    expect(row.userId).toBeUndefined();
    expect(row.employerId).toBeUndefined();
  });

  it("uses the authoritative resolved resource for entity_type/entity_id/user_id/employer_id when present", async () => {
    const { service, record } = makeService();
    await service.recordDecision(
      makeDecision({
        resource: {
          resourceType: "assessment",
          resourceId: "assessment-1",
          ownerUserId: "subject-user-1",
          employerId: "employer-1",
        },
      }),
    );
    const row = record.mock.calls[0][0];
    expect(row.entityType).toBe("assessment");
    expect(row.entityId).toBe("assessment-1");
    expect(row.userId).toBe("subject-user-1");
    expect(row.employerId).toBe("employer-1");
  });

  it("subject user_id is never defaulted to the actor's own userId", async () => {
    const { service, record } = makeService();
    await service.recordDecision(makeDecision({ actorUserId: "actor-1", resource: undefined }));
    const row = record.mock.calls[0][0];
    expect(row.userId).toBeUndefined();
    expect(row.userId).not.toBe("actor-1");
  });

  it("uses the server-side RequestContext requestId when the decision does not carry one explicitly", async () => {
    const { service, record, requestContext } = makeService();
    await service.recordDecision(makeDecision({ requestId: undefined }));
    expect(requestContext.getRequestId).toHaveBeenCalled();
    expect(record.mock.calls[0][0].requestId).toBe("req-123");
  });

  it("metadata contains only the explicit safe allowlist — apiId, permissionKey, decision, reasonCode, evaluatedScopes, disclosurePolicy, workflowSensitive, authScopeRequired", async () => {
    const { service, record } = makeService();
    await service.recordDecision(
      makeDecision({ decision: "DENY", reasonCode: "AUTH_SCOPE_DENIED" }),
    );
    const metadata = record.mock.calls[0][0].metadata;
    expect(Object.keys(metadata).sort()).toEqual(
      [
        "apiId",
        "authScopeRequired",
        "decision",
        "disclosurePolicy",
        "evaluatedScopes",
        "permissionKey",
        "reasonCode",
        "workflowSensitive",
      ].sort(),
    );
  });

  it("never includes raw request/body/query/header-shaped data in metadata", async () => {
    const { service, record } = makeService();
    await service.recordDecision(makeDecision());
    const metadata = record.mock.calls[0][0].metadata;
    const serialized = JSON.stringify(metadata);
    for (const forbidden of ["body", "query", "headers", "cookie", "password", "token"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("propagates a repository failure so the caller can decide fail-open/closed behavior", async () => {
    const record = jest.fn().mockRejectedValue(new Error("db down"));
    const repository = { record } as unknown as AuditLogsRepository;
    const requestContext = {
      getRequestId: jest.fn().mockReturnValue("req-1"),
    } as unknown as RequestContextService;
    const service = new AuthorizationAuditService(repository, requestContext);
    await expect(service.recordDecision(makeDecision())).rejects.toThrow("db down");
  });
});
