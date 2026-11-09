import { server } from "../../../server.js";

server
  .route()
  .get()
  .handle(() => ({ me: true }));
