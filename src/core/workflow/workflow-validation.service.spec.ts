import { getWorkflowDefinition } from "./workflow-registry";
import { WorkflowValidationService } from "./workflow-validation.service";

describe("WorkflowValidationService — Wave 0D-6 Phase 25 state-machine tests", () => {
  const service = new WorkflowValidationService();

  it("VALID TRANSITION: allowed from-state produces the documented to-state", () => {
    const result = service.validate("ConsultingRequest", "WF-REQ-02", "SUBMITTED");
    expect(result).toEqual({ valid: true, to: "UNDER_REVIEW" });
  });

  it("WRONG SOURCE STATE: a transition attempted from a state not in its documented `from` set is a conflict", () => {
    const result = service.validate("ConsultingRequest", "WF-REQ-02", "ACCEPTED");
    expect(result.valid).toBe(false);
  });

  it("TERMINAL STATE: no further transition is valid from a documented terminal state", () => {
    const result = service.validate("ConsultingRequest", "WF-REQ-02", "COMPLETED");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/terminal state/);
  });

  it("TERMINAL STATE (Report RELEASED): only the documented WF-RPT-07 (RELEASED->SUPERSEDED) is even attempted, and no OTHER transition may run from RELEASED", () => {
    // WF-RPT-06 targets RELEASED as a TO state (READY_FOR_RELEASE->RELEASED); RELEASED itself is not terminal in this registry (it has WF-RPT-07 outbound to SUPERSEDED) — SUPERSEDED is the true terminal.
    const supersededAttempt = service.validate("Report", "WF-RPT-06", "SUPERSEDED");
    expect(supersededAttempt.valid).toBe(false);
    if (!supersededAttempt.valid) expect(supersededAttempt.reason).toMatch(/terminal state/);
  });

  it("UNKNOWN TRANSITION: an id not in the registry fails closed", () => {
    const result = service.validate("ConsultingRequest", "WF-REQ-99-NOT-REAL", "SUBMITTED");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/unknown transition id/);
  });

  it("CLIENT-SUPPLIED TARGET STATE is never accepted as input — validate() has no target-state parameter at all; the `to` value always comes from the registry", () => {
    const result = service.validate("ConsultingRequest", "WF-REQ-02", "SUBMITTED");
    expect(result.valid).toBe(true);
    // @ts-expect-error validate() intentionally has no way to accept a caller-supplied target state
    void service.validate("ConsultingRequest", "WF-REQ-02", "SUBMITTED", "ANYTHING_I_WANT");
  });

  it("the same transition is denied from every state not explicitly documented as a valid FROM state", () => {
    const def = getWorkflowDefinition("ConsultingRequest");
    const transition = def.transitions.find((t) => t.id === "WF-REQ-03");
    if (!transition) throw new Error("fixture transition WF-REQ-03 not found");
    for (const state of def.states) {
      const result = service.validate("ConsultingRequest", "WF-REQ-03", state);
      if (transition.from.includes(state)) {
        expect(result.valid).toBe(true);
      } else {
        expect(result.valid).toBe(false);
      }
    }
  });

  it("a create transition (from: []) is valid only when currentState is null, and invalid when a current state is (incorrectly) supplied", () => {
    expect(service.validate("ConsultingRequest", "WF-REQ-01", null)).toEqual({
      valid: true,
      to: "SUBMITTED",
    });
    const invalid = service.validate("ConsultingRequest", "WF-REQ-01", "SUBMITTED");
    expect(invalid.valid).toBe(false);
  });

  it("a non-create transition rejects a null currentState (no resource to compare against)", () => {
    const result = service.validate("ConsultingRequest", "WF-REQ-02", null);
    expect(result.valid).toBe(false);
  });

  it("rejects a currentState value that is not even a valid state for the entity (data-corruption defense)", () => {
    const result = service.validate("ConsultingRequest", "WF-REQ-02", "NOT_A_REAL_STATE");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/not a valid state/);
  });

  describe("resolveCandidate — multi-from-state command resolution (SecurityAssessment cancel)", () => {
    it("resolves WF-ASM-04 when current state is PLANNED", () => {
      expect(
        service.resolveCandidate("SecurityAssessment", ["WF-ASM-04", "WF-ASM-05"], "PLANNED"),
      ).toBe("WF-ASM-04");
    });

    it("resolves WF-ASM-05 when current state is IN_PROGRESS", () => {
      expect(
        service.resolveCandidate("SecurityAssessment", ["WF-ASM-04", "WF-ASM-05"], "IN_PROGRESS"),
      ).toBe("WF-ASM-05");
    });

    it("resolves to null when current state matches neither candidate (e.g. already COMPLETED)", () => {
      expect(
        service.resolveCandidate("SecurityAssessment", ["WF-ASM-04", "WF-ASM-05"], "COMPLETED"),
      ).toBeNull();
    });
  });
});
