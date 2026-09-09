# Cyber Hub API

Enterprise B2B SaaS backend foundation for Cyber Hub.

## Stack

- NestJS
- TypeScript
- PostgreSQL
- Drizzle ORM
- Zod validation
- nestjs-pino and Pino structured logging (Node.js >=22.12)
- Biome
- Jest and Supertest
- Docker

## Architecture

The backend follows a modular clean architecture:

```text
Controller
  -> Service
  -> Repository Interface
  -> Repository Implementation
  -> Drizzle ORM
  -> PostgreSQL
```

Rules:

- Controllers handle HTTP only.
- Services own business use cases.
- Services do not access Drizzle directly.
- Database queries live inside repositories.
- Modules must depend on interfaces where dependency inversion is needed.

## Project Structure

```text
src/
  core/
    config/
    database/
    logger/
    errors/
    response/
    idempotency/
    security/
    utils/
  common/
    interfaces/
    decorators/
    constants/
    enums/
    types/
  infrastructure/
    database/
    cache/
    queue/
    email/
    storage/
  modules/
```

`src/modules` is intentionally empty until business modules are approved.

## Environment Setup

Create `.env` from `.env.example` and configure:

```text
DATABASE_URL=postgres://postgres:postgres@localhost:5432/cyber_hub
PORT=8000
API_PREFIX=api
CORS_ORIGINS=http://localhost:3000
```

The app validates required environment variables at startup and fails fast when required values are missing.

## Development

```bash
npm install
npm run dev
```

Development workflow:

```bash
npm run lint
npm run typecheck
npm test -- --runInBand
npm run build
```

API docs are exposed at:

```text
/api/docs
```

Swagger is controlled by `ENABLE_SWAGGER`. It is enabled in `.env.example` for
local development and defaults to `false` when the variable is omitted. Set
`ENABLE_SWAGGER=false` to disable it. In production, keep it disabled unless the
route is protected by an approved internal network boundary or authentication
mechanism. The JSON specification is available at `/api/docs-json` when enabled.

Health check:

```text
/health
```

`GET /health` is a raw operational readiness response, not a versioned business
API response. It returns 200 only when the application is accepting traffic and
PostgreSQL responds to a lightweight query; it returns 503 during draining or an
infrastructure failure. See [operations documentation](docs/setup/operations.md).

## Database Migrations

Generate migrations:

```bash
npm run migration:generate
```

Run migrations:

```bash
npm run migration:run
```

Database schema primitives live in:

```text
src/infrastructure/database/schema
```

Foundation columns are prepared for:

- `company_id` tenant isolation
- `created_at`
- `updated_at`
- `deleted_at`

## Git Commit Rules

Conventional Commits are required.

Allowed types:

- `feat`
- `fix`
- `docs`
- `style`
- `refactor`
- `perf`
- `test`
- `chore`
- `build`
- `ci`

Examples:

```text
feat(auth): add login module
fix(payment): handle duplicate webhook
refactor(user): improve repository layer
```

## Quality Checks

Pre-commit runs:

```bash
npm run lint
npm run typecheck
```

Commit message validation runs:

```bash
npx --no -- commitlint --edit "$1"
```

## CI and Architecture Documentation

GitHub Actions runs on pushes and pull requests from
[`/.github/workflows/ci.yml`](../.github/workflows/ci.yml). It uses Node 22 and
the npm cache, then runs a locked install, Biome, TypeScript checking, tests, and
the production build. It uses test-only environment values and no production
secrets. The workflow validates code only; it does not deploy.

Architecture records live in [`docs/decisions`](docs/decisions), with supporting
architecture, conventions, and operations documents under `docs/`. Add a new ADR
when a long-lived technical decision changes a foundation technology, system
boundary, or operational model. Follow the Context, Problem, Options Considered,
Decision, and Consequences format used by the existing records.

## Lifecycle and Logging

The application enables Nest shutdown hooks for SIGTERM and SIGINT. On shutdown it
marks readiness unavailable, stops accepting new connections, waits for Nest to
finish active work, and closes the PostgreSQL pool. Docker Compose grants the API
30 seconds to stop cleanly and checks `/health` after PostgreSQL is ready.

