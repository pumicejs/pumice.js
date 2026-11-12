# Testing

`npm test` runs Vitest over `test/*.test.ts`. Everything runs in-process: no port, no network.

## How a test is built

- **A fixture app per area**, under `test/fixtures/apps/<name>/`: a `server.ts` exporting a
  `Server` with `rootDir: import.meta.dirname`, and real route, middleware and procedure files
  under `routes/` and `lib/`, written the way apps write them (they import `"pumice.js"`, which
  Vitest maps to `src/index.ts`).
- **A test file per area** loads its app once (`await server.load()`) and sends requests with
  `call(server, path, init)` from `test/helpers.ts`, which returns the status, headers and
  parsed body. Vitest isolates test files, so each gets fresh module state.
- **The client address** comes from Node's socket in production. In tests pass it as Hono's
  bindings: `call(server, "/x", { env: socket("198.51.100.1") })`. Give each test its own
  address from a documentation range so rate-limit buckets never collide.
- **Pure logic** (path parsing, config merging, rate-limit algorithms, the body-limit
  resolution) is tested directly in `test/units.test.ts`; how schemas are recognised as models
  is tested on the serializer in `test/models.test.ts`, each JSON pinned.
- **Console noise** from expected 500s is silenced with `vi.spyOn(console, "error")`, and the
  test asserts the log line.

| Fixture app | Covers |
| --- | --- |
| `routing` | URL mapping, static-before-dynamic, groups, index files, middleware order and scope, cross-imports |
| `validation` | body/query/params/headers, coercion, envelopes, `throws`, 500 handling |
| `procedures` | params merge, use-site config, `applyOnMethods`, procedure errors |
| `files` | single and multiple uploads, sizes, counts, types |
| `limits` | the body limit |
| `ratelimit`, `ratelimit-proxy` | every algorithm, scope, helper, header, `trustProxy`, `onLimitReached` |
| `plugins` | authentication, CORS, logger, unique registration |
| `contract` | the manifests (and the committed fixtures, see [contract.md](contract.md)) |
| `models` | models declared through the builder, refs in bodies and throws, `models` pruned per manifest |
| `../routes/app` | discovery in a project whose path contains `routes` |

## Bugs

- **Reproduce first.** A bug fix starts with a test of the correct behaviour that fails on the
  unfixed code. Run it, see it fail, then fix.
- **A known bug that isn't fixed yet is an `it.fails` test** of the correct behaviour, named
  with its reference (`"… (REVIEW §1.6)"`) and listed in [roadmap.md](roadmap.md). CI stays
  green; fixing the bug makes `it.fails` fail, which is the signal to turn it into `it`.
- **A bug that would crash the test worker** (an unhandled `'error'` event) is an `it.todo`
  with the reason.
- **Fix the class, not the instance:** look for the same pattern elsewhere and cover it.

## Before calling something done

```sh
npm run check   # format:check, lint, typecheck (src + test), test, build
```

CI runs the same on Node 22 and 24, plus `npm audit --omit=dev` and the package-contents check.
To try another Node line locally without installing it:

```sh
docker run --rm -v "$PWD:/app" -w /app node:22-alpine sh -c "npm ci && npm test"
```

(That writes a Linux `node_modules`; run `npm ci` again on the Mac afterwards.)
