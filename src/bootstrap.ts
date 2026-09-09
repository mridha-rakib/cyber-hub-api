import { type INestApplication, RequestMethod } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { appConfig } from "./core/config/app.config";
import { ExceptionFilter } from "./core/errors/exception.filter";
import { LoggerService } from "./core/logger/logger.service";
import { RequestContextMiddleware } from "./core/request-context/request-context.middleware";
import { ResponseInterceptor } from "./core/response/response.interceptor";
import { configureSecurity } from "./core/security/security.config";
import { ValidationPipe } from "./core/validation/validation.pipe";

export function configureApplication(app: INestApplication) {
  const logger = app.get(LoggerService);

  app.useLogger(app.get(Logger));
  const requestContext = app.get(RequestContextMiddleware);
  app.use(requestContext.use.bind(requestContext));
  app.use(helmet());
  configureSecurity(app);
  app.setGlobalPrefix(appConfig.apiPrefix, {
    exclude: [{ path: "health", method: RequestMethod.GET }],
  });
  app.useGlobalPipes(new ValidationPipe());
  app.useGlobalFilters(new ExceptionFilter(logger));
  app.useGlobalInterceptors(new ResponseInterceptor());

  const documentConfig = new DocumentBuilder()
    .setTitle("Cyber Hub API")
    .setDescription("Enterprise B2B SaaS API")
    .setVersion(appConfig.apiVersion)
    .addBearerAuth()
    .build();

  if (appConfig.enableSwagger) {
    const document = SwaggerModule.createDocument(app, documentConfig);
    SwaggerModule.setup(`${appConfig.apiPrefix}/docs`, app, document, {
      jsonDocumentUrl: `${appConfig.apiPrefix}/docs-json`,
      yamlDocumentUrl: `${appConfig.apiPrefix}/docs-yaml`,
    });
  }
}
