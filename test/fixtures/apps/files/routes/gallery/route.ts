import { server } from "../../server.js";

server
  .route()
  .post()
  .files({
    minCount: 1,
    maxCount: 3,
    maxSize: 100,
    totalMaxSize: 150,
    allowedTypes: ["image/*"],
  })
  .handle((c) => ({ names: c.files.map((file) => file.name) }));
