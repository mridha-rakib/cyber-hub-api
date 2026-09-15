/**
 * Injectable time source so AUTH_SCOPE's valid_from/valid_until boundary
 * checks are deterministic in tests (Wave 0D-4B Phase 12) — no sleep-based
 * tests, no reliance on wall-clock timing.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol("CLOCK");

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
