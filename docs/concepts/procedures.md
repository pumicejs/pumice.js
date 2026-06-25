# Procedures

Procedures are **reusable, typed, per-request building blocks**. They sit
between middleware (broad, directory-scoped) and inline handler code
(narrow, single-route). Use them when several routes need to do the same
thing — load a resource by id, gate access on a flag, sanitize an extra
slice of params — without copy-pasting the code or losing types.

A procedure:

- Has a typed `.config<T>()` that callers must satisfy at the use site.
- Optionally declares `.params(...)` whose keys are **merged with the
  route's params** (route params win on collision).
- Runs after request validation and before the route handler, in the order
  attached.
- Returns an object whose shape becomes `c.procedures.<name>` on every
  route that attaches it.
- Inherits the server's plugin context refinements (e.g. `c.auth.data` is
  non-optional inside the procedure when default `authentication.required: true`).

---

## Definition

The chain mirrors the route builder:

```ts
import { z } from "pumice.js";
import { server } from "../server.js";
import { repos } from "../db.js";

export const userProcedure = server
  .procedure()
  // Type-only: declares the config shape the use site must pass.
  .config<{ skipOwnershipCheck?: boolean }>()
  // Optional params merged into the route's params; route wins on key collision.
  .params(z.object({ userId: z.coerce.number().int().positive() }))
  // Handler — runs once per request, after validation.
  .handle(async (c) => {
    const user = await repos.users.findUnique({ where: { id: c.params.userId } });
    if (!user) throw c.error({ status: 404, message: "User not found." });

    if (!c.config.skipOwnershipCheck && user.id !== c.auth.data.user.id) {
      throw c.error({ status: 403, message: "Forbidden." });
    }

    return { user };
  });
```

`server.procedure().handle(...)` returns a **factory**. That's what you
actually attach on a route.

### What `.config<T>()` gives you

The generic is type-only — it doesn't add runtime parsing. Its job is to
make the factory call site typed:

- `userProcedure()` is allowed (config is optional)
- `userProcedure({ skipOwnershipCheck: true })` is type-checked
- `userProcedure({ unknown: true })` is a compile error

Inside the handler, `c.config` is `{ skipOwnershipCheck?: boolean }` — what
the caller passed.

### What `.params(...)` gives you

The procedure's params schema is **merged with the route's params** at
request time. Both contribute keys to `c.params`. If the route and the
procedure declare the same key, the route's schema wins for that key.

The procedure's handler sees the **merged** params shape on `c.params`. So
do route handlers _and_ any other procedures attached after this one.

Use `.params(...)` when a procedure is genuinely portable across routes
that share a param naming convention (e.g. `userId` everywhere). When
parameters differ per route, leave it off and read whatever the route
declared.

### What the handler must return

An **object** — its keys become the typed `c.procedures.<name>` properties.
The `<name>` is automatically the procedure's own variable name in module
scope, derived from how the factory is invoked (see the next section).

If you don't need to contribute anything to `c.procedures`, return `{}`.
The procedure still runs (useful for side effects + guards).

---

## Attaching on a route

```ts
import { userProcedure } from "../../procedures/user.js";

server
  .route()
  .procedure(userProcedure())                              // default config
  .procedure(userProcedure({ skipOwnershipCheck: true }),  // typed config
             { applyOnMethods: ["get"] })                  // limit to GET
  .params(z.object({ userId: z.coerce.number() }))
  .get()
    .handle(async (c) => {
      // c.procedures.user.user — typed: { id, ... }, not undefined
      return c.procedures.user.user;
    })
  .patch()
    .body(UpdateUserSchema)
    .handle(async (c) => {
      // Same procedure ran with skipOwnershipCheck=false here (the second
      // attachment was scoped to GET only).
      return updateUser(c.procedures.user.user, c.body);
    });
```

A few rules:

