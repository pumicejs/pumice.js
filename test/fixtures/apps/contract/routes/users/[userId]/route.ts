import { z } from "pumice.js";
import { userProcedure } from "../../../lib/procedures.js";
import { User } from "../../../lib/schemas.js";
import { server } from "../../../server.js";

server
  .route()
  .procedure(userProcedure())
  .get()
  .describe("Get a user")
  .headers(z.object({ "x-request-id": z.string().optional() }))
  .response(User)
  .throws({
    403: {
      NOT_OWNER: { message: "Not your account" },
      SUSPENDED: {
        message: "Account suspended",
        data: z.object({ until: z.string() }),
      },
    },
  })
  .handle((c) => {
    throw c.error({ status: 403, code: "NOT_OWNER" });
  })
  .delete()
  .describe("Delete a user")
  .config({ docs: { deprecated: true } })
  .response(z.void())
  .handle(() => undefined);
