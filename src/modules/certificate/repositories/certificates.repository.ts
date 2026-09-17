import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { certificates, type NewCertificate } from "../../../infrastructure/database/schema";

type CertificateStatusValue = NewCertificate["status"];

@Injectable()
export class CertificatesRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(certificates).where(eq(certificates.id, id)).limit(1);
    return row ?? null;
  }

  async findByVerificationPath(verificationPath: string) {
    const [row] = await this.db
      .select()
      .from(certificates)
      .where(eq(certificates.verificationPath, verificationPath))
      .limit(1);
    return row ?? null;
  }

  async findByEnrollmentId(enrollmentId: string) {
    const [row] = await this.db
      .select()
      .from(certificates)
      .where(eq(certificates.enrollmentId, enrollmentId))
      .limit(1);
    return row ?? null;
  }

  async findOwnList(userId: string, cursor: string | undefined, limit: number) {
    const conditions = [eq(certificates.userId, userId)];
    if (cursor) conditions.push(sql`${certificates.id} > ${cursor}`);
    return this.db
      .select()
      .from(certificates)
      .where(and(...conditions))
      .orderBy(desc(certificates.issuedAt))
      .limit(limit);
  }

  /** Insert only — WF-CERT-01 is a create transition; `UNIQUE(enrollment_id)` is the DB-level duplicate-issue guard. */
  async create(input: NewCertificate) {
    const [row] = await this.db.insert(certificates).values(input).returning();
    return row;
  }

  /**
   * Atomic CAS on `status` alone (no `state_version` column exists for
   * this table — see the DTO's doc comment). `allowedFromStates`/`toState`
   * still come from the Wave 0D-6 workflow registry
   * (`getWorkflowDefinition("Certificate")`), never hardcoded here.
   */
  async revoke(
    id: string,
    allowedFromStates: readonly string[],
    toState: string,
    revokedByUserId: string,
    reason: string,
  ) {
    const [row] = await this.db
      .update(certificates)
      .set({
        status: toState as CertificateStatusValue,
        revokedAt: new Date(),
        revokedByUserId,
        revocationReason: reason,
      })
      .where(
        and(
          eq(certificates.id, id),
          inArray(certificates.status, allowedFromStates as CertificateStatusValue[]),
        ),
      )
      .returning();
    return row ?? null;
  }
}
