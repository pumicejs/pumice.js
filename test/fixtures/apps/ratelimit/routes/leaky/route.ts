import { server } from "../../server.js";

server
  .route()
  .get()
  .config({
    ratelimit: { algorithm: "leaky-bucket", limit: 2, timeframe: 60_000 },
  })
  .handle(() => "ok");
