import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z, toJSONSchema } from "zod";
import { mergeRouteConfig } from "./config/routes.js";
import type { RouteConfig } from "./types/config.js";
import type { RouteBeforeValidationHook, RouteMethod } from "./types/route.js";
import type {
  RouteParamsSchema,
  RouteSchema,
  RouteThrowDescriptor,
  RouteThrowsCodeSchemaMap,
  RouteThrowsSchema,
  RouteResponseSchema,
} from "./types/schema.js";

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return typeof value === "object" && value !== null && "safeParse" in value;
}

function isThrowDescriptor(value: unknown): value is RouteThrowDescriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    !isZodSchema(value) &&
    ("data" in value || "issues" in value || "message" in value)
  );
}

function isThrowsCodeSchemaMap(
  throwsSchema: unknown,
): throwsSchema is RouteThrowsCodeSchemaMap {
  return (
    typeof throwsSchema === "object" &&
    throwsSchema !== null &&
    !isZodSchema(throwsSchema) &&
    !isThrowDescriptor(throwsSchema)
  );
}

/**
 * Zod `date` / `coerce.date()` cannot be expressed in JSON Schema; with
 * `unrepresentable: "any"` they become `{}`. We substitute the same JSON Schema
 * Zod emits for {@link z.iso.datetime} so clients can align with that contract.
 */
function isZodDateSchema(schema: unknown): boolean {
  const def = (schema as { _zod?: { def?: { type?: string } } })._zod?.def;
  return def?.type === "date";
}

function isZodVoidSchema(schema: unknown): boolean {
  const def = (schema as { _zod?: { def?: { type?: string } } })._zod?.def;
  return def?.type === "void";
}

let isoDatetimeJsonSchemaFragment: Record<string, unknown> | undefined;

function getIsoDatetimeJsonSchemaFragment(): Record<string, unknown> {
  if (!isoDatetimeJsonSchemaFragment) {
    const full = toJSONSchema(z.iso.datetime(), {
      unrepresentable: "any",
    }) as Record<string, unknown>;
    const { $schema: _drop, ...fragment } = full;
    isoDatetimeJsonSchemaFragment = fragment;
  }
  return isoDatetimeJsonSchemaFragment;
}

