import { server } from "../../server.js";

// Returns without calling `next()`: the chain continues once.
server.middleware().handle(async () => {});
