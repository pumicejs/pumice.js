import type { Simplify } from "../utils/types.js";

/**
 * Per-route config the framework itself reads, available on every server.
 */
export type CoreRouteConfig = {
  /**
   * Largest request body the route accepts, in bytes; `false` turns the check
   * off (for a route that streams `c.req.raw.body` itself).
   *
   * Defaults to 1 MiB. A route with `.file()` / `.files()` defaults to its
   * declared size limit plus room for the other form fields, when that is
   * larger. Checked before the body is parsed, on `Content-Length` and on the
   * bytes as they stream in; too large → 413 `PAYLOAD_TOO_LARGE`.
   */
  bodyLimit?: number | false;
};

/**
 * Per-route config consumed by runtime middleware/policies: the framework's
 * own keys ({@link CoreRouteConfig}) plus whatever plugins add through
 * `ServerBuilder.use(...)`.
 */
export type RouteConfig<TExtensions extends object = {}> = Partial<
  Simplify<CoreRouteConfig & TExtensions>
>;

/**
 * Server-wide defaults.
 */
export type ServerConfig<TExtensions extends object = {}> = {
  routes?: RouteConfig<TExtensions>;
};
