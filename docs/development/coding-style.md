# Coding style

How code is written in pumice.js, so it reads as if one person wrote it. Taken from the house
rules of the user's other projects (hg-crm and website-v6 `docs/coding-style.md`, crm-v2
`docs/practices/`) and the playbook (`guidelines/frontend/code-style.md`,
`guidelines/backend/security-and-testing.md`, `guidelines/stacks/`), narrowed to a TypeScript
library. Longer versions of several rules are skills in `.agents/skills/`.

## 1. The bar

- **Only ready, polished code gets committed.** A first version that works isn't done yet. The
  `code-polish` pass runs before every "ready to commit".
- **Match the surrounding code first.** Look at how the file and its siblings handle the same
  thing, and do it that way, before reaching for a general rule.
- **Every line has a reason.** A polish pass usually makes the diff smaller.
- **Nothing untrue.** No doc, comment or error message claims something the runtime doesn't
  do. Responses are not validated, so nothing says they are.

## 2. The public surface

- **`src/index.ts` is the API.** Everything exported there is a promise to every app using
  pumice; everything else may change. Add an export only on purpose, and list it in the README.
- **Append, don't break.** A renamed option, error code, envelope field or manifest key breaks
  apps and the client and docs repositories. Add the new one; deprecate the old one in the docs.
  Breaking changes wait for a minor bump while the version is 0.x, and the release notes say
  what to change.
- **Errors carry a stable code.** Every response the framework sends uses the envelope
  (`code`, `message`, optional `data` / `issues`) with an UPPER_SNAKE code (`VALIDATION_ERROR`,
  `PAYLOAD_TOO_LARGE`). A new code is part of the contract (`contract.md`).
- **Safe by default.** A default never trusts something a client can write
  (`X-Forwarded-For`), never reads an unbounded body, never exposes internals in a 500.
  Loosening it is an explicit option (`trustProxy`, `bodyLimit: false`).

## 3. Where code goes

See [architecture.md](architecture.md). In short:

- **A generic mechanic gets its own file on first use** (`utils/client-ip.ts`), with a generic
  name, a doc comment and the options the next caller will reasonably need.
- **Fix behaviour where it lives**, once: the client address in `utils/client-ip.ts` serves both
  the rate limiter and the logger.
- **The core doesn't import plugins** (lint-enforced).

## 4. One source for each thing

- **Share values; never copy them under a new name.** Type helpers live in `utils/types.ts`,
  schema guards in `schema/guards.ts`, the error-to-response path in one function
  (`respondToThrown`). A second copy is the moment to extract (`extract-reusable-primitives`).
- **Constants that tune behaviour are UPPER_SNAKE**, with a one-line comment saying what they
  mean (`DEFAULT_BODY_LIMIT`, `STACK_DEPTH`).
- **The framework writes to stdout in one place** (`utils/log.ts`), so a logger option can
  replace it.

## 5. Names

- **Code is English.** Identifiers, files, error codes, docs.
- **Files are kebab-case**; types and classes PascalCase; functions camelCase.
- **Name a thing for what it is,** not for the feature that prompted it: `resolveClientIp`, not
  `ratelimitIp`.
- **Predicates read as a question:** `isZodSchema`, `isAuthenticationRequired`.
- **Generic parameters are `T`-prefixed words** (`TContextExtensions`), never single letters.

## 6. Comments

- **Explain why, not what.** The code already says what it does.
- **Every export gets a doc comment:** what it's for, its contract, and anything a caller
  wouldn't guess (`load()` is idempotent; `fetch()` without `env` has no client address). An
  `@example` when usage isn't obvious.
- **No history.** Not "used to", "the old version", "now". Git keeps the history; a long story
  goes in a doc the comment points to.
- **Comments stay true.** When the code changes, its comment changes with it.
- **A number that isn't obvious gets its meaning** in one line.

## 7. Types

- **The honest type beats a cast.** Narrow with a type guard (`schema/guards.ts`) rather than
  `as`. The pipeline still decorates Hono's `Context` with casts
  (`context as unknown as { body: unknown }`); replacing them with one typed request context is
  on the roadmap — don't add new ones.
- **A cast that has to stay gets its why** in one line right above it.
- **No `any`, `@ts-ignore` or `eslint-disable`** without a stated reason on the same line
  (`-- reason`) or the line above. `any` is accepted only in the widest-type aliases
  (`AnyRouteProcedureDefinition`), where a contravariant handler makes `unknown` impossible.
- **`{}` is the identity of the extension intersections** (`TContext & {}` is `TContext`); the
  lint rule allows it on purpose.
- **Phantom type parameters** (`ServerPlugin`'s three, `ExplicitRouteResponse`'s) are commented
  as such where they are declared.

## 8. Formatting and imports

- **Prettier with its defaults** (width 80), checked in CI; Markdown is excluded and wrapped by
  hand. Run `npm run format` before committing.
- **Import order:** packages, then relative imports; type-only names imported with
  `import type` or inline `type`.
- **ESM with explicit `.js` extensions** in relative imports (NodeNext).

## 9. Dependencies

- **Library, version and provider choices are the user's.** Recommend two options with your
  pick, then wait for a yes. Prefer what's installed.
- **`zod` and `hono` are peer dependencies** (one copy shared with the app), and dev
  dependencies for the tests. `@hono/node-server` is a dependency.
- **A version you choose is at least a week old**; a security fix at least two
  (`npm install <pkg>@<version> --before=<date>`).
- **Resolve the lockfile on Linux** after every dependency change, then verify on both sides:

  ```sh
  docker run --rm -v "$PWD:/app" -w /app node:24-alpine npm install --package-lock-only
  docker run --rm -v "$PWD:/app" -w /app node:24-alpine npm ci
  npm ci
  ```

- **Node:** `.nvmrc` is 24 (LTS), `engines` is `>=22`, `@types/node` follows the lowest
  supported line (22) so nothing newer slips in; CI runs 22 and 24.

## 10. Commits and pull requests

- **Nothing is committed unasked.** A batch is staged, shown, approved, then committed.
- **Conventional commits** (`git-commit-messages`): an imperative summary, a body that says why,
  no AI attribution.
- **One branch per change, a PR to main with the template filled in; the user merges** once CI
  is green. The PR says whether the manifest changed.
