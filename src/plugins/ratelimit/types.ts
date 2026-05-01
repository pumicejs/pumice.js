import type { Context } from "hono";

/**
 * A numeric value that can be a literal or computed per request.
 *
 * Use the function form when the value depends on request data — e.g.
 * different limits per authenticated user tier:
 *
 * ```ts
 * limit: (c) => c.auth.data?.user.tier === "pro" ? 1000 : 100
 * ```
 */
export type RatelimitDynamicNumber =
  | number
  | ((context: Context) => number | Promise<number>);

/**
 * High-level descriptor of which callers share the same bucket.
 *
 * - `"ip"` — one bucket per client IP
 * - `"user"` — one bucket per authenticated user (uses the plugin's
 *   `userId` option, which defaults to `c.auth?.data?.user?.id`)
 * - `"route"` — a single bucket for the matched route pattern (every
 *   caller shares it)
 * - `"global"` — a single bucket for every request, everywhere
 *
 * Composite forms:
 * - `["ip", "route"]` — joins parts with `|` to make the key
 * - `{ by: "user", fallback: "ip" }` — uses `by` when available; otherwise
 *   falls back (useful for routes that allow both anonymous and
 *   authenticated traffic)
 * - `(c) => string` — fully custom key
 */
export type RatelimitScopePart = "ip" | "user" | "route" | "global";

/**
 * Configurable scope. See {@link RatelimitScopePart} for parts.
 */
export type RatelimitScopeExpression =
  | RatelimitScopePart
  | RatelimitScopePart[]
  | {
      by: RatelimitScopePart;
      fallback?: RatelimitScopePart;
    }
  | ((context: Context) => string | Promise<string>);

/**
 * Fields shared by every algorithm.
 */
type RatelimitSharedRuleFields = {
  /**
   * Optional name used to target this rule via `c.ratelimiting("name")`.
   *
   * Required if you want to call `consume` / `block` / `reset` on a
   * specific rule when multiple are configured.
   */
  name?: string;
  /**
   * What makes two requests share the same bucket.
   *
   * Defaults to `["ip", "route"]` — per IP, per matched route pattern.
   */
  scope?: RatelimitScopeExpression;
  /**
   * Whether path params are part of the bucket key.
   *
   * - `true` (default): `/users/1` and `/users/2` are separate buckets
   * - `false`: every value of every path param shares one bucket
   * - `string[]`: include only the named params (e.g. `["userId"]`)
   */
  respectParams?: boolean | string[];
  /**
   * How many tokens this request consumes from the bucket.
   *
   * Useful for weighting expensive endpoints. Defaults to `1`.
   */
  cost?: number | ((context: Context) => number | Promise<number>);
  /**
   * When `true`, the plugin's pre-validation hook only **checks** the
   * bucket — it does not auto-consume on every request. The handler is
   * responsible for calling `c.ratelimiting.consume()` when appropriate.
   *
   * Pattern for failed-login throttling:
   * ```ts
   * .config({ ratelimit: { scope: "ip", limit: 5, timeframe: 60_000, manual: true } })
   * .handle(async (c) => {
   *   const ok = await checkPassword(...);
   *   if (!ok) {
   *     await c.ratelimiting.consume();
   *     return c.error({ status: 401, code: "INVALID_CREDENTIALS" });
   *   }
   *   await c.ratelimiting.reset(); // wipe failed-attempt counter
   *   return ...;
   * });
   * ```
   *
   * Defaults to `false`.
   */
  manual?: boolean;
  /**
   * Predicate to bypass this rule entirely for a given request.
   *
   * Returning `true` skips both the check and the consume.
   */
  skip?: (context: Context) => boolean | Promise<boolean>;
  /**
   * Set to `true` to disable this rule without removing it from config.
   * Useful for staged rollouts via dynamic config.
   */
  disabled?: boolean;
};

type RatelimitCoreRuleFields = {
  /**
   * Maximum number of requests permitted in `timeframe`.
   *
   * For `token-bucket`, this is the refill amount (tokens per
   * `timeframe`). For `leaky-bucket`, this is the bucket capacity.
   */
  limit: RatelimitDynamicNumber;
  /**
   * Window length in milliseconds.
   *
   * - `fixed-window` / `sliding-window`: width of the counting window
   * - `token-bucket`: time over which `limit` tokens are refilled
   * - `leaky-bucket`: time over which the bucket fully drains
   */
  timeframe: RatelimitDynamicNumber;
};

/**
 * Standard fixed-window counter.
 *
 * Cheap and predictable; can allow a 2x burst at window boundaries.
 * This is the default algorithm.
 */
export type RatelimitFixedWindowRule = RatelimitSharedRuleFields &
  RatelimitCoreRuleFields & {
    algorithm?: "fixed-window";
  };

/**
 * Approximated sliding window using two adjacent fixed windows.
 *
 * Smoother than fixed-window without the memory cost of a full request
 * log. Recommended when you want to avoid boundary-effect bursts.
 */
export type RatelimitSlidingWindowRule = RatelimitSharedRuleFields &
  RatelimitCoreRuleFields & {
    algorithm: "sliding-window";
  };

/**
 * Token bucket — refills `limit` tokens over `timeframe`, allowing
 * controlled bursts up to `burst` (or `limit` if `burst` is unset).
 *
 * Recommended for APIs where short bursts are expected and acceptable.
 */
