import { z } from "pumice.js";
import { server } from "../../server.js";

// One handler for every method, open to everyone.
server
  .route()
  .any()
  .describe("Ping")
  .config({ authentication: { required: false } })
  .response(z.string())
  .handle(() => "pong");
