import type { Context } from "hono";
import type {
  RatelimitConsumeResult,
  RatelimitLimitReachedInfo,
  RatelimitRouteConfigExtension,
  RatelimitRule,
  RatelimitState,
  RatelimitStateRecord,
  RatelimitStore,
  RatelimitingHelpers,
  RatelimitingRuleHelpers,
  RouteRatelimitConfig,
} from "./types.js";
import type { ServerPlugin } from "../../types/plugin.js";
import type { RouteDefinition } from "../../types/route.js";
import {
  RATELIMIT_ALGORITHMS,
  type RatelimitAlgorithm,
  type RatelimitAlgorithmName,
} from "./algorithms.js";
import { InMemoryRatelimitStore } from "./store.js";
import {
  buildRuleKey,
  defaultClientIp,
  defaultUserId,
  type ScopeResolverOptions,
} from "./scope.js";
import { createApiJsonErrorResponse } from "../../http/json-envelope.js";

/**
 * Options for {@link RatelimitPlugin}.
 */
export type RatelimitPluginOptions = {
  /**
   * Persistence layer for buckets. Defaults to an in-memory store; use
   * a Redis-backed implementation for multi-instance deployments.
   */
  store?: RatelimitStore;
  /**
   * Default algorithm when a rule does not specify one. Defaults to
   * `"fixed-window"`.
   */
  defaultAlgorithm?: RatelimitAlgorithmName;
  /**
   * Custom client-IP resolver, used by the `"ip"` scope part. The
   * default reads `x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`,
   * `true-client-ip` (in that order).
   */
  clientIp?: (context: Context) => string | undefined;
  /**
   * Custom user-ID extractor, used by the `"user"` scope part. The
   * default reads `c.auth?.data?.user?.id`.
   */
  userId?: (
    context: Context,
  ) => string | undefined | Promise<string | undefined>;
  /**
   * Order of the plugin's pre-validation hook. Lower runs earlier.
   *
   * Default: `-500` — after `AuthenticationPlugin` (which uses `-1000`)
   * so dynamic `limit` / `scope` callbacks can read `c.auth`.
   */
  hookOrder?: number;
  /**
   * Which response headers to emit:
   *
   * - `"standard"` (default): `RateLimit-Limit`, `RateLimit-Remaining`,
   *   `RateLimit-Reset` (RFC draft, seconds-since-epoch).
   * - `"legacy"`: `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
   *   `X-RateLimit-Reset`.
   * - `"both"`: emit both sets.
   * - `false`: emit no informational headers (still emits `Retry-After`
   *   on 429).
   */
  headers?: "standard" | "legacy" | "both" | false;
  /**
   * Override the rejection response shape. Defaults to a 429 JSON
   * envelope with code `"RATE_LIMITED"`.
   */
  onLimitReached?: (
    context: Context,
    info: RatelimitLimitReachedInfo,
  ) => Response | Promise<Response>;
};

/**
 * Internal per-rule runtime data, computed once at hook time and reused
 * by the auto-consume pass and `c.ratelimiting` helpers.
 */
type RuleRuntime = {
  rule: RatelimitRule;
  key: string;
  algorithm: RatelimitAlgorithm;
  store: RatelimitStore;
  limit: number;
  timeframeMs: number;
  burst?: number;
  cost: number;
};

const NOOP_STATE: RatelimitState = {
  limit: Number.POSITIVE_INFINITY,
  remaining: Number.POSITIVE_INFINITY,
  resetAt: 0,
};

const NOOP_CONSUME_RESULT: RatelimitConsumeResult = {
  ...NOOP_STATE,
  allowed: true,
  retryAfterMs: 0,
};

async function resolveDynamic(
  value: number | ((c: Context) => number | Promise<number>),
  context: Context,
): Promise<number> {
  return typeof value === "function" ? value(context) : value;
}

function normalizeRouteConfig(
  raw: RouteRatelimitConfig | undefined,
): { rules: RatelimitRule[] } {
  if (!raw) return { rules: [] };
  if ("rules" in raw && Array.isArray(raw.rules)) {
    if (raw.disabled) return { rules: [] };
    return { rules: raw.rules.filter((rule) => !rule.disabled) };
  }
  if ((raw as RatelimitRule).disabled) return { rules: [] };
  return { rules: [raw as RatelimitRule] };
}

/**
 * Resolves dynamic numbers and prepares the algorithm, key, and store
 * for one rule. Returns `undefined` if the rule should be skipped via
 * its `skip` predicate.
 */
