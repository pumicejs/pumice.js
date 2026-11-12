import { z } from "pumice.js";
import { User } from "../../lib/schemas.js";
import { server } from "../../server.js";

server
  .route()
  .get()
  .describe("List users")
  .config({ docs: { tags: ["users"], summary: "List users", order: 1 } })
  .query(
    z.object({
      page: z.number().int().min(1).default(1),
      role: z.enum(["admin", "member"]).optional(),
    }),
  )
  .response(z.array(User))
  .handle(() => [])
  .post()
  .describe("Create a user")
  .config({
    docs: {
      tags: ["users", "beta"],
      examples: [
        { name: "Minimal", request: { name: "Ann", email: "ann@example.com" } },
      ],
    },
  })
  .body(
    z.object({
      name: z.string().min(1),
      email: z.email(),
      role: z.enum(["admin", "member"]).default("member"),
    }),
  )
  .response({ 201: User })
  .throws({
    // Not every property of a model (PartialUser has `name`), so inline.
    409: {
      message: "Email already registered",
      data: User.pick({ id: true, email: true }),
    },
    422: z.object({ field: z.string() }),
  })
  .handle((c) => {
    throw c.error({
      status: 409,
      data: { id: "u1", email: c.body.email },
    });
  });
