import { server } from "../server.js";

server
  .route()
  .get()
  .describe("Root")
  .handle(() => "root");
