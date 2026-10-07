import { Test, type TestingModule } from "@nestjs/testing";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseModule } from "../src/core/database/database.module";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { LoggerModule } from "../src/core/logger/logger.module";
import {
  consultingNotes,
  consultingRequests,
  employers,
  securityScopeAuthorizations,
  users,
} from "../src/infrastructure/database/schema";
import { ConsultingModule } from "../src/modules/consulting/consulting.module";
import { ConsultingNotesRepository } from "../src/modules/consulting/repositories/consulting-notes.repository";
import { ConsultingRequestsRepository } from "../src/modules/consulting/repositories/consulting-requests.repository";
import { ScopeAuthorizationsRepository } from "../src/modules/consulting/repositories/scope-authorizations.repository";

describe("Wave 4A consulting persistence — real PostgreSQL", () => {
  let moduleRef: TestingModule;
  let db: DatabaseConnection["db"];
  let requests: ConsultingRequestsRepository;
  let notes: ConsultingNotesRepository;
  let scopes: ScopeAuthorizationsRepository;

  const TEST_DOMAIN = "wave4a-consulting.test";
  let counter = 0;
  const uniqueEmail = (label: string) => `${label}-${Date.now()}-${counter++}@${TEST_DOMAIN}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, DatabaseModule, ConsultingModule],
    }).compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION).db;
    requests = moduleRef.get(ConsultingRequestsRepository);
    notes = moduleRef.get(ConsultingNotesRepository);
    scopes = moduleRef.get(ScopeAuthorizationsRepository);
  });

  afterAll(async () => {
    await db.execute(
      sql`delete from consulting_notes where consulting_request_id in (
        select id from consulting_requests where employer_id in (
          select id from employers where email like ${`%@${TEST_DOMAIN}`}
        )
      )`,
    );
    await db.execute(
      sql`delete from security_scope_authorizations where employer_id in (
        select id from employers where email like ${`%@${TEST_DOMAIN}`}
      )`,
    );
    await db.execute(
      sql`delete from consulting_requests where employer_id in (
        select id from employers where email like ${`%@${TEST_DOMAIN}`}
      )`,
    );
    await db.execute(sql`delete from users where email like ${`%@${TEST_DOMAIN}`}`);
    await db.execute(sql`delete from employers where email like ${`%@${TEST_DOMAIN}`}`);
    await moduleRef.close();
  });

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
        for (const inner of current.errors)
          if (inner instanceof Error) messages.push(inner.message);
      }
      current = (current as { cause?: unknown }).cause;
    }
    expect(messages.some((message) => pattern.test(message))).toBe(true);
  }

  async function seedEmployer(label: string) {
    const employerEmail = uniqueEmail(`${label}-employer`);
    const [employer] = await db
      .insert(employers)
      .values({ companyName: `${label} Ltd`, email: employerEmail, status: "ACTIVE" })
      .returning();
    return employer;
  }

  async function seedUser(
    label: string,
    role: "ROLE_BUSINESS" | "ROLE_CONSULTANT" | "ROLE_ADMIN",
    employerId?: string,
  ) {
    const email = uniqueEmail(label);
    const [user] = await db
      .insert(users)
      .values({
        name: label,
        email,
        emailNormalized: email.toLowerCase(),
        passwordHash: "not-a-real-hash",
        role,
        employerId: employerId ?? null,
      })
      .returning();
    return user;
  }

  async function seedRequest(label: string) {
    const employer = await seedEmployer(label);
    const business = await seedUser(`${label}-business`, "ROLE_BUSINESS", employer.id);
    const request = await requests.create(
      { employerId: employer.id, submittedByUserId: business.id },
      {
        companyDetails: { registeredName: employer.companyName },
        businessSize: "SMALL",
        securityConcern: "External attack surface",
        businessImpact: "Service interruption",
        requestedService: "WEBSITE_ASSESSMENT",
        environmentDetails: { summary: "Public web application" },
        contactInformation: { email: business.email },
      },
    );
    return { employer, business, request };
  }

  it("creates an ORG-owned request with source fields and server-owned SUBMITTED/version 1 state", async () => {
    const { employer, business, request } = await seedRequest("create");
    expect(request).toMatchObject({
      employerId: employer.id,
      submittedByUserId: business.id,
      status: "SUBMITTED",
      stateVersion: 1,
      assignedConsultantId: null,
      requestedService: "WEBSITE_ASSESSMENT",
    });
    expect((await requests.findOwn(employer.id)).map((row) => row.id)).toContain(request.id);
  });

  it("rejects values outside both exact consulting enums", async () => {
    const { employer, business } = await seedRequest("bad-enum-parent");
    await expectRejectionMatching(
      db.execute(sql`insert into consulting_requests
        (employer_id, submitted_by_user_id, company_details, business_size, security_concern,
         requested_service, contact_information, status)
        values (${employer.id}, ${business.id}, '{}'::jsonb, 'SMALL', 'x',
                'GENERIC_CONSULTING', '{}'::jsonb, 'SUBMITTED')`),
      /invalid input value for enum security_service_type/i,
    );
    await expectRejectionMatching(
      db.execute(sql`insert into consulting_requests
        (employer_id, submitted_by_user_id, company_details, business_size, security_concern,
         requested_service, contact_information, status)
        values (${employer.id}, ${business.id}, '{}'::jsonb, 'SMALL', 'x',
                'WEBSITE_ASSESSMENT', '{}'::jsonb, 'DRAFT')`),
      /invalid input value for enum consulting_status/i,
    );
  });

  it("has the source-defined request, note and scope indexes in PostgreSQL", async () => {
    const result = await db.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes
      where schemaname = 'public'
        and tablename in ('consulting_requests', 'consulting_notes', 'security_scope_authorizations')
    `);
    const indexes = new Map(result.rows.map((row) => [row.indexname, row.indexdef]));
    expect(indexes.get("consulting_requests_employer_status_submitted_idx")).toMatch(
      /submitted_at DESC/,
    );
    expect(indexes.has("consulting_requests_assigned_consultant_status_idx")).toBe(true);
    expect(indexes.has("consulting_requests_status_submitted_idx")).toBe(true);
    expect(indexes.get("consulting_notes_request_created_desc_idx")).toMatch(/created_at DESC/);
    expect(indexes.has("security_scope_authorizations_current_unique")).toBe(true);
  });

  it("inserts and lists internal notes newest-first and enforces both note FKs", async () => {
    const { request } = await seedRequest("notes");
    const consultant = await seedUser("notes-consultant", "ROLE_CONSULTANT");
    const older = await notes.create(request.id, consultant.id, "first internal note");
    await db
      .update(consultingNotes)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(consultingNotes.id, older.id));
    const newer = await notes.create(request.id, consultant.id, "second internal note");
    expect((await notes.listByRequest(request.id)).map((row) => row.id)).toEqual([
      newer.id,
      older.id,
    ]);
    await expectRejectionMatching(
      notes.create("00000000-0000-0000-0000-000000000000", consultant.id, "orphan"),
      /foreign key constraint/i,
    );
    await expectRejectionMatching(
      notes.create(request.id, "00000000-0000-0000-0000-000000000000", "orphan author"),
      /foreign key constraint/i,
    );
  });

  it("creates and transactionally supersedes monotonically versioned explicit scope", async () => {
    const { employer, business, request } = await seedRequest("scope-version");
    const first = await scopes.createNextVersion(
      { consultingRequestId: request.id, employerId: employer.id, confirmedByUserId: business.id },
      {
        authorizedTargets: ["app.example.test"],
        allowedActivities: ["WEBSITE_ASSESSMENT"],
        validFrom: new Date(Date.now() - 1_000),
      },
    );
    expect(first).toMatchObject({ versionNo: 1, isCurrent: true, restrictions: [] });

    const second = await scopes.createNextVersion(
      { consultingRequestId: request.id, employerId: employer.id, confirmedByUserId: business.id },
      {
        authorizedTargets: ["api.example.test"],
        allowedActivities: ["WEBSITE_ASSESSMENT"],
        restrictions: ["No denial-of-service testing"],
        validFrom: new Date(Date.now() - 1_000),
        validUntil: new Date(Date.now() + 60_000),
      },
    );
    expect(second).toMatchObject({ versionNo: 2, isCurrent: true });
    const [old] = await db
      .select()
      .from(securityScopeAuthorizations)
      .where(eq(securityScopeAuthorizations.id, first?.id ?? ""));
    expect(old.isCurrent).toBe(false);
    expect(old.supersededAt).toBeInstanceOf(Date);
    expect((await scopes.getCurrent(request.id, employer.id))?.id).toBe(second?.id);
    expect((await scopes.getCurrentValid(request.id, new Date(), employer.id))?.id).toBe(
      second?.id,
    );
  });

  it("rejects duplicate versions and two active current non-revoked authorizations", async () => {
    const { employer, business, request } = await seedRequest("scope-constraints");
    const base = {
      consultingRequestId: request.id,
      employerId: employer.id,
      authorizedTargets: ["one.example.test"],
      allowedActivities: ["WEBSITE_ASSESSMENT"],
      confirmedByUserId: business.id,
      confirmedAt: new Date(),
      validFrom: new Date(),
    };
    await db.insert(securityScopeAuthorizations).values({ ...base, versionNo: 1, isCurrent: true });
    await expectRejectionMatching(
      db.insert(securityScopeAuthorizations).values({ ...base, versionNo: 1, isCurrent: false }),
      /unique constraint/i,
    );
    await expectRejectionMatching(
      db.insert(securityScopeAuthorizations).values({ ...base, versionNo: 2, isCurrent: true }),
      /unique constraint/i,
    );

    // The source partial rule intentionally permits a revoked historical row
    // to retain is_current=true without counting as the active authorization.
    await db
      .update(securityScopeAuthorizations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(securityScopeAuthorizations.consultingRequestId, request.id),
          eq(securityScopeAuthorizations.versionNo, 1),
        ),
      );
    const [replacement] = await db
      .insert(securityScopeAuthorizations)
      .values({ ...base, versionNo: 2, isCurrent: true })
      .returning();
    expect(replacement.versionNo).toBe(2);
  });

  it("rejects cross-employer authorization and non-Business confirmation at the repository boundary", async () => {
    const owner = await seedRequest("scope-owner");
    const otherEmployer = await seedEmployer("scope-other");
    const otherBusiness = await seedUser("scope-other-business", "ROLE_BUSINESS", otherEmployer.id);
    const consultant = await seedUser("scope-wrong-role", "ROLE_CONSULTANT");
    const input = {
      authorizedTargets: ["app.example.test"],
      allowedActivities: ["WEBSITE_ASSESSMENT"],
      validFrom: new Date(),
    };
    await expect(
      scopes.createNextVersion(
        {
          consultingRequestId: owner.request.id,
          employerId: otherEmployer.id,
          confirmedByUserId: otherBusiness.id,
        },
        input,
      ),
    ).resolves.toBeNull();
    await expect(
      scopes.createNextVersion(
        {
          consultingRequestId: owner.request.id,
          employerId: owner.employer.id,
          confirmedByUserId: consultant.id,
        },
        input,
      ),
    ).resolves.toBeNull();
  });

  it("enforces scope parent FK and validity windows", async () => {
    const employer = await seedEmployer("scope-orphan");
    const business = await seedUser("scope-orphan-business", "ROLE_BUSINESS", employer.id);
    await expectRejectionMatching(
      db.insert(securityScopeAuthorizations).values({
        consultingRequestId: "00000000-0000-0000-0000-000000000000",
        employerId: employer.id,
        versionNo: 1,
        authorizedTargets: ["x"],
        allowedActivities: ["WEBSITE_ASSESSMENT"],
        confirmedByUserId: business.id,
        confirmedAt: new Date(),
        validFrom: new Date(),
      }),
      /foreign key constraint/i,
    );

    const owner = await seedRequest("scope-future");
    await scopes.createNextVersion(
      {
        consultingRequestId: owner.request.id,
        employerId: owner.employer.id,
        confirmedByUserId: owner.business.id,
      },
      {
        authorizedTargets: ["future.example.test"],
        allowedActivities: ["WEBSITE_ASSESSMENT"],
        validFrom: new Date(Date.now() + 60_000),
        validUntil: new Date(Date.now() + 120_000),
      },
    );
    expect(
      await scopes.getCurrentValid(owner.request.id, new Date(), owner.employer.id),
    ).toBeNull();
  });

  it("permits assignment only to a persisted ROLE_CONSULTANT and retains the FK", async () => {
    const { request, business } = await seedRequest("assignment");
    const consultant = await seedUser("assignment-consultant", "ROLE_CONSULTANT");
    expect(await requests.assignConsultant(request.id, business.id)).toBeNull();
    expect((await requests.assignConsultant(request.id, consultant.id))?.assignedConsultantId).toBe(
      consultant.id,
    );
    await expectRejectionMatching(
      db
        .update(consultingRequests)
        .set({ assignedConsultantId: "00000000-0000-0000-0000-000000000000" })
        .where(eq(consultingRequests.id, request.id)),
      /foreign key constraint/i,
    );
  });

  it("allows exactly one competing CAS transition and prevents stale overwrite/version regression", async () => {
    const { request } = await seedRequest("cas");
    const [first, second] = await Promise.all([
      requests.compareAndSetTransition(request.id, "SUBMITTED", "UNDER_REVIEW", 1),
      requests.compareAndSetTransition(request.id, "SUBMITTED", "UNDER_REVIEW", 1),
    ]);
    expect([first.outcome, second.outcome].sort()).toEqual(["CONFLICT", "UPDATED"]);
    expect(
      await requests.compareAndSetTransition(request.id, "UNDER_REVIEW", "ACCEPTED", 1),
    ).toMatchObject({ outcome: "CONFLICT" });
    expect(await requests.findById(request.id)).toMatchObject({
      status: "UNDER_REVIEW",
      stateVersion: 2,
    });
  });
});
