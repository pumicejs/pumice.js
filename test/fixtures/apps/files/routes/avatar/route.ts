import { z } from "pumice.js";
import { server } from "../../server.js";

server
  .route()
  .post()
  .file({
    fieldName: "avatar",
    maxSize: 1024,
    minSize: 2,
    allowedTypes: ["image/png", ".jpg"],
  })
  .body(
    z.object({ caption: z.string(), public: z.boolean(), rank: z.number() }),
  )
  .handle((c) => ({
    name: c.file.name,
    size: c.file.size,
    body: c.body,
  }));
