# Models

A model is a named schema (`User`, `Image`, `Folder`) that the client and docs manifests describe
once. Each manifest carries the model's JSON Schema under its top-level `models`, and every route
schema that uses it points there with `{ "$ref": "#/models/User" }`. A client generator can then
emit one named type per model, and a docs site can give each model one page that every endpoint
links to. Models need manifest-aware tools: `/@client` version 4 and `/@docs` version 2.

Routes don't change: they keep passing zod schemas to `.response()`, `.body()` and `.throws()`.
pumice recognises a model by the schema objects it is made of.

---

## Declaring models

```ts
import { ServerBuilder, type ModelDefinition } from "pumice.js";
import { BoardSchema, PartialUserSchema, UserSchema } from "./lib/schemas.js";

export const MODELS = [
  { name: "User", schema: UserSchema, description: "Someone with an account." },
  { name: "PartialUser", schema: PartialUserSchema },
  { name: "Board", schema: BoardSchema },
] satisfies ModelDefinition[];

export const server = new ServerBuilder().models(MODELS).build();
// or: new Server({ models: MODELS }), or server.models(MODELS)
```

A `ModelDefinition` is `{ name, schema, description? }`:

| Field | Meaning |
| --- | --- |
| `name` | PascalCase (`^[A-Z][A-Za-z0-9]*$`), unique on the server: the key in `models`, and so the name generated code and docs use. |
| `schema` | The zod schema your routes use. Anything but `z.void()`: objects, enums, unions. |
| `description` | Markdown for the model's page and its generated type. Defaults to the schema's own `.describe()` text. |

`models()` appends, so several calls add up. It throws, at the call, when:

- a name isn't PascalCase, or is already taken;
- the same schema is declared twice, or two objects have the same properties (the same property
  schemas, as two identical `.pick()`s would), since a route schema couldn't tell them apart;
- a model is `z.void()`;
- a route has already registered. Route schemas are serialized as routes register, so declare
  models before `load()` (or `listen()`) runs, next to the plugins.

---

## What the manifests say

| The route writes | The manifest says |
| --- | --- |
| `UserSchema`, `.brand()`, `.describe("…")`, `.meta()`, `.refine()` of it | `{ "$ref": "#/models/User" }`, with a use-site `description` beside the ref |
| it inside `z.array()`, `.nullable()`, `.optional()`, a union, a record, another object or model | the ref in place (`items`, `anyOf`, a property) |
| an object with exactly a model's properties, as the same schema objects: the same `.pick()` as a declared pick, a `.strict()` of the model, `z.object({ ...PartialUserSchema.shape })` | the ref |
| an object with all of a model's properties plus more: `.extend()`, `.safeExtend()`, `.merge()`, a spread, a wider `.pick()` of the model's source | `allOf` of the ref and an object with only the extra properties, using the largest such model |
| a larger model with one of its properties replaced: `UserSchema.extend({ bio: z.number() })` | the object in full: it overrides a User, it doesn't add to a PartialUser |
| a `.pick()` or `.omit()` subset, `.partial()`, `.required()`, `.loose()` / `.passthrough()`, anything else | the object in full, as without models |

A model's own body is always written in full, even when it contains another model's properties
(`User` holds every property of `PartialUser`, its pick). Recursion becomes a ref to the model
itself. A subset worth a page of its own is declared as its own model (`PartialUser`), and from
then on every route that picks those properties refers to it.

A plain use, a nullable use, and an extension:

```jsonc
// .response(UserSchema)
{ "$schema": "https://json-schema.org/draft/2020-12/schema", "$ref": "#/models/User" }

// .response(UserSchema.nullable())
{ "$schema": "…", "anyOf": [{ "$ref": "#/models/User" }, { "type": "null" }] }

// .response(UserSchema.extend({ isMe: z.boolean() }))
{
  "$schema": "…",
  "allOf": [
    { "$ref": "#/models/User" },
    { "type": "object", "properties": { "isMe": { "type": "boolean" } }, "required": ["isMe"] }
  ]
}
```

And the bodies they point at, in the manifest's `models`, in declaration order, without
`$schema`:

```jsonc
"models": {
  "User": {
    "description": "Someone with an account.",
    "type": "object",
    "properties": { "id": { "type": "string" }, "name": { "type": "string" } /* … */ },
    "required": ["id", "name" /* … */],
    "additionalProperties": false
  },
  "Board": {
    "type": "object",
    "properties": {
      "id": { "type": "number" },
      "owner": { "anyOf": [{ "$ref": "#/models/User" }, { "type": "null" }] }
    },
    "required": ["id", "owner"],
    "additionalProperties": false
  }
}
```

A ref that starts with `#/models/` always names an entry of the manifest's own `models`; any other
`#/…` ref (`#/$defs/__schema0`, for a recursive schema that isn't a model) points into the schema
it appears in. The exact contract is in [the development docs](../development/contract.md).

### Which models each manifest lists

- `server.getClientManifest()` lists every declared model.
- `/@client` (`ClientGenerationPlugin`) lists the models its routes reach, directly or through
  other models; a model only `exposeClient: false` routes use is left out.
- `/@docs` (`DocsPlugin`) does the same for the routes it documents, so a `docs.hidden` route's
  models stay out of the docs.

### A `.meta({ id })` with a model's name

zod moves a schema with `.meta({ id })` into the route schema's `$defs`, models or not. An id that
equals a declared model's name on another schema throws: while the route registers, or, inside a
model, when the manifest is first built. Rename one of them.

---

## Trade-offs

This is deliberately the first version: models are named, recognised and pointed at, and nothing
else about them is configurable yet.

- ✅ No route changes, and nothing to forget in a new route: recognition is by the schema
  objects routes already share.
- ✅ The test is exact, not a guess: `.extend()` and its siblings keep the base's property
  schema objects. Where it doesn't hold, the object is written out in full, which is always
  correct.
- ✅ Each model's JSON is written once, and `$ref` / `allOf` are what JSON Schema tools,
  OpenAPI and the client generator already read.
- ❌ A `.pick()`, `.omit()` or `.partial()` subset stays inline until it is declared as a model.
- ❌ Request bodies, queries and headers point at the same output-mode body as responses, so a
  field with a `.default()` reads as required there too (REVIEW §1.10, on the roadmap).
- ❌ Output-mode objects say `additionalProperties: false`, so a strict validator finds an
  extension's `allOf` unsatisfiable. The manifests describe types and docs; nothing validates
  against them (responses aren't validated at all).
- ❌ Model names are API: renaming a model renames its generated type.
- ❌ No docs-only metadata per model yet (label, group, order, hidden, examples).

## Where this goes next

`ModelDefinition` is an object so that it can grow without changing a call site:

1. Docs-only metadata goes into `DocsPlugin`, keyed by model name, like its tags.
2. Input-mode bodies arrive with REVIEW §1.10: a request part refers to a model only where its
   input-mode JSON equals the model's.
3. If recognition ever turns out ambiguous in practice, an explicit `extendModel(base, shape)`
   can override it. Plain `.extend()` keeps working.

Calls to `models([...])` and the routes stay as they are.
