import { server } from "../../server.js";

server
  .route()
  .get()
  .config({ ratelimit: { limit: 1, timeframe: 60_000, scope: "global" } })
  .handle(() => "ok");
