import { server } from "../../server.js";
import { trace } from "../../trace.js";

server
  .route()
  .get()
  .handle(() => {
    trace.push("handler:/users");
    return { list: true };
  })
  .post()
  .handle(() => ({ created: true }));
