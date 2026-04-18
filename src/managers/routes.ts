import { readdir } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { mergeRouteConfig } from "../config/routes.js";
import { filePathToUrlPath } from "../parser.js";
import type { RouteDefinition } from "../types/route.js";
import type { RouteConfig } from "../types/config.js";
import type { RouteParamsSchema, RouteSchema } from "../types/schema.js";
import type {
  AnyAppliedRouteProcedure,
  AnyRouteProcedureDefinition,
} from "../types/procedure.js";
import type {
  AnyMiddlewareDefinition,
  MiddlewareDefinition,
} from "../types/middleware.js";
import {
  buildApiErrorResponse,
  createApiError,
  createExplicitRouteResponse,
  normalizeHandlerSuccessResult,
  normalizeHandlerThrownError,
  validateRouteRequest,
  validateRouteThrownError,
} from "../schema/runtime.js";
import { getStatusMessage } from "../errors/api.js";
import { resolveDefaultThrowMessage } from "./throw-message.js";
import {
  appendClientManifestRoute,
  finalizeClientManifest,
  type ClientManifest,
  type ClientManifestRoutesByPath,
  type FinalizeClientManifestOptions,
} from "../client-manifest.js";

type SupportedExtension = ".js" | ".mjs" | ".cjs" | ".ts" | ".mts" | ".cts";
type ContextErrorInit = {
  code?: string;
  data?: unknown;
  message?: string;
  issues?: unknown[];
  headers?: Record<string, string>;
};

const SUPPORTED_EXTENSIONS: ReadonlySet<SupportedExtension> = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
]);

type ZodObjectLike = z.ZodObject<Record<string, z.ZodTypeAny>>;

function isZodObjectSchema(schema: unknown): schema is ZodObjectLike {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "shape" in schema &&
    typeof (schema as { shape: unknown }).shape === "object"
  );
}

/**
 * Produces a single params schema by layering each source's `shape` on top of
 * the previous one. Later entries override keys from earlier ones.
 *
 * All inputs must be `z.object(...)` schemas — throws otherwise.
 */
function mergeOrderedParamsSchemas(
  schemas: ReadonlyArray<RouteParamsSchema | undefined>,
): RouteParamsSchema | undefined {
  const defined = schemas.filter(
    (schema): schema is RouteParamsSchema => schema !== undefined,
  );

  if (defined.length === 0) {
    return undefined;
  }

  if (defined.length === 1) {
    return defined[0];
  }

  const combinedShape: Record<string, z.ZodTypeAny> = {};
  for (const schema of defined) {
    if (!isZodObjectSchema(schema)) {
      throw new Error(
        "Route and procedure params schemas must be z.object(...) when mixed on a single route.",
      );
    }
    Object.assign(combinedShape, schema.shape);
  }

  return z.object(combinedShape);
}

function procedureAppliesToMethod(
  applied: AnyAppliedRouteProcedure,
  method: string,
): boolean {
  const methods = applied.applyOnMethods;
  if (!methods) {
    return true;
  }
  return methods.includes(method as never);
}

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

/**
 * True for file basenames that declare a middleware scope:
 * `middleware.{ts,js,...}` or any `*.mw.{ts,js,...}`.
 */
function isMiddlewareFile(filePath: string): boolean {
  const fileName =
    filePath.replaceAll("\\", "/").split("/").at(-1) ?? filePath;
  const extension = extname(fileName);

  if (!SUPPORTED_EXTENSIONS.has(extension as SupportedExtension)) {
    return false;
  }

  const baseName = fileName.slice(0, -extension.length);
  return baseName === "middleware" || baseName.endsWith(".mw");
}

/**
 * Normalizes a directory path for keying in the middleware map. Converts
 * backslashes to forward slashes and strips a trailing slash.
 */
