import { ValidationPipe } from "@core/validation/validation.pipe";
import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json, urlencoded } from "express";
import helmet from "helmet";
import { appConfig } from "./core/config/app.config";
import { ExceptionFilter } from "./core/errors/exception.filter";
import { LoggerService } from "./core/logger/logger.service";
import { ResponseInterceptor } from "./core/response/response.interceptor";
import { configureSecurity } from "./core/security/security.config";

export function configureApplication(app: INestApplication) {
  const logger = app.get(LoggerService);

  app.useLogger(logger);
  app.use(helmet());
  app.use(json({ limit: appConfig.requestBodyLimit }));
  app.use(urlencoded({ extended: true, limit: appConfig.requestBodyLimit }));
  configureSecurity(app);
  app.setGlobalPrefix(appConfig.apiPrefix);
  app.useGlobalPipes(new ValidationPipe());
  app.useGlobalFilters(new ExceptionFilter(logger));
  app.useGlobalInterceptors(new ResponseInterceptor());

  const documentConfig = new DocumentBuilder()
    .setTitle("Cyber Hub API")
    .setDescription("Enterprise B2B SaaS API")
    .setVersion(appConfig.apiVersion)
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, documentConfig);
  SwaggerModule.setup(`${appConfig.apiPrefix}/docs`, app, document);
}
