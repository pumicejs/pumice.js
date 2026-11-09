import { server } from "../../server.js";

server
  .route()
  .get()
  .handle((c) => ({ id: c.session.data.user.id }));
