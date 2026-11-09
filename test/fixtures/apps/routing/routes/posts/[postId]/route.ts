import { z } from "pumice.js";
import { server } from "../../../server.js";

export const PostSchema = z.object({ id: z.number() });

server
  .route()
  .get()
  .describe("Get post")
  .handle(() => ({ from: "posts/[postId]" }));
