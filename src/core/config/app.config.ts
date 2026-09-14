import { envConfig } from "./env.config";

export const appConfig = {
  nodeEnv: envConfig.NODE_ENV,
  isProduction: envConfig.NODE_ENV === "production",
  isDevelopment: envConfig.NODE_ENV === "development",
  isTest: envConfig.NODE_ENV === "test",
  port: envConfig.PORT,
  apiPrefix: `${envConfig.API_PREFIX}/v${envConfig.API_VERSION}`,
  apiVersion: envConfig.API_VERSION,
  databaseUrl: envConfig.DATABASE_URL,
  corsOrigins: envConfig.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  rateLimit: {
    ttlSeconds: envConfig.RATE_LIMIT_TTL_SECONDS,
    maxRequests: envConfig.RATE_LIMIT_MAX_REQUESTS,
  },
  logLevel: envConfig.LOG_LEVEL,
  requestBodyLimit: envConfig.REQUEST_BODY_LIMIT,
  enableSwagger: envConfig.ENABLE_SWAGGER,
  appWebUrl: envConfig.APP_WEB_URL,
  email: {
    provider: envConfig.EMAIL_PROVIDER,
    resendApiKey: envConfig.RESEND_API_KEY,
    from: envConfig.EMAIL_FROM,
  },
  auth: {
    sessionTtlDays: envConfig.SESSION_TTL_DAYS,
    emailVerificationTokenTtlMinutes: envConfig.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES,
    passwordResetTokenTtlMinutes: envConfig.PASSWORD_RESET_TOKEN_TTL_MINUTES,
    rateLimit: {
      ttlSeconds: envConfig.AUTH_RATE_LIMIT_TTL_SECONDS,
      maxRequests: envConfig.AUTH_RATE_LIMIT_MAX_REQUESTS,
    },
  },
} as const;
