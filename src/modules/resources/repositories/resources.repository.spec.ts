import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import type { TransactionManager } from "../../../core/database/transaction.manager";
import { commonFilters, ResourcesRepository, titleContains } from "./resources.repository";

/**
 * SQL-shape assertions rendered through drizzle's mock driver — no database
 * connection is ever made. These prove the query text/parameters; behaviour
 * against real PostgreSQL is covered by the database-backed e2e suite.
 */
describe("ResourcesRepository query construction", () => {
  const db = drizzle.mock();
  const tx = { getExecutor: () => db } as unknown as TransactionManager;
  const repo = new ResourcesRepository(tx);
  const dialect = new PgDialect();
  const cursor = {
    sortValue: "2026-10-24T08:00:00.123456Z",
    id: "11111111-1111-4111-8111-111111111111",
  };

  it("escapes LIKE metacharacters and binds the search as a parameter (literal, case-insensitive)", () => {
    const query = dialect.sqlToQuery(titleContains("50%_off\\x"));
    expect(query.sql).toBe('"resources"."title" ILIKE $1 ESCAPE \'\\\'');
    expect(query.params).toEqual(["%50\\%\\_off\\\\x%"]);
  });

  it("binds category, tag (array containment for the GIN index) and featured as parameters", () => {
    const parts = commonFilters({ category: "a'b", tag: "t", featured: true, limit: 25 }).map((c) =>
      dialect.sqlToQuery(c),
    );
    expect(parts.map((p) => p.sql)).toEqual([
      '"resources"."category" = $1',
      '"resources"."tags" @> $1',
      '"resources"."featured" = $1',
    ]);
    expect(parts.map((p) => p.params)).toEqual([["a'b"], ['{"t"}'], [true]]);
  });

  it("public list: PUBLISHED-only predicate, recent ordering with id tie-breaker, limit+1", () => {
    const { sql, params } = repo.publishedListQuery({ sort: "recent", limit: 25 }).toSQL();
    expect(sql).toContain('"resources"."status" = $1');
    expect(sql).toContain('"resources"."published_at" is not null');
    expect(sql).toMatch(
      /order by "resources"."published_at" desc, "resources"."id" desc limit \$\d+$/,
    );
    expect(params[0]).toBe("PUBLISHED");
    expect(params.at(-1)).toBe(26);
  });

  it("public list: featured ordering carries the full tuple, and the cursor continuation compares it", () => {
    const { sql, params } = repo
      .publishedListQuery({ sort: "featured", limit: 10, cursor: { ...cursor, featured: true } })
      .toSQL();
    expect(sql).toMatch(
      /order by "resources"."featured" desc, "resources"."published_at" desc, "resources"."id" desc/,
    );
    expect(sql).toContain(
      '("resources"."featured", "resources"."published_at", "resources"."id") < ($2, $3::timestamptz, $4::uuid)',
    );
    expect(params.slice(0, 4)).toEqual(["PUBLISHED", true, cursor.sortValue, cursor.id]);
  });

  it("public list: filters can never remove the PUBLISHED predicate", () => {
    const { sql, params } = repo
      .publishedListQuery({
        sort: "recent",
        limit: 5,
        q: "x",
        category: "c",
        tag: "t",
        featured: false,
        cursor,
      })
      .toSQL();
    expect(sql).toContain('"resources"."status" = $1');
    expect(params[0]).toBe("PUBLISHED");
    expect(sql).toContain('("resources"."published_at", "resources"."id") < (');
  });

  it("admin list: every state by default, optional status filter, createdAt/id ordering", () => {
    const all = repo.adminListQuery({ limit: 25 }).toSQL();
    expect(all.sql).not.toContain("where");
    expect(all.sql).toMatch(
      /order by "resources"."created_at" desc, "resources"."id" desc limit \$1$/,
    );
    const filtered = repo.adminListQuery({ limit: 25, status: "ARCHIVED", cursor }).toSQL();
    expect(filtered.sql).toContain('"resources"."status" = $1');
    expect(filtered.params[0]).toBe("ARCHIVED");
    expect(filtered.sql).toContain(
      '("resources"."created_at", "resources"."id") < ($2::timestamptz, $3::uuid)',
    );
  });
});

