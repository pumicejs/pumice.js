import { brokenProcedure } from "../../../lib/procedures.js";
import { server } from "../../../server.js";

server
  .route()
  .procedure(brokenProcedure())
  .get()
  .handle(() => "unreachable");
