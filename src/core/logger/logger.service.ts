import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { RequestContextService } from "../request-context/request-context.service";

export type LogCategory = "application" | "security" | "audit" | "billing";
export interface LogFields extends Record<string, unknown> {
  category?: LogCategory;
}

@Injectable()
export class LoggerService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly context: RequestContextService,
  ) {}
  info(message: string, fields: LogFields = {}) {
    this.logger.info(this.fields(fields), message);
  }
  log(message: string, fields: LogFields = {}) {
    this.info(message, fields);
  }
  warn(message: string, fields: LogFields = {}) {
    this.logger.warn(this.fields(fields), message);
  }
  error(message: string, fields: LogFields = {}) {
    this.logger.error(this.fields(fields), message);
  }
  debug(message: string, fields: LogFields = {}) {
    this.logger.debug(this.fields(fields), message);
  }
  private fields(fields: LogFields) {
    return { category: "application", ...fields, ...this.context.getContext() };
  }
}
