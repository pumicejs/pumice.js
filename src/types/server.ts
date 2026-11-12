import type { ServerConfig } from "./config.js";
import type { ModelDefinition } from "./model.js";
export type { ServerConfig } from "./config.js";

/**
 * Server construction options.
 */
export type ServerConstructOptions<TExtensions extends object = object> = {
  /**
   * Relative directory name used for file-system route discovery.
   * Defaults to `"routes"`.
   */
  basePath?: string;
  /**
   * Absolute or relative root directory for route discovery.
   * Defaults to `<cwd>/src`.
   */
  rootDir?: string;
  /**
   * Optional server defaults, including route-level defaults.
   */
  config?: ServerConfig<TExtensions>;
  /**
   * Models the manifests describe once and route schemas point at; the same
   * as calling `server.models(models)` right after construction.
   */
  models?: readonly ModelDefinition[];
};

/**
 * Runtime listen options.
 */
export type ServerListenOptions = {
  /**
   * HTTP port to bind to.
   * Defaults to `3000`.
   */
  port?: number;
};
