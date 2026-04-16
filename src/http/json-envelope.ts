import { getStatusMessage, type ApiErrorIssue } from "../errors/api.js";

/**
 * Canonical 2xx JSON body shape returned by the route runtime (`code` / `message` / `data`).
 */
export type ApiJsonSuccessBody = {
  code: string;
  message: string;
  data: unknown;
  issues?: ApiErrorIssue[];
};

/**
 * Canonical error JSON body shape (`code` / `message` / optional `data` / `issues`).
 */
export type ApiJsonErrorBody = {
  code: string;
  message: string;
  data?: unknown;
  issues?: unknown;
};

/**
 * Builds the success envelope object (no `Response` wrapper).
 * Used by the route runtime and by {@link createApiJsonSuccessResponse}.
 */
export function buildApiJsonSuccessBody(
  data: unknown,
  status: number,
  code?: string,
  message?: string,
  issues?: ApiErrorIssue[],
): ApiJsonSuccessBody {
  const responseBody: ApiJsonSuccessBody = {
    code: code ?? "SUCCESS",
    message: message ?? getStatusMessage(status),
    data,
  };

  if ((issues?.length ?? 0) > 0) {
    responseBody.issues = issues;
  }

  return responseBody;
}

/**
 * JSON `Response` using the same 2xx envelope as file-system routes.
 */
export function createApiJsonSuccessResponse(
  data: unknown,
  init?: {
    status?: number;
    code?: string;
    message?: string;
    issues?: ApiErrorIssue[];
    headers?: Record<string, string>;
  },
): Response {
  const status = init?.status ?? 200;
  const body = buildApiJsonSuccessBody(
    data,
    status,
    init?.code,
    init?.message,
    init?.issues,
  );

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * JSON `Response` using the same error envelope as `buildApiErrorResponse` / validation errors.
 */
export function createApiJsonErrorResponse(
  status: number,
  envelope: {
    code: string;
    message: string;
    data?: unknown;
    issues?: unknown;
  },
  headers?: Record<string, string>,
): Response {
  const responseBody: ApiJsonErrorBody = {
    code: envelope.code,
    message: envelope.message,
  };

  if (envelope.data !== undefined) {
    responseBody.data = envelope.data;
  }

  if (
    (Array.isArray(envelope.issues) && envelope.issues.length > 0) ||
    (!Array.isArray(envelope.issues) && envelope.issues !== undefined)
  ) {
    responseBody.issues = envelope.issues;
  }

  return new Response(JSON.stringify(responseBody), {
    status,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
  });
}
