import { DatabaseService } from "./database.service";
import { DATABASE_CONNECTION } from "./drizzle.config";

export const databaseProvider = {
  provide: DATABASE_CONNECTION,
  inject: [DatabaseService],
  useFactory: (databaseService: DatabaseService) => databaseService.connection,
};
