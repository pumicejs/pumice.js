import { z } from "pumice.js";
import { server } from "../../server.js";

server
  .route()
  .post()
  .body(z.object({ n: z.number() }))
  .handle((c) => c.body);
