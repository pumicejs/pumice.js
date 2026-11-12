import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeRouteConfig } from "./config/routes.js";
import { resolveBodyLimit } from "./http/body-limit.js";
import type { RouteConfig } from "./types/config.js";
import type { AllowedFileType } from "./types/file.js";
import type { RouteBeforeValidationHook, RouteMethod } from "./types/route.js";
import type {
  RouteParamsSchema,
  RouteSchema,
  RouteThrowsCodeSchemaMap,
  RouteThrowsSchema,
  RouteResponseSchema,
} from "./types/schema.js";
import {
  isThrowDescriptor,
  isThrowsCodeSchemaMap,
  isZodSchema,
  isZodVoidSchema,
} from "./schema/guards.js";
import {
  MODEL_REF_PREFIX,
  reachableRefs,
  zodToSerializableJsonSchema,
} from "./schema/json-schema.js";
import type { ModelRegistry } from "./schema/models.js";

function serializeThrowStatusEntry(
  entry: unknown,
  models: ModelRegistry,
): ClientManifestThrowEntry | undefined {
  if (isZodSchema(entry)) {
    return {
      kind: "schema",
      jsonSchema: zodToSerializableJsonSchema(entry, models),
    };
  }

  if (isThrowDescriptor(entry)) {
    return {
      kind: "descriptor",
      message: entry.message,
      data:
        entry.data !== undefined
          ? zodToSerializableJsonSchema(entry.data, models)
          : undefined,
      issues:
        entry.issues !== undefined
          ? zodToSerializableJsonSchema(entry.issues, models)
          : undefined,
    };
  }

  if (isThrowsCodeSchemaMap(entry)) {
    return { kind: "codeMap", codes: serializeThrows(entry, models) };
  }

  return undefined;
}

/** A `throws` map, keyed by status or, one level down, by business code. */
function serializeThrows(
  throws: RouteThrowsSchema | RouteThrowsCodeSchemaMap,
  models: ModelRegistry,
): Record<string, ClientManifestThrowEntry> {
  const out: Record<string, ClientManifestThrowEntry> = {};
  for (const [key, entry] of Object.entries(throws)) {
    const serialized = serializeThrowStatusEntry(entry, models);
    if (serialized !== undefined) {
      out[key] = serialized;
    }
  }
  return out;
}

function serializeResponse(
  response: RouteResponseSchema,
  models: ModelRegistry,
): ClientManifestResponse {
  if (isZodSchema(response)) {
    if (isZodVoidSchema(response)) {
      return { shape: "single", type: "void" };
    }
    return {
      shape: "single",
      jsonSchema: zodToSerializableJsonSchema(response, models),
    };
  }

  const statuses: Record<string, ClientManifestJsonSchema> = {};
  for (const [status, schema] of Object.entries(response)) {
    if (isZodSchema(schema)) {
      statuses[status] = isZodVoidSchema(schema)
        ? { type: "void" }
        : zodToSerializableJsonSchema(schema, models);
    }
  }
  return { shape: "statusMap", statuses };
}

