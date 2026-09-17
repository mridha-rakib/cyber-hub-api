import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "../../modules/auth/auth.module";
import { CertificateModule } from "../../modules/certificate/certificate.module";
import { CertificateResourceResolver } from "../../modules/certificate/resolvers/certificate-resource.resolver";
import { InternshipModule } from "../../modules/internship/internship.module";
import { CompletionResourceResolver } from "../../modules/internship/resolvers/completion-resource.resolver";
import { InternshipResourceResolver } from "../../modules/internship/resolvers/internship-resource.resolver";
import { SubmissionResourceResolver } from "../../modules/internship/resolvers/submission-resource.resolver";
import { PortfolioModule } from "../../modules/portfolio/portfolio.module";
import { PortfolioResourceResolver } from "../../modules/portfolio/resolvers/portfolio-resource.resolver";
import { AuthScopeEvaluator } from "./authorization/auth-scope-evaluator.service";
import { AuthorizationAuditService } from "./authorization/authorization-audit.service";
import { CLOCK, SystemClock } from "./authorization/clock";
import { ConditionRegistry } from "./authorization/condition-registry";
import {
  RESOURCE_CONTEXT_RESOLVERS,
  ResourceContextResolverRegistry,
} from "./authorization/resource-context-resolver";
import { ScopeEvaluationService } from "./authorization/scope-evaluation.service";
import { SecurityScopeAuthorizationRepository } from "./authorization/security-scope-authorization.repository";
import { AuthGuard } from "./guards/auth.guard";
import { PermissionGuard } from "./guards/permission.guard";

/**
 * Central authorization/security wiring for the whole application.
 *
 * Registers AuthGuard and PermissionGuard as global `APP_GUARD` providers,
 * in this exact array order, so every route is protected by default:
 *
 *   1. AuthGuard       — establishes `request.principal` from the DB-backed
 *                         session, or allows straight through for
 *                         `@Public()` routes. Throws 401 otherwise.
 *   2. PermissionGuard — deny-by-default RBAC enforcement consuming the
 *                         principal AuthGuard set. See permission.guard.ts.
 *
 * Declaring both APP_GUARD entries in the same providers array (rather than
 * splitting them across modules) is deliberate: NestJS preserves provider
 * declaration order within one array for multi-providers, which is the only
 * ordering guarantee this Wave depends on — PermissionGuard must never run
 * before AuthGuard has had a chance to populate (or reject) the principal.
 * ThrottlerGuard remains registered separately in AppModule; its relative
 * order against these two is not security-relevant (it depends only on
 * request/IP metadata, never on the authenticated principal).
 *
 * `@Public()` opts a route out of authentication entirely (still consumed
 * by PermissionGuard's public-route check for defense in depth).
 * `@AuthenticatedOnly()` and `@RequirePermission(...)` classify every other
 * route — see permission.guard.ts for what happens when neither is present.
 */
@Module({
  imports: [AuthModule, InternshipModule, CertificateModule, PortfolioModule],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    // Factory provider: ConditionRegistry's constructor takes a plain
    // array, which Nest cannot resolve via implicit constructor-injection
    // reflection (arrays have no distinct runtime provider token). This
    // seeds it with the production DEFERRED-only condition catalogue — no
    // IMPLEMENTED conditions are registered here, by design.
    { provide: ConditionRegistry, useFactory: () => new ConditionRegistry() },
    // Wave 1/2: real resolvers for the "internship"/"submission"/
    // "completion"/"certificate"/"portfolio" permission domains, sourced
    // from each product module's exports. Nest has no `multi: true` for
    // plain providers, so — same pattern as ConditionRegistry above — this
    // is a factory composing an explicit array, not a re-declared empty
    // placeholder. Extending this list is the intended way for a future
    // product module to register its own resolver (see
    // `resource-context-resolver.ts`'s own doc comment).
    {
      provide: RESOURCE_CONTEXT_RESOLVERS,
      useFactory: (
        internship: InternshipResourceResolver,
        submission: SubmissionResourceResolver,
        completion: CompletionResourceResolver,
        certificate: CertificateResourceResolver,
        portfolio: PortfolioResourceResolver,
      ) => [internship, submission, completion, certificate, portfolio],
      inject: [
        InternshipResourceResolver,
        SubmissionResourceResolver,
        CompletionResourceResolver,
        CertificateResourceResolver,
        PortfolioResourceResolver,
      ],
    },
    ResourceContextResolverRegistry,
    // AUTH_SCOPE (Wave 0D-4B): real, DB-backed persistence chain. CLOCK is
    // bound to the real SystemClock in production; tests inject a
    // deterministic Clock directly into AuthScopeEvaluator without going
    // through this module.
    { provide: CLOCK, useClass: SystemClock },
    SecurityScopeAuthorizationRepository,
    AuthScopeEvaluator,
    ScopeEvaluationService,
    // Wave 0D-7: central authorization-decision audit write path. Reuses
    // AuthModule's existing AuditLogsRepository (now exported for this
    // purpose) and the globally-registered RequestContextService.
    AuthorizationAuditService,
  ],
})
export class SecurityModule {}
