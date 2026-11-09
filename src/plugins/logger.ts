import type { ServerPlugin } from "../types/plugin.js";
import { resolveClientIp, type TrustProxy } from "../utils/client-ip.js";

type LoggerLike = Pick<Console, "info" | "error">;

/**
 * Options for {@link LoggerPlugin}.
 */
export type LoggerPluginOptions = {
  /**
   * Custom logger implementation. Must implement `info` and `error`.
   *
   * Useful for piping into pino, winston, or a structured-log destination.
   * Defaults to the global `console`.
   */
  logger?: LoggerLike;
  /**
   * Whether to emit a `[REQUEST]` line when the request starts.
   *
   * Disable to halve log volume in environments that only need response logs.
   * Defaults to `true`.
   */
  logRequestStart?: boolean;
  /**
   * Whether to emit a `[RESPONSE]` line when the response is finished.
   *
   * Defaults to `true`.
   */
  logResponseEnd?: boolean;
  /**
   * Which `X-Forwarded-For` entries to believe for the logged `ip=`. Default
   * `false`: the socket's peer address. Same meaning as the rate limiter's
   * option (see {@link TrustProxy}).
   */
  trustProxy?: TrustProxy;
};

/**
 * Logs each request / response lifecycle with method, path, status, duration,
 * client IP, and user-agent.
 *
 * Mounts as a Hono middleware at `*`, so it observes every request — including
 * 404s and errors. Errors thrown downstream are logged with `error=true` and
 * re-thrown so other error handling continues to work.
 *
 * Log lines (single line per event):
 * - `[REQUEST] METHOD /path ip=... ua="..."`
 * - `[RESPONSE] METHOD /path status=... duration_ms=... content_length=...`
 *
 * Client IP resolution follows `x-forwarded-for` (first entry) →
 * `x-real-ip` → `cf-connecting-ip`, so the plugin works behind the common
 * proxy / CDN setups.
 *
 * @example
 * ```ts
 * // default: log both request and response with the global console
 * server.use(new LoggerPlugin());
 *
 * // pipe into a structured logger; only log response lines
 * server.use(new LoggerPlugin({
 *   logger: { info: pino.info.bind(pino), error: pino.error.bind(pino) },
 *   logRequestStart: false,
 * }));
 * ```
 */
export class LoggerPlugin implements ServerPlugin {
  public constructor(private readonly options: LoggerPluginOptions = {}) {}

  public apply({ app }: Parameters<ServerPlugin["apply"]>[0]): void {
    const logger = this.options.logger ?? console;
    const shouldLogStart = this.options.logRequestStart ?? true;
    const shouldLogEnd = this.options.logResponseEnd ?? true;

    app.use("*", async (context, next) => {
      const startTime = Date.now();
      const method = context.req.method;
      const path = context.req.path;
      const userAgent = context.req.header("user-agent") ?? "unknown";
      const clientIp =
        resolveClientIp(context, this.options.trustProxy) ?? "unknown";

      if (shouldLogStart) {
        logger.info(
          `[REQUEST] ${method} ${path} ip=${clientIp} ua="${userAgent}"`,
        );
      }

      try {
        await next();
      } catch (error) {
        const durationMs = Date.now() - startTime;
        logger.error(
          `[RESPONSE] ${method} ${path} status=500 duration_ms=${durationMs} error=true`,
        );
        throw error;
      }

      if (!shouldLogEnd) {
        return;
      }

      const durationMs = Date.now() - startTime;
      const status = context.res.status;
      const contentLength =
        context.res.headers.get("content-length") ?? "unknown";
      logger.info(
        `[RESPONSE] ${method} ${path} status=${status} duration_ms=${durationMs} content_length=${contentLength}`,
      );
    });
  }
}
