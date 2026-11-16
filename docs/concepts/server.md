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

Performs three steps in order (the first two are `load()`, below):

1. **`applyPlugins()`** — runs every registered plugin's `apply({ server, app })`
   exactly once. Plugins use this to mount HTTP routes (`/@client`, `/@docs`),
   wrap `routes.addFromCurrentFile`, install Hono middleware, etc.
2. **`routes.registerDiscovered()`** — walks `<rootDir>/<basePath>/**`,
   imports every `route.{ts,js,...}` / `index.{ts,js,...}` /
   `middleware.{ts,js,...}` / `*.mw.{ts,js,...}`. During import, calls to
   `server.route()` / `server.middleware()` / `server.procedure()` register
   against the file that calls them: the innermost discovered route or
   middleware file on the call stack, so a route file that imports another
   still registers each file's routes under its own path.
3. **Bind** — binds the port (and `hostname`, if given), then stamps
   `clientManifestListeningSince` so the client manifest can include it.

`listen()` resolves once the port is bound, to its address
(`{ address, family, port }`, Node's `AddressInfo`; with `port: 0` the
system picks a free port and `port` says which). It rejects when the port
can't be bound (`EADDRINUSE`, `EACCES`) and when the server is already
listening: one server has one listener at a time.

### `close()` — stopping gracefully

```ts
process.once("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
```

`close()` stops the listener without cutting anyone off. New connections
are refused at once and idle keep-alive connections are closed. Requests
under way finish and get their answers, each marked `Connection: close` so
the client doesn't send another down that connection, and the promise
resolves when the last connection has ended. It waits as long as those
requests take, so race it against your own deadline if the process has one
(a container's stop timeout). It resolves at once when the server isn't
listening, every call while it closes gets the same promise, and `listen()`
may bind again afterwards.

### `load()` and `fetch()` — without a port

```ts
await server.load(); // plugins + route discovery, once; resolves to the URL paths
const res = await server.fetch(new Request("http://test/users/1"));
```

`load()` is the first half of `listen()`: idempotent, every call resolves to
the same list of registered paths. `fetch(request, env?)` answers one request
in-process (it calls `load()` first if needed). Use them in tests, or to
mount the app on another runtime. `env` becomes Hono's bindings; on Node,
`listen()` passes the socket there, which is where the rate limiter and the
logger read the client address from. Without it, the address is unknown.

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

## Declaring models

`server.models([...])` (also `ServerBuilder.models()` and the `models`
constructor option) names the schemas the manifests describe once and route
schemas point at. Declare them before routes load: it throws once a route has
registered. See [Models](./models.md).

---

## Inspecting the server

A few methods are useful for diagnostics or codegen:

- **`server.getClientManifest()`** — JSON-serializable manifest of every
  registered route (path, params, schemas, configs, methods, hooks) and
  every declared model. This is what `ClientGenerationPlugin` serves at
  `/@client` (with the hidden routes and their models left out), and what
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
