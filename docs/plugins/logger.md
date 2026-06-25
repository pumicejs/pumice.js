# `LoggerPlugin`

Single-line request and response logs for every request that flows through
the server — including 404s and 500s. Installs as a Hono middleware at `*`
so it observes everything before, during, and after the route pipeline.

```ts
import { LoggerPlugin } from "pumice.js";

server.use(new LoggerPlugin());
```

Two lines per request out of the box:

```text
[REQUEST]  GET  /users/7 ip=203.0.113.5 ua="Mozilla/5.0 ..."
[RESPONSE] GET  /users/7 status=200 duration_ms=12 content_length=128
```

When a handler throws an uncaught error, the response line includes
`error=true` and the error is re-thrown so other layers (your own
`try/catch`, the framework's 500 envelope) keep working.

---

## Identity

- Class: `LoggerPlugin`
- Not marked `unique` — you can register multiple instances if you want
  parallel destinations (rare; piping a single logger to multiple sinks is
  usually cleaner).

---

## Options — `LoggerPluginOptions`

| Field | Type | Default | Effect |
|---|---|---|---|
| `logger` | `{ info(line): void; error(line): void }` | `console` | Where lines go. Swap for pino, winston, etc. |
| `logRequestStart` | `boolean` | `true` | Emit the `[REQUEST]` line when the request begins |
| `logResponseEnd` | `boolean` | `true` | Emit the `[RESPONSE]` line when the response finishes |

### Pipe into a structured logger

```ts
import pino from "pino";

const log = pino();

new LoggerPlugin({
  logger: {
    info: (line) => log.info({ line }, "request"),
    error: (line) => log.error({ line }, "request_error"),
  },
});
```

The plugin only calls `logger.info(line: string)` and `logger.error(line: string)`,
where `line` is a pre-formatted text line. If you want structured fields
instead of text, replace the plugin with a small custom plugin that wraps
Hono middleware and emits whatever shape you want.

### Halve log volume (response-only)

```ts
new LoggerPlugin({ logRequestStart: false });
```

Useful when you only care about completed requests + their status.

---

## Log format

### `[REQUEST]` line

```text
[REQUEST] <METHOD> <PATH> ip=<CLIENT_IP> ua="<USER_AGENT>"
```

- `METHOD` — HTTP method.
- `PATH` — `c.req.path` (no query string).
- `CLIENT_IP` — resolved from `x-forwarded-for` (first entry) →
  `x-real-ip` → `cf-connecting-ip`, falling back to `"unknown"`.
- `USER_AGENT` — `User-Agent` header verbatim (or `"unknown"`).

### `[RESPONSE]` line — normal case

```text
[RESPONSE] <METHOD> <PATH> status=<CODE> duration_ms=<MS> content_length=<BYTES_OR_UNKNOWN>
```

- `duration_ms` is wall-clock time from the start of the middleware.
- `content_length` reads `Content-Length` from the response headers, or
  `"unknown"` when not set (streaming, redirects, etc.).

### `[RESPONSE]` line — uncaught error

```text
[RESPONSE] <METHOD> <PATH> status=500 duration_ms=<MS> error=true
```

The original exception is re-thrown after logging, so downstream error
handlers still see it.

---

## Plugin contributions

None — no context fields, no route-config keys, no refinement rules.
Pure logging.

---

## Recipes

### Filter by status

`LoggerPlugin` always logs every request. To skip noisy successes:

```ts
new LoggerPlugin({
  logger: {
    info: (line) => {
      if (line.includes("[RESPONSE]") && line.includes("status=200")) return;
      console.info(line);
    },
    error: console.error,
  },
});
```

For more sophisticated routing (per-route, per-path), write a small custom
plugin that wraps `app.use("*", ...)` directly and runs whatever logic
you want.

### Correlate with request ids

Combine with your own request-id plugin (see [Plugins → tracing
example](../concepts/plugins.md#putting-it-together-a-tracing-plugin))
and include `c.requestId` in your structured logger's payload — you'll
end up with one log entry per request that ties together middleware logs,
audit logs, and the lifecycle line.

---

## Related

- [Plugins](../concepts/plugins.md) — the extension model
- [Middleware](../concepts/middleware.md) — for per-directory logging