export type RatelimitTokenBucketRule = RatelimitSharedRuleFields &
  RatelimitCoreRuleFields & {
    algorithm: "token-bucket";
    /**
     * Maximum tokens the bucket can hold. Defaults to `limit`.
     *
     * Set higher than `limit` to allow short bursts above the steady
     * refill rate.
     */
    burst?: RatelimitDynamicNumber;
  };

/**
 * Leaky bucket — requests fill a bucket of capacity `limit` that drains
 * at a steady rate over `timeframe`. Smooths bursty traffic.
 */
export type RatelimitLeakyBucketRule = RatelimitSharedRuleFields &
  RatelimitCoreRuleFields & {
    algorithm: "leaky-bucket";
  };

/**
 * One ratelimit rule. The discriminator on `algorithm` causes
 * algorithm-specific fields (e.g. `burst` on `token-bucket`) to appear
 * only when the corresponding algorithm is selected.
 */
export type RatelimitRule =
  | RatelimitFixedWindowRule
  | RatelimitSlidingWindowRule
  | RatelimitTokenBucketRule
  | RatelimitLeakyBucketRule;

/**
 * Per-route ratelimit configuration.
 *
 * Forms:
 * - `false` — disable ratelimiting for this route
 * - a single {@link RatelimitRule}
 * - `{ rules: RatelimitRule[] }` — stack multiple rules (e.g. burst +
 *   long-window). 429 if any one rule is exceeded.
 */
export type RouteRatelimitConfig =
  | false
  | RatelimitRule
  | {
      rules: RatelimitRule[];
      /** Disable all rules without removing them from config. */
      disabled?: boolean;
    };

/**
 * Route-config extension contributed by `RatelimitPlugin`.
 */
export type RatelimitRouteConfigExtension = {
  ratelimit?: RouteRatelimitConfig;
};

/**
 * Snapshot of a bucket's current state.
 */
export type RatelimitState = {
  /** The configured limit for this rule. */
  limit: number;
  /** How many requests are still allowed before 429. */
  remaining: number;
  /** Epoch ms when the bucket fully resets. */
  resetAt: number;
};

/**
 * Result of consuming from a bucket.
 */
export type RatelimitConsumeResult = RatelimitState & {
  /** `true` if the consume succeeded and the request may proceed. */
  allowed: boolean;
  /** Suggested wait before retrying. `0` when allowed. */
  retryAfterMs: number;
};

/**
 * Subset of the helpers exposed for a single rule.
 */
export interface RatelimitingRuleHelpers {
  /**
   * Increment the bucket by `n` tokens (defaults to `1`).
   *
   * Returns the most restrictive {@link RatelimitConsumeResult} across
   * all targeted rules.
   */
  consume(n?: number): Promise<RatelimitConsumeResult>;
  /**
   * Hard-block the bucket(s) for `durationMs` milliseconds.
   *
   * While blocked, every consume / peek returns `allowed: false`
   * regardless of remaining tokens. Use for punitive lockouts (e.g.
   * after N failed login attempts).
   */
  block(durationMs: number): Promise<void>;
  /**
   * Reset the bucket(s) — clears counters and any active block.
   *
   * Useful after a successful login to discard the failed-attempt
   * counter.
   */
  reset(): Promise<void>;
  /**
   * Read current state without mutating.
   *
   * For multi-rule routes, returns the most restrictive state.
   */
  peek(): Promise<RatelimitState>;
}

/**
 * Helpers exposed on `c.ratelimiting` when `RatelimitPlugin` is
 * registered.
 *
 * Methods called directly target every active rule on the route.
 * Call as a function with a rule name to scope to a single rule:
 *
 * ```ts
 * c.ratelimiting.consume();              // every rule
 * c.ratelimiting("login-burst").reset(); // single rule
 * ```
 */
export interface RatelimitingHelpers extends RatelimitingRuleHelpers {
  /** Target a single named rule. */
  (name: string): RatelimitingRuleHelpers;
}

/**
 * Persisted state for a single bucket, written by an algorithm and read
 * back by it on the next request.
 */
export type RatelimitStateRecord = {
  /** Algorithm-private payload. Opaque to the store. */
  data: unknown;
  /** Epoch ms after which the record may be evicted. */
  expiresAt: number;
  /** Epoch ms while the bucket is hard-blocked, if any. */
  blockedUntil?: number;
};

/**
 * Pluggable persistence layer for ratelimit buckets.
 *
 * The default `InMemoryRatelimitStore` implements this with a `Map`
 * and lazy TTL eviction. Distributed setups should provide their own
 * implementation backed by Redis, Memcached, etc.
 */
export interface RatelimitStore {
  /** Reads a bucket; returns `undefined` when missing or expired. */
  get(key: string): Promise<RatelimitStateRecord | undefined>;
  /** Writes (or overwrites) a bucket. */
  set(key: string, record: RatelimitStateRecord): Promise<void>;
  /** Deletes a bucket. */
  delete(key: string): Promise<void>;
}

/**
 * Information passed to {@link RatelimitPluginOptions.onLimitReached}
 * when a request is rejected.
 */
export type RatelimitLimitReachedInfo = {
  /** The rule that triggered the rejection. */
  rule: RatelimitRule;
  /** Resolved bucket key. */
  key: string;
  /** Snapshot of the bucket at rejection time. */
  state: RatelimitState;
  /** Suggested retry delay in milliseconds. */
  retryAfterMs: number;
  /** `true` when the rejection came from an active hard-block. */
  blocked: boolean;
};
