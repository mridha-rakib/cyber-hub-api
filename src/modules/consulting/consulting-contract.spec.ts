import { API_AUTHORIZATION_BY_ID } from "../../core/security/authorization/api-authorization-map";
import { CONSULTING_API_CONTRACT, CONSULTING_CLIENT_VIEW_FIELDS } from "./consulting-contract";

describe("Wave 4A consulting internal contract matrix", () => {
  it("contains exactly API-CON-001 through API-CON-015 once each", () => {
    expect(CONSULTING_API_CONTRACT).toHaveLength(15);
    expect(CONSULTING_API_CONTRACT.map((entry) => entry.apiId)).toEqual(
      Array.from({ length: 15 }, (_, index) => `API-CON-${String(index + 1).padStart(3, "0")}`),
    );
  });

  it("matches the frozen authorization/audit registry for every operation", () => {
    for (const entry of CONSULTING_API_CONTRACT) {
      const authorization = API_AUTHORIZATION_BY_ID.get(entry.apiId);
      expect(authorization).toBeDefined();
      expect(authorization?.method).toBe(entry.method);
      expect(authorization?.path).toBe(entry.path);
      expect(authorization?.permissionKey).toBe(entry.permission);
      expect(authorization?.roles).toEqual(entry.roles);
      expect(authorization?.auditRequired).toBe(entry.auditRequired);
    }
  });

  it("marks only lifecycle commands as CAS-relevant and never places notes in the client projection", () => {
    expect(
      CONSULTING_API_CONTRACT.filter((entry) => entry.cas).map((entry) => entry.apiId),
    ).toEqual(["API-CON-009", "API-CON-010", "API-CON-011", "API-CON-012", "API-CON-013"]);
    expect(CONSULTING_CLIENT_VIEW_FIELDS).not.toContain("notes");
    expect(CONSULTING_CLIENT_VIEW_FIELDS).not.toContain("assignedConsultantId");
  });
});
