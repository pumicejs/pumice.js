import { server } from "../../server.js";

server
  .route()
  .get()
  .handle((c) => c.json({ via: "json" }));
