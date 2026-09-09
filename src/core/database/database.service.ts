import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../infrastructure/database/schema";
import { appConfig } from "../config/app.config";
import { LoggerService } from "../logger/logger.service";
import type { DatabaseConnection } from "./drizzle.config";

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly pool: Pool;
  readonly connection: DatabaseConnection;

  constructor(private readonly logger: LoggerService) {
    this.pool = new Pool({
      connectionString: appConfig.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    this.pool.on("error", (error) => {
      this.logger.error("Unexpected PostgreSQL pool error", { err: error });
    });

    const db = drizzle(this.pool, { schema });

    this.connection = {
      db,
      pool: this.pool,
      transaction: db.transaction.bind(db),
    };
  }

  async onApplicationShutdown() {
    await this.pool.end();
    this.logger.log("PostgreSQL pool closed");
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch (error) {
      this.logger.warn("PostgreSQL health check failed", { err: error });
      return false;
    }
  }
}
