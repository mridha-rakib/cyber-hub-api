import { Module } from "@nestjs/common";
import { AuthScopeEvaluator } from "./auth-scope-evaluator.service";
import { CLOCK, SystemClock } from "./clock";
import { SecurityScopeAuthorizationRepository } from "./security-scope-authorization.repository";

@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    SecurityScopeAuthorizationRepository,
    AuthScopeEvaluator,
  ],
  exports: [AuthScopeEvaluator],
})
export class AuthScopeModule {}
