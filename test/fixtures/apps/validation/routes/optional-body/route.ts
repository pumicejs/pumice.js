import { z } from "pumice.js";
import { server } from "../../server.js";

server
  .route()
  .post()
  .body(z.object({ note: z.string() }).optional())
  .handle((c) => ({ note: c.body?.note ?? null }));
