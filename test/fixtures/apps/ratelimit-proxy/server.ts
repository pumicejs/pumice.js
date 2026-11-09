import { createApiJsonErrorResponse, RatelimitPlugin, Server } from "pumice.js";

/** Rate limiting behind one trusted reverse proxy, with a custom 429. */
export const server = new Server({ rootDir: import.meta.dirname })
  .use(
    RatelimitPlugin({
      trustProxy: 1,
      onLimitReached: (_c, info) =>
        createApiJsonErrorResponse(429, {
          code: "SLOW_DOWN",
          message: `Retry in ${Math.ceil(info.retryAfterMs / 1000)}s.`,
        }),
    }),
  )
  .config({ routes: { ratelimit: { limit: 1, timeframe: 60_000 } } });
