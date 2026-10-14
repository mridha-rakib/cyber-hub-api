import { HttpStatus } from "@nestjs/common";
import {
  DomainValidationException,
  FilePolicyNotConfiguredException,
} from "../../errors/app.exception";
import { ErrorCodes } from "../../errors/error.codes";
import { WORKFLOW_OPERATION_MAP } from "../../workflow/workflow-operation-map";
import { getWorkflowDefinition } from "../../workflow/workflow-registry";
import { API_AUTHORIZATION_MAP } from "./api-authorization-map";
import { resolveDisclosurePolicy } from "./disclosure-policy";
import { OPERATION_ROLE_POLICIES } from "./operation-role-policy";
import { getRolePolicy } from "./role-policy";

const entry = (apiId: string) => {
  const found = API_AUTHORIZATION_MAP.find((op) => op.apiId === apiId);
  if (!found) throw new Error(`${apiId} missing`);
  return found;
};
const REPORT_OPS = [
  "API-RPT-001",
  "API-RPT-002",
  "API-RPT-003",
  "API-RPT-004",
  "API-RPT-005",
  "API-RPT-006",
  "API-RPT-007",
  "API-RPT-008",
  "API-RPT-009",
  "API-RPT-013",
];

describe("Wave 6B report authorization contract (API Contract v1.3, D6-6/D6-9)", () => {
  it("registers API-RPT-013 exactly as the approved operational discovery read", () => {
    expect(entry("API-RPT-013")).toMatchObject({
      method: "GET",
      path: "/assessments/{assessmentId}/reports",
      classification: "PERMISSION_PROTECTED",
      permissionKey: "report.prepare_review_assigned",
      roles: ["ROLE_CONSULTANT", "ROLE_ADMIN"],
      scope: ["ASG"],
      resourceContextRequired: true,
      authScopeRequired: false,
      workflowValidationRequired: false,
    });
    expect(OPERATION_ROLE_POLICIES["API-RPT-013"]).toEqual({
      ROLE_CONSULTANT: {
        scopes: ["ASG"],
        assignmentRequired: true,
        authScopeRequired: false,
        resourceContextRequired: true,
      },
      ROLE_ADMIN: {
        scopes: [],
        assignmentRequired: false,
        authScopeRequired: false,
        resourceContextRequired: false,
      },
    });
    expect(resolveDisclosurePolicy("report.prepare_review_assigned", "API-RPT-013", true)).toBe(
      "CONCEAL_EXISTENCE",
    );
    expect(API_AUTHORIZATION_MAP.filter((op) => op.path.endsWith("/reports"))).toHaveLength(3);
    expect(API_AUTHORIZATION_MAP.some((op) => op.path === "/reports")).toBe(false);
  });

  it("never requires AUTH_SCOPE on any report operation and never grants one to Business", () => {
    for (const apiId of REPORT_OPS) {
      const op = entry(apiId);
      expect(op.authScopeRequired).toBe(false);
      expect(op.scope).not.toContain("AUTH_SCOPE");
      expect(op.roles).not.toContain("ROLE_BUSINESS");
      for (const policy of Object.values(OPERATION_ROLE_POLICIES[apiId] ?? {})) {
        expect(policy?.scopes).not.toContain("AUTH_SCOPE");
        expect(policy?.authScopeRequired).toBe(false);
      }
    }
    // Score calculation keeps its AUTH_SCOPE requirement (D6-1).
    expect(OPERATION_ROLE_POLICIES["API-SCR-001"]?.ROLE_CONSULTANT?.scopes).toEqual([
      "ASG",
      "AUTH_SCOPE",
    ]);
    expect(OPERATION_ROLE_POLICIES["API-SCR-001"]?.ROLE_ADMIN?.scopes).toEqual(["AUTH_SCOPE"]);
  });

  it("keeps the Admin/Consultant separation of duties at the operation level", () => {
    expect(entry("API-RPT-005").roles).toEqual(["ROLE_CONSULTANT"]);
    expect(entry("API-RPT-007").roles).toEqual(["ROLE_CONSULTANT"]);
    expect(entry("API-RPT-008").roles).toEqual(["ROLE_ADMIN"]);
    expect(entry("API-RPT-009").roles).toEqual(["ROLE_ADMIN"]);
    for (const apiId of ["API-RPT-001", "API-RPT-002", "API-RPT-003", "API-RPT-004", "API-RPT-006"])
      expect(OPERATION_ROLE_POLICIES[apiId]?.ROLE_CONSULTANT?.scopes).toEqual(["ASG"]);
    // READY_FOR_RELEASE -> DRAFT needs report.release_client, which only Admin holds.
    expect(getRolePolicy("report.release_client", "ROLE_ADMIN")).toBeDefined();
    expect(getRolePolicy("report.release_client", "ROLE_CONSULTANT")).toBeUndefined();
  });

  it("maps API-RPT-006 to both documented return transitions and nothing else", () => {
    expect(WORKFLOW_OPERATION_MAP["API-RPT-006"]).toEqual({
      kind: "TRANSITION",
      entityType: "Report",
      transitionIds: ["WF-RPT-03", "WF-RPT-05"],
    });
    const transitions = getWorkflowDefinition("Report").transitions;
    expect(transitions.find((t) => t.id === "WF-RPT-03")).toMatchObject({
      from: ["IN_REVIEW"],
      to: "DRAFT",
    });
    expect(transitions.find((t) => t.id === "WF-RPT-05")).toMatchObject({
      from: ["READY_FOR_RELEASE"],
      to: "DRAFT",
    });
    expect(WORKFLOW_OPERATION_MAP["API-RPT-013"]).toBeUndefined();
  });

  it("exposes the documented Wave 6 error codes through the existing AppException model", () => {
    const gate = new FilePolicyNotConfiguredException();
    expect(gate.code).toBe(ErrorCodes.FILE_POLICY_NOT_CONFIGURED);
    expect(gate.code).toBe("FILE_POLICY_NOT_CONFIGURED");
    expect(gate.statusCode).toBe(HttpStatus.CONFLICT);
    const validation = new DomainValidationException();
    expect(validation.code).toBe("VALIDATION_ERROR");
    expect(validation.statusCode).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(validation.metadata).toBeUndefined();
  });
});