- Each `.procedure(factory, options?)` call attaches one entry.
- `applyOnMethods` limits the entry to the listed methods. Other methods
  type `c.procedures.user` as absent (so you can't access it accidentally).
- Attaching the same procedure twice is allowed — they run in attachment
  order. The later attachment's return value overwrites the earlier one on
  `c.procedures.<name>`. Use this for cascade configuration, but be careful
  about side effects.

### Order

Procedures run in attachment order, after validation, before the route
handler. Their return values are merged onto `c.procedures` as they run,
so a later procedure can read an earlier one's contribution:

```ts
.procedure(authzProcedure())          // contributes c.procedures.authz.scopes
.procedure(billingProcedure(), {      // can read c.procedures.authz inside its handler
  applyOnMethods: ["post"],
})
```

This is the standard pattern for "load a resource, then act on it with
context from another loader" — each step lands on `c.procedures` and is
visible to everything that comes after.

---

## How params merge in detail

When the request lands:

1. The route's `.params(...)` schema parses URL params first.
2. Each attached procedure that declared `.params(...)` parses the same
   raw URL params with its own schema.
3. The results are merged into a single `c.params` object — route values
   take precedence for shared keys.

Two reasons this matters:

- A procedure that requires `userId` works on _any_ route whose URL exposes
  `userId`, regardless of how the route itself names its params schema.
- A route can override a procedure's parsing rule for a shared key
  (e.g. allow a wider numeric range than the procedure's stricter parser).

The merged shape is also visible to the procedure's _own_ handler — so the
procedure sees the route's contributions too, not just its own slice.

---

## Type safety across plugins

Procedures share generics with the server, so plugin context fields and
plugin refinements work inside procedures exactly the way they do in route
handlers:

- `c.auth` is present if `AuthenticationPlugin` is registered.
- `c.ratelimiting` is present if `RatelimitPlugin` is registered.
- If the server's default config sets `authentication.required: true`,
  `c.auth.data` is non-undefined inside the procedure.

This is what lets a procedure like `userProcedure` above reach into
`c.auth.data.user.id` without a null check — the refinement has already
narrowed the type.

If a route opts out of a refinement at its config level
(`.config({ authentication: { required: false } })`), the procedure
attached to that route also loses the narrowing for that route's lifecycle
— which is the honest behavior.

---

## Common patterns

### Resource loader + ownership check

```ts
export const postProcedure = server
  .procedure()
  .params(z.object({ postId: z.coerce.number() }))
  .handle(async (c) => {
    const post = await repos.posts.findUnique({ where: { id: c.params.postId } });
    if (!post) throw c.error({ status: 404 });
    if (post.authorId !== c.auth.data.user.id) {
      throw c.error({ status: 403 });
    }
    return { post };
  });

// usage
server
  .route()
  .procedure(postProcedure())
  .params(z.object({ postId: z.coerce.number() }))
  .patch().body(EditSchema).handle((c) => updatePost(c.procedures.post.post, c.body));
```

### Feature-flag gate

```ts
export const featureProcedure = server
  .procedure()
  .config<{ flag: string }>()
  .handle(async (c) => {
    const enabled = await featureFlags.isEnabled(c.config.flag, c.auth.data.user.id);
    if (!enabled) throw c.error({ status: 404 });
    return {};
  });

// usage
.procedure(featureProcedure({ flag: "experimental-payments" }))
```

### Procedure that contributes typed data

```ts
export const orgProcedure = server
  .procedure()
  .config<{ allowGuest?: boolean }>()
  .params(z.object({ orgId: z.coerce.number() }))
  .handle(async (c) => {
    const membership = await repos.memberships.find({
      orgId: c.params.orgId,
      userId: c.auth.data?.user.id,
    });
    if (!membership && !c.config.allowGuest) {
      throw c.error({ status: 403 });
    }
    return {
      org: await repos.orgs.find(c.params.orgId),
      role: membership?.role ?? "guest",
    };
  });

// usage
.procedure(orgProcedure())
.get().handle((c) => ({
  org: c.procedures.org.org,
  role: c.procedures.org.role,
}));
```

---

## When _not_ to use a procedure

- **Truly one-off logic** — inlining in `.handle(...)` is fine.
- **Directory-wide cross-cutting concerns** (request logging, rate limit
  enforcement, auth) — those belong in [Middleware](./middleware.md) or a
  [Plugin](./plugins.md), not a procedure.
- **Pure helpers that don't read the request context** — those don't need
  the procedure machinery; export a function and call it directly.

Procedures shine when the logic is shared, depends on `c`, and contributes
typed data to downstream code.

---

## Related

- [Route Builder — `.procedure(...)`](./route-builder.md#procedurefactory-applyoptions)
- [Middleware](./middleware.md) — broader scope, no value contribution
- [Plugins](./plugins.md) — for cross-cutting features that should affect every route
