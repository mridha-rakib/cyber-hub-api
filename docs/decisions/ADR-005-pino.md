# ADR-005: Select Pino Logging

## Context

Production services need structured logs, request correlation, and Nest injection.

## Problem

Console-based logs are slow, unstructured, and do not provide safe request context.

## Options Considered

Pino with nestjs-pino, Winston, and the Nest default logger.

## Decision

Use Pino through nestjs-pino and an application logger wrapper.

## Consequences

Logs are JSON in production and readable locally. nestjs-pino owns HTTP logging;
application code does not register pino-http separately. Redaction remains a
defense in depth measure, not permission to log sensitive data.
