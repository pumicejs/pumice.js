# The manifest contract

pumice.js serves two JSON manifests that other code is generated from. They are a contract: the
client generator (`pumicejs/client`) and the docs CLI (`pumicejs/docs`) parse them, and apps
check generated clients into their repositories.

| Endpoint | Built by | Shape | Consumed by |
| --- | --- | --- | --- |
| `GET /@client` (`ClientGenerationPlugin`) | `src/client-manifest.ts` | `ClientManifest`, `version: 3` | `pumice generate` (client); `pumice-docs` (docs) |
| `GET /@docs` (`DocsPlugin`) | `src/plugins/docs.ts` | `DocsManifest`, `version: 1` | `pumice-docs` (docs) |

Both are wrapped in the success envelope (`{ code, message, data }`).

## What's in them

The types in `src/client-manifest.ts` and `src/types/docs.ts` are the definition, down to the
serialized schemas (`ClientManifestSchema`, `ClientManifestResponse`, `ClientManifestThrowEntry`),
and the serializers are typed against them. They are exported, so a consumer can `import type`
them instead of keeping its own copy. In words, per route: its path (`:param` segments), the
route file, the route-level config, the params schema, and per method its description, effective
config (merged, JSON-serializable keys only, with the `bodyLimit` that applies for every method
but GET), and schema: `body`, `query`, `headers` (JSON Schema), `response` (`single` or
`statusMap`, with `{ type: "void" }` for `z.void()`), `throws` (`descriptor`, `schema` or
`codeMap` per status) and `file` / `files` (their config). Dates are ISO strings.

## The fixtures

`fixtures/contract/client-manifest.json` and `fixtures/contract/docs-manifest.json` are what the
contract app (`test/fixtures/apps/contract/`) serves: one route for every shape above. The
volatile fields are pinned (`generatedAt`, `framework.version`, no `listeningSince`).

- `test/contract.test.ts` fails when the committed files differ from what the app serves.
- The client and docs repositories copy both files into their own tests, so they test against
  the real output instead of hand-written examples.

## Changing anything that reaches a manifest

The step by step is the `pumice-manifest-contract` skill
(`.agents/skills/pumice-manifest-contract/SKILL.md`). The rules:

1. **Append-only.** Add keys; never rename, remove or change the meaning of one. A consumer
   that doesn't know a key ignores it.
2. **A change that consumers must understand bumps `version`** (`3` → `4`) and is called out in
   the release notes. Consumers refuse versions they don't know.
3. **Regenerate the fixtures** (`npm run fixtures:contract`), review the JSON diff as part of
   the PR, and extend the contract app if the new shape isn't in it yet.
4. **The PR says what the client and docs repositories need**, and links their follow-up PRs or
   issues.
