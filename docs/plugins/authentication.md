# `AuthenticationPlugin`

Wires per-request authentication into the route pipeline.

What you get when you register it:

- **Context field** — every route / middleware / procedure gets `c.<field>`
  (default `c.auth`) typed as `AuthState<TData>`.
- **Route-config key** — `authentication: { required?: boolean }` becomes
  a valid key on every `.route().config({...})` /
  `.method().config({...})` / `server.config({ routes: {...} })`.
- **401 short-circuit** — when the effective config has
  `authentication.required: true` and the request is anonymous, a
  `401 UNAUTHORIZED` JSON envelope is returned before validation runs.
- **Type refinement** — when `authentication.required: true` is part of
  the effective config, `c.<field>.data` is typed as **non-undefined**
  inside handlers, procedures, and middleware.

```ts
import { AuthenticationPlugin } from "pumice.js";

type CurrentUser = { id: string; role: "user" | "admin" };

server.use(
  AuthenticationPlugin<"auth", CurrentUser>({
    field: "auth",
    authenticator: async (c) => {
      const header = c.req.header("authorization");
      if (!header?.startsWith("Bearer ")) return { authenticated: false };
      const token = header.slice("Bearer ".length);
      const user = await verifyToken(token);
      return user
        ? { authenticated: true, data: { id: user.id, role: user.role } }
        : { authenticated: false };
    },
  }),
);
```

---

## Identity

- Factory: `AuthenticationPlugin(options)`
- Id: `"pumice.js/authentication"`
- `unique: true` — registering twice throws.

---

## Options — `AuthenticationPluginOptions<TField, TData>`

| Field | Type | Default | Effect |
|---|---|---|---|
| `field` | `string` | `"auth"` | Name of the context field (`c.<field>`). Type-only — the generic value flows through |
| `authenticator` | `(c: Context) => AuthState<TData> \| Promise<AuthState<TData>>` | — | Required. Per-request authenticator |

### `authenticator`

Receives the raw Hono context (before any framework validation) and must
return an `AuthState<TData>`:

```ts
type AuthState<TData> = {
  authenticated: boolean;
  data?: TData;
};
```

Two valid shapes:

```ts
{ authenticated: false }                           // anonymous request
{ authenticated: true, data: { id: "...", ... } }  // authenticated request
```

Throwing inside `authenticator` surfaces as a 500 to the client — handle
expected failures (invalid token, expired session) by returning
`{ authenticated: false }` instead.

The authenticator runs at hook order `-1000`, before every other
plugin hook and middleware. This is intentional so downstream code can
trust `c.<field>` is populated.

---

## Generics — `<TField, TData>`

`AuthenticationPlugin` is parameterized so the auth context propagates
through types:

```ts
type CurrentUser = { id: string; role: "user" | "admin" };

AuthenticationPlugin<"auth", CurrentUser>({ ... });
```

After this, `c.auth` is typed as `AuthState<CurrentUser>` everywhere.

If you skip the generics, TypeScript infers `<"auth", unknown>` and you'll
lose precision inside handlers. Always pass `TData` when you have a
concrete user shape.

---

## Route-config — `authentication: { required?: boolean }`

```ts
// Set at server level — every route is protected by default
server.config({ routes: { authentication: { required: true } } });

// Opt out for a single public route
server
  .route()
  .get()
  .config({ authentication: { required: false } })
  .handle(() => ({ ok: true }));

// Opt out for a public group
// src/routes/(public)/middleware.ts — empty file is fine; (public)/ is just for organization
// Inside (public)/, add per-route { required: false }, or
// keep server defaults strict and put truly public routes outside (public)/.
```

The effective `authentication.required` is whichever wins after deep-merging
server defaults + route-level config + method-level config. When that wins,
the 401 short-circuit fires for anonymous requests.

---

## Type refinement: non-undefined `c.auth.data`

