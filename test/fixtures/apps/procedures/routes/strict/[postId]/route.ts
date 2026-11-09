import { postProcedure } from "../../../lib/procedures.js";
import { server } from "../../../server.js";

// Declares a `throws` contract that doesn't list the procedure's 404/403.
server
  .route()
  .procedure(postProcedure({}))
  .patch()
  .throws({ 409: { message: "Conflict" } })
  .handle((c) => ({ id: c.procedures.post.id }));
