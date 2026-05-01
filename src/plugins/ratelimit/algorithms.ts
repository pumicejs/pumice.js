import type { RatelimitStateRecord } from "./types.js";

/**
 * Inputs required by every algorithm to evaluate a single request.
 */
export type AlgorithmEvaluateArgs = {
  record: RatelimitStateRecord | undefined;
  limit: number;
  timeframeMs: number;
  /** Token-bucket capacity. Ignored by other algorithms. */
  burst?: number;
  cost: number;
  now: number;
  /** When `false`, just check; do not mutate counters / tokens. */
  consume: boolean;
};

/**
 * Result of evaluating a request against an algorithm.
 */
export type AlgorithmEvaluation = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
  /** New record to persist (always present, even on rejection, to update windows). */
  newRecord: RatelimitStateRecord;
};

export interface RatelimitAlgorithm {
  evaluate(args: AlgorithmEvaluateArgs): AlgorithmEvaluation;
}

function clampNonNegative(value: number): number {
  return value < 0 ? 0 : value;
}

/**
 * Standard fixed-window counter — cheap, predictable. Allows at most a
 * 2x burst right at window boundaries (a known characteristic of the
 * algorithm).
 */
export const fixedWindowAlgorithm: RatelimitAlgorithm = {
  evaluate({ record, limit, timeframeMs, cost, now, consume }) {
    type FixedData = { count: number; windowStart: number };

    const previous = record?.data as FixedData | undefined;
    const windowStart =
      previous && now - previous.windowStart < timeframeMs
        ? previous.windowStart
        : now;
    const currentCount = previous && previous.windowStart === windowStart ? previous.count : 0;
    const projectedCount = currentCount + cost;
    const allowed = projectedCount <= limit;

    const finalCount = allowed && consume ? projectedCount : currentCount;
    const resetAt = windowStart + timeframeMs;

    return {
      allowed,
      limit,
      remaining: clampNonNegative(limit - finalCount),
      resetAt,
      retryAfterMs: allowed ? 0 : Math.max(0, resetAt - now),
      newRecord: {
        ...(record ?? {}),
        data: { count: finalCount, windowStart } satisfies FixedData,
        expiresAt: resetAt,
      },
    };
  },
};

/**
 * Sliding window using two adjacent fixed windows, weighted by elapsed
 * time. Smoother than fixed-window without storing per-request
 * timestamps.
 */
export const slidingWindowAlgorithm: RatelimitAlgorithm = {
  evaluate({ record, limit, timeframeMs, cost, now, consume }) {
    type SlidingData = {
      currentWindowStart: number;
      currentCount: number;
      previousCount: number;
    };

    const stored = record?.data as SlidingData | undefined;
    let currentWindowStart = stored?.currentWindowStart ?? now;
    let currentCount = stored?.currentCount ?? 0;
    let previousCount = stored?.previousCount ?? 0;

    const elapsedSinceStart = now - currentWindowStart;
    if (elapsedSinceStart >= timeframeMs * 2) {
      // Both windows are stale.
      previousCount = 0;
      currentCount = 0;
      currentWindowStart = now;
    } else if (elapsedSinceStart >= timeframeMs) {
      // Roll one window forward.
      previousCount = currentCount;
      currentCount = 0;
      currentWindowStart = currentWindowStart + timeframeMs;
    }

    const intoCurrent = now - currentWindowStart;
    const previousWeight = Math.max(0, 1 - intoCurrent / timeframeMs);
    const weightedCount = previousCount * previousWeight + currentCount;
    const projected = weightedCount + cost;
    const allowed = projected <= limit;

    const finalCurrent = allowed && consume ? currentCount + cost : currentCount;
    const resetAt = currentWindowStart + timeframeMs * 2;

    const tokensAvailableAt =
      allowed || previousCount === 0
        ? now
        : currentWindowStart + timeframeMs;

    return {
      allowed,
      limit,
      remaining: clampNonNegative(
        Math.floor(limit - (previousCount * previousWeight + finalCurrent)),
      ),
      resetAt,
      retryAfterMs: allowed ? 0 : Math.max(0, tokensAvailableAt - now),
      newRecord: {
        ...(record ?? {}),
        data: {
          currentWindowStart,
          currentCount: finalCurrent,
          previousCount,
        } satisfies SlidingData,
        expiresAt: resetAt,
      },
    };
  },
};

