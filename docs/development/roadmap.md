# Roadmap

The menu of what to build next, and what's known to be missing. Each entry says what the next
step is, why it waits, and what should trigger it (the `docs-roadmap-notes` skill). References
like "REVIEW §1.6" point to the review of 2026-11-09 (`REVIEW.md` in the folder that holds the
three repositories, outside any of them). Every known bug has an `it.fails` test named with its reference; fixing it turns
that test red, which is the signal to make it an ordinary `it`.

A PR that builds an entry moves it to "Done"; one that finds something new adds it here.

## Done

- 2026-11-09, `chore/foundations`: tests (Vitest, fixture apps), ESLint, Prettier, CI on Node 22
  and 24, tag-based releases with trusted publishing, Dependabot, secret scan; `load()` and
  `fetch()`; one source for the type helpers, schema guards and the error path; hono 4.13.14 and
  @hono/node-server 2.1.5 (REVIEW §2.6); `zod` and `hono` as peer dependencies; LICENSE;
  contract fixtures. Fixed: a middleware that awaits `next()` without returning ran the handler
  twice (§1.1); a route file imported by another registered under the importer's path (§1.2);
  the rate limiter and logger trusted `X-Forwarded-For` (§2.1, now socket address plus
  `trustProxy`); no body size limit (§2.2, now `bodyLimit`, default 1 MiB).
- 2026-11-09: released as **0.1.0** from CI, with provenance, through trusted publishing. The
  stale `claude/priceless-mccarthy-ed0bd6` branch is deleted.

## Bugs

### Discovery imports files outside the routes folder (REVIEW §1.3) — high

`walkFiles` walks all of `rootDir` and `isRouteFile` matches `routes` anywhere in the absolute
path, so a project under `…/routes/…` imports every source file, and `*.test.ts` / `*.spec.ts`
next to routes are imported too. The next step: walk only `join(rootDir, basePath)`, match
relative to it, skip `.d.ts`, `*.test.*` and `*.spec.*`. **Trigger:** next discovery change, or
the first app that hits it. Tests: `discovery.test.ts`.

### `listen()` resolves before binding; a bind error kills the process (REVIEW §1.4) — high

Resolve in the `listening` callback, reject on `'error'`, return a handle with `close()`, accept
`hostname`. Waits only for a decision on the handle's shape. **Trigger:** graceful shutdown in
any app, or this release. Test: `it.todo` in `discovery.test.ts` (an `it.fails` would crash the
worker).

### Query strings: repeated keys and output-mode coercion (REVIEW §1.5) — medium

Collect repeated keys into arrays when the schema expects one; derive coercion from
`toJSONSchema(schema, { io: "input" })`, computed once at registration instead of per request.
Needs the same array encoding agreed with the client (`client` REVIEW §6.1). **Trigger:** with
the client's query serializer fix. Tests: `validation.test.ts`.

### An undeclared 4xx becomes a 500; procedures can't declare throws (REVIEW §1.6) — high

