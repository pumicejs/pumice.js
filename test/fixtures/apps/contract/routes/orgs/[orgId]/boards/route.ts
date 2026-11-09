import { z } from "pumice.js";
import { server } from "../../../../server.js";

// The same query as GET /orgs/:orgId/members: a schema two routes share.
server
  .route()
  .get()
  .describe("List boards")
  .config({
    docs: {
      description: "Includes **archived** boards.",
      tags: ["unknown-tag"],
    },
  })
  .query(
    z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().max(100).optional(),
    }),
  )
  .response(z.array(z.object({ id: z.number(), title: z.string() })))
  .handle(() => []);
