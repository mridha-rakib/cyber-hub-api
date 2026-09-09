import { appConfig } from "@core/config/app.config";
import { LoggerService } from "@core/logger/logger.service";
import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../infrastructure/database/schema";
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
      this.logger.error("Unexpected PostgreSQL pool error", error.stack);
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
}
