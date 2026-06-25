# Route Builder

`server.route()` returns a fluent, **stage-typed** builder. At every point
in the chain, only the calls that are legal next are visible — TypeScript
hides everything else. That means the builder enforces structural rules
(you can't call `.handle()` before picking a method, you can't call
`.body()` on a `GET`) at compile time.

This page covers each stage in detail, the shape of the handler `c`
parameter, and the patterns you'll use day-to-day.

---

## The big picture

```ts
server
  .route()
  // ── Route-scoped (cascade to every method on this builder) ──
  .params(schema?)                                     // path params
  .config(routeConfig?)                                // RouteConfig override
  .procedure(factory, applyOptions?)                   // attach a procedure
  // ── Pick a method ──
  .get() | .post() | .put() | .patch()
        | .delete() | .options() | .any()
  // ── Method-scoped ──
  .describe("Human-readable summary")
  .config(methodOverrides?)
  .body(zodSchema)        // POST/PUT/PATCH/ANY only
  .query(zodSchema)
  .headers(zodSchema)
  .response(zodSchema | { 200: ..., 201: ... })
  .throws({ 404: z.void(), 409: { ... } })
  .file(fileConfig)       // single multipart upload (non-GET)
  .files(filesConfig)     // multiple multipart uploads (non-GET)
  // Or in one shot:
  .schema({ body, query, headers, response, throws, file, files })
  // ── Finalize ──
  .handle(async (c) => ...)
  // ── Chain another method on the same path ──
  .post()
    .body(...)
    .handle(...);
```

Each stage returns the next stage. Calling `.handle(...)` registers the
route and re-exposes the method-selection stage so you can declare another
method on the same path without re-typing `.params(...)` / `.config(...)` /
`.procedure(...)`.

---

## Route-scoped stages

These cascade to every method you declare on the same builder.

### `.params(zodObject)`

Declares the path-param schema. The schema is **parsed** at request time,
so `z.coerce.number()` actually turns the string `"42"` into the number
`42` inside `c.params`.

```ts
server
  .route()
  .params(z.object({ id: z.coerce.number().int().positive() }))
  .get().handle((c) => c.params.id) // typed as number
  .delete().handle((c) => c.params.id);
```

Path-param names must match the bracket segments in the file path
(`[id]` → `id`).

### `.config(routeConfig)`

Sets a route-level config object that's deep-merged with server defaults
and is then deep-merged with any method-level `.config(...)`. The shape is
`RouteConfig<TRouteConfigExtensions>` — every plugin contributes keys to
this type:

```ts
server
  .route()
  .config({
    authentication: { required: true },              // AuthenticationPlugin
    ratelimit: { limit: 10, timeframe: 60_000 },     // RatelimitPlugin
    exposeClient: false,                             // ClientGenerationPlugin
    docs: { tags: ["internal"], group: "Admin" },    // DocsPlugin
  })
  .get().handle((c) => ...);
```

If you don't register `AuthenticationPlugin`, the `authentication` key
isn't part of `RouteConfig` at the type level — there's no way to set it
by accident.

### `.procedure(factory, applyOptions?)`

Attaches a procedure. `factory` is the output of
`server.procedure().handle(...)` (a function you call with the procedure's
config). `applyOptions` can scope the procedure to specific methods:

```ts
.procedure(userProcedure({ skipOwnershipCheck: true }), {
  applyOnMethods: ["get"],
})
```

You can call `.procedure(...)` multiple times — the values they return
are merged onto `c.procedures.<name>` in the order they were attached.
Each procedure is typed individually; `c.procedures.foo` only exists on
methods where the `foo` procedure actually applies.

See [Procedures](./procedures.md) for the full definition side.

---

## Method-scoped stages

After picking a method, the chain enforces a single order — describe →
config → schema slices → handle.

### `.describe(text)`

Free-form human label. Surfaces in the client manifest
(`ClientManifestMethod.descriptor`) and any docs UI built on top of it.

### `.config(methodOverrides)`

Method-level override, deep-merged on top of `.route().config(...)` and
server defaults. The same RouteConfig shape applies.

### `.body(schema)` (non-GET)

Validates the JSON body. `c.body` becomes `z.infer<typeof schema>`. Only
available on methods that have a body (`POST`, `PUT`, `PATCH`, `ANY`).

### `.query(schema)` / `.headers(schema)`

Validate the query string / headers. Both produce typed `c.query` /
`c.headers`. Use `z.coerce` for the query because all values arrive as
strings.

### `.response(schema)`

Two forms:

- **Single status** — `.response(UserSchema)` validates the default `200`
  body.
- **Status map** — `.response({ 200: UserSchema, 201: NewUserSchema })`
  declares multiple success statuses. `c.response({ status, data })` and
  the implicit return type are then constrained to the declared statuses.

A `void` response (`.response(z.void())`) declares an empty body.

### `.throws(schemaMap)`

Declares typed error variants per status:

```ts
.throws({
  404: z.void(),                                          // empty 404 body
  409: { message: "Conflict", data: z.object({...}) },    // descriptor
  401: {
    INVALID_CREDENTIALS: { message: "Bad credentials" },  // code map
    EXPIRED:             { message: "Token expired" },
  },
})
```

`c.error({ status, code?, data?, message? })` is constrained to the
statuses (and codes, for code-maps) you actually declared. `throw 404`
short-circuits the matched empty `404`.

See [Error Handling](./error-handling.md) for the full spec on the
`throws` shape.

### `.file(fileConfig)` / `.files(filesConfig)` (non-GET)

Declares multipart upload slices. `c.file` / `c.files` are typed
`UploadedFile` / `UploadedFile[]` with parsed contents.