/**
 * Captures the SQL of the repository's real write/lock methods: a proxy over
 * the mock driver records `.toSQL()` when the repository awaits a builder and
 * resolves with zero rows instead of executing anything.
 */
function capturingRepository() {
  const captured: { sql: string; params: unknown[] }[] = [];
  type Builder = Record<string | symbol, unknown> & {
    toSQL: () => { sql: string; params: unknown[] };
  };
  const wrap = (builder: Builder): Builder =>
    new Proxy(builder, {
      get(target, prop) {
        if (prop === "then") {
          return (resolve: (rows: unknown[]) => void) => {
            captured.push(target.toSQL());
            resolve([]);
          };
        }
        const value = target[prop];
        return typeof value === "function"
          ? (...args: unknown[]) =>
              wrap((value as (...a: unknown[]) => Builder).apply(target, args))
          : value;
      },
    });
  const mock = drizzle.mock() as unknown as Builder;
  const db = new Proxy(mock, {
    get(target, prop) {
      const value = target[prop];
      return typeof value === "function"
        ? (...args: unknown[]) => wrap((value as (...a: unknown[]) => Builder).apply(target, args))
        : value;
    },
  });
  const tx = { getExecutor: () => db } as unknown as TransactionManager;
  return { repo: new ResourcesRepository(tx), captured };
}

describe("ResourcesRepository conditional writes (DB2-DEC-009)", () => {
  it("EDIT_GUARD update: id + allowed states + expected version; increments state_version; never sets status", async () => {
    const { repo, captured } = capturingRepository();
    expect(
      await repo.updateFields("id-1", ["DRAFT", "PUBLISHED", "ARCHIVED"], 4, { title: "t" }),
    ).toBeNull();
    const [{ sql, params }] = captured;
    expect(sql).toMatch(
      /^update "resources" set "title" = \$1, "state_version" = "resources"."state_version" \+ 1, "updated_at" = now\(\)/,
    );
    expect(sql).toContain(
      'where ("resources"."id" = $2 and "resources"."status" in ($3, $4, $5) and "resources"."state_version" = $6)',
    );
    expect(sql).not.toContain('"status" =');
    expect(params).toEqual(["t", "id-1", "DRAFT", "PUBLISHED", "ARCHIVED", 4]);
  });

  it("transition: sets the target status, server-time published_at only when publishing, state_version + 1", async () => {
    const { repo, captured } = capturingRepository();
    await repo.transition("id-1", ["DRAFT"], "PUBLISHED", 2, { setPublishedAtNow: true });
    await repo.transition("id-1", ["PUBLISHED"], "ARCHIVED", 3, { setPublishedAtNow: false });
    expect(captured[0].sql).toContain('"published_at" = now()');
    expect(captured[0].sql).toContain('"state_version" = "resources"."state_version" + 1');
    expect(captured[0].params).toEqual(["PUBLISHED", "id-1", "DRAFT", 2]);
    const archiveSet = captured[1].sql.slice(0, captured[1].sql.indexOf(" where "));
    expect(archiveSet).not.toContain("published_at"); // archive keeps publishedAt (WF-RES-03)
    expect(captured[1].params).toEqual(["ARCHIVED", "id-1", "PUBLISHED", 3]);
  });

  it("DELETE_GUARD delete: one conditional DELETE on id + allowed states + expected version, no increment", async () => {
    const { repo, captured } = capturingRepository();
    expect(await repo.deleteGuarded("id-1", ["DRAFT"], 7)).toBeNull();
    const [{ sql, params }] = captured;
    expect(sql).toMatch(
      /^delete from "resources" where \("resources"."id" = \$1 and "resources"."status" in \(\$2\) and "resources"."state_version" = \$3\)/,
    );
    expect(sql).not.toContain('state_version" + 1');
    expect(params).toEqual(["id-1", "DRAFT", 7]);
  });

  it("row lock uses SELECT ... FOR UPDATE; public detail filters PUBLISHED in SQL", async () => {
    const { repo, captured } = capturingRepository();
    await repo.lockById("id-1");
    await repo.findPublishedById("id-1");
    expect(captured[0].sql).toMatch(/for update/);
    expect(captured[1].sql).toContain('("resources"."id" = $1 and "resources"."status" = $2)');
    expect(captured[1].params).toEqual(["id-1", "PUBLISHED", 1]);
  });
});
