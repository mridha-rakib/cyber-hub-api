# ADR-003: Select Drizzle ORM

## Context

The application needs typed SQL access while retaining visibility into generated
queries and migrations.

## Problem

An ORM must not obscure relational behavior or force service code to own queries.

## Options Considered

Drizzle ORM, Prisma, and raw node-postgres.

## Decision

Use Drizzle ORM over the application PostgreSQL pool.

## Consequences

Drizzle offers typed schema definitions and SQL-oriented queries. Repositories
remain responsible for query composition and migrations remain versioned artifacts.
