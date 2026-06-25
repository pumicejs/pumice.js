# `ClientGenerationPlugin`

Exposes the running app's **route manifest** as a JSON endpoint that
codegen tools can consume. Routes' Zod schemas are emitted as **JSON
Schema**, so anything that speaks JSON Schema can derive types or clients
from a live server.

```ts
import { ClientGenerationPlugin } from "pumice.js";

server.use(ClientGenerationPlugin());
// -> GET /@client returns the filtered manifest
```

The companion [`pumice-docs`](./docs.md#docs-generator-integration)
generator consumes this manifest to produce HTML docs, OpenAPI 3.1
documents, markdown, and MCP tool manifests.

---

## Identity

- Factory: `ClientGenerationPlugin(options)`
- Id: `"pumice.js/client-generation"`
- `unique: true` — registering twice throws.

---

## Options — `ClientGenerationPluginOptions`

| Field | Type | Default | Effect |
|---|---|---|---|
| `path` | `string` | `"/@client"` | URL path the manifest is served at (`GET`) |
| `authenticator` | `(c: Context) => ClientManifestGenerationAccess \| Promise<...>` | _(open)_ | Per-request gate. Return `{ allow: false }` to short-circuit |

The default path uses a leading `@` to keep it out of the way of normal
URL space (matches the `DocsPlugin` convention).

### `authenticator`

```ts
type ClientManifestGenerationAccess =
  | { allow: true }
  | {
      allow: false;
      status?: number;   // default 403
      code?: string;     // default "FORBIDDEN"
      message?: string;  // default "You are not allowed to access the client manifest."
    };
```

Returning `{ allow: false }` produces a JSON error envelope with the
overridden / default fields.

```ts
ClientGenerationPlugin({
  authenticator: async (c) => {
    const token = c.req.header("x-internal-token");
    return token === process.env.CLIENT_GEN_TOKEN
      ? { allow: true }
      : { allow: false, status: 401, code: "UNAUTHORIZED" };
  },
});
```

---

## Route-config — `exposeClient?: boolean`

`ClientGenerationPlugin` contributes one key to `RouteConfig`:

```ts
type ClientGenerationRouteConfigExtension = {
  exposeClient?: boolean;
};
```

- `true` (or omitted) — the route is included in the manifest.
- `false` — the route is **filtered out** of the manifest output. It still
  serves requests normally; it's just not advertised to codegen.

Set per-route or per-method:

```ts
// Hide one method
server.route()
  .post().config({ exposeClient: false }).handle(...);

// Hide every method on a route
server.route()
  .config({ exposeClient: false })
  .get().handle(...)
  .delete().handle(...);

// Hide everything by default; explicitly expose what should ship
server.config({ routes: { exposeClient: false } });
server.route()
  .config({ exposeClient: true })
  .get().handle(...);
```

---

## What's in the manifest

`ClientManifest` (typed export) is the JSON payload. Top-level shape:

```jsonc
{
  "version": 3,
  "meta": {
    "generatedAt": "2026-06-25T17:53:21.000Z",
    "listeningSince": "2026-06-25T17:00:00.000Z",
    "framework": { "name": "pumice.js", "version": "0.0.16" }
  },
  "defaultRouteConfig": { /* server-wide route defaults */ },
  "routes": [
    {
      "path": "/users/:id",
      "routeFile": "routes/users/[id]/route.ts",
      "routeLevelConfig": { /* .route().config() */ },
      "params": { /* JSON Schema for path params */ },
      "methods": {
        "get": {
          "descriptor": "Fetch a user by id",
          "effectiveConfig": { /* merged defaults + route + method */ },
          "beforeValidationHooksCount": 2,
          "schema": {
            "body": { /* JSON Schema */ },
            "query": { /* ... */ },
            "headers": { /* ... */ },
            "response": { /* shape="single" | shape="statusMap" */ },
            "throws": { /* per-status descriptor */ }
            // file / files when declared
          }
        },
        "delete": { /* ... */ }
      }
    }
  ]
}
```

Routes are sorted alphabetically by `path`. Methods within a route are
sorted by the canonical order (`get`, `post`, `put`, `patch`, `delete`,
`options`, `any`) exported as `CLIENT_MANIFEST_METHOD_ORDER`.

### Type re-exports

```ts
import type {
  ClientManifest,
  ClientManifestMeta,
  ClientManifestFramework,
  ClientManifestRoute,
  ClientManifestMethod,
  ClientManifestRoutesByPath,
  ClientGenerationRouteConfigExtension,
  ClientManifestGenerationAccess,
} from "pumice.js";
```

The same `Server.getClientManifest()` method that powers the endpoint is
public — useful in tests or custom tooling that already has a `Server`
instance handy.

---

## How Zod becomes JSON Schema

The plugin uses Zod's built-in `toJSONSchema(schema, { unrepresentable: "any" })`
with two tweaks:

1. **`z.date()` / `z.coerce.date()`** are emitted as the JSON Schema for
   `z.iso.datetime()` (since "date" has no first-class JSON Schema). This
   keeps client-side contracts aligned with the RFC-3339 strings actually
   transmitted over the wire.
2. **`z.void()`** is emitted as `{ "type": "void" }` so client codegen can
   distinguish "empty body" from "any unknown body".

For `BigInt` values that show up in `default` / `example` fields, they're
JSON-serialized as strings (since JSON has no `BigInt`).

---

## Plugin contributions

| Slot | Contribution |
|---|---|
| `TContextExtensions` | _(none — no `c.client` field)_ |
| `TRouteConfigExtensions` | `{ exposeClient?: boolean }` |
| `TContextRefinementRules` | _(none)_ |

---

## Composes with…

- **`DocsPlugin`** — reads the same underlying manifest internally to
  produce its own grouped/tagged docs manifest. They're independent
  endpoints (`/@client` vs `/@docs`), but `DocsPlugin` calls
  `server.getClientManifest()` under the hood, so any route hidden via
  `exposeClient: false` is _not_ automatically hidden from `/@docs`
  (and vice versa — `docs.hidden: true` doesn't hide from `/@client`).
  Use both keys explicitly when you want to hide from both.

---

## Recipes

### Internal-only manifest (allowlist token)

```ts
ClientGenerationPlugin({
  authenticator: async (c) =>
    c.req.header("x-codegen-token") === process.env.CODEGEN_TOKEN
      ? { allow: true }
      : { allow: false, status: 401 },
});
```

### Hide admin routes from codegen

```ts
// in your admin routes
server.route()
  .config({ exposeClient: false, authentication: { required: true } })
  .delete()
  .handle(...);
```

Clients can call these routes normally if they know the URL; they just
aren't surfaced in the generated client library.

### Live introspection in tests

```ts
import { server } from "../src/server.js";
import { server as built } from "../src/index.js";

// .listen() is what triggers route discovery, so test setups need to
// either call listen() or use a separate routine that walks the same tree.
const manifest = server.getClientManifest();
expect(manifest.routes.find((r) => r.path === "/users/:id")?.methods.get).toBeDefined();
```

---

## Related

- [`DocsPlugin`](./docs.md) — pretty docs derived from the same underlying manifest
- [Plugins](../concepts/plugins.md) — the extension model
- `pumice-docs` generator — consumes `/@client` (and optionally `/@docs`)
