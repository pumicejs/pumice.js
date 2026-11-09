import { z } from "pumice.js";
import { server } from "../../server.js";

server
  .route()
  .get()
  .query(
    z.object({
      page: z.string().transform(Number).pipe(z.number()).optional(),
      tag: z.array(z.string()).optional(),
    }),
  )
  .handle((c) => c.query);
