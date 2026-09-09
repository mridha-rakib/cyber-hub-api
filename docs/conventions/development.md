# Development Conventions

Use TypeScript strict mode and Biome. Keep controllers transport-focused, use
structured logger fields rather than interpolating values into messages, and never
include credentials, headers, bodies, or tokens in logs.

Run `npm run lint`, `npm run typecheck`, `npm test -- --runInBand`, and `npm run build`
before proposing a change. Use Conventional Commits. Add an ADR for a durable
architecture decision that changes a core technology or boundary.

Local environment values belong in `.env`; start from `.env.example`. CI uses only
the non-secret values in `.env.test.example` and its workflow environment.
