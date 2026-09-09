import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type * as schema from "../../infrastructure/database/schema";

export const DATABASE_CONNECTION = Symbol("DATABASE_CONNECTION");

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  pool: Pool;
  transaction: Database["transaction"];
}
