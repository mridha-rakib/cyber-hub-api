# ADR-006: Use Modular Clean Architecture

## Context

The system must add independent business capabilities without a monolithic service
layer.

## Problem

Cross-module database and framework coupling makes ownership and changes risky.

## Options Considered

Feature modules with clean boundaries, a layered global application, and immediate
microservices.

## Decision

Use modular clean architecture in a single deployable application.

## Consequences

Modules own their controllers, services, contracts, and persistence adapters. This
keeps deployment simple while preserving boundaries for later extraction.
