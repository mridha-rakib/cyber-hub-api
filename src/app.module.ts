import {
  BadRequestException,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { json, type NextFunction, type Request, type Response, urlencoded } from "express";
import { appConfig } from "./core/config/app.config";
import { DatabaseModule } from "./core/database/database.module";
import { HealthModule } from "./core/health/health.module";
import { IdempotencyModule } from "./core/idempotency/idempotency.module";
import { LoggerModule } from "./core/logger/logger.module";
import { RequestContextModule } from "./core/request-context/request-context.module";
import { SecurityModule } from "./core/security/security.module";
import { EmailModule } from "./infrastructure/email/email.module";
import { AuthModule } from "./modules/auth/auth.module";

@Module({
  imports: [
    LoggerModule,
    RequestContextModule,
    DatabaseModule,
    SecurityModule,
    IdempotencyModule,
    HealthModule,
    EmailModule,
    AuthModule,
    ThrottlerModule.forRoot([
      {
        name: "default",
        ttl: appConfig.rateLimit.ttlSeconds * 1000,
        limit: appConfig.rateLimit.maxRequests,
      },
    ]),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    const parseJson = json({ limit: appConfig.requestBodyLimit });
    // Imported logger middleware must run before parsing can reject a request.
    consumer
      .apply(
        (req: Request, res: Response, next: NextFunction) => {
          parseJson(req, res, (error?: unknown) => {
            // SyntaxError messages can include excerpts from confidential bodies.
            next(error instanceof SyntaxError ? new BadRequestException("Malformed JSON") : error);
          });
        },
        urlencoded({ extended: true, limit: appConfig.requestBodyLimit }),
      )
      .forRoutes("{/*path}");
  }
}
