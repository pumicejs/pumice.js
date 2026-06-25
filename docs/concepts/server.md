# Server & ServerBuilder

`Server` is the central object: it owns the underlying [Hono](https://hono.dev/)
app, the route manager, the plugin registry, and the server-wide route config.
Everything else in `pumice.js` — routes, procedures, middleware, plugins —
hangs off it.

There are two ways to construct one:

- `new Server(options)` — direct construction; chainable with `.use()`,
  `.config()`.
- `new ServerBuilder().{...}.build()` — fluent expression that collects
  every option in one place before instantiation.

They produce the same instance and have the same generics. Use whichever
reads better in your codebase.

---

## Direct construction

```ts
import { Server } from "pumice.js";

export const server = new Server({
  basePath: "routes",                  // default: "routes"
  rootDir: process.cwd() + "/src",     // default: <cwd>/src
  config: {
    routes: {
      // server-wide defaults
    },
  },
});
```

Then plugins / config layer on:

```ts
server
  .use(new LoggerPlugin())
  .use(AuthenticationPlugin({ authenticator }))
  .config({ routes: { authentication: { required: true } } });
```

---

## Fluent construction (`ServerBuilder`)

```ts
import { ServerBuilder, LoggerPlugin, AuthenticationPlugin } from "pumice.js";

export const server = new ServerBuilder()
  .basePath("routes")
  .rootDir(import.meta.dirname)
  .use(new LoggerPlugin())
  .use(AuthenticationPlugin({ authenticator }))
  .config({ routes: { authentication: { required: true } } })
  .build();
```

The builder is type-equivalent to direct construction — every `.use(...)`
narrows the generics of the eventual `Server`, so plugin-contributed fields
on `c` and per-route config keys are visible everywhere.

> **Order rule**: `.build()` materializes the server with the accumulated
> options and replays each `.use(...)` against it. Plugins are not _applied_
> yet — they apply once when you call `server.listen()`.

---

## Lifecycle

### Construction phase

When the `Server` is created:

1. The Hono app is instantiated.
2. The 404 handler is wired (returns a `NOT_FOUND` JSON envelope).
3. The `RouteManager` is created against the configured `rootDir` /
   `basePath`.

No files are loaded; no port is bound.

### `listen()` phase

```ts
await server.listen({ port: 3000 });
```

Performs three steps in order:

1. **`applyPlugins()`** — runs every registered plugin's `apply({ server, app })`
   exactly once. Plugins use this to mount HTTP routes (`/@client`, `/@docs`),
   wrap `routes.addFromCurrentFile`, install Hono middleware, etc.
2. **`routes.registerDiscovered()`** — walks `<rootDir>/<basePath>/**`,
   imports every `route.{ts,js,...}` / `index.{ts,js,...}` /
   `middleware.{ts,js,...}` / `*.mw.{ts,js,...}`. During import, calls to
   `server.route()` / `server.middleware()` / `server.procedure()` register
   against the file currently being loaded.
3. **`serve()`** — binds the port. On the `listening` callback, the server
   stamps `clientManifestListeningSince` so the client manifest can include
   it.

Calling `listen()` twice doesn't re-apply plugins (it's idempotent on that
front), but it _will_ rediscover routes and bind a second listener — you
typically never want that.

---

## Configuration

`server.config({ routes: {...} })` sets server-wide defaults that every
route inherits, then deep-merges with route-level and method-level
`.config(...)` calls (method wins over route, route wins over server).

```ts
server.config({
  routes: {
    authentication: { required: true },             // from AuthenticationPlugin
    ratelimit: { limit: 100, timeframe: 60_000 },   // from RatelimitPlugin
    exposeClient: true,                             // from ClientGenerationPlugin
    docs: { tags: ["internal"] },                   // from DocsPlugin
  },
});
```

You can call `.config(...)` multiple times — each call deep-merges into the
previous one. The same call returns the server with its generics **narrowed**
to reflect the new defaults, so [context refinements](./plugins.md#context-refinements)
(like `c.auth.data` becoming non-optional) propagate to every route handler,
procedure, and middleware automatically.

### Why defaults matter for types

Plugins like `AuthenticationPlugin` register a conditional refinement: "when
the route's effective config has `authentication.required: true`, narrow
`c.auth` to the authenticated shape". The refinement looks at **effective
config**, which is the result of merging server defaults + route-level
config + method-level config. If you set `authentication.required: true` at
the server level, every handler sees the narrowed type unless a route
explicitly opts out via `.config({ authentication: { required: false } })`.

---

## Registering plugins

`server.use(plugin)` is how every shipped or custom plugin attaches:

```ts
server
  .use(new CorsPlugin({ origin: "*" }))
  .use(AuthenticationPlugin({ authenticator }))
  .use(RatelimitPlugin())
  .use(ClientGenerationPlugin())
  .use(DocsPlugin({ tags: [...], groups: [...] }));
```

Each `.use(...)` returns the server with:

- `TContextExtensions` widened (`c.auth`, `c.ratelimiting`, ...)
- `TRouteConfigExtensions` widened (`config.authentication`, `config.ratelimit`, ...)
- `TContextRefinementRules` widened (new conditional narrowings)

`TDefaultRouteConfig` is unchanged by `.use(...)` — only `.config(...)`
narrows it.

Plugins with `unique: true` (most shipped ones) throw at registration time
if added twice with the same `id`. Custom plugins can opt into this — see
[Plugins — Identity and uniqueness](./plugins.md#identity-and-uniqueness).

---

## Inspecting the server

A few methods are useful for diagnostics or codegen:

- **`server.getClientManifest()`** — JSON-serializable manifest of every
  registered route (path, params, schemas, configs, methods, hooks). This
  is what `ClientGenerationPlugin` serves at `/@client`, and what
  `DocsPlugin` reads to build its grouping.
- **`server.routes`** — the underlying `RouteManager`. Plugins that want
  to attach behavior per route wrap `server.routes.addFromCurrentFile`
  (this is how `AuthenticationPlugin` injects its `beforeValidationHook`).

These are intentionally low-level — for typical apps you should never need
to touch `server.routes` directly.

---

## `Server` vs `ServerBuilder` — when to use which

| Situation | Pick |
|---|---|
| You have a single config block that's already complete | `ServerBuilder` |
| You want plugins to be registered conditionally based on env | Either, but `Server` reads cleaner with `if`s |
| You're writing a plugin or library that takes a `Server` | Accept `Server` |
| You need the generics to compose across modules | `ServerBuilder`, then export `typeof builder.build()` |

---

## Related

- [Plugins](./plugins.md) — the extension model that powers `use()`.
- [Route Builder](./route-builder.md) — what `server.route()` returns.
- [File-Based Routing](./routing.md) — how `listen()` discovers files.
