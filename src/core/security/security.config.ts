import type { INestApplication } from "@nestjs/common";
import { appConfig } from "../config/app.config";

export function configureSecurity(app: INestApplication) {
  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
  });
}
