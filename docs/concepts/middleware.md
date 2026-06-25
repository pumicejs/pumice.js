# Middleware

Middleware is **directory-scoped**, **Hono-style** request handling. Put a
`middleware.ts` (or any `*.mw.ts`) file in a folder, and it runs for every
route registered in that folder or any folder nested under it — including
across routing groups.

Use middleware for:

- Cross-cutting concerns inside a specific tree (auth guard for `(admin)/`,
  CSRF for `(forms)/`, audit log for `routes/internal/`).
- Hono-native things you'd want to handle with `(c, next)` (request id
  injection, response header rewriting, short-circuiting on a header check).

For app-wide concerns that apply to _every_ route, prefer a
[Plugin](./plugins.md) (CORS, ratelimit, auth). For request-scoped logic
that should contribute typed data, prefer a [Procedure](./procedures.md).
Middleware fills the niche between them.

---

## Where it can be defined

Middleware can only be declared from a file matching one of these names:

- `middleware.{ts,js,mts,cts,mjs,cjs}`
- Any file ending in `.mw.{ts,js,...}`

Anywhere else, calling `server.middleware()` throws — the framework needs
a file-anchored definition so it can scope the middleware to the right
directory.

```
src/routes/
  middleware.ts                ← applies to every route
  (auth)/
    middleware.ts              ← applies to every route under (auth)
    01-rate-limit.mw.ts        ← applies to every route under (auth) (runs before middleware.ts)
    users/[id]/
      route.ts
      middleware.ts            ← applies only to /users/:id
```

`*.mw.ts` files exist for the cases where you want multiple middleware files
in the same directory (e.g. ordered by their alphabetical filenames).

---

## Declaring middleware

```ts
// src/routes/(auth)/middleware.ts
import { server } from "../../server.js";
import { createApiJsonErrorResponse } from "pumice.js";

server.middleware()
  .describe("Staff-only guard")
  .handle(async (c, next) => {
    if (c.auth.data?.user.role !== "admin") {
      return createApiJsonErrorResponse(403, {
        code: "FORBIDDEN",
        message: "Staff access required.",
      });
    }
    return next();
  });
```

The handler is `(c, next) => Response | Promise<Response>`, just like
Hono — call `next()` to continue down the chain (`await` it to inspect or
mutate the response), or return a `Response` directly to short-circuit
without calling `next()`.

### What `c` contains in middleware

Middleware runs **after** plugin-contributed hooks but **before** route
validation and procedures. So `c` has:

- Everything Hono's `Context` normally provides (`c.req`, `c.res`,
  `c.header`, `c.json`, etc.).
- Plugin context fields registered by plugins that hook in before
  middleware (e.g. `c.auth` from `AuthenticationPlugin`'s hook at
  order `-1000`).
- Plugin context refinements appropriate for the matched route — same as
  in handlers.

It does **not** have `c.body` / `c.query` / `c.params` parsed by the
route schema yet. That happens later in the pipeline.

---

## Execution order

Per request:

1. Hono's built-in middleware (CORS, your logger, etc., as installed via
   plugins like `LoggerPlugin`).
2. **Plugin pre-validation hooks**, in their declared order
   (`AuthenticationPlugin` runs at `-1000`; `RatelimitPlugin` at `-500`).
3. **Middleware chain**, outer-first → innermost-last.
4. **Route validation** — `params`, `body`, `query`, `headers`, `files`
   parsed against the declared schemas.
5. **Procedures**, in attachment order.
6. **Route handler**.
7. **Middleware "after" code** — anything you wrote after `await next()`,
   in reverse order (innermost-first).

Concretely, for a request to `/users/:id` with two middleware files
(`routes/middleware.ts` and `routes/users/middleware.ts`):

```
Hono CORS / Logger
  ↓
AuthenticationPlugin hook  (c.auth populated, 401 if required)
  ↓
RatelimitPlugin hook       (429 if over)
  ↓
routes/middleware.ts       (await next)
  ↓
routes/users/middleware.ts (await next)
  ↓
Route validation
  ↓
userProcedure              (c.procedures.user populated)
  ↓
Route handler              (returns)
  ↓
routes/users/middleware.ts (after next)
  ↓
routes/middleware.ts       (after next)
  ↓
Response leaves
```

That ordering is **why middleware can trust `c.auth`** — by the time it
runs, the authenticator has already populated `c.auth`. Plugin hooks at
negative orders run first specifically to make this safe.

---

## Stacking

When multiple middleware files exist in one directory, they run **in
alphabetical order**:

```
src/routes/(auth)/
  01-rate-limit.mw.ts     (runs 1st)
  02-audit-log.mw.ts      (runs 2nd)
  middleware.ts           (runs 3rd — alphabetically "middleware" comes after "0X-...")
```

Across directories, outer-first → innermost-last:

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

If you need a different in-directory order, use prefixed `*.mw.ts` files
(`01-...`, `02-...`) instead of one big `middleware.ts`.

---

## Routing groups and scope

Routing groups (`(name)/`) are **scope boundaries** for middleware even
though they're stripped from URLs:

```
src/routes/
  (public)/
    health/route.ts          -> /health                    (no middleware applies)
  (auth)/
    middleware.ts            -> guards every route below
    users/[id]/route.ts      -> /users/:id                 (guarded)
    me/route.ts              -> /me                        (guarded)
```

A middleware inside `(auth)/` only sees routes inside `(auth)/`, regardless
of how URLs end up looking. This is the cleanest way to express
"everything inside this folder requires X" without per-route config.

---

## Returning a `Response` vs `await next()`

Two patterns, picked per case:

**Guard / short-circuit** — return a `Response` from middleware to stop
the chain immediately. The route handler is not called.

```ts
.handle(async (c, next) => {
  if (!isAuthorized(c)) {
    return createApiJsonErrorResponse(403, { code: "FORBIDDEN" });
  }
  return next();
});
```

**Wrap** — `await next()` to let downstream run, then mutate the response
or do work after.

```ts
.handle(async (c, next) => {
  const start = Date.now();
  const response = await next();
  console.log(`${c.req.method} ${c.req.path} took ${Date.now() - start}ms`);
  return response;
});
```

The framework's `LoggerPlugin` is essentially this pattern installed at
the Hono level for every request.

---

## Middleware vs Procedure vs Plugin

| Need | Pick |
|---|---|
| Run for every route, app-wide | [Plugin](./plugins.md) |
| Run for every route in a folder / group | Middleware (this page) |
| Contribute typed data on `c.procedures.<name>` to specific routes | [Procedure](./procedures.md) |
| Hook into Hono pre-routing (auth check, header normalization) | Plugin with a `beforeValidationHook` |
| Wrap the response of every route in a folder | Middleware with `await next()` |
| Wrap the response of every route, period | Plugin that installs Hono middleware on `app.use("*", ...)` |

---

## Limitations

- **Cannot add typed fields to `c`**. Middleware that wants to expose
  `c.somethingNew` for downstream code should be a plugin instead — only
  plugins thread the type into `TContextExtensions`.
- **No per-method scoping**. Middleware runs for every method on every
  matching route. If you need method-specific behavior, branch on
  `c.req.method`.

---

## Related

- [Plugins](./plugins.md) — for app-wide cross-cutting concerns
- [Procedures](./procedures.md) — for route-attached, typed building blocks
- [Routing — Routing groups](./routing.md#routing-groups-name) — the scoping
  mechanism middleware uses