function serializeRouteSchema(
  schema: RouteSchema | undefined,
  models: ModelRegistry,
): ClientManifestSchema | undefined {
  if (!schema || Object.keys(schema).length === 0) {
    return undefined;
  }

  const result: ClientManifestSchema = {};

  if (schema.body !== undefined && isZodSchema(schema.body)) {
    result.body = zodToSerializableJsonSchema(schema.body, models);
  }
  if (schema.query !== undefined && isZodSchema(schema.query)) {
    result.query = zodToSerializableJsonSchema(schema.query, models);
  }
  if (schema.headers !== undefined && isZodSchema(schema.headers)) {
    result.headers = zodToSerializableJsonSchema(schema.headers, models);
  }
  if (schema.response !== undefined) {
    result.response = serializeResponse(schema.response, models);
  }
  if (schema.throws !== undefined) {
    result.throws = serializeThrows(schema.throws, models);
  }
  if (schema.file !== undefined) {
    result.file = {
      fieldName: schema.file.fieldName ?? "file",
      maxSize: schema.file.maxSize,
      minSize: schema.file.minSize,
      allowedTypes: schema.file.allowedTypes,
      required: schema.file.required ?? true,
    };
  }
  if (schema.files !== undefined) {
    result.files = {
      fieldName: schema.files.fieldName ?? "files",
      maxSize: schema.files.maxSize,
      minSize: schema.files.minSize,
      totalMaxSize: schema.files.totalMaxSize,
      allowedTypes: schema.files.allowedTypes,
      minCount: schema.files.minCount,
      maxCount: schema.files.maxCount,
    };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function serializeRouteParams(
  paramsSchema: RouteParamsSchema | undefined,
  models: ModelRegistry,
): ClientManifestJsonSchema | undefined {
  if (!paramsSchema || !isZodSchema(paramsSchema)) {
    return undefined;
  }

  return zodToSerializableJsonSchema(paramsSchema, models);
}

/** Order used when serializing {@link ClientManifestRoute.methods}. */
export const CLIENT_MANIFEST_METHOD_ORDER: readonly RouteMethod[] = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "any",
];

function orderManifestMethods<T>(
  methods: Partial<Record<RouteMethod, T>>,
): Partial<Record<RouteMethod, T>> {
  const ordered: Partial<Record<RouteMethod, T>> = {};
  for (const method of CLIENT_MANIFEST_METHOD_ORDER) {
    const entry = methods[method];
    if (entry !== undefined) {
      ordered[method] = entry;
    }
  }
  return ordered;
}

/** Route registration fields needed to build the client manifest (no handler). */
export type RouteManifestSource = {
  method: RouteMethod;
  description?: string;
  params?: RouteParamsSchema;
  schema?: RouteSchema;
  config?: RouteConfig<object>;
  beforeValidationHooks?: RouteBeforeValidationHook<object>[];
};

/**
 * A JSON Schema (draft 2020-12) as zod writes it in output mode, with dates as
 * ISO date-time strings. `z.void()`, which JSON Schema can't express, is
 * `{ type: "void" }`.
 *
 * A `$ref` that starts with `#/models/` names an entry of the manifest's
 * top-level `models`; any other `#/…` ref (`#/$defs/__schema0`) points into
 * the schema it appears in.
 */
export type ClientManifestJsonSchema = Record<string, unknown>;

/** A route's success response: one schema for every 2xx, or one per status. */
export type ClientManifestResponse =
  | { shape: "single"; type: "void" }
  | { shape: "single"; jsonSchema: ClientManifestJsonSchema }
  | { shape: "statusMap"; statuses: Record<string, ClientManifestJsonSchema> };

/**
 * One `throws` entry: a payload schema, a descriptor (`message`, `data`,
 * `issues`), or a map of business codes to either.
 */
export type ClientManifestThrowEntry =
  | { kind: "schema"; jsonSchema: ClientManifestJsonSchema }
  | {
      kind: "descriptor";
      message?: string;
      data?: ClientManifestJsonSchema;
      issues?: ClientManifestJsonSchema;
    }
  | { kind: "codeMap"; codes: Record<string, ClientManifestThrowEntry> };

/** A `.file()` upload, with its defaults filled in. */
export type ClientManifestFile = {
  fieldName: string;
  maxSize?: number;
  minSize?: number;
  allowedTypes?: AllowedFileType[];
  required: boolean;
};

/** A `.files()` upload, with its default field name filled in. */
export type ClientManifestFiles = {
  fieldName: string;
  maxSize?: number;
  minSize?: number;
  totalMaxSize?: number;
  allowedTypes?: AllowedFileType[];
  minCount?: number;
  maxCount?: number;
};

/**
 * One method's contract: the request parts, the success response, the
 * declared throws (keyed by status) and the uploads. Parts the route didn't
 * declare are absent.
 */
export type ClientManifestSchema = {
  body?: ClientManifestJsonSchema;
  query?: ClientManifestJsonSchema;
  headers?: ClientManifestJsonSchema;
  response?: ClientManifestResponse;
  throws?: Record<string, ClientManifestThrowEntry>;
  file?: ClientManifestFile;
  files?: ClientManifestFiles;
};

/** Per-HTTP-method entry under {@link ClientManifestRoute.methods}. */
export type ClientManifestMethod = {
  descriptor?: string;
  effectiveConfig: Record<string, unknown>;
  beforeValidationHooksCount: number;
  schema?: ClientManifestSchema;
};

/**
 * One URL path in the client manifest: source file, route-level config, path params,
 * and a {@link ClientManifestRoute.methods} map (method-specific schema, hooks, merged config).
 */
export type ClientManifestRoute = {
  path: string;
  routeFile: string;
  routeLevelConfig: Record<string, unknown>;
  params?: ClientManifestJsonSchema;
  methods: Partial<Record<RouteMethod, ClientManifestMethod>>;
};

/** Mutable map keyed by URL path while routes are registered. */
export type ClientManifestRoutesByPath = Map<string, ClientManifestRoute>;

export type ClientManifestFramework = {
  name: string;
  version: string;
};

export type ClientManifestMeta = {
  /** When this manifest payload was built (ISO-8601). */
  generatedAt: string;
  /**
   * When the HTTP server reported `listening` (ISO-8601).
   * Omitted if the manifest is requested before the server has listened.
   */
  listeningSince?: string;
  framework: ClientManifestFramework;
};

export type ClientManifest = {
  version: 4;
  meta: ClientManifestMeta;
  defaultRouteConfig: Record<string, unknown>;
  /**
   * The declared models' bodies by name, in declaration order (`{}` when there
   * are none). `/@client` keeps those its routes reach; see
   * {@link referencedModels}.
   */
  models: Record<string, ClientManifestJsonSchema>;
  routes: ClientManifestRoute[];
};

let cachedFramework: ClientManifestFramework | undefined;

export function getServerFrameworkMetadata(): ClientManifestFramework {
  if (cachedFramework) {
    return cachedFramework;
  }

  const packageJsonPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json",
  );
  const raw = readFileSync(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw) as { name?: string; version?: string };
  cachedFramework = {
    name: pkg.name ?? "pumice.js",
    version: pkg.version ?? "0.0.0",
  };
  return cachedFramework;
}

