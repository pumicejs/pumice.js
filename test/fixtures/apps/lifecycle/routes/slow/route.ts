import { server } from "../../server.js";
import { passGate } from "../../gate.js";

server
  .route()
  .get()
  .handle(async () => {
    await passGate();
    return "slow";
  });
