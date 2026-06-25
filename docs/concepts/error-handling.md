# Error Handling

`pumice.js` errors are **declared up front** on each route via `.throws({...})`,
then **thrown** from inside the handler. The framework matches the thrown
value against the declaration, validates the payload, and serializes
through the [error envelope](./response-envelope.md).

The shape of `c.error(...)` and what `throw <status>` does are both
constrained by what you declare — you can't throw a status you didn't
declare, and you can't pass a code that isn't in the relevant code-map.

This page covers the three forms of `.throws(...)`, how `c.error(...)` is
typed, the framework's own error responses, and patterns for handling
unexpected exceptions.

---

## The three forms of throws entries

`.throws({...})` is keyed by HTTP status; each value can be one of three
shapes.

### 1. Schema form

```ts
.throws({ 404: z.void() })
.throws({ 422: z.object({ field: z.string(), reason: z.string() }) })
```

The status's payload is a single Zod schema:

- `z.void()` — empty body. Enables shorthand `throw <status>`.
- Any other schema — payload validated against it; `c.error({ status, data })`
  requires matching `data`.

### 2. Descriptor form

```ts
.throws({
  409: {
    message: "Resource is in a conflicting state.",
    data: z.object({ existingId: z.number() }),
    issues: z.array(z.object({ path: z.array(z.string()) })).optional(),
  },
})
```

Descriptor fields:

- `message` — default `message` for this status (overridable via
  `c.error({ message: "..." })`).
- `data` — Zod schema for the optional payload.
- `issues` — Zod schema for an optional `issues` array (useful for
  validation-style error breakdowns).

### 3. Code-map form

```ts
.throws({
  401: {
    INVALID_CREDENTIALS: { message: "Wrong email or password." },
    EXPIRED:             { message: "Session expired." },
    LOCKED:              {
      message: "Account is locked.",
      data: z.object({ unlocksAt: z.iso.datetime() }),
    },
  },
})
```

A keyed map of `code → descriptor`. `c.error({ status, code, ... })` is
typed to require one of the listed codes. Use this whenever a status
covers multiple distinct failure modes that clients should branch on.

You can nest schema/descriptor forms inside code-map entries — each code
gets its own validation rules.

---

## How `c.error(...)` is typed

The framework reads your `.throws(...)` declaration and constrains
`c.error(...)` accordingly:

```ts
.throws({
  404: z.void(),
  409: { message: "Conflict.", data: z.object({ existingId: z.number() }) },
  401: { INVALID_CREDENTIALS: { message: "Bad credentials." } },
})
.handle((c) => {
  throw c.error({ status: 404 });                                       // OK
  throw c.error({ status: 409, data: { existingId: 7 } });              // OK
  throw c.error({ status: 401, code: "INVALID_CREDENTIALS" });          // OK
  throw c.error({ status: 401, code: "FOO" });                          // compile error
  throw c.error({ status: 418 });                                       // compile error
  throw c.error({ status: 409 });                                       // compile error (data missing)
});
```

Optional overrides accepted on every form:

- `message: string` — overrides the descriptor's default.
- `issues: ...` — only valid when declared at the matching declaration.
- `data: ...` — only valid (and typed) when declared at the matching declaration.

The result of `c.error(...)` is a special tagged value that, when thrown,
short-circuits the route pipeline and produces the matching error envelope.

---

## Shorthand `throw <status>`

For statuses you declared as `z.void()`, you can throw the status as a
bare number:

```ts
.throws({ 404: z.void(), 410: z.void() })
.handle(async (c) => {
  const item = await db.items.find(c.params.id);
  if (!item) throw 404;
  if (item.archived) throw 410;
  return item;
});
```

The shorthand only works for `z.void()` declarations because there's no
payload to provide. For everything else, use `c.error({...})`.

---

## Throwing from procedures

Procedures use the same `c.error(...)` helper. Throwing from a procedure
short-circuits the route just like throwing from the handler — the
procedure does not need to return a value when it throws:

```ts
export const userProcedure = server
  .procedure()
  .params(z.object({ userId: z.coerce.number() }))
  .handle(async (c) => {
    const user = await db.users.find(c.params.userId);
    if (!user) throw c.error({ status: 404, message: "User not found." });
    return { user };
  });
```

For the procedure's typing to allow `c.error({ status: 404 })`, the
**route** that attaches the procedure must declare `404` in `.throws(...)`.
Procedures don't have their own `throws` declaration — they ride on the
route's, which is the cleanest way to keep error contracts in one place
per endpoint.

