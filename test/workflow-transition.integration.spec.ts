import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { DatabaseModule } from "../src/core/database/database.module";
import { DATABASE_CONNECTION, type DatabaseConnection } from "../src/core/database/drizzle.config";
import { LoggerModule } from "../src/core/logger/logger.module";
import { ConsultingRequestWorkflowService } from "../src/core/workflow/consulting-request-workflow.service";
import { SecurityAssessmentWorkflowService } from "../src/core/workflow/security-assessment-workflow.service";
import { WorkflowModule } from "../src/core/workflow/workflow.module";
import {
  consultingRequests,
  employers,
  securityAssessments,
  securityScopeAuthorizations,
  users,
} from "../src/infrastructure/database/schema";

/**
 * Wave 0D-6 Phase 17/20/21/26. Real PostgreSQL integration tests for the
 * two currently-implemented, DB-backed workflow entities
 * (ConsultingRequest, SecurityAssessment). No HTTP layer is needed here —
 * this exercises the transition service/repository boundary directly,
 * against the real disposable local Postgres instance, per Phase 17's
 * "test-only integration routes or direct service tests" instruction.
 */
describe("Workflow transition CAS — real PostgreSQL integration (Wave 0D-6)", () => {
  let moduleRef: TestingModule;
  let db: DatabaseConnection["db"];
  let consultingService: ConsultingRequestWorkflowService;
  let assessmentService: SecurityAssessmentWorkflowService;

  const TEST_EMAIL_DOMAIN = "wave0d6-workflow.test";
  let emailCounter = 0;
  const uniqueEmail = (label: string) =>
    `${label}-${Date.now()}-${emailCounter++}@${TEST_EMAIL_DOMAIN}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, DatabaseModule, WorkflowModule],
    }).compile();

    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION).db;
    consultingService = moduleRef.get(ConsultingRequestWorkflowService);
    assessmentService = moduleRef.get(SecurityAssessmentWorkflowService);
  });

  afterAll(async () => {
    await db.execute(
      sql`delete from security_assessments where employer_id in (select id from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await db.execute(
      sql`delete from security_scope_authorizations where employer_id in (select id from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await db.execute(
      sql`delete from consulting_requests where employer_id in (select id from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`})`,
    );
    await db.execute(sql`delete from users where email like ${`%@${TEST_EMAIL_DOMAIN}`}`);
    await db.execute(sql`delete from employers where email like ${`%@${TEST_EMAIL_DOMAIN}`}`);
    await moduleRef.close();
  });

  async function seedEmployerAndUser(label: string) {
    const [employer] = await db
      .insert(employers)
      .values({
        companyName: `Workflow Co ${label}`,
        email: uniqueEmail(`${label}-employer`),
        status: "ACTIVE",
      })
      .returning({ id: employers.id });
    const userEmail = uniqueEmail(`${label}-user`);
    const [user] = await db
      .insert(users)
      .values({
        name: "Workflow Tester",
        email: userEmail,
        emailNormalized: userEmail.toLowerCase(),
        passwordHash: "not-a-real-hash",
        role: "ROLE_BUSINESS",
        verified: true,
        verifiedAt: new Date(),
        employerId: employer.id,
      })
      .returning({ id: users.id });
    return { employerId: employer.id, userId: user.id };
  }

  async function seedConsultingRequest(status: "SUBMITTED" | "UNDER_REVIEW" | "ACCEPTED") {
    const { employerId, userId } = await seedEmployerAndUser("con");
    const [row] = await db
      .insert(consultingRequests)
      .values({
        employerId,
        submittedByUserId: userId,
        companyDetails: { name: "Acme" },
        businessSize: "SMALL",
        securityConcern: "Vulnerability exposure",
        requestedService: "VULNERABILITY_ASSESSMENT",
        contactInformation: { email: "contact@acme.test" },
        status,
      })
      .returning({ id: consultingRequests.id, stateVersion: consultingRequests.stateVersion });
    return row;
  }

  async function seedSecurityAssessment(status: "PLANNED" | "IN_PROGRESS") {
    const { employerId, userId } = await seedEmployerAndUser("asm");
    const [cr] = await db
      .insert(consultingRequests)
      .values({
        employerId,
        submittedByUserId: userId,
        companyDetails: { name: "Acme" },
        businessSize: "SMALL",
        securityConcern: "Vulnerability exposure",
        requestedService: "VULNERABILITY_ASSESSMENT",
        contactInformation: { email: "contact@acme.test" },
        status: "IN_PROGRESS",
        assignedConsultantId: userId,
      })
      .returning({ id: consultingRequests.id });
    const [scope] = await db
      .insert(securityScopeAuthorizations)
      .values({
        consultingRequestId: cr.id,
        employerId,
        versionNo: 1,
        authorizedTargets: ["app.acme.test"],
        allowedActivities: ["VULNERABILITY_ASSESSMENT"],
        confirmedByUserId: userId,
        confirmedAt: new Date(),
        validFrom: new Date(Date.now() - 60_000),
        validUntil: null,
        isCurrent: true,
      })
      .returning({ id: securityScopeAuthorizations.id });
    const [row] = await db
      .insert(securityAssessments)
      .values({
        employerId,
        consultingRequestId: cr.id,
        scopeAuthorizationId: scope.id,
        service: "VULNERABILITY_ASSESSMENT",
        scopeSnapshot: { targets: ["app.acme.test"] },
        assignedConsultantId: userId,
        status,
      })
      .returning({ id: securityAssessments.id, stateVersion: securityAssessments.stateVersion });
    return row;
  }

  describe("ConsultingRequest — correct stateVersion", () => {
    it("succeeds and increments stateVersion by exactly 1", async () => {
      const seeded = await seedConsultingRequest("SUBMITTED");
      const result = await consultingService.transition({
        resourceId: seeded.id,
        transitionId: "WF-REQ-02",
        expectedStateVersion: seeded.stateVersion,
      });
      expect(result).toEqual({ outcome: "UPDATED", toState: "UNDER_REVIEW", newVersion: 2 });

      const [row] = await db
        .select({
          status: consultingRequests.status,
          stateVersion: consultingRequests.stateVersion,
        })
        .from(consultingRequests)
        .where(sql`${consultingRequests.id} = ${seeded.id}`);
      expect(row).toEqual({ status: "UNDER_REVIEW", stateVersion: 2 });
    });
  });

  describe("ConsultingRequest — stale stateVersion", () => {
    it("returns CONFLICT and leaves state/version unchanged", async () => {
      const seeded = await seedConsultingRequest("SUBMITTED");
      const result = await consultingService.transition({
        resourceId: seeded.id,
        transitionId: "WF-REQ-02",
        expectedStateVersion: seeded.stateVersion + 1, // stale/future version
      });
      expect(result.outcome).toBe("CONFLICT");

      const [row] = await db
        .select({
          status: consultingRequests.status,
          stateVersion: consultingRequests.stateVersion,
        })
        .from(consultingRequests)
        .where(sql`${consultingRequests.id} = ${seeded.id}`);
      expect(row).toEqual({ status: "SUBMITTED", stateVersion: 1 });
    });
  });

  describe("ConsultingRequest — negative/random version", () => {
    it("a negative expectedStateVersion never matches and returns CONFLICT (not a thrown error)", async () => {
      const seeded = await seedConsultingRequest("SUBMITTED");
      const result = await consultingService.transition({
        resourceId: seeded.id,
        transitionId: "WF-REQ-02",
        expectedStateVersion: -1,
      });
      expect(result.outcome).toBe("CONFLICT");
    });
  });

  describe("ConsultingRequest — invalid current state", () => {
    it("returns CONFLICT when the transition's FROM state does not match, even with the correct stateVersion", async () => {
      const seeded = await seedConsultingRequest("ACCEPTED"); // WF-REQ-02 only valid from SUBMITTED
      const result = await consultingService.transition({
        resourceId: seeded.id,
        transitionId: "WF-REQ-02",
        expectedStateVersion: seeded.stateVersion,
      });
      expect(result.outcome).toBe("CONFLICT");

      const [row] = await db
        .select({
          status: consultingRequests.status,
          stateVersion: consultingRequests.stateVersion,
        })
        .from(consultingRequests)
        .where(sql`${consultingRequests.id} = ${seeded.id}`);
      expect(row).toEqual({ status: "ACCEPTED", stateVersion: 1 });
    });
  });

  describe("ConsultingRequest — actual NOT_FOUND vs conflict distinction", () => {
    it("returns NOT_FOUND for a genuinely nonexistent id, never masquerading as a conflict", async () => {
      const result = await consultingService.transition({
        resourceId: "00000000-0000-0000-0000-000000000000",
        transitionId: "WF-REQ-02",
        expectedStateVersion: 1,
      });
      expect(result.outcome).toBe("NOT_FOUND");
    });
  });

  describe("ConsultingRequest — unknown/create-only transition fails closed", () => {
    it("rejects a create-only transition id (WF-REQ-01) attempted against an existing resource", async () => {
      const seeded = await seedConsultingRequest("SUBMITTED");
      const result = await consultingService.transition({
        resourceId: seeded.id,
        transitionId: "WF-REQ-01",
        expectedStateVersion: seeded.stateVersion,
      });
      expect(result.outcome).toBe("CONFLICT");
    });

    it("rejects a completely unknown transition id", async () => {
      const seeded = await seedConsultingRequest("SUBMITTED");
      const result = await consultingService.transition({
        resourceId: seeded.id,
        transitionId: "WF-NOT-REAL-001",
        expectedStateVersion: seeded.stateVersion,
      });
      expect(result.outcome).toBe("CONFLICT");
    });
  });

  describe("SecurityAssessment — multi-candidate cancel (WF-ASM-04/WF-ASM-05)", () => {
    it("resolves WF-ASM-04 (PLANNED -> CANCELLED) atomically", async () => {
      const seeded = await seedSecurityAssessment("PLANNED");
      const result = await assessmentService.transition({
        resourceId: seeded.id,
        transitionIds: ["WF-ASM-04", "WF-ASM-05"],
        expectedStateVersion: seeded.stateVersion,
      });
      expect(result).toEqual({ outcome: "UPDATED", toState: "CANCELLED", newVersion: 2 });
    });

    it("resolves WF-ASM-05 (IN_PROGRESS -> CANCELLED) atomically via the same candidate set", async () => {
      const seeded = await seedSecurityAssessment("IN_PROGRESS");
      const result = await assessmentService.transition({
        resourceId: seeded.id,
        transitionIds: ["WF-ASM-04", "WF-ASM-05"],
        expectedStateVersion: seeded.stateVersion,
      });
      expect(result).toEqual({ outcome: "UPDATED", toState: "CANCELLED", newVersion: 2 });
    });

    it("returns CONFLICT when the assessment is already COMPLETED (terminal — neither candidate applies)", async () => {
      const seeded = await seedSecurityAssessment("IN_PROGRESS");
      // Move it to COMPLETED first via the real transition path.
      const started = await assessmentService.transition({
        resourceId: seeded.id,
        transitionIds: ["WF-ASM-03"],
        expectedStateVersion: seeded.stateVersion,
      });
      expect(started.outcome).toBe("UPDATED");

      const result = await assessmentService.transition({
        resourceId: seeded.id,
        transitionIds: ["WF-ASM-04", "WF-ASM-05"],
        expectedStateVersion: 2,
      });
      expect(result.outcome).toBe("CONFLICT");
    });
  });

  describe("SecurityAssessment — successful transition increments version exactly once; failed transition does not increment", () => {
    it("PLANNED -> IN_PROGRESS via WF-ASM-02 increments stateVersion by exactly 1", async () => {
      const seeded = await seedSecurityAssessment("PLANNED");
      const result = await assessmentService.transition({
        resourceId: seeded.id,
        transitionIds: ["WF-ASM-02"],
        expectedStateVersion: seeded.stateVersion,
      });
      expect(result).toEqual({ outcome: "UPDATED", toState: "IN_PROGRESS", newVersion: 2 });
    });

    it("a failed (stale-version) attempt leaves stateVersion completely unchanged", async () => {
      const seeded = await seedSecurityAssessment("PLANNED");
      const result = await assessmentService.transition({
        resourceId: seeded.id,
        transitionIds: ["WF-ASM-02"],
        expectedStateVersion: 999,
      });
      expect(result.outcome).toBe("CONFLICT");

      const [row] = await db
        .select({ stateVersion: securityAssessments.stateVersion })
        .from(securityAssessments)
        .where(sql`${securityAssessments.id} = ${seeded.id}`);
      expect(row.stateVersion).toBe(1);
    });
  });

  describe("Concurrency — two concurrent identical-version transition attempts (Wave 0D-6 Phase 20)", () => {
    it("exactly one of two concurrent WF-ASM-02 attempts succeeds against the real DB; the other conflicts; final version is exactly N+1, never N+2", async () => {
      const seeded = await seedSecurityAssessment("PLANNED");
      expect(seeded.stateVersion).toBe(1);

      const [resultA, resultB] = await Promise.all([
        assessmentService.transition({
          resourceId: seeded.id,
          transitionIds: ["WF-ASM-02"],
          expectedStateVersion: 1,
        }),
        assessmentService.transition({
          resourceId: seeded.id,
          transitionIds: ["WF-ASM-02"],
          expectedStateVersion: 1,
        }),
      ]);

      const outcomes = [resultA.outcome, resultB.outcome].sort();
      expect(outcomes).toEqual(["CONFLICT", "UPDATED"]);

      const [row] = await db
        .select({
          status: securityAssessments.status,
          stateVersion: securityAssessments.stateVersion,
        })
        .from(securityAssessments)
        .where(sql`${securityAssessments.id} = ${seeded.id}`);
      expect(row).toEqual({ status: "IN_PROGRESS", stateVersion: 2 });
    });
  });
});
