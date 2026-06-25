# Getting Started

This page walks you from `npm install` to a running, typed HTTP server
serving validated requests. By the end you'll have:

- A shared `server` instance
- One route file under `src/routes/...`
- A request/response cycle that's validated against a Zod schema and
  type-safe end to end

For deeper dives into each concept once you're up and running, follow the
links at the bottom of this page.

---

## 1. Install

```bash
npm install pumice.js zod
```

`pumice.js` re-exports `z` from Zod so you don't normally need to import
Zod directly.

### `package.json` essentials

`pumice.js` is shipped as ESM. Your project needs:

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p .",
    "start": "node dist/index.js"
  }
}
```

`tsx` is one common way to run TypeScript during development; any
`ts-node`-style ESM loader works.

### Recommended `tsconfig.json` highlights

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`strict: true` is required for the type refinements (e.g. `c.auth.data`
becoming non-optional under default-required auth) to actually narrow.

---

## 2. Create a shared server

Most apps create the server in one module and import it from every route
file. The fluent `ServerBuilder` keeps construction in one expression:

```ts
// src/server.ts
import { ServerBuilder, LoggerPlugin, CorsPlugin } from "pumice.js";

export const server = new ServerBuilder()
  .basePath("routes")              // optional — default is "routes"
  .use(new LoggerPlugin())
  .use(new CorsPlugin({ origin: "*" }))
  .config({
    routes: {
      // server-wide route defaults; deep-merged with per-route .config(...)
    },
  })
  .build();
```

> **Why a shared module?** Route files don't run by themselves — they're
> imported during route discovery. They call `server.route()` /
> `server.middleware()` / `server.procedure()` on the same instance.
> Importing `server` from a central module is what wires them together.

See [Server & ServerBuilder](./concepts/server.md) for the difference
between `new Server(...)` and `new ServerBuilder().build()`.

---

## 3. Boot the server

`server.listen()` is what:

1. Applies every registered plugin once.
2. Walks the file tree, importing each `route.ts` / `*.mw.ts`.
3. Binds the HTTP listener.

```ts
// src/index.ts
import { server } from "./server.js";

await server.listen({ port: 3000 });
```

> Defaults: `rootDir = <cwd>/src`, `basePath = "routes"` → scans
> `<cwd>/src/routes/**`. Override either with `.rootDir(...)` /
> `.basePath(...)` on the builder.

When you `npm run build` and run from `dist/`, route discovery automatically
scans `dist/src/routes/**` because `rootDir` defaults to `<cwd>/src` — see
[Routing — Discovery options](./concepts/routing.md#discovery-options) if
you compile to a different layout.

---

## 4. Write a route

Routes live under `src/routes/`. The folder structure is the URL structure
(see [File-Based Routing](./concepts/routing.md) for the full ruleset).

```ts
// src/routes/users/[id]/route.ts
import { z } from "pumice.js";
import { server } from "../../../server.js";

const UserSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  email: z.email(),
});

server
  .route()
  .params(z.object({ id: z.coerce.number().int().positive() }))
  .get()
    .describe("Fetch a user by id")
    .response(UserSchema)
    .throws({ 404: z.void() })
    .handle(async (c) => {
      const user = await db.users.find(c.params.id);
      if (!user) throw 404;
      return user; // validated against UserSchema, wrapped in the success envelope
    });
```

Test it:

```bash
curl http://localhost:3000/users/7
```

You'll get:

```json
{ "code": "SUCCESS", "message": "OK", "data": { "id": 7, "name": "...", "email": "..." } }
```

For an unknown id, the `throw 404` triggers a matched empty `data` 404 via
the framework's [error envelope](./concepts/response-envelope.md).

### What the types give you

Inside `handle`:

- `c.params.id` — `number` (parsed via `z.coerce.number()`)
- The handler's return type is constrained to whatever satisfies the
  declared `response` schema, so returning `{ id: "1", ... }` is a compile
  error.
- `c.error` / `c.response` know about every status you declared in
  `.throws(...)` / `.response(...)`, so you can't `c.error({ status: 418 })`
  unless you declared `418` in `.throws({ ... })`.

---

## 5. Add a second method on the same path

The builder lets you chain another method without reopening the route:

```ts
server
  .route()
  .params(z.object({ id: z.coerce.number().int().positive() }))
  .get()
    .describe("Fetch a user by id")
    .response(UserSchema)
    .handle(async (c) => db.users.find(c.params.id))
  .delete()
    .describe("Delete a user by id")
    .response(z.void())
    .handle(async (c) => {
      await db.users.delete(c.params.id);
      return c.response({ status: 204, data: undefined });
    });
```

See [Route Builder](./concepts/route-builder.md) for the full stage chart.

---

## 6. (Optional) Run the docs and codegen endpoints

The companion plugins expose machine-readable JSON for tooling:

```ts
import {
  ServerBuilder,
  ClientGenerationPlugin,
  DocsPlugin,
} from "pumice.js";

export const server = new ServerBuilder()
  .use(ClientGenerationPlugin())                                 // GET /@client
  .use(DocsPlugin({
    tags: [{ name: "users", label: "Users", color: "#7c3aed" }],
    groups: [{ name: "Users", match: { pathPrefix: "/users" } }],
  }))                                                            // GET /@docs
  .build();
```

Point the [pumice-docs](./plugins/docs.md#docs-generator-integration)
generator at the running server to get an HTML site, an OpenAPI 3.1 file,
markdown, and an MCP tools manifest — all derived from the route manifest
plus the DocsPlugin metadata.

---

## Where next?

| You want to... | Read |
|---|---|
| Understand the chain of stages on `.route()` | [Route Builder](./concepts/route-builder.md) |
| Share logic across routes (load resources, gate access) | [Procedures](./concepts/procedures.md) |
| Run logic for every route in a directory | [Middleware](./concepts/middleware.md) |
| Add authentication / per-user limits / cross-cutting features | [Plugins](./concepts/plugins.md) |
| Customize the JSON envelope | [Response Envelope](./concepts/response-envelope.md) |
| Accept file uploads | [File Uploads](./concepts/file-uploads.md) |
| Throw typed errors | [Error Handling](./concepts/error-handling.md) |