See [File Uploads](./file-uploads.md) for the config fields (allowed
types, size limits, field naming, count constraints).

### `.schema({...})`

Convenience form that takes any combination of `body`, `query`, `headers`,
`response`, `throws`, `file`, `files` in one object. Functionally
equivalent to calling the individual methods. Mix and match — you can use
`.schema(...)` for some and dedicated methods for others on the same
chain.

### `.handle(async (c) => ...)`

Finalizes the chain. The handler receives a typed context `c` (next
section), runs after middleware + validation + procedures, and either
returns a payload or throws.

---

## The handler context `c`

Inside `handle`, `c` is built from:

- **Always**: `c.body`, `c.query`, `c.headers`, `c.params`, `c.file`,
  `c.files` (typed `unknown` if you didn't declare the schema)
- **Always**: `c.json` / `c.response` / `c.error` / `c.returns` (response
  helpers)
- **Procedures**: `c.procedures.<name>` for every procedure that applies
  to the current method
- **Plugin context fields**: e.g. `c.auth` (AuthenticationPlugin),
  `c.ratelimiting` (RatelimitPlugin), and any custom fields
- **Plugin refinements**: type-only narrowings that fire when the effective
  config matches a `when` predicate

Examples:

```ts
.handle(async (c) => {
  c.body;                  // z.infer<typeof bodySchema>
  c.query;                 // z.infer<typeof querySchema>
  c.params;                // z.infer<typeof paramsSchema>
  c.procedures.user.user;  // contributed by userProcedure
  c.auth.data;             // non-undefined when authentication.required is true
  c.ratelimiting.peek();   // helpers from RatelimitPlugin
});
```

### Three ways to send a response

```ts
// 1. Implicit return — validated against the matching response status
return { id: 1, name: "Ada" };

// 2. Explicit status / data picker
return c.response({ status: 201, data: { id: 1, name: "Ada" } });

// 3. Returning a raw Response — bypasses the envelope entirely
return c.json({ raw: true });    // typed Hono helper
```

Mixing patterns is fine. The first form is for "I have the data, just send
it"; the second is when you need to vary the success status; the third is
the escape hatch for non-JSON or non-enveloped responses.

### Two ways to fail

```ts
// 1. Shorthand throw — matches throws[<status>]; must be z.void()
throw 404;

// 2. Explicit error
throw c.error({
  status: 409,
  code: "STATE_CONFLICT",
  data: { state: "draft" },
  message: "Cannot publish a draft.",
});
```

The types of `c.error(...)` only allow statuses (and codes) you declared
in `.throws(...)`. See [Error Handling](./error-handling.md).

---

## Multiple methods on the same path

After `.handle(...)`, the builder re-exposes the method-selection stage.
You can declare any number of methods on the same route, sharing the same
`.params(...)` / `.config(...)` / `.procedure(...)`:

```ts
server
  .route()
  .params(z.object({ id: z.coerce.number() }))
  .procedure(userProcedure())
  .get()
    .response(UserSchema)
    .handle(async (c) => c.procedures.user.user)
  .patch()
    .body(UpdateUserSchema)
    .response(UserSchema)
    .handle(async (c) => updateUser(c.procedures.user.user, c.body))
  .delete()
    .response(z.void())
    .handle(async (c) => {
      await deleteUser(c.procedures.user.user);
      return c.response({ status: 204, data: undefined });
    });
```

Each method declares its own schemas; the route-level pieces apply to all.

---

## Stage chart

The TypeScript chain enforces this order. Stages in brackets are optional;
stages on the same row are interchangeable.

```
server.route()
  ├─ [.params(...)]
  ├─ [.config(...)]
  ├─ [.procedure(...)]              (any number of times)
  └─ .<method>()
       ├─ [.describe(...)]
       ├─ [.config(...)]
       ├─ [.body(...)] | [.query(...)] | [.headers(...)]
       │ | [.response(...)] | [.throws(...)]
       │ | [.file(...)] | [.files(...)]
       │ | [.schema({...})]
       └─ .handle(async (c) => ...)
             ↳ back to .<method>() to chain more methods on this path
```

You don't have to call any of the bracketed steps — a bare
`.get().handle(...)` is a valid route with no schemas, no params, no
config.

---

## Common patterns

### Body + response + typed errors

```ts
server
  .route()
  .post()
    .describe("Create user")
    .body(z.object({ name: z.string(), email: z.email() }))
    .response({ 201: UserSchema })
    .throws({
      409: { EMAIL_TAKEN: { message: "Email already registered" } },
    })
    .handle(async (c) => {
      const existing = await db.users.findByEmail(c.body.email);
      if (existing) {
        throw c.error({ status: 409, code: "EMAIL_TAKEN" });
      }
      const user = await db.users.create(c.body);
      return c.response({ status: 201, data: user });
    });
```

### Status map response

```ts
.response({
  200: z.object({ user: UserSchema }),
  202: z.object({ enqueued: z.literal(true) }),
})
.handle(async (c) => {
  if (heavy) return c.response({ status: 202, data: { enqueued: true } });
  return { user: await getUser() }; // -> 200
});
```

### Optional schema + manual response shape

```ts
.get()
  .query(z.object({ raw: z.coerce.boolean().optional() }))
  .handle((c) => {
    if (c.query.raw) return c.json({ ok: true });   // raw, no envelope
    return { ok: true };                            // wrapped envelope
  });
```

---

## Related

- [Procedures](./procedures.md) — define the factories you pass to `.procedure(...)`.
- [Error Handling](./error-handling.md) — the full grammar of `.throws(...)`.
- [Response Envelope](./response-envelope.md) — JSON envelope and helpers.
- [Plugins](./plugins.md) — how plugins extend `RouteConfig` and the `c` context.
