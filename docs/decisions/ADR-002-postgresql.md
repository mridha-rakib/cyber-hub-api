# ADR-002: Select PostgreSQL

## Context

The product will require transactional business data and reliable relational
constraints.

## Problem

The database must support integrity, reporting, and future tenant-aware queries.

## Options Considered

PostgreSQL, MongoDB, and MySQL.

## Decision

Use PostgreSQL.

## Consequences

PostgreSQL provides transactions, constraints, mature operations, and flexible
structured-data support. Schema changes require reviewed migrations.
