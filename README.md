# Cyber Hub API

Enterprise B2B SaaS backend foundation for Cyber Hub.

## Stack

- NestJS
- TypeScript
- PostgreSQL
- Drizzle ORM
- Zod validation
- Pino structured logging
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

API docs are exposed at:

```text
/api/docs
```

Health check:

```text
/api/health
```

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

## Docker

Start API and PostgreSQL:

```bash
docker compose up --build
```

Start optional Redis profile:

```bash
docker compose --profile optional up --build
```
