# `RatelimitPlugin`

Pluggable request rate limiting with:

- **Four algorithms** — fixed window, sliding window, token bucket, leaky
  bucket — typed so only the relevant fields appear per choice.
- **Configurable scoping** — per IP, per user, per route, global, custom;
  composable parts; fallback chains; per-path-param granularity.
- **Stacked rules** — combine multiple (e.g. burst + hourly) on the same
  route; a 429 fires the moment any rule is exceeded.
- **Dynamic values** — `limit`, `timeframe`, `cost`, `burst` can each be a
  per-request callback (typical use: per-tier limits).
- **Runtime helpers** — `c.ratelimiting.consume()` / `block()` / `reset()` /
  `peek()`, optionally scoped to a named rule.
- **Manual mode** — let the framework _check_ the bucket but make the
  handler decide when to _consume_ (failed-login throttling, etc.).
- **Pluggable persistence** — in-memory by default; swap for Redis / KV /
  whatever in distributed setups.

```ts
import { RatelimitPlugin } from "pumice.js";

server
  .use(RatelimitPlugin())
  .config({ routes: { ratelimit: { limit: 100, timeframe: 60_000 } } });
```

This gives every route a default of **100 requests per minute, per IP,
per matched route pattern**. Override per route with
`route().config({ ratelimit: ... })`.

---

## Identity

- Factory: `RatelimitPlugin(options)`
- Id: `"pumice.js/ratelimit"`
- `unique: true` — registering twice throws.

---

## Plugin options — `RatelimitPluginOptions`

| Field | Type | Default | Effect |
|---|---|---|---|
| `store` | `RatelimitStore` | `new InMemoryRatelimitStore()` | Persistence layer; swap for Redis-backed in distributed setups |
| `defaultAlgorithm` | `"fixed-window" \| "sliding-window" \| "token-bucket" \| "leaky-bucket"` | `"fixed-window"` | Algorithm used when a rule doesn't specify one |
| `clientIp` | `(c: Context) => string \| undefined` | x-forwarded-for / x-real-ip / cf-connecting-ip / true-client-ip | Custom client-IP resolver used by the `"ip"` scope part |
| `userId` | `(c: Context) => string \| undefined \| Promise<...>` | `c.auth?.data?.user?.id` | Custom user-id resolver used by the `"user"` scope part |
| `hookOrder` | `number` | `-500` | Pre-validation hook order. Default places this after `AuthenticationPlugin` (`-1000`) so dynamic callbacks can read `c.auth` |
| `headers` | `"standard" \| "legacy" \| "both" \| false` | `"standard"` | Which informational headers to emit. `Retry-After` is always emitted on 429. |
| `onLimitReached` | `(c, info) => Response \| Promise<Response>` | 429 JSON envelope with `code: "RATE_LIMITED"` | Custom rejection response |

### Headers

| Mode | Headers emitted on every response |
|---|---|
| `"standard"` (default) | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (RFC draft) |
| `"legacy"` | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` |
| `"both"` | Both of the above |
| `false` | No informational headers (still emits `Retry-After` on 429) |

---

## Route-config — `ratelimit: <config>`

Three forms:

```ts
// 1. False — disable for this route
.config({ ratelimit: false })

// 2. Single rule (defaults: algorithm=fixed-window, scope=["ip", "route"])
.config({ ratelimit: { limit: 60, timeframe: 60_000 } })

// 3. Multiple rules — 429 if any one is exceeded
.config({
  ratelimit: {
    rules: [
      { name: "burst",  limit: 10,   timeframe: 1_000 },
      { name: "hourly", limit: 1000, timeframe: 3_600_000 },
    ],
  },
})
```

---

## Algorithms

The `algorithm` field discriminates the rule shape. TypeScript only shows
the fields relevant to the algorithm you chose — `burst`, for example, is
only available on `"token-bucket"`.

| Algorithm | When to use |
|---|---|
| `"fixed-window"` (default) | Cheap, predictable. Some boundary burst. |
| `"sliding-window"` | Smoother than fixed; same memory cost. |
| `"token-bucket"` | Allow controlled bursts (`burst > limit`). |
| `"leaky-bucket"` | Smooth bursty traffic at a steady drain rate. |

```ts
// Fixed window (default, no algorithm field needed)
{ limit: 60, timeframe: 60_000 }

// Sliding window
{ algorithm: "sliding-window", limit: 60, timeframe: 60_000 }

// Token bucket — `burst` only available on this variant
{
  algorithm: "token-bucket",
  limit: 60,                  // refill rate (tokens per timeframe)
  timeframe: 60_000,
  burst: 120,                 // max bucket capacity
}

