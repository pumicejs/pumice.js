import { z } from "pumice.js";
import { server } from "../../server.js";

server
  .route()
  .get()
  .headers(z.object({ "x-api-key": z.string().min(3) }))
  .handle((c) => ({ key: c.headers["x-api-key"] }));
