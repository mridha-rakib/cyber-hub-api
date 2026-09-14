import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { employers, type NewEmployer } from "../../../infrastructure/database/schema";

@Injectable()
export class EmployersRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async create(input: NewEmployer) {
    const [row] = await this.db.insert(employers).values(input).returning();
    return row;
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(employers).where(eq(employers.id, id)).limit(1);
    return row ?? null;
  }
}