function zodToSerializableJsonSchema(schema: z.ZodTypeAny): unknown {
  if (isZodVoidSchema(schema)) {
    return { type: "void" };
  }

  const payload = toJSONSchema(schema, {
    unrepresentable: "any",
    override({ zodSchema, jsonSchema }) {
      if (isZodDateSchema(zodSchema)) {
        const json = jsonSchema as Record<string, unknown>;
        for (const key of Object.keys(json)) {
          delete json[key];
        }
        Object.assign(json, getIsoDatetimeJsonSchemaFragment());
      }
    },
  });
  return JSON.parse(
    JSON.stringify(payload, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}

function serializeThrowStatusEntry(entry: unknown): unknown {
  if (isZodSchema(entry)) {
    return { kind: "schema", jsonSchema: zodToSerializableJsonSchema(entry) };
  }

  if (isThrowDescriptor(entry)) {
    return {
      kind: "descriptor",
      message: entry.message,
      data:
        entry.data !== undefined
          ? zodToSerializableJsonSchema(entry.data)
          : undefined,
      issues:
        entry.issues !== undefined
          ? zodToSerializableJsonSchema(entry.issues)
          : undefined,
    };
  }

  if (isThrowsCodeSchemaMap(entry)) {
    const codes: Record<string, unknown> = {};
    for (const [code, nested] of Object.entries(entry)) {
      codes[code] = serializeThrowStatusEntry(nested);
    }
    return { kind: "codeMap", codes };
  }

  return undefined;
}

function serializeThrows(throws: RouteThrowsSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [status, entry] of Object.entries(throws)) {
    const serialized = serializeThrowStatusEntry(entry);
    if (serialized !== undefined) {
      out[status] = serialized;
    }
  }
  return out;
}

function serializeResponse(response: RouteResponseSchema): unknown {
  if (isZodSchema(response)) {
    if (isZodVoidSchema(response)) {
      return { shape: "single", type: "void" };
    }
    return { shape: "single", jsonSchema: zodToSerializableJsonSchema(response) };
  }

  const statuses: Record<string, unknown> = {};
  for (const [status, schema] of Object.entries(response)) {
    if (isZodSchema(schema)) {
      statuses[status] = isZodVoidSchema(schema)
        ? { type: "void" }
        : zodToSerializableJsonSchema(schema);
    }
  }
  return { shape: "statusMap", statuses };
}

function serializeRouteSchema(schema: RouteSchema | undefined): unknown {
  if (!schema || Object.keys(schema).length === 0) {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  if (schema.body !== undefined && isZodSchema(schema.body)) {
    result.body = zodToSerializableJsonSchema(schema.body);
  }
  if (schema.query !== undefined && isZodSchema(schema.query)) {
    result.query = zodToSerializableJsonSchema(schema.query);
  }
  if (schema.headers !== undefined && isZodSchema(schema.headers)) {
    result.headers = zodToSerializableJsonSchema(schema.headers);
  }
  if (schema.response !== undefined) {
    result.response = serializeResponse(schema.response);
  }
  if (schema.throws !== undefined) {
    result.throws = serializeThrows(schema.throws);
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

function serializeRouteParams(paramsSchema: RouteParamsSchema | undefined): unknown {
  if (!paramsSchema || !isZodSchema(paramsSchema)) {
    return undefined;
  }

  return zodToSerializableJsonSchema(paramsSchema);
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

/** Per-HTTP-method entry under {@link ClientManifestRoute.methods}. */
export type ClientManifestMethod = {
  descriptor?: string;
  effectiveConfig: Record<string, unknown>;
  beforeValidationHooksCount: number;
  schema?: unknown;
};

/**
 * One URL path in the client manifest: source file, route-level config, path params,
 * and a {@link ClientManifestRoute.methods} map (method-specific schema, hooks, merged config).
 */
export type ClientManifestRoute = {
  path: string;
  routeFile: string;
  routeLevelConfig: Record<string, unknown>;
  params?: unknown;
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
  version: 3;
  meta: ClientManifestMeta;
  defaultRouteConfig: Record<string, unknown>;
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
  },
): void {
  const {
    rootDirPath,
    routeFilePath,
    urlPath,
    defaultRouteConfig,
    definition,
  } = options;

  const routeLevelConfig = (definition.config ?? {}) as Record<string, unknown>;
  const effectiveConfig = mergeRouteConfig(
    defaultRouteConfig,
    definition.config,
  ) as Record<string, unknown>;

  const methodEntry: ClientManifestMethod = {
    descriptor: definition.description,
    effectiveConfig: JSON.parse(JSON.stringify(effectiveConfig)) as Record<
      string,
      unknown
    >,
    beforeValidationHooksCount: definition.beforeValidationHooks?.length ?? 0,
    schema: serializeRouteSchema(definition.schema) as unknown,
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
      params: serializeRouteParams(definition.params),
      methods: {},
    };
    routesByPath.set(urlPath, routeEntry);
  } else if (routeEntry.params === undefined) {
    routeEntry.params = serializeRouteParams(definition.params);
  }

  routeEntry.methods[definition.method] = methodEntry;
}

export type FinalizeClientManifestOptions = {
  listeningSince?: string;
};

function buildManifestMeta(options: FinalizeClientManifestOptions): ClientManifestMeta {
  return {
    generatedAt: new Date().toISOString(),
    listeningSince: options.listeningSince,
    framework: getServerFrameworkMetadata(),
  };
}

export function finalizeClientManifest(
  defaultRouteConfig: RouteConfig<object>,
  routesByPath: ReadonlyMap<string, ClientManifestRoute>,
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
    version: 3,
    meta: buildManifestMeta(options),
    defaultRouteConfig: JSON.parse(
      JSON.stringify(defaultRouteConfig ?? {}),
    ) as Record<string, unknown>,
    routes,
  };
}
