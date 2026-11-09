import { server } from "../../server.js";

server
  .route()
  .post()
  .config({
    ratelimit: { name: "attempts", limit: 2, timeframe: 60_000, manual: true },
  })
  .handle(async (c) => {
    if (c.req.header("x-fail") === "yes") {
      const result = await c.ratelimiting("attempts").consume();
      return { allowed: result.allowed, remaining: result.remaining };
    }
    if (c.req.header("x-reset") === "yes") {
      await c.ratelimiting.reset();
      return { reset: true };
    }
    if (c.req.header("x-block") === "yes") {
      await c.ratelimiting.block(60_000);
      return { blocked: true };
    }
    return { peek: await c.ratelimiting.peek() };
  });
