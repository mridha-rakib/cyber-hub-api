import { appConfig } from "@core/config/app.config";
import { Injectable, type LoggerService as NestLoggerService } from "@nestjs/common";
import pino, { type Logger } from "pino";

const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "password",
  "*.password",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "payment",
  "*.payment",
  "card",
  "*.card",
];

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: Logger;

  constructor() {
    this.logger = pino({
      level: appConfig.logLevel,
      timestamp: pino.stdTimeFunctions.isoTime,
      transport: appConfig.isProduction
        ? undefined
        : {
            target: "pino-pretty",
            options: {
              colorize: true,
              singleLine: true,
              translateTime: "SYS:standard",
            },
          },
      redact: {
        paths: REDACTED_PATHS,
        censor: "[REDACTED]",
      },
    });
  }

  log(message: string, context?: unknown) {
    this.logger.info({ context }, message);
  }

  warn(message: string, context?: unknown) {
    this.logger.warn({ context }, message);
  }

  error(message: string, trace?: string, context?: unknown) {
    this.logger.error({ context, trace }, message);
  }

  debug(message: string, context?: unknown) {
    this.logger.debug({ context }, message);
  }

  verbose(message: string, context?: unknown) {
    this.logger.trace({ context }, message);
  }

  child(bindings: Record<string, unknown>): Logger {
    return this.logger.child(bindings);
  }
}
