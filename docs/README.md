# pumice.js Documentation

> The full guide to building APIs with `pumice.js` — a file-system based,
> end-to-end typed server framework built on Hono and Zod.

This folder is the long-form documentation. For a quick overview see the
[root README](../README.md); for a tour and your first running server, start
with [Getting Started](./getting-started.md).

---

## What is pumice.js?

`pumice.js` lets you write a folder of route files and get a validated,
typed, introspectable HTTP API in return — without scaffolding tools, code
generators, or runtime decorators. The whole framework rides on top of
[Hono](https://hono.dev/) (HTTP) and [Zod](https://zod.dev/) (schemas), and
extends them with:

- A **fluent route builder** where the visible chain steps change to enforce
  legal order (`.params() → .post() → .body() → .response() → .handle()`).
- A **plugin architecture** that contributes both runtime behavior _and_
  typed context fields / route-config keys — so `c.auth`, `c.ratelimiting`,
  `route.config({ docs: ... })`, etc. are first-class.
- **Procedures**: reusable per-request building blocks with typed config,
  param merging, and a typed `c.procedures.<name>` payload.
- **File-system routing**, including dynamic segments, organization groups
  (`(auth)/`), and directory-scoped middleware.
- A **uniform JSON envelope** for success and error responses, with type-safe
  `c.response()` / `c.error()` / `c.returns()` helpers.
- A **runtime route manifest** for codegen + docs tooling.

---

## Navigation

### Core

- [Getting Started](./getting-started.md) — install, first server, first route
- **Concepts**
  - [Server & ServerBuilder](./concepts/server.md)
  - [File-Based Routing](./concepts/routing.md)
  - [Route Builder](./concepts/route-builder.md)
  - [Procedures](./concepts/procedures.md)
  - [Middleware](./concepts/middleware.md)
  - [Plugins](./concepts/plugins.md)
  - [Response Envelope](./concepts/response-envelope.md)
  - [File Uploads](./concepts/file-uploads.md)
  - [Error Handling](./concepts/error-handling.md)

### Plugins

Each shipped plugin has a dedicated page covering options, the route-config
keys it contributes, type refinements, and recipes.

- [`CorsPlugin`](./plugins/cors.md) — CORS handling
- [`LoggerPlugin`](./plugins/logger.md) — request/response lifecycle logs
- [`AuthenticationPlugin`](./plugins/authentication.md) — per-request auth, with `required` gating
- [`RatelimitPlugin`](./plugins/ratelimit.md) — pluggable rate limiting (4 algorithms, stacked rules, `c.ratelimiting`)
- [`ClientGenerationPlugin`](./plugins/client-generation.md) — JSON manifest at `/@client` for codegen
- [`DocsPlugin`](./plugins/docs.md) — tags + customizable groups for the docs generator

### Recipes you'll hit early

| Task | Where to look |
|---|---|
| Add bearer auth and require it by default | [`AuthenticationPlugin`](./plugins/authentication.md) |
| Per-tier ratelimits using `c.auth` | [`RatelimitPlugin` — Dynamic limits](./plugins/ratelimit.md#dynamic-limits) |
| Throttle failed logins without consuming on success | [`RatelimitPlugin` — Manual mode](./plugins/ratelimit.md#manual-mode-cratelimiting-helpers) |
| Hide a route from the manifest | [`ClientGenerationPlugin`](./plugins/client-generation.md) |
| Group routes in the docs UI | [`DocsPlugin` — Grouping](./plugins/docs.md#grouping) |
| Tag routes with colored chips | [`DocsPlugin` — Tags](./plugins/docs.md#tags) |

---

## Conventions used in this documentation

- Code examples use ESM syntax and assume `"type": "module"` in `package.json`.
- `z` is the Zod re-export from `pumice.js` — `import { z } from "pumice.js"`.
- "Route config extension" / "RCE" refers to keys plugins add to the
  per-route `RouteConfig` (`authentication`, `ratelimit`, `exposeClient`,
  `docs`, ...).
- "Context refinement" refers to type-only conditional narrowing applied
  when a route's effective config matches a plugin's `when` predicate
  (e.g. `c.auth.data` becoming non-optional when `authentication.required: true`).
- Lifecycle order, where it matters, follows the [Request Pipeline](./concepts/middleware.md#execution-order)
  documented on the Middleware page.

---

## Repository

- GitHub: [pumicejs/pumice.js](https://github.com/pumicejs/pumice.js)
- Issues: [pumicejs/pumice.js/issues](https://github.com/pumicejs/pumice.js/issues)
- Docs generator (HTML / OpenAPI / Markdown / MCP): companion `pumice-docs`
  package (see [`DocsPlugin`](./plugins/docs.md#docs-generator-integration))
