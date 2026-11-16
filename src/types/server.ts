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
   * HTTP port to bind to; `0` lets the system pick a free one (the resolved
   * address says which).
   * Defaults to `3000`.
   */
  port?: number;
  /**
   * Address to bind to, such as `"127.0.0.1"` to accept local connections
   * only. Defaults to every address of the machine, as Node's `listen()` does.
   */
  hostname?: string;
};