export function appendClientManifestRoute(
  routesByPath: ClientManifestRoutesByPath,
  options: {
    rootDirPath: string;
    routeFilePath: string;
    urlPath: string;
    defaultRouteConfig: RouteConfig<object>;
    definition: RouteManifestSource;
    models: ModelRegistry;
  },
): void {
  const {
    rootDirPath,
    routeFilePath,
    urlPath,
    defaultRouteConfig,
    definition,
    models,
  } = options;

  const routeLevelConfig = (definition.config ?? {}) as Record<string, unknown>;
  const effectiveConfig = mergeRouteConfig(
    defaultRouteConfig,
    definition.config,
  ) as Record<string, unknown>;
  if (definition.method !== "get") {
    // The limit that actually applies, including the 1 MiB default and the
    // raise for declared uploads, so clients and docs can state it.
    effectiveConfig.bodyLimit = resolveBodyLimit(
      effectiveConfig,
      definition.schema,
    );
  }

  const methodEntry: ClientManifestMethod = {
    descriptor: definition.description,
    effectiveConfig: JSON.parse(JSON.stringify(effectiveConfig)) as Record<
      string,
      unknown
    >,
    beforeValidationHooksCount: definition.beforeValidationHooks?.length ?? 0,
    schema: serializeRouteSchema(definition.schema, models),
  };

  const relativeRouteFile = relative(rootDirPath, routeFilePath).replaceAll(
    "\\",
    "/",
  );

  let routeEntry = routesByPath.get(urlPath);
  if (!routeEntry) {
    routeEntry = {
      path: urlPath,
      routeFile: relativeRouteFile,
      routeLevelConfig: JSON.parse(JSON.stringify(routeLevelConfig)) as Record<
        string,
        unknown
      >,
      params: serializeRouteParams(definition.params, models),
      methods: {},
    };
    routesByPath.set(urlPath, routeEntry);
  } else if (routeEntry.params === undefined) {
    routeEntry.params = serializeRouteParams(definition.params, models);
  }

  routeEntry.methods[definition.method] = methodEntry;
}

export type FinalizeClientManifestOptions = {
  listeningSince?: string;
};

function buildManifestMeta(
  options: FinalizeClientManifestOptions,
): ClientManifestMeta {
  return {
    generatedAt: new Date().toISOString(),
    listeningSince: options.listeningSince,
    framework: getServerFrameworkMetadata(),
  };
}

export function finalizeClientManifest(
  defaultRouteConfig: RouteConfig<object>,
  routesByPath: ReadonlyMap<string, ClientManifestRoute>,
  models: Record<string, ClientManifestJsonSchema>,
  options: FinalizeClientManifestOptions = {},
): ClientManifest {
  const routes = [...routesByPath.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((route) => ({
      path: route.path,
      routeFile: route.routeFile,
      routeLevelConfig: JSON.parse(
        JSON.stringify(route.routeLevelConfig),
      ) as Record<string, unknown>,
      params: route.params,
      methods: orderManifestMethods(
        JSON.parse(JSON.stringify(route.methods)) as Partial<
          Record<RouteMethod, ClientManifestMethod>
        >,
      ),
    }));

  return {
    version: 4,
    meta: buildManifestMeta(options),
    defaultRouteConfig: JSON.parse(
      JSON.stringify(defaultRouteConfig ?? {}),
    ) as Record<string, unknown>,
    models: JSON.parse(JSON.stringify(models)) as Record<
      string,
      ClientManifestJsonSchema
    >,
    routes,
  };
}

/**
 * The models that `schemas` (route schemas, params) point at, directly or
 * through other models, in declaration order. Each manifest lists only these.
 */
export function referencedModels(
  models: Readonly<Record<string, ClientManifestJsonSchema>>,
  schemas: readonly unknown[],
): Record<string, ClientManifestJsonSchema> {
  const reached = reachableRefs(schemas, MODEL_REF_PREFIX, models);
  return Object.fromEntries(
    Object.entries(models).filter(([name]) => reached.has(name)),
  );
}
