import { Module } from "@nestjs/common";
import { CertificatesRepository } from "../certificate/repositories/certificates.repository";
import { PortfolioController } from "./controllers/portfolio.controller";
import { PortfolioCertificatesRepository } from "./repositories/portfolio-certificates.repository";
import { PortfolioItemsRepository } from "./repositories/portfolio-items.repository";
import { PortfoliosRepository } from "./repositories/portfolios.repository";
import { PortfolioResourceResolver } from "./resolvers/portfolio-resource.resolver";
import { PortfolioService } from "./services/portfolio.service";
import { PortfolioCertificateService } from "./services/portfolio-certificate.service";
import { PortfolioItemService } from "./services/portfolio-item.service";

/**
 * Wave 2: Portfolio vertical slice. `portfolio.manage_own`/
 * `portfolio.publish_control_own`/`portfolio.public.read` all declare
 * `workflowValidationRequired: false` and `auditRequired: false` in the
 * API authorization map — this is plain owner-scoped CRUD, no workflow
 * foundation reuse needed and no manual audit call required beyond the
 * guard's own (dormant, since none of these ops are auditRequired)
 * automatic path.
 */
@Module({
  controllers: [PortfolioController],
  providers: [
    PortfoliosRepository,
    PortfolioItemsRepository,
    PortfolioCertificatesRepository,
    CertificatesRepository,
    PortfolioService,
    PortfolioItemService,
    PortfolioCertificateService,
    PortfolioResourceResolver,
  ],
  exports: [PortfolioResourceResolver],
})
export class PortfolioModule {}
