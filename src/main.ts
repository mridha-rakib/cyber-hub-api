import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApplication } from "./bootstrap";
import { appConfig } from "./core/config/app.config";
import { LoggerService } from "./core/logger/logger.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(LoggerService);

  configureApplication(app);
  app.enableShutdownHooks();
  await app.listen(appConfig.port);
  logger.log(`Cyber Hub API listening on port ${appConfig.port}`);
}

void bootstrap();
