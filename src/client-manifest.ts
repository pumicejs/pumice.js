import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { toJSONSchema } from "zod";
import type { z } from "zod";
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

function zodToSerializableJsonSchema(schema: z.ZodTypeAny): unknown {
  const payload = toJSONSchema(schema, { unrepresentable: "any" });
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
    return { shape: "single", jsonSchema: zodToSerializableJsonSchema(response) };
  }

  const statuses: Record<string, unknown> = {};
  for (const [status, schema] of Object.entries(response)) {
    if (isZodSchema(schema)) {
      statuses[status] = zodToSerializableJsonSchema(schema);
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

  return Object.keys(result).length > 0 ? result : undefined;
}

function serializeRouteParams(paramsSchema: RouteParamsSchema | undefined): unknown {
  if (!paramsSchema || !isZodSchema(paramsSchema)) {
    return undefined;
  }

  return zodToSerializableJsonSchema(paramsSchema);
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

export type ClientManifestRoute = {
  path: string;
  method: RouteMethod;
  routeFile: string;
  descriptor?: string;
  params?: unknown;
  routeLevelConfig: Record<string, unknown>;
  effectiveConfig: Record<string, unknown>;
  beforeValidationHooksCount: number;
  schema?: unknown;
};

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
  version: 1;
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
  manifestRoutes: ClientManifestRoute[],
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

  manifestRoutes.push({
    path: urlPath,
    method: definition.method,
    routeFile: relative(rootDirPath, routeFilePath).replaceAll("\\", "/"),
    descriptor: definition.description,
    params: serializeRouteParams(definition.params),
    routeLevelConfig: JSON.parse(JSON.stringify(routeLevelConfig)) as Record<
      string,
      unknown
    >,
    effectiveConfig: JSON.parse(JSON.stringify(effectiveConfig)) as Record<
      string,
      unknown
    >,
    beforeValidationHooksCount: definition.beforeValidationHooks?.length ?? 0,
    schema: serializeRouteSchema(definition.schema) as unknown,
  });
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
  routes: readonly ClientManifestRoute[],
  options: FinalizeClientManifestOptions = {},
): ClientManifest {
  return {
    version: 1,
    meta: buildManifestMeta(options),
    defaultRouteConfig: JSON.parse(
      JSON.stringify(defaultRouteConfig ?? {}),
    ) as Record<string, unknown>,
    routes: [...routes],
  };
}
