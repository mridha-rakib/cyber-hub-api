import { API_AUTHORIZATION_MAP } from "../security/authorization/api-authorization-map";
import { WORKFLOW_OPERATION_MAP } from "./workflow-operation-map";
import { WORKFLOW_REGISTRY } from "./workflow-registry";

describe("workflow-operation-map — Wave 0D-6 Phase 7 coverage validation", () => {
  const workflowSensitiveOps = API_AUTHORIZATION_MAP.filter((op) => op.workflowValidationRequired);

  it("recomputes the exact workflow-sensitive API operation count from the current source (not assumed)", () => {
    expect(workflowSensitiveOps.length).toBe(60);
  });

  it("every workflowValidationRequired operation resolves to exactly one mapping entry — unresolved count is zero", () => {
    const unresolved = workflowSensitiveOps.filter((op) => !WORKFLOW_OPERATION_MAP[op.apiId]);
    expect(unresolved.map((op) => op.apiId)).toEqual([]);
    expect(unresolved.length).toBe(0);
  });

  it("no operation that is NOT workflowValidationRequired accidentally has a mapping entry", () => {
    const nonWorkflowOps = API_AUTHORIZATION_MAP.filter((op) => !op.workflowValidationRequired);
    const accidental = nonWorkflowOps.filter((op) => WORKFLOW_OPERATION_MAP[op.apiId]);
    expect(accidental.map((op) => op.apiId)).toEqual([]);
  });

  it("every mapping key is a real member of the 209-operation API map", () => {
    const validApiIds = new Set(API_AUTHORIZATION_MAP.map((op) => op.apiId));
    for (const apiId of Object.keys(WORKFLOW_OPERATION_MAP)) {
      expect(validApiIds.has(apiId)).toBe(true);
    }
  });

  it("every TRANSITION mapping references a real entity type and real transition id(s) in the registry — no unknown transition IDs", () => {
    for (const [apiId, mapping] of Object.entries(WORKFLOW_OPERATION_MAP)) {
      if (mapping?.kind !== "TRANSITION") continue;
      const def = WORKFLOW_REGISTRY.get(mapping.entityType);
      expect(def).toBeDefined();
      for (const transitionId of mapping.transitionIds) {
        const found = def?.transitions.some((t) => t.id === transitionId);
        expect({ apiId, transitionId, found }).toMatchObject({ found: true });
      }
    }
  });

  it("every EDIT_GUARD mapping references a real entity type and every allowedState is a real state of that entity", () => {
    for (const [apiId, mapping] of Object.entries(WORKFLOW_OPERATION_MAP)) {
      if (mapping?.kind !== "EDIT_GUARD") continue;
      const def = WORKFLOW_REGISTRY.get(mapping.entityType);
      expect(def).toBeDefined();
      for (const state of mapping.allowedStates) {
        expect({ apiId, state, valid: def?.states.includes(state) }).toMatchObject({ valid: true });
      }
    }
  });

  it("no duplicate contradictory mapping — every apiId key appears exactly once (object keys are inherently unique; this proves no accidental overwrite by re-checking the source count matches entries)", () => {
    expect(Object.keys(WORKFLOW_OPERATION_MAP).length).toBe(60);
  });

  it("multi-candidate TRANSITION mappings (more than one transitionId) all target the same `to` state, so a single atomic CAS update is well-defined", () => {
    for (const [apiId, mapping] of Object.entries(WORKFLOW_OPERATION_MAP)) {
      if (mapping?.kind !== "TRANSITION" || mapping.transitionIds.length < 2) continue;
      const def = WORKFLOW_REGISTRY.get(mapping.entityType);
      const toStates = new Set(
        mapping.transitionIds.map((id) => def?.transitions.find((t) => t.id === id)?.to),
      );
      expect({ apiId, toStates: [...toStates] }).toMatchObject({ toStates: [expect.any(String)] });
    }
  });

  it("the exact API IDs flagged workflowValidationRequired exactly equal the exact API IDs with a mapping entry (bidirectional coverage)", () => {
    const flaggedIds = new Set(workflowSensitiveOps.map((op) => op.apiId));
    const mappedIds = new Set(Object.keys(WORKFLOW_OPERATION_MAP));
    expect(flaggedIds.size).toBe(mappedIds.size);
    for (const id of flaggedIds) expect(mappedIds.has(id)).toBe(true);
    for (const id of mappedIds) expect(flaggedIds.has(id)).toBe(true);
  });
});
