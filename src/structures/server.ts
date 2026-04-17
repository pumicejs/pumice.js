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
   * Starts the HTTP server and auto-registers discovered routes.
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
   * Creates a fluent route builder.
   *
   * Typical usage:
   * `server.route().get().describe("Get user").schema({ response: { 200: UserSchema }, throws: { 404: { data: NotFoundSchema, issues: z.array(IssueSchema) } } }).handle(...)`
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
   * Starts a reusable procedure definition.
   *
   * Procedures encapsulate shared request-time logic (param validation,
   * auth checks, resource loading) and contribute typed values to
   * `c.procedures` on routes that attach them via `route().procedure(...)`.
   *
   * Example:
   * ```ts
   * const userProcedure = server.procedure()
   *   .config<{ skipOwnershipCheck?: boolean }>()
   *   .params(z.object({ userId: z.number() }))
   *   .handle(async (c) => {
   *     const user = await repos.users.findUnique({ where: { id: c.params.userId } }, true);
   *     if (!user) throw 404;
   *     if (!c.config.skipOwnershipCheck && user.id !== c.auth.data.user.id) throw 403;
   *     return { user };
   *   });
   * ```
   */
  public procedure(): ProcedureBuilderStage<{}, undefined, TContextExtensions> {
    return createProcedureBuilder<TContextExtensions>();
  }

  /**
   * Returns a JSON-serializable manifest of all routes (see {@link RouteManager.getClientManifest}).
   */
  public getClientManifest(): ClientManifest {
    return this.routes.getClientManifest(
      this.clientManifestListeningSince !== undefined
        ? { listeningSince: this.clientManifestListeningSince }
        : undefined,
    );
  }

  /**
   * Applies server-wide defaults (including route defaults).
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
   * Registers a plugin to be applied once before listen.
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
