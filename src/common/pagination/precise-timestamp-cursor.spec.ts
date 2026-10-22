import {
  buildPreciseCursorPage,
  decodePreciseCursor,
  encodePreciseCursor,
  PRECISE_CURSOR_KINDS,
  preciseLimitSchema,
} from "./precise-timestamp-cursor";

const ID = "22222222-2222-4222-8222-222222222222";
const T = "2026-10-20T08:00:00.123456Z";

describe("precise timestamp cursor (Wave 7A)", () => {
  it("round-trips microsecond timestamps without truncation", () => {
    const encoded = encodePreciseCursor(PRECISE_CURSOR_KINDS.auditLogs, { sortValue: T, id: ID });
    expect(decodePreciseCursor(encoded, PRECISE_CURSOR_KINDS.auditLogs)).toEqual({
      sortValue: T,
      id: ID,
    });
  });

  it("rejects a cursor issued for a different list", () => {
    const encoded = encodePreciseCursor(PRECISE_CURSOR_KINDS.adminUsers, { sortValue: T, id: ID });
    expect(decodePreciseCursor(encoded, PRECISE_CURSOR_KINDS.auditLogs)).toBeNull();
  });

  it("rejects malformed, tampered and non-canonical cursors", () => {
    const wrap = (value: unknown) =>
      Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const kind = PRECISE_CURSOR_KINDS.auditLogs;
    expect(decodePreciseCursor("", kind)).toBeNull();
    expect(decodePreciseCursor("not base64!", kind)).toBeNull();
    expect(decodePreciseCursor("x".repeat(600), kind)).toBeNull();
    expect(
      decodePreciseCursor(wrap({ v: 1, k: kind, t: "2026-10-20T08:00:00Z", i: ID }), kind),
    ).toBeNull();
    expect(decodePreciseCursor(wrap({ v: 1, k: kind, t: T, i: "1; drop table" }), kind)).toBeNull();
    expect(decodePreciseCursor(wrap({ v: 1, k: kind, t: T, i: ID, extra: 1 }), kind)).toBeNull();
    expect(decodePreciseCursor(wrap({ v: 2, k: kind, t: T, i: ID }), kind)).toBeNull();
  });

  it("drops the sentinel row and points the cursor at the last returned row", () => {
    const rows = [
      { id: "a", cursorSortValue: "2026-10-20T08:00:03.000001Z" },
      { id: "b", cursorSortValue: "2026-10-20T08:00:02.000001Z" },
      { id: "c", cursorSortValue: "2026-10-20T08:00:01.000001Z" },
    ];
    const page = buildPreciseCursorPage(rows, 2, PRECISE_CURSOR_KINDS.auditLogs);
    expect(page.data.map((row) => row.id)).toEqual(["a", "b"]);
    expect(page.meta.page.hasMore).toBe(true);
    const next = Buffer.from(page.meta.page.nextCursor as string, "base64url").toString("utf8");
    expect(JSON.parse(next)).toMatchObject({ t: "2026-10-20T08:00:02.000001Z", i: "b" });
    expect(buildPreciseCursorPage(rows, 3, PRECISE_CURSOR_KINDS.auditLogs).meta.page).toEqual({
      limit: 3,
      nextCursor: null,
      hasMore: false,
    });
  });

  it("defaults the limit to 25 and rejects 0, 101 and non-integers", () => {
    expect(preciseLimitSchema.parse(undefined)).toBe(25);
    expect(preciseLimitSchema.parse("100")).toBe(100);
    for (const bad of ["0", "101", "1000", "1.5", "-1", "abc"]) {
      expect(preciseLimitSchema.safeParse(bad).success).toBe(false);
    }
  });
});
