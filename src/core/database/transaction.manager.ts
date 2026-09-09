import { AsyncLocalStorage } from "node:async_hooks";
import { Inject, Injectable } from "@nestjs/common";
import { DATABASE_CONNECTION, type Database, type DatabaseConnection } from "./drizzle.config";

@Injectable()
export class TransactionManager {
  private readonly storage = new AsyncLocalStorage<Database>();

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly connection: DatabaseConnection,
  ) {}

  async runInTransaction<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    return this.connection.db.transaction(async (transaction) =>
      this.storage.run(transaction as unknown as Database, operation),
    );
  }

  getExecutor(): Database {
    return this.storage.getStore() ?? this.connection.db;
  }
}
