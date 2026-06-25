# Plugins

Plugins are the framework's extension model. A plugin can:

1. **Mount HTTP routes** on the underlying Hono app (CORS handlers,
   `/@client`, `/@docs`).
2. **Add fields to the request context** — `c.auth`, `c.ratelimiting`, any
   custom value.
3. **Add keys to the per-route config** — `authentication`, `ratelimit`,
   `exposeClient`, `docs`, anything you want.
4. **Install pre-validation hooks** in the route pipeline (authenticator,
   ratelimit check).
5. **Refine context types conditionally** — make `c.auth.data` non-optional
   when the route's effective config has `authentication.required: true`.

Everything plugin-shaped is **typed end-to-end** — registering a plugin
narrows the server's generics so the new context fields and route-config
keys appear in handlers, procedures, and middleware automatically.

This page documents how to author a plugin and explains the moving parts
of the plugin contract. For docs on each shipped plugin, see the
[plugins/ folder](../plugins/).

---

## The contract

```ts
import type { ServerPlugin } from "pumice.js";

type MyContextExtensions = { requestId: string };
type MyRouteConfigExtensions = { trace?: boolean };
type MyContextRefinementRules = never; // can add later

const RequestIdPlugin: ServerPlugin<
  MyContextExtensions,
  MyRouteConfigExtensions,
  MyContextRefinementRules
> = {
  id: "my-app/request-id",
  unique: true,
  apply({ server, app }) {
    app.use(async (c, next) => {
      (c as any).requestId = crypto.randomUUID();
      await next();
    });
  },
};
```

A plugin is just an object with three generic slots and an `apply()`
method. The slots are how it threads its contributions into the type
system; `apply()` is how it wires runtime behavior.

### Factory vs class

Both shapes work — pick whichever reads better:

```ts
// Factory (used by AuthenticationPlugin, RatelimitPlugin, ClientGenerationPlugin, DocsPlugin)
export function AuthenticationPlugin(options) : ServerPlugin<...> {
  return { id: "...", unique: true, apply({ server, app }) { ... } };
}

// Class (used by CorsPlugin, LoggerPlugin)
export class CorsPlugin implements ServerPlugin {
  constructor(private options?: CorsPluginOptions) {}
  apply({ app }) { app.use("*", cors(this.options)); }
}
```

Factories let you use generics on the options (e.g.
`AuthenticationPlugin<TField, TData>` propagates the auth data shape
through to `c.auth.data`). Classes are nicer when there's no per-instance
generic to thread.

---

## The four contribution slots

### 1. Context extensions (`TContext`)

Fields the plugin adds to every route / middleware / procedure `c`.

```ts
type RatelimitingContext = { ratelimiting: RatelimitingHelpers };
const plugin: ServerPlugin<RatelimitingContext> = { ... };
```

After `server.use(plugin)`, the resulting `Server` has `c.ratelimiting`
typed in every handler.

**At runtime**, your `apply()` is responsible for actually attaching the
field — typically by installing a Hono middleware that mutates `c`, or by
wrapping the route pipeline.

The type system doesn't enforce that you do — adding to `TContext`
without actually populating `c` produces runtime undefined.

### 2. Route config extensions (`TRouteConfigExtensions`)

Keys the plugin adds to per-route `RouteConfig`.

```ts
type RatelimitRouteConfigExtension = { ratelimit?: RouteRatelimitConfig };
const plugin: ServerPlugin<{}, RatelimitRouteConfigExtension> = { ... };
```

After registration, every `.route().config({...})` / `.method().config({...})` /
`server.config({ routes: {...} })` will type-check that new key.

You typically **read** the effective config inside a `beforeValidationHook`
attached during `apply()`:

```ts
apply({ server }) {
  const routes = (server as any).routes;
  const original = routes.addFromCurrentFile.bind(routes);
  routes.addFromCurrentFile = (definition) => original({
    ...definition,
    beforeValidationHooks: [
      ...(definition.beforeValidationHooks ?? []),
      {
        order: -500,
        run: async (context, routeConfig) => {
          if (routeConfig?.ratelimit === false) return;
          // ... rate-limit logic
        },
      },
    ],
  });
}
```

The pattern of wrapping `routes.addFromCurrentFile` is how both
`AuthenticationPlugin` and `RatelimitPlugin` install per-route pre-validation
behavior driven by their own config keys.

### 3. Context refinement rules (`TContextRefinementRules`)

Type-only conditional narrowings. Read: "when a route's effective config
matches `when`, merge `patch` into the route's context type".

```ts
type AuthRequiredRule<TField extends string, TData> = ContextRefinementRule<
  { authentication: { required: true } },
  Record<TField, { authenticated: true; data: TData }>
>;

const plugin: ServerPlugin<{ auth: AuthState<TData> }, AuthRouteConfig, AuthRequiredRule<"auth", TData>> = { ... };
```

For routes whose effective config has `authentication.required: true`,
`c.auth` is narrowed from `AuthState<TData>` (where `data?: TData`) to
`{ authenticated: true; data: TData }` — i.e. `c.auth.data` becomes
non-optional and non-undefined.

