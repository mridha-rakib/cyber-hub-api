import { sanitizeLog, sanitizeText } from "./log-sanitizer";

describe("log sanitization", () => {
  it("redacts sensitive keys at arbitrary supported nesting without mutating input", () => {
    const input = {
      a: [
        {
          PASSWORD: "hidden",
          accessToken: "hidden",
          authorization: "hidden",
          cookie: "hidden",
          paymentSecret: "hidden",
          DATABASE_URL: "hidden",
        },
      ],
      safe: 42,
    };
    expect(JSON.stringify(sanitizeLog(input))).not.toContain("hidden");
    expect(input.a[0].PASSWORD).toBe("hidden");
    expect(sanitizeLog(input)).toHaveProperty("safe", 42);
  });
  it("handles circular structures and scrubs common credentials in diagnostic strings", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(sanitizeLog(value)).toEqual({ self: "[CIRCULAR]" });
    expect(
      sanitizeText("password=hidden Bearer hidden postgres://user:hidden@host/db"),
    ).not.toContain("hidden");
  });
});
