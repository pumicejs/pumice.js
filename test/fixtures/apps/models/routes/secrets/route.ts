import { Secret } from "../../lib/schemas.js";
import { server } from "../../server.js";

server
  .route()
  .get()
  .describe("Read the secret")
  .config({ exposeClient: false, docs: { hidden: true } })
  .response(Secret)
  .handle(() => ({ token: "t" }));
