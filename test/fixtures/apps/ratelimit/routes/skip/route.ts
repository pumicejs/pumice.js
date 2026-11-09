import { server } from "../../server.js";

server
  .route()
  .get()
  .config({
    ratelimit: {
      limit: 1,
      timeframe: 60_000,
      skip: (c) => c.req.header("x-internal") === "yes",
    },
  })
  .handle(() => "ok");
