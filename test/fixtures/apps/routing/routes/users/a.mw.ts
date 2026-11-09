import { server } from "../../server.js";
import { trace } from "../../trace.js";

server.middleware().handle(async (_c, next) => {
  trace.push("users-a");
  return next();
});
