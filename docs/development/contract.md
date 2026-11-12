# The manifest contract

pumice.js serves two JSON manifests that other code is generated from. They are a contract: the
client generator (`pumicejs/client`) and the docs CLI (`pumicejs/docs`) parse them, and apps
check generated clients into their repositories.

| Endpoint | Built by | Shape | Consumed by |
| --- | --- | --- | --- |
| `GET /@client` (`ClientGenerationPlugin`) | `src/client-manifest.ts` | `ClientManifest`, `version: 4` | `pumice generate` (client); `pumice-docs` (docs) |
| `GET /@docs` (`DocsPlugin`) | `src/plugins/docs.ts` | `DocsManifest`, `version: 2` | `pumice-docs` (docs) |

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

Each schema describes the side that sends it, in zod's `io` mode:

- **Request parts** (`params`, `body`, `query`, `headers`) are input mode, what a client may
  send: a field with a `.default()` isn't in `required`, a transform is the type it accepts
  (`z.string().transform(Number)` is `{ "type": "string" }`), and an object that strips unknown
  keys has no `additionalProperties` (a `.strict()` one has `false`).
- **`response`, `throws` and model bodies** are output mode, what the server sends: a defaulted
  field is required, a transform's output is `{}` unless it pipes into a schema, and every
  object that doesn't let unknown keys through says `additionalProperties: false`.

Both manifests also carry `models`: the bodies of the declared models
([`docs/concepts/models.md`](../concepts/models.md)) that their routes reach, directly or through
other models, by name and in declaration order, `{}` when there are none.

- **Refs.** A `$ref` that starts with `#/models/` names an entry of the same manifest's
  `models`, wherever it appears: route schemas, params, throws, and model bodies. Every other
  `#/…` ref (`#/$defs/__schema0`, `#`) points into the schema it appears in: the route schema
  (`body`, `response.jsonSchema`, a status in `statuses`, …) or the model body.
- **Model bodies** are JSON Schema without `$schema`, with the declared `description`, and are
  always written in full: a model is never an extension of another.
- **Extensions** are `allOf: [{ "$ref": "#/models/<name>" }, { "type": "object", "properties",
  "required"? }]`: the second part holds only the extra properties and has no
  `additionalProperties`. Use-site annotations (`description`) sit on the node beside `allOf`
  or `$ref`. The base says `additionalProperties: false` (output mode), so a strict validator
  finds the `allOf` unsatisfiable: the manifests describe types and docs, and nothing validates
  against them.
- **Request parts** refer to a model only where its input-mode JSON is its body, refs
  included: an enum, or a `.strict()` object without defaults or transforms whose models inside
  match too. Every other model is written in full there, in input mode, as without models (a
  plain `z.object()` always is, since it strips unknown keys). A ref in a request part therefore
  always means "send this body".
- **Pruning.** `/@client` lists the models of its exposed routes, `/@docs` those of the routes in
  its group tree. An app that declares no models gets the route schemas it got before.

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
2. **A change that consumers must understand bumps `version`** (`/@client` went 3 → 4 and
   `/@docs` 1 → 2 for models, because route schemas stopped being self-contained) and is called
   out in the release notes. Consumers refuse versions they don't know. Version 4 (and docs
   version 2) also means request parts in input mode (REVIEW §1.10): it landed before any
   release carried version 4, so both arrive in 0.2.0 and consumers adapt once.
3. **Regenerate the fixtures** (`npm run fixtures:contract`), review the JSON diff as part of
   the PR, and extend the contract app if the new shape isn't in it yet.
4. **The PR says what the client and docs repositories need**, and links their follow-up PRs or
   issues.