Let procedures and middleware declare `throws` that merge into the route's contract and the
manifest; in production, log a contract violation but send the 4xx. **Trigger:** before any app
combines procedures with `.throws(...)` (the playbook's own pattern). Tests:
`validation.test.ts`, `procedures.test.ts`.

### Hook errors skip the JSON envelope (REVIEW §1.7) — medium

Wrap the hook loop like the handler (`respondToThrown`, a "hook" stage) and set `app.onError`
once in `Server`. Small. **Trigger:** next pipeline change. Test: `plugins.test.ts`.

### Rate-limit headers are lost on most responses (REVIEW §1.8) — medium

Collect the headers on the context and apply them in one place to whatever response leaves the
pipeline. **Trigger:** with §1.7 (same place). Test: `ratelimit.test.ts`.

### The manifest describes request bodies in output mode (REVIEW §1.10) — high

`toJSONSchema(…, { io: "input" })` for body, query, headers and params; output for responses and
throws. A contract change: regenerate the fixtures and drop the client's `default` workaround.
**Trigger:** together with the client and docs fixture adoption. Test: `contract.test.ts`.

### The manifest leaves out procedure params and throws (REVIEW §1.11) — medium

Serialize the merged params schema; with §1.6, the procedures' throws. Contract change.
**Trigger:** with §1.6. Test: `contract.test.ts`.

### Smaller ones (REVIEW §1.12) — low

- An empty body on a route with an optional body schema is "Malformed JSON" (test:
  `validation.test.ts`).
- `use()` after `load()` is accepted and never applied (test: `discovery.test.ts`).
- A chain that selects a method and never calls `.handle()` registers nothing, silently: warn
  at load.
- Headers are validated by their lower-case names; documented in the tests, not yet in the
  user docs.
- `routeLevelConfig` in the manifest is the first registered method's config, not the
  route-level one (seen in `fixtures/contract/client-manifest.json`, `/admin/jobs`).
- `runProcedure` swaps `context.config` around an `await`; unverified whether nested procedures
  can observe the wrong one.

**Trigger:** opportunistically, each with its test.

## Security

### Rest of the rate limiter's weaknesses (REVIEW §2.1) — medium

Done: the address. Open: the default key includes params (`/users/1`, `/users/2` get separate
buckets); the in-memory store grows with every distinct key; `get` → `set` isn't atomic, and the
`RatelimitStore` interface has nothing a Redis store could do atomically. Next: an
`increment`-style store method, a size cap for the memory store, and `respectParams: false` as
the default (a behaviour change, so with a minor bump). **Trigger:** the first multi-instance
deployment, or the next minor.

### JSON accepted whatever the Content-Type (REVIEW §2.3) — medium

Require `application/json` / `+json` for JSON bodies; 415 otherwise. Breaks clients that send no
content type, so with a minor bump. **Trigger:** the first app whose authenticator reads a
cookie. Test: `validation.test.ts`.

### `/@client` and `/@docs` open by default (REVIEW §2.4) — medium

Off in production unless an authenticator is given; drop `routeFile` and
`beforeValidationHooksCount`. Needs both CLIs to send a header first (client and docs REVIEW
§6.3, §5.2). **Trigger:** once the CLIs ship `--header`. Test: `contract.test.ts`.

### Uploads trust the client's type (REVIEW §2.5) — medium

Sniff magic bytes for the declared types. Adds a dependency or a small table, so it's a choice.
**Trigger:** the first app that stores uploads it serves back. Test: `files.test.ts`.

### Plugins hook in by monkeypatching (REVIEW §2.7) — low

A hook registry in `RouteManager` that `server.routes.add()` also honours. **Trigger:** the next
plugin that needs a hook.

## API and internals

- **A typed request context** instead of `context as unknown as { … }` casts (45 of them):
  one object the pipeline builds and handlers receive. Large, touches every builder type.
  **Trigger:** before 1.0, or the next time the pipeline types are reworked.
- **Quiet by default** (REVIEW §3): a `logger` option on `Server`; `utils/log.ts` is the single
  seam already. **Trigger:** with the next `Server` option.
- **Intentional 5xx** (REVIEW §3): a thrown 503 with `Retry-After` should be possible;
  `c.response({ status: 503 })` sends `"code": "SUCCESS"`. **Trigger:** first app that needs a
  maintenance response.
- **A `hint` in the error envelope** (playbook `guidelines/apis/design.md`): additive.
  **Trigger:** with the next envelope change.
- **The docs plugin** drops routes whose `docs.group` isn't declared, and reports unknown tags
  and groups on every request instead of once at load (REVIEW §3). Test: `contract.test.ts`.
  **Trigger:** next docs plugin change.
- **`sideEffects: false`** in package.json, once checked that no module has import-time effects.

## Repository

- **Playbook skills** (`filstawski/playbook`, vendored here): `api-route-structure`'s
  `posts/search.ts` uses `.params()` where it needs `.query()`; `api-framework-stack`'s entrypoint
  assumes `listen()` resolves once listening (§1.4) and its `ClientGenerationPlugin()` is
  unauthenticated (§2.4); `api-route-procedures`' `throw 404` becomes a 500 on routes that
  declare `.throws(...)` (§1.6). The corrections are filstawski/playbook#2. *Trigger:* that PR
  merged; then `npx skills update` here.
- **Staged publishing** (far future). npm can hold each CI-published version until a maintainer
  approves it with 2FA (`npm stage publish`, npm 11.15 or later; approve on npmjs.com or with
  `npm stage approve`), so a compromised workflow or CI dependency can't publish alone.
  Decided 2026-11-09: not now; Filip chose direct publishing. *Trigger:* a second person with
  publish rights, or a supply-chain incident that reaches CI. Then switch `release.yml` to
  `npm stage publish --provenance` and untick **Allow npm publish** on the trusted publisher.

## Open questions

Each with a leaning; the user decides.

1. **Response validation** (REVIEW §1.9). The docs now say plainly that responses are types and
   docs only. Leaning: keep it that way, and add an opt-in `validateResponses: "development"`
   that parses (and strips) outside production.
2. **One repository for the three packages?** The manifest types are copied by hand into client
   and docs. Leaning: shared fixtures now (done), and decide a monorepo with a shared types
   package once a second contract change has gone through all three.
3. **Upload routes without a declared size** get the 1 MiB default. Leaning: keep it (safe by
   default) and say so in the release notes; the alternative is a higher default for multipart
   only.
