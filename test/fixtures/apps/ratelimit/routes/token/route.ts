import { server } from "../../server.js";

server
  .route()
  .get()
  .config({
    ratelimit: {
      algorithm: "token-bucket",
      limit: 1,
      timeframe: 60_000,
      burst: 3,
    },
  })
  .handle(() => "ok");
