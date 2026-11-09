import { server } from "../../server.js";

server
  .route()
  .post()
  .file({ maxSize: 3 * 1024 * 1024 })
  .handle((c) => ({ size: c.file.size }));
