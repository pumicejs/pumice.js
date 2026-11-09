---
name: api-route-structure
description: >-
  File-system routing conventions for a typed, schema-first API — how
  directories map to URL paths, when to use an index-style route file
  versus a plain named file versus a dynamic `[param]` segment versus
  scoped middleware, and the describe/body/config/response/throws/handle
  shape of a route handler, with full worked examples. Use when adding a
  new endpoint, deciding which file a route belongs in, or reviewing route
  structure for consistency.
metadata:
  type: practice
  category: architecture
---

## Rule

File path = URL path. See [api-route-procedures](../api-route-procedures/SKILL.md)
for the companion "resolve + guard a resource once" pattern referenced
below.

### Directory shape

```
src/routes/
  route.ts                     # GET /
  posts/
    route.ts                   # POST /posts   (collection-level)
    search.ts                  # GET /posts/search
    [postId]/
      route.ts                 # GET, PATCH, DELETE /posts/:postId
      comments.ts              # GET /posts/:postId/comments
  boards/
    route.ts                   # POST /boards
    [boardId]/
      route.ts                 # GET, PATCH, DELETE /boards/:boardId
      posts.ts                 # GET /boards/:boardId/posts
  (temp)/
    legacy-import.ts           # mid-migration escape hatch — not a pattern to copy
  context.mw.ts                # runs for every route in this subtree
  session-guard.mw.ts
```

- **An index-style file** (`route.ts`) in a directory owns that directory's
  own path. `boards/route.ts` → `POST /boards`. `boards/[boardId]/route.ts`
  → `/boards/:boardId`. Chain every HTTP method for that one path in the
  same file, so the full read/write contract for a resource is visible in
  one place instead of scattered across files.
- **A plain named file** adds a sub-path segment named after the file:
  `posts/search.ts` → `/posts/search`, `boards/[boardId]/posts.ts` →
  `/boards/:boardId/posts`. Use this for actions that aren't plain CRUD on
  the resource itself — verbs and cross-resource lookups, not another noun
  competing with the index file.
- **A bracketed directory** (`[postId]`) is a dynamic path segment, parsed
  and typed via `.params(zodSchema)` (directly, or inside a procedure — see
  below).
- **A scoped middleware file** (the `.mw.ts` suffix here) runs for every
  route in its subtree. Keep each one narrow — one cross-cutting concern
  per file (entering an async context, checking a session, bumping a
  last-used timestamp) — rather than one middleware file doing several
  unrelated things that then can't be selectively disabled.
- **A parenthesized directory** (`(temp)`) is a deliberate escape hatch for
  routes mid-migration or slated for deletion. It's a marker, not a pattern
  — don't clean it up to match these conventions, and don't imitate it for
  new routes.

### Index-style route file — full example

Collection-level (`POST /boards`):

```ts
// src/routes/boards/route.ts
import { boardRepo } from "@/lib/repos";
import { BoardSchema } from "@/lib/schemas";
import { server } from "@/server";
import { z } from "pumice.js";

server
  .route()
  .post()
  .describe("Create a new board")
  .body(z.object({ name: z.string().min(3) }).strict())
  .response(BoardSchema)
  .throws({
    409: { message: "A board with this name already exists" },
  })
  .handle(async (c) => {
    const { name } = c.body;

    const existing = await boardRepo.find({
      where: { name, userId: c.auth.data.user.id },
    });
    if (existing) {
      throw c.error({ status: 409 });
    }

    const board = await boardRepo.create({ name, userId: c.auth.data.user.id });
    return c.response({ status: 201, data: board });
  });
```

Item-level (`GET` / `PATCH` / `DELETE` on `/boards/:boardId`), all three
methods chained in one file, guarded by a shared procedure:

```ts
// src/routes/boards/[boardId]/route.ts
import { boardProcedure } from "@/lib/procedures";
import { boardRepo } from "@/lib/repos";
import { BoardSchema } from "@/lib/schemas";
import { zEditBody } from "@/lib/helpers/zod-utils";
import { server } from "@/server";
import { z } from "pumice.js";

server
  .route()
  .procedure(boardProcedure())

  .get()
  .describe("Get a single board by ID")
  .response(BoardSchema)
  .handle((c) => c.procedures.board)

  .patch()
  .describe("Rename or reconfigure a board")
  .body(zEditBody({ name: z.string().min(3), isPublic: z.boolean() }))
  .response(BoardSchema)
  .handle(async (c) => {
    return boardRepo.update({ where: { id: c.params.boardId }, data: c.body });
  })

  .delete()
  .describe("Delete a board")
  .response(z.void())
  .handle(async (c) => {
    await boardRepo.delete(c.procedures.board.id);
  });
```

`zEditBody(...)` builds a `.partial()` body schema for PATCH-style edits —
every field optional, so a client can send just the fields it's changing —
without re-typing `.optional()` on every field by hand.

### Named action file

