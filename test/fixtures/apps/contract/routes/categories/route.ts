import { z } from "pumice.js";
import { Category } from "../../lib/schemas.js";
import { server } from "../../server.js";

// A recursive model: its body refers to itself.
server
  .route()
  .get()
  .describe("List categories")
  .config({ authentication: { required: false } })
  .response(z.array(Category))
  .handle(() => []);
