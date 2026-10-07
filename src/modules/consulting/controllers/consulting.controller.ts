import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ValidateUuidRouteParams } from "../../../common/decorators/validate-uuid-route-params.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import { requireEmployerId } from "../../career/current-employer.util";
import {
  type BusinessRequestListQuery,
  businessRequestListQuerySchema,
  type ConsultantAssignmentInput,
  type ConsultingRequestInput,
  consultantAssignmentInputSchema,
  consultingRequestInputSchema,
  type InternalNoteInput,
  internalNoteInputSchema,
  type NotesListQuery,
  notesListQuerySchema,
  type OperationalRequestListQuery,
  operationalRequestListQuerySchema,
  type ReasonTransitionInput,
  reasonTransitionInputSchema,
  type ScopeAuthorizationInputDto,
  scopeAuthorizationInputSchema,
  type TransitionInput,
  transitionInputSchema,
} from "../dto/consulting.dto";
import { ConsultingService } from "../services/consulting.service";

@Controller()
export class ConsultingController {
  constructor(private readonly consulting: ConsultingService) {}

  @AuthorizeOperation("API-CON-001")
  @Post("business/consulting-requests")
  @HttpCode(201)
  create(
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(consultingRequestInputSchema)) body: ConsultingRequestInput,
  ) {
    return this.consulting.create(requireEmployerId(principal), principal.userId, body);
  }

  @AuthorizeOperation("API-CON-002")
  @Get("business/consulting-requests")
  listOwn(
    @CurrentUser() principal: AuthPrincipal,
    @Query(new ValidationPipe(businessRequestListQuerySchema)) query: BusinessRequestListQuery,
  ) {
    return this.consulting.listOwn(requireEmployerId(principal), query);
  }

  @AuthorizeOperation("API-CON-003")
  @ValidateUuidRouteParams("requestId")
  @Get("business/consulting-requests/:requestId")
  getOwn(@Param("requestId") requestId: string) {
    return this.consulting.getOwn(requestId);
  }

  @AuthorizeOperation("API-CON-004")
  @ValidateUuidRouteParams("requestId")
  @Post("business/consulting-requests/:requestId/scope-authorizations")
  @HttpCode(201)
  createScope(
    @CurrentUser() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body(new ValidationPipe(scopeAuthorizationInputSchema)) body: ScopeAuthorizationInputDto,
  ) {
    return this.consulting.createScope(
      requestId,
      requireEmployerId(principal),
      principal.userId,
      body,
    );
  }

  @AuthorizeOperation("API-CON-005")
  @ValidateUuidRouteParams("requestId")
  @Get("business/consulting-requests/:requestId/scope-authorizations/current")
  getCurrentScope(@CurrentUser() principal: AuthPrincipal, @Param("requestId") requestId: string) {
    return this.consulting.getCurrentScope(requestId, requireEmployerId(principal));
  }

  @AuthorizeOperation("API-CON-006")
  @Get("consulting/requests")
  listOperational(
    @CurrentUser() principal: AuthPrincipal,
    @Query(new ValidationPipe(operationalRequestListQuerySchema))
    query: OperationalRequestListQuery,
  ) {
    return this.consulting.listOperational(principal, query);
  }

  @AuthorizeOperation("API-CON-007")
  @ValidateUuidRouteParams("requestId")
  @Get("consulting/requests/:requestId")
  getOperational(@Param("requestId") requestId: string) {
    return this.consulting.getOperational(requestId);
  }

  @AuthorizeOperation("API-CON-008")
  @ValidateUuidRouteParams("requestId")
  @Post("admin/consulting-requests/:requestId/assign-consultant")
  @HttpCode(200)
  assign(
    @Param("requestId") requestId: string,
    @Body(new ValidationPipe(consultantAssignmentInputSchema)) body: ConsultantAssignmentInput,
  ) {
    return this.consulting.assign(requestId, body.consultantUserId);
  }

  @AuthorizeOperation("API-CON-009")
  @ValidateUuidRouteParams("requestId")
  @Post("consulting/requests/:requestId/start-review")
  @HttpCode(200)
  startReview(
    @Param("requestId") requestId: string,
    @Body(new ValidationPipe(transitionInputSchema)) body: TransitionInput,
  ) {
    return this.consulting.startReview(requestId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-CON-010")
  @ValidateUuidRouteParams("requestId")
  @Post("consulting/requests/:requestId/accept")
  @HttpCode(200)
  accept(
    @Param("requestId") requestId: string,
    @Body(new ValidationPipe(transitionInputSchema)) body: TransitionInput,
  ) {
    return this.consulting.accept(requestId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-CON-011")
  @ValidateUuidRouteParams("requestId")
  @Post("consulting/requests/:requestId/decline")
  @HttpCode(200)
  decline(
    @CurrentUser() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body(new ValidationPipe(reasonTransitionInputSchema)) body: ReasonTransitionInput,
  ) {
    return this.consulting.decline(requestId, body.expectedStateVersion, body.reason, principal);
  }

  @AuthorizeOperation("API-CON-012")
  @ValidateUuidRouteParams("requestId")
  @Post("consulting/requests/:requestId/start-delivery")
  @HttpCode(200)
  startDelivery(
    @Param("requestId") requestId: string,
    @Body(new ValidationPipe(transitionInputSchema)) body: TransitionInput,
  ) {
    return this.consulting.startDelivery(requestId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-CON-013")
  @ValidateUuidRouteParams("requestId")
  @Post("consulting/requests/:requestId/complete")
  @HttpCode(200)
  complete(
    @Param("requestId") requestId: string,
    @Body(new ValidationPipe(transitionInputSchema)) body: TransitionInput,
  ) {
    return this.consulting.complete(requestId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-CON-014")
  @ValidateUuidRouteParams("requestId")
  @Get("consulting/requests/:requestId/notes")
  listNotes(
    @Param("requestId") requestId: string,
    @Query(new ValidationPipe(notesListQuerySchema)) query: NotesListQuery,
  ) {
    return this.consulting.listNotes(requestId, query);
  }

  @AuthorizeOperation("API-CON-015")
  @ValidateUuidRouteParams("requestId")
  @Post("consulting/requests/:requestId/notes")
  @HttpCode(201)
  createNote(
    @CurrentUser() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body(new ValidationPipe(internalNoteInputSchema)) body: InternalNoteInput,
  ) {
    return this.consulting.createNote(requestId, principal.userId, body.body);
  }
}
