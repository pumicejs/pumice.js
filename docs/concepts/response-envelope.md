# Response Envelope

Every JSON response that goes through the route builder is wrapped in a
uniform envelope. Success and error envelopes share the same outer shape,
so clients can parse `code` / `message` / `data` without branching on the
HTTP status first.

The envelope is **mandatory for builder-driven responses** and **available
as helpers** for custom plugin endpoints. You can still return a raw
`Response` (or use `c.json(...)`) when you need a custom shape — that
bypasses the envelope entirely.

---

## The two shapes

### Success

```jsonc
{
  "code": "SUCCESS",
  "message": "OK",
  "data": { /* your payload, validated against the declared response schema */ }
}
```

- HTTP status comes from the response schema's status (default `200`).
- `code` defaults to `"SUCCESS"`.
- `message` defaults to `"OK"`.
- `data` is whatever your handler returned (or the explicit `data:` field
  in `c.response({ status, data })`).

### Error

```jsonc
{
  "code": "STATE_CONFLICT",
  "message": "Cannot publish a draft.",
  "data": { /* optional, validated against throws[status].data or descriptor.data */ },
  "issues": [ /* optional, validated against throws[status].issues */ ]
}
```

- HTTP status is whatever you threw (`throw 404`, `c.error({ status: 409 })`).
- `code` defaults to a status-derived `"HTTP_<status>"` when no code was
  declared and you used the shorthand `throw <status>`. When you used
  `c.error({ code: "FOO" })`, that exact code is emitted.
- `message` defaults to the HTTP status reason phrase
  (`getStatusMessage(status)`).
- `data` / `issues` are present when the `throws` schema declares them
  (descriptor form).

---

## How to send responses from a handler

Three patterns; pick whichever reads cleanest for the case at hand.

### 1. Implicit return — match the declared status

If your handler returns a value, it's validated against the response
schema for the **default success status**:

```ts
.response(UserSchema)             // -> single, default 200
.handle(() => ({ id: 1, name: "Ada" }));
```

For a status map, the implicit return targets `200` by default:

```ts
.response({ 200: UserSchema, 201: NewUserSchema })
.handle(() => ({ id: 1, name: "Ada" })); // sends 200 with UserSchema
```

If you need a non-default status, use `c.response(...)`.

### 2. Explicit `c.response({ status, data })`

The type of `c.response` is constrained to your declared statuses:

```ts
.response({ 200: UserSchema, 201: NewUserSchema })
.handle((c) =>
  freshlyCreated
    ? c.response({ status: 201, data: { id: 1, name: "Ada", invitedAt: ... } })
    : c.response({ status: 200, data: { id: 1, name: "Ada" } }),
);
```

`status: 204` with `data: undefined` is the conventional "no content"
shape. Status maps can include `z.void()` for empty bodies:

```ts
.response({ 204: z.void() })
.handle((c) => c.response({ status: 204, data: undefined }));
```

### 3. Returning a raw `Response`

When you need a non-JSON or non-enveloped response, return a `Response`
(or a Hono helper that produces one):

```ts
.handle((c) => c.text("ping")) // raw text/plain
.handle((c) => c.json({ raw: true })) // raw JSON, no envelope
.handle(() => new Response("hello", { headers: { "content-type": "text/plain" } }));
```

The response schema validation skips when you return a `Response` directly.

---

## How to fail from a handler

### Shorthand `throw <status>`

Only valid for statuses you declared as `z.void()` in `.throws({...})`:

```ts
.throws({ 404: z.void() })
.handle(async (c) => {
  const user = await db.users.find(c.params.id);
  if (!user) throw 404;
  return user;
});
```

The framework matches the status against your `throws` declarations and
sends:

```jsonc
{ "code": "HTTP_404", "message": "Not Found", "data": null }
```

### Typed `throw c.error({ ... })`

`c.error(...)` is typed against your `throws` declarations — you can only
target statuses you actually declared, and code-maps constrain `code` too:

