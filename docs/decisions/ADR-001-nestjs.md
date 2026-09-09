# ADR-001: Select NestJS

## Context

Cyber Hub needs a TypeScript backend with clear module boundaries and consistent
cross-cutting infrastructure.

## Problem

An unstructured Express application makes dependency ownership, validation, and
lifecycle behavior harder to keep consistent as the team grows.

## Options Considered

NestJS, a direct Express application, and Fastify-first frameworks.

## Decision

Use NestJS with the Express adapter for the foundation.

## Consequences

Nest supplies modules, dependency injection, lifecycle hooks, and tested platform
integration. The team accepts decorators and Nest conventions at application edges.
