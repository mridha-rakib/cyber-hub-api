# Architecture Overview

Cyber Hub is a modular NestJS application. Cross-cutting infrastructure lives in
`src/core`, reusable contracts live in `src/common`, infrastructure adapters live
in `src/infrastructure`, and future business modules will live in `src/modules`.

Controllers translate transport concerns. Services own use cases. Repository
implementations own Drizzle queries. Application services depend on repository
contracts where inversion is useful. The current foundation intentionally contains
no business modules.

The database is PostgreSQL behind Drizzle and a single application-managed pool.
Pino logs to stdout through nestjs-pino. Request context uses AsyncLocalStorage for
correlation only; it is not an authorization or tenant-isolation mechanism.

`GET /health` is an unversioned readiness endpoint for infrastructure. API routes
remain under `/api`. OpenAPI documentation, when enabled, is exposed at `/api/docs`.
