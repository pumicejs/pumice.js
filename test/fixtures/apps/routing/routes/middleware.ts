import { server } from "../server.js";
import { trace } from "../trace.js";

server
  .middleware()
  .describe("root")
  .handle(async (_c, next) => {
    trace.push("root:before");
    const response = await next();
    trace.push("root:after");
    return response;
  });
