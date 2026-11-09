import { server } from "../../server.js";

server
  .route()
  .get()
  .config({ authentication: { required: false } })
  .handle((c) => ({ authenticated: c.session.authenticated }));
