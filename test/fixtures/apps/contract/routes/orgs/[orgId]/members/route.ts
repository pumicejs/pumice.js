import { z } from "pumice.js";
import { server } from "../../../../server.js";

// The same query as GET /orgs/:orgId/boards: a schema two routes share.
server
  .route()
  .get()
  .describe("List members")
  .query(
    z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().max(100).optional(),
    }),
  )
  .response(z.array(z.object({ userId: z.string() })))
  .handle(() => []);
