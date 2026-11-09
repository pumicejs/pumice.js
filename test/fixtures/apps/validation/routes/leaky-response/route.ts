import { z } from "pumice.js";
import { server } from "../../server.js";

server
  .route()
  .get()
  .response(z.object({ id: z.number() }))
  .handle(() => ({ id: 1, passwordHash: "secret" }) as { id: number });
