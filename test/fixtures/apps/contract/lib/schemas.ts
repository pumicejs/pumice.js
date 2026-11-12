import { z } from "pumice.js";

// The same in what a client sends and what the server sends, so request parts
// point at it too.
export const Role = z.enum(["admin", "member"]);

export const User = z.object({
  id: z.string().describe("Stable user id"),
  name: z.string(),
  email: z.email(),
  role: Role,
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

// A default in what the server sends: always there, so required.
export const Job = z.object({
  id: z.string(),
  state: z.enum(["queued", "running", "done"]).default("queued"),
});

export const Health = z.object({ status: z.literal("ok") });
