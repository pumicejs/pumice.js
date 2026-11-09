import type { z } from "zod";
import type {
  RouteThrowDescriptor,
  RouteThrowsCodeSchemaMap,
} from "../types/schema.js";

/**
 * Runtime guards for the shapes a route schema can take.
 *
 * Duck-typed on purpose: a schema built with another copy of Zod is not an
 * `instanceof` this one's classes, but it still parses.
 */

/** A Zod schema (anything with `safeParse`). */
export function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return typeof value === "object" && value !== null && "safeParse" in value;
}

/** A `throws` entry written as `{ message?, data?, issues? }`. */
export function isThrowDescriptor(
  value: unknown,
): value is RouteThrowDescriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    !isZodSchema(value) &&
    ("data" in value || "issues" in value || "message" in value)
  );
}

/** A `throws` status entry keyed by business code (`{ USER_TAKEN: … }`). */
export function isThrowsCodeSchemaMap(
  value: unknown,
): value is RouteThrowsCodeSchemaMap {
  return (
    typeof value === "object" &&
    value !== null &&
    !isZodSchema(value) &&
    !isThrowDescriptor(value)
  );
}