async function buildRuleRuntime(
  context: Context,
  rule: RatelimitRule,
  ruleIndex: number,
  store: RatelimitStore,
  defaultAlgorithm: RatelimitAlgorithmName,
  scopeOptions: ScopeResolverOptions,
): Promise<RuleRuntime | undefined> {
  if (rule.skip && (await rule.skip(context))) return undefined;

  const algorithmName: RatelimitAlgorithmName =
    rule.algorithm ?? defaultAlgorithm;
  const algorithm = RATELIMIT_ALGORITHMS[algorithmName];

  const limit = await resolveDynamic(rule.limit, context);
  const timeframeMs = await resolveDynamic(rule.timeframe, context);
  const cost =
    rule.cost === undefined ? 1 : await resolveDynamic(rule.cost, context);
  const burst =
    rule.algorithm === "token-bucket" && rule.burst !== undefined
      ? await resolveDynamic(rule.burst, context)
      : undefined;

  if (!Number.isFinite(limit) || limit <= 0) return undefined;
  if (!Number.isFinite(timeframeMs) || timeframeMs <= 0) return undefined;

  const key = await buildRuleKey(context, rule, ruleIndex, scopeOptions);

  return {
    rule,
    key,
    algorithm,
    store,
    limit,
    timeframeMs,
    burst,
    cost,
  };
}

/**
 * Evaluates a single rule against its current store record.
 *
 * `consumeOverride` controls whether mutation occurs:
 * - `undefined`: respects `rule.manual` (manual rules don't auto-consume)
 * - `true`/`false`: forces mutate-or-not (used by helpers)
 */
async function evaluateRule(
  runtime: RuleRuntime,
  options: { consumeOverride?: boolean; costOverride?: number; now?: number },
): Promise<{
  allowed: boolean;
  blocked: boolean;
  state: RatelimitState;
  retryAfterMs: number;
}> {
  const now = options.now ?? Date.now();
  const record = await runtime.store.get(runtime.key);

  if (record?.blockedUntil && record.blockedUntil > now) {
    return {
      allowed: false,
      blocked: true,
      state: {
        limit: runtime.limit,
        remaining: 0,
        resetAt: record.blockedUntil,
      },
      retryAfterMs: record.blockedUntil - now,
    };
  }

  const consume = options.consumeOverride ?? !runtime.rule.manual;
  const evaluation = runtime.algorithm.evaluate({
    record,
    limit: runtime.limit,
    timeframeMs: runtime.timeframeMs,
    burst: runtime.burst,
    cost: options.costOverride ?? runtime.cost,
    now,
    consume,
  });

  const newRecord: RatelimitStateRecord = {
    ...evaluation.newRecord,
    blockedUntil: record?.blockedUntil,
  };

  if (consume) {
    await runtime.store.set(runtime.key, newRecord);
  } else if (evaluation.newRecord && record === undefined) {
    // Persist initial window even on a peek so we don't recompute it
    // every read. Only when nothing was there before.
    await runtime.store.set(runtime.key, newRecord);
  }

  return {
    allowed: evaluation.allowed,
    blocked: false,
    state: {
      limit: evaluation.limit,
      remaining: evaluation.remaining,
      resetAt: evaluation.resetAt,
    },
    retryAfterMs: evaluation.retryAfterMs,
  };
}

/**
 * Given a list of states, returns the most restrictive (lowest
 * remaining; ties broken by earliest reset).
 */
function pickMostRestrictive(states: RatelimitState[]): RatelimitState {
  if (states.length === 0) return NOOP_STATE;
  let best = states[0]!;
  for (let i = 1; i < states.length; i += 1) {
    const candidate = states[i]!;
    if (
      candidate.remaining < best.remaining ||
      (candidate.remaining === best.remaining && candidate.resetAt < best.resetAt)
    ) {
      best = candidate;
    }
  }
  return best;
}

function applyRatelimitHeaders(
  context: Context,
  state: RatelimitState,
  mode: RatelimitPluginOptions["headers"],
): void {
  if (mode === false) return;
  if (!Number.isFinite(state.limit) || !Number.isFinite(state.remaining)) {
    return;
  }

  const limit = String(Math.floor(state.limit));
  const remaining = String(Math.floor(state.remaining));
  const resetSeconds = String(Math.ceil(state.resetAt / 1000));

  if (mode === "standard" || mode === "both" || mode === undefined) {
    context.res.headers.set("RateLimit-Limit", limit);
    context.res.headers.set("RateLimit-Remaining", remaining);
    context.res.headers.set("RateLimit-Reset", resetSeconds);
  }

  if (mode === "legacy" || mode === "both") {
    context.res.headers.set("X-RateLimit-Limit", limit);
    context.res.headers.set("X-RateLimit-Remaining", remaining);
    context.res.headers.set("X-RateLimit-Reset", resetSeconds);
  }
}

function defaultLimitReachedResponse(
  retryAfterMs: number,
  blocked: boolean,
): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const response = createApiJsonErrorResponse(429, {
    code: blocked ? "RATE_LIMIT_BLOCKED" : "RATE_LIMITED",
    message: blocked
      ? "This client has been temporarily blocked. Please try again later."
      : "Too many requests. Please slow down and try again.",
  });
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

