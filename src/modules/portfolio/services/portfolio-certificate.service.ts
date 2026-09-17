import { Injectable } from "@nestjs/common";
import { NotFoundException } from "../../../core/errors/app.exception";
import { CertificatesRepository } from "../../certificate/repositories/certificates.repository";
import type {
  PortfolioCertificateDisplayInput,
  PortfolioCertificateDisplayUpdateInput,
} from "../dto/portfolio-certificate-display.dto";
import { PortfolioCertificatesRepository } from "../repositories/portfolio-certificates.repository";
import { PortfoliosRepository } from "../repositories/portfolios.repository";

/**
 * API-PORT-022/023/024. Certificate linkage is verified server-side on
 * every call — "learner cannot link another user's certificate ... into
 * own portfolio" (Wave 2 Phase 23/24) is enforced here, not merely assumed
 * from the route.
 */
@Injectable()
export class PortfolioCertificateService {
  constructor(
    private readonly portfoliosRepository: PortfoliosRepository,
    private readonly portfolioCertificatesRepository: PortfolioCertificatesRepository,
    private readonly certificatesRepository: CertificatesRepository,
  ) {}

  /** API-PORT-022. Idempotent add. */
  async addOrUpdate(
    userId: string,
    certificateId: string,
    input: PortfolioCertificateDisplayInput,
  ) {
    const certificate = await this.assertOwnCertificate(userId, certificateId);
    const portfolio = await this.portfoliosRepository.getOrCreateForUser(userId);

    return this.portfolioCertificatesRepository.upsert({
      portfolioId: portfolio.id,
      certificateId: certificate.id,
      isPublic: input.isPublic,
      sortOrder: input.sortOrder,
    });
  }

  /** API-PORT-023. Display consent/order update only — never touches the underlying credential. */
  async updateDisplay(
    userId: string,
    certificateId: string,
    input: PortfolioCertificateDisplayUpdateInput,
  ) {
    await this.assertOwnCertificate(userId, certificateId);
    const portfolio = await this.portfoliosRepository.getOrCreateForUser(userId);

    const updated = await this.portfolioCertificatesRepository.update(
      portfolio.id,
      certificateId,
      input,
    );
    if (!updated) throw new NotFoundException();
    return updated;
  }

  /** API-PORT-024. Removes the portfolio display link only; the certificate itself is untouched. */
  async remove(userId: string, certificateId: string) {
    await this.assertOwnCertificate(userId, certificateId);
    const portfolio = await this.portfoliosRepository.getOrCreateForUser(userId);

    const deleted = await this.portfolioCertificatesRepository.delete(portfolio.id, certificateId);
    if (!deleted) throw new NotFoundException();
  }

  private async assertOwnCertificate(userId: string, certificateId: string) {
    const certificate = await this.certificatesRepository.findById(certificateId);
    if (!certificate) throw new NotFoundException();
    if (certificate.userId !== userId) {
      // Concealed rather than a plain 403: same reasoning as
      // certificate.read_own (CONCEAL_EXISTENCE) — confirming that a
      // specific certificate id belongs to someone else would itself leak
      // private ownership information.
      throw new NotFoundException();
    }
    return certificate;
  }
}
