import { server } from "../../../../server.js";

server
  .route()
  .get()
  .handle((c) => ({ postId: c.req.param("postId") }));
