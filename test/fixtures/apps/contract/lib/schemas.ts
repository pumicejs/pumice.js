import { z } from "pumice.js";

export const User = z.object({
  id: z.string().describe("Stable user id"),
  name: z.string(),
  email: z.email(),
  role: z.enum(["admin", "member"]),
  createdAt: z.date(),
  bio: z.string().nullable(),
  tags: z.array(z.string()),
});
