import { server } from "../../server.js";

server
  .route()
  .get()
  .config({
    ratelimit: {
      limit: (c) => (c.req.header("x-plan") === "pro" ? 5 : 1),
      timeframe: 60_000,
      scope: (c) => `plan:${c.req.header("x-plan") ?? "free"}`,
    },
  })
  .handle(() => "ok");
