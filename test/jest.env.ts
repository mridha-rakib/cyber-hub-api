process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/cyber_hub";
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://localhost:3000";
process.env.ENABLE_SWAGGER = process.env.ENABLE_SWAGGER ?? "true";
// A tight sensitive-auth rate limit is correct for production, but running a
// full e2e suite against the same in-process throttler storage would trip it
// well before the suite finishes. Configuration itself is verified statically
// instead of by exhausting the real limit (see auth.e2e-spec.ts).
process.env.AUTH_RATE_LIMIT_MAX_REQUESTS = process.env.AUTH_RATE_LIMIT_MAX_REQUESTS ?? "1000";
