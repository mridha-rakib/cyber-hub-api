import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { Public } from "../../../common/decorators/public.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import {
  portfolioAchievements,
  portfolioCertifications,
  portfolioEvidence,
  portfolioLinks,
  portfolioProjects,
  portfolioSkills,
} from "../../../infrastructure/database/schema";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  type PortfolioCertificateDisplayInput,
  type PortfolioCertificateDisplayUpdateInput,
  portfolioCertificateDisplaySchema,
  portfolioCertificateDisplayUpdateSchema,
} from "../dto/portfolio-certificate-display.dto";
import {
  type PortfolioAchievementInput,
  type PortfolioAchievementUpdateInput,
  type PortfolioCertificationInput,
  type PortfolioCertificationUpdateInput,
  type PortfolioEvidenceInput,
  type PortfolioEvidenceUpdateInput,
  type PortfolioLinkInput,
  type PortfolioLinkUpdateInput,
  type PortfolioProjectInput,
  type PortfolioProjectUpdateInput,
  type PortfolioSkillInput,
  type PortfolioSkillUpdateInput,
  portfolioAchievementSchema,
  portfolioAchievementUpdateSchema,
  portfolioCertificationSchema,
  portfolioCertificationUpdateSchema,
  portfolioEvidenceSchema,
  portfolioEvidenceUpdateSchema,
  portfolioLinkSchema,
  portfolioLinkUpdateSchema,
  portfolioProjectSchema,
  portfolioProjectUpdateSchema,
  portfolioSkillSchema,
  portfolioSkillUpdateSchema,
} from "../dto/portfolio-item.dto";
import {
  type PortfolioPublicationInput,
  portfolioPublicationSchema,
} from "../dto/portfolio-publication.dto";
import { PortfolioService } from "../services/portfolio.service";
import { PortfolioCertificateService } from "../services/portfolio-certificate.service";
import { PortfolioItemService } from "../services/portfolio-item.service";

