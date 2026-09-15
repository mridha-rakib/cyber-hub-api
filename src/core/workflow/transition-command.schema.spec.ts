import { expectedStateVersionSchema, transitionCommandSchema } from "./transition-command.schema";

describe("transition-command.schema — Wave 0D-6 Phase 19/26 stateVersion validation", () => {
  it("accepts a valid positive integer stateVersion", () => {
    expect(expectedStateVersionSchema.safeParse(1).success).toBe(true);
    expect(expectedStateVersionSchema.safeParse(42).success).toBe(true);
  });

  it("rejects zero — versions begin at 1", () => {
    expect(expectedStateVersionSchema.safeParse(0).success).toBe(false);
  });

  it("rejects negative values", () => {
    expect(expectedStateVersionSchema.safeParse(-1).success).toBe(false);
  });

  it("rejects NaN", () => {
    expect(expectedStateVersionSchema.safeParse(Number.NaN).success).toBe(false);
  });

  it("rejects a float where an integer is required", () => {
    expect(expectedStateVersionSchema.safeParse(1.5).success).toBe(false);
  });

  it("rejects an arbitrary string", () => {
    expect(expectedStateVersionSchema.safeParse("1").success).toBe(false);
    expect(expectedStateVersionSchema.safeParse("not-a-version").success).toBe(false);
  });

  it("rejects undefined/missing", () => {
    expect(expectedStateVersionSchema.safeParse(undefined).success).toBe(false);
  });

  it("transitionCommandSchema rejects unknown extra fields (strict) — no client-controlled current/target state can be smuggled in", () => {
    const result = transitionCommandSchema.safeParse({
      expectedStateVersion: 1,
      status: "RELEASED",
      currentState: "DRAFT",
    });
    expect(result.success).toBe(false);
  });

  it("transitionCommandSchema accepts exactly {expectedStateVersion}", () => {
    const result = transitionCommandSchema.safeParse({ expectedStateVersion: 3 });
    expect(result.success).toBe(true);
  });
});
