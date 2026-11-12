import { z } from "pumice.js";

export const Note = z.object({ id: z.number(), text: z.string() });

// Strict, so what a client sends is its body and the request body points at
// it; a stripping object has no `additionalProperties: false` in input mode.
export const Draft = z.object({ text: z.string() }).strict();

export const Problem = z.object({ field: z.string(), reason: z.string() });

export const Secret = z.object({ token: z.string() });
