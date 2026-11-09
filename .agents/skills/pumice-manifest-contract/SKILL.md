---
name: pumice-manifest-contract
description: >-
  The cross-repository procedure for any change that reaches pumice.js's client manifest
  (/@client) or docs manifest (/@docs): route schemas and how they serialize, effective config,
  envelope codes, manifest keys or version. Use before changing src/client-manifest.ts,
  src/plugins/docs.ts, src/plugins/client-generation.ts, src/types/docs.ts, the envelope, a
  config key that is serialized, or anything the contract app (test/fixtures/apps/contract/)
  exercises; and when the contract test says the fixtures are stale.
metadata:
  type: project
  category: architecture
---

## Rule

The manifests are parsed by two other repositories, `pumicejs/client` (the `pumice generate`
client generator) and `pumicejs/docs` (the docs CLI and viewer). Apps check generated clients
in. A manifest change is therefore a three-repository change, made in this order:

1. **Decide whether it's additive.** Adding a key, a new `kind`, a new error code: additive.
   Renaming, removing, changing a meaning or a type: breaking, and it bumps the manifest
   `version` (`ClientManifest.version`, `DocsManifest.version`). Prefer the additive form, even
   at the cost of a slightly redundant key.
2. **Make the change in pumice.js**, and extend the contract app
   (`test/fixtures/apps/contract/`) so the new shape appears in it: one route per shape, written
   the way apps write routes.
3. **Regenerate the fixtures:** `npm run fixtures:contract`. Read the JSON diff of
   `fixtures/contract/*.json` line by line; every changed line must be one you meant. Then
   `npm test` must pass without the update flag.
4. **Say what the consumers need**, in the PR's "Contract" section: which keys they should read,
   and whether old consumers keep working (they must for an additive change: unknown keys are
   ignored).
5. **Update the consumers**, each in its own PR in its own repository: copy both fixture files
   into its tests (`client`: `test/fixtures/pumice/`, `docs`: `test/fixtures/pumice/`; check the
   repository's `docs/` if that moved), make its contract tests pass, and link the pumice.js PR.
6. **Release in order:** pumice.js first, then the consumers, so nothing generates from a
   manifest its generator doesn't know. A version bump is called out in all three release notes.

Don't hand-edit the fixture files, and don't change a consumer's copy without the pumice.js
change that produced it.

## Why

The manifest types are copied by hand into both consumers, with nothing else tying them
together. The review of 2026-11-09 found drift on every side of it: request bodies serialized
in output mode (fields with defaults marked required), procedure params missing, error codes
documented under the wrong name, multipart encodings that disagree. Real fixtures, generated
from one app and decoded by every consumer's tests, catch that drift in CI instead of in an
app's generated client.

## Exceptions

- A change that only reaches the manifest's volatile fields (`generatedAt`, `listeningSince`,
  `framework.version`) needs no fixture update; the contract test pins them.
- A purely internal refactor of `client-manifest.ts` passes the contract test unchanged; if it
  doesn't, it wasn't purely internal.

## See also

- `docs/development/contract.md` — what the manifests contain and who reads them.
- `docs-feature-planning-spec` — for a breaking manifest change, write the plan first.
