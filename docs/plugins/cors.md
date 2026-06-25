# `CorsPlugin`

Mounts CORS handling on every request. Internally wraps Hono's built-in
[`cors()`](https://hono.dev/docs/middleware/builtin/cors) middleware and
applies it at `*` — preflight `OPTIONS` requests are handled
automatically, and the appropriate CORS headers are added to every
response.

```ts
import { CorsPlugin } from "pumice.js";

server.use(new CorsPlugin({
  origin: "https://app.example.com",
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type"],
}));
```

---

## Identity

- Class: `CorsPlugin`
- Not marked `unique` — you can register multiple instances if you really
  need overlapping CORS configurations (unusual; typically don't).

---

## Options

`CorsPluginOptions` is a direct re-export of Hono's `cors()` options. The
fields you'll touch most often:

| Field | Type | Notes |
|---|---|---|
| `origin` | `string \| string[] \| (origin: string, c: Context) => string \| undefined \| null` | Whitelist origins, accept all (`"*"`), or compute per request |
| `allowMethods` | `string[]` | HTTP verbs the server accepts cross-origin |
| `allowHeaders` | `string[]` | Headers the server reads from cross-origin requests |
| `exposeHeaders` | `string[]` | Headers the client is allowed to read from the response |
| `credentials` | `boolean` | Allow cookies / `Authorization` headers cross-origin |
| `maxAge` | `number` | Preflight cache duration in seconds |

See [Hono's CORS docs](https://hono.dev/docs/middleware/builtin/cors) for
the exhaustive option list and exact semantics.

---

## Recipes

### Same-origin only

Drop the plugin entirely — the browser already enforces same-origin
behavior. Add CORS only when you actually need cross-origin access.

### Allow your front-end app

```ts
new CorsPlugin({
  origin: "https://app.example.com",
  credentials: true,
  allowHeaders: ["Authorization", "Content-Type"],
});
```

`credentials: true` is what lets browsers send cookies / `Authorization`
headers across origins. If you also use `AuthenticationPlugin`, you'll
typically set this.

### Multiple origins

```ts
new CorsPlugin({
  origin: (origin) => {
    if (origin === "https://app.example.com") return origin;
    if (origin === "https://admin.example.com") return origin;
    return null;       // reject
  },
  credentials: true,
});
```

A function lets you implement allowlists, regex matches, or per-tenant
rules without exposing `*`.

### Wide-open API (public, no credentials)

```ts
new CorsPlugin({ origin: "*" });
```

Acceptable for public, unauthenticated APIs. **Never** combine `"*"` with
`credentials: true` — browsers will refuse the response.

---

## Plugin contributions

`CorsPlugin` is a pure Hono-middleware wrapper. It does not contribute:

- Context fields (`TContext`)
- Route-config extensions (`TRouteConfigExtensions`)
- Context refinements (`TContextRefinementRules`)

There is nothing to declare on per-route config, and no `c.cors` to read.

---

## Related

- Hono CORS reference: <https://hono.dev/docs/middleware/builtin/cors>
- [Plugins](../concepts/plugins.md) — how plugins are wired in general
