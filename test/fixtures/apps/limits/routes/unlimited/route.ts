import { server } from "../../server.js";

server
  .route()
  .post()
  .config({ bodyLimit: false })
  .handle(async (c) => ({ length: (await c.req.text()).length }));
