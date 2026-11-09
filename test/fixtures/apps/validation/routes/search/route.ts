import { z } from "pumice.js";
import { server } from "../../server.js";

server
  .route()
  .get()
  .query(
    z.object({
      q: z.string(),
      page: z.number().int().optional(),
      exact: z.boolean().optional(),
      either: z.union([z.string(), z.number()]).optional(),
    }),
  )
  .handle((c) => c.query);
