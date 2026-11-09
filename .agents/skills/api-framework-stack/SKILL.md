---
name: api-framework-stack
description: >-
  Default stack and server-composition choices for a TypeScript backend API —
  a typed, file-system-routed framework (Hono underneath) with Zod schemas,
  Prisma as the ORM, Bun/tsx for the runtime, and a plugin-composed server
  instead of a monolithic setup function. Use when scaffolding a new API
  service, choosing a web framework, or deciding how cross-cutting server
  concerns (CORS, auth, rate limiting, docs, typed client generation) get
  wired together.
metadata:
  type: practice
  category: tooling
---

## Rule

### The stack, concretely

- **Runtime.** Bun for local dev (`bun x tsx watch src/index.ts` — instant
  restart, no separate bundler step), compiled to plain JS via `tsc` for
  production and run with `tsx`/`node`. Dev and prod execute the same
  TypeScript source; there's no bundler config that can drift from what
  actually ships.
- **HTTP + routing.** A typed, file-system-routed framework built on top of
  Hono (`pumice.js` in this codebase). Every route file is discovered from
  disk under a configured root directory, so the URL tree *is* the file
  tree — there is no separate router file enumerating paths that can go
  stale relative to what's actually on disk.
- **Validation + contracts.** Zod schemas attached directly to each route
  (`.body()`, `.params()`, `.response()`, `.throws()`). The same schema
  objects also drive typed docs generation and a typed client SDK — one
  schema, three consumers, so validation/docs/client can't drift from each
  other the way they do when each is hand-maintained separately.
- **ORM.** Prisma, with a runtime driver adapter (e.g.
  `@prisma/adapter-mariadb`) instead of the default query-engine binary —
  needed to run Prisma from a non-Node-native runtime like Bun, and it
  avoids shipping a platform-specific engine binary in the deploy artifact.
- **Realtime.** Socket.IO. If a dedicated realtime/gateway process exists
  separately from the API, the API talks to it as a **client**
  (`socket.io-client`) and emits events into it rather than hosting its own
  Socket.IO server — this keeps connection-handling and horizontal scaling
  of realtime traffic entirely out of the request/response API process.
