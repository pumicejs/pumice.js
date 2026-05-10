import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { RouteManager } from "../managers/routes.js";
import {
  createRouteBuilder,
  type RouteBuilderMethodSelectionStage,
} from "../builders/route.js";
import {
  createProcedureBuilder,
  type ProcedureBuilderStage,
} from "../builders/procedure.js";
import {
  createMiddlewareBuilder,
  type MiddlewareBuilderStage,
} from "../builders/middleware.js";
import type { MiddlewareDefinition } from "../types/middleware.js";
import { mergeRouteConfig } from "../config/routes.js";
import type { RouteConfig } from "../types/config.js";
import { getStatusMessage } from "../errors/api.js";
import type {
  ServerConstructOptions,
  ServerConfig,
  ServerListenOptions,
} from "../types/server.js";
import type { ContextRefinementRule, ServerPlugin } from "../types/plugin.js";
import { assertUniquePluginRegistration } from "../plugin-registration.js";
import type { Simplify } from "../types/schema.js";
import type { ClientManifest } from "../client-manifest.js";
import { createApiJsonErrorResponse } from "../http/json-envelope.js";

type IsPlainObject<TValue> = TValue extends object
  ? TValue extends (...args: never[]) => unknown
    ? false
    : TValue extends readonly unknown[]
      ? false
      : true
  : false;

type DeepMergeObjects<TBaseObject, TOverrideObject> = Simplify<
  Omit<TBaseObject, keyof TOverrideObject> & {
    [TKey in keyof TOverrideObject]: TKey extends keyof TBaseObject
      ? IsPlainObject<TBaseObject[TKey]> extends true
        ? IsPlainObject<TOverrideObject[TKey]> extends true
          ? DeepMergeObjects<TBaseObject[TKey], TOverrideObject[TKey]>
          : TOverrideObject[TKey]
        : TOverrideObject[TKey]
      : TOverrideObject[TKey];
  }
>;

/**
 * Top-level pumice.js HTTP server.
 *
 * Owns the underlying Hono app, the file-system route discovery pipeline,
 * and the plugin registry. Construct directly with `new Server(options)`
 * for ad-hoc setups, or use {@link ServerBuilder} for a fluent setup that
 * collects plugins/config before instantiation.
 *
 * Lifecycle:
 * 1. Configure defaults via {@link Server.config} and register plugins via {@link Server.use}.
 * 2. Call {@link Server.listen} to apply plugins, walk the route tree under
 *    `<rootDir>/<basePath>`, import every `route.{ts,js,...}` / `*.mw.ts` file,
 *    and bind the HTTP listener.
 *
 * Inside route files, callers reach back to the same instance to declare
 * routes, procedures, and middlewares:
 * - {@link Server.route} — declarative route builder (`.get()`, `.post()`, etc.)
 * - {@link Server.procedure} — reusable per-request logic that contributes to `c.procedures`
 * - {@link Server.middleware} — directory-scoped pre-route handler (only callable from `middleware.ts` / `*.mw.ts`)
 *
 * @typeParam TContextExtensions Extra fields plugins inject onto the route/middleware/procedure context (e.g. `c.auth`, `c.ratelimiting`).
 * @typeParam TRouteConfigExtensions Extra keys plugins add to per-route config (e.g. `authentication`, `ratelimit`, `exposeClient`).
 * @typeParam TContextRefinementRules Conditional context refinements applied when a route's effective config matches a plugin's `when` predicate.
 * @typeParam TDefaultRouteConfig Server-wide default route config narrowed by {@link Server.config}; drives type-level refinements (e.g. making `c.auth.data` non-optional when `authentication.required: true` is the default).
 *
 * @example
 * ```ts
 * import { Server, AuthenticationPlugin, RatelimitPlugin } from "pumice.js";
 *
 * const server = new Server({ basePath: "routes" })
 *   .use(AuthenticationPlugin({ field: "auth", authenticator }))
 *   .use(RatelimitPlugin())
 *   .config({ routes: { authentication: { required: true } } });
 *
 * await server.listen({ port: 3000 });
 * ```
 */
export class Server<
  TContextExtensions extends object = {},
  TRouteConfigExtensions extends object = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultRouteConfig extends object = {},
