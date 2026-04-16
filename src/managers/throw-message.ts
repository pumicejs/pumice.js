import type {
  RouteSchema,
  RouteThrowDescriptor,
  RouteThrowSchema,
  RouteThrowsCodeSchemaMap,
} from "../types/schema.js";

function isZodSchemaLike(value: unknown): value is { safeParse: unknown } {
  return typeof value === "object" && value !== null && "safeParse" in value;
}

function isRouteThrowDescriptor(value: unknown): value is RouteThrowDescriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    !isZodSchemaLike(value) &&
    ("data" in value || "issues" in value || "message" in value)
  );
}

function getDescriptorMessage(value: unknown): string | undefined {
  if (!isRouteThrowDescriptor(value)) {
    return undefined;
  }

  return typeof value.message === "string" && value.message.length > 0
    ? value.message
    : undefined;
}

/**
 * Resolves throw-message defaults from route schema declarations.
 *
 * Precedence is:
 * 1) status descriptor `message`
 * 2) code descriptor `message` (for code-mapped statuses)
 * 3) undefined (caller can fallback to HTTP status text)
 */
export function resolveDefaultThrowMessage(
  schema: RouteSchema | undefined,
  status: number,
  code?: string,
): string | undefined {
  const throwsSchema = schema?.throws;
  if (!throwsSchema) {
    return undefined;
  }

  const statusSchema = throwsSchema[status];
  if (!statusSchema || isZodSchemaLike(statusSchema)) {
    return undefined;
  }

  const statusMessage = getDescriptorMessage(statusSchema);
  if (statusMessage) {
    return statusMessage;
  }

  if (!code) {
    return undefined;
  }

  const codeSchema = (statusSchema as RouteThrowsCodeSchemaMap)[code] as
    | RouteThrowSchema
    | undefined;

  return getDescriptorMessage(codeSchema);
}
