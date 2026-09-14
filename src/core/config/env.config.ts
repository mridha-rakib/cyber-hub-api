import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8000),
  API_PREFIX: z.string().min(1).default("api"),
  API_VERSION: z.string().min(1).default("1"),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default(process.env.NODE_ENV === "development" || !process.env.NODE_ENV ? "debug" : "info"),
  REQUEST_BODY_LIMIT: z.string().min(1).default("1mb"),
  ENABLE_SWAGGER: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  APP_WEB_URL: z.string().url().default("http://localhost:3000"),
  EMAIL_PROVIDER: z.enum(["resend", "dev"]).default("dev"),
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().min(1).default("no-reply@your-domain.com"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(1440),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  AUTH_RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(5),
});

export type EnvConfig = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = z.flattenError(parsed.error).fieldErrors;
  throw new Error(`Invalid environment configuration: ${JSON.stringify(errors)}`);
}

if (
  parsed.data.NODE_ENV === "production" &&
  parsed.data.EMAIL_PROVIDER === "resend" &&
  !parsed.data.RESEND_API_KEY
) {
  throw new Error(
    "Invalid environment configuration: RESEND_API_KEY is required when EMAIL_PROVIDER=resend in production",
  );
}

export const envConfig: EnvConfig = parsed.data;
