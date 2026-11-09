import { z } from "pumice.js";
import { server } from "../../server.js";

server
  .route()
  .post()
  .config({ bodyLimit: 64 })
  .body(z.object({ text: z.string() }))
  .handle((c) => ({ length: c.body.text.length }));
