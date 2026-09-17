import { Injectable } from "@nestjs/common";
import { ConflictException, NotFoundException } from "../../../core/errors/app.exception";
import { OpaqueSecretService } from "../../../core/security/token/opaque-secret.service";
import { requireTransition } from "../../../core/workflow/workflow-helper";
import { UsersRepository } from "../../auth/repositories/users.repository";
import { InternshipEnrollmentsRepository } from "../../internship/repositories/internship-enrollments.repository";
import { InternshipsRepository } from "../../internship/repositories/internships.repository";
import type { CertificateIssueInput } from "../dto/certificate-issue.dto";
import { CertificatesRepository } from "../repositories/certificates.repository";

export interface ListParams {
  readonly cursor?: string;
  readonly limit: number;
}

/**
 * Public verification DTO — API Contract v1.1's `CertificatePublicVerificationView`:
 * "certificateNumber, status, issuedAt, recipientNameSnapshot,
 * programmeTitleSnapshot, completedSkills ... REVOKED is explicit. No
 * private account identifiers/PDF object key." No `userId`, `enrollmentId`,
 * or internal database id is ever included.
 */
export interface CertificatePublicVerificationView {
  certificateNumber: string;
  status: "ISSUED" | "REVOKED";
  issuedAt: Date;
  recipientNameSnapshot: string;
  programmeTitleSnapshot: string;
  completedSkills: string[];
}

@Injectable()
export class CertificateService {
  constructor(
    private readonly certificatesRepository: CertificatesRepository,
    private readonly enrollmentsRepository: InternshipEnrollmentsRepository,
    private readonly internshipsRepository: InternshipsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly opaqueSecretService: OpaqueSecretService,
  ) {}

  /** API-CER-003. */
  async listOwn(userId: string, params: ListParams) {
    return this.certificatesRepository.findOwnList(userId, params.cursor, params.limit);
  }

  /** API-CER-004. Defense in depth alongside the guard's own OWN/concealment enforcement. */
  async getOwn(id: string, userId: string) {
    const certificate = await this.certificatesRepository.findById(id);
    if (!certificate || certificate.userId !== userId) throw new NotFoundException();
    return certificate;
  }

  /**
   * API-CER-002 (UC-CERT-001). Eligibility is revalidated from the Wave 1
   * `internship_enrollments.completion_eligibility` gate — the one
   * authoritative source `CompletionService` already computes — never
   * re-derived here, and never trusted from the request body (only
   * `completedSkills` is client-supplied, a documented display field, not
   * a proof of eligibility). `UNIQUE(enrollment_id)` is the actual
   * duplicate-issuance guard; a concurrent second attempt gets a DB
   * constraint violation, caught and reported as 409, not a second valid
   * certificate.
   */
  async issue(enrollmentId: string, input: CertificateIssueInput) {
    const enrollment = await this.enrollmentsRepository.findById(enrollmentId);
    if (!enrollment) throw new NotFoundException();

    if (enrollment.completionEligibility !== "ELIGIBLE") {
      throw new ConflictException("This enrollment is not eligible for certificate issuance.");
    }

    const existing = await this.certificatesRepository.findByEnrollmentId(enrollmentId);
    if (existing) {
      throw new ConflictException("A certificate has already been issued for this enrollment.");
    }

    const [internship, user] = await Promise.all([
      this.internshipsRepository.findById(enrollment.internshipId),
      this.usersRepository.findById(enrollment.userId),
    ]);
    if (!internship || !user) throw new NotFoundException();

    requireTransition("Certificate", "WF-CERT-01");

    // Opaque, unguessable identifiers — the same secure-random convention
    // used for session/CSRF tokens, never a sequential row id (Wave 2
    // Phase 11).
    const certificateNumber = `CERT-${this.opaqueSecretService.generate(9).raw}`;
    const verificationPath = this.opaqueSecretService.generate(16).raw;

    try {
      return await this.certificatesRepository.create({
        userId: enrollment.userId,
        programmeId: enrollment.internshipId,
        enrollmentId,
        certificateNumber,
        verificationPath,
        status: "ISSUED",
        recipientNameSnapshot: user.name,
        programmeTitleSnapshot: internship.title,
        completedSkills: input.completedSkills,
        issuedAt: new Date(),
      });
    } catch (error) {
      // Concurrent duplicate issuance: the second writer loses the
      // UNIQUE(enrollment_id) race at the database, not at this
      // pre-check — surfaced as a safe, generic conflict.
      if (isUniqueViolation(error)) {
        throw new ConflictException("A certificate has already been issued for this enrollment.");
      }
      throw error;
    }
  }

  /**
   * API-CER-006 (UC-CERT-003). Technical transition only: Admin-only,
   * ISSUED -> REVOKED, reason required, record retained (never deleted).
   * GAP-015 (allowed-reason catalogue, additional approval workflow,
   * reinstatement policy) remains explicitly unresolved — this does not
   * validate `reason` against any fixed list, and there is no "unrevoke"
   * command, matching the source's own "governance gate" framing.
   */
  async revoke(id: string, revokedByUserId: string, reason: string) {
    const transition = requireTransition("Certificate", "WF-CERT-02");
    const updated = await this.certificatesRepository.revoke(
      id,
      transition.from,
      transition.to,
      revokedByUserId,
      reason,
    );
    if (updated) return updated;

    const current = await this.certificatesRepository.findById(id);
    if (!current) throw new NotFoundException();
    throw new ConflictException("This certificate has already been revoked.");
  }

  /**
   * API-CER-001 (UC-CERT-002). DB-backed: status is read fresh from the
   * `certificates` row on every call, never inferred from the identifier
   * alone. An unknown `verificationPath` and a genuinely-revoked
   * certificate are structurally different from the caller's point of
   * view (revoked certificates ARE found and explicitly reported as
   * REVOKED, per UC-CERT-002's "the record remains historically
   * verifiable" — only a truly nonexistent path 404s).
   */
  async verifyPublic(verificationPath: string): Promise<CertificatePublicVerificationView> {
    const certificate = await this.certificatesRepository.findByVerificationPath(verificationPath);
    if (!certificate) throw new NotFoundException();

    return {
      certificateNumber: certificate.certificateNumber,
      status: certificate.status,
      issuedAt: certificate.issuedAt,
      recipientNameSnapshot: certificate.recipientNameSnapshot,
      programmeTitleSnapshot: certificate.programmeTitleSnapshot,
      completedSkills: certificate.completedSkills,
    };
  }
}

/**
 * Postgres unique-violation is SQLSTATE 23505. Drizzle wraps the raw `pg`
 * driver error in its own error object and exposes the original as
 * `.cause` (see the query-error stack trace format), so both the
 * top-level and the nested `.cause` are checked here — never just one.
 */
function isUniqueViolation(error: unknown): boolean {
  const code = (candidate: unknown): string | undefined =>
    typeof candidate === "object" && candidate !== null && "code" in candidate
      ? String((candidate as { code: unknown }).code)
      : undefined;

  if (code(error) === "23505") return true;
  const cause = error instanceof Error ? error.cause : undefined;
  return code(cause) === "23505";
}
