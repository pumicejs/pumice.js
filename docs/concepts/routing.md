# File-Based Routing

Your file tree _is_ your URL tree. When `server.listen()` runs, it walks
`<rootDir>/<basePath>/**` and imports every file that matches the routing
conventions. Each file declares its routes against the shared `server`,
and the file's location determines the URL.

This page covers:

- How files map to URLs
- Dynamic and optional segments
- Routing groups (`(name)`) for organization without URL pollution
- Static-over-dynamic priority
- Where middleware files fit
- Configuration knobs (`rootDir` / `basePath`)

---

## The mapping rules

`<rootDir>/<basePath>` defaults to `<cwd>/src/routes`. From there:

| File path | URL path |
|---|---|
| `routes/route.ts` | `/` |
| `routes/users/route.ts` | `/users` |
| `routes/users/[id]/route.ts` | `/users/:id` |
| `routes/users/[id]/posts/[postId]/route.ts` | `/users/:id/posts/:postId` |
| `routes/(auth)/account/route.ts` | `/account` |
| `routes/api/v1/health/route.ts` | `/api/v1/health` |

Any of these file names register routes (each is treated as the **leaf**
of its directory):

- `route.{ts,js,mts,cts,mjs,cjs}`
- `index.{ts,js,mts,cts,mjs,cjs}`

And these names register **directory-scoped middleware** (covered in detail
on the [Middleware](./middleware.md) page):

- `middleware.{ts,js,...}`
- `*.mw.{ts,js,...}`

Any other file in the tree is ignored by route discovery (so you can keep
helpers, types, fixtures, etc. alongside route files).

---

## Dynamic segments

Wrap a folder name in brackets to make it a URL parameter:

```
routes/
  users/
    [id]/
      route.ts            -> /users/:id
```

Inside the route file, declare the params schema so you get parsed, typed
values:

```ts
server
  .route()
  .params(z.object({ id: z.coerce.number().int().positive() }))
  .get()
  .handle((c) => c.params.id); // number
```

Without `.params(...)`, `c.params` is the raw `unknown`-typed Hono param
object — the schema is what gives you both runtime parsing _and_ static
types.

### Multiple params in one URL

```
routes/users/[userId]/posts/[postId]/route.ts   -> /users/:userId/posts/:postId
```

Declare both in `.params(...)`:

```ts
server
  .route()
  .params(z.object({
    userId: z.coerce.number(),
    postId: z.coerce.number(),
  }))
  .get()
  .handle((c) => ({ userId: c.params.userId, postId: c.params.postId }));
```

---

## Routing groups: `(name)`

Wrap a folder name in parentheses to create a **routing group**:

```
routes/
  (public)/
    health/route.ts       -> /health           (no "(public)" in the URL)
  (auth)/
    middleware.ts         -> guards everything inside (auth)
    users/[id]/route.ts   -> /users/:id
    posts/route.ts        -> /posts
```

Routing groups are **scope markers only**:

- They are stripped from the URL — `(public)`, `(auth)`, `(internal)` all
  vanish from the request path.
- They create directory boundaries for middleware. A `middleware.ts` inside
  `(auth)/` applies to every route under `(auth)/`, but not to routes
  outside it.
- They cooperate with the file system, so you can co-locate routes that
  share a guard / theme / owner without dragging that name into URLs.

Use them whenever you'd otherwise want a "section" of routes — auth-required
vs public, admin vs customer, v1 vs v2 internals, etc.

### Multiple groups in one path

```
routes/(api)/(v1)/users/route.ts    -> /users
```

Both `(api)` and `(v1)` are stripped; the URL is still `/users`. If you
need the `api` and `v1` segments in the URL, drop the parentheses:

```
routes/api/v1/users/route.ts        -> /api/v1/users
```

---

## Static-over-dynamic priority

When two routes could match the same URL, the static one wins:

```
routes/users/me/route.ts       -> /users/me     (matched first)
routes/users/[id]/route.ts     -> /users/:id    (catch-all fallback)
```

For `GET /users/me`, the `me` handler runs — even though `[id]` would have
matched `id = "me"`. The discovery sort orders siblings so static segments
always register before dynamic siblings at every directory level; you don't
need to do anything to make this work.

This generalizes recursively. In a deeper tree, every level applies the
same rule.

---

## Where to put route-internal helpers

Files that don't match a discovery name (`route`, `index`, `middleware`,
`*.mw`) are ignored. Co-locate freely:

```
routes/users/[id]/
  route.ts
  schemas.ts          (not discovered)
  validators.ts       (not discovered)
  __tests__/route.test.ts
```

If you _do_ want a discovery name (say, `index.ts`) but only as a barrel
file, move it outside the routes tree, or use a name like `_index.ts`.

---

## Discovery options

`rootDir` and `basePath` together define what gets scanned. Both have
defaults; both are configurable:

```ts
new ServerBuilder()
  .rootDir(resolve(__dirname, ".."))    // default: <cwd>/src
  .basePath("api")                       // default: "routes"
  .build();
```

This example scans `<projectRoot>/api/**` instead of
`<cwd>/src/routes/**`.

### Build-vs-dev rooting

After `tsc`, your built tree typically lives in `dist/`. Because `rootDir`
defaults to `<cwd>/src`, running `node dist/index.js` from the project root
still scans `<cwd>/src` by default — which is empty of compiled files.

The simplest fix is to derive `rootDir` from the current file:

```ts
// src/index.ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ServerBuilder } from "pumice.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const server = new ServerBuilder()
  .rootDir(resolve(__dirname))     // src/ in dev, dist/src/ after build
  .build();
```

The same expression works in both `tsx watch` (dev) and `node` (prod)
because `import.meta.url` reflects the actually-running file.

---

## Order of operations during discovery

When `server.listen()` runs route discovery, it processes the tree
**depth-first, alphabetically**, with two refinements:

1. Within a directory, static segments are registered before dynamic ones
   (preserving the priority rule).
2. Within a directory, multiple middleware files run alphabetically; a
   `middleware.ts` is treated as `middleware.ts` for sort purposes (so a
   `01-rate-limit.mw.ts` registers before `middleware.ts`).

You'll rarely care about exact discovery order for routes (each registers
independently), but it _does_ matter for stacked middleware in the same
directory — see [Middleware — Stacking](./middleware.md#stacking).

---

## Where this concept stops

Discovery only _imports_ files. Once a file is imported, the
`server.route().handle(...)` chain you wrote inside it is what actually
registers a handler. If your file is imported but never calls
`server.route()`, no routes are added (a route file with only helpers is a
no-op for routing, which is sometimes intentional).

For everything that happens after a file is loaded, see:

- [Route Builder](./route-builder.md) — the chain itself.
- [Procedures](./procedures.md) — reusable per-request building blocks.
- [Middleware](./middleware.md) — directory-scoped pre-handler logic.