---

## Throwing from middleware

Middleware doesn't have `c.error(...)` typed against the route's `throws`,
because middleware runs before the route is matched. To send an error from
middleware, use the envelope helpers:

```ts
import { createApiJsonErrorResponse } from "pumice.js";

server.middleware().handle(async (c, next) => {
  if (!isAuthorized(c)) {
    return createApiJsonErrorResponse(403, {
      code: "FORBIDDEN",
      message: "Internal endpoint.",
    });
  }
  return next();
});
```

Returning a `Response` from middleware short-circuits the pipeline; the
route handler is not called.

---

## Framework-generated errors

These status codes can arrive at the client without any explicit `throws`
declaration:

| Status | Cause | Code in body |
|---|---|---|
| `400` | Validation failure of `body` / `query` / `headers` / `params` / files | Zod-derived; includes `issues` |
| `401` | `AuthenticationPlugin` when `required` and request is anonymous | `"UNAUTHORIZED"` |
| `403` | `ClientGenerationPlugin` / `DocsPlugin` authenticator rejected | `"FORBIDDEN"` (overridable) |
| `404` | URL didn't match any route | `"NOT_FOUND"` |
| `413` | File above `maxSize` / `totalMaxSize` | `"PAYLOAD_TOO_LARGE"` |
| `415` | File type not in `allowedTypes` | `"UNSUPPORTED_MEDIA_TYPE"` |
| `429` | `RatelimitPlugin` bucket exceeded or hard-blocked | `"RATE_LIMITED"` (overridable) |
| `500` | Uncaught error inside a handler / procedure / middleware | `"INTERNAL_SERVER_ERROR"` |

All of them use the [error envelope](./response-envelope.md).

For 500s, the uncaught error is logged (so `LoggerPlugin` will see it),
and the body is intentionally generic — never leak handler exceptions to
the client. Convert known failure modes into explicit `.throws(...)`
entries to keep the client contract honest.

---

## Patterns

### Re-throw to escalate

You can read a thrown `c.error(...)` value and re-throw it to bubble it up
unchanged. Useful when wrapping logic in a try / catch for side effects:

```ts
try {
  await doIt();
} catch (e) {
  await audit.log("attempt", e);
  throw e;   // preserves the typed error envelope
}
```

### Map an underlying error to a typed error

When calling into a lower-level library, convert opaque errors into typed
envelope errors at the boundary:

```ts
.throws({
  409: { CONFLICT: { message: "Database state conflict." } },
  500: { message: "Unexpected error." },
})
.handle(async (c) => {
  try {
    return await db.transaction(async () => doWork());
  } catch (e) {
    if (e instanceof db.UniqueConstraintError) {
      throw c.error({ status: 409, code: "CONFLICT" });
    }
    throw c.error({ status: 500 });   // explicit > implicit 500
  }
});
```

### Validation-style errors with `issues`

Use the `issues` slot for structured field-level validation breakdowns:

```ts
.throws({
  422: {
    message: "Invalid input.",
    issues: z.array(z.object({
      field: z.string(),
      reason: z.string(),
    })),
  },
})
.handle((c) => {
  const issues: Array<{ field: string; reason: string }> = [];
  if (!c.body.email.includes("@")) issues.push({ field: "email", reason: "Invalid email" });
  if (c.body.password.length < 8)  issues.push({ field: "password", reason: "Too short" });
  if (issues.length > 0) {
    throw c.error({ status: 422, issues });
  }
  return doIt(c.body);
});
```

### Code-maps for tiered failures

```ts
.throws({
  402: {
    PAYMENT_REQUIRED:        { message: "Subscription required." },
    PLAN_NOT_INCLUDED:       { message: "Your plan doesn't include this feature." },
    TRIAL_EXPIRED:           { message: "Trial period ended." },
  },
})
.handle(async (c) => {
  const tier = c.auth.data.user.tier;
  if (tier === "none")    throw c.error({ status: 402, code: "PAYMENT_REQUIRED" });
  if (tier === "free")    throw c.error({ status: 402, code: "PLAN_NOT_INCLUDED" });
  if (tier === "expired") throw c.error({ status: 402, code: "TRIAL_EXPIRED" });
  return doIt();
});
```

Clients can switch on `body.code` for per-case UI.

---

## Related

- [Response Envelope](./response-envelope.md) — body shape of success and error
- [Route Builder — `.throws(...)`](./route-builder.md#throwsschemamap)
- [Procedures](./procedures.md) — share error logic across routes
