---
name: api-route-procedures
description: >-
  Reusable "load and guard a resource" building block for a file-routed
  API — a procedure resolves a resource from a URL param, enforces
  existence/ownership rules exactly once, and hands the result to every
  chained route handler via a typed key, with a typed per-route config for
  legitimate access-rule variation. Use when the same "does this resource
  exist, does the caller own it" check is about to be copy-pasted into a
  second or third route handler, or when a resource needs different access
  rules for reads versus writes.
metadata:
  type: practice
  category: architecture
---

## Rule

Extract a procedure the first time a "resolve + guard" check would
otherwise be copy-pasted into a second route handler for the same resource.

### The shape

```ts
// src/lib/procedures.ts
import { postRepo } from "@/lib/repos";
import { server } from "@/server";
import { z } from "pumice.js";

const OWNER_SCOPED_METHODS = ["get", "post", "patch", "delete"] as const;
type OwnerScopedMethod = (typeof OWNER_SCOPED_METHODS)[number];

/** Shared per-route config shape for any "owned resource" procedure. */
export type OwnerScopedConfig = {
  /**
   * When true, the resource owner may differ from the authenticated user
   * (auth is still required). Use for resources meant to be visible across
   * owners — e.g. viewing another user's public post.
   */
  allowAnyUser?: boolean;
  /**
   * When `allowAnyUser` is not set, the resource owner must match the
   * session user unless the request uses one of these methods — e.g.
   * `["get"]` to allow cross-owner reads while keeping writes owner-only.
   */
  relaxMatchingUserForMethods?: OwnerScopedMethod[];
};

function methodOf(method: string | undefined): OwnerScopedMethod | undefined {
  const m = (method ?? "get").toLowerCase();
  return (OWNER_SCOPED_METHODS as readonly string[]).includes(m)
    ? (m as OwnerScopedMethod)
    : undefined;
}

/**
 * Requires a post to exist and, unless relaxed, the session user to own it.
 *
 * @example
 * server.route().procedure(postProcedure()).get().handle((c) => c.procedures.post);
 */
export const postProcedure = server
  .procedure()
  .config<OwnerScopedConfig>()
  .params(z.object({ postId: z.number() }))
  .handle(async (c) => {
    const post = await postRepo.fetch({ where: { id: c.params.postId } });
    if (!post) throw 404;

    if (c.config.allowAnyUser === true) return { post };

    const method = methodOf(c.req.method);
    const relaxed =
      method !== undefined &&
      c.config.relaxMatchingUserForMethods?.includes(method) === true;

    if (!relaxed && post.userId !== c.auth.data?.user.id) throw 403;

    return { post };
  });
```

Used from a route, with reads relaxed and writes staying owner-only:

```ts
server
  .route()
  .procedure(postProcedure({ relaxMatchingUserForMethods: ["get"] }))

  .get()
  .describe("Get a post (any owner)")
  .handle((c) => c.procedures.post)

  .patch()
  .describe("Edit a post (owner only)")
  .body(/* ... */)
  .handle(async (c) => {
    // c.procedures.post is guaranteed to exist and (for this method) be
    // owned by the caller — no defensive `if (!post)` needed here.
  });
```

A second, independent procedure for a different resource follows the exact
same shape — the boilerplate is the point, it means the ownership check
itself can't drift between resources:

```ts
export const boardProcedure = server
  .procedure()
  .config<OwnerScopedConfig>()
  .params(z.object({ boardId: z.number() }))
  .handle(async (c) => {
    const board = await boardRepo.fetch({ where: { id: c.params.boardId } });
    if (!board) throw 404;
    if (c.config.allowAnyUser === true) return { board };

    const method = methodOf(c.req.method);
    const relaxed =
      method !== undefined &&
      c.config.relaxMatchingUserForMethods?.includes(method) === true;
    if (!relaxed && board.userId !== c.auth.data?.user.id) throw 403;

    return { board };
  });
```

A procedure that doesn't need per-call-site variation skips `.config<...>()`
entirely — e.g. a resource where ownership is always strict and cross-owner
access never makes sense:

```ts
export const inviteProcedure = server
  .procedure()
  .params(z.object({ inviteId: z.number() }))
  .handle(async (c) => {
    const invite = await inviteRepo.find({ where: { id: c.params.inviteId } });
    if (!invite) throw 404;
    if (invite.userId !== c.auth.data.user.id) throw 403;
    return { invite };
  });
```

### Rules of thumb

- A procedure's `.handle()` return value's keys land on `c.procedures.<key>`
  for every handler chained after `.procedure(...)` in that route file.
- Give a procedure a typed `.config<...>()` for *legitimate* call-site
  variation, instead of writing near-duplicate procedures
  (`postProcedureAnyOwner`, `postProcedureOwnerOnly`, ...) that will
  inevitably drift from each other.
- A procedure throws `404`/`403` directly rather than returning a sentinel
  the handler has to check — every handler downstream can then treat
  `c.procedures.post` as guaranteed to exist and be authorized, with zero
  defensive checks in the handler body.
- One procedure per resource type. If two procedures for the same resource
  start diverging beyond what `config` covers, that's a sign the access
  rule itself needs to move somewhere more central (a real permission
  layer) rather than living in route-loading code.
- Procedures compose with route-level middleware but solve a different
  problem: middleware (`.mw.ts` files) runs for a whole subtree regardless
  of which specific resource is involved; a procedure is scoped to loading
  and guarding one specific resource identified by a URL param.

## Why

"Does this resource exist, and does the caller own it" is the single most
repeated piece of logic in a REST-ish API — and it's also the piece where
an inconsistency becomes a real security bug: one route relaxes an
ownership check the others don't, or a copy-pasted check gets slightly
mistyped under time pressure (`!==` becomes `===`, `403` becomes `401`).
Centralizing it in one procedure per resource type means the check gets
reviewed once and reused everywhere, instead of re-typed — and possibly
re-typed wrong — in every handler that touches that resource.

## Exceptions

- Don't extract a procedure for a resource guarded in exactly one route.
  Inline the check until a genuine second call site shows up — a procedure
  with one caller is indirection with no payoff.
- A procedure is for "resolve one thing and check access to it," not a
  general authorization framework. More complex authorization (role-based
  checks spanning multiple resources, org-level permission trees) belongs
  in a dedicated permission layer the procedure calls into, not hand-rolled
  inside the procedure itself.

## See also

- [extract-reusable-primitives](../../../extract-reusable-primitives/SKILL.md) — the general form of "give a procedure a typed `.config()` instead of writing `postProcedureAnyOwner` / `postProcedureOwnerOnly`": one parameterized primitive, not near-duplicate copies that will drift.
- [api-route-structure](../api-route-structure/SKILL.md) — how a procedure attaches to a route file via `.procedure(...)`.
- [api-manager-base](../../managers/api-manager-base/SKILL.md) — a procedure typically calls a manager's `fetch` to resolve the row it guards.