@Controller()
export class PortfolioController {
  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly itemService: PortfolioItemService,
    private readonly certificateService: PortfolioCertificateService,
  ) {}

  @Public()
  @Get("portfolios/:publicSlug")
  getPublic(@Param("publicSlug") publicSlug: string) {
    return this.portfolioService.getPublicBySlug(publicSlug);
  }

  @AuthorizeOperation("API-PORT-002")
  @Get("me/portfolio")
  getOwn(@CurrentUser() principal: AuthPrincipal) {
    return this.portfolioService.getOwn(principal.userId);
  }

  @AuthorizeOperation("API-PORT-003")
  @Patch("me/portfolio/publication")
  updatePublication(
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioPublicationSchema)) body: PortfolioPublicationInput,
  ) {
    return this.portfolioService.updatePublication(principal.userId, body);
  }

  // --- Projects ---------------------------------------------------------
  @AuthorizeOperation("API-PORT-004")
  @Post("me/portfolio/projects")
  @HttpCode(201)
  createProject(
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioProjectSchema)) body: PortfolioProjectInput,
  ) {
    return this.itemService.create(portfolioProjects, principal.userId, body);
  }

  @AuthorizeOperation("API-PORT-005")
  @Patch("me/portfolio/projects/:itemId")
  updateProject(
    @Param("itemId") itemId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioProjectUpdateSchema)) body: PortfolioProjectUpdateInput,
  ) {
    return this.itemService.update(portfolioProjects, principal.userId, itemId, body);
  }

  @AuthorizeOperation("API-PORT-006")
  @Delete("me/portfolio/projects/:itemId")
  @HttpCode(204)
  async deleteProject(@Param("itemId") itemId: string, @CurrentUser() principal: AuthPrincipal) {
    await this.itemService.delete(portfolioProjects, principal.userId, itemId);
  }

  // --- Links --------------------------------------------------------------
  @AuthorizeOperation("API-PORT-007")
  @Post("me/portfolio/links")
  @HttpCode(201)
  createLink(
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioLinkSchema)) body: PortfolioLinkInput,
  ) {
    return this.itemService.create(portfolioLinks, principal.userId, body);
  }

  @AuthorizeOperation("API-PORT-008")
  @Patch("me/portfolio/links/:itemId")
  updateLink(
    @Param("itemId") itemId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioLinkUpdateSchema)) body: PortfolioLinkUpdateInput,
  ) {
    return this.itemService.update(portfolioLinks, principal.userId, itemId, body);
  }

  @AuthorizeOperation("API-PORT-009")
  @Delete("me/portfolio/links/:itemId")
  @HttpCode(204)
  async deleteLink(@Param("itemId") itemId: string, @CurrentUser() principal: AuthPrincipal) {
    await this.itemService.delete(portfolioLinks, principal.userId, itemId);
  }

  // --- Skills -------------------------------------------------------------
  @AuthorizeOperation("API-PORT-010")
  @Post("me/portfolio/skills")
  @HttpCode(201)
  createSkill(
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioSkillSchema)) body: PortfolioSkillInput,
  ) {
    return this.itemService.create(portfolioSkills, principal.userId, body);
  }

  @AuthorizeOperation("API-PORT-011")
  @Patch("me/portfolio/skills/:itemId")
  updateSkill(
    @Param("itemId") itemId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioSkillUpdateSchema)) body: PortfolioSkillUpdateInput,
  ) {
    return this.itemService.update(portfolioSkills, principal.userId, itemId, body);
  }

  @AuthorizeOperation("API-PORT-012")
  @Delete("me/portfolio/skills/:itemId")
  @HttpCode(204)
  async deleteSkill(@Param("itemId") itemId: string, @CurrentUser() principal: AuthPrincipal) {
    await this.itemService.delete(portfolioSkills, principal.userId, itemId);
  }

  // --- Certifications -------------------------------------------------------
  @AuthorizeOperation("API-PORT-013")
  @Post("me/portfolio/certifications")
  @HttpCode(201)
  createCertification(
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioCertificationSchema)) body: PortfolioCertificationInput,
  ) {
    return this.itemService.create(portfolioCertifications, principal.userId, body);
  }

  @AuthorizeOperation("API-PORT-014")
  @Patch("me/portfolio/certifications/:itemId")
  updateCertification(
    @Param("itemId") itemId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioCertificationUpdateSchema))
    body: PortfolioCertificationUpdateInput,
  ) {
    return this.itemService.update(portfolioCertifications, principal.userId, itemId, body);
  }

  @AuthorizeOperation("API-PORT-015")
  @Delete("me/portfolio/certifications/:itemId")
  @HttpCode(204)
  async deleteCertification(
    @Param("itemId") itemId: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    await this.itemService.delete(portfolioCertifications, principal.userId, itemId);
  }

  // --- Evidence -----------------------------------------------------------
  @AuthorizeOperation("API-PORT-016")
  @Post("me/portfolio/evidence")
  @HttpCode(201)
  createEvidence(
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioEvidenceSchema)) body: PortfolioEvidenceInput,
  ) {
    return this.itemService.create(portfolioEvidence, principal.userId, body);
  }

  @AuthorizeOperation("API-PORT-017")
  @Patch("me/portfolio/evidence/:itemId")
  updateEvidence(
    @Param("itemId") itemId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioEvidenceUpdateSchema)) body: PortfolioEvidenceUpdateInput,
  ) {
    return this.itemService.update(portfolioEvidence, principal.userId, itemId, body);
  }

  @AuthorizeOperation("API-PORT-018")
  @Delete("me/portfolio/evidence/:itemId")
  @HttpCode(204)
  async deleteEvidence(@Param("itemId") itemId: string, @CurrentUser() principal: AuthPrincipal) {
    await this.itemService.delete(portfolioEvidence, principal.userId, itemId);
  }

  // --- Achievements ---------------------------------------------------------
  @AuthorizeOperation("API-PORT-019")
  @Post("me/portfolio/achievements")
  @HttpCode(201)
  createAchievement(
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioAchievementSchema)) body: PortfolioAchievementInput,
  ) {
    return this.itemService.create(portfolioAchievements, principal.userId, body);
  }

  @AuthorizeOperation("API-PORT-020")
  @Patch("me/portfolio/achievements/:itemId")
  updateAchievement(
    @Param("itemId") itemId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioAchievementUpdateSchema))
    body: PortfolioAchievementUpdateInput,
  ) {
    return this.itemService.update(portfolioAchievements, principal.userId, itemId, body);
  }

  @AuthorizeOperation("API-PORT-021")
  @Delete("me/portfolio/achievements/:itemId")
  @HttpCode(204)
  async deleteAchievement(
    @Param("itemId") itemId: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    await this.itemService.delete(portfolioAchievements, principal.userId, itemId);
  }

  // --- Certificate display linking -----------------------------------------
  @AuthorizeOperation("API-PORT-022")
  @Put("me/portfolio/certificates/:certificateId")
  addOrUpdateCertificate(
    @Param("certificateId") certificateId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioCertificateDisplaySchema))
    body: PortfolioCertificateDisplayInput,
  ) {
    return this.certificateService.addOrUpdate(principal.userId, certificateId, body);
  }

  @AuthorizeOperation("API-PORT-023")
  @Patch("me/portfolio/certificates/:certificateId")
  updateCertificateDisplay(
    @Param("certificateId") certificateId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(portfolioCertificateDisplayUpdateSchema))
    body: PortfolioCertificateDisplayUpdateInput,
  ) {
    return this.certificateService.updateDisplay(principal.userId, certificateId, body);
  }

  @AuthorizeOperation("API-PORT-024")
  @Delete("me/portfolio/certificates/:certificateId")
  @HttpCode(204)
  async removeCertificate(
    @Param("certificateId") certificateId: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    await this.certificateService.remove(principal.userId, certificateId);
  }
}
