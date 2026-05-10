import { cors } from "hono/cors";
import type { ServerPlugin } from "../types/plugin.js";

/**
 * Options forwarded directly to Hono's built-in `cors()` middleware.
 *
 * Common keys: `origin`, `allowMethods`, `allowHeaders`, `exposeHeaders`,
 * `credentials`, `maxAge`. See Hono's documentation for the full reference.
 */
export type CorsPluginOptions = Parameters<typeof cors>[0];

/**
 * Mounts CORS handling on every request.
 *
 * Wraps Hono's built-in `cors()` middleware and applies it at `*`, so the
 * plugin handles preflight `OPTIONS` requests automatically and adds the
 * appropriate CORS headers to every response.
 *
 * @example
 * ```ts
 * server.use(new CorsPlugin({
 *   origin: ["https://app.example.com", "https://admin.example.com"],
 *   credentials: true,
 *   allowHeaders: ["Authorization", "Content-Type"],
 * }));
 * ```
 */
export class CorsPlugin implements ServerPlugin {
  public constructor(private readonly options?: CorsPluginOptions) {}

  public apply({ app }: Parameters<ServerPlugin["apply"]>[0]): void {
    app.use("*", cors(this.options));
  }
}