- **Background work.** A lightweight in-process job queue for deferred work
  triggered by a request (e.g. "compute derived image metadata after the
  upload response already went out"), plus `croner` for cron-style
  scheduled jobs (cleanup sweeps, daily resets, expiry checks). Both are
  started once from the process entrypoint — never spun up lazily inside a
  route handler.

### Server composition

Compose the server as a builder chained with small, named plugins. Read top
to bottom, the file is a table of contents for every cross-cutting concern
the app has:

```ts
// src/server.ts
import {
  ClientGenerationPlugin,
  CorsPlugin,
  RatelimitPlugin,
  ServerBuilder,
} from "pumice.js";
import { ClientIpPlugin } from "./lib/server-plugins/client-ip";
import { docsPlugin } from "./lib/server-plugins/docs";
import { authPlugin } from "./lib/server-plugins/auth";

export const server = new ServerBuilder()
  // Keeps route discovery aligned with the current runtime tree
  // (`src` in dev, `dist/src` after build).
  .rootDir(__dirname)
  .use(new CorsPlugin())
  .use(ClientIpPlugin())
  // The manifest lists every route and its config; gate it so only codegen
  // (local runs, CI) can read it in production.
  .use(
    ClientGenerationPlugin({
      authenticator: (c) => {
        // An unset token must lock the manifest, not open it.
        const token = process.env.CODEGEN_TOKEN;
        return token && c.req.header("x-codegen-token") === token
          ? { allow: true }
          : { allow: false, status: 404 };
      },
    }),
  )
  .use(docsPlugin)
  .use(authPlugin)
  .use(RatelimitPlugin())
  .config({
    routes: {
      authentication: {
        required: true,
      },
      ratelimit: {
        limit: 120,
        timeframe: 1000 * 60, // 1 minute
      },
    },
  })
  .build();
```

Every plugin here is independently swappable and independently testable —
adding a new cross-cutting concern (say, request logging) means adding one
`.use(...)` line, not threading a new call through every route file. Global
defaults (`authentication.required: true`, a 120-req/min rate limit) live in
one `.config(...)` block; an individual route only *overrides* them via its
own per-route `.config({...})` when it genuinely needs to (see the
route-structure skill for that).

### Auth is a plugin, not per-route middleware

```ts
// src/lib/server-plugins/auth.ts
import { AuthenticationPlugin, ServerPlugin } from "pumice.js";
import { prisma } from "../prisma";

export const authPlugin = AuthenticationPlugin({
  authenticator: async (c) => {
    const token = c.req.header("Authorization");
    if (!token) return { authenticated: false };

    const session = await prisma.session.findUnique({
      where: { token, expiresAt: { gt: new Date() } },
    });
    if (!session) return { authenticated: false };

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
    });
    if (!user) return { authenticated: false };

    return { authenticated: true, data: { user, session } };
  },
});

// Lets route/procedure code refer to the resolved auth shape by name
// instead of re-deriving it from the plugin generic every time it's needed.
type ExtractAuthState<T> =
  T extends ServerPlugin<infer P extends { auth: any }, any, any>
    ? P["auth"]
    : never;

export type AuthState = ExtractAuthState<typeof authPlugin>;
```

The authenticator is the *only* place a token gets turned into a user.
Every route and procedure downstream just reads `c.auth.data.user` — nothing
else re-implements token lookup, and there's exactly one place to change
the session model (e.g. swap to JWTs) later.

### Process entrypoint

Keep process bootstrapping in one file, separate from route/handler code:

```ts
// src/index.ts
import "dotenv/config";
import { server } from "./server";
import "./schedules/expire-stale-sessions";
import "./schedules/daily-usage-reset";
import { startWorkers } from "./lib/workers";

startWorkers();

// No top-level await: the app is CommonJS (it uses `__dirname` above).
server.listen({ port: 3000 }).catch((error) => {
  console.error(error);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error(error);
});

process.on("unhandledRejection", (error) => {
  console.error(error);
});
```

Don't hang startup logic on `listen()` resolving: in pumice.js up to 0.0.17
it resolves before the port is bound, and a taken port crashes the process
with an unhandled `EADDRINUSE` (pumice.js `docs/development/roadmap.md`).

Importing each schedule file purely for its side effect (registering a cron
job on module load) keeps "what runs periodically in this process"
greppable from one file — `git grep "schedules/"` in the entrypoint — instead
of discovered by accident when a `croner` call turns up somewhere deep in
business logic. Global `uncaughtException`/`unhandledRejection` handlers are
here specifically so a background job's unhandled error can't silently kill
the whole process without a log line.

## Why

Hand-rolling routing plus manual Zod validation plus a manually maintained
API doc page means three separate artifacts that silently drift out of sync
the moment someone updates one and forgets the other two. A schema-first,
file-routed framework collapses that to one artifact. Plugin composition
exists for the same reason: the alternative is cross-cutting concerns
threaded ad hoc through a five-hundred-line `createServer()` function, where
it's impossible to tell what's actually wired up without reading the whole
thing top to bottom. A one-screen list of `.use(...)` calls is a spec you
can review in ten seconds.

## Exceptions

- For a tiny single-purpose service (a webhook receiver, a one-route proxy)
  this ceremony isn't worth it — a bare Hono app with one handler is fine,
  and pulling in a whole routing/docs/client-generation framework for one
  endpoint is pure overhead.
- Don't reach for a pre-1.0 in-house framework like this on a project where
  the team doesn't already know it and I'm not around to unblock framework
  bugs myself — the payoff (typed routes + docs + client from one source)
  only pays off when someone on the project can actually debug the
  framework, not just the app built on it.
- The driver-adapter version of Prisma is worth it specifically for
  non-Node runtimes or engine-binary-size constraints; on a plain
  long-running Node server the default Prisma engine is simpler and just as
  fine.

## See also

- [api-default-libraries](../api-default-libraries/SKILL.md) — the auxiliary libraries (storage, email, payments, ...) that plug into this stack.
- [api-route-structure](../../routing/api-route-structure/SKILL.md) — how individual routes are written on top of this server setup.
