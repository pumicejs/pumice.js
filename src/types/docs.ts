import type { RouteMethod } from "./route.js";

/**
 * A tag definition registered with {@link DocsPlugin}.
 *
 * Tags are referenced by routes via `route.config({ docs: { tags: ["name", ...] } })`
 * and resolved to their full descriptor in the docs manifest.
 */
export type DocsTagDefinition = {
  /**
   * Stable identifier referenced from per-route `docs.tags`.
   *
   * Convention: short, kebab-case, unique across the registry.
   */
  name: string;
  /** Human-readable label for the docs UI. Defaults to {@link name}. */
  label?: string;
  /**
   * Display color (any string the consumer understands — hex, CSS var, Tailwind class, etc.).
   *
   * The plugin does not interpret it; it's passed through verbatim to the manifest.
   */
  color?: string;
  /** Optional long-form description (markdown). */
  description?: string;
  /** Optional icon identifier (e.g. lucide icon name) — opaque to the plugin. */
  icon?: string;
};

/**
 * Match rules used by a {@link DocsGroupDefinition} to claim routes.
 *
 * A route matches the group when **every** specified predicate matches.
 * `pathPrefix` and `pathRegex` are OR'd against the URL path; multiple
 * `pathPrefix` entries are OR'd against each other; same for `method` / `tag`.
 */
export type DocsGroupMatch = {
  /**
   * URL prefix(es) that claim a route. Matches if the route path
   * starts with any of the listed values.
   *
   * @example `"/auth"` matches `/auth`, `/auth/login`, `/auth/register`.
   */
  pathPrefix?: string | string[];
  /**
   * Escape hatch: regex (as a string) tested against the URL path.
   *
   * Use sparingly — prefer {@link pathPrefix} when possible.
   */
  pathRegex?: string;
  /** Method or methods this group applies to. */
  method?: RouteMethod | RouteMethod[];
  /**
   * Tag name(s) the route must carry to join this group.
   *
   * Useful for cross-cutting groups like "Internal" or "Webhooks".
   */
  tag?: string | string[];
};

/**
 * A group definition registered with {@link DocsPlugin}.
 *
 * Groups partition routes in the docs UI sidebar. Each route belongs to at
 * most one group (chosen by, in order of precedence):
 * 1. `route.config({ docs: { group: "Name" } })` override
 * 2. First {@link DocsGroupDefinition} whose `match` matches
 * 3. Auto-grouping by the first URL path segment (unchanged from before)
 * 4. `defaultGroup` configured on the plugin
 */
export type DocsGroupDefinition = {
  /** Stable identifier referenced from per-route `docs.group`. */
  name: string;
  /** Human-readable label for the docs UI. Defaults to {@link name}. */
  label?: string;
  /** Optional long-form description (markdown). */
  description?: string;
  /** Opaque icon identifier passed through to the manifest. */
  icon?: string;
  /** Display color, passed through verbatim. */
  color?: string;
  /**
   * Sort order in the sidebar (ascending). Ties broken by declaration order,
   * then alphabetical group `name`. Defaults to `0`.
   */
  order?: number;
  /**
   * Parent group's {@link name}. Enables nested sidebar trees.
   *
   * Cycles and unknown parents are detected at boot and (per
   * `onUnknownGroup`) warn-and-flatten or are reported.
   */
  parent?: string;
  /**
   * Predicate(s) that claim routes for this group.
   *
   * Omit to make the group reachable only via the per-route
   * `docs.group` override.
   */
  match?: DocsGroupMatch;
};

/**
 * Per-route docs metadata contributed by {@link DocsPlugin}.
 *
 * Available on every `route.config({ docs: ... })` / `.config({ docs: ... })`
 * once the plugin is registered.
 */
export type DocsRouteMetadata = {
  /**
   * Tag names referencing entries from `DocsPlugin({ tags })`.
   *
   * Unknown tags are dropped from the manifest (with a warning by default —
   * configurable via `onUnknownTag`).
   *
   * Arrays replace on merge (same semantics as other config arrays).
   */
  tags?: string[];
  /**
   * Force this route into a specific group, overriding pattern-based matching
   * and auto-segment fallback.
   */
  group?: string;
  /** Short label used in sidebar listings. Defaults to the route `.describe(...)` text. */
  summary?: string;
  /** Long-form description (markdown) shown on the route detail view. */
  description?: string;
  /** Marks the route as deprecated in the docs UI. */
  deprecated?: boolean;
  /**
   * When `true`, the route is excluded from the docs manifest entirely.
   *
   * Independent of `exposeClient` from {@link ClientGenerationPlugin}: a route
   * can be visible to codegen but hidden from docs, or vice versa.
   */
  hidden?: boolean;
  /** Tiebreaker order within a group (ascending). */
  order?: number;
  /** Optional curated examples surfaced alongside the schema. */
  examples?: DocsRouteExample[];
};

