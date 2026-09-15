import { mapScopeFailureReasonToAuditCode } from "./authorization-audit-reason.util";

describe("mapScopeFailureReasonToAuditCode — Wave 0D-7", () => {
  it("maps OWN failures", () => {
    expect(mapScopeFailureReasonToAuditCode("OWN: resource owner does not match actor")).toBe(
      "OWN_SCOPE_DENIED",
    );
  });

  it("maps ORG failures", () => {
    expect(
      mapScopeFailureReasonToAuditCode("ORG: resource employerId does not match actor employerId"),
    ).toBe("ORG_SCOPE_DENIED");
  });

  it("maps ASG failures", () => {
    expect(mapScopeFailureReasonToAuditCode("ASG: actor is not in resource.assignedUserIds")).toBe(
      "ASG_SCOPE_DENIED",
    );
  });

  it("maps PUB failures", () => {
    expect(mapScopeFailureReasonToAuditCode("PUB: resource is not authoritatively public")).toBe(
      "PUB_SCOPE_DENIED",
    );
  });

  it("maps COND failures", () => {
    expect(mapScopeFailureReasonToAuditCode('COND: condition "X" evaluated false')).toBe(
      "COND_DENIED",
    );
  });

  it("maps AUTH_SCOPE failures without ever including target/activity detail from the free-text reason", () => {
    const code = mapScopeFailureReasonToAuditCode("AUTH_SCOPE: requested activity not covered");
    expect(code).toBe("AUTH_SCOPE_DENIED");
  });

  it("maps resolver-unavailable reasons to RESOLVER_FAILURE", () => {
    expect(
      mapScopeFailureReasonToAuditCode('no resource context resolved for resourceType "portfolio"'),
    ).toBe("RESOLVER_FAILURE");
    expect(
      mapScopeFailureReasonToAuditCode(
        "resourceContextRequired but no resource context was resolved",
      ),
    ).toBe("RESOLVER_FAILURE");
  });

  it("maps not-found reasons to RESOURCE_NOT_FOUND", () => {
    expect(
      mapScopeFailureReasonToAuditCode('resource not found for resourceType "portfolio"'),
    ).toBe("RESOURCE_NOT_FOUND");
  });

  it("falls back to OTHER_SAFE_INTERNAL_REASON for unrecognized or missing text", () => {
    expect(mapScopeFailureReasonToAuditCode(undefined)).toBe("OTHER_SAFE_INTERNAL_REASON");
    expect(mapScopeFailureReasonToAuditCode("something unexpected")).toBe(
      "OTHER_SAFE_INTERNAL_REASON",
    );
  });
});
