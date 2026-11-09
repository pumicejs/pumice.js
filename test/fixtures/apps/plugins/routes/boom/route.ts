import { server } from "../../server.js";

server
  .route()
  .get()
  .config({ authentication: { required: false } })
  .handle(() => {
    throw 409;
  });
