import { server } from "../../server.js";

// Hono-style: awaits `next()` and returns nothing (REVIEW §1.1).
server.middleware().handle(async (_c, next) => {
  await next();
});
