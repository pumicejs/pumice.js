import { z } from "pumice.js";
import { server } from "../../server.js";

const Item = z.object({ name: z.string(), count: z.number() });

server
  .route()
  .post()
  .describe("Create an item, or fail in the way `name` asks for")
  .body(
    z.object({
      name: z.string().min(1),
      count: z.number().int().default(1),
    }),
  )
  .response({ 200: Item, 201: Item })
  .throws({
    409: { message: "An item with this name already exists" },
    422: {
      message: "Rejected",
      data: z.object({ reason: z.string() }),
    },
    403: {
      NOT_OWNER: { message: "Not your item" },
      LOCKED: { message: "Item is locked" },
    },
  })
  .handle((c) => {
    const { name, count } = c.body;
    switch (name) {
      case "dup":
        throw c.error({ status: 409 });
      case "reject":
        throw c.error({ status: 422, data: { reason: "rate_limited" } });
      case "bad-data":
        throw c.error({ status: 422, data: { wrong: 1 } } as never);
      case "owner":
        throw c.error({ status: 403, code: "NOT_OWNER" });
      case "no-code":
        throw c.error({ status: 403 } as never);
      case "undeclared":
        throw 404;
      case "crash":
        throw new Error("database exploded");
      case "unavailable":
        throw 503;
      case "created":
        return c.response({ status: 201, data: { name, count } });
      case "raw":
        return new Response("raw body", { status: 202 });
      default:
        return { name, count };
    }
  });