When `authentication.required: true` is part of the **effective** config,
the plugin's context refinement narrows `c.<field>` from
`AuthState<TData>` (where `data?: TData`) to:

```ts
{ authenticated: true; data: TData }
```

So inside a handler whose effective config has `required: true`:

```ts
.handle((c) => {
  c.auth.data.id;       // string — no `?.` or `as` needed
  c.auth.data.role;     // "user" | "admin"
});
```

When the route opts out (`required: false`), the refinement no longer
applies and `c.auth.data` widens back to `TData | undefined`. The honest
behavior — you can't read `data` without checking when the request might
be anonymous.

This works because the runtime guarantee (no anonymous request reaches the
handler when `required: true`) is provided by the 401 short-circuit, and
the refinement just mirrors that into the type system.

---

## Anonymous reads from a required route

If you need to know _who_ is calling a partially-protected route (some
behavior for anon, more for authenticated), don't make it required —
leave the route un-required and branch on `c.auth.authenticated` inside:

```ts
server
  .route()
  .config({ authentication: { required: false } })
  .get()
  .handle((c) => {
    if (c.auth.authenticated) {
      return { tier: c.auth.data.role === "admin" ? "premium" : "personal" };
    }
    return { tier: "anonymous" };
  });
```

---

## Plugin contributions

| Slot | Contribution |
|---|---|
| `TContextExtensions` | `Record<TField, AuthState<TData>>` (e.g. `{ auth: AuthState<TData> }`) |
| `TRouteConfigExtensions` | `{ authentication?: { required?: boolean } }` |
| `TContextRefinementRules` | When `authentication.required: true`, narrows `c.<TField>.data` to `TData` (non-optional) |

---

## Recipes

### Bearer token + DB lookup

```ts
AuthenticationPlugin<"auth", CurrentUser>({
  authenticator: async (c) => {
    const token = c.req.header("authorization")?.replace(/^Bearer /, "");
    if (!token) return { authenticated: false };
    const user = await db.users.findByToken(token);
    return user
      ? { authenticated: true, data: { id: user.id, role: user.role } }
      : { authenticated: false };
  },
});
```

### Cookie-based session

```ts
AuthenticationPlugin({
  authenticator: async (c) => {
    const sid = getCookie(c, "session");
    if (!sid) return { authenticated: false };
    const session = await sessions.find(sid);
    if (!session || session.expiresAt < new Date()) return { authenticated: false };
    return { authenticated: true, data: { user: session.user } };
  },
});
```

### API keys

```ts
AuthenticationPlugin({
  authenticator: async (c) => {
    const key = c.req.header("x-api-key");
    if (!key) return { authenticated: false };
    const owner = await apiKeys.lookup(key);
    return owner
      ? { authenticated: true, data: { user: owner, scope: "api" } }
      : { authenticated: false };
  },
});
```

### Combining two schemes (cookie OR bearer)

Run them in series inside one authenticator:

```ts
authenticator: async (c) => {
  const cookieAuth = await tryCookie(c);
  if (cookieAuth.authenticated) return cookieAuth;
  const bearerAuth = await tryBearer(c);
  if (bearerAuth.authenticated) return bearerAuth;
  return { authenticated: false };
},
```

The plugin doesn't care which mechanism authenticated the user — only that
the returned `AuthState` is honest.

---

## Composes with…

- **`RatelimitPlugin`** — runs at hook order `-500`, after this plugin's
  `-1000`. Per-user dynamic limits can safely read `c.auth.data` inside
  scope / limit callbacks.
- **`ClientGenerationPlugin` / `DocsPlugin` `authenticator`** — those are
  separate, manifest-level authenticators (used to gate access to
  `/@client` and `/@docs`), unrelated to per-route auth.

---

## Related

- [Procedures](../concepts/procedures.md) — natural place to load `c.auth.data.user.org` etc.
- [Plugins](../concepts/plugins.md) — refinement rules in detail
- [Server config](../concepts/server.md#configuration) — server-level defaults narrow types
