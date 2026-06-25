import type { Context } from "hono";
import type { Server as ServerInstance } from "../structures/server.js";
import {
  createApiJsonErrorResponse,
  createApiJsonSuccessResponse,
} from "../http/json-envelope.js";
import type { ServerPlugin } from "../types/plugin.js";
import type { RouteMethod } from "../types/route.js";
import {
  CLIENT_MANIFEST_METHOD_ORDER,
  type ClientManifest,
  type ClientManifestMethod,
  type ClientManifestRoute,
} from "../client-manifest.js";
import type {
  DocsGroupDefinition,
  DocsGroupMatch,
  DocsManifest,
  DocsManifestAccess,
  DocsManifestGroup,
  DocsManifestRoute,
  DocsManifestTag,
  DocsRouteConfigExtension,
  DocsRouteMetadata,
  DocsTagDefinition,
  DocsUnknownReferenceStrategy,
} from "../types/docs.js";

/**
 * Options for {@link DocsPlugin}.
 */
export type DocsPluginOptions = {
  /**
   * Tag registry. Routes reference these by `name` via
   * `route.config({ docs: { tags: ["name", ...] } })`.
   *
   * Unknown tags are dropped from the manifest; the default behavior is to
   * `console.warn` (see {@link onUnknownTag}).
   */
  tags?: DocsTagDefinition[];
  /**
   * Group registry. Each group can claim routes via {@link DocsGroupDefinition.match},
   * be referenced explicitly via `route.config({ docs: { group: "Name" } })`,
   * or both.
   *
   * Routes that don't match any registered group fall back to auto-grouping
   * by the first URL path segment (preserving prior behavior), or to
   * {@link defaultGroup} if even that yields nothing.
   */
  groups?: DocsGroupDefinition[];
  /**
   * Group used when neither a per-route override, a registry match, nor the
   * auto-segment fallback produces a usable group (e.g. for the root path).
   *
   * Omit to leave such routes ungrouped at the manifest root.
   */
  defaultGroup?: { name: string; label?: string };
  /**
   * HTTP path the docs manifest is served at.
   *
   * Defaults to `"/@docs"` (the leading `@` keeps it out of the way of
   * normal routes — same convention as `ClientGenerationPlugin`).
   */
  path?: string;
  /**
   * Optional gate invoked for every manifest request before the payload is
   * built. Returning `{ allow: false }` short-circuits with a JSON error
   * envelope (defaults: 403 / `FORBIDDEN`).
   */
  authenticator?: (
    context: Context,
  ) => DocsManifestAccess | Promise<DocsManifestAccess>;
  /**
   * What to do when a route references a tag that isn't in {@link tags}.
   *
   * Defaults to `"warn"` — emit a `console.warn` at boot and drop the
   * unknown name from the route's tag list.
   */
  onUnknownTag?: DocsUnknownReferenceStrategy;
  /**
   * What to do when a route references a group name (via `docs.group`)
   * or a `parent` that isn't in {@link groups}.
   *
   * Defaults to `"warn"`. Unknown route-level groups synthesize a flat
   * group entry; unknown parents flatten the affected group to the root.
   */
  onUnknownGroup?: DocsUnknownReferenceStrategy;
};

type ResolvedGroup = {
  definition: DocsGroupDefinition;
  /** Declaration index — used as a stable secondary sort key. */
  declaredAt: number;
};

const AUTO_GROUP_PREFIX = "__auto:";

function handleUnknownReference(
  strategy: DocsUnknownReferenceStrategy | undefined,
  message: string,
): void {
  const effective = strategy ?? "warn";
  if (effective === "throw") {
    throw new Error(message);
  }
  if (effective === "warn") {
    console.warn(`[DocsPlugin] ${message}`);
  }
}

