import { z } from "pumice.js";
import { server } from "../../../server.js";

server
  .route()
  .params(z.object({ id: z.number() }))
  .get()
  .handle((c) => ({ id: c.params.id }));