/**
 * Curated example for a documented route.
 *
 * The plugin treats `request` / `response` as opaque — consumers (UI, codegen)
 * decide how to render them.
 */
export type DocsRouteExample = {
  /** Optional label, e.g. `"Happy path"` / `"403 — wrong role"`. */
  name?: string;
  /** Free-form description (markdown). */
  description?: string;
  /** Opaque example request payload. */
  request?: unknown;
  /** Opaque example response payload. */
  response?: unknown;
};

/**
 * Route config extension registered by {@link DocsPlugin}.
 *
 * Merged into `RouteConfig` via the plugin's type parameters, so
 * `route.config({ docs: { ... } })` becomes type-checked once the plugin
 * is registered with `Server.use(DocsPlugin(...))`.
 */
export type DocsRouteConfigExtension = {
  docs?: DocsRouteMetadata;
};

/**
 * What to do when a reference (tag or group) cannot be resolved against
 * the registry passed to {@link DocsPlugin}.
 */
export type DocsUnknownReferenceStrategy = "throw" | "warn" | "ignore";

/**
 * Resolved tag entry as it appears in the docs manifest.
 *
 * Includes all registry fields plus the original `name`, so consumers
 * don't need to cross-reference the registry separately.
 */
export type DocsManifestTag = {
  name: string;
  label: string;
  color?: string;
  description?: string;
  icon?: string;
};

/**
 * One documented route entry in the docs manifest.
 */
export type DocsManifestRoute = {
  /** Fully resolved URL path (e.g. `/users/:id`). */
  path: string;
  /** HTTP method this entry documents. */
  method: RouteMethod;
  /** Human-readable summary (from `docs.summary` or the route `.describe(...)`). */
  summary?: string;
  /** Long-form description from `docs.description`. */
  description?: string;
  /** Resolved tag names (unknown tags removed). */
  tags: string[];
  /** Mirrors `docs.deprecated`. */
  deprecated?: boolean;
  /** Mirrors `docs.order`. */
  order?: number;
  /**
   * Serialized route schema in the same shape used by the client manifest
   * (body / query / headers / response / throws / file(s)).
   *
   * `undefined` when the route declared no schema.
   */
  schema?: unknown;
  /** Path-params schema serialized as JSON Schema, when present. */
  params?: unknown;
  /** Pass-through of `docs.examples`. */
  examples?: DocsRouteExample[];
  /** Source file relative to the server root, for "view source" links. */
  routeFile: string;
};

/**
 * One node in the docs manifest's group tree.
 *
 * Groups may contain both routes and child groups. The tree is sorted
 * by `order` ascending, then by declaration order, then by `name`.
 */
export type DocsManifestGroup = {
  name: string;
  label: string;
  description?: string;
  icon?: string;
  color?: string;
  order?: number;
  /** Routes that belong directly to this group (not its children). */
  routes: DocsManifestRoute[];
  /** Nested groups, sorted the same way as the top-level list. */
  children: DocsManifestGroup[];
};

/**
 * Top-level docs manifest served at `GET <path>` (default `/@docs`).
 *
 * Designed to be consumed by external docs UIs — the plugin itself does
 * not render anything.
 */
export type DocsManifest = {
  version: 1;
  meta: {
    /** ISO-8601 timestamp the manifest was built. */
    generatedAt: string;
    framework: { name: string; version: string };
  };
  /** Full tag registry, resolved with defaults applied. */
  tags: DocsManifestTag[];
  /** Group tree (sorted). Includes the synthesized `defaultGroup` if used. */
  groups: DocsManifestGroup[];
};

/**
 * Result of {@link DocsPluginOptions.authenticator}.
 *
 * Mirrors the shape used by `ClientGenerationPlugin` for consistency.
 */
export type DocsManifestAccess =
  | { allow: true }
  | {
      allow: false;
      status?: number;
      code?: string;
      message?: string;
    };
