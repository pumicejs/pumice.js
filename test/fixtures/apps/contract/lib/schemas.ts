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

// The same property schemas as User, so an object that has them is a
// PartialUser (or extends one).
export const PartialUser = User.pick({ id: true, name: true });

export const Board = z.object({
  id: z.number(),
  title: z.string(),
  owner: User.nullable(),
});

export const Category = z.object({
  name: z.string(),
  get children() {
    return z.array(Category);
  },
});

export const Job = z.object({
  id: z.string(),
  state: z.enum(["queued", "running", "done"]),
});

export const Health = z.object({ status: z.literal("ok") });
