import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { CoreRouteConfig } from "../types/config.js";
import type { RouteSchema } from "../types/schema.js";
import { createApiJsonErrorResponse } from "./json-envelope.js";

/** The limit for a route that declares nothing: 1 MiB. */
export const DEFAULT_BODY_LIMIT = 1024 * 1024;

// Room for the non-file form fields and the multipart boundaries around the
// files an upload route declares.
const MULTIPART_ALLOWANCE = 64 * 1024;

function declaredUploadSize(
  schema: RouteSchema | undefined,
): number | undefined {
  const files = schema?.files;
  if (files) {
    if (typeof files.totalMaxSize === "number") {
      return files.totalMaxSize;
    }
    if (
      typeof files.maxSize === "number" &&
      typeof files.maxCount === "number"
    ) {
      return files.maxSize * files.maxCount;
    }
    return undefined;
  }
  return schema?.file?.maxSize;
}

/**
 * The body limit that applies to a route: its `bodyLimit` config if set,
 * otherwise the larger of {@link DEFAULT_BODY_LIMIT} and what its declared
 * uploads need.
 */
export function resolveBodyLimit(
  config: CoreRouteConfig | undefined,
  schema: RouteSchema | undefined,
): number | false {
  if (config?.bodyLimit !== undefined) {
    return config.bodyLimit;
  }
  const uploads = declaredUploadSize(schema);
  return uploads === undefined
    ? DEFAULT_BODY_LIMIT
    : Math.max(DEFAULT_BODY_LIMIT, uploads + MULTIPART_ALLOWANCE);
}

/**
 * Rejects a request whose body is larger than `limit` bytes, before anything
 * reads it: by `Content-Length` when present, otherwise by counting the bytes
 * as they stream in (the counted body is handed on for parsing).
 *
 * @returns the 413 response, or `undefined` when the body fits.
 */
export async function enforceBodyLimit(
  context: Context,
  limit: number | false,
): Promise<Response | undefined> {
  if (limit === false) {
    return undefined;
  }

  let fits = false;
  const response = await bodyLimit({
    maxSize: limit,
    onError: () =>
      createApiJsonErrorResponse(413, {
        code: "PAYLOAD_TOO_LARGE",
        message: `The request body is larger than ${limit} bytes.`,
      }),
  })(context, async () => {
    fits = true;
  });

  return fits ? undefined : (response ?? undefined);
}
