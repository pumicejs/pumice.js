# Architecture

## The pieces

| Where | What |
| --- | --- |
| `src/index.ts` | The public API: every export users may rely on. Nothing else is public. |
| `src/structures/server.ts` | `Server`: owns the Hono app, the plugins and the `RouteManager`; `load()`, `fetch()`, `listen()`, and the `route()` / `procedure()` / `middleware()` entry points. |
| `src/builders/` | The fluent builders: `ServerBuilder`, the route chain (`route.ts`, mostly types), procedures, middleware. They collect a definition and hand it to the manager. |
| `src/managers/routes.ts` | Discovery (walk, sort, import), registration (path, middlewares, manifest entry) and the per-request pipeline. Owns the declared models, so every route schema is serialized against them. |
| `src/schema/` | `runtime.ts`: request validation, coercion, multipart extraction, error normalization, the `throws` contract. `guards.ts`: the duck-typed shape checks shared by runtime and manifest. `models.ts`: the model registry and how a schema is recognised as a model. `json-schema.ts`: Zod → JSON Schema for the manifests, with models as refs. |
| `src/http/` | The JSON envelope (`json-envelope.ts`) and the body limit (`body-limit.ts`). |
| `src/client-manifest.ts` | Turns registered routes and the declared models into the client manifest, and the types both manifests share. |
| `src/config/routes.ts` | `mergeRouteConfig`: server defaults < route < method. |
| `src/errors/api.ts` | `ApiError` and status texts. |
| `src/parser.ts` | File path → URL path. |
| `src/plugins/` | Every optional feature: authentication, rate limiting, CORS, logging, client generation, docs. |
| `src/types/` | Types only (`import type` from here), plus one tiny runtime helper in `authentication.ts`. |
| `src/utils/` | Generic helpers with no framework knowledge: `types.ts` (type-level), `log.ts` (the one stdout writer), `call-site.ts` (files on the call stack), `client-ip.ts` (socket address and `trustProxy`). |

## A request, start to finish

1. **Hono app-level middleware** that plugins installed with `app.use("*")`: CORS, the logger.
2. **The route's handler** (one per method and path, built in `createValidatedHandler`):
   1. The effective config: `mergeRouteConfig(server defaults, route + method config)`.
   2. **Hooks** (`beforeValidationHooks`), sorted by `order`: authentication (-1000) sets
      `c.auth` and may answer 401; rate limiting (-500) may answer 429.
   3. **The body limit** (`http/body-limit.ts`): 413 before anything reads the body.
   4. **Directory middlewares**, outermost first, each with its own memoized `next()`.
   5. **Validation** (`schema/runtime.ts`): body or multipart, query, headers, params; 400 with
      every issue at once.
   6. **Procedures**, in attachment order, filling `c.procedures`.
   7. **The handler.** A plain value or `c.response(...)` becomes the success envelope; a
      `Response` passes through.
3. **Errors** from procedures, the handler or middleware go through `respondToThrown`: 5xx and
   plain `Error`s are logged and answered with a generic 500; a 4xx is checked against the
   route's `throws` and sent as the error envelope.

Unknown paths get the 404 envelope from `app.notFound`. Plugin endpoints (`/@client`, `/@docs`)
are plain Hono routes and don't pass through steps 2.1–2.7.

## Discovery

`load()` (and so `listen()`) applies the plugins once, then `RouteManager.registerDiscovered()`:

- walks `rootDir` and keeps supported source files (`.ts`, `.js`, `.mts`, …) whose path contains
  the `basePath` segments (default `routes`);
- imports middleware files first (`middleware.ts`, `*.mw.ts`), then route files, each sorted so
  static segments come before dynamic ones at the same depth;
- while a file's top level runs, `server.route()` / `server.middleware()` register against the
  file that calls them: the innermost discovered file on the call stack
  (`utils/call-site.ts`), falling back to the file being imported. That keeps a route file that
  imports another from stealing its routes.

The URL comes from the path under `basePath` (`parser.ts`): `[id]` → `:id`, `(group)` dropped,
`route` / `index` dropped. A middleware applies to its directory and everything below it.

Known gaps are in [roadmap.md](roadmap.md): discovery looks at the whole `rootDir` and matches
`routes` anywhere in the absolute path; test files next to routes are imported.

## Plugins

A plugin is `{ id?, unique?, apply({ server, app }) }`, typed `ServerPlugin<Context, Config,
Rules>` so `server.use()` can widen the context (`c.auth`), the route config (`authentication`)
and the context refinements (`c.auth.data` non-optional when `required: true`). In `apply` a
plugin may:

- install Hono middleware or routes on `app` (CORS, logger, `/@client`, `/@docs`);
- wrap `server.routes.addFromCurrentFile` to add a hook to every route (authentication, rate
  limiting). This is the seam today; a proper hook registry is on the roadmap.

Plugins are applied in registration order, once, before discovery.

## Models and the manifests

A route's schemas are serialized once, when the route registers (`RouteManager.add()`), against
the `ModelRegistry` the manager owns; that is why models must be declared before routes load. The
registry gives zod a metadata registry that adds `id: <name>` to each declared schema, so zod
writes every use of it as a `$defs` ref, and an `override` that rewrites an object sharing a
model's property schemas into a ref or an `allOf` extension. `json-schema.ts` then lifts the
model definitions out of each schema (`#/$defs/User` → `#/models/User`).

Responses and throws are serialized in zod's output mode, request parts (body, query, headers,
params) in input mode. The model bodies are output mode, serialized the same way, once, when the
first route registers (or on the first `getClientManifest()` without routes). Request parts are
given a subset of the registry (`ModelRegistry.subset()`): the models whose input-mode JSON is
their body, found by `manifestModels()` by dropping the ones that differ until none does, since a
model written in full can change the JSON of one that contains it. The others are as if
undeclared there. Each plugin prunes `models` to the routes it serves (`referencedModels()`),
which keeps the registry in the core: both manifests need it, and the core never imports a
plugin.

## Import boundaries

- **The core never imports a plugin.** Everything outside `src/plugins/` and `src/index.ts`;
  enforced by ESLint (`no-restricted-imports`). A plugin needs a seam in the core instead.
- **`src/types/` holds types.** Import them with `import type`.
- **`src/utils/` knows nothing about routes, plugins or servers.** If a helper needs to, it
  belongs next to its caller.
- **Only `src/index.ts` defines the public API.** A new export is a decision: add it there, to
  the README's export list, and say so in the PR.
