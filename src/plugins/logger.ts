import type { Context } from "hono";
import type { ServerPlugin } from "../types/plugin.js";

type LoggerLike = Pick<Console, "info" | "error">;

export type LoggerPluginOptions = {
  /**
   * Custom logger implementation.
   *
   * Defaults to the global `console`.
   */
  logger?: LoggerLike;
  /**
   * Whether to log a line when the request starts.
   * Defaults to `true`.
   */
  logRequestStart?: boolean;
  /**
   * Whether to log a line when the response is finished.
   * Defaults to `true`.
   */
  logResponseEnd?: boolean;
};

function getClientIp(context: Context): string | undefined {
  const forwardedFor = context.req.header("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim();
  }

  return (
    context.req.header("x-real-ip") ??
    context.req.header("cf-connecting-ip") ??
    undefined
  );
}

/**
 * Logs each request/response lifecycle with duration and status.
 *
 * Example:
 * `use(new LoggerPlugin())`
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
      const clientIp = getClientIp(context) ?? "unknown";

      if (shouldLogStart) {
        logger.info(`[REQUEST] ${method} ${path} ip=${clientIp} ua="${userAgent}"`);
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
      const contentLength = context.res.headers.get("content-length") ?? "unknown";
      logger.info(
        `[RESPONSE] ${method} ${path} status=${status} duration_ms=${durationMs} content_length=${contentLength}`,
      );
    });
  }
}
