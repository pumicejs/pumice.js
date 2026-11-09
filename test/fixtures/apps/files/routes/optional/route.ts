import { server } from "../../server.js";

server
  .route()
  .post()
  .file({ required: false })
  .handle((c) => ({ hasFile: c.file !== undefined }));