Not every endpoint is CRUD on the resource. `posts/search.ts` adds a
`GET /posts/search` next to `posts/route.ts`'s `POST /posts`, without
forcing a search into the item/collection shape:

```ts
// src/routes/posts/search.ts
import { postRepo } from "@/lib/repos";
import { PostSchema } from "@/lib/schemas";
import { server } from "@/server";
import { z } from "pumice.js";

server
  .route()
  .get()
  .describe("Search the current user's posts by title")
  .query(z.object({ q: z.string().min(1) }))
  .response(z.array(PostSchema))
  .handle(async (c) => {
    return postRepo.findMany({
      where: { userId: c.auth.data.user.id, title: { contains: c.query.q } },
    });
  });
```

`.params(...)` is only for the dynamic segments of the path (`[postId]`);
the query string goes through `.query(...)`. A `q` declared in `.params()`
never receives `?q=`, so every request fails validation with a 400.

### Scoped middleware

```ts
// src/routes/context.mw.ts
import { requestContext } from "@/lib/contexts/request";
import { server } from "@/server";

server
  .middleware()
  .describe("Enter the per-request async context")
  .handle(async (c, next) => {
    return requestContext.run(
      { headers: c.req.header(), auth: c.auth },
      () => next(),
    );
  });
```

### Per-route config overrides

Global defaults (auth required, a baseline rate limit) live on the server
builder (see the framework-stack skill). A route overrides them explicitly
when it's a genuine exception — never by skipping the global config
silently:

```ts
// Public health check — no auth required.
server
  .route()
  .get()
  .config({ authentication: { required: false } })
  .describe("Health check")
  .response(z.string())
  .handle(() => "ok");

// An upload endpoint that does its own throughput control downstream,
// so the blanket per-minute limit doesn't apply here.
server
  .route()
  .post()
  .describe("Upload a post attachment")
  .config({ ratelimit: { limit: 999999, timeframe: 1000 } })
  .file({
    allowedTypes: ["image/png", "image/jpeg", "image/webp"],
    maxSize: 1024 * 1024 * 16,
  })
  .handle(async (c) => {
    /* c.file is the validated upload */
  });
```

### The handler chain, read as a spec

Every handler is one declarative chain, read top to bottom:

`describe` (human/docs summary) → `body` / `params` (request schema) →
`config` (per-route overrides) → `response` (success shape) → `throws`
(typed error cases) → `handle` (the actual logic).

`throws` declares status codes with a message and, when the error carries
data, a schema for it — so error responses are part of the same typed
contract as success responses, not an untyped `throw new Error(...)`
escape hatch:

```ts
server
  .route()
  .post()
  .describe("Import a board from an external service")
  .body(z.object({ sourceUrl: z.string().url() }))
  .response(BoardSchema)
  .throws({
    409: { message: "A board with this name already exists" },
    422: {
      message: "The external service rejected the import",
      data: z.object({ reason: z.string() }),
    },
  })
  .handle(async (c) => {
    // ...
    if (importFailed) {
      throw c.error({ status: 422, data: { reason: "rate_limited" } });
    }
    // ...
  });
```

A client generated from this contract knows, at the type level, that a 422
response carries `{ reason: string }` — no runtime guessing on the
consumer's end.

### Where resource guards live

Repeated "does this resource exist, does the caller own it" logic is
pulled into a **procedure**, resolved once and exposed to every chained
handler as `c.procedures.<name>` — see
[api-route-procedures](../api-route-procedures/SKILL.md) for the full
pattern. Route files orchestrate: read the guarded resource off
`c.procedures`, call into the domain/business layer (see
[api-manager-base](../../managers/api-manager-base/SKILL.md) and its
companions), and shape the one response they own. They don't hold
persistence logic beyond assembling that one response.

## Why

A framework that derives routes from the filesystem only pays off if the
mapping is unambiguous — mixing "index-style route" and "named action"
conventions arbitrarily makes it impossible to guess a URL from the file
tree, or a file from a URL, which defeats the entire point of file-based
routing. The `describe → body → config → response → throws → handle` chain
matters because it's the single source docs, request validation, and a
typed client all get generated from — hand-maintaining any of those
separately is exactly the drift this whole approach exists to avoid.

## Exceptions

- The `(temp)`-style escape hatch is allowed to violate every convention
  here on purpose, as a visible signal that the code inside is mid-migration
  and shouldn't be treated as a model to copy.
- A one-off internal/admin route that will never appear in public docs or a
  generated client can skip a full `describe`/`response`/`throws` treatment
  — but should still live in the right place in the file tree.

## See also

- [api-route-procedures](../api-route-procedures/SKILL.md) — the full "resolve + guard a resource" pattern behind `.procedure(...)`.
- [api-framework-stack](../../stack/api-framework-stack/SKILL.md) — where the global `authentication`/`ratelimit` defaults a route's `.config({...})` overrides actually come from.
- [api-manager-base](../../managers/api-manager-base/SKILL.md) — what a handler calls into once it has the guarded resource.
