import { server } from "../../server.js";

server
  .route()
  .get()
  .config({ ratelimit: false })
  .handle(() => "ok");
