import { evaluateRoleChange } from "./admin-accounts.service";

const ACTOR = "actor";
const TARGET = "target";

describe("evaluateRoleChange (Wave 7B D7)", () => {
  const base = { actorUserId: ACTOR, targetUserId: TARGET };

  it("allows an Admin to move a non-Business user between non-Business roles", () => {
    expect(
      evaluateRoleChange({
        ...base,
        currentRole: "ROLE_LEARNER",
        requestedRole: "ROLE_MENTOR",
        lockedAdminIds: [ACTOR],
      }),
    ).toBeNull();
    expect(
      evaluateRoleChange({
        ...base,
        currentRole: "ROLE_CONSULTANT",
        requestedRole: "ROLE_ADMIN",
        lockedAdminIds: [ACTOR],
      }),
    ).toBeNull();
  });

  it("rejects when the actor is no longer in the locked Admin set", () => {
    expect(
      evaluateRoleChange({
        ...base,
        currentRole: "ROLE_LEARNER",
        requestedRole: "ROLE_MENTOR",
        lockedAdminIds: [TARGET],
      }),
    ).toBe("actorNotAdmin");
  });

  it("never assigns or removes ROLE_BUSINESS", () => {
    expect(
      evaluateRoleChange({
        ...base,
        currentRole: "ROLE_LEARNER",
        requestedRole: "ROLE_BUSINESS",
        lockedAdminIds: [ACTOR],
      }),
    ).toBe("assignBusiness");
    expect(
      evaluateRoleChange({
        ...base,
        currentRole: "ROLE_BUSINESS",
        requestedRole: "ROLE_LEARNER",
        lockedAdminIds: [ACTOR],
      }),
    ).toBe("removeBusiness");
    expect(
      evaluateRoleChange({
        ...base,
        currentRole: "ROLE_BUSINESS",
        requestedRole: "ROLE_ADMIN",
        lockedAdminIds: [ACTOR],
      }),
    ).toBe("removeBusiness");
  });

  it("refuses to demote the last remaining Admin", () => {
    expect(
      evaluateRoleChange({
        actorUserId: TARGET,
        targetUserId: TARGET,
        currentRole: "ROLE_ADMIN",
        requestedRole: "ROLE_LEARNER",
        lockedAdminIds: [TARGET],
      }),
    ).toBe("lastAdmin");
  });

  it("allows demoting an Admin while another Admin remains", () => {
    expect(
      evaluateRoleChange({
        ...base,
        currentRole: "ROLE_ADMIN",
        requestedRole: "ROLE_CONSULTANT",
        lockedAdminIds: [ACTOR, TARGET],
      }),
    ).toBeNull();
  });
});
