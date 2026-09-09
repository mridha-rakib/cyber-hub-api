process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/cyber_hub";
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://localhost:3000";
process.env.ENABLE_SWAGGER = process.env.ENABLE_SWAGGER ?? "true";
