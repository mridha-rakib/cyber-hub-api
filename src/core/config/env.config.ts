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
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  REQUEST_BODY_LIMIT: z.string().min(1).default("1mb"),
});

export type EnvConfig = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = z.flattenError(parsed.error).fieldErrors;
  throw new Error(`Invalid environment configuration: ${JSON.stringify(errors)}`);
}

export const envConfig: EnvConfig = parsed.data;
