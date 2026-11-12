import { z } from "pumice.js";
import { Board } from "../../../../../lib/schemas.js";
import { server } from "../../../../../server.js";

// Two path params on two methods: one params schema shared by both.
server
  .route()
  .params(z.object({ orgId: z.string(), boardId: z.number().int() }))
  .get()
  .describe("Get a board")
  .response(Board)
  .handle((c) => ({ id: c.params.boardId, title: "Roadmap", owner: null }))
  .patch()
  .describe("Rename a board")
  .body(z.object({ title: z.string().min(1) }))
  .response(z.void())
  .handle(() => undefined);
