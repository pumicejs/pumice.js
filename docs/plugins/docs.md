# `DocsPlugin`

Adds **documentation-oriented metadata** on top of the route manifest:

- A **tag registry** with labels, colors, descriptions — referenced by
  routes via `route.config({ docs: { tags: ["name"] } })`.
- A **customizable, nested group tree** for the docs sidebar, with rules
  that automatically claim routes by path prefix, method, or tag (with
  per-route overrides).
- Per-route metadata: `summary`, `description`, `deprecated`, `hidden`,
  `order`, curated `examples`.
- A **JSON endpoint** (`GET /@docs`) that serves the merged docs manifest
  for any external docs UI — designed to be consumed by the companion
  [`pumice-docs`](#docs-generator-integration) generator.

```ts
import { DocsPlugin } from "pumice.js";

server.use(
  DocsPlugin({
    tags: [
      { name: "auth",    label: "Authentication", color: "#22c55e" },
      { name: "billing", label: "Billing",        color: "#f59e0b" },
      { name: "internal", label: "Internal",      color: "#64748b" },
    ],
    groups: [
      { name: "API",     label: "Public API" },
      { name: "Auth",    parent: "API", match: { pathPrefix: "/auth" } },
      { name: "Billing", parent: "API", match: { pathPrefix: ["/billing", "/checkout"] } },
      { name: "Ops",     match: { tag: "internal" } },
    ],
  }),
);
```

---

## Identity

- Factory: `DocsPlugin(options)`
- Id: `"pumice.js/docs"`
- `unique: true` — registering twice throws.

---

## Plugin options — `DocsPluginOptions`

| Field | Type | Default | Effect |
|---|---|---|---|
| `tags` | `DocsTagDefinition[]` | `[]` | Tag registry; routes reference entries by `name` |
| `groups` | `DocsGroupDefinition[]` | `[]` | Group registry; entries can be matched against routes via `match` and/or referenced explicitly |
| `defaultGroup` | `{ name, label? }` | _(undefined)_ | Fallback group when neither pattern-match nor auto-segment yields a usable group |
| `path` | `string` | `"/@docs"` | URL path the manifest is served at (`GET`) |
| `authenticator` | `(c: Context) => DocsManifestAccess \| Promise<...>` | _(open)_ | Per-request gate (mirrors `ClientGenerationPlugin`) |
| `onUnknownTag` | `"throw" \| "warn" \| "ignore"` | `"warn"` | What to do when a route references a tag not in the registry |
| `onUnknownGroup` | `"throw" \| "warn" \| "ignore"` | `"warn"` | What to do for unknown groups / parents |

---

## Tags

### Definition — `DocsTagDefinition`

```ts
type DocsTagDefinition = {
  name: string;          // stable id; referenced by routes
  label?: string;        // human label (default: name)
  color?: string;        // any string the UI consumes (hex, CSS var, Tailwind class)
  description?: string;  // markdown
  icon?: string;         // opaque icon id (e.g. lucide name)
};
```

`color` is **not** interpreted by the plugin — it's passed through verbatim
into the manifest, so your docs UI can decide how to render it. A hex like
`#22c55e` is the most portable choice.

### Usage on a route

```ts
server
  .route()
  .config({ docs: { tags: ["auth", "internal"] } })
  .post()
    .describe("Rotate session")
    .handle(async (c) => ...);
```

Tags propagate through the route config merge: setting
`server.config({ routes: { docs: { tags: ["internal"] } } })` makes every
route inherit `["internal"]`. Arrays follow the same merge rules as other
arrays in `RouteConfig` (the override **replaces**, not concatenates).

### Validation

At boot, the plugin walks the route manifest and checks every referenced
tag name against the registry. Unknown tags:

- `onUnknownTag: "throw"` — server fails to start
- `onUnknownTag: "warn"` (default) — `console.warn`, tag is dropped from
  the route's resolved tag list
- `onUnknownTag: "ignore"` — silently drop

Catches typos like `"auht"` before they ship.

---

## Grouping

Groups partition routes in the docs UI sidebar. Each route belongs to at
most one group, chosen by this **precedence** (highest first):

1. **Per-route override** — `route.config({ docs: { group: "Name" } })`
2. **First registered group whose `match` matches**
3. **Auto-grouping** by the first URL path segment (preserves the prior
   docs behavior; nothing regresses if you don't register any groups)
4. **`defaultGroup`** — only used when even the auto-segment fallback
   produces nothing (e.g. for the root `/` path)

### Definition — `DocsGroupDefinition`

```ts
type DocsGroupDefinition = {
  name: string;              // stable id; referenced by routes
  label?: string;            // human label (default: name)
  description?: string;
  icon?: string;
  color?: string;
  order?: number;            // ascending; ties broken by declaration order then name
  parent?: string;           // enables nested sidebar trees
  match?: DocsGroupMatch;    // optional — see below
};
```

### Match rules — `DocsGroupMatch`

A route matches a group when **every** specified predicate matches.
`pathPrefix` / `pathRegex` are OR'd against the URL path; multiple
`pathPrefix` entries are OR'd against each other; same for `method` /
`tag`.

```ts
type DocsGroupMatch = {
  pathPrefix?: string | string[];           // "/auth" matches /auth, /auth/login, ...
  pathRegex?: string;                       // escape hatch
  method?: RouteMethod | RouteMethod[];     // limit to a method
  tag?: string | string[];                  // require route to carry these tags
};
```

Examples:

```ts
// All /auth/** routes
{ name: "Auth", match: { pathPrefix: "/auth" } }

// /billing/** and /checkout/** combined
{ name: "Billing", match: { pathPrefix: ["/billing", "/checkout"] } }

// Only routes tagged "internal"
{ name: "Ops", match: { tag: "internal" } }

// Only DELETE methods anywhere
{ name: "Destructive", match: { method: "delete" } }

// Regex escape hatch
{ name: "Legacy v1", match: { pathRegex: "^/v1/" } }
```

A group with no `match` is only reachable via the per-route `docs.group`
override — useful when you want a sidebar bucket that's manually curated.

### Nested groups — `parent`

```ts
groups: [
  { name: "API" },                                              // root
  { name: "Auth",    parent: "API", match: { pathPrefix: "/auth" } },
  { name: "Billing", parent: "API", match: { pathPrefix: "/billing" } },
  { name: "Ops",     match: { tag: "internal" } },               // separate root
]
```

Renders as:

```
API
├── Auth
└── Billing
Ops
```

`parent` references the parent group's `name`. Unknown parents are handled
according to `onUnknownGroup` (default warn + flatten to root). Cycles are
detected and broken (the offending group is treated as a root).

### Sort order

Within a sidebar level, groups are sorted by `order` ascending, then by
declaration order, then alphabetically by `name`. Routes within a group
are sorted by `docs.order` ascending, then by path lexicographically, then
by method canonical order.

### Auto-grouping fallback

When a route matches no registered group **and** has no `docs.group`
override, the plugin auto-derives a group from the first non-empty path
segment of the URL — exactly the behavior the docs UI had before
`DocsPlugin` existed. So introducing the plugin without declaring `groups`
is a no-op (no regression).

When even the auto-segment fallback yields nothing (e.g. for the root
path `/`), the route lands in `defaultGroup` if you configured one,
otherwise in a synthesized `"Ungrouped"` bucket at the manifest root.

---

## Per-route metadata — `docs`

`DocsPlugin` contributes one key to `RouteConfig`:

```ts
type DocsRouteMetadata = {
  tags?: string[];          // references DocsPlugin({ tags })
  group?: string;           // overrides match-based grouping
  summary?: string;         // short label for sidebar / detail
  description?: string;     // long-form (markdown)
  deprecated?: boolean;     // marks the route as deprecated in the docs
  hidden?: boolean;         // excludes from the docs manifest entirely
  order?: number;           // tiebreaker within a group (ascending)
  examples?: DocsRouteExample[];
};

type DocsRouteExample = {
  name?: string;
  description?: string;
  request?: unknown;        // opaque to the plugin
  response?: unknown;
};
```

Set per-route or per-method:

```ts
// Hide one method
server.route()
  .post().config({ docs: { hidden: true } }).handle(...);

// Mark whole route deprecated, with replacement note
server.route()
  .config({ docs: {
    deprecated: true,
    description: "Use POST /v2/items instead. This endpoint will be removed on 2027-01-01.",
  } })
  .post().handle(...);

// Curated examples
server.route()
  .config({ docs: { examples: [
    { name: "Happy path", request: { ... }, response: { ... } },
    { name: "403 — wrong role", request: { ... }, response: { ... } },
  ] } })
  .post().handle(...);
```

> **`docs.hidden` vs `exposeClient: false`** — they're independent. A
> route can be visible to codegen but hidden from docs (or vice versa).
> Set both when you want it fully invisible.

---

## The docs manifest (`GET /@docs`)

The plugin mounts `GET <path>` returning a JSON envelope wrapping a
`DocsManifest`:

```jsonc
{
  "code": "SUCCESS",
  "message": "OK",
  "data": {
    "version": 1,
    "meta": {
      "generatedAt": "2026-06-25T17:53:21.000Z",
      "framework": { "name": "pumice.js", "version": "0.0.16" }
    },
    "tags": [
      { "name": "auth", "label": "Authentication", "color": "#22c55e" },
      { "name": "billing", "label": "Billing", "color": "#f59e0b" }
    ],
    "groups": [
      {
        "name": "API",
        "label": "Public API",
        "routes": [],
        "children": [
          {
            "name": "Auth",
            "label": "Auth",
            "routes": [
              {
                "path": "/auth/login",
                "method": "post",
                "summary": "Sign in",
                "tags": ["auth"],
                "schema": { "body": {...}, "response": {...} },
                "routeFile": "routes/auth/login/route.ts"
              }
            ],
            "children": []
          }
        ]
      }
    ]
  }
}
```

Schema for each route uses the same JSON-Schema serialization as
[`ClientGenerationPlugin`](./client-generation.md#what-zod-becomes-json-schema)
(Zod → JSON Schema with `z.date()` mapped to `iso.datetime()` and
`z.void()` preserved as `{ type: "void" }`).

Type re-exports:

```ts
import type {
  DocsPluginOptions,
  DocsTagDefinition,
  DocsGroupDefinition,
  DocsGroupMatch,
  DocsRouteMetadata,
  DocsRouteExample,
  DocsRouteConfigExtension,
  DocsUnknownReferenceStrategy,
  DocsManifestTag,
  DocsManifestRoute,
  DocsManifestGroup,
  DocsManifest,
  DocsManifestAccess,
} from "pumice.js";
```

### `authenticator`

Mirrors `ClientGenerationPlugin` — return `{ allow: false, status?, code?, message? }`
to short-circuit with a JSON error envelope (defaults: `403 / FORBIDDEN`).

```ts
DocsPlugin({
  ...,
  authenticator: async (c) =>
    c.req.header("x-internal") === process.env.DOCS_TOKEN
      ? { allow: true }
      : { allow: false, status: 401 },
});
```

---

## Plugin contributions

| Slot | Contribution |
|---|---|
| `TContextExtensions` | _(none)_ |
| `TRouteConfigExtensions` | `{ docs?: DocsRouteMetadata }` |
| `TContextRefinementRules` | _(none)_ |

---

## Docs generator integration

The companion `pumice-docs` package consumes this manifest. When pointed
at an HTTP source, it automatically tries `GET /@docs` (in addition to
`GET /@client`) and falls back to deriving everything from
`effectiveConfig.docs` if `/@docs` isn't available.

```bash
# Default: also tries /@docs on the same origin
pumice-docs generate -u http://localhost:3000

# Explicit docs manifest path
pumice-docs generate -u http://localhost:3000 --docs-manifest-path /@docs

# File source — disable docs manifest by leaving the flag off, or:
pumice-docs generate -u ./manifest.json --docs-manifest-path ./docs-manifest.json
```

What the generator does with the docs manifest:

- **Tags** are rendered as colored chips next to each route (with a
  filter row in the sidebar).
- **Groups** become the sidebar's nested tree (replacing the
  previous path-segment-only grouping).
- **`deprecated`** routes get a "Deprecated" badge and a strike-through
  treatment in the sidebar.
- **`hidden`** routes are excluded entirely from generated output.
- **`summary` / `description`** are rendered as the heading and detail
  description.
- **`examples`** are rendered as separate "Examples" panels alongside the
  auto-generated code samples.

For HTML / OpenAPI / Markdown / MCP details, see the `pumice-docs` README
in the companion package.

---

## Recipes

### Minimal — just tag a few routes

```ts
server.use(
  DocsPlugin({
    tags: [
      { name: "auth", label: "Authentication", color: "#22c55e" },
      { name: "internal", label: "Internal", color: "#64748b" },
    ],
  }),
);

server.route().config({ docs: { tags: ["internal"] } }).get().handle(...);
```

No groups configured → routes still group by first path segment (no
regression vs the pre-plugin behavior), but each route now shows its tag
chips in the docs UI.

### Standard public-API layout

```ts
DocsPlugin({
  tags: [
    { name: "auth",    label: "Authentication", color: "#22c55e" },
    { name: "billing", label: "Billing",        color: "#f59e0b" },
    { name: "internal", label: "Internal",      color: "#64748b" },
  ],
  groups: [
    { name: "API",          label: "Public API", order: 0 },
    { name: "Authentication", parent: "API", match: { pathPrefix: "/auth" } },
    { name: "Users",          parent: "API", match: { pathPrefix: "/users" } },
    { name: "Billing",        parent: "API", match: { pathPrefix: ["/billing", "/checkout"] } },
    { name: "Internal",  label: "Internal", order: 10, match: { tag: "internal" } },
  ],
})
```

### Hide a deprecated route from docs without breaking it

```ts
server.route()
  .config({ docs: { hidden: true, deprecated: true } })
  .get().handle(...);    // still served at the URL, just not advertised
```

### Curated request/response examples per route

```ts
server.route()
  .config({ docs: { examples: [
    {
      name: "Happy path",
      request: { body: { email: "ada@example.com" } },
      response: { code: "SUCCESS", message: "OK", data: { id: 1 } },
    },
    {
      name: "Already registered",
      request: { body: { email: "existing@example.com" } },
      response: { code: "EMAIL_TAKEN", message: "Email already registered" },
    },
  ] } })
  .post().handle(...);
```

### Force a route into a manually-curated group

Declare a group with **no `match`**, then point routes at it by name:

```ts
DocsPlugin({
  groups: [
    { name: "Special",  label: "Special", order: 99 },
    { name: "API" /* ... */ },
  ],
});

server.route()
  .config({ docs: { group: "Special" } })
  .get().handle(...);
```

---

## Related

- [`ClientGenerationPlugin`](./client-generation.md) — same underlying
  manifest, different audience
- [Plugins](../concepts/plugins.md) — the extension model
- Companion `pumice-docs` generator — consumes `/@docs`
