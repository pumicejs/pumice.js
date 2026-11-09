import { server } from "../../server.js";

server
  .route()
  .get()
  .handle(() => ({ search: true }));
