import { z } from "pumice.js";
import { server } from "../../../../server.js";

server
  .route()
  .params(z.object({ n: z.number(), flag: z.boolean() }))
  .get()
  .handle((c) => c.params);
