import { WORKFLOW_REGISTRY } from "./workflow-registry";

describe("workflow-registry — Wave 0D-6 structural coverage", () => {
  it("defines exactly the 10 doc-grounded, state-machine-backed entities", () => {
    expect([...WORKFLOW_REGISTRY.keys()].sort()).toEqual(
      [
        "InternshipProgramme",
        "InternshipApplication",
        "Submission",
        "Certificate",
        "CareerListing",
        "EmployerOpportunity",
        "ConsultingRequest",
        "SecurityAssessment",
        "Finding",
        "Report",
        "MonitoringSubscription",
      ].sort(),
    );
  });

  it("every transition's `from` and `to` states are members of the entity's own `states` list", () => {
    for (const def of WORKFLOW_REGISTRY.values()) {
      for (const transition of def.transitions) {
        for (const from of transition.from) {
          expect(def.states).toContain(from);
        }
        expect(def.states).toContain(transition.to);
      }
    }
  });

  it("every terminal state is a member of the entity's own `states` list", () => {
    for (const def of WORKFLOW_REGISTRY.values()) {
      for (const terminal of def.terminalStates) {
        expect(def.states).toContain(terminal);
      }
    }
  });

  it("no transition has a terminal state in its `from` set unless explicitly documented (none currently are — every terminal state in this registry has zero outbound transitions)", () => {
    for (const def of WORKFLOW_REGISTRY.values()) {
      for (const transition of def.transitions) {
        for (const from of transition.from) {
          if (def.terminalStates.includes(from)) {
            throw new Error(
              `${def.entityType}: transition ${transition.id} lists terminal state "${from}" as a FROM state — terminal states must have zero documented outbound transitions`,
            );
          }
        }
      }
    }
  });

  it("no duplicate transition ids within a single entity", () => {
    for (const def of WORKFLOW_REGISTRY.values()) {
      const ids = def.transitions.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("no entity has an empty transitions or states list", () => {
    for (const def of WORKFLOW_REGISTRY.values()) {
      expect(def.states.length).toBeGreaterThan(0);
      expect(def.transitions.length).toBeGreaterThan(0);
    }
  });

  it("reports the exact, doc-verified state and transition counts per entity (Wave 0D-6 Phase 2 audit)", () => {
    const counts: Record<string, { states: number; transitions: number }> = {};
    for (const [entityType, def] of WORKFLOW_REGISTRY) {
      counts[entityType] = { states: def.states.length, transitions: def.transitions.length };
    }
    expect(counts).toEqual({
      InternshipProgramme: { states: 4, transitions: 4 },
      InternshipApplication: { states: 4, transitions: 4 },
      Submission: { states: 4, transitions: 5 },
      Certificate: { states: 2, transitions: 2 },
      CareerListing: { states: 5, transitions: 6 },
      EmployerOpportunity: { states: 5, transitions: 6 },
      ConsultingRequest: { states: 6, transitions: 6 },
      SecurityAssessment: { states: 4, transitions: 5 },
      Finding: { states: 3, transitions: 5 },
      Report: { states: 5, transitions: 7 },
      MonitoringSubscription: { states: 4, transitions: 7 },
    });
  });

  it("total named transitions across the entire registry is exactly 57 (11 entities — CareerListing and EmployerOpportunity are distinct persisted records sharing the same §5 moderation graph, so its 6 transitions are counted once per entity)", () => {
    let total = 0;
    for (const def of WORKFLOW_REGISTRY.values()) total += def.transitions.length;
    expect(total).toBe(57);
  });
});
