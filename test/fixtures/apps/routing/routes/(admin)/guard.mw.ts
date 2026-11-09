import { createApiJsonErrorResponse } from "pumice.js";
import { server } from "../../server.js";

server
  .middleware()
  .describe("Admin guard")
  .handle(async (c, next) => {
    if (c.req.header("x-admin") !== "yes") {
      return createApiJsonErrorResponse(403, {
        code: "FORBIDDEN",
        message: "Admins only.",
      });
    }
    return next();
  });
