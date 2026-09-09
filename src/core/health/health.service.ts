import { type BeforeApplicationShutdown, Injectable } from "@nestjs/common";
import { appConfig } from "../config/app.config";
import { DatabaseService } from "../database/database.service";
import { LoggerService } from "../logger/logger.service";
import type { HealthResponse } from "./health.types";

@Injectable()
export class HealthService implements BeforeApplicationShutdown {
  private acceptingTraffic = true;

  constructor(
    private readonly database: DatabaseService,
    private readonly logger: LoggerService,
  ) {}

  async check(): Promise<HealthResponse | undefined> {
    if (!this.acceptingTraffic || !(await this.database.isHealthy())) return undefined;

    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      environment: appConfig.nodeEnv,
      services: { application: "healthy", database: "healthy" },
    };
  }

  beforeApplicationShutdown(signal?: string) {
    this.acceptingTraffic = false;
    this.logger.info("Application is draining", { signal });
  }
}
