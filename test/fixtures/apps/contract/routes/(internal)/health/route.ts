import { Health } from "../../../lib/schemas.js";
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
  .response(Health)
  .handle(() => ({ status: "ok" as const }));