// Leaky bucket
{
  algorithm: "leaky-bucket",
  limit: 60,                  // bucket capacity
  timeframe: 60_000,          // time to fully drain
}
```

### `limit` / `timeframe` per algorithm

- **`fixed-window` / `sliding-window`** — `limit` requests per `timeframe`
  ms window.
- **`token-bucket`** — `limit` tokens refilled over `timeframe` ms;
  optional `burst` for max capacity.
- **`leaky-bucket`** — bucket capacity `limit`; fully drains over
  `timeframe` ms.

---

## Scope and `respectParams`

`scope` controls who shares a bucket. `respectParams` controls whether path
params are part of the bucket key.

```ts
// /users/[id]: each user gets their own 10/min budget (default behavior)
.config({ ratelimit: { limit: 10, timeframe: 60_000 } })

// /images/[id]: whole route shares 10/min regardless of id
.config({ ratelimit: { limit: 10, timeframe: 60_000, respectParams: false } })

// Per-user (auth) limits, falling back to per-IP for anonymous traffic
.config({ ratelimit: {
  limit: 100,
  timeframe: 60_000,
  scope: { by: "user", fallback: "ip" },
} })

// Only count the userId path param into the bucket key, ignore others
.config({ ratelimit: { limit: 10, timeframe: 60_000, respectParams: ["userId"] } })
```

### `RatelimitScopeExpression`

| Form | Meaning |
|---|---|
| `"ip"` | One bucket per client IP |
| `"user"` | One bucket per authenticated user (`userId` option, default `c.auth?.data?.user?.id`) |
| `"route"` | One bucket per matched route pattern |
| `"global"` | One bucket for all requests, everywhere |
| `["ip", "route"]` | Compose parts with `|` (default for unspecified scopes) |
| `{ by: "user", fallback: "ip" }` | Use `by`; fall back when unavailable (anon requests) |
| `(c) => string \| Promise<string>` | Fully custom key |

---

## Dynamic values

`limit`, `timeframe`, `cost`, and `burst` all accept a function that
receives the request context. Typical use: per-tier throttling.

```ts
.config({ ratelimit: {
  limit: (c) => c.auth.data?.user.tier === "pro" ? 1000 : 100,
  timeframe: 60_000,
} })
```

Because the default `hookOrder` (`-500`) runs **after** `AuthenticationPlugin`
(`-1000`), `c.auth` is populated by the time these callbacks fire.

`cost` is "how many tokens this request consumes" (default `1`). Useful
for weighting expensive endpoints inside a shared bucket:

```ts
.config({ ratelimit: {
  limit: 100,
  timeframe: 60_000,
  cost: (c) => c.body.bulk ? 10 : 1,
} })
```

---

## Stacked rules

```ts
.config({ ratelimit: { rules: [
  { name: "burst",  limit: 10,   timeframe: 1_000 },     // 10/sec
  { name: "hourly", limit: 1000, timeframe: 3_600_000 }, // 1000/hr
] } })
```

A 429 fires the moment **any** rule is exceeded. The 429 response
includes headers from the most restrictive rule.

Naming rules is what lets you target one with `c.ratelimiting("name")`
helpers (next section).

---

## Manual mode + `c.ratelimiting` helpers

When the plugin is registered, every handler gets a `c.ratelimiting` object:

```ts
c.ratelimiting.consume(n?: number): Promise<RatelimitConsumeResult>
c.ratelimiting.block(durationMs: number): Promise<void>
c.ratelimiting.reset(): Promise<void>
c.ratelimiting.peek(): Promise<RatelimitState>

// Target a single named rule
c.ratelimiting("burst").consume()
c.ratelimiting("hourly").reset()
```

The killer pattern is **manual mode** combined with these helpers — the
pre-validation hook checks the bucket (to enforce hard blocks) but does
not auto-consume on every request. The handler decides whether the
attempt deserves to count.

```ts
// Failed-login throttling
server.route().post().config({
  ratelimit: {
    scope: "ip",
    limit: 5,
    timeframe: 60_000,
    manual: true,                          // hook checks, doesn't auto-consume
  },
})
  .body(z.object({ email: z.string(), password: z.string() }))
  .handle(async (c) => {
    const ok = await checkPassword(c.body.email, c.body.password);
    if (!ok) {
      await c.ratelimiting.consume();
      const { remaining } = await c.ratelimiting.peek();
      if (remaining === 0) {
        await c.ratelimiting.block(60 * 60_000); // 1h lockout
      }
      return c.error({ status: 401, code: "INVALID_CREDENTIALS" });
    }
    await c.ratelimiting.reset();          // wipe failed-attempt counter
    return { ok: true };
  });
