import { z } from "pumice.js";
import { server } from "../server.js";

export const userProcedure = server
  .procedure()
  .params(z.object({ userId: z.string() }))
  .handle((c) => {
    if (c.params.userId === "missing") throw 404;
    return { userId: c.params.userId };
  });
