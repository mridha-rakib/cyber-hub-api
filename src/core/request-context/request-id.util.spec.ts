import { createRequestId } from "./request-id.util";

describe("createRequestId", () => {
  it("returns the incoming request id when present", () => {
    expect(createRequestId("req-123")).toBe("req-123");
  });

  it("generates a request id when none is supplied", () => {
    expect(createRequestId()).toEqual(expect.any(String));
  });
});
