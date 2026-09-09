import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AppController } from "./app.controller";
import { appConfig } from "./core/config/app.config";
import { DatabaseModule } from "./core/database/database.module";
import { IdempotencyModule } from "./core/idempotency/idempotency.module";
import { LoggerModule } from "./core/logger/logger.module";
import { RequestContextMiddleware } from "./core/request-context/request-context.middleware";
import { RequestContextModule } from "./core/request-context/request-context.module";
import { SecurityModule } from "./core/security/security.module";

@Module({
  imports: [
    LoggerModule,
    RequestContextModule,
    DatabaseModule,
    SecurityModule,
    IdempotencyModule,
    ThrottlerModule.forRoot([
      {
        ttl: appConfig.rateLimit.ttlSeconds,
        limit: appConfig.rateLimit.maxRequests,
      },
    ]),
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