Logging is documented in the [logging and request context section](#logging-and-request-context).
Pino emits readable local logs and structured JSON in production. Use the injected
`LoggerService` with static messages and structured metadata. Request IDs, trusted
identity context, redaction rules, category conventions, and monitoring extension
points are described below.

## Docker

Start API and PostgreSQL:

```bash
docker compose up --build
```

Start optional Redis profile:

```bash
docker compose --profile optional up --build
```

## Logging and Request Context

`core/logger/logger.config.ts` centralizes nestjs-pino configuration. Pino provides
structured, low-overhead logging to stdout; nestjs-pino supplies Nest dependency
injection, the replacement Nest logger, and HTTP request logging. We do not import
or register pino-http directly: nestjs-pino uses it internally as a peer dependency
installed by npm. Adding another middleware would duplicate completion records.

Development uses pino-pretty with readable timestamps and colors. Production and
tests use newline-delimited JSON with numeric Pino levels, ISO timestamps, service,
environment, category, and message (`msg`). LOG_LEVEL defaults to debug in development
and info otherwise; explicit debug/trace settings are clamped to info in production.
The example environment file explicitly selects info; set debug for local diagnostics.

Inject the application `LoggerService` from `core/logger/logger.service.ts` into
controllers, services, or repositories. Use `info`, `warn`, `error`, or `debug` with
a static message and structured fields. Include `context` for the module or class.
For example: `logger.info("Operation completed", { context: "ExampleService", operationId })`.
For errors, pass `{ err: error, code }` as the second argument. Do not inject raw Pino
outside logging infrastructure, or create per-service transports or global singletons.
The wrapper's API is the replacement boundary and can be overridden in Nest tests.

The context middleware starts AsyncLocalStorage before request parsing. IDs are
generated UUIDs unless x-request-id is 1-128 ASCII letters, digits, underscores or
hyphens. The response returns the same ID. IDs are correlation hints, never proof
of identity or globally unique when supplied by clients. At a public ingress,
overwrite client IDs if trusted end-to-end correlation is required.
RequestContextService can be injected anywhere; asynchronous work retains its
request context without making every provider request-scoped. Only trusted future
identity resolution should call `setIdentity({ userId, companyId, tenantId })`;
these fields are never read from client tenant headers. Startup/shutdown logs have
no requestId because no request exists. Future workers must start a fresh `run`
context from validated job metadata rather than retaining HTTP request objects.

Application logs automatically carry the active request context. nestjs-pino owns
one completion record per request reaching its API middleware, including method,
path (without query), statusCode, responseTime in milliseconds, and requestId.
The global exception filter writes a separate diagnostic record for failures:
4xx at warn, 5xx at error, with error name, message, code, and internal stack.
Responses never contain stacks; 5xx responses also suppress internal messages and
metadata. JSON parsing runs after the logger to preserve diagnostics on malformed
bodies. Early responses from CORS or Swagger middleware require ingress access
logs; they do not pass through Nest's API logging middleware.

Never log request/response bodies, headers, environment dumps, passwords or hashes,
tokens, cookies, API keys, database credentials, payment secrets, or webhook secrets.
HTTP records use a metadata allowlist. Pino redaction protects known sensitive paths;
recursive structured-field sanitization also handles nested arrays, case variations,
and errors. Diagnostic strings scrub common credential URLs and token assignments.
Redaction cannot reliably identify an arbitrary secret embedded in free text:
keep messages static, pass only approved metadata, and never put secrets in URL paths.
Sanitization is bounded, handles cycles, and does not mutate caller data.

Categories are `application` (default), `security`, `audit`, and `billing`; they
classify records only. No business events or durable audit ledger are implemented.
Access-controlled retention, immutable audit storage, and payment event processing
are separate future concerns; stdout logs are not a compliance audit system.

Production collectors can ship JSON stdout to Loki or CloudWatch without application
transports. Do not use request or tenant IDs as indexed Loki labels. Future OpenTelemetry
integration can enrich this central logger with active traceId/spanId; requestId is
not a distributed trace. A future Sentry adapter belongs at the exception boundary
and must reuse sanitization. No external monitoring services are integrated yet.
Restrict access to logs, define retention at the collector, and use graceful process
termination so stdout can drain. Do not use process.exit to terminate normal requests.

Logging integration tests exercise real Nest injection and capture JSON output to
verify request correlation, concurrent tenant isolation, redaction, exception handling,
and single HTTP completion records. `npm test -- --runInBand` runs all foundation tests.
