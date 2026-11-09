import { z } from "pumice.js";
import { server } from "../../../../server.js";

server
  .route()
  .params(z.object({ userId: z.string() }))
  .put()
  .describe("Upload an avatar")
  .config({ docs: { tags: ["media"] } })
  .file({
    fieldName: "avatar",
    maxSize: 2 * 1024 * 1024,
    allowedTypes: ["image/png", "image/jpeg"],
  })
  .body(z.object({ alt: z.string().optional() }))
  .response({ 200: z.object({ url: z.url() }) })
  .handle(() => ({ url: "https://cdn.example/a.png" }));
