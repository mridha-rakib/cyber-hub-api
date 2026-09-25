import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Redirect,
} from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { Public } from "../../../common/decorators/public.decorator";
import { RawResponse } from "../../../common/decorators/raw-response.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import { requireEmployerId } from "../current-employer.util";
import {
  type BusinessCareerListingInput,
  type BusinessCareerListingUpdateInput,
  businessCareerListingInputSchema,
  businessCareerListingUpdateSchema,
} from "../dto/business-career-listing.dto";
import {
  type ReasonTransitionInput,
  reasonTransitionSchema,
  type TransitionInput,
  transitionSchema,
} from "../dto/transition.dto";
import { CareerListingService } from "../services/career-listing.service";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(limit?: string): number {
  const parsed = limit ? Number.parseInt(limit, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseRemoteUk(value?: string): boolean | undefined {
  if (value === undefined) return undefined;
  return value === "true";
}

@Controller()
export class CareerListingsController {
  constructor(private readonly careerListingService: CareerListingService) {}

  @Public()
  @Get("career-listings")
  listPublished(
    @Query("type") type?: string,
    @Query("location") location?: string,
    @Query("level") level?: string,
    @Query("skill") skill?: string,
    @Query("remoteUk") remoteUk?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.careerListingService.listPublished({
      type,
      location,
      level,
      skill,
      remoteUk: parseRemoteUk(remoteUk),
      cursor,
      limit: clampLimit(limit),
    });
  }

  @Public()
  @Get("career-listings/:listingId")
  getPublished(@Param("listingId") listingId: string) {
    return this.careerListingService.getPublished(listingId);
  }

  @Public()
  @RawResponse()
  @Redirect()
  @Get("career-listings/:listingId/outbound")
  async getOutbound(@Param("listingId") listingId: string) {
    const url = await this.careerListingService.getOutboundUrl(listingId);
    return { url, statusCode: 302 };
  }

  @AuthorizeOperation("API-BIZCAR-001")
  @Post("business/career-listings")
  @HttpCode(201)
  create(
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(businessCareerListingInputSchema)) body: BusinessCareerListingInput,
  ) {
    return this.careerListingService.create(requireEmployerId(principal), principal.userId, body);
  }

  @AuthorizeOperation("API-BIZCAR-002")
  @Get("business/career-listings")
  listOwn(
    @CurrentUser() principal: AuthPrincipal,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.careerListingService.listOwn(requireEmployerId(principal), {
      status,
      cursor,
      limit: clampLimit(limit),
    });
  }

  @AuthorizeOperation("API-BIZCAR-003")
  @Get("business/career-listings/:listingId")
  getOwn(@Param("listingId") listingId: string) {
    return this.careerListingService.getOwn(listingId);
  }

  @AuthorizeOperation("API-BIZCAR-004")
  @Patch("business/career-listings/:listingId")
  update(
    @Param("listingId") listingId: string,
    @Body(new ValidationPipe(businessCareerListingUpdateSchema))
    body: BusinessCareerListingUpdateInput,
  ) {
    return this.careerListingService.update(listingId, body);
  }

  @AuthorizeOperation("API-BIZCAR-005")
  @HttpCode(200)
  @Post("business/career-listings/:listingId/resubmit")
  resubmit(
    @Param("listingId") listingId: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.careerListingService.resubmit(listingId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-BIZCAR-006")
  @HttpCode(200)
  @Post("business/career-listings/:listingId/close")
  close(
    @Param("listingId") listingId: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.careerListingService.close(listingId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-MOD-001")
  @Get("admin/career-listings")
  listAdmin(
    @Query("status") status?: string,
    @Query("employerId") employerId?: string,
    @Query("type") type?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.careerListingService.listAdmin({
      status,
      employerId,
      type,
      cursor,
      limit: clampLimit(limit),
    });
  }

  @AuthorizeOperation("API-MOD-CAR-01")
  @HttpCode(200)
  @Post("admin/career-listings/:id/start-review")
  startReview(
    @Param("id") id: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.careerListingService.startReview(id, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-MOD-CAR-02")
  @HttpCode(200)
  @Post("admin/career-listings/:id/publish")
  publish(
    @Param("id") id: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.careerListingService.publish(id, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-MOD-CAR-03")
  @HttpCode(200)
  @Post("admin/career-listings/:id/reject")
  reject(
    @Param("id") id: string,
    @Body(new ValidationPipe(reasonTransitionSchema)) body: ReasonTransitionInput,
  ) {
    return this.careerListingService.reject(id, body.expectedStateVersion, body.reason);
  }

  @AuthorizeOperation("API-MOD-CAR-04")
  @HttpCode(200)
  @Post("admin/career-listings/:id/close")
  adminClose(
    @Param("id") id: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.careerListingService.adminClose(id, body.expectedStateVersion);
  }
}