/**
 * Selects the subset of runtime rules a helper call should target.
 *
 * - No name → all configured rules
 * - With a name → exactly the rule(s) whose `name` matches (zero or
 *   more). Returns an empty array if nothing matches; helpers then
 *   no-op.
 */
function selectRules(
  runtimeRules: RuleRuntime[],
  name: string | undefined,
): RuleRuntime[] {
  if (name === undefined) return runtimeRules;
  return runtimeRules.filter((runtime) => runtime.rule.name === name);
}

/**
 * Builds the `RatelimitingRuleHelpers` for a given list of runtimes.
 *
 * Empty list → all methods become no-ops; safe to call from handlers
 * on routes that have no ratelimit configured.
 */
function buildHelpers(runtimes: RuleRuntime[]): RatelimitingRuleHelpers {
  return {
    async consume(n: number = 1) {
      if (runtimes.length === 0) return NOOP_CONSUME_RESULT;
      const states: RatelimitState[] = [];
      let firstRejection:
        | { state: RatelimitState; retryAfterMs: number }
        | undefined;

      for (const runtime of runtimes) {
        const evaluation = await evaluateRule(runtime, {
          consumeOverride: true,
          costOverride: runtime.cost * n,
        });
        states.push(evaluation.state);
        if (!evaluation.allowed && firstRejection === undefined) {
          firstRejection = {
            state: evaluation.state,
            retryAfterMs: evaluation.retryAfterMs,
          };
        }
      }

      if (firstRejection) {
        return {
          ...firstRejection.state,
          allowed: false,
          retryAfterMs: firstRejection.retryAfterMs,
        };
      }

      const tightest = pickMostRestrictive(states);
      return { ...tightest, allowed: true, retryAfterMs: 0 };
    },

    async block(durationMs: number) {
      const blockedUntil = Date.now() + Math.max(0, durationMs);
      for (const runtime of runtimes) {
        const existing = (await runtime.store.get(runtime.key)) ?? {
          data: undefined,
          expiresAt: blockedUntil,
        };
        await runtime.store.set(runtime.key, {
          ...existing,
          blockedUntil,
          expiresAt: Math.max(existing.expiresAt, blockedUntil),
        });
      }
    },

    async reset() {
      for (const runtime of runtimes) {
        await runtime.store.delete(runtime.key);
      }
    },

    async peek() {
      if (runtimes.length === 0) return NOOP_STATE;
      const states: RatelimitState[] = [];
      for (const runtime of runtimes) {
        const evaluation = await evaluateRule(runtime, {
          consumeOverride: false,
          costOverride: 0,
        });
        states.push(evaluation.state);
      }
      return pickMostRestrictive(states);
    },
  };
}

/**
 * Creates the callable `c.ratelimiting` object.
 */
function createRatelimitingHelpers(
  runtimeRules: RuleRuntime[],
): RatelimitingHelpers {
  const allHelpers = buildHelpers(runtimeRules);
  const callable = ((name: string) =>
    buildHelpers(selectRules(runtimeRules, name))) as RatelimitingHelpers;
  callable.consume = allHelpers.consume.bind(allHelpers);
  callable.block = allHelpers.block.bind(allHelpers);
  callable.reset = allHelpers.reset.bind(allHelpers);
  callable.peek = allHelpers.peek.bind(allHelpers);
  return callable;
}

/**
 * Adds configurable request ratelimiting with pluggable algorithms, scopes,
 * and runtime helpers.
 *
 * What it adds:
 * - **Route-config key**: `ratelimit` accepting a single rule, a `{ rules: [...] }`
 *   array (stack multiple rules — 429 if any one is exceeded), or `false` to
 *   disable for a specific route.
 * - **Context field**: `c.ratelimiting` — runtime helpers for `consume()`,
 *   `block()`, `reset()`, `peek()`. Call as a function with a rule name to
 *   target one rule (`c.ratelimiting("login-burst").reset()`).
 * - **Pre-validation hook** (default order `-500`, after auth's `-1000` so
 *   dynamic limits / scopes can read `c.auth`) that:
 *   1. Resolves dynamic `limit` / `timeframe` / `cost` values per request.
 *   2. Builds the bucket key from the configured scope.
 *   3. For non-`manual` rules, consumes a token; if any rule exceeds, returns
 *      a 429 response (overridable via `onLimitReached`).
 *   4. Sets `RateLimit-*` (and / or legacy `X-RateLimit-*`) headers on the
 *      response.
 *
 * Algorithms: `fixed-window` (default), `sliding-window`, `token-bucket`,
 * `leaky-bucket` — see {@link RatelimitRule}.
 *
 * Persistence: defaults to {@link InMemoryRatelimitStore}. For multi-instance
 * deployments, supply a Redis-backed (or similar) {@link RatelimitStore}.
 *
 * Marked `unique: true` (id: `"pumice.js/ratelimit"`) — registering twice
 * throws.
 *
 * @example
 * ```ts
 * server.use(RatelimitPlugin());
 *
 * // Global defaults: 100 req/min per IP for every route
 * server.config({ routes: { ratelimit: { limit: 100, timeframe: 60_000 } } });
 *
 * // Tighter, per-user limits with a burst allowance
 * server.route().post().config({
 *   ratelimit: {
 *     scope: ["user", "route"],
 *     algorithm: "token-bucket",
 *     limit: 60,
 *     timeframe: 60_000,
 *     burst: 10,
 *   },
 * }).handle(...);
 *
 * // Manual mode — only count failures (login throttling)
 * server.route().post().config({
 *   ratelimit: { scope: "ip", limit: 5, timeframe: 60_000, manual: true },
 * }).handle(async (c) => {
 *   if (!await checkPassword(c.body)) {
 *     await c.ratelimiting.consume();
 *     throw c.error({ status: 401, code: "INVALID_CREDENTIALS" });
 *   }
 *   await c.ratelimiting.reset();
 *   return signIn(c.body);
 * });
 * ```
 */
