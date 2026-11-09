// Imports from another route file on purpose (REVIEW §1.2).
import { PostSchema } from "../posts/[postId]/route.js";
import { server } from "../../server.js";

server
  .route()
  .post()
  .describe("Create board")
  .handle(() => ({ from: "boards", schema: PostSchema.shape.id.type }));
