# ADR-004: Use Repository Pattern

## Context

Business services need persistence access without coupling their use cases to a
specific query library.

## Problem

Direct database access in services spreads persistence details and makes isolation
and testing harder.

## Options Considered

Repositories, direct Drizzle use in services, and active-record models.

## Decision

Use repository contracts and implementations for business persistence boundaries.

## Consequences

Services can be tested against contracts and Drizzle stays localized. Do not add a
repository where it merely forwards one trivial query without a meaningful boundary.
