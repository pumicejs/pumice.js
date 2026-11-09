import { server } from "../../server.js";
import { counters } from "../../trace.js";

server
  .route()
  .post()
  .handle(() => ({ hits: ++counters.wrapHandler }));
