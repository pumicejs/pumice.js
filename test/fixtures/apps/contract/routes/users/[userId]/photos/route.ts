import { z } from "pumice.js";
import { server } from "../../../../server.js";

server
  .route()
  .params(z.object({ userId: z.string() }))
  .post()
  .describe("Upload photos")
  .config({ docs: { tags: ["media"] } })
  .files({
    minCount: 1,
    maxCount: 5,
    maxSize: 1024 * 1024,
    totalMaxSize: 4 * 1024 * 1024,
    allowedTypes: ["image/*"],
  })
  .response(z.object({ count: z.number() }))
  .handle((c) => ({ count: c.files.length }));