/**
 * Token bucket — refills `limit` tokens linearly across `timeframeMs`,
 * up to a maximum capacity of `burst` (defaults to `limit`).
 */
export const tokenBucketAlgorithm: RatelimitAlgorithm = {
  evaluate({ record, limit, timeframeMs, burst, cost, now, consume }) {
    type TokenData = { tokens: number; lastRefillAt: number };

    const capacity = burst ?? limit;
    const refillRatePerMs = limit / timeframeMs;

    const stored = record?.data as TokenData | undefined;
    const lastRefillAt = stored?.lastRefillAt ?? now;
    const previousTokens = stored?.tokens ?? capacity;

    const elapsed = Math.max(0, now - lastRefillAt);
    const refilled = Math.min(capacity, previousTokens + elapsed * refillRatePerMs);

    const allowed = refilled >= cost;
    const tokensAfter = allowed && consume ? refilled - cost : refilled;
    const tokensNeeded = allowed ? 0 : cost - refilled;
    const retryAfterMs = allowed ? 0 : Math.ceil(tokensNeeded / refillRatePerMs);

    // Reset (full bucket) reached when we go from `tokensAfter` to capacity.
    const msToFull = (capacity - tokensAfter) / refillRatePerMs;
    const resetAt = now + Math.ceil(msToFull);

    return {
      allowed,
      limit: capacity,
      remaining: clampNonNegative(Math.floor(tokensAfter)),
      resetAt,
      retryAfterMs,
      newRecord: {
        ...(record ?? {}),
        data: { tokens: tokensAfter, lastRefillAt: now } satisfies TokenData,
        expiresAt: resetAt,
      },
    };
  },
};

/**
 * Leaky bucket — requests fill a bucket of capacity `limit` that drains
 * at a steady rate over `timeframeMs`. Smooths bursty traffic.
 */
export const leakyBucketAlgorithm: RatelimitAlgorithm = {
  evaluate({ record, limit, timeframeMs, cost, now, consume }) {
    type LeakyData = { level: number; lastLeakAt: number };

    const drainPerMs = limit / timeframeMs;
    const stored = record?.data as LeakyData | undefined;
    const lastLeakAt = stored?.lastLeakAt ?? now;
    const previousLevel = stored?.level ?? 0;

    const elapsed = Math.max(0, now - lastLeakAt);
    const drained = Math.max(0, previousLevel - elapsed * drainPerMs);

    const projected = drained + cost;
    const allowed = projected <= limit;
    const finalLevel = allowed && consume ? projected : drained;

    const overflow = allowed ? 0 : projected - limit;
    const retryAfterMs = allowed ? 0 : Math.ceil(overflow / drainPerMs);
    const resetAt = now + Math.ceil(finalLevel / drainPerMs);

    return {
      allowed,
      limit,
      remaining: clampNonNegative(Math.floor(limit - finalLevel)),
      resetAt,
      retryAfterMs,
      newRecord: {
        ...(record ?? {}),
        data: { level: finalLevel, lastLeakAt: now } satisfies LeakyData,
        expiresAt: resetAt,
      },
    };
  },
};

/**
 * Map of supported algorithm names to implementations.
 */
export const RATELIMIT_ALGORITHMS = {
  "fixed-window": fixedWindowAlgorithm,
  "sliding-window": slidingWindowAlgorithm,
  "token-bucket": tokenBucketAlgorithm,
  "leaky-bucket": leakyBucketAlgorithm,
} as const satisfies Record<string, RatelimitAlgorithm>;

export type RatelimitAlgorithmName = keyof typeof RATELIMIT_ALGORITHMS;