function normalizeDirPath(dirPath: string): string {
  const normalized = dirPath.replaceAll("\\", "/");
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

/**
 * Walks upward from `routeFilePath`'s directory to `rootDirPath`, collecting
 * middlewares registered in any ancestor directory. Returns outermost-first
 * (rootDir) → innermost-last so the execution order naturally matches the
 * file tree.
 */
function collectAncestorMiddlewares(
  routeFilePath: string,
  rootDirPath: string,
  middlewaresByDir: ReadonlyMap<string, AnyMiddlewareDefinition[]>,
): AnyMiddlewareDefinition[] {
  const normalizedRoot = normalizeDirPath(rootDirPath);
  const collected: AnyMiddlewareDefinition[][] = [];

  let currentDir = normalizeDirPath(dirname(routeFilePath));
  while (true) {
    const directoryMiddlewares = middlewaresByDir.get(currentDir);
    if (directoryMiddlewares && directoryMiddlewares.length > 0) {
      collected.push(directoryMiddlewares);
    }
    if (currentDir === normalizedRoot) {
      break;
    }
    const parentDir = normalizeDirPath(dirname(currentDir));
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  // `collected` is innermost-first; reverse for outer-first execution.
  return collected.reverse().flat();
}

/**
 * Registers routes so static segments beat dynamic ones at the same depth.
 *
 * Without this, discovery of `/users/[id]/route.ts` and `/users/me/route.ts`
 * loads `[id]` first (ASCII `[` < `m`); Hono's router then matches `/users/:id`
 * before `/users/me` for a request to `/users/me`. Comparing segment-by-segment
 * and ordering dynamic `[x]` segments after any static peer fixes this.
 */
function compareRouteFilePaths(filePathA: string, filePathB: string): number {
  const segmentsA = filePathA.replaceAll("\\", "/").split("/").filter(Boolean);
  const segmentsB = filePathB.replaceAll("\\", "/").split("/").filter(Boolean);
  const sharedLength = Math.min(segmentsA.length, segmentsB.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const segmentA = segmentsA[index]!;
    const segmentB = segmentsB[index]!;

    if (segmentA === segmentB) {
      continue;
    }

    const dynamicA = isDynamicSegment(segmentA);
    const dynamicB = isDynamicSegment(segmentB);

    if (dynamicA !== dynamicB) {
      return dynamicA ? 1 : -1;
    }

    return segmentA.localeCompare(segmentB);
  }

  return segmentsA.length - segmentsB.length;
}

/**
 * Executes a single procedure's handler, injecting the use-site config, and
 * merges any returned contributions into the accumulated `c.procedures` bag.
 *
 * The procedure sees the same `context.params` object used by the route
 * handler (already validated against the merged params schema) plus its own
 * `context.config` set for this invocation.
 */
async function runProcedure(
  context: Context,
  procedure: AnyRouteProcedureDefinition,
  contributions: Record<string, unknown>,
): Promise<void> {
  const previousConfig = (context as unknown as { config?: unknown }).config;
  (context as unknown as { config: unknown }).config = procedure.config;

  try {
    const result = await procedure.handler(context as never);
    if (result && typeof result === "object") {
      Object.assign(contributions, result);
    }
  } finally {
    if (previousConfig === undefined) {
      delete (context as unknown as { config?: unknown }).config;
    } else {
      (context as unknown as { config: unknown }).config = previousConfig;
    }
  }
}

export class RouteManager {
  public readonly cache = new Map<string, string>();
  public readonly routeDescriptions = new Map<string, string>();
  private readonly clientManifestRoutesByPath: ClientManifestRoutesByPath =
    new Map();
  private readonly basePathSegments: string[];
  private currentRouteFilePath: string | null = null;
  private currentMiddlewareFilePath: string | null = null;
  private defaultRouteConfig: RouteConfig<object> = {};
  /** Middlewares registered during file-system discovery, keyed by directory. */
  private readonly middlewaresByDir = new Map<
    string,
    AnyMiddlewareDefinition[]
  >();

  public constructor(
    private readonly app: Hono,
    private readonly rootDirPath: string,
    private readonly basePath: string = "routes",
    options: { defaultRouteConfig?: RouteConfig<object> } = {},
  ) {
    this.defaultRouteConfig = options.defaultRouteConfig ?? {};
    this.basePathSegments = this.basePath
      .replaceAll("\\", "/")
      .split("/")
      .filter((segment) => segment.length > 0);
  }

  public setDefaultRouteConfig(config: RouteConfig<object> | undefined): void {
    this.defaultRouteConfig = config ?? {};
  }

  public async registerDiscovered(): Promise<string[]> {
    const files = await this.walkFiles(this.rootDirPath);
    const discoverableFiles = files.filter((filePath) =>
      this.isRouteFile(filePath),
    );
    const middlewareFiles = discoverableFiles
      .filter(isMiddlewareFile)
      .sort(compareRouteFilePaths);
    const routeFiles = discoverableFiles
      .filter((filePath) => !isMiddlewareFile(filePath))
      .sort(compareRouteFilePaths);

    this.cache.clear();
    this.clientManifestRoutesByPath.clear();
    this.middlewaresByDir.clear();

    // Middlewares are loaded first so ancestor lookups succeed when route
    // files import and register themselves synchronously below.
    for (const middlewareFilePath of middlewareFiles) {
      this.currentMiddlewareFilePath = middlewareFilePath;
      await import(pathToFileURL(middlewareFilePath).href);
    }
    this.currentMiddlewareFilePath = null;

    for (const routeFilePath of routeFiles) {
      this.currentRouteFilePath = routeFilePath;
      await import(pathToFileURL(routeFilePath).href);
    }

    this.currentRouteFilePath = null;

    return [...this.cache.values()];
  }

  /**
   * Called by the middleware builder during middleware-file discovery.
   * Binds the definition to the directory of the current middleware file.
   */
  public addMiddlewareFromCurrentFile(
    definition: MiddlewareDefinition,
  ): void {
    if (!this.currentMiddlewareFilePath) {
      throw new Error(
        "server.middleware() can only be called while middleware files are being loaded.",
      );
    }

    const directoryKey = normalizeDirPath(
      dirname(this.currentMiddlewareFilePath),
    );
    const existing = this.middlewaresByDir.get(directoryKey);
    const enriched: AnyMiddlewareDefinition = {
      ...definition,
      sourceFilePath: this.currentMiddlewareFilePath,
    };

    if (existing) {
      existing.push(enriched);
    } else {
      this.middlewaresByDir.set(directoryKey, [enriched]);
    }

    console.log(
      `Registered middleware from ${relative(this.rootDirPath, this.currentMiddlewareFilePath)}${
        definition.description ? ` (${definition.description})` : ""
      }`,
    );
  }

  public add<
    TSchema extends RouteSchema,
    TParamsSchema extends RouteParamsSchema | undefined = undefined,
    TContextExtensions extends object = {},
    TRouteConfigExtensions extends object = {},
  >(
    filePath: string,
    definition: RouteDefinition<
      TSchema,
      TParamsSchema,
      TContextExtensions,
      TRouteConfigExtensions
    >,
  ): string {
    const routePath =
      this.cache.get(filePath) ??
      filePathToUrlPath(relative(this.rootDirPath, filePath), {
        basePath: this.basePath,
      });

    const ancestorMiddlewares = collectAncestorMiddlewares(
      filePath,
      this.rootDirPath,
      this.middlewaresByDir,
    );
    const wrappedHandler = this.createValidatedHandler(
      definition,
      ancestorMiddlewares,
    );

    if (definition.method === "any") {
      this.app.all(routePath, wrappedHandler);
    } else {
      this.app.on(definition.method.toUpperCase(), routePath, wrappedHandler);
    }

    if (definition.description) {
      const routeKey = `${definition.method.toUpperCase()} ${routePath}`;
      this.routeDescriptions.set(routeKey, definition.description);
    }

    if (!this.cache.has(filePath)) {
      this.cache.set(filePath, routePath);
    }

    appendClientManifestRoute(this.clientManifestRoutesByPath, {
      rootDirPath: this.rootDirPath,
      routeFilePath: filePath,
      urlPath: routePath,
      defaultRouteConfig: this.defaultRouteConfig,
      definition,
    });

    console.log(`Registered ${definition.method.toUpperCase()} ${routePath}`);

    return routePath;
  }

  /**
   * JSON-serializable manifest of every registered route, grouped by path:
   * path-level params and a per-HTTP-method map (merged config, descriptors,
   * Zod contracts as JSON Schema for client codegen).
   */
  public getClientManifest(
    options?: FinalizeClientManifestOptions,
  ): ClientManifest {
    return finalizeClientManifest(
      this.defaultRouteConfig,
      this.clientManifestRoutesByPath,
      options,
    );
  }

  private createValidatedHandler<
    TSchema extends RouteSchema,
    TParamsSchema extends RouteParamsSchema | undefined = undefined,
    TContextExtensions extends object = {},
    TRouteConfigExtensions extends object = {},
  >(
    definition: RouteDefinition<
      TSchema,
      TParamsSchema,
      TContextExtensions,
      TRouteConfigExtensions
    >,
    middlewares: readonly AnyMiddlewareDefinition[] = [],
  ) {
    const appliedProcedures = definition.procedures ?? [];
    const activeProcedures = appliedProcedures.filter((applied) =>
      procedureAppliesToMethod(applied, definition.method),
    );
    const mergedParamsSchema = mergeOrderedParamsSchemas([
      // Procedure params come first; route params LAST so route keys win.
      ...appliedProcedures.map((applied) => applied.procedure.paramsSchema),
      definition.params,
    ]);

    const sortedHooks = [...(definition.beforeValidationHooks ?? [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );

    const runPostHookPipeline = async (
      context: Context,
    ): Promise<Response> => {
      const requestValidation = await validateRouteRequest(
        context,
        definition.schema,
        mergedParamsSchema,
      );

      if (!requestValidation.ok) {
        return requestValidation.response;
      }

      (context as unknown as { body: unknown }).body = requestValidation.data.body;
      (context as unknown as { query: unknown }).query =
        requestValidation.data.query;
      (context as unknown as { headers: unknown }).headers =
        requestValidation.data.headers;
      (context as unknown as { params: unknown }).params =
        requestValidation.data.params;
      if (definition.schema?.file) {
        (context as unknown as { file: unknown }).file =
          requestValidation.data.file;
      }
      if (definition.schema?.files) {
        (context as unknown as { files: unknown }).files =
          requestValidation.data.files ?? [];
      }

      const originalJson = context.json.bind(context);

      (context as unknown as { json: typeof context.json }).json = ((
        payload: unknown,
        status?: number,
      ) => {
        const responseStatus = typeof status === "number" ? status : 200;

        if (responseStatus >= 200 && responseStatus <= 299) {
          return originalJson(
            {
              code: "SUCCESS",
              message: getStatusMessage(responseStatus),
              data: payload,
            } as never,
            responseStatus as never,
          );
        }

        return originalJson(payload as never, status as never);
      }) as typeof context.json;

      (context as unknown as { returns: unknown }).returns = ((payload: unknown) =>
        payload) as unknown;

      (context as unknown as { response: unknown }).response = ((
        response: {
          status: number;
          data: unknown;
          code?: string;
          message?: string;
          issues?: unknown[];
          headers?: Record<string, string>;
        },
      ) =>
        createExplicitRouteResponse({
          ...response,
          issues: response.issues as never,
        })) as unknown;

      (context as unknown as { error: unknown }).error = ((
        error: { status: number } & ContextErrorInit,
      ) => {
        const message =
          error.message ??
          resolveDefaultThrowMessage(
            definition.schema,
            error.status,
            error.code,
          );

        return createApiError({
          ...error,
          message,
        } as never);
      }) as unknown;

      const procedureContributions: Record<string, unknown> = {};
      (context as unknown as { procedures: Record<string, unknown> }).procedures =
        procedureContributions;

      try {
        for (const applied of activeProcedures) {
          await runProcedure(context, applied.procedure, procedureContributions);
        }
      } catch (error) {
        const normalizedError = normalizeHandlerThrownError(error);
        const isInternalRuntimeError = normalizedError.status >= 500;

        if (isInternalRuntimeError) {
          const method = definition.method.toUpperCase();
          const requestPath = context.req.path;
          const originalError =
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error;

          console.error(
            `[ProcedureError] ${method} ${requestPath} -> ${normalizedError.status} ${normalizedError.code ?? "INTERNAL_ERROR"}`,
            originalError,
          );
          return buildApiErrorResponse({
            status: 500,
            code: "INTERNAL_ERROR",
            message: "An error occurred in a route procedure.",
          });
        }

        const throwValidation = await validateRouteThrownError(
          definition.schema,
          normalizedError,
        );

        if (!throwValidation.ok) {
          return throwValidation.response;
        }

        return buildApiErrorResponse(normalizedError);
      }

      let handlerResult: unknown;
      try {
        handlerResult = await definition.handle(context as never);
      } catch (error) {
        const normalizedError = normalizeHandlerThrownError(error);
        const isInternalRuntimeError = normalizedError.status >= 500;

        if (isInternalRuntimeError) {
          const method = definition.method.toUpperCase();
          const requestPath = context.req.path;
          const originalError =
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error;

          console.error(
            `[RouteError] ${method} ${requestPath} -> ${normalizedError.status} ${normalizedError.code ?? "INTERNAL_ERROR"}`,
            originalError,
          );
          return buildApiErrorResponse({
            status: 500,
            code: "INTERNAL_ERROR",
            message: "An error occurred in the handler.",
          });
        }

        const throwValidation = await validateRouteThrownError(
          definition.schema,
          normalizedError,
        );

        if (!throwValidation.ok) {
          return throwValidation.response;
        }

        return buildApiErrorResponse(normalizedError);
      }

      if (handlerResult instanceof Response) {
        return handlerResult;
      }

      const normalizedResult = normalizeHandlerSuccessResult(handlerResult);
      return originalJson(
        normalizedResult.responseBody as never,
        normalizedResult.status as never,
        normalizedResult.headers as never,
      );
    };

    const method = definition.method.toUpperCase();

    /**
     * Outer handler: runs sorted `beforeValidationHooks` (plugin-contributed
     * auth hook, route-level hooks, etc.) so plugin extensions like `c.auth`
     * are set before any middleware runs. Then middlewares wrap
     * `runPostHookPipeline` (validation → procedures → handler) with
     * Hono-style `(c, next)` semantics.
     *
     * This ordering matches the static type: `MiddlewareHandlerContext` claims
     * plugin refinements apply, which is only truthful once hooks have run.
     */
    return async (context: Context): Promise<Response> => {
      const effectiveRouteConfig = mergeRouteConfig(
        this.defaultRouteConfig as RouteConfig<TRouteConfigExtensions>,
        definition.config as RouteConfig<TRouteConfigExtensions> | undefined,
      );

      for (const hook of sortedHooks) {
        const hookResult = await hook.run(context, effectiveRouteConfig);
        if (hookResult instanceof Response) {
          return hookResult;
        }
      }

      if (middlewares.length === 0) {
        return runPostHookPipeline(context);
      }

      let index = 0;

      const next = async (): Promise<Response> => {
        if (index >= middlewares.length) {
          return runPostHookPipeline(context);
        }
        const current = middlewares[index];
        index += 1;

        try {
          const result = await current.handle(context as never, next);
          if (result instanceof Response) {
            return result;
          }
          // Middleware returned void without calling `next()` — defensively
          // continue the chain so the route still runs. This matches how most
          // middleware systems treat a missing `next()` as a bug rather than a
          // silent drop.
          if (index <= middlewares.length) {
            return next();
          }
          return runPostHookPipeline(context);
        } catch (error) {
          const normalizedError = normalizeHandlerThrownError(error);
          const isInternalRuntimeError = normalizedError.status >= 500;

          if (isInternalRuntimeError) {
            const requestPath = context.req.path;
            const originalError =
              error instanceof Error
                ? {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                  }
                : error;

            console.error(
              `[MiddlewareError] ${method} ${requestPath} -> ${normalizedError.status} ${normalizedError.code ?? "INTERNAL_ERROR"}`,
              originalError,
            );
            return buildApiErrorResponse({
              status: 500,
              code: "INTERNAL_ERROR",
              message: "An error occurred in a middleware.",
            });
          }

          const throwValidation = await validateRouteThrownError(
            definition.schema,
            normalizedError,
          );

          if (!throwValidation.ok) {
            return throwValidation.response;
          }

          return buildApiErrorResponse(normalizedError);
        }
      };

      return next();
    };
  }

  public addFromCurrentFile<
    TSchema extends RouteSchema,
    TParamsSchema extends RouteParamsSchema | undefined = undefined,
    TContextExtensions extends object = {},
    TRouteConfigExtensions extends object = {},
  >(
    definition: RouteDefinition<
      TSchema,
      TParamsSchema,
      TContextExtensions,
      TRouteConfigExtensions
    >,
  ): string {
    if (!this.currentRouteFilePath) {
      throw new Error(
        "server.route() can only be called while route files are being loaded.",
      );
    }

    return this.add(this.currentRouteFilePath, definition);
  }

  private isRouteFile(filePath: string): boolean {
    const normalizedFilePath = filePath.replaceAll("\\", "/");
    const fileName = normalizedFilePath.split("/").at(-1);
    const extension = fileName ? extname(fileName) : "";
    const isSupportedSourceFile = SUPPORTED_EXTENSIONS.has(
      extension as SupportedExtension,
    );

    if (!isSupportedSourceFile) {
      return false;
    }

    const pathSegments = normalizedFilePath
      .split("/")
      .filter((segment) => segment.length > 0);

    if (this.basePathSegments.length === 0) {
      return true;
    }

    for (
      let index = 0;
      index <= pathSegments.length - this.basePathSegments.length;
      index += 1
    ) {
      const isMatch = this.basePathSegments.every(
        (basePathSegment, offset) =>
          pathSegments[index + offset] === basePathSegment,
      );

      if (isMatch) {
        return true;
      }
    }

    return false;
  }

  private async walkFiles(dirPath: string): Promise<string[]> {
    const dirEntries = await readdir(dirPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of dirEntries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await this.walkFiles(fullPath)));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = extname(entry.name) as SupportedExtension;

      if (SUPPORTED_EXTENSIONS.has(extension)) {
        files.push(fullPath);
      }
    }

    return files;
  }
}
