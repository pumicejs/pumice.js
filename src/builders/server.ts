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

export class ServerBuilder<
  TContextExtensions extends object = {},
  TRouteConfigExtensions extends object = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultRouteConfig extends object = {},
> {
  private readonly options: ServerConstructOptions<TRouteConfigExtensions> = {};
  private readonly plugins: ServerPlugin[] = [];

  /**
   * Sets the route discovery base directory name.
   *
   * Example: `.basePath("routes")`
   */
  public basePath(basePath: string): this {
    this.options.basePath = basePath;
    return this;
  }

  /**
   * Sets the source root used when discovering file-system routes.
   *
   * Example: `.rootDir(resolve(process.cwd(), "src"))`
   */
  public rootDir(rootDir: string): this {
    this.options.rootDir = rootDir;
    return this;
  }

  /**
   * Applies server-wide defaults (including route defaults).
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
   * Registers a server plugin to be applied before listen.
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
   * Builds a configured `Server` instance.
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
