# ADR-007: Prepare for Multi-Tenancy

## Context

Cyber Hub is a future multi-tenant SaaS application.

## Problem

Tenant data isolation needs a deliberate future boundary, but tenant behavior is
not yet approved for implementation.

## Options Considered

Shared tables with tenant identifiers, schema-per-tenant, database-per-tenant, and
deferring all preparation.

## Decision

Prepare interfaces, request context fields, and common schema primitives for a
future shared-table tenant identifier. Do not enforce tenancy yet.

## Consequences

Future identity resolution can populate trusted company and tenant context before
repositories execute. Every business table and query will need an explicit reviewed
tenant-isolation decision; request context alone cannot provide isolation.
