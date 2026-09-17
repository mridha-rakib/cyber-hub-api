import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  certificates,
  type NewPortfolioCertificate,
  portfolioCertificates,
} from "../../../infrastructure/database/schema";

@Injectable()
export class PortfolioCertificatesRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findByPortfolio(portfolioId: string) {
    return this.db
      .select()
      .from(portfolioCertificates)
      .where(eq(portfolioCertificates.portfolioId, portfolioId))
      .orderBy(portfolioCertificates.sortOrder);
  }

  async findPublicByPortfolio(portfolioId: string) {
    return this.db
      .select()
      .from(portfolioCertificates)
      .where(
        and(
          eq(portfolioCertificates.portfolioId, portfolioId),
          eq(portfolioCertificates.isPublic, true),
        ),
      )
      .orderBy(portfolioCertificates.sortOrder);
  }

  /**
   * Public display join: only the same allowlisted fields
   * `CertificatePublicVerificationView` exposes elsewhere — never the
   * certificate's internal id/userId/enrollmentId. `status` is always
   * included as-is (including REVOKED) — a revoked certificate must never
   * be silently hidden and re-presented as if it simply weren't linked
   * (Wave 2 Phase 24: "Public portfolio must never present a revoked
   * certificate as valid").
   */
  async findPublicByPortfolioWithCertificateData(portfolioId: string) {
    return this.db
      .select({
        sortOrder: portfolioCertificates.sortOrder,
        addedAt: portfolioCertificates.addedAt,
        certificateNumber: certificates.certificateNumber,
        verificationPath: certificates.verificationPath,
        status: certificates.status,
        issuedAt: certificates.issuedAt,
        recipientNameSnapshot: certificates.recipientNameSnapshot,
        programmeTitleSnapshot: certificates.programmeTitleSnapshot,
        completedSkills: certificates.completedSkills,
      })
      .from(portfolioCertificates)
      .innerJoin(certificates, eq(certificates.id, portfolioCertificates.certificateId))
      .where(
        and(
          eq(portfolioCertificates.portfolioId, portfolioId),
          eq(portfolioCertificates.isPublic, true),
        ),
      )
      .orderBy(portfolioCertificates.sortOrder);
  }

  /** Own private view — every linked certificate regardless of its display isPublic flag. */
  async findByPortfolioWithCertificateData(portfolioId: string) {
    return this.db
      .select({
        certificateId: portfolioCertificates.certificateId,
        isPublic: portfolioCertificates.isPublic,
        sortOrder: portfolioCertificates.sortOrder,
        addedAt: portfolioCertificates.addedAt,
        certificateNumber: certificates.certificateNumber,
        verificationPath: certificates.verificationPath,
        status: certificates.status,
        issuedAt: certificates.issuedAt,
        programmeTitleSnapshot: certificates.programmeTitleSnapshot,
        completedSkills: certificates.completedSkills,
      })
      .from(portfolioCertificates)
      .innerJoin(certificates, eq(certificates.id, portfolioCertificates.certificateId))
      .where(eq(portfolioCertificates.portfolioId, portfolioId))
      .orderBy(portfolioCertificates.sortOrder);
  }

  async findOne(portfolioId: string, certificateId: string) {
    const [row] = await this.db
      .select()
      .from(portfolioCertificates)
      .where(
        and(
          eq(portfolioCertificates.portfolioId, portfolioId),
          eq(portfolioCertificates.certificateId, certificateId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** API-PORT-022 is documented idempotent ("Idempotently add") — an upsert on the composite PK. */
  async upsert(input: NewPortfolioCertificate) {
    const [row] = await this.db
      .insert(portfolioCertificates)
      .values(input)
      .onConflictDoUpdate({
        target: [portfolioCertificates.portfolioId, portfolioCertificates.certificateId],
        set: { isPublic: input.isPublic, sortOrder: input.sortOrder },
      })
      .returning();
    return row;
  }

  async update(
    portfolioId: string,
    certificateId: string,
    patch: Partial<NewPortfolioCertificate>,
  ) {
    const [row] = await this.db
      .update(portfolioCertificates)
      .set(patch)
      .where(
        and(
          eq(portfolioCertificates.portfolioId, portfolioId),
          eq(portfolioCertificates.certificateId, certificateId),
        ),
      )
      .returning();
    return row ?? null;
  }

  async delete(portfolioId: string, certificateId: string): Promise<boolean> {
    const rows = await this.db
      .delete(portfolioCertificates)
      .where(
        and(
          eq(portfolioCertificates.portfolioId, portfolioId),
          eq(portfolioCertificates.certificateId, certificateId),
        ),
      )
      .returning({ portfolioId: portfolioCertificates.portfolioId });
    return rows.length > 0;
  }
}
