# Operations Setup

Set `ENABLE_SWAGGER=true` for local development, then open `/api/docs`. Production
defaults to Swagger disabled. Enable it only behind an authenticated internal route
or an approved network boundary; the generated specification is public to anyone
who can reach the route.

`GET /health` returns 200 only when the application is accepting traffic and the
PostgreSQL pool can execute `SELECT 1`. It returns 503 while draining or when the
database is unavailable. It contains no secrets and is intended for load balancers,
orchestrators, and container health checks.

Nest listens for SIGTERM and SIGINT. On a signal it stops accepting connections,
marks readiness unavailable, waits for Nest to close active work, and invokes
shutdown hooks. The database pool closes through `DatabaseService`. Docker Compose
allows a 30-second stop grace period. Add future cache, queue, and external-client
close operations as lifecycle hooks in their owning modules.

Docker Compose overrides the local `.env` database host with the `postgres` service
hostname for the API container. Keep host-machine development values in `.env` and
do not copy that hostname into a process running outside Compose.
