import { server } from "../../server.js";

server
  .route()
  .get()
  .config({
    ratelimit: {
      rules: [
        { name: "burst", limit: 3, timeframe: 1_000 },
        { name: "hourly", limit: 1, timeframe: 3_600_000 },
      ],
    },
  })
  .handle(() => "ok");
