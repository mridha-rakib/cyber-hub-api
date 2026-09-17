import { Module } from "@nestjs/common";
import { OpaqueSecretService } from "../../core/security/token/opaque-secret.service";
import { UsersRepository } from "../auth/repositories/users.repository";
import { InternshipEnrollmentsRepository } from "../internship/repositories/internship-enrollments.repository";
import { InternshipsRepository } from "../internship/repositories/internships.repository";
import { CertificatesController } from "./controllers/certificates.controller";
import { CertificatesRepository } from "./repositories/certificates.repository";
import { CertificateResourceResolver } from "./resolvers/certificate-resource.resolver";
import { CertificateService } from "./services/certificate.service";

/**
 * Wave 2: Certificate vertical slice. Reuses Wave 1's
 * `InternshipEnrollmentsRepository`/`InternshipsRepository` directly (the
 * authoritative source of completion eligibility and programme data)
 * rather than duplicating a second read path, and Wave 0D's authorization/
 * workflow/audit foundations exactly as Internship does. Only
 * `CertificateResourceResolver` (domain `"certificate"`) is new
 * authorization surface — wired into `security.module.ts` the same way as
 * the three Internship resolvers.
 */
@Module({
  controllers: [CertificatesController],
  providers: [
    CertificatesRepository,
    InternshipEnrollmentsRepository,
    InternshipsRepository,
    UsersRepository,
    OpaqueSecretService,
    CertificateService,
    CertificateResourceResolver,
  ],
  exports: [CertificateResourceResolver],
})
export class CertificateModule {}