```ts
.throws({
  401: {
    INVALID_CREDENTIALS: { message: "Invalid email or password." },
    EXPIRED:             { message: "Session expired." },
  },
  409: {
    message: "Conflict.",
    data: z.object({ existingId: z.number() }),
  },
})
.handle(async (c) => {
  throw c.error({ status: 401, code: "INVALID_CREDENTIALS" });    // valid
  throw c.error({ status: 401, code: "EXPIRED" });                // valid
  throw c.error({ status: 401, code: "TYPO" });                   // compile error
  throw c.error({ status: 409, data: { existingId: 7 } });        // valid (data validated)
  throw c.error({ status: 999 });                                 // compile error
});
```

Optional fields you can include in `c.error(...)`:

- `code` — one of the declared codes for the status, or omitted for
  descriptor-form errors with a single shape.
- `data` — validated against the declared `data` schema (when there is one).
- `issues` — validated against the declared `issues` schema (when there is
  one).
- `message` — free-form string overriding the descriptor's default.

See [Error Handling](./error-handling.md) for the full `throws` grammar
(schema form, descriptor form, code-maps).

### When errors aren't thrown

If your code returns a value (rather than throws), it goes through the
**success path** — even if the value looks error-shaped. Always `throw`
when you mean to fail; otherwise the response will be `200 SUCCESS` and
the body won't match the expected error schema for the client.

---

## Low-level helpers (for plugins and custom endpoints)

When you mount a Hono route outside the route builder (e.g. inside a
plugin's `apply()`), the framework exposes the same envelope formatters:

```ts
import {
  createApiJsonSuccessResponse,
  createApiJsonErrorResponse,
  buildApiJsonSuccessBody,
} from "pumice.js";

// success
return createApiJsonSuccessResponse({ user: { id: 1 } });
// -> 200 { "code": "SUCCESS", "message": "OK", "data": { "user": { "id": 1 } } }

return createApiJsonSuccessResponse({ pending: true }, 202);
// -> 202

// error
return createApiJsonErrorResponse(403, {
  code: "FORBIDDEN",
  message: "Internal endpoint.",
});
// -> 403 { "code": "FORBIDDEN", "message": "Internal endpoint.", "data": null }

// body-only (no Response wrapper) — for when you want to set headers yourself
const body: ApiJsonSuccessBody = buildApiJsonSuccessBody({ data: { ok: true } });
```

Every shipped plugin uses these helpers for its own endpoints
(`/@client`, `/@docs`, 429 responses, etc.), so client code can treat
"every JSON response from this server" uniformly.

### Body type re-exports

```ts
import type { ApiJsonSuccessBody, ApiJsonErrorBody } from "pumice.js";
```

Use them when you want to type-check a body assembled by hand before
sending.

---

## Customizing envelope codes / messages

There's no global "set my SUCCESS code" knob — the success envelope is
intentionally fixed across the framework so clients can rely on it.

What _is_ customizable is **per-response**:

- Pass `message: "..."` and `code: "..."` to `c.error(...)` to override the
  defaults on errors.
- Use `c.json(...)` (or return a raw `Response`) to send a non-enveloped
  body when you really need one.

Most apps standardize on the envelope and only escape for special cases
(file downloads, server-sent events, websocket upgrades).

---

## Status code conventions used by the framework

These are the statuses the framework itself emits without you triggering
them:

| Status | Source |
|---|---|
| `400` | Validation failure (`params`, `body`, `query`, `headers`, `files`) |
| `401` | `AuthenticationPlugin` when `authentication.required: true` and no valid auth |
| `403` | `ClientGenerationPlugin` / `DocsPlugin` authenticator returning `{ allow: false }` |
| `404` | Unknown URL (built-in not-found handler) |
| `415` / `413` | Multipart upload validation errors (wrong MIME, too big) |
| `429` | `RatelimitPlugin` on bucket exceeded or hard-block active |

All of them use the error envelope. None of them collide with your own
declared `throws` statuses — your route's `c.error(...)` is independent.

---

## Related

- [Route Builder](./route-builder.md) — declares the response/throws contracts
- [Error Handling](./error-handling.md) — full `throws` grammar
- [Plugins](./plugins.md) — how plugins use the envelope helpers for their own endpoints
