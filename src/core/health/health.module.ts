import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { LoggerModule } from "../logger/logger.module";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