function normalizeMethodList(
  value: RouteMethod | RouteMethod[] | undefined,
): RouteMethod[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeStringList(
  value: string | string[] | undefined,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value : [value];
}

function matchesGroup(
  match: DocsGroupMatch | undefined,
  routePath: string,
  method: RouteMethod,
  tags: string[],
): boolean {
  if (!match) {
    return false;
  }

  const prefixes = normalizeStringList(match.pathPrefix);
  if (prefixes && prefixes.length > 0) {
    const hit = prefixes.some(
      (prefix) =>
        routePath === prefix || routePath.startsWith(`${prefix}/`),
    );
    if (!hit) {
      return false;
    }
  }

  if (match.pathRegex !== undefined) {
    const regex = new RegExp(match.pathRegex);
    if (!regex.test(routePath)) {
      return false;
    }
  }

  const methods = normalizeMethodList(match.method);
  if (methods && methods.length > 0 && !methods.includes(method)) {
    return false;
  }

  const requiredTags = normalizeStringList(match.tag);
  if (requiredTags && requiredTags.length > 0) {
    const carriesEvery = requiredTags.every((tag) => tags.includes(tag));
    if (!carriesEvery) {
      return false;
    }
  }

  return true;
}

function extractDocsMetadata(
  effectiveConfig: Record<string, unknown>,
): DocsRouteMetadata | undefined {
  const raw = effectiveConfig["docs"];
  if (raw === undefined || raw === null || typeof raw !== "object") {
    return undefined;
  }
  return raw as DocsRouteMetadata;
}

function deriveAutoGroupFromPath(routePath: string): {
  name: string;
  label: string;
} | undefined {
  const trimmed = routePath.replace(/^\/+/, "");
  if (trimmed.length === 0) {
    return undefined;
  }
  const firstSegment = trimmed.split("/")[0];
  if (!firstSegment || firstSegment.length === 0) {
    return undefined;
  }
  return {
    name: `${AUTO_GROUP_PREFIX}${firstSegment}`,
    label: firstSegment,
  };
}

function resolveTags(
  requested: string[] | undefined,
  registry: Map<string, DocsTagDefinition>,
  routePath: string,
  method: RouteMethod,
  onUnknownTag: DocsUnknownReferenceStrategy | undefined,
): string[] {
  if (!requested || requested.length === 0) {
    return [];
  }
  const resolved: string[] = [];
  for (const name of requested) {
    if (registry.has(name)) {
      if (!resolved.includes(name)) {
        resolved.push(name);
      }
      continue;
    }
    handleUnknownReference(
      onUnknownTag,
      `Route ${method.toUpperCase()} ${routePath} references unknown tag "${name}".`,
    );
  }
  return resolved;
}

function resolveGroupAssignment(
  options: {
    routePath: string;
    method: RouteMethod;
    tags: string[];
    metadata: DocsRouteMetadata | undefined;
    groupsByName: Map<string, ResolvedGroup>;
    orderedGroups: ResolvedGroup[];
    autoGroups: Map<string, DocsGroupDefinition>;
    defaultGroup: DocsGroupDefinition | undefined;
    onUnknownGroup: DocsUnknownReferenceStrategy | undefined;
  },
): DocsGroupDefinition | undefined {
  const {
    routePath,
    method,
    tags,
    metadata,
    groupsByName,
    orderedGroups,
    autoGroups,
    defaultGroup,
    onUnknownGroup,
  } = options;

  if (metadata?.group) {
    const explicit = groupsByName.get(metadata.group);
    if (explicit) {
      return explicit.definition;
    }
    handleUnknownReference(
      onUnknownGroup,
      `Route ${method.toUpperCase()} ${routePath} references unknown group "${metadata.group}". Synthesizing a flat group.`,
    );
    return { name: metadata.group, label: metadata.group };
  }

  for (const candidate of orderedGroups) {
    if (matchesGroup(candidate.definition.match, routePath, method, tags)) {
      return candidate.definition;
    }
  }

  const auto = deriveAutoGroupFromPath(routePath);
  if (auto) {
    const existing = autoGroups.get(auto.name);
    if (existing) {
      return existing;
    }
    const created: DocsGroupDefinition = {
      name: auto.name,
      label: auto.label,
    };
    autoGroups.set(auto.name, created);
    return created;
  }

  return defaultGroup;
}

function sortGroupDefinitions(
  groups: ResolvedGroup[],
): ResolvedGroup[] {
  return [...groups].sort((a, b) => {
    const orderA = a.definition.order ?? 0;
    const orderB = b.definition.order ?? 0;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    if (a.declaredAt !== b.declaredAt) {
      return a.declaredAt - b.declaredAt;
    }
    return a.definition.name.localeCompare(b.definition.name);
  });
}

function sortRoutes(routes: DocsManifestRoute[]): DocsManifestRoute[] {
  return [...routes].sort((a, b) => {
    const orderA = a.order ?? 0;
    const orderB = b.order ?? 0;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    if (a.path !== b.path) {
      return a.path.localeCompare(b.path);
    }
    const methodA = CLIENT_MANIFEST_METHOD_ORDER.indexOf(a.method);
    const methodB = CLIENT_MANIFEST_METHOD_ORDER.indexOf(b.method);
    return methodA - methodB;
  });
}

function toManifestTag(tag: DocsTagDefinition): DocsManifestTag {
  return {
    name: tag.name,
    label: tag.label ?? tag.name,
    color: tag.color,
    description: tag.description,
    icon: tag.icon,
  };
}

function emptyManifestGroup(definition: DocsGroupDefinition): DocsManifestGroup {
  return {
    name: definition.name,
    label: definition.label ?? definition.name,
    description: definition.description,
    icon: definition.icon,
    color: definition.color,
    order: definition.order,
    routes: [],
    children: [],
  };
}

function buildGroupTree(
  options: {
    rootGroups: DocsGroupDefinition[];
    routesByGroup: Map<string, DocsManifestRoute[]>;
    groupsByName: Map<string, ResolvedGroup>;
    autoGroups: Map<string, DocsGroupDefinition>;
    defaultGroup: DocsGroupDefinition | undefined;
    onUnknownGroup: DocsUnknownReferenceStrategy | undefined;
  },
): DocsManifestGroup[] {
  const {
    rootGroups,
    routesByGroup,
    groupsByName,
    autoGroups,
    defaultGroup,
    onUnknownGroup,
  } = options;

  const childrenByParent = new Map<string, ResolvedGroup[]>();
  const roots: ResolvedGroup[] = [];

  let declaredAt = 0;
  const seenNames = new Set<string>();

  function registerGroupDefinition(definition: DocsGroupDefinition): void {
    if (seenNames.has(definition.name)) {
      return;
    }
    seenNames.add(definition.name);

    let parent = definition.parent;
    if (parent !== undefined && !groupsByName.has(parent)) {
      handleUnknownReference(
        onUnknownGroup,
        `Group "${definition.name}" references unknown parent "${parent}". Treating as top-level.`,
      );
      parent = undefined;
    }

    const resolved: ResolvedGroup = { definition, declaredAt: declaredAt++ };
    if (parent === undefined) {
      roots.push(resolved);
      return;
    }

    const list = childrenByParent.get(parent) ?? [];
    list.push(resolved);
    childrenByParent.set(parent, list);
  }

  for (const definition of rootGroups) {
    registerGroupDefinition(definition);
  }
  for (const autoDefinition of autoGroups.values()) {
    registerGroupDefinition(autoDefinition);
  }
  if (defaultGroup !== undefined) {
    registerGroupDefinition(defaultGroup);
  }

  function build(resolved: ResolvedGroup, visiting: Set<string>): DocsManifestGroup {
    const node = emptyManifestGroup(resolved.definition);
    const routes = routesByGroup.get(resolved.definition.name);
    if (routes && routes.length > 0) {
      node.routes = sortRoutes(routes);
    }

    if (visiting.has(resolved.definition.name)) {
      return node;
    }
    visiting.add(resolved.definition.name);

    const children = childrenByParent.get(resolved.definition.name) ?? [];
    const sortedChildren = sortGroupDefinitions(children);
    node.children = sortedChildren.map((child) => build(child, visiting));

    visiting.delete(resolved.definition.name);
    return node;
  }

  const sortedRoots = sortGroupDefinitions(roots);
  return sortedRoots
    .map((root) => build(root, new Set<string>()))
    .filter((node) => node.routes.length > 0 || node.children.length > 0);
}

function buildDocsManifest(
  clientManifest: ClientManifest,
  options: DocsPluginOptions,
): DocsManifest {
  const tagRegistry = new Map<string, DocsTagDefinition>();
  for (const tag of options.tags ?? []) {
    tagRegistry.set(tag.name, tag);
  }

  const groupsByName = new Map<string, ResolvedGroup>();
  const declaredGroups: DocsGroupDefinition[] = [];
  let declarationIndex = 0;
  for (const group of options.groups ?? []) {
    if (groupsByName.has(group.name)) {
      handleUnknownReference(
        options.onUnknownGroup,
        `Duplicate group name "${group.name}". The first declaration wins.`,
      );
      continue;
    }
    groupsByName.set(group.name, { definition: group, declaredAt: declarationIndex++ });
    declaredGroups.push(group);
  }
  const orderedGroups = sortGroupDefinitions([...groupsByName.values()]);

  const defaultGroupDefinition: DocsGroupDefinition | undefined =
    options.defaultGroup !== undefined
      ? {
          name: options.defaultGroup.name,
          label: options.defaultGroup.label ?? options.defaultGroup.name,
        }
      : undefined;

  const autoGroups = new Map<string, DocsGroupDefinition>();
  const routesByGroup = new Map<string, DocsManifestRoute[]>();
  const ungrouped: DocsManifestRoute[] = [];

  for (const route of clientManifest.routes) {
    for (const method of CLIENT_MANIFEST_METHOD_ORDER) {
      const entry = route.methods[method];
      if (entry === undefined) {
        continue;
      }
      const metadata = extractDocsMetadata(entry.effectiveConfig);
      if (metadata?.hidden) {
        continue;
      }

      const tags = resolveTags(
        metadata?.tags,
        tagRegistry,
        route.path,
        method,
        options.onUnknownTag,
      );

      const group = resolveGroupAssignment({
        routePath: route.path,
        method,
        tags,
        metadata,
        groupsByName,
        orderedGroups,
        autoGroups,
        defaultGroup: defaultGroupDefinition,
        onUnknownGroup: options.onUnknownGroup,
      });

      const manifestRoute = buildManifestRoute(route, method, entry, metadata, tags);

      if (group === undefined) {
        ungrouped.push(manifestRoute);
        continue;
      }

      const list = routesByGroup.get(group.name) ?? [];
      list.push(manifestRoute);
      routesByGroup.set(group.name, list);
    }
  }

  const groupTree = buildGroupTree({
    rootGroups: declaredGroups,
    routesByGroup,
    groupsByName,
    autoGroups,
    defaultGroup: defaultGroupDefinition,
    onUnknownGroup: options.onUnknownGroup,
  });

  if (ungrouped.length > 0) {
    groupTree.push({
      name: "__ungrouped",
      label: "Ungrouped",
      routes: sortRoutes(ungrouped),
      children: [],
    });
  }

  const manifestTags: DocsManifestTag[] = (options.tags ?? []).map(toManifestTag);

  return {
    version: 1,
    meta: {
      generatedAt: new Date().toISOString(),
      framework: clientManifest.meta.framework,
    },
    tags: manifestTags,
    groups: groupTree,
  };
}

function buildManifestRoute(
  route: ClientManifestRoute,
  method: RouteMethod,
  entry: ClientManifestMethod,
  metadata: DocsRouteMetadata | undefined,
  tags: string[],
): DocsManifestRoute {
  return {
    path: route.path,
    method,
    summary: metadata?.summary ?? entry.descriptor,
    description: metadata?.description,
    tags,
    deprecated: metadata?.deprecated,
    order: metadata?.order,
    schema: entry.schema,
    params: route.params,
    examples: metadata?.examples,
    routeFile: route.routeFile,
  };
}

/**
 * Exposes a docs manifest describing the running app — tags, groups, routes —
 * as a JSON endpoint suitable for any external docs UI.
 *
 * What it adds:
 * - **Route-config key**: `docs?: { tags?, group?, summary?, description?, deprecated?, hidden?, order?, examples? }`
 *   typed via the plugin's `TRouteConfigExtensions`.
 * - **HTTP route**: `GET <path>` (default `/@docs`) returning the
 *   {@link DocsManifest} (tag registry + sorted, nested group tree of routes).
 * - **Validation**: at boot, references from `docs.tags` / `docs.group` /
 *   `parent` are checked against the registry. The default is `warn`
 *   (drop + `console.warn`); configurable per kind to `throw` or `ignore`.
 *
 * Grouping precedence (highest wins):
 * 1. Per-route `docs.group` override
 * 2. First registered group whose `match` matches the route
 * 3. Auto-grouping by first URL path segment (preserves pre-plugin behavior)
 * 4. Plugin-level `defaultGroup`
 *
 * Marked `unique: true` (id: `"pumice.js/docs"`) — registering twice throws.
 *
 * @example
 * ```ts
 * server.use(
 *   DocsPlugin({
 *     tags: [
 *       { name: "auth", label: "Authentication", color: "#22c55e" },
 *       { name: "billing", label: "Billing", color: "#f59e0b" },
 *     ],
 *     groups: [
 *       { name: "API", label: "Public API" },
 *       { name: "Auth", parent: "API", match: { pathPrefix: "/auth" } },
 *       { name: "Billing", parent: "API", match: { pathPrefix: ["/billing", "/checkout"] } },
 *     ],
 *   }),
 * );
 *
 * server.route()
 *   .config({ docs: { tags: ["auth"], summary: "Sign in" } })
 *   .post()
 *     .schema({ body: LoginBody, response: { 200: LoginResponse } })
 *     .handle(async (c) => ...);
 * ```
 */
export function DocsPlugin(
  options: DocsPluginOptions = {},
): ServerPlugin<{}, DocsRouteConfigExtension, never> {
  return {
    id: "pumice.js/docs",
    unique: true,
    apply({ server, app }) {
      const path = options.path ?? "/@docs";
      const serverInstance = server as unknown as ServerInstance;

      app.get(path, async (context) => {
        if (options.authenticator) {
          const access = await options.authenticator(context);
          if (!access.allow) {
            const status = access.status ?? 403;
            return createApiJsonErrorResponse(status, {
              code: access.code ?? "FORBIDDEN",
              message:
                access.message ?? "You are not allowed to access the docs manifest.",
            });
          }
        }

        const clientManifest = serverInstance.getClientManifest();
        const payload = buildDocsManifest(clientManifest, options);
        return createApiJsonSuccessResponse(payload);
      });
    },
  };
}
