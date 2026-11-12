import { z } from "pumice.js";

export const Note = z.object({ id: z.number(), text: z.string() });

export const Draft = z.object({ text: z.string() });

export const Problem = z.object({ field: z.string(), reason: z.string() });

export const Secret = z.object({ token: z.string() });