Refinements are purely type-level — they have **no runtime cost** and
contribute **no runtime behavior**. The runtime guarantee they encode is
provided by the plugin's hook (the 401 short-circuit, in the auth example);
the refinement just tells TypeScript "we already proved this can't happen".

Refinements live on _the effective merged config_, so they fire whether
the requirement came from server defaults, route-level config, method-level
config, or a deep merge of those.

### 4. HTTP routes / middleware (`apply()`)

Through `app` you get the underlying Hono app to mount things:

```ts
apply({ app }) {
  app.get("/@health", (c) => c.json({ ok: true }));
  app.use("/admin/*", adminGuardMiddleware);
}
```

Plugins like `ClientGenerationPlugin` (`GET /@client`) and `DocsPlugin`
(`GET /@docs`) use this for their codegen / docs endpoints.

---

## Identity and uniqueness

Two optional fields:

- **`id`** — stable string, conventionally `<package>/<feature>`
  (`"pumice.js/authentication"`, `"my-app/request-id"`). Required when
  `unique` is `true`.
- **`unique: true`** — registering twice with the same `id` throws at
  `server.use()` / `ServerBuilder.use()` time.

Most shipped plugins are `unique: true` (you don't want two
`AuthenticationPlugin` instances racing each other). For your own plugins,
turn `unique` on when there's no good reason to register the same plugin
twice.

---

## The `apply({ server, app })` context

- **`server`** — the `Server` instance with its generics widened
  (`Server<object, object, never>`). Plugins use this to call `server.getClientManifest()`,
  wrap `server.routes.addFromCurrentFile`, or read `server.config`-state.
- **`app`** — the underlying Hono app for direct HTTP route mounting.

`apply()` is called **once** when the server boots (during
`server.listen()`). Plugins are applied in registration order; this matters
when one plugin reads runtime state another plugin sets up.

---

## Pre-validation hooks

The route pipeline runs hooks **before** request body / query / params
validation. Plugins attach hooks by wrapping `addFromCurrentFile`:

```ts
{
  order: -500,                            // lower number = earlier
  run: async (context, routeConfig) => {
    // routeConfig is the effective merged config for this route+method.
    if (routeConfig?.thing === false) return;
    // Either return nothing (continue), or return a Response (short-circuit).
  },
}
```

Useful order conventions:

| Order | Used by | Why |
|---|---|---|
| `-1000` | `AuthenticationPlugin` | Must run first so every other hook can read `c.auth` |
| `-500` | `RatelimitPlugin` | Can read `c.auth` for per-user limits |
| `0` or positive | Custom | Anything that depends on auth + ratelimit being settled |

A hook returning a `Response` short-circuits the route — no further hooks
run, no validation, no middleware, no procedures, no handler.

---

## Putting it together: a tracing plugin

A small but realistic example combining all four slots:

```ts
import type { ServerPlugin, ContextRefinementRule } from "pumice.js";
import { randomUUID } from "node:crypto";

type TraceContext = { trace: { id: string; sampled: boolean } };
type TraceConfig = { trace?: { force?: boolean } };
type TraceRefinement = ContextRefinementRule<
  { trace: { force: true } },
  { trace: { id: string; sampled: true } }    // sampled is `true` (literal)
>;

export function TracingPlugin(): ServerPlugin<TraceContext, TraceConfig, TraceRefinement> {
  return {
    id: "my-app/tracing",
    unique: true,
    apply({ app, server }) {
      // 1. Mount Hono middleware to populate c.trace on every request.
      app.use(async (c, next) => {
        const sampled = Math.random() < 0.1;
        (c as any).trace = { id: randomUUID(), sampled };
        c.header("x-trace-id", (c as any).trace.id);
        await next();
      });

      // 2. Wrap addFromCurrentFile so routes with trace.force: true
      //    override the sample decision to always-sampled.
      const routes = (server as any).routes;
      const original = routes.addFromCurrentFile.bind(routes);
      routes.addFromCurrentFile = (def: any) => original({
        ...def,
        beforeValidationHooks: [
          ...(def.beforeValidationHooks ?? []),
          {
            order: 0,
            run: (c: any, routeConfig: TraceConfig | undefined) => {
              if (routeConfig?.trace?.force) c.trace.sampled = true;
            },
          },
        ],
      });
    },
  };
}
```

Usage:

```ts
server
  .use(TracingPlugin())
  .config({ routes: { trace: { force: true } } }); // narrows c.trace.sampled to `true`

// route file
server.route().get().handle((c) => {
  c.trace.id;        // string
  c.trace.sampled;   // literal `true` thanks to the refinement
});
```

---

## When to write a plugin

Choose a plugin when **any** of these are true:

- The behavior should apply to every route in the app.
- You need to contribute typed fields to `c`.
- You need to add a typed key to `RouteConfig`.
- You want to mount machine-readable JSON endpoints (`/@manifest`,
  `/@docs`, ...).

Choose middleware instead when the scope is a directory or routing group.
Choose a procedure when the logic is route-attached and contributes typed
data to specific handlers.

---

## Related

- [Server & ServerBuilder — Registering plugins](./server.md#registering-plugins)
- [Middleware](./middleware.md) — for directory-scoped concerns
- [Procedures](./procedures.md) — for route-attached, typed building blocks
- All shipped plugins are documented in [docs/plugins/](../plugins/).
