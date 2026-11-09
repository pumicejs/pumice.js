import { server } from "../../server.js";

server
  .route()
  .get()
  .config({
    ratelimit: { algorithm: "sliding-window", limit: 2, timeframe: 60_000 },
  })
  .handle(() => "ok");