> {
  private readonly app = new Hono();
  public readonly routes: RouteManager;
  private readonly plugins: ServerPlugin[] = [];
  private pluginsApplied = false;
  private configState: ServerConfig<TRouteConfigExtensions>;
  /** ISO-8601 from the Node `listening` callback after `serve()` binds. */
  private clientManifestListeningSince?: string;

  /**
   * Creates a new server.
   *
   * @param options.basePath Subdirectory under `rootDir` that contains routes/middlewares. Defaults to `"routes"`.
   * @param options.rootDir Absolute (or `cwd`-relative) source root. Defaults to `<cwd>/src`.
   * @param options.config Server-wide defaults — currently `{ routes }` for default per-route config.
   *
   * The route pipeline is wired immediately, but no files are loaded and no
   * port is bound until {@link Server.listen} is called.
   */
  public constructor(options: ServerConstructOptions<TRouteConfigExtensions> = {}) {
    const basePath = options.basePath ?? "routes";
    const rootDir = options.rootDir ?? resolve(process.cwd(), "src");
    this.configState = options.config ?? {};
    this.app.notFound(() =>
      createApiJsonErrorResponse(404, {
        code: "NOT_FOUND",
        message: getStatusMessage(404),
      }),
    );
    this.routes = new RouteManager(this.app, rootDir, basePath, {
      defaultRouteConfig: this.configState.routes,
    });
  }

  /**
   * Boots the HTTP server.
   *
   * Performs three steps in order:
   * 1. Applies every registered plugin (idempotent — repeat calls are no-ops).
   * 2. Walks `<rootDir>/<basePath>` and imports each route / middleware file.
   *    During import, calls to `server.middleware()` / `server.route()` register
   *    handlers against the file currently being loaded.
   * 3. Calls `serve()` to bind the configured port and resolves once listening.
   *
   * @param options.port HTTP port to bind. Defaults to `3000`.
   *
   * @example
   * `await server.listen({ port: 8080 });`
   */
  public async listen(options: ServerListenOptions = {}): Promise<void> {
    const port = options.port ?? 3000;

    await this.applyPlugins();

    const loadedRoutes = await this.routes.registerDiscovered();
    console.log("Routes loaded:", loadedRoutes);

    serve(
      {
        fetch: this.app.fetch,
        port,
      },
      () => {
        this.clientManifestListeningSince = new Date().toISOString();
      },
    );

    console.log(`Server listening at http://localhost:${port}`);
  }

  /**
   * Opens a fluent route-definition chain bound to the current source file.
   *
   * Must be called from inside a route file (e.g. `src/routes/users/[id]/route.ts`)
   * during route discovery — the URL path is derived from the file's location
   * relative to `<rootDir>/<basePath>`. Calling outside of discovery throws.
   *
   * Chain order (each step returns the next stage):
   *
   * ```text
   * server.route()
   *   ├── .params(zodObject)         // path params shared by every method declared here
   *   ├── .config(partialRouteConfig)// route-level defaults (auth, ratelimit, etc.)
   *   ├── .procedure(factory, opts?) // attach reusable per-request logic
   *   └── .<method>()                // any | get | post | put | patch | delete | options
   *         ├── .describe(string)    // human-readable summary surfaced in the manifest
   *         ├── .config(...)         // per-method config (deep-merged over route-level)
   *         ├── .schema({...})       // body / query / headers / response / throws / file(s)
   *         ├── .body(...) / .query(...) / .headers(...)
   *         ├── .response(...) / .throws(...)
   *         ├── .file(...) / .files(...) // multipart upload contracts (non-GET only)
   *         └── .handle((c) => ...)  // finalize and register
   * ```
   *
   * The handler context (`c`) is fully typed: `c.body`, `c.query`, `c.headers`,
   * `c.params`, `c.file` / `c.files`, `c.procedures`, plus `c.json` / `c.response` /
   * `c.error` / `c.returns` constrained by the declared schemas, plus any plugin
   * extensions (e.g. `c.auth`, `c.ratelimiting`).
   *
   * After `.handle(...)`, the same builder can declare additional methods on
   * the same path (e.g. add a `.post()` after a `.get()`).
   *
   * @example
   * ```ts
   * // src/routes/users/[id]/route.ts
   * server.route()
   *   .params(z.object({ id: z.coerce.number() }))
   *   .get()
   *     .describe("Get user")
   *     .schema({ response: { 200: UserSchema } })
   *     .handle(async (c) => ({ user: await users.find(c.params.id) }))
   *   .delete()
   *     .describe("Delete user")
   *     .config({ authentication: { required: true } })
   *     .handle(async (c) => { await users.remove(c.params.id); return c.response({ status: 204, data: undefined }); });
   * ```
   */
  public route(): RouteBuilderMethodSelectionStage<
    undefined,
    TContextExtensions,
    TRouteConfigExtensions,
    TContextRefinementRules,
    TDefaultRouteConfig
  > {
    return createRouteBuilder<
      TContextExtensions,
      TRouteConfigExtensions,
      TContextRefinementRules,
      TDefaultRouteConfig
    >((definition) => this.routes.addFromCurrentFile(definition));
  }

  /**
   * Starts the definition of a reusable per-request procedure.
   *
   * Procedures encapsulate work that's shared across multiple routes —
   * loading a resource by id, checking ownership, validating extra params,
   * gating on a feature flag — and surface their result on `c.procedures`
   * to every route that attaches them.
   *
   * Chain order:
   *
   * ```text
   * server.procedure()
   *   ├── .config<TConfig>()        // type-only: declares the config shape callers must pass
   *   ├── .params(zodObject)        // params merged with the route's params (route wins on collision)
   *   └── .handle(async (c) => ...) // returns a factory; call it with config to apply on a route
   * ```
   *
   * The returned factory is what you actually attach via
   * `route().procedure(myProc({ ...config }), { applyOnMethods?: [...] })`.
   * The handler's return value (an object) becomes a property on `c.procedures`
   * — typed precisely from the inferred return type.
   *
   * Procedures run after request validation and before the route handler, in
   * the order they were attached.
   *
   * @example
   * ```ts
   * // src/procedures/user.ts
   * export const userProcedure = server.procedure()
   *   .config<{ skipOwnershipCheck?: boolean }>()
   *   .params(z.object({ userId: z.coerce.number() }))
   *   .handle(async (c) => {
   *     const user = await repos.users.findUnique({ where: { id: c.params.userId } });
   *     if (!user) throw c.error({ status: 404 });
   *     if (!c.config.skipOwnershipCheck && user.id !== c.auth.data.user.id) {
   *       throw c.error({ status: 403 });
   *     }
   *     return { user };
   *   });
   *
   * // src/routes/users/[userId]/route.ts
   * server.route()
   *   .procedure(userProcedure())
   *   .get().handle((c) => ({ user: c.procedures.user })); // typed: User, not User | undefined
   * ```
   */
  public procedure(): ProcedureBuilderStage<
    {},
    undefined,
    TContextExtensions,
    TContextRefinementRules,
    TDefaultRouteConfig
  > {
    return createProcedureBuilder<
      TContextExtensions,
      TContextRefinementRules,
      TDefaultRouteConfig
    >();
  }

  /**
   * Declares a middleware scoped to the directory of the file that calls it.
   *
   * **Where it can be called**: only from inside a `middleware.ts` or any
   * `*.mw.ts` file during route discovery. Calling it elsewhere throws.
   *
   * **What it applies to**: every route registered in the same directory or
   * any nested directory. Routing groups like `(auth-stuff)` count as
   * directories for scoping even though they're stripped from the URL path —
   * put a middleware inside a group to limit it to routes in that group.
   *
   * **Execution order**: outermost-first → innermost-last (root middleware
   * runs first, the deepest one wraps the route handler). Within a single
   * directory, middlewares run in registration order.
   *
   * **Hono-style flow**: receive `(c, next)`. Call `next()` to continue down
   * the chain; return a `Response` (or resolve to one) to short-circuit. The
   * resolved value of `next()` is the final `Response` from the route.
   *
   * @example
   * ```ts
   * // src/routes/(staff)/middleware.ts — applies to every route under the (staff) group
   * server.middleware()
   *   .describe("Staff-only guard")
   *   .handle(async (c, next) => {
   *     if (!c.auth.data?.user.isStaff) {
   *       return createApiJsonErrorResponse(403, { code: "FORBIDDEN", message: "Staff only." });
   *     }
   *     return next();
   *   });
   * ```
   */
  public middleware(): MiddlewareBuilderStage<
    TContextExtensions,
    TContextRefinementRules,
    TDefaultRouteConfig
  > {
    return createMiddlewareBuilder<
      TContextExtensions,
      TContextRefinementRules,
      TDefaultRouteConfig
    >((definition) =>
      this.routes.addMiddlewareFromCurrentFile(
        definition as unknown as MiddlewareDefinition,
      ),
    );
  }

  /**
   * Returns a JSON-serializable manifest describing every registered route.
   *
   * Includes path, source file, params schema (as JSON Schema), per-method
   * descriptors / schemas / merged config, and framework metadata. Used by
   * the {@link ClientGenerationPlugin} to expose `GET /@client` for codegen,
   * and by tooling that wants to introspect the running app.
   *
   * Routes whose effective config has `exposeClient: false` are still present
   * here — filtering happens in the plugin.
   */
  public getClientManifest(): ClientManifest {
    return this.routes.getClientManifest(
      this.clientManifestListeningSince !== undefined
        ? { listeningSince: this.clientManifestListeningSince }
        : undefined,
    );
  }

  /**
   * Sets server-wide defaults, currently `{ routes }` for default per-route config.
   *
   * Deep-merges with any previous call so you can layer plugin-contributed
   * keys (e.g. `{ authentication: { required: true } }`) on top of base
   * defaults. Method-level / route-level config overrides anything set here.
   *
   * Type-level: tightens `TDefaultRouteConfig` so plugin context refinements
   * (e.g. `c.auth.data` becoming non-optional when `authentication.required`
   * is true by default) propagate to every route handler.
   *
   * @example
   * ```ts
   * server.config({
   *   routes: {
   *     authentication: { required: true },
   *     ratelimit: { limit: 100, timeframe: 60_000 },
   *   },
   * });
   * ```
   */
  public config<TNextConfig extends RouteConfig<TRouteConfigExtensions>>(
    config: ServerConfig<TRouteConfigExtensions> & { routes?: TNextConfig },
  ): Server<
    TContextExtensions,
    TRouteConfigExtensions,
    TContextRefinementRules,
    DeepMergeObjects<TDefaultRouteConfig, TNextConfig>
  > {
    this.configState = {
      routes: mergeRouteConfig(this.configState.routes, config.routes),
    };
    this.routes.setDefaultRouteConfig(this.configState.routes);
    return this as unknown as Server<
      TContextExtensions,
      TRouteConfigExtensions,
      TContextRefinementRules,
      DeepMergeObjects<TDefaultRouteConfig, TNextConfig>
    >;
  }

  /**
   * Registers a server plugin.
   *
   * Plugins extend the framework with cross-cutting features: authentication,
   * rate limiting, CORS, logging, client manifest generation, etc. Each plugin
   * can:
   *
   * - Add fields to the request context (e.g. `c.auth`, `c.ratelimiting`).
   * - Add keys to per-route config (e.g. `authentication`, `ratelimit`, `exposeClient`).
   * - Mount HTTP routes on the underlying Hono app.
   * - Hook into the route pipeline via `beforeValidationHooks`.
   * - Refine context types when the route's effective config matches a `when` predicate.
   *
   * Plugins are applied once during {@link Server.listen}, in registration order.
   * Plugins marked `unique: true` throw if registered twice with the same `id`.
   *
   * @example
   * ```ts
   * server
   *   .use(new CorsPlugin({ origin: "https://example.com" }))
   *   .use(AuthenticationPlugin({ field: "auth", authenticator }))
   *   .use(RatelimitPlugin())
   *   .use(new LoggerPlugin())
   *   .use(ClientGenerationPlugin());
   * ```
   */
  public use<
    TPluginContextExtensions extends object,
    TPluginRouteConfigExtensions extends object,
    TPluginContextRefinementRules extends ContextRefinementRule,
  >(
    plugin: ServerPlugin<
      TPluginContextExtensions,
      TPluginRouteConfigExtensions,
      TPluginContextRefinementRules
    >,
  ): Server<
    Simplify<TContextExtensions & TPluginContextExtensions>,
    Simplify<TRouteConfigExtensions & TPluginRouteConfigExtensions>,
    TContextRefinementRules | TPluginContextRefinementRules,
    TDefaultRouteConfig
  > {
    assertUniquePluginRegistration(this.plugins, plugin, "Server.use");
    this.plugins.push(plugin);
    return this as unknown as Server<
      Simplify<TContextExtensions & TPluginContextExtensions>,
      Simplify<TRouteConfigExtensions & TPluginRouteConfigExtensions>,
      TContextRefinementRules | TPluginContextRefinementRules,
      TDefaultRouteConfig
    >;
  }

  private async applyPlugins(): Promise<void> {
    if (this.pluginsApplied) {
      return;
    }

    for (const plugin of this.plugins) {
      await plugin.apply({
        server: this as unknown as Server<object, object, never>,
        app: this.app,
      });
    }

    this.pluginsApplied = true;
  }
}
