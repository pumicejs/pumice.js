import { z } from "pumice.js";
import { User } from "../../../../lib/schemas.js";
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
  // PartialUser's properties plus `role`: a list of PartialUsers, each plus a field.
  .response(z.array(User.pick({ id: true, name: true, role: true })))
  .handle(() => []);
