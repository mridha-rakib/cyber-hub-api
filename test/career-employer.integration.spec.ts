import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { DatabaseModule } from "../src/core/database/database.module";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { LoggerModule } from "../src/core/logger/logger.module";
import {
  employerOpportunities,
  employers,
  jobs,
  users,
} from "../src/infrastructure/database/schema";

/**
 * Wave 3A Phase 23/27. Real PostgreSQL constraint verification for the two
 * new ERD §7.9/§7.10 tables — no HTTP layer, no business service, direct
 * repository-boundary inserts against the disposable local Postgres
 * instance, following the same pattern as
 * `workflow-transition.integration.spec.ts`.
 */
describe("Career + Employer persistence — real PostgreSQL constraints (Wave 3A)", () => {
  let moduleRef: TestingModule;
  let db: DatabaseConnection["db"];

  const TEST_EMAIL_DOMAIN = "wave3a-career-employer.test";
  let emailCounter = 0;
  const uniqueEmail = (label: string) =>
    `${label}-${Date.now()}-${emailCounter++}@${TEST_EMAIL_DOMAIN}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, DatabaseModule],
    }).compile();

    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION).db;
  });

  /**
   * drizzle-orm's node-postgres driver wraps the real `pg` error as
   * `.cause` (sometimes inside a nested `AggregateError`), so a plain
   * `.rejects.toThrow(/regex/)` against the outer "Failed query: ..."
   * message never sees the actual constraint-violation text. Walk the
   * cause chain (including AggregateError.errors) to find it.
   */
  async function expectRejectionMatching(promise: Promise<unknown>, pattern: RegExp) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);

    const messages: string[] = [];
    let current: unknown = caught;
    while (current instanceof Error) {
      messages.push(current.message);
      if (current instanceof AggregateError) {
        for (const inner of current.errors) {
          if (inner instanceof Error) messages.push(inner.message);
        }
      }
      current = (current as { cause?: unknown }).cause;
    }

    expect(messages.some((message) => pattern.test(message))).toBe(true);
  }

  afterAll(async () => {
    await db.execute(
      sql`delete from jobs where employer_id in (select id from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await db.execute(
      sql`delete from employer_opportunities where employer_id in (select id from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await db.execute(sql`delete from users where email like ${`%@${TEST_EMAIL_DOMAIN}`}`);
    await db.execute(sql`delete from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`}`);
    await moduleRef.close();
  });

  async function seedEmployerAndUser(label: string) {
    const [employer] = await db
      .insert(employers)
      .values({
        companyName: `Career Co ${label}`,
        email: uniqueEmail(`employer-${label}`),
        status: "ACTIVE",
      })
      .returning();

    const [user] = await db
      .insert(users)
      .values({
        name: `Business User ${label}`,
        email: uniqueEmail(`user-${label}`),
        emailNormalized: uniqueEmail(`user-${label}`).toLowerCase(),
        passwordHash: "not-a-real-hash",
        role: "ROLE_BUSINESS",
        employerId: employer.id,
      })
      .returning();

    return { employer, user };
  }

  describe("jobs", () => {
    it("accepts an external/admin-curated listing with employer_id and submitted_by_user_id both null", async () => {
      const [row] = await db
        .insert(jobs)
        .values({
          title: "External Curated Role",
          employerName: "External Co",
          location: "London",
          level: "Junior",
          skills: ["typescript"],
          applicationUrl: "https://example.test/apply",
          listingType: "JOB",
          status: "SUBMITTED",
        })
        .returning();

      expect(row.employerId).toBeNull();
      expect(row.submittedByUserId).toBeNull();
      expect(row.stateVersion).toBe(1);
      expect(row.remoteUk).toBe(false);

      await db.execute(sql`delete from jobs where id = ${row.id}`);
    });

    it("rejects an employer_id that does not reference a real employer row", async () => {
      await expectRejectionMatching(
        db.insert(jobs).values({
          title: "Bad FK Role",
          employerName: "Nonexistent Co",
          location: "London",
          level: "Junior",
          skills: ["typescript"],
          applicationUrl: "https://example.test/apply",
          listingType: "JOB",
          status: "SUBMITTED",
          employerId: "00000000-0000-0000-0000-000000000000",
        }),
        /foreign key constraint/i,
      );
    });

    it("rejects a listing_type value outside the documented enum", async () => {
      await expectRejectionMatching(
        db.execute(
          sql`insert into jobs (title, employer_name, location, level, skills, application_url, listing_type, status)
              values ('Bad Enum Role', 'Co', 'London', 'Junior', ARRAY['ts'], 'https://example.test', 'NOT_A_REAL_TYPE', 'SUBMITTED')`,
        ),
        /invalid input value for enum/i,
      );
    });

    it("rejects a row missing the required title column", async () => {
      await expectRejectionMatching(
        db.execute(
          sql`insert into jobs (employer_name, location, level, skills, application_url, listing_type, status)
              values ('Co', 'London', 'Junior', ARRAY['ts'], 'https://example.test', 'JOB', 'SUBMITTED')`,
        ),
        /null value in column "title"/i,
      );
    });

    it("accepts an employer-submitted listing owning FK to employers and users, defaulting state_version to 1", async () => {
      const { employer, user } = await seedEmployerAndUser("jobs-owned");

      const [row] = await db
        .insert(jobs)
        .values({
          title: "Employer Submitted Role",
          employerName: employer.companyName,
          employerId: employer.id,
          submittedByUserId: user.id,
          location: "Manchester",
          level: "Senior",
          skills: ["node", "postgres"],
          applicationUrl: "https://example.test/apply",
          listingType: "GRADUATE_ROLE",
          status: "SUBMITTED",
        })
        .returning();

      expect(row.employerId).toBe(employer.id);
      expect(row.submittedByUserId).toBe(user.id);
      expect(row.stateVersion).toBe(1);
    });
  });

  describe("employer_opportunities", () => {
    it("requires employer_id — every opportunity is ORG-owned, no external/admin-curated equivalent", async () => {
      await expectRejectionMatching(
        db.execute(
          sql`insert into employer_opportunities (created_by_user_id, type, title, description, status)
              values ('00000000-0000-0000-0000-000000000000', 'STUDENT_PROJECT', 'x', 'y', 'SUBMITTED')`,
        ),
        /null value in column "employer_id"/i,
      );
    });

    it("rejects a created_by_user_id that does not reference a real user row", async () => {
      const { employer } = await seedEmployerAndUser("opp-bad-fk");

      await expectRejectionMatching(
        db.insert(employerOpportunities).values({
          employerId: employer.id,
          createdByUserId: "00000000-0000-0000-0000-000000000000",
          type: "STUDENT_PROJECT",
          title: "Bad FK Opportunity",
          description: "desc",
          status: "SUBMITTED",
        }),
        /foreign key constraint/i,
      );
    });

    it("rejects a type value outside the documented enum", async () => {
      const { employer, user } = await seedEmployerAndUser("opp-bad-enum");

      await expectRejectionMatching(
        db.execute(
          sql`insert into employer_opportunities (employer_id, created_by_user_id, type, title, description, status)
              values (${employer.id}, ${user.id}, 'NOT_A_REAL_TYPE', 'x', 'y', 'SUBMITTED')`,
        ),
        /invalid input value for enum/i,
      );
    });

    it("accepts a minimal ORG-owned opportunity, defaulting state_version to 1 and leaving skills/requirements/application_url null", async () => {
      const { employer, user } = await seedEmployerAndUser("opp-owned");

      const [row] = await db
        .insert(employerOpportunities)
        .values({
          employerId: employer.id,
          createdByUserId: user.id,
          type: "INTERNSHIP_OPPORTUNITY",
          title: "Summer Internship",
          description: "desc",
          status: "SUBMITTED",
        })
        .returning();

      expect(row.employerId).toBe(employer.id);
      expect(row.createdByUserId).toBe(user.id);
      expect(row.stateVersion).toBe(1);
      expect(row.skills).toBeNull();
      expect(row.requirements).toBeNull();
      expect(row.applicationUrl).toBeNull();
    });
  });
});