```

### Helpers return / state types

```ts
type RatelimitState = {
  limit: number;          // configured limit
  remaining: number;      // requests still allowed before 429
  resetAt: number;        // epoch ms when bucket fully resets
};

type RatelimitConsumeResult = RatelimitState & {
  allowed: boolean;       // true if the request may proceed
  retryAfterMs: number;   // suggested wait before retrying (0 when allowed)
};
```

For multi-rule routes, `consume()` / `peek()` without a rule name target
**every** rule and return the most restrictive result.

---

## Skip / disable

```ts
// Per-rule skip predicate
.config({ ratelimit: { limit: 100, timeframe: 60_000, skip: (c) => c.req.header("x-internal") === "..." } })

// Disable a single rule without removing from config
.config({ ratelimit: { ..., disabled: true } })

// Disable a whole stack without removing
.config({ ratelimit: { rules: [...], disabled: true } })

// Shorthand: disable entirely for this route
.config({ ratelimit: false })
```

`disabled` is convenient when staging rollouts via dynamic config — you
keep the rule definition in the codebase, then flip a flag at deploy time.

---

## Custom store — distributed deployments

The default `InMemoryRatelimitStore` only works for single-instance
servers (each pod has its own counters). For multi-instance setups,
implement `RatelimitStore`:

```ts
import { RatelimitPlugin, type RatelimitStore, type RatelimitStateRecord } from "pumice.js";

const redisStore: RatelimitStore = {
  async get(key) {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) as RatelimitStateRecord : undefined;
  },
  async set(key, record) {
    const ttl = Math.max(0, record.expiresAt - Date.now());
    await redis.set(key, JSON.stringify(record), "PX", ttl);
  },
  async delete(key) {
    await redis.del(key);
  },
};

server.use(RatelimitPlugin({ store: redisStore }));
```

`RatelimitStateRecord` is the opaque envelope the store persists — the
algorithm-private payload lives inside `record.data`. The store should
treat `data` as fully opaque.

---

## `onLimitReached` — customize the 429

```ts
RatelimitPlugin({
  onLimitReached: (c, info) => {
    if (info.blocked) {
      return new Response(JSON.stringify({
        code: "ACCOUNT_LOCKED",
        message: "Too many failed attempts — locked.",
        retryAfter: Math.ceil(info.retryAfterMs / 1000),
      }), { status: 429, headers: { "content-type": "application/json" } });
    }
    return createApiJsonErrorResponse(429, {
      code: "RATE_LIMITED",
      message: `Try again in ${Math.ceil(info.retryAfterMs / 1000)}s.`,
    });
  },
});
```

`info` includes the offending rule, the resolved bucket key, the bucket
state, the suggested retry delay, and whether the rejection came from a
hard block (vs simply running out of budget).

---

## Plugin contributions

| Slot | Contribution |
|---|---|
| `TContextExtensions` | `{ ratelimiting: RatelimitingHelpers }` |
| `TRouteConfigExtensions` | `{ ratelimit?: RouteRatelimitConfig }` |
| `TContextRefinementRules` | _(none)_ |

---

## Recipes

### Per-user-tier with anon fallback

```ts
.config({ ratelimit: {
  limit: (c) => c.auth.data?.user.tier === "pro" ? 1000 : 100,
  timeframe: 60_000,
  scope: { by: "user", fallback: "ip" },
} })
```

### Public read, throttled write

```ts
server
  .route()
  .params(z.object({ id: z.coerce.number() }))
  .get().config({ ratelimit: false }).handle(...)
  .delete().config({ ratelimit: { limit: 10, timeframe: 60_000 } }).handle(...);
```

### Burst-friendly API

```ts
.config({ ratelimit: {
  algorithm: "token-bucket",
  limit: 60,                  // 60/min steady
  timeframe: 60_000,
  burst: 200,                 // bursts up to 200
} })
```

### Hard-lock after a streak of failures

(See manual-mode example above — the combination of `manual: true`,
`consume()`, `peek()`, and `block()` is the canonical pattern.)

---

## Related

- [Plugins](../concepts/plugins.md) — extension model
- [`AuthenticationPlugin`](./authentication.md) — provides `c.auth.data` for `userId` resolution
- [Server config](../concepts/server.md#configuration) — set ratelimit defaults globally
