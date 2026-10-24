import { API_AUTHORIZATION_MAP, type ApiId } from "../security/authorization/api-authorization-map";
import { ROLE_POLICIES } from "../security/authorization/role-policy";
import { getWorkflowOperationMapping, WORKFLOW_OPERATION_MAP } from "./workflow-operation-map";
import { getWorkflowDefinition, WORKFLOW_REGISTRY } from "./workflow-registry";
import { WorkflowValidationService } from "./workflow-validation.service";

/**
 * Wave 7C G4-A (N-01). Security-foundation contract for the Resource/Course
 * lifecycles: State & Workflow v1.3 §5A, API Contract v1.6 W7C-1..W7C-3/W7C-12.
 * Controllers/services do not exist yet (G4-B/C); this proves the metadata,
 * registry and operation mapping the guard + future services will consume.
 */
describe("Wave 7C Resource/Course workflow security foundation (N-01)", () => {
  const workflow = new WorkflowValidationService();
  const op = (apiId: string) => API_AUTHORIZATION_MAP.find((o) => o.apiId === apiId);

  const MUTATIONS = [
    "API-ADMRES-002",
    "API-ADMRES-003",
    "API-ADMRES-004",
    "API-ADMRES-005",
    "API-ADMCRS-002",
    "API-ADMCRS-003",
    "API-ADMCRS-004",
    "API-ADMCRS-005",
  ] as const;

  describe("authorization metadata", () => {
    it("flags the eight Resource/Course mutations plus Resource create (G4A-02); Course create and all reads stay unflagged", () => {
      const flagged = API_AUTHORIZATION_MAP.filter(
        (o) => /^API-ADM(RES|CRS)-/.test(o.apiId) && o.workflowValidationRequired,
      ).map((o) => o.apiId);
      expect(flagged.sort()).toEqual([...MUTATIONS, "API-ADMRES-001"].sort());
      expect(op("API-ADMRES-001")).toMatchObject({
        method: "POST",
        path: "/admin/resources",
        permissionKey: "resource.manage",
        roles: ["ROLE_ADMIN"],
        scope: [],
        workflowValidationRequired: true,
      });
      for (const id of ["API-ADMRES-006", "API-ADMRES-007"]) {
        expect(op(id)?.workflowValidationRequired).toBe(false);
      }
      for (const id of ["API-ADMCRS-001", "API-ADMCRS-006", "API-ADMCRS-007"]) {
        expect(op(id)?.workflowValidationRequired).toBe(false);
      }
    });

    it("keeps every other security attribute of the eight operations unchanged (ADMIN-only, exact permission, no scope widening)", () => {
      const expected: Record<string, [string, string]> = {
        "API-ADMRES-002": ["PATCH", "/admin/resources/{resourceId}"],
        "API-ADMRES-003": ["POST", "/admin/resources/{resourceId}/publish"],
        "API-ADMRES-004": ["POST", "/admin/resources/{resourceId}/archive"],
        "API-ADMRES-005": ["DELETE", "/admin/resources/{resourceId}"],
        "API-ADMCRS-002": ["PATCH", "/admin/courses/{courseId}"],
        "API-ADMCRS-003": ["POST", "/admin/courses/{courseId}/approve"],
        "API-ADMCRS-004": ["POST", "/admin/courses/{courseId}/reject"],
        "API-ADMCRS-005": ["DELETE", "/admin/courses/{courseId}"],
      };
      for (const id of MUTATIONS) {
        const o = op(id);
        expect(o).toMatchObject({
          method: expected[id][0],
          path: expected[id][1],
          requiresAuth: true,
          classification: "PERMISSION_PROTECTED",
          authorizationMode: "DIRECT_PERMISSION",
          permissionKey: id.startsWith("API-ADMRES") ? "resource.manage" : "course.manage_approve",
          additionalPermissionKeys: null,
          roles: ["ROLE_ADMIN"],
          scope: [],
          resourceContextRequired: true,
          assignmentRequired: false,
          authScopeRequired: false,
          workflowValidationRequired: true,
          auditRequired: true,
        });
      }
    });

    it("grants resource.manage and course.manage_approve to ROLE_ADMIN only", () => {
      expect(Object.keys(ROLE_POLICIES["resource.manage"])).toEqual(["ROLE_ADMIN"]);
      expect(Object.keys(ROLE_POLICIES["course.manage_approve"])).toEqual(["ROLE_ADMIN"]);
    });

    it("keeps the 210-operation registry intact with unique ids, and the 60 pre-Wave-7C workflow operations unchanged", () => {
      expect(API_AUTHORIZATION_MAP.length).toBe(210);
      expect(new Set(API_AUTHORIZATION_MAP.map((o) => o.apiId)).size).toBe(210);
      const wave7c = [...MUTATIONS, "API-ADMRES-001"] as readonly string[];
      const others = API_AUTHORIZATION_MAP.filter(
        (o) => o.workflowValidationRequired && !wave7c.includes(o.apiId),
      );
      expect(others.length).toBe(60);
      for (const o of others) expect(WORKFLOW_OPERATION_MAP[o.apiId]).toBeDefined();
    });
  });

  describe("Resource lifecycle (§5A.1)", () => {
    it("registers exactly DRAFT/PUBLISHED/ARCHIVED, no terminal state and only WF-RES-01..04", () => {
      const def = getWorkflowDefinition("Resource");
      expect(def.states).toEqual(["DRAFT", "PUBLISHED", "ARCHIVED"]);
      expect(def.terminalStates).toEqual([]);
      expect(def.transitions.map((t) => [t.id, [...t.from], t.to])).toEqual([
        ["WF-RES-01", [], "DRAFT"],
        ["WF-RES-02", ["DRAFT"], "PUBLISHED"],
        ["WF-RES-03", ["PUBLISHED"], "ARCHIVED"],
        ["WF-RES-04", ["ARCHIVED"], "PUBLISHED"],
      ]);
    });

    it.each([
      ["WF-RES-02", "DRAFT", "PUBLISHED"],
      ["WF-RES-03", "PUBLISHED", "ARCHIVED"],
      ["WF-RES-04", "ARCHIVED", "PUBLISHED"],
    ])("allows %s from %s to %s", (id, from, to) => {
      expect(workflow.validate("Resource", id, from)).toEqual({ valid: true, to });
    });

    it("creates DRAFT only as a create transition (no current state)", () => {
      expect(workflow.validate("Resource", "WF-RES-01", null)).toEqual({
        valid: true,
        to: "DRAFT",
      });
      expect(workflow.validate("Resource", "WF-RES-01", "DRAFT").valid).toBe(false);
    });

    it.each([
      ["DRAFT", "ARCHIVED"],
      ["PUBLISHED", "DRAFT"],
      ["ARCHIVED", "DRAFT"],
      ["PUBLISHED", "PUBLISHED"],
    ])("has no transition %s -> %s", (from, to) => {
      const def = getWorkflowDefinition("Resource");
      const any = def.transitions.some((t) => t.from.includes(from) && t.to === to);
      expect(any).toBe(false);
    });

    it("rejects publish/archive commands from the wrong state", () => {
      expect(workflow.validate("Resource", "WF-RES-02", "PUBLISHED").valid).toBe(false);
      expect(workflow.validate("Resource", "WF-RES-03", "DRAFT").valid).toBe(false);
      expect(workflow.validate("Resource", "WF-RES-04", "PUBLISHED").valid).toBe(false);
    });
  });

  describe("Course lifecycle (§5A.2)", () => {
    it("registers exactly DRAFT/APPROVED/REJECTED (no WITHDRAWN), no terminal state and only WF-CRS-01..05", () => {
      const def = getWorkflowDefinition("Course");
      expect(def.states).toEqual(["DRAFT", "APPROVED", "REJECTED"]);
      expect(def.states).not.toContain("WITHDRAWN");
      expect(def.terminalStates).toEqual([]);
      expect(def.transitions.map((t) => [t.id, [...t.from], t.to])).toEqual([
        ["WF-CRS-01", [], "DRAFT"],
        ["WF-CRS-02", ["DRAFT"], "APPROVED"],
        ["WF-CRS-03", ["REJECTED"], "APPROVED"],
        ["WF-CRS-04", ["DRAFT"], "REJECTED"],
        ["WF-CRS-05", ["APPROVED"], "REJECTED"],
      ]);
    });

    it.each([
      ["WF-CRS-02", "DRAFT", "APPROVED"],
      ["WF-CRS-03", "REJECTED", "APPROVED"],
      ["WF-CRS-04", "DRAFT", "REJECTED"],
      ["WF-CRS-05", "APPROVED", "REJECTED"],
    ])("allows %s from %s to %s", (id, from, to) => {
      expect(workflow.validate("Course", id, from)).toEqual({ valid: true, to });
    });

    it.each([
      ["APPROVED", "APPROVED"],
      ["REJECTED", "REJECTED"],
      ["APPROVED", "DRAFT"],
      ["REJECTED", "DRAFT"],
    ])("has no transition %s -> %s", (from, to) => {
      const def = getWorkflowDefinition("Course");
      expect(def.transitions.some((t) => t.from.includes(from) && t.to === to)).toBe(false);
    });

    it("rejects an unknown lifecycle state such as WITHDRAWN", () => {
      expect(workflow.validate("Course", "WF-CRS-05", "WITHDRAWN").valid).toBe(false);
    });
  });

  describe("operation mapping: transitions vs edit/delete policies", () => {
    it("maps edits to EDIT_GUARD and deletes to DELETE_GUARD, never to transition ids", () => {
      expect(WORKFLOW_OPERATION_MAP["API-ADMRES-002"]).toEqual({
        kind: "EDIT_GUARD",
        entityType: "Resource",
        allowedStates: ["DRAFT", "PUBLISHED", "ARCHIVED"],
      });
      expect(WORKFLOW_OPERATION_MAP["API-ADMRES-005"]).toEqual({
        kind: "DELETE_GUARD",
        entityType: "Resource",
        allowedStates: ["DRAFT"],
      });
      expect(WORKFLOW_OPERATION_MAP["API-ADMCRS-002"]).toEqual({
        kind: "EDIT_GUARD",
        entityType: "Course",
        allowedStates: ["DRAFT", "REJECTED"],
      });
      expect(WORKFLOW_OPERATION_MAP["API-ADMCRS-005"]).toEqual({
        kind: "DELETE_GUARD",
        entityType: "Course",
        allowedStates: ["DRAFT", "REJECTED"],
      });
      for (const id of ["API-ADMRES-002", "API-ADMRES-005", "API-ADMCRS-002", "API-ADMCRS-005"]) {
        expect(WORKFLOW_OPERATION_MAP[id as ApiId]).not.toHaveProperty("transitionIds");
      }
    });

    it("forbids direct edits and deletion of an APPROVED course and deletion of PUBLISHED/ARCHIVED resources", () => {
      const allowed = (id: string) => {
        const m = WORKFLOW_OPERATION_MAP[id as ApiId];
        return m && m.kind !== "TRANSITION" ? m.allowedStates : [];
      };
      expect(allowed("API-ADMCRS-002")).not.toContain("APPROVED");
      expect(allowed("API-ADMCRS-005")).not.toContain("APPROVED");
      expect(allowed("API-ADMRES-005")).not.toContain("PUBLISHED");
      expect(allowed("API-ADMRES-005")).not.toContain("ARCHIVED");
    });

    it.each([
      ["API-ADMRES-003", "DRAFT", "WF-RES-02"],
      ["API-ADMRES-003", "ARCHIVED", "WF-RES-04"],
      ["API-ADMRES-003", "PUBLISHED", null],
      ["API-ADMRES-004", "PUBLISHED", "WF-RES-03"],
      ["API-ADMRES-004", "DRAFT", null],
      ["API-ADMRES-004", "ARCHIVED", null],
      ["API-ADMCRS-003", "DRAFT", "WF-CRS-02"],
      ["API-ADMCRS-003", "REJECTED", "WF-CRS-03"],
      ["API-ADMCRS-003", "APPROVED", null],
      ["API-ADMCRS-004", "DRAFT", "WF-CRS-04"],
      ["API-ADMCRS-004", "APPROVED", "WF-CRS-05"],
      ["API-ADMCRS-004", "REJECTED", null],
    ])("%s from %s resolves to %s", (apiId, state, expected) => {
      const m = getWorkflowOperationMapping(apiId as ApiId);
      if (m?.kind !== "TRANSITION") throw new Error(`${apiId} is not a TRANSITION mapping`);
      expect(workflow.resolveCandidate(m.entityType, m.transitionIds, state)).toBe(expected);
    });

    it("introduces no invented transition ids, states or entity types", () => {
      const ids = [...WORKFLOW_REGISTRY.values()]
        .flatMap((d) => d.transitions.map((t) => t.id))
        .filter((id) => /^WF-(RES|CRS)-/.test(id));
      expect(ids.sort()).toEqual(
        [
          "WF-RES-01",
          "WF-RES-02",
          "WF-RES-03",
          "WF-RES-04",
          "WF-CRS-01",
          "WF-CRS-02",
          "WF-CRS-03",
          "WF-CRS-04",
          "WF-CRS-05",
        ].sort(),
      );
      for (const d of [getWorkflowDefinition("Resource"), getWorkflowDefinition("Course")]) {
        for (const forbidden of ["WITHDRAWN", "DELETED", "REMOVED"])
          expect(d.states).not.toContain(forbidden);
      }
    });
  });

  describe("default deny / safe failure", () => {
    it("has no mapping for unflagged or unknown operations", () => {
      expect(getWorkflowOperationMapping("API-ADMCRS-001")).toBeUndefined();
      expect(getWorkflowOperationMapping("API-ADMRES-006")).toBeUndefined();
      expect(getWorkflowOperationMapping("API-ADMCRS-007")).toBeUndefined();
      expect(getWorkflowOperationMapping("API-DOES-NOT-EXIST" as ApiId)).toBeUndefined();
    });

    it("never validates an unknown transition id or an unregistered entity", () => {
      expect(workflow.validate("Resource", "WF-RES-99", "DRAFT").valid).toBe(false);
      expect(workflow.validate("Course", "WF-RES-02", "DRAFT").valid).toBe(false);
      expect(workflow.resolveCandidate("Course", ["WF-CRS-99"], "DRAFT")).toBeNull();
      expect(() => getWorkflowDefinition("Bookmark" as never)).toThrow();
    });

    it("requires a current state for non-create transitions", () => {
      expect(workflow.validate("Resource", "WF-RES-02", null).valid).toBe(false);
      expect(workflow.validate("Course", "WF-CRS-02", null).valid).toBe(false);
    });
  });
});
