import { Global, Module } from "@nestjs/common";
import { LoggerModule as NestPinoModule } from "nestjs-pino";
import { RequestContextModule } from "../request-context/request-context.module";
import { RequestContextService } from "../request-context/request-context.service";
import { createLoggerConfig } from "./logger.config";
import { LoggerService } from "./logger.service";

@Global()
@Module({
  imports: [
    NestPinoModule.forRootAsync({
      imports: [RequestContextModule],
      inject: [RequestContextService],
      useFactory: createLoggerConfig,
    }),
  ],
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
