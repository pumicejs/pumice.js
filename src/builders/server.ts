import { Server } from "../structures/server.js";
import type { ContextRefinementRule, ServerPlugin } from "../types/plugin.js";
import { assertUniquePluginRegistration } from "../plugin-registration.js";
import type { ServerConstructOptions } from "../types/server.js";
import { mergeRouteConfig } from "../config/routes.js";
import type { RouteConfig, ServerConfig } from "../types/config.js";
import type { Simplify } from "../types/schema.js";

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
 * Fluent builder for a {@link Server}.
 *
 * Equivalent to constructing `new Server(options)` and chaining `.use(...)` /
 * `.config(...)` directly, but lets you configure everything in one expression
 * before any instance exists. Useful when callers need a single builder
 * value to pass between modules before the server is materialized.
 *
 * Chain order:
 *
 * ```text
 * new ServerBuilder()
 *   ├── .basePath("routes")          // route discovery subdirectory (default: "routes")
 *   ├── .rootDir(resolve(...))       // source root (default: <cwd>/src)
 *   ├── .config({ routes: { ... } }) // server-wide / route-level defaults
 *   ├── .use(plugin)                 // register plugins (chainable, type-narrowing)
 *   └── .build()                     // returns a configured Server instance
 * ```
 *
 * @example
 * ```ts
 * const server = new ServerBuilder()
 *   .basePath("routes")
 *   .use(AuthenticationPlugin({ field: "auth", authenticator }))
 *   .use(RatelimitPlugin())
 *   .config({ routes: { authentication: { required: true } } })
 *   .build();
 *
 * await server.listen({ port: 3000 });
 * ```
 */
export class ServerBuilder<
  TContextExtensions extends object = {},
  TRouteConfigExtensions extends object = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultRouteConfig extends object = {},
> {
  private readonly options: ServerConstructOptions<TRouteConfigExtensions> = {};
  private readonly plugins: ServerPlugin[] = [];

  /**
   * Sets the subdirectory under `rootDir` that route / middleware files live in.
   *
   * Defaults to `"routes"` (so files under `<rootDir>/routes/**` are discovered).
   *
   * @example `.basePath("api")` → reads from `<rootDir>/api/**`.
   */
  public basePath(basePath: string): this {
    this.options.basePath = basePath;
    return this;
  }

  /**
   * Sets the absolute (or `cwd`-relative) source root for route discovery.
   *
   * Defaults to `<cwd>/src`. Files under `<rootDir>/<basePath>/**` are scanned
   * for `route.{ts,js,...}`, `index.{ts,js,...}`, `middleware.{ts,js,...}`,
   * and any `*.mw.{ts,js,...}`.
   *
   * @example `.rootDir(resolve(process.cwd(), "src"))`
   */
  public rootDir(rootDir: string): this {
    this.options.rootDir = rootDir;
    return this;
  }

  /**
   * Sets server-wide defaults, deep-merged with any prior call.
   *
   * Mirrors {@link Server.config}: deep-merges into the existing config, and
   * narrows `TDefaultRouteConfig` so type-level context refinements
   * (e.g. `c.auth.data` becoming non-optional when `authentication.required`
   * is the default) flow through to every route.
   *
   * @example
   * ```ts
   * .config({
   *   routes: {
   *     authentication: { required: true },
   *     ratelimit: { limit: 100, timeframe: 60_000 },
   *   },
   * })
   * ```
   */
  public config<TNextConfig extends RouteConfig<TRouteConfigExtensions>>(
    config: ServerConfig<TRouteConfigExtensions> & { routes?: TNextConfig },
  ): ServerBuilder<
    TContextExtensions,
    TRouteConfigExtensions,
    TContextRefinementRules,
    DeepMergeObjects<TDefaultRouteConfig, TNextConfig>
  > {
    this.options.config = {
      routes: mergeRouteConfig(this.options.config?.routes, config.routes),
    };
    return this as unknown as ServerBuilder<
      TContextExtensions,
      TRouteConfigExtensions,
      TContextRefinementRules,
      DeepMergeObjects<TDefaultRouteConfig, TNextConfig>
    >;
  }

  /**
   * Registers a plugin to be applied when the server boots.
   *
   * Mirrors {@link Server.use}: each plugin can extend the request context,
   * route config, route pipeline, and / or mount its own HTTP routes. The
   * builder's generics widen with each `.use(...)` so plugin-contributed
   * fields are visible everywhere downstream.
   *
   * @example
   * ```ts
   * builder
   *   .use(new CorsPlugin())
   *   .use(AuthenticationPlugin({ authenticator }))
   *   .use(RatelimitPlugin());
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
  ): ServerBuilder<
    Simplify<TContextExtensions & TPluginContextExtensions>,
    Simplify<TRouteConfigExtensions & TPluginRouteConfigExtensions>,
    TContextRefinementRules | TPluginContextRefinementRules,
    TDefaultRouteConfig
  > {
    assertUniquePluginRegistration(this.plugins, plugin, "ServerBuilder.use");
    this.plugins.push(plugin);
    return this as unknown as ServerBuilder<
      Simplify<TContextExtensions & TPluginContextExtensions>,
      Simplify<TRouteConfigExtensions & TPluginRouteConfigExtensions>,
      TContextRefinementRules | TPluginContextRefinementRules,
      TDefaultRouteConfig
    >;
  }

  /**
   * Materializes a configured {@link Server} instance.
   *
   * Constructs the server with the accumulated options and re-registers each
   * plugin on it, preserving registration order. Plugins are not applied yet
   * — that happens on {@link Server.listen}.
   */
  public build(): Server<
    TContextExtensions,
    TRouteConfigExtensions,
    TContextRefinementRules,
    TDefaultRouteConfig
  > {
    const server = new Server<
      TContextExtensions,
      TRouteConfigExtensions,
      TContextRefinementRules,
      TDefaultRouteConfig
    >(this.options);

    for (const plugin of this.plugins) {
      server.use(plugin);
    }

    return server;
  }
}
