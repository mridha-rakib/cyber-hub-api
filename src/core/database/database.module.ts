import { Global, Module } from "@nestjs/common";
import { databaseProvider } from "./database.provider";
import { DatabaseService } from "./database.service";
import { TransactionManager } from "./transaction.manager";

@Global()
@Module({
  providers: [DatabaseService, TransactionManager, databaseProvider],
  exports: [DatabaseService, TransactionManager, databaseProvider],
})
export class DatabaseModule {}
