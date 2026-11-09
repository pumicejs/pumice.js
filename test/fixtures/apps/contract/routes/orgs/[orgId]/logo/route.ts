import { z } from "pumice.js";
import { server } from "../../../../server.js";

// A file upload whose form fields include an object.
server
  .route()
  .put()
  .describe("Upload an organization logo")
  .config({ docs: { tags: ["media"] } })
  .file({ fieldName: "logo", allowedTypes: ["image/svg+xml", "image/png"] })
  .body(
    z.object({
      caption: z.string().optional(),
      crop: z.object({ x: z.number(), y: z.number() }).optional(),
    }),
  )
  .response(z.object({ url: z.url() }))
  .handle(() => ({ url: "https://cdn.example/logo.svg" }));
