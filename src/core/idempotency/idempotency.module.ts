import { Global, Module } from "@nestjs/common";
import { IdempotencyGuard } from "./idempotency.guard";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { IdempotencyService } from "./idempotency.service";
import { IDEMPOTENCY_STORAGE } from "./storage/idempotency-storage.interface";
import { InMemoryIdempotencyStorage } from "./storage/in-memory-idempotency.storage";

@Global()
@Module({
  providers: [
    IdempotencyService,
    IdempotencyGuard,
    IdempotencyInterceptor,
    {
      provide: IDEMPOTENCY_STORAGE,
      useClass: InMemoryIdempotencyStorage,
    },
  ],
  exports: [IdempotencyService, IdempotencyGuard, IdempotencyInterceptor],
})
export class IdempotencyModule {}
