import { server } from "../../../server.js";

server
  .route()
  .get()
  .describe("Health check")
  .config({
    authentication: { required: false },
    exposeClient: false,
    docs: { group: "ops" },
  })
  .handle(() => "ok");
