import { server } from "../../server.js";

server.middleware().handle(async () => {
  throw 418;
});
