# PumiceJS (`pumice.js`)

A file-system based, end-to-end typed server framework for Node.js — built on
[Hono](https://hono.dev/) and [Zod](https://zod.dev/).

Write a folder of route files, get a validated, typed, introspectable HTTP
API without ceremony.

---

## Highlights

- **File-system routing** — `src/routes/**` becomes your URL tree. Dynamic
  segments (`[id]`), static-beats-dynamic priority, and routing groups
  (`(auth)`) for organization without URL pollution.
- **Fluent, fully typed route builder** — `server.route().params().post().body().response().throws().handle(...)`. Body, query, headers, params, response, and thrown errors are all validated at runtime and typed at compile time.
- **Procedures** — reusable, typed request-time logic (auth checks, resource
  loading) that merge params with routes and contribute typed values to
  `c.procedures`.
- **Middleware** — directory-scoped `(c, next)` middleware via
  `middleware.ts` / `*.mw.ts`. Respects routing groups.
- **Plugins** — first-class extension model with typed context contributions,
  route config extensions, and context refinements. Ships with CORS, logger,
  authentication, and client-manifest generation.
- **Typed response envelope** — uniform success/error JSON shape
  (`{ code, message, data }`), with `c.returns(...)`, `c.response(...)`, and
  `c.error(...)` helpers that stay aligned with the declared schemas.
- **Client manifest** — introspect every route, method, and schema at runtime
  for codegen tooling.
- **File uploads** — `.file()` and `.files()` schema slices with type-safe
  access to parsed multipart uploads.

---

## Installation

```bash
npm install pumice.js zod
```

`pumice.js` re-exports `z` from Zod for convenience.

---

## Quick Start

### 1. Create a shared server

```ts
// src/server.ts
import { ServerBuilder, LoggerPlugin, CorsPlugin } from "pumice.js";

export const server = new ServerBuilder()
  .use(new LoggerPlugin())
  .use(new CorsPlugin({ origin: "*" }))
  .config({ routes: { /* server-wide route defaults */ } })
  .build();
```

### 2. Boot it

```ts
// src/index.ts
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { server } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Match route discovery to the current runtime tree
// (src in dev, dist/src after build).
await server
  .config({}) // any additional runtime config
  .listen({ port: 3000 });
```

> Under the hood, `server.listen()` discovers every file under
> `<rootDir>/<basePath>` (defaults: `<cwd>/src/routes`) and registers the
> routes it finds.

### 3. Write a route file

```ts
// src/routes/users/[id]/route.ts
import { z } from "pumice.js";
import { server } from "../../../server.js";

const UserSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  email: z.email(),
});

server
  .route()
  .params(z.object({ id: z.coerce.number().int().positive() }))
  .get()
  .describe("Fetch a user by id")
  .response(UserSchema)
  .throws({ 404: z.void() })
  .handle(async (c) => {
    const user = await db.users.find(c.params.id);
    if (!user) throw 404;
    return user;
  });
```

---

## File-Based Routing

Routes are discovered from `<rootDir>/<basePath>` (defaults: `<cwd>/src` and
`routes`). Any `.ts`/`.js`/`.mts`/`.cts`/`.mjs`/`.cjs` file under that tree
can register routes.

```
src/routes/
  route.ts                     -> /
  users/
    route.ts                   -> /users
    [id]/
      route.ts                 -> /users/:id
      posts/
        [postId]/route.ts      -> /users/:id/posts/:postId
```

### Conventions

| File / folder name | Meaning |
|---|---|
| `route.ts` or `index.ts` | Route handler file (treated as the path's leaf) |
| `[param]` | Dynamic URL segment → `:param` |
| `(group)` | **Routing group** — directory boundary for organization, middleware scope, and file grouping. **Stripped from URL.** |
| `middleware.ts` | Directory-scoped middleware |
| `*.mw.ts` | Directory-scoped middleware (suffix form) |

### Routing groups

Use parentheses to group routes without changing URLs:

```
src/routes/
  (public)/
    health/route.ts            -> /health
  (auth)/
    middleware.ts              -> guards everything inside (auth)
    users/[id]/route.ts        -> /users/:id
    posts/route.ts             -> /posts
```

`(public)` and `(auth)` are scope markers only — they never appear in request
URLs. Middlewares inside them apply **only** to their subtree.

### Static-over-dynamic priority

When a static path and a dynamic path could both match, the static one wins:

```
src/routes/users/me/route.ts       -> /users/me   (matches first)
src/routes/users/[id]/route.ts     -> /users/:id  (catch-all fallback)
```

Discovery sorts files so that at every directory level, static segments
register before dynamic ones — no action needed from you.

### Discovery options

```ts
new ServerBuilder()
  .rootDir(resolve(__dirname))      // default: <cwd>/src
  .basePath("routes")               // default: "routes"
  .build();
```

---

## Route Builder

Every route is declared through a fluent chain. Stages are ordered so only
legal calls are visible at each step.

```ts
server
  .route()
  // Route-wide config (cascades to every method on this builder)
  .config({ /* RouteConfig<...> */ })
  // Route-wide params (merged with procedure params; route wins on key collisions)
  .params(z.object({ /* ... */ }))
  // Attach a procedure (optional, may be called multiple times)
  .procedure(userProcedure({ /* config */ }), { applyOnMethods: ["get"] })
  // ─── Pick a method ─────────────────────────────
  .get()                            // or .post(), .put(), .patch(), .delete(), .options(), .any()
  .describe("Human-readable description")
  .config({ /* method-level overrides */ })
  // ─── Declare the contract ─────────────────────
  .body(z.object({ /* ... */ }))    // POST/PUT/PATCH only
  .query(z.object({ /* ... */ }))
  .headers(z.object({ /* ... */ }))
  .response(z.object({ /* ... */ }))        // or { 200: ..., 201: ... }
  .throws({ 404: z.void(), 409: { /* ... */ } })
  .file({ /* FileConfig */ })                // single upload
  .files({ /* FilesConfig */ })              // array upload
  // Or drop all of the above into one call:
  .schema({ body, query, headers, response, throws })
  // ─── Handle it ────────────────────────────────
  .handle((c) => {
    // c.body, c.query, c.headers, c.params, c.file, c.files — all fully typed
    // c.procedures.<name>    — values contributed by procedures
    // c.auth                 — contributed by AuthenticationPlugin
    return { /* validated against response schema */ };
  })
  // Chain another method on the SAME path
  .post()
  .body(/* ... */)
  .handle(/* ... */);
```

### Returning & throwing

Inside a handler you have three patterns:

```ts
// 1. Implicit return — validated against the matching `response[status]`
return { id: 1, name: "Ada" };            // -> 200 by default

// 2. Explicit response with status picker
return c.response({ status: 201, data: { /* validated against response[201] */ } });

// 3. Shorthand error throws
throw 404;                                 // -> matched against throws[404] (z.void())
throw c.error({ status: 409, code: "STATE_CONFLICT", data: {...}, message: "..." });
```

All successful JSON bodies are wrapped in the envelope:

```json
{ "code": "SUCCESS", "message": "OK", "data": { /* your payload */ } }
```

Errors use the error envelope:

```json
{ "code": "STATE_CONFLICT", "message": "...", "data": { ... }, "issues": [ ... ] }
```

---

## Procedures

Procedures are reusable, typed request-time building blocks. They:

- declare a typed `.config<T>()` supplied at each use site,
- optionally declare `.params(...)` that **merge with the route's params**
  (route params win on collision),
- run inside the request pipeline after validation and before the route
  handler,
- contribute typed values to `c.procedures` on every route that attaches
  them.

### Definition

```ts
// src/procedures/user.ts
import { z } from "pumice.js";
import { server } from "../server.js";
import { repos } from "../db.js";

export const userProcedure = server
  .procedure()
  .config<{ skipOwnershipCheck?: boolean }>()
  .params(z.object({ userId: z.coerce.number().int().positive() }))
  .handle(async (c) => {
    const user = await repos.users.findUnique({ where: { id: c.params.userId } });
    if (!user) throw c.error({ status: 404, message: "User not found." });

    if (!c.config.skipOwnershipCheck && user.id !== c.auth.data.user.id) {
      throw c.error({ status: 403, message: "Forbidden." });
    }

    return { user };     // contributes c.procedures.user
  });
```

### Attach on a route

```ts
server
  .route()
  .procedure(userProcedure())                              // default config
  .procedure(userProcedure({ skipOwnershipCheck: true }),  // typed config
             { applyOnMethods: ["get"] })                  // scoped to GET only
  .params(z.object({ userId: z.coerce.number() }))
  .get()
  .handle(async (c) => {
    // c.procedures.user.user — fully typed
    return c.procedures.user.user;
  });
```

Procedures that don't apply for a given method (via `applyOnMethods`) are
typed as absent on `c.procedures` for that method — no casts, no footguns.

### Type safety across plugin refinements

Procedures inherit the server's default route config for **context
refinements**, so if you configured `authentication.required: true` as a
default, `c.auth.data` is non-undefined inside procedures too.

---

## Middleware

Middleware is scoped by directory. Put a `middleware.ts` (or any `*.mw.ts`)
file in a folder to run logic for every route beneath it. Routing groups
count as scope, so a middleware inside `(auth)/` only applies inside that
group.

### Definition

```ts
// src/routes/(auth)/middleware.ts
import { server } from "../../server.js";

server.middleware()
  .describe("Staff-only guard")
  .handle(async (c, next) => {
    if (c.auth.data.user.role !== "admin") {
      return c.json(
        { code: "FORBIDDEN", message: "Staff access required." },
        403,
      );
    }
    return next();
  });
```

### Execution order

Per request:

1. Plugin-contributed hooks (e.g. `AuthenticationPlugin` sets `c.auth`).
2. **Middleware chain** — outer-first, Hono-style `(c, next)`.
3. Route validation (params / body / query / headers / files).
4. Procedures.
5. Route handler.
6. Middleware "after" code (anything after `await next()`).

This ordering means middleware can trust plugin-contributed extensions on
`c` — the types are honest.

### Stacking

Multiple middleware files in one directory run **alphabetically**. Multiple
levels stack outer-first:

```
src/routes/
  middleware.ts                    (1st)
  (auth)/
    01-rate-limit.mw.ts            (2nd)
    02-audit-log.mw.ts             (3rd)
    middleware.ts                  (4th)
    users/[id]/
      route.ts                     ← handler
```

---

## Built-in Plugins

### `CorsPlugin`

Wraps Hono's CORS middleware.

```ts
import { CorsPlugin } from "pumice.js";

new ServerBuilder().use(
  new CorsPlugin({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
```

### `LoggerPlugin`

Request/response lifecycle logs with duration.

```ts
import { LoggerPlugin } from "pumice.js";

new ServerBuilder().use(new LoggerPlugin(/* options */));
```

### `AuthenticationPlugin`

Injects an auth state on `c.<field>` (default `c.auth`) and gates routes
whose effective config has `authentication: { required: true }`. The plugin
also contributes a **context refinement rule**: when `required: true` is in
effect, `c.<field>.data` is typed as **non-undefined** inside handlers,
procedures, and middleware.

```ts
import { AuthenticationPlugin, ServerBuilder } from "pumice.js";

type CurrentUser = { id: string; role: "user" | "admin" };

const authPlugin = AuthenticationPlugin<"auth", CurrentUser>({
  field: "auth",
  authenticator: async (c) => {
    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer ")) return { authenticated: false };
    const token = header.slice("Bearer ".length);
    return { authenticated: true, data: { id: token, role: "user" } };
  },
});

export const server = new ServerBuilder()
  .use(authPlugin)
  .config({ routes: { authentication: { required: true } } })
  .build();
```

Opt a single route out:

```ts
server
  .route()
  .get()
  .config({ authentication: { required: false } })
  .handle(() => ({ ok: true }));
```

### `RatelimitPlugin`

Pluggable request ratelimiting with four algorithms, configurable
scoping, runtime helpers on `c.ratelimiting`, and full server/route
config layering.

```ts
import { RatelimitPlugin, ServerBuilder } from "pumice.js";

new ServerBuilder()
  .use(RatelimitPlugin())
  .config({ routes: { ratelimit: { limit: 100, timeframe: 60_000 } } })
  .build();
```

The example above gives every route a default of **100 requests per
minute, per IP, per matched route pattern**. Override per route via
`route().config({ ratelimit: ... })`.

#### Algorithms

The `algorithm` field discriminates the rule shape — TypeScript only
shows the relevant fields for the algorithm you pick. `burst`, for
example, only appears on `"token-bucket"`.

| Algorithm | When to use |
|---|---|
| `"fixed-window"` (default) | Cheap, predictable. Some boundary burst. |
| `"sliding-window"` | Smoother than fixed; same memory cost. |
| `"token-bucket"` | Allow controlled bursts (`burst > limit`). |
| `"leaky-bucket"` | Smooth bursty traffic at a steady drain rate. |

```ts
// Fixed window (no algorithm field needed)
{ ratelimit: { limit: 60, timeframe: 60_000 } }

// Token bucket — `burst` only available on this variant
{ ratelimit: {
    algorithm: "token-bucket",
    limit: 60,                // refill rate (tokens per timeframe)
    timeframe: 60_000,
    burst: 120,               // max bucket capacity
  } }
```

#### Scope and `respectParams`

`scope` controls who shares a bucket. `respectParams` controls whether
path params are part of the bucket key.

```ts
// /users/[id]: each user gets their own 10/min budget (default behavior)
.config({ ratelimit: { limit: 10, timeframe: 60_000 } })

// /images/[id]: whole route shares 10/min, regardless of id
.config({ ratelimit: { limit: 10, timeframe: 60_000, respectParams: false } })

// Per-user (auth) limits, falling back to per-IP for anonymous traffic
.config({ ratelimit: {
  limit: 100,
  timeframe: 60_000,
  scope: { by: "user", fallback: "ip" },
} })
```

Available scope parts: `"ip"`, `"user"`, `"route"`, `"global"`. Compose
with an array (`["ip", "route"]`) or hand in a function for fully
custom keys.

#### Dynamic limits

`limit`, `timeframe`, `cost`, and `burst` all accept a function that
receives the request context — useful for tier-based throttling:

```ts
.config({ ratelimit: {
  limit: (c) => c.auth.data?.user.tier === "pro" ? 1000 : 100,
  timeframe: 60_000,
} })
```

The default hook order (`-500`) runs **after** `AuthenticationPlugin`
(`-1000`), so dynamic callbacks can safely read `c.auth`.

#### Multiple stacked rules

Stack rules to enforce burst + long-window limits together:

```ts
.config({ ratelimit: { rules: [
  { name: "burst",  limit: 10,   timeframe: 1_000 },     // 10/sec
  { name: "hourly", limit: 1000, timeframe: 3_600_000 }, // 1000/hr
] } })
```

A 429 fires the moment **any** rule is exceeded.

#### Runtime helpers (`c.ratelimiting`)

When the plugin is registered, every handler gets a `c.ratelimiting`
object for explicit control:

```ts
c.ratelimiting.consume(n?)    // increment by N (default 1)
c.ratelimiting.block(ms)      // hard-block this scope for `ms` ms
c.ratelimiting.reset()        // wipe counters and any active block
c.ratelimiting.peek()         // { limit, remaining, resetAt }

// Target a single named rule
c.ratelimiting("burst").reset()
```

The killer pattern is **manual mode** combined with these helpers —
e.g. failed-login throttling:

```ts
server.route().post().config({
  ratelimit: {
    scope: "ip",
    limit: 5,
    timeframe: 60_000,
    manual: true,   // hook checks the bucket but doesn't auto-consume
  },
}).body(z.object({ email: z.string(), password: z.string() }))
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
    await c.ratelimiting.reset(); // clear failed-attempt counter on success
    return { ok: true };
  });
```

#### Disabling

```ts
.config({ ratelimit: false })                // shorthand
.config({ ratelimit: { rules: [...], disabled: true } }) // drop the whole stack
.config({ ratelimit: { ..., disabled: true } })          // drop a single rule
```

#### Custom store

The default `InMemoryRatelimitStore` works for single-instance servers.
For distributed deployments, supply your own `RatelimitStore`:

```ts
import { RatelimitPlugin, type RatelimitStore } from "pumice.js";

const redisStore: RatelimitStore = {
  async get(key) { /* HGETALL */ },
  async set(key, record) { /* HSET + EXPIRE */ },
  async delete(key) { /* DEL */ },
};

new ServerBuilder().use(RatelimitPlugin({ store: redisStore }));
```

#### Plugin options

```ts
RatelimitPlugin({
  store,                  // default: InMemoryRatelimitStore
  defaultAlgorithm,       // default: "fixed-window"
  clientIp,               // default: x-forwarded-for / x-real-ip / cf-connecting-ip
  userId,                 // default: c.auth?.data?.user?.id
  hookOrder,              // default: -500 (after AuthenticationPlugin)
  headers,                // "standard" | "legacy" | "both" | false; default: "standard"
  onLimitReached,         // override the 429 response body
});
```

### `ClientGenerationPlugin`

Serves a filtered JSON manifest of every route at `GET /@client` (path
configurable) for codegen tooling. Schemas are emitted as JSON Schema.

```ts
import { ClientGenerationPlugin } from "pumice.js";

new ServerBuilder().use(
  ClientGenerationPlugin({
    path: "/@client",
    authenticator: async (c) => ({ allow: c.req.header("x-internal") === "..." }),
  }),
);
```

Hide individual routes with route config:

```ts
server.route().get().config({ exposeClient: false }).handle(() => ({ /* ... */ }));
```

---

## Custom Plugins

Plugins can contribute context extensions, route config extensions, and
context refinement rules — all typed and propagated through the server.

```ts
import type { ServerPlugin } from "pumice.js";

const RequestIdPlugin: ServerPlugin<{ requestId: string }> = {
  id: "my-app/request-id",
  unique: true,
  apply({ app }) {
    app.use(async (c, next) => {
      (c as any).requestId = crypto.randomUUID();
      await next();
    });
  },
};

// Now c.requestId: string is available on every route
```

---

## File Uploads

Declare single or multiple uploads with typed, validated access:

```ts
server
  .route()
  .post()
  .file({ fieldName: "avatar", maxSize: 2 * 1024 * 1024, mimeTypes: ["image/png", "image/jpeg"] })
  .handle((c) => {
    // c.file: { name, size, type, buffer, ... }
    return { filename: c.file.name };
  });

server
  .route()
  .post()
  .files({ fieldName: "attachments", maxCount: 5 })
  .handle((c) => c.files.map((f) => f.name));
```

---

## Server Config

Set global defaults for every route via `.config({ routes })`. Values merge
deeply with per-route `.config(...)` calls, with the route winning.

```ts
new ServerBuilder()
  .config({
    routes: {
      authentication: { required: true },
      // ...any RouteConfigExtensions contributed by plugins
    },
  })
  .build();
```

Defaults are what procedures and middleware use for their **context
refinement** typing, so choose them to match your app's baseline.

---

## Response Envelopes (low-level)

The framework-level JSON envelope is available as utilities for cases where
you want to emit responses outside the route builder (e.g. custom plugin
endpoints):

```ts
import { createApiJsonSuccessResponse, createApiJsonErrorResponse } from "pumice.js";

return createApiJsonSuccessResponse(200, { data: { ok: true } });
return createApiJsonErrorResponse(403, { code: "FORBIDDEN", message: "..." });
```

---

## API Exports

### Values

- `Server`, `ServerBuilder`
- `CorsPlugin`, `LoggerPlugin`, `AuthenticationPlugin`, `ClientGenerationPlugin`, `RatelimitPlugin`, `InMemoryRatelimitStore`
- `z` (re-export from Zod)
- `buildApiJsonSuccessBody`, `createApiJsonErrorResponse`, `createApiJsonSuccessResponse`
- `CLIENT_MANIFEST_METHOD_ORDER`

### Types

- **Server**: `ServerConstructOptions`, `ServerConfig`, `ServerListenOptions`
- **Plugins**: `ServerPlugin`, `ServerPluginContext`, `AuthState`, `Authenticator`
- **Route builder**: `RouteBuilderMethodStage`, `RouteBuilderMethodSelectionStage`, `RouteDefinition`, `RouteMethod`, `RouteConfig`, `RouteSchema`, `RouteResponseSchema`, `RouteThrowsSchema`, `RouteAuthenticationConfig`
- **Procedures**: `ProcedureBuilderStage`, `RouteProcedureDefinition`, `RouteProcedureFactory`, `RouteProcedureHandler`, `RouteProcedureHandlerContext`, `AppliedRouteProcedure`, `RouteProcedureApplyOptions`, `ProcedureParamsSchema`, `ProcedureContributions`, `InferProcedureParamsValue`, `InferAppliedProcedureContributions`, `InferMergedParamsValue`
- **Middleware**: `MiddlewareBuilderStage`, `MiddlewareHandler`, `MiddlewareHandlerContext`, `MiddlewareNext`, `MiddlewareDefinition`
- **Files**: `FileConfig`, `FilesConfig`, `UploadedFile`, `AllowedFileType`
- **Client manifest**: `ClientManifest`, `ClientManifestFramework`, `ClientManifestMeta`, `ClientManifestMethod`, `ClientManifestRoute`, `ClientManifestRoutesByPath`, `RouteManifestSource`, `ClientGenerationPluginOptions`, `ClientGenerationRouteConfigExtension`, `ClientManifestGenerationAccess`
- **JSON envelope**: `ApiJsonSuccessBody`, `ApiJsonErrorBody`
- **Plugin options**: `LoggerPluginOptions`, `RatelimitPluginOptions`
- **Ratelimit**: `RatelimitRule`, `RatelimitFixedWindowRule`, `RatelimitSlidingWindowRule`, `RatelimitTokenBucketRule`, `RatelimitLeakyBucketRule`, `RouteRatelimitConfig`, `RatelimitRouteConfigExtension`, `RatelimitScopePart`, `RatelimitScopeExpression`, `RatelimitDynamicNumber`, `RatelimitState`, `RatelimitConsumeResult`, `RatelimitingHelpers`, `RatelimitingRuleHelpers`, `RatelimitStore`, `RatelimitStateRecord`, `RatelimitLimitReachedInfo`

---

## Repository

- GitHub: [pumicejs/pumice.js](https://github.com/pumicejs/pumice.js)
- Issues: [pumicejs/pumice.js/issues](https://github.com/pumicejs/pumice.js/issues)

## License

ISC