export function RatelimitPlugin(
  options: RatelimitPluginOptions = {},
): ServerPlugin<
  { ratelimiting: RatelimitingHelpers },
  RatelimitRouteConfigExtension
> {
  const store = options.store ?? new InMemoryRatelimitStore();
  const defaultAlgorithm: RatelimitAlgorithmName =
    options.defaultAlgorithm ?? "fixed-window";
  const hookOrder = options.hookOrder ?? -500;
  const headersMode = options.headers ?? "standard";
  const scopeOptions: ScopeResolverOptions = {
    userId: options.userId ?? defaultUserId,
    clientIp: options.clientIp ?? defaultClientIp,
  };
  const onLimitReached = options.onLimitReached;

  return {
    id: "pumice.js/ratelimit",
    unique: true,
    apply({ server }) {
      const routes = (server as { routes: unknown }).routes as {
        addFromCurrentFile: (
          definition: RouteDefinition<object, undefined, object, object>,
        ) => string;
      };

      const originalAddFromCurrentFile = routes.addFromCurrentFile.bind(routes);

      routes.addFromCurrentFile = (definition) => {
        return originalAddFromCurrentFile({
          ...definition,
          beforeValidationHooks: [
            ...(definition.beforeValidationHooks ?? []),
            {
              order: hookOrder,
              run: async (context, routeConfig) => {
                const config = (
                  routeConfig as RatelimitRouteConfigExtension | undefined
                )?.ratelimit;
                const { rules } = normalizeRouteConfig(config);

                const runtimeRules: RuleRuntime[] = [];
                for (let index = 0; index < rules.length; index += 1) {
                  const runtime = await buildRuleRuntime(
                    context as Context,
                    rules[index]!,
                    index,
                    store,
                    defaultAlgorithm,
                    scopeOptions,
                  );
                  if (runtime) runtimeRules.push(runtime);
                }

                (
                  context as unknown as {
                    ratelimiting: RatelimitingHelpers;
                  }
                ).ratelimiting = createRatelimitingHelpers(runtimeRules);

                if (runtimeRules.length === 0) return;

                const states: RatelimitState[] = [];
                for (const runtime of runtimeRules) {
                  const evaluation = await evaluateRule(runtime, {});
                  states.push(evaluation.state);

                  if (!evaluation.allowed) {
                    const tightestState = evaluation.state;
                    applyRatelimitHeaders(
                      context as Context,
                      tightestState,
                      headersMode,
                    );

                    const info: RatelimitLimitReachedInfo = {
                      rule: runtime.rule,
                      key: runtime.key,
                      state: tightestState,
                      retryAfterMs: evaluation.retryAfterMs,
                      blocked: evaluation.blocked,
                    };

                    const response = onLimitReached
                      ? await onLimitReached(context as Context, info)
                      : defaultLimitReachedResponse(
                          evaluation.retryAfterMs,
                          evaluation.blocked,
                        );

                    if (!response.headers.get("Retry-After")) {
                      response.headers.set(
                        "Retry-After",
                        String(
                          Math.max(1, Math.ceil(evaluation.retryAfterMs / 1000)),
                        ),
                      );
                    }
                    return response;
                  }
                }

                applyRatelimitHeaders(
                  context as Context,
                  pickMostRestrictive(states),
                  headersMode,
                );
                return undefined;
              },
            },
          ],
        });
      };
    },
  };
}

/**
 * Re-export of the bundled in-memory store implementation so users can
 * compose it (e.g., wrap with logging) without reaching into internals.
 */
export { InMemoryRatelimitStore } from "./store.js";
