import { z } from "pumice.js";
import { User } from "../../lib/schemas.js";
import { server } from "../../server.js";

// A model plus a field: `allOf` of the ref and the extra property.
server
  .route()
  .get()
  .describe("Get the signed-in user")
  .response(User.extend({ isMe: z.boolean() }))
  .handle((c) => ({
    id: c.auth.data?.user.id ?? "u1",
    name: "Nova",
    email: "nova@example.com",
    role: "member" as const,
    createdAt: new Date(0),
    bio: null,
    tags: [],
    isMe: true,
  }));
